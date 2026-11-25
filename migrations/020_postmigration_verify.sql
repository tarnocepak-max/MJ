-- ==============================================================================
-- MORAJAWS MIGRATION 020 — POST-MIGRATION VERIFICATION SQL (READ-ONLY)
-- Run AFTER applying migrations/020_enterprise_import_architecture.sql
-- Inspects all 5 import tables, columns, indexes, constraints, triggers,
-- RLS status, RLS policies, table grants, and RPC function grants.
-- ==============================================================================

-- 1. All five import tables + RLS enabled status + row counts
SELECT
  t.tablename AS table_name,
  t.rowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'import_jobs',
    'import_batches',
    'import_staging_rows',
    'import_row_errors',
    'import_history'
  )
ORDER BY t.tablename;

-- 2. Columns & types across all five import tables (verify batch lock & history columns)
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'import_jobs',
    'import_batches',
    'import_staging_rows',
    'import_row_errors',
    'import_history'
  )
ORDER BY table_name, ordinal_position;

-- 3. Indexes on all five import tables
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'import_jobs',
    'import_batches',
    'import_staging_rows',
    'import_row_errors',
    'import_history'
  )
ORDER BY tablename, indexname;

-- 4. Constraints (PK, UNIQUE, CHECK, FOREIGN KEY incl. ON DELETE action)
--    Verify import_history.job_id uses ON DELETE SET NULL (confdeltype = 'n'), NOT CASCADE ('c')!
SELECT
  cl.relname AS table_name,
  co.conname AS constraint_name,
  CASE co.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'c' THEN 'CHECK'
    ELSE co.contype::text
  END AS constraint_type,
  CASE co.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE NULL
  END AS fk_on_delete_action,
  pg_get_constraintdef(co.oid) AS definition
FROM pg_constraint co
JOIN pg_class cl ON cl.oid = co.conrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'public'
  AND cl.relname IN (
    'import_jobs',
    'import_batches',
    'import_staging_rows',
    'import_row_errors',
    'import_history'
  )
ORDER BY cl.relname, co.contype, co.conname;

-- 5. Triggers on all five import tables
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN (
    'import_jobs',
    'import_batches',
    'import_staging_rows',
    'import_row_errors',
    'import_history'
  )
ORDER BY event_object_table, trigger_name;

-- 6. RLS Policies on all five import tables
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
  AND tablename IN (
    'import_jobs',
    'import_batches',
    'import_staging_rows',
    'import_row_errors',
    'import_history'
  )
ORDER BY tablename, policyname;

-- 7. Table Privileges (Grants separately from RLS)
SELECT
  table_name,
  grantee,
  STRING_AGG(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'import_jobs',
    'import_batches',
    'import_staging_rows',
    'import_row_errors',
    'import_history'
  )
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

-- 8. Verify Migration 020 Functions & Execution Privileges
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname LIKE 'morajaws_%import%'
    OR p.proname IN (
      'morajaws_can_access_imports',
      'morajaws_sync_staged_count',
      'morajaws_claim_import_batch',
      'morajaws_commit_import_batch_atomic',
      'morajaws_fail_claimed_batch_atomic',
      'morajaws_cancel_import_job_atomic',
      'morajaws_retry_import_job_atomic'
    )
  )
ORDER BY p.proname;

SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name IN (
    'morajaws_import_set_updated_at',
    'morajaws_import_history_preserve_job_ref',
    'morajaws_can_access_imports',
    'morajaws_sync_staged_count',
    'morajaws_claim_import_batch',
    'morajaws_commit_import_batch_atomic',
    'morajaws_fail_claimed_batch_atomic',
    'morajaws_cancel_import_job_atomic',
    'morajaws_retry_import_job_atomic'
  )
ORDER BY routine_name, grantee;

-- 9. Safety check: confirm public.work_orders & protected production WOs untouched
SELECT
  COUNT(*) AS total_work_orders,
  COUNT(*) FILTER (
    WHERE id IN ('wo_1793825457141_u4bnht', 'wo_imp_1793825458959_4i4f1h', 'wo_imp_1793825458959_262dei')
  ) AS protected_production_wo_count
FROM public.work_orders;
