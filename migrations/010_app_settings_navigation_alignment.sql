-- =============================================================================
-- MORAJAWS MIGRATION 010: APP_SETTINGS & NAVIGATION CONFIG ALIGNMENT (FORWARD-ONLY)
-- Target Platform: Supabase PostgreSQL
--
-- Purpose:
--   1. Ensure public.app_settings exists with expected primary key and columns
--      (setting_key PK, setting_value jsonb, description, updated_by, created_at, updated_at).
--   2. Ensure GIN index on setting_value exists for JSONB queries.
--   3. Attach morajaws_set_updated_at() trigger to public.app_settings so updated_at
--      is automatically maintained on UPDATE/UPSERT.
--   4. Maintain Row Level Security (RLS) ENABLED with service_role policy and
--      explicit GRANT ALL ON TABLE public.app_settings TO service_role, while
--      keeping direct anon/authenticated access denied.
--
-- SAFETY GUARANTEES:
--   - FORWARD-ONLY & IDEMPOTENT.
--   - ZERO DROP TABLE / DROP COLUMN / TRUNCATE / DELETE statements.
--   - Preserves all existing rows in public.app_settings (navigation_doc,
--     navigation_config, ui_configuration, global_config, hierarchical_droplists, etc.).
-- =============================================================================

BEGIN;

-- 1. Ensure public.app_settings table & columns exist without touching existing data
CREATE TABLE IF NOT EXISTS public.app_settings (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. Ensure GIN index on setting_value exists
CREATE INDEX IF NOT EXISTS idx_app_settings_value_gin
  ON public.app_settings USING GIN (setting_value);

-- 3. Ensure updated_at trigger function & trigger exist on public.app_settings
CREATE OR REPLACE FUNCTION public.morajaws_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.morajaws_set_updated_at();

-- 4. Keep RLS enabled with authoritative backend service_role access policy
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_service_role_all ON public.app_settings;
CREATE POLICY app_settings_service_role_all
  ON public.app_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.app_settings FROM anon, authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;

COMMIT;
