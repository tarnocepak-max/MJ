-- ==============================================================================
-- MORAJAWS MIGRATION 022: Centralized Database Deletion Management & Audit Ledger
-- ==============================================================================
-- Tujuan:
-- 1. Menyediakan tabel audit penghapusan permanen & append-only (`public.deletion_logs`)
--    dengan trigger immutability serta RLS deny-by-default.
-- 2. Memastikan soft-delete tracking columns tersedia secara non-destruktif
--    untuk seluruh kategori penghapusan terpusat.
-- 3. Menyediakan RPC transaksional (`SECURITY DEFINER`, service_role only):
--    - `morajaws_get_wo_dependencies(p_wo_id)`
--    - `morajaws_soft_delete_wo_tx(...)`
--    - `morajaws_permanent_delete_wo_tx(...)`
--    - `morajaws_restore_wo_tx(...)`
-- 4. KEBIJAKAN KEAMANAN MUTLAK:
--    - TIDAK menghapus atau mengubah data produksi existing.
--    - TIDAK menggunakan penghapusan berantai otomatis antar relasi histori.
--    - Menolak Permanent Delete jika terdapat relasi histori RESTRICT
--      (`assignment_history`, `ticket_messages`, `technical_reports`, `attachments`,
--       `wo_progress_report_history`, `wo_distribution_logs`) atau proses impor aktif.
--    - Audit log (`deletion_logs`) bersifat immutable dan tidak menyimpan kredensial/token.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Non-destructive soft-delete metadata columns across centralized categories
-- ------------------------------------------------------------------------------
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.assignment_history
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.technical_reports
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.import_history
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.coverage_areas
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE public.wa_templates
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- Partial index for active/deleted WO lookup & restore consistency
CREATE INDEX IF NOT EXISTS idx_work_orders_is_deleted_at
  ON public.work_orders (deleted_at DESC NULLS LAST, id)
  WHERE COALESCE(is_deleted, FALSE) = TRUE;

