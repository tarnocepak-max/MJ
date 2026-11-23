-- ============================================================================
-- Migration 018: Kendala Reports with Photo Evidence & Non-Destructive Workflow Update
-- Target: PostgreSQL / Supabase
-- Note: Preserves all historical root_cause / rootcause_label / technical_report
--       data intact (never drops historical columns or records).
-- ============================================================================

-- 1. Create dedicated table for Installer Kendala Reports linked to WO & Installer
CREATE TABLE IF NOT EXISTS public.wo_kendala_reports (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number TEXT NOT NULL,
  installer_id TEXT NOT NULL,
  installer_name TEXT NOT NULL,
  reason_id TEXT,
  reason_label TEXT,
  description TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  storage_path TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'Pending Technical',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_kendala_reports_ticket_id
  ON public.wo_kendala_reports (ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_kendala_reports_wo_number
  ON public.wo_kendala_reports (wo_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_kendala_reports_installer_id
  ON public.wo_kendala_reports (installer_id, created_at DESC);

-- 2. Additive JSONB column on work_orders (non-destructive)
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS kendala_reports JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Enable RLS and configure access policies for Superadmin, Dispatch, Leader & Installer
ALTER TABLE public.wo_kendala_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kendala_reports_read_scoped" ON public.wo_kendala_reports;
CREATE POLICY "kendala_reports_read_scoped"
  ON public.wo_kendala_reports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND (
          u.role IN ('super_admin', 'dispatch')
          OR (u.role = 'installer' AND u.id = wo_kendala_reports.installer_id)
          OR (
            u.role = 'leader'
            AND EXISTS (
              SELECT 1 FROM public.work_orders wo
              WHERE wo.id = wo_kendala_reports.ticket_id
                AND COALESCE(LOWER(TRIM(wo.contractor_name)), COALESCE(LOWER(TRIM(wo.contactor_name)), ''))
                    LIKE '%' || COALESCE(LOWER(TRIM(u.contractor)), '') || '%'
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "kendala_reports_insert_installer" ON public.wo_kendala_reports;
CREATE POLICY "kendala_reports_insert_installer"
  ON public.wo_kendala_reports
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND (
          u.role IN ('super_admin', 'dispatch')
          OR (u.role = 'installer' AND u.id = wo_kendala_reports.installer_id)
        )
    )
  );
