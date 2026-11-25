-- ==============================================================================
-- MORAJAWS MIGRATION 020 — PREFLIGHT VERIFICATION SQL (READ-ONLY)
-- Run BEFORE applying migrations/020_enterprise_import_architecture.sql
-- Zero mutations; safe for production inspection.
-- ==============================================================================

-- 1. Check PostgreSQL version, current database, current user & role
SELECT
  version() AS pg_version,
  current_database() AS db_name,
  current_user AS executing_user,
  NOW() AS inspected_at;

-- 2. Verify whether public.morajaws_set_updated_at() and related trigger functions exist
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'morajaws_set_updated_at',
    'morajaws_import_set_updated_at',
    'get_auth_user_role'
  )
ORDER BY p.proname;

-- 3. Inspect actual public.users schema (required columns & data types)
SELECT
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'users'
  AND c.column_name IN ('id', 'auth_user_id', 'active', 'is_deleted', 'role', 'permissions')
ORDER BY c.column_name;

-- 4. Inspect public.users RLS status and existing policies (check recursion risks)
SELECT
  t.tablename,
  t.rowsecurity AS rls_enabled
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND t.tablename IN ('users', 'roles', 'app_settings', 'work_orders')
ORDER BY t.tablename;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'roles', 'app_settings')
ORDER BY tablename, policyname;

-- 5. Inspect actual import_data permission state in public.roles & public.app_settings
SELECT
  code,
  name,
  permissions
FROM public.roles
WHERE code IN ('super_admin', 'dispatch', 'leader', 'installer')
ORDER BY code;

SELECT
  setting_key,
  setting_value->'super_admin' AS super_admin_perms,
  setting_value->'dispatch' AS dispatch_perms,
  updated_at,
  updated_by
FROM public.app_settings
WHERE setting_key = 'role_permissions';

-- 6. Verify public.work_orders existence, row count, protected WO presence, and unique index
SELECT
  COUNT(*) AS total_work_orders,
  COUNT(*) FILTER (
    WHERE id IN ('wo_1793825457141_u4bnht', 'wo_imp_1793825458959_4i4f1h', 'wo_imp_1793825458959_262dei')
  ) AS protected_production_wo_count
FROM public.work_orders;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'work_orders'
  AND indexname = 'uq_work_orders_wo_number_normalized';

-- 7. Check if any of the 5 Migration 020 tables or functions already exist
SELECT
  t.table_name,
  pt.rowsecurity AS rls_enabled
FROM information_schema.tables t
LEFT JOIN pg_tables pt ON pt.schemaname = t.table_schema AND pt.tablename = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'import_jobs',
    'import_batches',
    'import_staging_rows',
    'import_row_errors',
    'import_history'
  )
ORDER BY t.table_name;