-- ------------------------------------------------------------------------------
-- 2. Immutable Deletion Logs Table (`public.deletion_logs`)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deletion_logs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  deletion_type TEXT NOT NULL
    CHECK (deletion_type IN ('soft_delete', 'permanent_delete', 'restore')),
  category TEXT NOT NULL,
  source_table TEXT NOT NULL,
  record_id TEXT NOT NULL,
  wo_number TEXT,
  actor_user_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  reason TEXT,
  related_counts JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(related_counts) = 'object'),
  status TEXT NOT NULL
    CHECK (status IN ('success', 'failed', 'rejected')),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_logs_created_at
  ON public.deletion_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deletion_logs_cat_type
  ON public.deletion_logs (category, deletion_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deletion_logs_wo_number
  ON public.deletion_logs (wo_number)
  WHERE wo_number IS NOT NULL AND btrim(wo_number) <> '';

CREATE INDEX IF NOT EXISTS idx_deletion_logs_actor
  ON public.deletion_logs (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deletion_logs_tx
  ON public.deletion_logs (transaction_id);

-- Append-only immutability trigger (never allow UPDATE or DELETE on deletion_logs)
CREATE OR REPLACE FUNCTION public.morajaws_reject_deletion_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'DELETION_LOG_IMMUTABLE: Log penghapusan bersifat permanen dan tidak boleh diubah atau dihapus.';
END;
$$;

DROP TRIGGER IF EXISTS trg_deletion_logs_immutable ON public.deletion_logs;
CREATE TRIGGER trg_deletion_logs_immutable
  BEFORE UPDATE OR DELETE ON public.deletion_logs
  FOR EACH ROW EXECUTE FUNCTION public.morajaws_reject_deletion_log_mutation();

ALTER TABLE public.deletion_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deletion_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.deletion_logs TO service_role;

DROP POLICY IF EXISTS p_deletion_logs_service_role_all ON public.deletion_logs;
CREATE POLICY p_deletion_logs_service_role_all
  ON public.deletion_logs
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- ------------------------------------------------------------------------------
-- 3. Pre-deletion Dependency & Import Lock Inspector RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.morajaws_get_wo_dependencies(p_wo_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_wo public.work_orders%ROWTYPE;
  v_canon_wo TEXT;
  v_assign_cnt INTEGER := 0;
  v_msg_cnt INTEGER := 0;
  v_report_cnt INTEGER := 0;
  v_attach_cnt INTEGER := 0;
  v_prog_cnt INTEGER := 0;
  v_dist_cnt INTEGER := 0;
  v_kendala_cnt INTEGER := 0;
  v_photo_cnt INTEGER := 0;
  v_active_import_cnt INTEGER := 0;
  v_blocking_total INTEGER := 0;
  v_reasons JSONB := '[]'::jsonb;
  v_is_protected BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_wo
  FROM public.work_orders
  WHERE id = btrim(COALESCE(p_wo_id, ''))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', FALSE,
      'errorCode', 'NOT_FOUND',
      'errorMessage', format('Work Order "%s" tidak ditemukan.', COALESCE(p_wo_id, ''))
    );
  END IF;

  v_canon_wo := lower(regexp_replace(btrim(COALESCE(v_wo.wo_number, '')), '\s+', '', 'g'));

  v_is_protected := v_wo.id IN (
    'wo_1793825457141_u4bnht',
    'wo_imp_1793825458959_4i4f1h',
    'wo_imp_1793825458959_262dei'
  ) OR upper(COALESCE(v_wo.wo_number, '')) IN (
    'WO-EXPRESS-TEST-1793825456810',
    'WO-DUP-TEST-1793825458804',
    'WO-DUP-TEST-1793825458804-UNIQUE'
  );

  SELECT COUNT(*)::INTEGER INTO v_assign_cnt
  FROM public.assignment_history
  WHERE work_order_id = v_wo.id
     OR ticket_id = v_wo.id
     OR (v_canon_wo <> '' AND lower(regexp_replace(btrim(COALESCE(wo_number, '')), '\s+', '', 'g')) = v_canon_wo);

  SELECT COUNT(*)::INTEGER INTO v_msg_cnt
  FROM public.ticket_messages
  WHERE ticket_id = v_wo.id
     OR (v_canon_wo <> '' AND lower(regexp_replace(btrim(COALESCE(wo_number, '')), '\s+', '', 'g')) = v_canon_wo);

  SELECT COUNT(*)::INTEGER INTO v_report_cnt
  FROM public.technical_reports
  WHERE work_order_id = v_wo.id
     OR ticket_id = v_wo.id;

  SELECT COUNT(*)::INTEGER INTO v_attach_cnt
  FROM public.attachments
  WHERE work_order_id = v_wo.id
     OR ticket_id = v_wo.id
     OR (v_canon_wo <> '' AND lower(regexp_replace(btrim(COALESCE(wo_number, '')), '\s+', '', 'g')) = v_canon_wo);

  IF to_regclass('public.wo_progress_report_history') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*)::INTEGER FROM public.wo_progress_report_history WHERE ticket_id = $1'
      INTO v_prog_cnt USING v_wo.id;
  END IF;

  IF to_regclass('public.wo_distribution_logs') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*)::INTEGER FROM public.wo_distribution_logs WHERE ticket_id = $1'
      INTO v_dist_cnt USING v_wo.id;
  END IF;

  IF to_regclass('public.wo_kendala_reports') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*)::INTEGER FROM public.wo_kendala_reports WHERE ticket_id = $1'
      INTO v_kendala_cnt USING v_wo.id;
  END IF;

  IF to_regclass('public.wo_photo_evidence') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*)::INTEGER FROM public.wo_photo_evidence WHERE ticket_id = $1'
      INTO v_photo_cnt USING v_wo.id;
  END IF;

  IF to_regclass('public.import_jobs') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_active_import_cnt
    FROM public.import_jobs j
    WHERE j.status IN ('staging', 'queued', 'processing')
      AND (
        (COALESCE(v_wo.import_batch_id, '') <> '' AND (v_wo.import_batch_id = j.id OR v_wo.import_batch_id LIKE j.id || '_b%'))
        OR EXISTS (
          SELECT 1
          FROM public.import_staging_rows sr
          WHERE sr.job_id = j.id
            AND v_canon_wo <> ''
            AND lower(regexp_replace(btrim(COALESCE(sr.wo_number, '')), '\s+', '', 'g')) = v_canon_wo
        )
      );
  END IF;

  IF v_is_protected THEN
    v_reasons := v_reasons || jsonb_build_array('Record WO produksi historis dilindungi secara mutlak.');
  END IF;
  IF v_active_import_cnt > 0 THEN
    v_reasons := v_reasons || jsonb_build_array('WO terkait dengan proses import batch yang sedang aktif berjalan.');
  END IF;
  IF v_assign_cnt > 0 THEN
    v_reasons := v_reasons || jsonb_build_array(format('%s record assignment_history (FK RESTRICT) masih terhubung.', v_assign_cnt));
  END IF;
  IF v_msg_cnt > 0 THEN
    v_reasons := v_reasons || jsonb_build_array(format('%s pesan LiveChat / ticket_messages (FK RESTRICT) masih terhubung.', v_msg_cnt));
  END IF;
  IF v_report_cnt > 0 THEN
    v_reasons := v_reasons || jsonb_build_array(format('%s laporan technical_reports (FK RESTRICT) masih terhubung.', v_report_cnt));
  END IF;
  IF v_attach_cnt > 0 THEN
    v_reasons := v_reasons || jsonb_build_array(format('%s lampiran attachments (FK RESTRICT) masih terhubung.', v_attach_cnt));
  END IF;
  IF v_prog_cnt > 0 THEN
    v_reasons := v_reasons || jsonb_build_array(format('%s log immutable wo_progress_report_history masih terhubung.', v_prog_cnt));
  END IF;
  IF v_dist_cnt > 0 THEN
    v_reasons := v_reasons || jsonb_build_array(format('%s log immutable wo_distribution_logs masih terhubung.', v_dist_cnt));
  END IF;
  IF v_kendala_cnt > 0 OR v_photo_cnt > 0 THEN
    v_reasons := v_reasons || jsonb_build_array(format('%s bukti lapangan / kendala masih terhubung.', v_kendala_cnt + v_photo_cnt));
  END IF;

  v_blocking_total := v_assign_cnt + v_msg_cnt + v_report_cnt + v_attach_cnt + v_prog_cnt + v_dist_cnt + v_kendala_cnt + v_photo_cnt;

  RETURN jsonb_build_object(
    'found', TRUE,
    'id', v_wo.id,
    'woNumber', v_wo.wo_number,
    'customerName', v_wo.customer_name,
    'isDeleted', COALESCE(v_wo.is_deleted, FALSE),
    'isArchived', COALESCE(v_wo.is_archived, FALSE),
    'isProtected', v_is_protected,
    'activeImportLock', (v_active_import_cnt > 0),
    'counts', jsonb_build_object(
      'assignment_history', v_assign_cnt,
      'ticket_messages', v_msg_cnt,
      'technical_reports', v_report_cnt,
      'attachments', v_attach_cnt,
      'wo_progress_report_history', v_prog_cnt,
      'wo_distribution_logs', v_dist_cnt,
      'wo_kendala_reports', v_kendala_cnt,
      'wo_photo_evidence', v_photo_cnt
    ),
    'blockingTotal', v_blocking_total,
    'canSoftDelete', (NOT v_is_protected AND v_active_import_cnt = 0 AND NOT COALESCE(v_wo.is_deleted, FALSE)),
    'canPermanentDelete', (NOT v_is_protected AND v_active_import_cnt = 0 AND v_blocking_total = 0),
    'blockingReasons', v_reasons
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Transactional Soft Delete WO RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.morajaws_soft_delete_wo_tx(
  p_wo_id TEXT,
  p_reason TEXT,
  p_actor_id TEXT,
  p_actor_name TEXT,
  p_actor_role TEXT,
  p_transaction_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_wo public.work_orders%ROWTYPE;
  v_deps JSONB;
  v_tx_id TEXT := COALESCE(NULLIF(btrim(p_transaction_id), ''), 'tx_sd_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16));
  v_log_id TEXT := 'dellog_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18);
  v_clean_reason TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
  IF length(v_clean_reason) < 5 THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'INVALID_REASON', 'message', 'Alasan penghapusan wajib minimal 5 karakter.');
  END IF;

  BEGIN
    SELECT * INTO v_wo
    FROM public.work_orders
    WHERE id = btrim(COALESCE(p_wo_id, ''))
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('success', FALSE, 'code', 'CONCURRENT_DELETION_LOCKED', 'message', 'Work Order sedang diproses penghapusan oleh transaksi lain.');
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'NOT_FOUND', 'message', format('Work Order "%s" tidak ditemukan.', COALESCE(p_wo_id, '')));
  END IF;

  v_deps := public.morajaws_get_wo_dependencies(v_wo.id);

  IF COALESCE((v_deps->>'isProtected')::boolean, FALSE) THEN
    INSERT INTO public.deletion_logs (
      id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
      actor_user_id, actor_name, actor_role, reason, related_counts, status, error_message, created_at
    ) VALUES (
      v_log_id, v_tx_id, 'soft_delete', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
      p_actor_id, p_actor_name, p_actor_role, v_clean_reason, COALESCE(v_deps->'counts', '{}'::jsonb),
      'rejected', 'PROTECTED_RECORD: Record WO produksi dilindungi.', v_now
    );
    RETURN jsonb_build_object('success', FALSE, 'code', 'PROTECTED_RECORD', 'message', 'Record WO produksi dilindungi secara mutlak.');
  END IF;

  IF COALESCE((v_deps->>'activeImportLock')::boolean, FALSE) THEN
    INSERT INTO public.deletion_logs (
      id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
      actor_user_id, actor_name, actor_role, reason, related_counts, status, error_message, created_at
    ) VALUES (
      v_log_id, v_tx_id, 'soft_delete', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
      p_actor_id, p_actor_name, p_actor_role, v_clean_reason, COALESCE(v_deps->'counts', '{}'::jsonb),
      'rejected', 'ACTIVE_IMPORT_IN_PROGRESS: Impor WO masih aktif berjalan.', v_now
    );
    RETURN jsonb_build_object('success', FALSE, 'code', 'ACTIVE_IMPORT_IN_PROGRESS', 'message', 'Tidak dapat menghapus WO saat proses import batch terkait masih berjalan.');
  END IF;

  IF COALESCE(v_wo.is_deleted, FALSE) THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'ALREADY_SOFT_DELETED', 'message', format('WO %s sudah berstatus soft delete.', v_wo.wo_number));
  END IF;

  UPDATE public.work_orders
  SET
    is_deleted = TRUE,
    deleted_at = v_now,
    deleted_by = p_actor_name,
    deletion_reason = v_clean_reason,
    updated_at = v_now,
    updated_by = p_actor_name
  WHERE id = v_wo.id
  RETURNING * INTO v_wo;

  INSERT INTO public.deletion_logs (
    id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
    actor_user_id, actor_name, actor_role, reason, related_counts, status, created_at
  ) VALUES (
    v_log_id, v_tx_id, 'soft_delete', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
    p_actor_id, p_actor_name, p_actor_role, v_clean_reason, COALESCE(v_deps->'counts', '{}'::jsonb),
    'success', v_now
  );

  INSERT INTO public.audit_logs (
    id, action, entity, entity_id, details, performed_by_id, performed_by, user_role, metadata, event_at
  ) VALUES (
    'aud_sd_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
    'WO Soft Deleted (Centralized)',
    'work_order',
    v_wo.id,
    format('WO %s ditandai terhapus (soft delete) oleh %s (%s). Alasan: %s', v_wo.wo_number, p_actor_name, p_actor_role, v_clean_reason),
    p_actor_id,
    p_actor_name,
    p_actor_role,
    jsonb_build_object('transactionId', v_tx_id, 'deletionType', 'soft_delete', 'woNumber', v_wo.wo_number),
    v_now
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'transactionId', v_tx_id,
    'deletionLogId', v_log_id,
    'workOrder', to_jsonb(v_wo),
    'relatedCounts', COALESCE(v_deps->'counts', '{}'::jsonb)
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Transactional Permanent Delete WO RPC (Superadmin Only, Zero Cascade)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.morajaws_permanent_delete_wo_tx(
  p_wo_id TEXT,
  p_confirm_wo_number TEXT,
  p_reason TEXT,
  p_actor_id TEXT,
  p_actor_name TEXT,
  p_actor_role TEXT,
  p_transaction_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_wo public.work_orders%ROWTYPE;
  v_deps JSONB;
  v_tx_id TEXT := COALESCE(NULLIF(btrim(p_transaction_id), ''), 'tx_pd_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16));
  v_log_id TEXT := 'dellog_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18);
  v_clean_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_norm_confirm TEXT := upper(regexp_replace(btrim(COALESCE(p_confirm_wo_number, '')), '\s+', '', 'g'));
  v_norm_actual TEXT;
  v_block_msg TEXT;
BEGIN
  IF p_actor_role IS DISTINCT FROM 'super_admin' THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'FORBIDDEN_ROLE', 'message', 'Hapus permanen hanya diperbolehkan untuk role Superadmin.');
  END IF;

  IF length(v_clean_reason) < 5 THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'INVALID_REASON', 'message', 'Alasan penghapusan permanen wajib minimal 5 karakter.');
  END IF;

  BEGIN
    SELECT * INTO v_wo
    FROM public.work_orders
    WHERE id = btrim(COALESCE(p_wo_id, ''))
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('success', FALSE, 'code', 'CONCURRENT_DELETION_LOCKED', 'message', 'Work Order sedang dikunci oleh transaksi penghapusan lain.');
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'NOT_FOUND', 'message', format('Work Order "%s" tidak ditemukan.', COALESCE(p_wo_id, '')));
  END IF;

  v_norm_actual := upper(regexp_replace(btrim(COALESCE(v_wo.wo_number, '')), '\s+', '', 'g'));
  IF v_norm_confirm = '' OR v_norm_confirm IS DISTINCT FROM v_norm_actual THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'CONFIRMATION_MISMATCH', 'message', format('Konfirmasi WO Number tidak cocok. Ketik persis "%s".', v_wo.wo_number));
  END IF;

  v_deps := public.morajaws_get_wo_dependencies(v_wo.id);

  IF COALESCE((v_deps->>'isProtected')::boolean, FALSE) THEN
    INSERT INTO public.deletion_logs (
      id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
      actor_user_id, actor_name, actor_role, reason, related_counts, status, error_message, created_at
    ) VALUES (
      v_log_id, v_tx_id, 'permanent_delete', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
      p_actor_id, p_actor_name, p_actor_role, v_clean_reason, COALESCE(v_deps->'counts', '{}'::jsonb),
      'rejected', 'PROTECTED_RECORD: Record WO produksi dilindungi.', v_now
    );
    RETURN jsonb_build_object('success', FALSE, 'code', 'PROTECTED_RECORD', 'message', 'Record WO produksi dilindungi secara mutlak dan tidak dapat dihapus permanen.');
  END IF;

  IF COALESCE((v_deps->>'activeImportLock')::boolean, FALSE) THEN
    INSERT INTO public.deletion_logs (
      id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
      actor_user_id, actor_name, actor_role, reason, related_counts, status, error_message, created_at
    ) VALUES (
      v_log_id, v_tx_id, 'permanent_delete', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
      p_actor_id, p_actor_name, p_actor_role, v_clean_reason, COALESCE(v_deps->'counts', '{}'::jsonb),
      'rejected', 'ACTIVE_IMPORT_IN_PROGRESS: Impor WO masih aktif berjalan.', v_now
    );
    RETURN jsonb_build_object('success', FALSE, 'code', 'ACTIVE_IMPORT_IN_PROGRESS', 'message', 'Tidak dapat menghapus permanen saat proses import batch terkait masih aktif.');
  END IF;

  IF COALESCE((v_deps->>'blockingTotal')::integer, 0) > 0 THEN
    SELECT string_agg(elem, '; ') INTO v_block_msg
    FROM jsonb_array_elements_text(COALESCE(v_deps->'blockingReasons', '[]'::jsonb)) AS elem;

    v_block_msg := format(
      'Hapus permanen DITOLAK untuk menjaga integritas data historis (%s). Gunakan Soft Delete agar assignment_history, ticket_messages, technical_reports, dan attachments tetap aman.',
      COALESCE(v_block_msg, 'relasi historis masih terhubung')
    );

    INSERT INTO public.deletion_logs (
      id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
      actor_user_id, actor_name, actor_role, reason, related_counts, status, error_message, created_at
    ) VALUES (
      v_log_id, v_tx_id, 'permanent_delete', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
      p_actor_id, p_actor_name, p_actor_role, v_clean_reason, COALESCE(v_deps->'counts', '{}'::jsonb),
      'rejected', v_block_msg, v_now
    );

    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'HAS_BLOCKING_RELATIONS',
      'message', v_block_msg,
      'relatedCounts', COALESCE(v_deps->'counts', '{}'::jsonb),
      'blockingReasons', COALESCE(v_deps->'blockingReasons', '[]'::jsonb)
    );
  END IF;

  DELETE FROM public.work_orders WHERE id = v_wo.id;

  INSERT INTO public.deletion_logs (
    id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
    actor_user_id, actor_name, actor_role, reason, related_counts, status, created_at
  ) VALUES (
    v_log_id, v_tx_id, 'permanent_delete', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
    p_actor_id, p_actor_name, p_actor_role, v_clean_reason, COALESCE(v_deps->'counts', '{}'::jsonb),
    'success', v_now
  );

  INSERT INTO public.audit_logs (
    id, action, entity, entity_id, details, performed_by_id, performed_by, user_role, metadata, event_at
  ) VALUES (
    'aud_pd_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
    'WO Permanently Deleted (Centralized)',
    'work_order',
    v_wo.id,
    format('WO %s (tanpa relasi historis) dihapus permanen oleh Superadmin %s. Alasan: %s', v_wo.wo_number, p_actor_name, v_clean_reason),
    p_actor_id,
    p_actor_name,
    p_actor_role,
    jsonb_build_object('transactionId', v_tx_id, 'deletionType', 'permanent_delete', 'woNumber', v_wo.wo_number),
    v_now
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'transactionId', v_tx_id,
    'deletionLogId', v_log_id,
    'deletedId', v_wo.id,
    'woNumber', v_wo.wo_number,
    'relatedCounts', COALESCE(v_deps->'counts', '{}'::jsonb)
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. Transactional Restore WO RPC (Superadmin Only)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.morajaws_restore_wo_tx(
  p_wo_id TEXT,
  p_reason TEXT,
  p_actor_id TEXT,
  p_actor_name TEXT,
  p_actor_role TEXT,
  p_transaction_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_wo public.work_orders%ROWTYPE;
  v_conflict_id TEXT;
  v_canon_wo TEXT;
  v_tx_id TEXT := COALESCE(NULLIF(btrim(p_transaction_id), ''), 'tx_rs_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16));
  v_log_id TEXT := 'dellog_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18);
  v_clean_reason TEXT := COALESCE(NULLIF(btrim(p_reason), ''), 'Pemulihan Work Order melalui Data Deletion Management');
BEGIN
  IF p_actor_role IS DISTINCT FROM 'super_admin' THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'FORBIDDEN_ROLE', 'message', 'Pemulihan data hanya diperbolehkan untuk role Superadmin.');
  END IF;

  BEGIN
    SELECT * INTO v_wo
    FROM public.work_orders
    WHERE id = btrim(COALESCE(p_wo_id, ''))
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('success', FALSE, 'code', 'CONCURRENT_DELETION_LOCKED', 'message', 'Work Order sedang dikunci oleh transaksi lain.');
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'NOT_FOUND', 'message', format('Work Order "%s" tidak ditemukan.', COALESCE(p_wo_id, '')));
  END IF;

  v_canon_wo := lower(regexp_replace(btrim(COALESCE(v_wo.wo_number, '')), '\s+', '', 'g'));
  IF COALESCE(v_wo.is_deleted, FALSE) AND v_canon_wo <> '' THEN
    SELECT id INTO v_conflict_id
    FROM public.work_orders
    WHERE COALESCE(is_deleted, FALSE) = FALSE
      AND id <> v_wo.id
      AND lower(regexp_replace(btrim(COALESCE(wo_number, '')), '\s+', '', 'g')) = v_canon_wo
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
      INSERT INTO public.deletion_logs (
        id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
        actor_user_id, actor_name, actor_role, reason, status, error_message, created_at
      ) VALUES (
        v_log_id, v_tx_id, 'restore', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
        p_actor_id, p_actor_name, p_actor_role, v_clean_reason, 'rejected',
        format('DUPLICATE_ACTIVE_WO: Sudah ada WO aktif dengan nomor %s (%s).', v_wo.wo_number, v_conflict_id), v_now
      );
      RETURN jsonb_build_object(
        'success', FALSE,
        'code', 'DUPLICATE_ACTIVE_WO',
        'message', format('Tidak dapat memulihkan WO %s karena sudah ada WO aktif dengan nomor yang sama (%s).', v_wo.wo_number, v_conflict_id)
      );
    END IF;
  END IF;

  UPDATE public.work_orders
  SET
    is_deleted = FALSE,
    deleted_at = NULL,
    deleted_by = NULL,
    deletion_reason = NULL,
    is_archived = FALSE,
    archived_at = NULL,
    archived_by = NULL,
    updated_at = v_now,
    updated_by = p_actor_name
  WHERE id = v_wo.id
  RETURNING * INTO v_wo;

  INSERT INTO public.deletion_logs (
    id, transaction_id, deletion_type, category, source_table, record_id, wo_number,
    actor_user_id, actor_name, actor_role, reason, status, created_at
  ) VALUES (
    v_log_id, v_tx_id, 'restore', 'work_orders', 'work_orders', v_wo.id, v_wo.wo_number,
    p_actor_id, p_actor_name, p_actor_role, v_clean_reason, 'success', v_now
  );

  INSERT INTO public.audit_logs (
    id, action, entity, entity_id, details, performed_by_id, performed_by, user_role, metadata, event_at
  ) VALUES (
    'aud_rs_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
    'WO Restored (Centralized)',
    'work_order',
    v_wo.id,
    format('WO %s dipulihkan oleh Superadmin %s. Alasan: %s', v_wo.wo_number, p_actor_name, v_clean_reason),
    p_actor_id,
    p_actor_name,
    p_actor_role,
    jsonb_build_object('transactionId', v_tx_id, 'deletionType', 'restore', 'woNumber', v_wo.wo_number),
    v_now
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'transactionId', v_tx_id,
    'deletionLogId', v_log_id,
    'workOrder', to_jsonb(v_wo)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.morajaws_get_wo_dependencies(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_soft_delete_wo_tx(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_permanent_delete_wo_tx(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_restore_wo_tx(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.morajaws_get_wo_dependencies(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_soft_delete_wo_tx(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_permanent_delete_wo_tx(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_restore_wo_tx(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
