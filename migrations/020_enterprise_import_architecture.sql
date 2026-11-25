-- ==============================================================================
-- Migration 020: Enterprise Asynchronous Batch Import Architecture (REVISED)
-- Target: PostgreSQL / Supabase (Production Compatibility Audited)
--
-- Verified Production Compatibility:
--   - public.users.id is TEXT (NOT UUID); created_by_id & imported_by_id are TEXT.
--   - public.users.auth_user_id does NOT exist; MoraJaws uses internal Custom
--     Authentication (public.auth_sessions) via Express + service_role.
--   - Zero UUID casts on TEXT user IDs and zero references to users.auth_user_id.
--   - Reuses existing public.morajaws_set_updated_at() trigger function without
--     altering unrelated functions (with safe fallback only if unavailable).
--   - Preserves public.work_orders & uq_work_orders_wo_number_normalized
--     (lower(regexp_replace(btrim(wo_number), '\s+', '', 'g'))).
--   - Zero hard-coded production WO IDs; never overwrites soft-deleted or
--     archived work_orders even under duplicate_policy = 'update_allowed'.
--   - Preserves import_history permanently on import_jobs deletion via
--     ON DELETE SET NULL + original_job_id preservation trigger.
--   - Database-backed concurrency control via FOR UPDATE SKIP LOCKED + lease TTL
--     and single-transaction ACID commit/fail/cancel/retry RPCs.
--   - Deny-by-default RLS & privileges: service_role only for Express backend;
--     PUBLIC, anon, and authenticated receive zero direct table/RPC access.
--   - Non-destructive & idempotent: NEVER drops, truncates, or bulk-modifies
--     existing production work_orders data.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. Verify or safely provision updated_at trigger support (non-destructive)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.morajaws_set_updated_at()') IS NULL THEN
    CREATE OR REPLACE FUNCTION public.morajaws_import_set_updated_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $fn$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 1. import_jobs: Master tracking record per asynchronous import job
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id TEXT PRIMARY KEY,
  import_name TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_format TEXT NOT NULL DEFAULT 'xlsx',
  template_type TEXT DEFAULT 'CUSTOM',
  duplicate_policy TEXT NOT NULL DEFAULT 'skip'
    CHECK (duplicate_policy IN ('skip', 'update_allowed')),
  auto_register_contractors BOOLEAN NOT NULL DEFAULT TRUE,
  batch_size INTEGER NOT NULL DEFAULT 500
    CHECK (batch_size >= 25 AND batch_size <= 500),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  staged_rows INTEGER NOT NULL DEFAULT 0 CHECK (staged_rows >= 0),
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  successful_rows INTEGER NOT NULL DEFAULT 0 CHECK (successful_rows >= 0),
  updated_rows INTEGER NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),
  duplicate_rows INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
  failed_rows INTEGER NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  total_batches INTEGER NOT NULL DEFAULT 0 CHECK (total_batches >= 0),
  completed_batches INTEGER NOT NULL DEFAULT 0 CHECK (completed_batches >= 0),
  current_batch INTEGER NOT NULL DEFAULT 0 CHECK (current_batch >= 0),
  status TEXT NOT NULL DEFAULT 'staging'
    CHECK (status IN (
      'staging',
      'queued',
      'processing',
      'paused',
      'completed',
      'completed_with_errors',
      'failed',
      'cancelled'
    )),
  error_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_by TEXT NOT NULL,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status_created
  ON public.import_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_jobs_created_by_created
  ON public.import_jobs (created_by_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_jobs_client_request_id
  ON public.import_jobs ((metadata->>'clientRequestId'))
  WHERE metadata ? 'clientRequestId';

DROP TRIGGER IF EXISTS trg_import_jobs_updated_at ON public.import_jobs;
DO $$
BEGIN
  IF to_regprocedure('public.morajaws_set_updated_at()') IS NOT NULL THEN
    CREATE TRIGGER trg_import_jobs_updated_at
      BEFORE UPDATE ON public.import_jobs
      FOR EACH ROW EXECUTE FUNCTION public.morajaws_set_updated_at();
  ELSE
    CREATE TRIGGER trg_import_jobs_updated_at
      BEFORE UPDATE ON public.import_jobs
      FOR EACH ROW EXECUTE FUNCTION public.morajaws_import_set_updated_at();
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. import_batches: Idempotent chunk units with distributed PostgreSQL locking
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_batches (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL CHECK (batch_number >= 1),
  start_row INTEGER NOT NULL CHECK (start_row >= 1),
  end_row INTEGER NOT NULL CHECK (end_row >= start_row),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  successful_rows INTEGER NOT NULL DEFAULT 0 CHECK (successful_rows >= 0),
  updated_rows INTEGER NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),
  duplicate_rows INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
  failed_rows INTEGER NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message TEXT,
  duration_ms INTEGER,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  lock_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_import_batches_job_batch UNIQUE (job_id, batch_number)
);

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS updated_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.import_batches'::regclass
      AND conname = 'chk_import_batches_updated_rows_nonneg'
  ) THEN
    ALTER TABLE public.import_batches
      ADD CONSTRAINT chk_import_batches_updated_rows_nonneg CHECK (updated_rows >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_batches_job_status
  ON public.import_batches (job_id, status, batch_number);

CREATE INDEX IF NOT EXISTS idx_import_batches_claim
  ON public.import_batches (job_id, status, lock_expires_at, batch_number);

DROP TRIGGER IF EXISTS trg_import_batches_updated_at ON public.import_batches;
DO $$
BEGIN
  IF to_regprocedure('public.morajaws_set_updated_at()') IS NOT NULL THEN
    CREATE TRIGGER trg_import_batches_updated_at
      BEFORE UPDATE ON public.import_batches
      FOR EACH ROW EXECUTE FUNCTION public.morajaws_set_updated_at();
  ELSE
    CREATE TRIGGER trg_import_batches_updated_at
      BEFORE UPDATE ON public.import_batches
      FOR EACH ROW EXECUTE FUNCTION public.morajaws_import_set_updated_at();
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. import_staging_rows: Staging buffer preserving raw + normalized payloads
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_staging_rows (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  batch_number INTEGER,
  row_number INTEGER NOT NULL CHECK (row_number >= 1),
  wo_number TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(raw_payload) = 'object'),
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(normalized_payload) = 'object'),
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'valid', 'invalid', 'duplicate')),
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'succeeded', 'duplicate_skipped', 'failed', 'cancelled')),
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_import_staging_job_row UNIQUE (job_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_import_staging_job_batch_proc
  ON public.import_staging_rows (job_id, batch_number, processing_status);

CREATE INDEX IF NOT EXISTS idx_import_staging_job_validation
  ON public.import_staging_rows (job_id, validation_status, row_number);

CREATE INDEX IF NOT EXISTS idx_import_staging_wo_number
  ON public.import_staging_rows (job_id, wo_number);

CREATE INDEX IF NOT EXISTS idx_import_staging_job_canon_wo
  ON public.import_staging_rows (job_id, lower(regexp_replace(btrim(wo_number), '\s+', '', 'g')))
  WHERE wo_number IS NOT NULL AND btrim(wo_number) <> '';

-- ------------------------------------------------------------------------------
-- 4. import_row_errors: Structured downloadable error diagnostics
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_row_errors (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  batch_number INTEGER,
  row_number INTEGER NOT NULL CHECK (row_number >= 1),
  wo_number TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(raw_payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_row_errors_job_row
  ON public.import_row_errors (job_id, row_number);

-- ------------------------------------------------------------------------------
-- 5. import_history: Permanent summary ledger preserved across job deletions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_history (
  id TEXT PRIMARY KEY,
  job_id TEXT UNIQUE REFERENCES public.import_jobs(id) ON DELETE SET NULL,
  original_job_id TEXT,
  import_name TEXT,
  source_file TEXT,
  imported_by TEXT NOT NULL,
  imported_by_id TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  status TEXT NOT NULL DEFAULT 'completed',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent repair if an earlier draft created CASCADE or NOT NULL on job_id
DO $$
DECLARE
  v_fk_name TEXT;
BEGIN
  ALTER TABLE public.import_history
    ADD COLUMN IF NOT EXISTS original_job_id TEXT;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'import_history'
      AND column_name = 'job_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.import_history ALTER COLUMN job_id DROP NOT NULL;
  END IF;

  FOR v_fk_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.import_history'::regclass
      AND c.contype = 'f'
      AND a.attname = 'job_id'
      AND c.confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE public.import_history DROP CONSTRAINT IF EXISTS %I', v_fk_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.import_history'::regclass
      AND c.contype = 'f'
      AND a.attname = 'job_id'
      AND c.confdeltype = 'n'
  ) THEN
    ALTER TABLE public.import_history
      ADD CONSTRAINT fk_import_history_job_id
      FOREIGN KEY (job_id) REFERENCES public.import_jobs(id) ON DELETE SET NULL;
  END IF;

  UPDATE public.import_history
  SET original_job_id = COALESCE(original_job_id, job_id)
  WHERE original_job_id IS NULL AND job_id IS NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION public.morajaws_import_history_preserve_job_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.original_job_id IS NULL OR btrim(NEW.original_job_id) = '')
     AND NEW.job_id IS NOT NULL AND btrim(NEW.job_id) <> '' THEN
    NEW.original_job_id := NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_history_preserve_job_ref ON public.import_history;
CREATE TRIGGER trg_import_history_preserve_job_ref
  BEFORE INSERT OR UPDATE ON public.import_history
  FOR EACH ROW EXECUTE FUNCTION public.morajaws_import_history_preserve_job_ref();

CREATE INDEX IF NOT EXISTS idx_import_history_created
  ON public.import_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_history_original_job_id
  ON public.import_history (original_job_id);

-- ------------------------------------------------------------------------------
-- 6. Database-Level Duplicate Lookup & Transactional Batch RPCs
--    All RPCs are SECURITY DEFINER, restricted strictly to service_role.
-- ------------------------------------------------------------------------------

-- 6a. Normalized WO duplicate check aligned 1:1 with uq_work_orders_wo_number_normalized
CREATE OR REPLACE FUNCTION public.morajaws_find_existing_wo_numbers(p_wo_numbers TEXT[])
RETURNS TABLE (canonical_wo TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  WITH normalized_inputs AS (
    SELECT DISTINCT lower(regexp_replace(btrim(x), '\s+', '', 'g')) AS canon
    FROM unnest(COALESCE(p_wo_numbers, ARRAY[]::TEXT[])) AS x
    WHERE x IS NOT NULL AND btrim(x) <> ''
  )
  SELECT DISTINCT lower(regexp_replace(btrim(w.wo_number), '\s+', '', 'g')) AS canonical_wo
  FROM public.work_orders w
  JOIN normalized_inputs ni
    ON lower(regexp_replace(btrim(w.wo_number), '\s+', '', 'g')) = ni.canon
  WHERE w.wo_number IS NOT NULL
    AND btrim(w.wo_number) <> '';
$$;

-- 6b. Atomic sync of staged count + staging -> queued transition when complete
CREATE OR REPLACE FUNCTION public.morajaws_sync_staged_count(p_job_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.import_jobs%ROWTYPE;
  v_staged_count INTEGER := 0;
  v_next_status TEXT;
BEGIN
  SELECT * INTO v_job
  FROM public.import_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_JOB_NOT_FOUND: %', p_job_id;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_staged_count
  FROM public.import_staging_rows
  WHERE job_id = p_job_id;

  v_next_status := CASE
    WHEN v_job.status = 'staging' AND v_staged_count >= GREATEST(v_job.total_rows, 1) THEN 'queued'
    ELSE v_job.status
  END;

  UPDATE public.import_jobs
  SET
    staged_rows = v_staged_count,
    total_rows = GREATEST(total_rows, v_staged_count),
    status = v_next_status,
    updated_at = NOW()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN to_jsonb(v_job);
END;
$$;

-- 6c. Atomic batch claim with FOR UPDATE SKIP LOCKED + stale lock TTL recovery
CREATE OR REPLACE FUNCTION public.morajaws_claim_import_batch(
  p_job_id TEXT,
  p_worker_id TEXT,
  p_batch_number INTEGER DEFAULT NULL,
  p_retry_failed BOOLEAN DEFAULT FALSE,
  p_lock_ttl_seconds INTEGER DEFAULT 120
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_ttl_secs INTEGER := GREATEST(15, LEAST(600, COALESCE(p_lock_ttl_seconds, 120)));
  v_job public.import_jobs%ROWTYPE;
  v_batch public.import_batches%ROWTYPE;
  v_active_locked_exists BOOLEAN := FALSE;
  v_was_stale_or_failed BOOLEAN := FALSE;
BEGIN
  IF p_job_id IS NULL OR btrim(p_job_id) = '' THEN
    RAISE EXCEPTION 'INVALID_JOB_ID';
  END IF;
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'INVALID_WORKER_ID';
  END IF;

  SELECT * INTO v_job
  FROM public.import_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'JOB_NOT_FOUND');
  END IF;

  IF v_job.status = 'cancelled' THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'JOB_CANCELLED', 'job', to_jsonb(v_job));
  END IF;

  IF v_job.status = 'completed' THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'JOB_ALREADY_COMPLETED', 'job', to_jsonb(v_job));
  END IF;

  IF v_job.status = 'staging' AND v_job.staged_rows < GREATEST(v_job.total_rows, 1) THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'STAGING_INCOMPLETE', 'job', to_jsonb(v_job));
  END IF;

  SELECT * INTO v_batch
  FROM public.import_batches b
  WHERE b.job_id = p_job_id
    AND (p_batch_number IS NULL OR b.batch_number = p_batch_number)
    AND (
      b.status = 'pending'
      OR (COALESCE(p_retry_failed, FALSE) AND b.status = 'failed')
      OR (b.status = 'processing' AND (b.lock_expires_at IS NULL OR b.lock_expires_at < v_now))
    )
  ORDER BY b.batch_number ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.import_batches b
      WHERE b.job_id = p_job_id
        AND (p_batch_number IS NULL OR b.batch_number = p_batch_number)
        AND b.status = 'processing'
        AND (b.lock_expires_at IS NULL OR b.lock_expires_at >= v_now)
    ) INTO v_active_locked_exists;

    RETURN jsonb_build_object(
      'claimed', FALSE,
      'reason', CASE WHEN v_active_locked_exists THEN 'BATCH_LOCKED_BY_ANOTHER_WORKER' ELSE 'NO_ELIGIBLE_BATCH' END,
      'job', to_jsonb(v_job)
    );
  END IF;

  v_was_stale_or_failed := (v_batch.status = 'failed')
    OR (v_batch.status = 'processing' AND v_batch.locked_by IS DISTINCT FROM p_worker_id AND v_batch.started_at IS NOT NULL);

  UPDATE public.import_batches
  SET
    status = 'processing',
    locked_by = p_worker_id,
    locked_at = v_now,
    lock_expires_at = v_now + make_interval(secs => v_ttl_secs),
    retry_count = CASE WHEN v_was_stale_or_failed THEN retry_count + 1 ELSE retry_count END,
    started_at = COALESCE(started_at, v_now),
    error_message = NULL,
    updated_at = v_now
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  UPDATE public.import_jobs
  SET
    status = 'processing',
    started_at = COALESCE(started_at, v_now),
    current_batch = v_batch.batch_number,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'claimed', TRUE,
    'reason', 'CLAIMED',
    'job', to_jsonb(v_job),
    'batch', to_jsonb(v_batch)
  );
