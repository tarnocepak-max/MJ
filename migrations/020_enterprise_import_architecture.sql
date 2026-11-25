-- ==============================================================================
-- Migration 020: Enterprise Asynchronous Batch Import Architecture
-- Target: PostgreSQL / Supabase
-- Additive & Non-Destructive:
--   - Creates import_jobs, import_batches, import_staging_rows,
--     import_row_errors, and import_history tables with strict constraints,
--     indexes, and Row Level Security.
--   - NEVER drops, truncates, alters, or mutates existing public.work_orders rows.
-- ==============================================================================

BEGIN;

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
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
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

DROP TRIGGER IF EXISTS trg_import_jobs_updated_at ON public.import_jobs;
CREATE TRIGGER trg_import_jobs_updated_at
  BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.morajaws_set_updated_at();

-- ------------------------------------------------------------------------------
-- 2. import_batches: Idempotent chunk units (default 500 WOs per batch)
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
  duplicate_rows INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
  failed_rows INTEGER NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_import_batches_job_batch UNIQUE (job_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_import_batches_job_status
  ON public.import_batches (job_id, status, batch_number);

-- ------------------------------------------------------------------------------
-- 3. import_staging_rows: Staging buffer preserving raw + normalized payloads
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_staging_rows (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  batch_number INTEGER,
  row_number INTEGER NOT NULL CHECK (row_number >= 1),
  wo_number TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
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
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_row_errors_job_row
  ON public.import_row_errors (job_id, row_number);

-- ------------------------------------------------------------------------------
-- 5. import_history: Permanent summary ledger for completed/cancelled jobs
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_history (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  import_name TEXT,
  source_file TEXT,
  imported_by TEXT NOT NULL,
  imported_by_id TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_history_created
  ON public.import_history (created_at DESC);

-- ------------------------------------------------------------------------------
-- 6. Row Level Security (RLS)
--    Trusted backend uses service_role; direct authenticated access is strictly
--    limited to active super_admin (or authorized dispatch with import_data).
-- ------------------------------------------------------------------------------
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_staging_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_row_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

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
CREATE POLICY import_history_service_all ON public.import_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS import_jobs_superadmin_all ON public.import_jobs;
CREATE POLICY import_jobs_superadmin_all ON public.import_jobs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS import_batches_superadmin_all ON public.import_batches;
CREATE POLICY import_batches_superadmin_all ON public.import_batches
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS import_staging_rows_superadmin_all ON public.import_staging_rows;
CREATE POLICY import_staging_rows_superadmin_all ON public.import_staging_rows
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS import_row_errors_superadmin_all ON public.import_row_errors;
CREATE POLICY import_row_errors_superadmin_all ON public.import_row_errors
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS import_history_superadmin_all ON public.import_history;
CREATE POLICY import_history_superadmin_all ON public.import_history
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND COALESCE(u.active, true) = true
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );

COMMIT;

-- ==============================================================================
-- NON-DESTRUCTIVE ROLLBACK REFERENCE (Manual DBA use only if reverting Phase 020)
-- ==============================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.import_history;
-- DROP TABLE IF EXISTS public.import_row_errors;
-- DROP TABLE IF EXISTS public.import_staging_rows;
-- DROP TABLE IF EXISTS public.import_batches;
-- DROP TABLE IF EXISTS public.import_jobs;
-- COMMIT;
