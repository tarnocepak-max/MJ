-- =============================================================================
-- MORAJAWS MIGRATION 011: GLOBAL CONFIG VERSIONING & AUDIT HISTORY (FORWARD-ONLY)
-- Target Platform: Supabase PostgreSQL
--
-- Purpose:
--   1. Add optimistic concurrency `version` and `updated_by_id` columns to
--      `public.app_settings` so every global configuration change is versioned.
--   2. Create `public.global_config_versions` table to record immutable,
--      versioned configuration snapshots (previous_value, new_value, actor,
--      module, action, tx_status, timestamp) supporting audit inspection and
--      safe rollback by Super Admin.
--   3. Add `version` and `updated_by` columns to `public.roles` for dynamic
--      RBAC permission persistence tracking.
--   4. Maintain Row Level Security (RLS) ENABLED with backend `service_role`
--      policies and zero direct `anon`/`authenticated` access.
--
-- SAFETY GUARANTEES:
--   - FORWARD-ONLY & IDEMPOTENT.
--   - ZERO DROP TABLE / DROP COLUMN / TRUNCATE / DELETE statements.
-- =============================================================================

BEGIN;

-- 1. Extend public.app_settings with version & updated_by_id
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by_id text;

-- 2. Extend public.roles with version & updated_by
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by text;

-- 3. Create public.global_config_versions for immutable version history & rollback
CREATE TABLE IF NOT EXISTS public.global_config_versions (
  id text PRIMARY KEY,
  config_key text NOT NULL,
  version bigint NOT NULL,
  previous_value jsonb,
  new_value jsonb NOT NULL,
  changed_by_id text,
  changed_by_name text,
  changed_by_role text,
  action text NOT NULL DEFAULT 'UPDATE',
  module text NOT NULL DEFAULT 'global_config',
  tx_status text NOT NULL DEFAULT 'COMMITTED',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_global_config_versions_key_ver
  ON public.global_config_versions (config_key, version);

CREATE INDEX IF NOT EXISTS idx_global_config_versions_created
  ON public.global_config_versions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_global_config_versions_key_created
  ON public.global_config_versions (config_key, created_at DESC);

-- 4. Enable RLS & restrict direct browser access (Backend service_role only)
ALTER TABLE public.global_config_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS global_config_versions_service_role_all ON public.global_config_versions;
CREATE POLICY global_config_versions_service_role_all
  ON public.global_config_versions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.global_config_versions FROM anon, authenticated;
GRANT ALL ON TABLE public.global_config_versions TO service_role;

COMMIT;
