-- ==============================================================================
-- MORAJAWS WO LIFECYCLE & WORKFLOW OVERHAUL - SQL MIGRATION (REVIEW-ONLY)
-- File: migrations/012_wo_lifecycle_overhaul.sql
--
-- KEBIJAKAN KESELAMATAN:
-- 1. Backward-compatible & idempotent (ADD COLUMN IF NOT EXISTS, CREATE IF NOT EXISTS).
-- 2. TIDAK melakukan operasi destruktif (DROP TABLE / DROP COLUMN / TRUNCATE / DELETE).
-- 3. TIDAK mengubah 3 record WO produksi yang dilindungi oleh trigger
--    `trg_protect_legacy_wo_mutation`.
-- 4. Siap direview sebelum diterapkan ke environment staging atau production.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Ekstensi Kolom Lifecycle pada public.work_orders
-- ------------------------------------------------------------------------------
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS distributed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS distributed_by TEXT,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_by_id TEXT,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by_id TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS report_status_label TEXT,
  ADD COLUMN IF NOT EXISTS reason_report_label TEXT,
  ADD COLUMN IF NOT EXISTS rootcause_label TEXT,
  ADD COLUMN IF NOT EXISTS closed_by_id TEXT,
  ADD COLUMN IF NOT EXISTS check_out_at TIMESTAMPTZ;

-- ------------------------------------------------------------------------------
-- 2. Tabel Append-Only: public.wo_progress_report_history
--    Menyimpan seluruh histori pengiriman Report Status Pembaruan
--    (PENDING, COMPLETE, RESCHEDULE, CANCEL) serta keputusan Dispatch
--    (WAITING APPROVAL -> APPROVED / REVISION / REJECTED) secara kronologis.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wo_progress_report_history (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  wo_number TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'REPORT_SUBMITTED'
    CHECK (event_type IN ('REPORT_SUBMITTED', 'DISPATCH_APPROVED', 'DISPATCH_REVISION_REQUESTED')),
  version_number INTEGER NOT NULL DEFAULT 1,
  contractor_id TEXT,
  contractor_name TEXT,
  area TEXT,
  leader_name TEXT,
  installer_id TEXT,
  installer_name TEXT,
  report_status TEXT NOT NULL
    CHECK (report_status IN ('PENDING', 'COMPLETE', 'RESCHEDULE', 'CANCEL')),
  reason_report TEXT,
  rootcause TEXT,
  remarks TEXT,
  report_submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_submitted_by TEXT NOT NULL,
  report_submitted_by_id TEXT,
  approval_status TEXT NOT NULL DEFAULT 'WAITING APPROVAL',
  approval_decision_at TIMESTAMPTZ,
  dispatch_approver_id TEXT,
  dispatch_approver_name TEXT,
  approval_notes TEXT,
  revision_reason TEXT,
  final_wo_status TEXT NOT NULL DEFAULT 'In Progress',
  is_check_out_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 3. Tabel Append-Only: public.wo_distribution_logs
--    Mencatat waktu distribusi otomatis, Leader penerima, atau antrean
--    unmapped (Belum Terdistribusi) untuk alert Dispatch / Super Admin.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wo_distribution_logs (
  id TEXT PRIMARY KEY,
  ticket_id TEXT REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  wo_number TEXT NOT NULL,
  import_batch_id TEXT,
  contractor_id TEXT,
  contractor_name TEXT,
  area TEXT,
  leader_id TEXT,
  leader_name TEXT,
  distribution_status TEXT NOT NULL,
  distribution_notes TEXT,
  distributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  distributed_by TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 4. Fungsi & Trigger Immutability (Append-Only Audit Guarantee)
--    Mencegah UPDATE maupun DELETE pada catatan historis laporan dan distribusi.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_append_only_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Tabel historis % bersifat append-only dan tidak boleh diubah atau dihapus.', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_wo_progress_report_history ON public.wo_progress_report_history;
CREATE TRIGGER trg_immutable_wo_progress_report_history
  BEFORE UPDATE OR DELETE ON public.wo_progress_report_history
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_append_only_history_mutation();

DROP TRIGGER IF EXISTS trg_immutable_wo_distribution_logs ON public.wo_distribution_logs;
CREATE TRIGGER trg_immutable_wo_distribution_logs
  BEFORE UPDATE OR DELETE ON public.wo_distribution_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_append_only_history_mutation();

-- ------------------------------------------------------------------------------
-- 5. Indeks Performa untuk Query KPI WIB, Vendor/Area, dan History
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wo_kpi_date_contractor_area
  ON public.work_orders (appointment_date, contractor_id, area)
  WHERE is_deleted = FALSE AND is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_wo_kpi_approval_status
  ON public.work_orders (approval_status, status_wo_agent, appointment_date)
  WHERE is_deleted = FALSE AND is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_wo_kpi_distribution_status
  ON public.work_orders (distribution_status, appointment_date)
  WHERE is_deleted = FALSE AND is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_wo_progress_history_ticket
  ON public.wo_progress_report_history (ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_progress_history_wo_time
  ON public.wo_progress_report_history (wo_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_progress_history_approval
  ON public.wo_progress_report_history (approval_status, contractor_name, area, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_dist_logs_batch
  ON public.wo_distribution_logs (import_batch_id, distribution_status, distributed_at DESC);

-- ------------------------------------------------------------------------------
-- 6. Row Level Security (RLS) untuk Tabel Baru
--    Mendukung 6 role MoraJaws + service_role proxy Express.
-- ------------------------------------------------------------------------------
ALTER TABLE public.wo_progress_report_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_distribution_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wo_progress_history_service_all ON public.wo_progress_report_history;
CREATE POLICY wo_progress_history_service_all
  ON public.wo_progress_report_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS wo_progress_history_authenticated_select ON public.wo_progress_report_history;
CREATE POLICY wo_progress_history_authenticated_select
  ON public.wo_progress_report_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND u.active = TRUE
        AND u.is_deleted = FALSE
        AND (
          u.role IN ('super_admin', 'dispatch', 'management_data', 'it_support')
          OR (
            u.role = 'leader'
            AND (u.contractor_id IS NULL OR u.contractor_id = wo_progress_report_history.contractor_id OR lower(coalesce(u.contractor, '')) = lower(coalesce(wo_progress_report_history.contractor_name, '')))
            AND (u.area IS NULL OR u.area = '' OR lower(u.area) = lower(coalesce(wo_progress_report_history.area, '')))
          )
          OR (
            u.role = 'installer'
            AND (wo_progress_report_history.installer_id = u.id OR lower(coalesce(wo_progress_report_history.installer_name, '')) = lower(u.name))
          )
        )
    )
  );

DROP POLICY IF EXISTS wo_progress_history_authenticated_insert ON public.wo_progress_report_history;
CREATE POLICY wo_progress_history_authenticated_insert
  ON public.wo_progress_report_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND u.active = TRUE
        AND u.is_deleted = FALSE
        AND u.role IN ('super_admin', 'dispatch', 'installer')
    )
  );

DROP POLICY IF EXISTS wo_distribution_logs_service_all ON public.wo_distribution_logs;
CREATE POLICY wo_distribution_logs_service_all
  ON public.wo_distribution_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS wo_distribution_logs_authenticated_select ON public.wo_distribution_logs;
CREATE POLICY wo_distribution_logs_authenticated_select
  ON public.wo_distribution_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
        AND u.active = TRUE
        AND u.is_deleted = FALSE
        AND (
          u.role IN ('super_admin', 'dispatch', 'management_data', 'it_support')
          OR (
            u.role = 'leader'
            AND (wo_distribution_logs.leader_id IS NULL OR wo_distribution_logs.leader_id = u.id OR lower(coalesce(wo_distribution_logs.leader_name, '')) = lower(u.name))
          )
        )
    )
  );

