-- =============================================================================
-- MORAJAWS MIGRATION 009: PURE SUPABASE FREE PLAN ALIGNMENT (FORWARD-ONLY)
-- Target Platform: Supabase PostgreSQL + Supabase Storage (Free Plan)
--
-- Purpose:
--   1. Align schema non-destructively after Complete Firebase & Firestore Removal.
--   2. Standardize attachment storage default from 'firebase_storage' to
--      'supabase_storage' (bucket: 'morajaws-reports') for all new records.
--   3. Add missing compatibility columns & indexes used by server/supabaseAdapter.ts,
--      server/customAuthService.ts, and prior index definitions:
--      - public.work_orders: installer_id, installer_uid, assigned_to,
--        assigned_to_uid, chat_category
--      - public.audit_logs: entity_type
--      - public.system_error_logs: backend_error_code, payload
--   4. Mark legacy compatibility columns (users.firebase_uid,
--      system_error_logs.firebase_error_code) as deprecated via COMMENT ON COLUMN
--      WITHOUT dropping columns or deleting any historical rows.
--   5. Reinforce deny-by-default RLS posture (Express Backend Proxy accesses DB
--      via SUPABASE_SERVICE_ROLE_KEY and validates MoraJaws Custom Auth tokens).
--   6. Protect the 3 historical soft-deleted production WO records from mutation:
--      - wo_1793825457141_u4bnht
--      - wo_imp_1793825458959_4i4f1h
--      - wo_imp_1793825458959_262dei
--
-- IMPORTANT SAFETY RULES:
--   - FORWARD-ONLY & IDEMPOTENT (safe to review and apply manually).
--   - ZERO DROP TABLE / DROP COLUMN / TRUNCATE / DELETE statements.
--   - DO NOT execute blindly on Staging/Production without DBA approval.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Attachments Storage Standardization -> Supabase Storage (morajaws-reports)
-- -----------------------------------------------------------------------------
ALTER TABLE public.attachments
  ALTER COLUMN storage_provider SET DEFAULT 'supabase_storage';

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS bucket_name text NOT NULL DEFAULT 'morajaws-reports',
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS file_category text;

CREATE INDEX IF NOT EXISTS idx_attachments_storage_provider
  ON public.attachments (storage_provider);

COMMENT ON COLUMN public.attachments.storage_provider IS
  'Default: supabase_storage (bucket: morajaws-reports). Historical external rows may still carry legacy values for read compatibility.';

-- -----------------------------------------------------------------------------
-- 2. Work Orders Relational Column Alignment (with supabaseAdapter.ts & 006_phase16a)
-- -----------------------------------------------------------------------------
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS installer_id text,
  ADD COLUMN IF NOT EXISTS installer_uid text,
  ADD COLUMN IF NOT EXISTS assigned_to text,
  ADD COLUMN IF NOT EXISTS assigned_to_uid text,
  ADD COLUMN IF NOT EXISTS chat_category text;

CREATE INDEX IF NOT EXISTS idx_work_orders_installer_id
  ON public.work_orders (installer_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_work_orders_chat_category
  ON public.work_orders (chat_category)
  WHERE is_deleted = false AND chat_category IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Audit Logs & System Error Logs Compatibility Alignment
-- -----------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS entity_type text;

ALTER TABLE public.system_error_logs
  ADD COLUMN IF NOT EXISTS backend_error_code text,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_system_error_logs_backend_code
  ON public.system_error_logs (backend_error_code)
  WHERE backend_error_code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Forward-Only Legacy Column Deprecation Comments (No Destructive Drops)
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.users IS
  'MoraJaws Custom Authentication user store backed by Supabase PostgreSQL (bcrypt + session_version). Zero Firebase Auth or Supabase Auth dependency.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'firebase_uid'
  ) THEN
    COMMENT ON COLUMN public.users.firebase_uid IS
      'DEPRECATED (Pure Supabase Migration): Retained read-only for legacy archive traceability. Unused by Custom Auth.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'system_error_logs' AND column_name = 'firebase_error_code'
  ) THEN
    COMMENT ON COLUMN public.system_error_logs.firebase_error_code IS
      'DEPRECATED (Pure Supabase Migration): Retained for historical rows. New errors use backend_error_code.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Enforce Protected Legacy WO Mutation Guard (Idempotent)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_protect_legacy_soft_deleted_wo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.id IN (
    'wo_1793825457141_u4bnht',
    'wo_imp_1793825458959_4i4f1h',
    'wo_imp_1793825458959_262dei'
  ) OR OLD.wo_number IN (
    'WO-EXPRESS-TEST-1793825456810',
    'WO-DUP-TEST-1793825458804',
    'WO-DUP-TEST-1793825458804-UNIQUE'
  ) THEN
    RAISE EXCEPTION 'PROTECTED_RECORD_MUTATION_FORBIDDEN: Tiga WO produksi historis dilindungi secara mutlak dan tidak boleh dimutasi atau dihapus.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_legacy_wo_mutation ON public.work_orders;
CREATE TRIGGER trg_protect_legacy_wo_mutation
BEFORE UPDATE OR DELETE ON public.work_orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_protect_legacy_soft_deleted_wo();

-- -----------------------------------------------------------------------------
-- 6. Express Backend Proxy RLS & Service Role Posture
-- Note:
--   MoraJaws does NOT authenticate end-users via Supabase Auth (auth.uid()).
--   All client HTTP calls terminate at the Express Backend Proxy (server.ts),
--   which verifies MoraJaws Custom Auth tokens (session_version + role + scope)
--   and queries Supabase PostgreSQL using SUPABASE_SERVICE_ROLE_KEY.
--   Therefore, direct anon/authenticated access remains deny-by-default.
-- -----------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- -----------------------------------------------------------------------------
-- 7. Supabase Storage Bucket Provisioning Reference (Manual / Dashboard Check)
-- Bucket name : morajaws-reports
-- Visibility  : Private (accessed strictly via Backend Proxy Signed URLs)
-- Free Plan   : 1 GB storage quota; 5 MB image / 10 MB document caps enforced in
--               server/supabaseStorage.ts (STORAGE_VALIDATION_RULES).
-- -----------------------------------------------------------------------------

COMMIT;