END;
$$;

-- 6d. Atomic commit of a claimed batch:
--     - Verifies lock ownership & non-cancelled job.
--     - Checks existing public.work_orders via normalized index expression.
--     - NEVER overwrites deleted/archived existing WOs, and under 'skip' never
--       modifies any existing production WO.
--     - Updates import_staging_rows, import_row_errors, import_batches,
--       import_jobs, and import_history within ONE ACID transaction.
CREATE OR REPLACE FUNCTION public.morajaws_commit_import_batch_atomic(
  p_job_id TEXT,
  p_batch_number INTEGER,
  p_worker_id TEXT,
  p_wo_rows JSONB,
  p_duplicate_policy TEXT DEFAULT 'skip',
  p_duration_ms INTEGER DEFAULT 1,
  p_imported_by TEXT DEFAULT 'System',
  p_imported_by_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_job public.import_jobs%ROWTYPE;
  v_batch public.import_batches%ROWTYPE;
  v_row JSONB;
  v_wo_num TEXT;
  v_canon_wo TEXT;
  v_wo_id TEXT;
  v_existing_wo RECORD;
  v_payload JSONB;
  v_inserted_wos TEXT[] := ARRAY[]::TEXT[];
  v_updated_wos TEXT[] := ARRAY[]::TEXT[];
  v_dup_wos TEXT[] := ARRAY[]::TEXT[];
  v_failed_rows JSONB := '[]'::jsonb;
  v_row_err_msg TEXT;
  v_row_err_code TEXT;
  v_sr RECORD;
  v_fail_info JSONB;
  v_batch_total INTEGER := 0;
  v_batch_dup_pre INTEGER := 0;
  v_batch_inv_pre INTEGER := 0;
  v_batch_success INTEGER := 0;
  v_batch_updated INTEGER := 0;
  v_batch_dup_total INTEGER := 0;
  v_batch_failed_total INTEGER := 0;
  v_completed_batches INTEGER := 0;
  v_failed_batches INTEGER := 0;
  v_pending_batches INTEGER := 0;
  v_job_processed INTEGER := 0;
  v_job_successful INTEGER := 0;
  v_job_updated INTEGER := 0;
  v_job_dup INTEGER := 0;
  v_job_failed INTEGER := 0;
  v_next_job_status TEXT;
  v_completed_at TIMESTAMPTZ;
  v_error_summary TEXT;
  v_history public.import_history%ROWTYPE;
  v_history_written BOOLEAN := FALSE;
  v_has_more_pending BOOLEAN := FALSE;
  v_duration_job_ms INTEGER;
  v_dup_policy TEXT := COALESCE(NULLIF(btrim(p_duplicate_policy), ''), 'skip');
BEGIN
  IF v_dup_policy NOT IN ('skip', 'update_allowed') THEN
    RAISE EXCEPTION 'INVALID_DUPLICATE_POLICY: %', COALESCE(p_duplicate_policy, '<NULL>');
  END IF;

  SELECT * INTO v_job
  FROM public.import_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_JOB_NOT_FOUND: %', p_job_id;
  END IF;

  IF v_job.status = 'cancelled' THEN
    RAISE EXCEPTION 'IMPORT_JOB_CANCELLED: Job % dibatalkan sebelum batch #% dapat di-commit.', p_job_id, p_batch_number;
  END IF;

  SELECT * INTO v_batch
  FROM public.import_batches
  WHERE job_id = p_job_id
    AND batch_number = p_batch_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_BATCH_NOT_FOUND: % #%', p_job_id, p_batch_number;
  END IF;

  IF v_batch.status = 'completed' THEN
    RAISE EXCEPTION 'IMPORT_BATCH_ALREADY_COMPLETED: Batch #% sudah berstatus completed.', p_batch_number;
  END IF;

  IF v_batch.status <> 'processing' OR v_batch.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'IMPORT_BATCH_LOCK_LOST: Lock batch #% dipegang worker lain atau sudah kadaluarsa.', p_batch_number;
  END IF;

  IF p_wo_rows IS NOT NULL AND jsonb_typeof(p_wo_rows) = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_wo_rows)
    LOOP
      v_wo_num := upper(regexp_replace(btrim(COALESCE(v_row->>'wo_number', v_row->>'work_order_number', '')), '\s+', '', 'g'));
      v_canon_wo := lower(v_wo_num);
      v_wo_id := COALESCE(
        NULLIF(btrim(v_row->>'id'), ''),
        'wo_' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
      );

      IF v_wo_num = '' OR v_canon_wo = '' THEN
        v_failed_rows := v_failed_rows || jsonb_build_array(
          jsonb_build_object('woNumber', '', 'errorCode', 'INVALID_WO', 'errorMessage', 'Nomor WO kosong.')
        );
        CONTINUE;
      END IF;

      SELECT id, payload, is_deleted, is_archived
      INTO v_existing_wo
      FROM public.work_orders
      WHERE lower(regexp_replace(btrim(wo_number), '\s+', '', 'g')) = v_canon_wo
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        -- Never overwrite soft-deleted or archived production records
        IF COALESCE(v_existing_wo.is_deleted, FALSE) OR COALESCE(v_existing_wo.is_archived, FALSE) THEN
          v_dup_wos := array_append(v_dup_wos, v_wo_num);
          CONTINUE;
        END IF;

        IF v_dup_policy = 'update_allowed' THEN
          BEGIN
            UPDATE public.work_orders
            SET
              appointment_date = COALESCE(NULLIF(btrim(v_row->>'appointment_date'), '')::date, appointment_date),
              slot_time = COALESCE(NULLIF(btrim(v_row->>'slot_time'), ''), slot_time),
              customer_phone = COALESCE(NULLIF(btrim(v_row->>'customer_phone'), ''), customer_phone),
              customer_contact1 = COALESCE(NULLIF(btrim(v_row->>'customer_contact1'), ''), customer_contact1),
              street_name = COALESCE(NULLIF(btrim(v_row->>'street_name'), ''), street_name),
              cluster_name = COALESCE(NULLIF(btrim(v_row->>'cluster_name'), ''), cluster_name),
              area = COALESCE(NULLIF(btrim(v_row->>'area'), ''), area),
              contractor_id = COALESCE(NULLIF(btrim(v_row->>'contractor_id'), ''), contractor_id),
              contractor_name = COALESCE(NULLIF(btrim(v_row->>'contractor_name'), ''), contractor_name),
              contactor_name = COALESCE(NULLIF(btrim(v_row->>'contactor_name'), ''), contactor_name),
              fat_code = COALESCE(NULLIF(btrim(v_row->>'fat_code'), ''), fat_code),
              fdt_code = COALESCE(NULLIF(btrim(v_row->>'fdt_code'), ''), fdt_code),
              leader_name = COALESCE(NULLIF(btrim(v_row->>'leader_name'), ''), leader_name),
              distribution_status = COALESCE(NULLIF(btrim(v_row->>'distribution_status'), ''), distribution_status),
              distribution_notes = COALESCE(NULLIF(btrim(v_row->>'distribution_notes'), ''), distribution_notes),
              payload = COALESCE(public.work_orders.payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
                'leaderId', NULLIF(btrim(COALESCE(v_row->'payload'->>'leaderId', '')), ''),
                'leaderContact', NULLIF(btrim(COALESCE(v_row->'payload'->>'leaderContact', '')), ''),
                'distributionStatus', NULLIF(btrim(v_row->>'distribution_status'), ''),
                'distributionNotes', NULLIF(btrim(v_row->>'distribution_notes'), '')
              )),
              updated_at = v_now,
              updated_by = COALESCE(NULLIF(btrim(p_imported_by), ''), 'ImportUpdate')
            WHERE id = v_existing_wo.id;

            v_updated_wos := array_append(v_updated_wos, v_wo_num);
          EXCEPTION WHEN OTHERS THEN
            v_row_err_code := COALESCE(SQLSTATE, 'DB_UPDATE_ERROR');
            v_row_err_msg := SQLERRM;
            IF v_row_err_msg ILIKE '%PROTECTED_RECORD_MUTATION_FORBIDDEN%' THEN
              v_dup_wos := array_append(v_dup_wos, v_wo_num);
            ELSE
              v_failed_rows := v_failed_rows || jsonb_build_array(
                jsonb_build_object('woNumber', v_wo_num, 'errorCode', v_row_err_code, 'errorMessage', v_row_err_msg)
              );
            END IF;
          END;
        ELSE
          v_dup_wos := array_append(v_dup_wos, v_wo_num);
        END IF;
        CONTINUE;
      END IF;

      -- Insert new Work Order (uses only verified baseline public.work_orders columns)
      v_payload := CASE WHEN jsonb_typeof(v_row->'payload') = 'object' THEN v_row->'payload' ELSE '{}'::jsonb END;
      BEGIN
        INSERT INTO public.work_orders (
          id, wo_number, work_order_number, id_customer, customer_id,
          ticket_number, ticket_date, date, appointment_date, date_upload, file_name, agent_id,
          customer_name, end_user_name, customer_phone, customer_contact1, customer_contact2, customer_contact3, customer_phone_normalized,
          street_name, street_alternatif, address, city, postal_code, cluster_name, area,
          appointment_type, slot_time, ticket_category, initial_ticket_category,
          installation_type, service_type, homepass_type, homepass_detail_id, olt_code, fdt_code, fat_code, fat_port, dropcore_length,
          plan, service_aging_maintenance, vendor_name, router, ont_brand, ont_model, router_brand, router_model, router_serial_number,
          stb1_sn, stb1_mac, stb2_sn, stb2_mac, stb3_sn, stb3_mac, ont_serial_number, ont_mac_address, rg_serial_number, rg_mac_address,
          contractor_id, contractor_name, contactor_name, leader_name, corlap_name, corlap_contact,
          installer_name, installer_contact, installer_contact2, installer_email,
          date_assign_agent, date_assign_technician, assigned_at, assigned_by, reassigned_at, reassigned_by, reassignment_reason,
          distribution_status, distribution_notes, status_wo_agent, status_wo_installer, status_whatsapp,
          remarks_wo_installer, remarks_agent, remarks,
          wa_message_preview, wa_generated_url, wa_last_opened_at, wa_confirmed_at, wa_confirmed_by, wa_confirmation_notes,
          chat_messages_count, last_message_at, last_message_snippet,
          check_in_at, work_session_status, work_sessions,
          closed_at, closed_by, close_notes, reopen_reason, technical_report,
          is_archived, archived_at, archived_by, is_deleted, deleted_at, deleted_by, deletion_reason,
          unmapped_headers, additional_fields, imported_at, import_date, import_batch_id,
          payload, created_at, updated_at, updated_by
        ) VALUES (
          v_wo_id,
          v_wo_num,
          COALESCE(NULLIF(btrim(v_row->>'work_order_number'), ''), v_wo_num),
          NULLIF(btrim(v_row->>'id_customer'), ''),
          NULLIF(btrim(v_row->>'customer_id'), ''),
          NULLIF(btrim(v_row->>'ticket_number'), ''),
          NULLIF(btrim(v_row->>'ticket_date'), '')::date,
          NULLIF(btrim(v_row->>'date'), '')::date,
          NULLIF(btrim(v_row->>'appointment_date'), '')::date,
          NULLIF(btrim(v_row->>'date_upload'), ''),
          NULLIF(btrim(v_row->>'file_name'), ''),
          NULLIF(btrim(v_row->>'agent_id'), ''),
          NULLIF(btrim(v_row->>'customer_name'), ''),
          NULLIF(btrim(v_row->>'end_user_name'), ''),
          NULLIF(btrim(v_row->>'customer_phone'), ''),
          NULLIF(btrim(v_row->>'customer_contact1'), ''),
          NULLIF(btrim(v_row->>'customer_contact2'), ''),
          NULLIF(btrim(v_row->>'customer_contact3'), ''),
          NULLIF(btrim(v_row->>'customer_phone_normalized'), ''),
          NULLIF(btrim(v_row->>'street_name'), ''),
          NULLIF(btrim(v_row->>'street_alternatif'), ''),
          NULLIF(btrim(v_row->>'address'), ''),
          NULLIF(btrim(v_row->>'city'), ''),
          NULLIF(btrim(v_row->>'postal_code'), ''),
          NULLIF(btrim(v_row->>'cluster_name'), ''),
          NULLIF(btrim(v_row->>'area'), ''),
          NULLIF(btrim(v_row->>'appointment_type'), ''),
          NULLIF(btrim(v_row->>'slot_time'), ''),
          NULLIF(btrim(v_row->>'ticket_category'), ''),
          NULLIF(btrim(v_row->>'initial_ticket_category'), ''),
          NULLIF(btrim(v_row->>'installation_type'), ''),
          NULLIF(btrim(v_row->>'service_type'), ''),
          NULLIF(btrim(v_row->>'homepass_type'), ''),
          NULLIF(btrim(v_row->>'homepass_detail_id'), ''),
          NULLIF(btrim(v_row->>'olt_code'), ''),
          NULLIF(btrim(v_row->>'fdt_code'), ''),
          NULLIF(btrim(v_row->>'fat_code'), ''),
          NULLIF(btrim(v_row->>'fat_port'), ''),
          NULLIF(btrim(v_row->>'dropcore_length'), ''),
          NULLIF(btrim(v_row->>'plan'), ''),
          NULLIF(btrim(v_row->>'service_aging_maintenance'), ''),
          NULLIF(btrim(v_row->>'vendor_name'), ''),
          NULLIF(btrim(v_row->>'router'), ''),
          NULLIF(btrim(v_row->>'ont_brand'), ''),
          NULLIF(btrim(v_row->>'ont_model'), ''),
          NULLIF(btrim(v_row->>'router_brand'), ''),
          NULLIF(btrim(v_row->>'router_model'), ''),
          NULLIF(btrim(v_row->>'router_serial_number'), ''),
          NULLIF(btrim(v_row->>'stb1_sn'), ''),
          NULLIF(btrim(v_row->>'stb1_mac'), ''),
          NULLIF(btrim(v_row->>'stb2_sn'), ''),
          NULLIF(btrim(v_row->>'stb2_mac'), ''),
          NULLIF(btrim(v_row->>'stb3_sn'), ''),
          NULLIF(btrim(v_row->>'stb3_mac'), ''),
          NULLIF(btrim(v_row->>'ont_serial_number'), ''),
          NULLIF(btrim(v_row->>'ont_mac_address'), ''),
          NULLIF(btrim(v_row->>'rg_serial_number'), ''),
          NULLIF(btrim(v_row->>'rg_mac_address'), ''),
          NULLIF(btrim(v_row->>'contractor_id'), ''),
          NULLIF(btrim(v_row->>'contractor_name'), ''),
          NULLIF(btrim(v_row->>'contactor_name'), ''),
          NULLIF(btrim(v_row->>'leader_name'), ''),
          NULLIF(btrim(v_row->>'corlap_name'), ''),
          NULLIF(btrim(v_row->>'corlap_contact'), ''),
          NULLIF(btrim(v_row->>'installer_name'), ''),
          NULLIF(btrim(v_row->>'installer_contact'), ''),
          NULLIF(btrim(v_row->>'installer_contact2'), ''),
          NULLIF(btrim(v_row->>'installer_email'), ''),
          NULLIF(btrim(v_row->>'date_assign_agent'), '')::timestamptz,
          NULLIF(btrim(v_row->>'date_assign_technician'), '')::timestamptz,
          NULLIF(btrim(v_row->>'assigned_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'assigned_by'), ''),
          NULLIF(btrim(v_row->>'reassigned_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'reassigned_by'), ''),
          NULLIF(btrim(v_row->>'reassignment_reason'), ''),
          COALESCE(NULLIF(btrim(v_row->>'distribution_status'), ''), 'pending'),
          NULLIF(btrim(v_row->>'distribution_notes'), ''),
          COALESCE(NULLIF(btrim(v_row->>'status_wo_agent'), ''), 'Pending'),
          COALESCE(NULLIF(btrim(v_row->>'status_wo_installer'), ''), 'Unassigned'),
          COALESCE(NULLIF(btrim(v_row->>'status_whatsapp'), ''), 'not_prepared'),
          NULLIF(btrim(v_row->>'remarks_wo_installer'), ''),
          NULLIF(btrim(v_row->>'remarks_agent'), ''),
          NULLIF(btrim(v_row->>'remarks'), ''),
          NULLIF(btrim(v_row->>'wa_message_preview'), ''),
          NULLIF(btrim(v_row->>'wa_generated_url'), ''),
          NULLIF(btrim(v_row->>'wa_last_opened_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'wa_confirmed_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'wa_confirmed_by'), ''),
          NULLIF(btrim(v_row->>'wa_confirmation_notes'), ''),
          GREATEST(0, COALESCE((v_row->>'chat_messages_count')::integer, 0)),
          NULLIF(btrim(v_row->>'last_message_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'last_message_snippet'), ''),
          NULLIF(btrim(v_row->>'check_in_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'work_session_status'), ''),
          CASE WHEN jsonb_typeof(v_row->'work_sessions') = 'array' THEN v_row->'work_sessions' ELSE '[]'::jsonb END,
          NULLIF(btrim(v_row->>'closed_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'closed_by'), ''),
          NULLIF(btrim(v_row->>'close_notes'), ''),
          NULLIF(btrim(v_row->>'reopen_reason'), ''),
          CASE WHEN jsonb_typeof(v_row->'technical_report') = 'object' THEN v_row->'technical_report' ELSE NULL END,
          COALESCE((v_row->>'is_archived')::boolean, FALSE),
          NULLIF(btrim(v_row->>'archived_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'archived_by'), ''),
          COALESCE((v_row->>'is_deleted')::boolean, FALSE),
          NULLIF(btrim(v_row->>'deleted_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'deleted_by'), ''),
          NULLIF(btrim(v_row->>'deletion_reason'), ''),
          CASE WHEN jsonb_typeof(v_row->'unmapped_headers') = 'array' THEN v_row->'unmapped_headers' ELSE '[]'::jsonb END,
          CASE WHEN jsonb_typeof(v_row->'additional_fields') = 'object' THEN v_row->'additional_fields' ELSE '{}'::jsonb END,
          COALESCE(NULLIF(btrim(v_row->>'imported_at'), '')::timestamptz, v_now),
          NULLIF(btrim(v_row->>'import_date'), '')::date,
          COALESCE(NULLIF(btrim(v_row->>'import_batch_id'), ''), p_job_id || '_b' || p_batch_number::text),
          v_payload,
          COALESCE(NULLIF(btrim(v_row->>'created_at'), '')::timestamptz, v_now),
          v_now,
          COALESCE(NULLIF(btrim(v_row->>'updated_by'), ''), p_imported_by, 'Import')
        );

        v_inserted_wos := array_append(v_inserted_wos, v_wo_num);
      EXCEPTION
        WHEN unique_violation THEN
          v_dup_wos := array_append(v_dup_wos, v_wo_num);
        WHEN OTHERS THEN
          v_row_err_code := COALESCE(SQLSTATE, 'DB_INSERT_ERROR');
          v_row_err_msg := SQLERRM;
          v_failed_rows := v_failed_rows || jsonb_build_array(
            jsonb_build_object('woNumber', v_wo_num, 'errorCode', v_row_err_code, 'errorMessage', v_row_err_msg)
          );
      END;
    END LOOP;
  END IF;

  -- Synchronize staging row states + error records for this batch atomically
  FOR v_sr IN
    SELECT *
    FROM public.import_staging_rows
    WHERE job_id = p_job_id
      AND batch_number = p_batch_number
      AND validation_status = 'valid'
      AND processing_status IN ('pending', 'processing', 'failed')
    ORDER BY row_number ASC
    FOR UPDATE
  LOOP
    v_canon_wo := lower(regexp_replace(btrim(COALESCE(v_sr.wo_number, '')), '\s+', '', 'g'));
    IF EXISTS (SELECT 1 FROM unnest(v_inserted_wos) AS x WHERE lower(regexp_replace(btrim(x), '\s+', '', 'g')) = v_canon_wo)
       OR EXISTS (SELECT 1 FROM unnest(v_updated_wos) AS x WHERE lower(regexp_replace(btrim(x), '\s+', '', 'g')) = v_canon_wo) THEN
      UPDATE public.import_staging_rows
      SET processing_status = 'succeeded', error_code = NULL, error_message = NULL, processed_at = v_now
      WHERE id = v_sr.id;
    ELSIF EXISTS (SELECT 1 FROM unnest(v_dup_wos) AS x WHERE lower(regexp_replace(btrim(x), '\s+', '', 'g')) = v_canon_wo) THEN
      UPDATE public.import_staging_rows
      SET
        processing_status = 'duplicate_skipped',
        error_code = 'DUPLICATE_CONFLICT',
        error_message = format('Nomor WO %s sudah terdaftar di database.', COALESCE(v_sr.wo_number, '')),
        processed_at = v_now
      WHERE id = v_sr.id;

      INSERT INTO public.import_row_errors (
        id, job_id, batch_number, row_number, wo_number, error_code, error_message, raw_payload, created_at
      ) VALUES (
        'imperr_' || p_job_id || '_r' || v_sr.row_number::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6),
        p_job_id,
        p_batch_number,
        v_sr.row_number,
        v_sr.wo_number,
        'DUPLICATE_CONFLICT',
        format('Nomor WO %s sudah terdaftar di database.', COALESCE(v_sr.wo_number, '')),
        COALESCE(v_sr.raw_payload, '{}'::jsonb),
        v_now
      );
    ELSE
      SELECT elem INTO v_fail_info
      FROM jsonb_array_elements(v_failed_rows) AS elem
      WHERE lower(regexp_replace(btrim(COALESCE(elem->>'woNumber', '')), '\s+', '', 'g')) = v_canon_wo
      LIMIT 1;

      v_row_err_code := COALESCE(NULLIF(v_fail_info->>'errorCode', ''), 'COMMIT_FAILED');
      v_row_err_msg := COALESCE(NULLIF(v_fail_info->>'errorMessage', ''), format('Baris WO %s gagal disimpan ke database.', COALESCE(v_sr.wo_number, '')));

      UPDATE public.import_staging_rows
      SET
        processing_status = 'failed',
        error_code = v_row_err_code,
        error_message = v_row_err_msg,
        processed_at = v_now
      WHERE id = v_sr.id;

      INSERT INTO public.import_row_errors (
        id, job_id, batch_number, row_number, wo_number, error_code, error_message, raw_payload, created_at
      ) VALUES (
        'imperr_' || p_job_id || '_r' || v_sr.row_number::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6),
        p_job_id,
        p_batch_number,
        v_sr.row_number,
        v_sr.wo_number,
        v_row_err_code,
        v_row_err_msg,
        COALESCE(v_sr.raw_payload, '{}'::jsonb),
        v_now
      );
    END IF;
  END LOOP;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE validation_status = 'duplicate')::INTEGER,
    COUNT(*) FILTER (WHERE validation_status = 'invalid')::INTEGER
  INTO v_batch_total, v_batch_dup_pre, v_batch_inv_pre
  FROM public.import_staging_rows
  WHERE job_id = p_job_id AND batch_number = p_batch_number;

  v_batch_success := COALESCE(array_length(v_inserted_wos, 1), 0);
  v_batch_updated := COALESCE(array_length(v_updated_wos, 1), 0);
  v_batch_dup_total := v_batch_dup_pre + COALESCE(array_length(v_dup_wos, 1), 0);
  v_batch_failed_total := v_batch_inv_pre + COALESCE(jsonb_array_length(v_failed_rows), 0);

  UPDATE public.import_batches
  SET
    status = 'completed',
    processed_rows = v_batch_total,
    successful_rows = v_batch_success + v_batch_updated,
    updated_rows = v_batch_updated,
    duplicate_rows = v_batch_dup_total,
    failed_rows = v_batch_failed_total,
    error_message = NULL,
    duration_ms = GREATEST(1, COALESCE(p_duration_ms, 1)),
    locked_by = NULL,
    locked_at = NULL,
    lock_expires_at = NULL,
    processed_at = v_now,
    updated_at = v_now
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed')::INTEGER,
    COUNT(*) FILTER (WHERE status = 'failed')::INTEGER,
    COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::INTEGER,
    COALESCE(SUM(updated_rows), 0)::INTEGER
  INTO v_completed_batches, v_failed_batches, v_pending_batches, v_job_updated
  FROM public.import_batches
  WHERE job_id = p_job_id;

  SELECT
    COUNT(*) FILTER (WHERE processing_status IN ('succeeded', 'duplicate_skipped', 'failed', 'cancelled'))::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'succeeded')::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'duplicate_skipped')::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'failed')::INTEGER
  INTO v_job_processed, v_job_successful, v_job_dup, v_job_failed
  FROM public.import_staging_rows
  WHERE job_id = p_job_id;

  IF v_job.status = 'cancelled' THEN
    v_next_job_status := 'cancelled';
    v_completed_at := v_job.completed_at;
    v_error_summary := v_job.error_summary;
  ELSIF v_pending_batches = 0 THEN
    v_completed_at := COALESCE(v_job.completed_at, v_now);
    IF v_failed_batches > 0 AND v_job_successful = 0 THEN
      v_next_job_status := 'failed';
      SELECT error_message INTO v_error_summary
      FROM public.import_batches
      WHERE job_id = p_job_id AND status = 'failed'
      ORDER BY batch_number ASC
      LIMIT 1;
      v_error_summary := COALESCE(v_error_summary, format('%s batch gagal diproses.', v_failed_batches));
    ELSIF v_failed_batches > 0 OR v_job_failed > 0 THEN
      v_next_job_status := 'completed_with_errors';
      v_error_summary := format('%s baris tidak valid/gagal diproses (%s batch error).', v_job_failed, v_failed_batches);
    ELSE
      v_next_job_status := 'completed';
      v_error_summary := NULL;
    END IF;
  ELSE
    v_next_job_status := 'processing';
    v_completed_at := NULL;
    v_error_summary := v_job.error_summary;
  END IF;

  UPDATE public.import_jobs
  SET
    processed_rows = v_job_processed,
    successful_rows = v_job_successful,
    updated_rows = v_job_updated,
    duplicate_rows = v_job_dup,
    failed_rows = v_job_failed,
    completed_batches = v_completed_batches,
    status = v_next_job_status,
    error_summary = v_error_summary,
    completed_at = v_completed_at,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  v_has_more_pending := (v_pending_batches > 0);

  IF v_pending_batches = 0 AND v_next_job_status IN ('completed', 'completed_with_errors', 'failed') THEN
    v_duration_job_ms := CASE
      WHEN v_job.started_at IS NOT NULL THEN GREATEST(1, (extract(epoch FROM (COALESCE(v_completed_at, v_now) - v_job.started_at)) * 1000)::integer)
      ELSE NULL
    END;

    INSERT INTO public.import_history (
      id, job_id, original_job_id, import_name, source_file,
      imported_by, imported_by_id, total_rows, success_count,
      duplicate_count, failed_count, status, duration_ms, created_at
    ) VALUES (
      'imphist_' || p_job_id, p_job_id, p_job_id, v_job.import_name, v_job.source_file,
      v_job.created_by, v_job.created_by_id, v_job.total_rows, v_job_successful,
      v_job_dup, v_job_failed, v_next_job_status, v_duration_job_ms, v_now
    )
    ON CONFLICT (job_id) DO UPDATE SET
      original_job_id = COALESCE(public.import_history.original_job_id, EXCLUDED.original_job_id),
      import_name = EXCLUDED.import_name,
      source_file = EXCLUDED.source_file,
      total_rows = EXCLUDED.total_rows,
      success_count = EXCLUDED.success_count,
      duplicate_count = EXCLUDED.duplicate_count,
      failed_count = EXCLUDED.failed_count,
      status = EXCLUDED.status,
      duration_ms = EXCLUDED.duration_ms
    RETURNING * INTO v_history;

    v_history_written := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'job', to_jsonb(v_job),
    'batch', to_jsonb(v_batch),
    'insertedWoNumbers', to_jsonb(v_inserted_wos),
    'updatedWoNumbers', to_jsonb(v_updated_wos),
    'duplicateWoNumbers', to_jsonb(v_dup_wos),
    'failedRows', v_failed_rows,
    'hasMorePending', v_has_more_pending,
    'historyWritten', v_history_written,
    'history', CASE WHEN v_history_written THEN to_jsonb(v_history) ELSE NULL END
  );
END;
$$;

-- 6e. Atomic batch failure release with strict lock ownership check
CREATE OR REPLACE FUNCTION public.morajaws_fail_claimed_batch_atomic(
  p_job_id TEXT,
  p_batch_number INTEGER,
  p_worker_id TEXT,
  p_error_message TEXT,
  p_duration_ms INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_job public.import_jobs%ROWTYPE;
  v_batch public.import_batches%ROWTYPE;
  v_valid_failed_count INTEGER := 0;
  v_invalid_pre_count INTEGER := 0;
  v_dup_pre_count INTEGER := 0;
  v_total_batch_rows INTEGER := 0;
  v_completed_batches INTEGER := 0;
  v_failed_batches INTEGER := 0;
  v_pending_batches INTEGER := 0;
  v_job_processed INTEGER := 0;
  v_job_successful INTEGER := 0;
  v_job_dup INTEGER := 0;
  v_job_failed INTEGER := 0;
  v_next_job_status TEXT;
  v_completed_at TIMESTAMPTZ;
  v_err_summary TEXT;
  v_history public.import_history%ROWTYPE;
  v_history_written BOOLEAN := FALSE;
  v_duration_job_ms INTEGER;
BEGIN
  SELECT * INTO v_job FROM public.import_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_JOB_NOT_FOUND: %', p_job_id;
  END IF;

  SELECT * INTO v_batch
  FROM public.import_batches
  WHERE job_id = p_job_id AND batch_number = p_batch_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_BATCH_NOT_FOUND: % #%', p_job_id, p_batch_number;
  END IF;

  IF v_batch.status = 'completed' THEN
    RETURN jsonb_build_object('job', to_jsonb(v_job), 'batch', to_jsonb(v_batch));
  END IF;

  IF v_batch.status <> 'processing' OR v_batch.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'IMPORT_BATCH_LOCK_LOST: Lock batch #% dipegang worker lain atau sudah dilepaskan.', p_batch_number;
  END IF;

  UPDATE public.import_staging_rows
  SET
    processing_status = 'failed',
    error_code = 'BATCH_COMMIT_FAILED',
    error_message = COALESCE(NULLIF(btrim(p_error_message), ''), 'Batch gagal diproses.'),
    processed_at = v_now
  WHERE job_id = p_job_id
    AND batch_number = p_batch_number
    AND validation_status = 'valid'
    AND processing_status IN ('pending', 'processing');

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE validation_status = 'valid' AND processing_status = 'failed')::INTEGER,
    COUNT(*) FILTER (WHERE validation_status = 'invalid')::INTEGER,
    COUNT(*) FILTER (WHERE validation_status = 'duplicate')::INTEGER
  INTO v_total_batch_rows, v_valid_failed_count, v_invalid_pre_count, v_dup_pre_count
  FROM public.import_staging_rows
  WHERE job_id = p_job_id AND batch_number = p_batch_number;

  UPDATE public.import_batches
  SET
    status = 'failed',
    processed_rows = v_total_batch_rows,
    successful_rows = 0,
    updated_rows = 0,
    duplicate_rows = v_dup_pre_count,
    failed_rows = v_valid_failed_count + v_invalid_pre_count,
    error_message = COALESCE(NULLIF(btrim(p_error_message), ''), 'Batch gagal diproses.'),
    duration_ms = GREATEST(1, COALESCE(p_duration_ms, 1)),
    locked_by = NULL,
    locked_at = NULL,
    lock_expires_at = NULL,
    processed_at = v_now,
    updated_at = v_now
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed')::INTEGER,
    COUNT(*) FILTER (WHERE status = 'failed')::INTEGER,
    COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::INTEGER
  INTO v_completed_batches, v_failed_batches, v_pending_batches
  FROM public.import_batches
  WHERE job_id = p_job_id;

  SELECT
    COUNT(*) FILTER (WHERE processing_status IN ('succeeded', 'duplicate_skipped', 'failed', 'cancelled'))::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'succeeded')::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'duplicate_skipped')::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'failed')::INTEGER
  INTO v_job_processed, v_job_successful, v_job_dup, v_job_failed
  FROM public.import_staging_rows
  WHERE job_id = p_job_id;

  IF v_job.status = 'cancelled' THEN
    v_next_job_status := 'cancelled';
    v_completed_at := v_job.completed_at;
    v_err_summary := v_job.error_summary;
  ELSIF v_pending_batches = 0 THEN
    v_completed_at := COALESCE(v_job.completed_at, v_now);
    IF v_job_successful = 0 THEN
      v_next_job_status := 'failed';
      v_err_summary := COALESCE(v_batch.error_message, format('%s batch gagal diproses.', v_failed_batches));
    ELSE
      v_next_job_status := 'completed_with_errors';
      v_err_summary := format('%s baris tidak valid/gagal diproses (%s batch error).', v_job_failed, v_failed_batches);
    END IF;
  ELSE
    v_next_job_status := 'processing';
    v_completed_at := NULL;
    v_err_summary := v_batch.error_message;
  END IF;

  UPDATE public.import_jobs
  SET
    processed_rows = v_job_processed,
    successful_rows = v_job_successful,
    duplicate_rows = v_job_dup,
    failed_rows = v_job_failed,
    completed_batches = v_completed_batches,
    status = v_next_job_status,
    error_summary = v_err_summary,
    completed_at = v_completed_at,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  IF v_pending_batches = 0 AND v_next_job_status IN ('completed_with_errors', 'failed') THEN
    v_duration_job_ms := CASE
      WHEN v_job.started_at IS NOT NULL THEN GREATEST(1, (extract(epoch FROM (COALESCE(v_completed_at, v_now) - v_job.started_at)) * 1000)::integer)
      ELSE NULL
    END;
    INSERT INTO public.import_history (
      id, job_id, original_job_id, import_name, source_file,
      imported_by, imported_by_id, total_rows, success_count,
      duplicate_count, failed_count, status, duration_ms, created_at
    ) VALUES (
      'imphist_' || p_job_id, p_job_id, p_job_id, v_job.import_name, v_job.source_file,
      v_job.created_by, v_job.created_by_id, v_job.total_rows, v_job_successful,
      v_job_dup, v_job_failed, v_next_job_status, v_duration_job_ms, v_now
    )
    ON CONFLICT (job_id) DO UPDATE SET
      original_job_id = COALESCE(public.import_history.original_job_id, EXCLUDED.original_job_id),
      total_rows = EXCLUDED.total_rows,
      success_count = EXCLUDED.success_count,
      duplicate_count = EXCLUDED.duplicate_count,
      failed_count = EXCLUDED.failed_count,
      status = EXCLUDED.status,
      duration_ms = EXCLUDED.duration_ms
    RETURNING * INTO v_history;
    v_history_written := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'job', to_jsonb(v_job),
    'batch', to_jsonb(v_batch),
    'hasMorePending', (v_pending_batches > 0),
    'historyWritten', v_history_written,
    'history', CASE WHEN v_history_written THEN to_jsonb(v_history) ELSE NULL END
  );
END;
$$;

-- 6f. Atomic cancellation serialized with any active batch commit
CREATE OR REPLACE FUNCTION public.morajaws_cancel_import_job_atomic(
  p_job_id TEXT,
  p_cancelled_by TEXT DEFAULT 'System',
  p_cancelled_by_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_job public.import_jobs%ROWTYPE;
  v_duration_ms INTEGER;
BEGIN
  SELECT * INTO v_job
  FROM public.import_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_JOB_NOT_FOUND: %', p_job_id;
  END IF;

  IF v_job.status = 'completed' THEN
    RETURN to_jsonb(v_job);
  END IF;

  PERFORM 1
  FROM public.import_batches
  WHERE job_id = p_job_id AND status IN ('pending', 'processing')
  FOR UPDATE;

  UPDATE public.import_batches
  SET
    status = 'cancelled',
    locked_by = NULL,
    locked_at = NULL,
    lock_expires_at = NULL,
    processed_at = v_now,
    updated_at = v_now
  WHERE job_id = p_job_id
    AND status IN ('pending', 'processing');

  UPDATE public.import_staging_rows
  SET
    processing_status = 'cancelled',
    processed_at = v_now
  WHERE job_id = p_job_id
    AND processing_status IN ('pending', 'processing');

  UPDATE public.import_jobs
  SET
    status = 'cancelled',
    cancelled_at = COALESCE(cancelled_at, v_now),
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  v_duration_ms := CASE
    WHEN v_job.started_at IS NOT NULL THEN GREATEST(1, (extract(epoch FROM (v_now - v_job.started_at)) * 1000)::integer)
    ELSE NULL
  END;

  INSERT INTO public.import_history (
    id, job_id, original_job_id, import_name, source_file,
    imported_by, imported_by_id, total_rows, success_count,
    duplicate_count, failed_count, status, duration_ms, created_at
  ) VALUES (
    'imphist_' || p_job_id, p_job_id, p_job_id, v_job.import_name, v_job.source_file,
    COALESCE(NULLIF(btrim(p_cancelled_by), ''), v_job.created_by),
    COALESCE(NULLIF(btrim(p_cancelled_by_id), ''), v_job.created_by_id),
    v_job.total_rows, v_job.successful_rows, v_job.duplicate_rows, v_job.failed_rows,
    'cancelled', v_duration_ms, v_now
  )
  ON CONFLICT (job_id) DO UPDATE SET
    original_job_id = COALESCE(public.import_history.original_job_id, EXCLUDED.original_job_id),
    total_rows = EXCLUDED.total_rows,
    success_count = EXCLUDED.success_count,
    duplicate_count = EXCLUDED.duplicate_count,
    failed_count = EXCLUDED.failed_count,
    status = 'cancelled',
    duration_ms = EXCLUDED.duration_ms;

  RETURN to_jsonb(v_job);
END;
$$;

-- 6g. Atomic retry of ONLY failed batches (never replays completed batches)
CREATE OR REPLACE FUNCTION public.morajaws_retry_import_job_atomic(p_job_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_job public.import_jobs%ROWTYPE;
  v_failed_batch_nums INTEGER[];
BEGIN
  SELECT * INTO v_job
  FROM public.import_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_JOB_NOT_FOUND: %', p_job_id;
  END IF;

  IF v_job.status = 'cancelled' THEN
    RAISE EXCEPTION 'IMPORT_JOB_CANCELLED: Job % sudah dibatalkan dan tidak dapat di-retry.', p_job_id;
  END IF;

  SELECT ARRAY_AGG(batch_number ORDER BY batch_number)
  INTO v_failed_batch_nums
  FROM public.import_batches
  WHERE job_id = p_job_id
    AND status = 'failed';

  IF v_failed_batch_nums IS NULL OR array_length(v_failed_batch_nums, 1) IS NULL THEN
    RETURN to_jsonb(v_job);
  END IF;

  UPDATE public.import_batches
  SET
    status = 'pending',
    retry_count = retry_count + 1,
    error_message = NULL,
    locked_by = NULL,
    locked_at = NULL,
    lock_expires_at = NULL,
    updated_at = v_now
  WHERE job_id = p_job_id
    AND batch_number = ANY(v_failed_batch_nums)
    AND status = 'failed';

  UPDATE public.import_staging_rows
  SET
    processing_status = 'pending',
    error_code = NULL,
    error_message = NULL,
    processed_at = NULL
  WHERE job_id = p_job_id
    AND batch_number = ANY(v_failed_batch_nums)
    AND validation_status = 'valid'
    AND processing_status = 'failed';

  UPDATE public.import_jobs
  SET
    status = 'processing',
    completed_at = NULL,
    error_summary = NULL,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN to_jsonb(v_job);
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Row Level Security (RLS) — Custom Authentication + Express service_role
--    MoraJaws authenticates users via internal Custom Auth (public.auth_sessions)
--    in the Express backend, which queries Supabase via SUPABASE_SERVICE_ROLE_KEY.
--    Direct anon and authenticated browser access is strictly denied.
-- ------------------------------------------------------------------------------
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_staging_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_row_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

-- Any pre-existing database functions (such as unrelated or draft helpers)
-- are intentionally preserved untouched; Migration 020 neither drops nor
-- references legacy UUID/auth_user_id helpers.

-- Service-role operational policies (Express Backend Proxy only)
DROP POLICY IF EXISTS import_jobs_service_all ON public.import_jobs;
CREATE POLICY import_jobs_service_all ON public.import_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_batches_service_all ON public.import_batches;
CREATE POLICY import_batches_service_all ON public.import_batches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_staging_rows_service_all ON public.import_staging_rows;
CREATE POLICY import_staging_rows_service_all ON public.import_staging_rows
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_row_errors_service_all ON public.import_row_errors;
CREATE POLICY import_row_errors_service_all ON public.import_row_errors
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_history_service_all ON public.import_history;
DROP POLICY IF EXISTS import_history_service_select ON public.import_history;
DROP POLICY IF EXISTS import_history_service_insert ON public.import_history;
DROP POLICY IF EXISTS import_history_service_update ON public.import_history;
CREATE POLICY import_history_service_select ON public.import_history
  FOR SELECT TO service_role USING (true);
CREATE POLICY import_history_service_insert ON public.import_history
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY import_history_service_update ON public.import_history
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 8. Explicit Table & Function Privilege Hardening (Separate from RLS)
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.import_jobs,
  public.import_batches,
  public.import_staging_rows,
  public.import_row_errors,
  public.import_history
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.import_jobs,
  public.import_batches,
  public.import_staging_rows,
  public.import_row_errors
TO service_role;

-- import_history preserves ledger: grant SELECT/INSERT/UPDATE only (no DELETE grant)
GRANT SELECT, INSERT, UPDATE ON TABLE public.import_history TO service_role;

-- Restrict all Migration 020 functions strictly to service_role
DO $$
BEGIN
  IF to_regprocedure('public.morajaws_import_set_updated_at()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.morajaws_import_set_updated_at() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.morajaws_import_history_preserve_job_ref() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_find_existing_wo_numbers(TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_sync_staged_count(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_claim_import_batch(TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_commit_import_batch_atomic(TEXT, INTEGER, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_fail_claimed_batch_atomic(TEXT, INTEGER, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_cancel_import_job_atomic(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_retry_import_job_atomic(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.morajaws_find_existing_wo_numbers(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_sync_staged_count(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_claim_import_batch(TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_commit_import_batch_atomic(TEXT, INTEGER, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_fail_claimed_batch_atomic(TEXT, INTEGER, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_cancel_import_job_atomic(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_retry_import_job_atomic(TEXT) TO service_role;

COMMIT;

-- Note: Migration 020 is strictly additive and forward-only. No destructive
-- DROP TABLE / TRUNCATE rollback statements are included to protect data.