COMMIT;

-- ==============================================================================
-- ROLLBACK PLAN (Hanya dijalankan manual jika diperlukan oleh DBA)
-- ==============================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_immutable_wo_distribution_logs ON public.wo_distribution_logs;
-- DROP TRIGGER IF EXISTS trg_immutable_wo_progress_report_history ON public.wo_progress_report_history;
-- DROP FUNCTION IF EXISTS public.prevent_append_only_history_mutation();
-- DROP TABLE IF EXISTS public.wo_distribution_logs;
-- DROP TABLE IF EXISTS public.wo_progress_report_history;
-- DROP INDEX IF EXISTS idx_wo_kpi_date_contractor_area;
-- DROP INDEX IF EXISTS idx_wo_kpi_approval_status;
-- DROP INDEX IF EXISTS idx_wo_kpi_distribution_status;
-- ALTER TABLE public.work_orders
--   DROP COLUMN IF EXISTS distributed_at,
--   DROP COLUMN IF EXISTS distributed_by,
--   DROP COLUMN IF EXISTS approval_status,
--   DROP COLUMN IF EXISTS approved_at,
--   DROP COLUMN IF EXISTS approved_by,
--   DROP COLUMN IF EXISTS approved_by_id,
--   DROP COLUMN IF EXISTS approval_notes,
--   DROP COLUMN IF EXISTS rejected_at,
--   DROP COLUMN IF EXISTS rejected_by,
--   DROP COLUMN IF EXISTS rejected_by_id,
--   DROP COLUMN IF EXISTS rejection_reason,
--   DROP COLUMN IF EXISTS report_status_label,
--   DROP COLUMN IF EXISTS reason_report_label,
--   DROP COLUMN IF EXISTS rootcause_label,
--   DROP COLUMN IF EXISTS closed_by_id,
--   DROP COLUMN IF EXISTS check_out_at;
-- COMMIT;
