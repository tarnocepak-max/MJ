-- ==============================================================================
-- MORAJAWS MIGRATION 020 — PREFLIGHT VERIFICATION SQL (100% READ-ONLY)
-- Target: Production / Staging PostgreSQL (Supabase SQL Editor)
-- Execute FIRST — BEFORE reviewing or applying Migration 020.
--
-- Safety Guarantees:
--   - Zero DDL, zero DML, zero mutations, zero locks on public.work_orders rows.
--   - Zero hard-coded production WO IDs or unverified schema assumptions.
--   - Outputs explicit PASS / FAIL / WARNING / INFO checklist rows plus
--     supporting catalog diagnostics.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- SECTION A: PREFLIGHT PASS / FAIL / WARNING SUMMARY CHECKLIST
-- ------------------------------------------------------------------------------
WITH checks AS (
  -- 1. Database environment context
  SELECT
    10 AS sort_order,
    'DB_CONTEXT' AS check_code,
    'PostgreSQL Database & Executing Role' AS check_name,
    'INFO' AS status,
    format('db=%s | user=%s', current_database(), current_user) AS observed_value,
    split_part(version(), ' on ', 1) AS details

  UNION ALL

  -- 2. Verify public.morajaws_set_updated_at() exists and returns TRIGGER
  SELECT
    20,
    'FN_UPDATED_AT',
    'public.morajaws_set_updated_at() Trigger Function',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_type t ON t.oid = p.prorettype
        WHERE n.nspname = 'public'
          AND p.proname = 'morajaws_set_updated_at'
          AND pg_get_function_identity_arguments(p.oid) = ''
          AND t.typname = 'trigger'
      ) THEN 'PASS'
      ELSE 'WARNING'
    END,
    COALESCE((
      SELECT format('exists | returns=%s | prosecdef=%s', t.typname, p.prosecdef)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_type t ON t.oid = p.prorettype
      WHERE n.nspname = 'public'
        AND p.proname = 'morajaws_set_updated_at'
        AND pg_get_function_identity_arguments(p.oid) = ''
      LIMIT 1
    ), 'missing'),
    'Migration 020 reuses public.morajaws_set_updated_at() if present without modifying it.'

  UNION ALL

  -- 3. Verify public.work_orders exists
  SELECT
    30,
    'TBL_WORK_ORDERS',
    'public.work_orders Table Existence',
    CASE WHEN to_regclass('public.work_orders') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN to_regclass('public.work_orders') IS NOT NULL THEN 'exists' ELSE 'missing' END,
    'Required target table for atomic batch WO insertion/update.'

  UNION ALL

  -- 4. Verify unique normalized WO index uq_work_orders_wo_number_normalized
  SELECT
    40,
    'IDX_WO_NORM_UQ',
    'uq_work_orders_wo_number_normalized Index',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_index ix ON ix.indexrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relname = 'uq_work_orders_wo_number_normalized'
          AND ix.indisunique = TRUE
          AND ix.indisvalid = TRUE
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    COALESCE((
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'work_orders'
        AND indexname = 'uq_work_orders_wo_number_normalized'
      LIMIT 1
    ), 'missing'),
    'Must be unique and valid on lower(regexp_replace(btrim(wo_number), ''\s+'', '''', ''g'')).'

  UNION ALL

  -- 5. Verify public.users required columns & exact data types (id MUST be TEXT)
  SELECT
    50,
    'USERS_SCHEMA',
    'public.users Columns & TEXT Identity Compatibility',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id' AND data_type = 'text'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role' AND data_type = 'text'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'active' AND data_type = 'boolean'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_archived' AND data_type = 'boolean'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_deleted' AND data_type = 'boolean'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'account_status' AND data_type = 'text'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'permissions' AND data_type = 'jsonb'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    format(
      'id=%s | firebase_uid=%s | auth_user_id=%s | role=%s | active=%s | is_archived=%s | is_deleted=%s | account_status=%s',
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='id'), 'missing'),
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='firebase_uid'), 'missing'),
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='auth_user_id'), 'absent'),
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='role'), 'missing'),
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='active'), 'missing'),
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='is_archived'), 'missing'),
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='is_deleted'), 'missing'),
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='account_status'), 'missing')
    ),
    'users.id is TEXT; users.auth_user_id is absent. Migration 020 stores created_by_id/imported_by_id as TEXT and avoids UUID casts or auth_user_id.'

  UNION ALL

  -- 6. Confirm users.auth_user_id absence (audit check)
  SELECT
    55,
    'USERS_NO_AUTH_UID',
    'Absence of legacy users.auth_user_id (Custom Auth Confirmation)',
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_user_id'
      ) THEN 'PASS'
      ELSE 'INFO'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_user_id'
      ) THEN 'present'
      ELSE 'absent'
    END,
    'MoraJaws uses Custom Authentication (public.auth_sessions) via Express + service_role; Migration 020 must NOT depend on users.auth_user_id.'

  UNION ALL

  -- 7. Verify public.roles & public.app_settings exist
  SELECT
    60,
    'RBAC_TABLES',
    'public.roles & public.app_settings Existence',
    CASE
      WHEN to_regclass('public.roles') IS NOT NULL
       AND to_regclass('public.app_settings') IS NOT NULL THEN 'PASS'
      ELSE 'FAIL'
    END,
    format(
      'roles=%s | app_settings=%s',
      CASE WHEN to_regclass('public.roles') IS NOT NULL THEN 'exists' ELSE 'missing' END,
      CASE WHEN to_regclass('public.app_settings') IS NOT NULL THEN 'exists' ELSE 'missing' END
    ),
    'Authoritative RBAC permission tables used by Express backend.'

  UNION ALL

  -- 8. Check whether any of the 5 import tables already exist in Production
  SELECT
    70,
    'IMPORT_TABLES_STATE',
    'Migration 020 Five Import Tables Pre-State',
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
      ) = 0 THEN 'PASS'
      ELSE 'WARNING'
    END,
    format(
      '%s / 5 already exist (%s)',
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
      ),
      COALESCE((
        SELECT STRING_AGG(table_name, ', ' ORDER BY table_name)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
      ), 'none')
    ),
    'Clean preflight expects 0/5 before first run; WARNING if partial/prior draft exists (Migration 020 is idempotent).'

  UNION ALL

  -- 9. Inspect whether legacy draft morajaws_can_access_imports exists (read-only, NOT dropped)
  SELECT
    80,
    'LEGACY_HELPER_CHECK',
    'Legacy morajaws_can_access_imports Read-Only Check',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'morajaws_can_access_imports'
      ) THEN 'WARNING'
      ELSE 'INFO'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'morajaws_can_access_imports'
      ) THEN 'present (preserved untouched; see Section E)'
      ELSE 'absent'
    END,
    'Migration 020 neither uses nor drops morajaws_can_access_imports; inspect Section E before any manual cleanup.'
)
SELECT sort_order, check_code, check_name, status, observed_value, details
FROM checks
ORDER BY sort_order;

-- ------------------------------------------------------------------------------
-- SECTION B: BASELINE PRODUCTION public.work_orders INTEGRITY SNAPSHOT (READ-ONLY)
-- Compare counts, timestamps, and deterministic MD5 digest against post-migration verify
-- to verify zero unintended row mutations (no hard-coded WO IDs).
-- ------------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_work_orders,
  COUNT(*) FILTER (WHERE COALESCE(is_deleted, FALSE) = FALSE AND COALESCE(is_archived, FALSE) = FALSE) AS active_work_orders,
  COUNT(*) FILTER (WHERE COALESCE(is_deleted, FALSE) = TRUE) AS soft_deleted_work_orders,
  COUNT(*) FILTER (WHERE COALESCE(is_archived, FALSE) = TRUE) AS archived_work_orders,
  COUNT(*) FILTER (WHERE wo_number IS NULL OR btrim(wo_number) = '') AS blank_wo_number_rows,
  MIN(created_at) AS min_created_at,
  MAX(updated_at) AS max_updated_at,
  md5(
    COALESCE(
      string_agg(
        concat_ws(
          '|',
          id,
          COALESCE(wo_number, ''),
          COALESCE(customer_id, ''),
          COALESCE(status_wo_agent, ''),
          COALESCE(status_wo_installer, ''),
          COALESCE(is_deleted, FALSE)::text,
          COALESCE(is_archived, FALSE)::text,
          COALESCE(to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
        ),
        E'\n' ORDER BY id
      ),
      ''
    )
  ) AS work_orders_integrity_md5
FROM public.work_orders;

-- Check if any normalized WO duplicates currently exist in public.work_orders
SELECT
  COUNT(*) AS duplicate_normalized_wo_groups
FROM (
  SELECT lower(regexp_replace(btrim(wo_number), '\s+', '', 'g')) AS norm_wo
  FROM public.work_orders
  WHERE wo_number IS NOT NULL AND btrim(wo_number) <> ''
  GROUP BY 1
  HAVING COUNT(*) > 1
) dup;

-- ------------------------------------------------------------------------------
-- SECTION C: ACTUAL public.users SCHEMA & RLS DIAGNOSTICS
-- ------------------------------------------------------------------------------
SELECT
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'users'
ORDER BY c.ordinal_position;

SELECT
  t.tablename,
  t.rowsecurity AS rls_enabled
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND t.tablename IN ('users', 'roles', 'app_settings', 'work_orders', 'auth_sessions')
ORDER BY t.tablename;

SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'roles', 'app_settings', 'work_orders')
ORDER BY tablename, policyname;

-- ------------------------------------------------------------------------------
-- SECTION D: ACTUAL ROLE PERMISSIONS SNAPSHOT (import_data MODEL)
-- ------------------------------------------------------------------------------
SELECT
  id,
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

-- ------------------------------------------------------------------------------
-- SECTION E: LEGACY OBJECT INSPECTION (READ-ONLY — morajaws_can_access_imports)
-- Verifies definition, owner, grants, and dependencies without dropping anything.
-- ------------------------------------------------------------------------------
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_args,
  pg_get_userbyid(p.proowner) AS owner_role,
  p.prosecdef AS security_definer,
  pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'morajaws_can_access_imports';

SELECT
  routine_name,
  grantee,
  STRING_AGG(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name = 'morajaws_can_access_imports'
GROUP BY routine_name, grantee
ORDER BY grantee;

SELECT
  d.classid::regclass AS dependent_catalog,
  COALESCE(pol.polname, cls.relname, dep_p.proname, d.objid::text) AS dependent_object,
  d.deptype AS dependency_type
FROM pg_depend d
JOIN pg_proc p ON p.oid = d.refobjid
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN pg_policy pol ON d.classid = 'pg_policy'::regclass AND pol.oid = d.objid
LEFT JOIN pg_class cls ON d.classid = 'pg_class'::regclass AND cls.oid = d.objid
LEFT JOIN pg_proc dep_p ON d.classid = 'pg_proc'::regclass AND dep_p.oid = d.objid
WHERE n.nspname = 'public'
  AND p.proname = 'morajaws_can_access_imports';
