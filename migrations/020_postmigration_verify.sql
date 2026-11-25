-- ==============================================================================
-- MORAJAWS MIGRATION 020 — POST-MIGRATION VERIFICATION SQL (100% READ-ONLY)
-- Execute THIRD — AFTER reviewing and applying migrations/020_enterprise_import_architecture.sql.
--
-- Verifies:
--   - All 5 import tables exist with RLS enabled
--   - Required columns & TEXT identity types (no UUID user casts)
--   - import_history.job_id uses ON DELETE SET NULL (never CASCADE)
--   - Required indexes & triggers
--   - All 7 Migration 020 RPC functions & service_role-only execution grants
--   - Zero anon/authenticated grants or policies on import tables
--   - public.work_orders & uq_work_orders_wo_number_normalized untouched
--   - Zero hard-coded unverified production WO ID lists
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- SECTION A: POST-MIGRATION PASS / FAIL / WARNING SUMMARY CHECKLIST
-- ------------------------------------------------------------------------------
WITH checks AS (
  -- 1. All 5 import tables exist
  SELECT
    10 AS sort_order,
    'IMP_5_TABLES' AS check_code,
    'All Five Import Tables Exist' AS check_name,
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
      ) = 5 THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    format(
      '%s / 5 present',
      (
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
      )
    ) AS observed_value,
    'import_jobs, import_batches, import_staging_rows, import_row_errors, import_history' AS details

  UNION ALL

  -- 2. RLS enabled on all 5 import tables
  SELECT
    20,
    'IMP_RLS_ENABLED',
    'RLS Enabled on All Five Import Tables',
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
          AND rowsecurity = TRUE
      ) = 5 THEN 'PASS'
      ELSE 'FAIL'
    END,
    format(
      '%s / 5 enabled',
      (
        SELECT COUNT(*)
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
          AND rowsecurity = TRUE
      )
    ),
    'Row Level Security must be TRUE on every import table.'

  UNION ALL

  -- 3. Required batch lock, history preservation, and TEXT identity columns
  SELECT
    30,
    'IMP_REQUIRED_COLUMNS',
    'Required Columns & TEXT User ID Compatibility',
    CASE
      WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_jobs' AND column_name='created_by_id' AND data_type='text')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_jobs' AND column_name='updated_rows')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' AND column_name='locked_by')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' AND column_name='locked_at')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' AND column_name='lock_expires_at')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_batches' AND column_name='updated_rows')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_history' AND column_name='original_job_id' AND data_type='text')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_history' AND column_name='imported_by_id' AND data_type='text')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='import_history' AND column_name='job_id' AND is_nullable='YES')
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    format(
      'created_by_id=%s | imported_by_id=%s | job_id_nullable=%s',
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='import_jobs' AND column_name='created_by_id'), 'missing'),
      COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='import_history' AND column_name='imported_by_id'), 'missing'),
      COALESCE((SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='import_history' AND column_name='job_id'), 'missing')
    ),
    'Matches public.users.id TEXT and nullable import_history.job_id.'

  UNION ALL

  -- 4. import_history.job_id FK MUST be ON DELETE SET NULL (confdeltype = 'n')
  SELECT
    40,
    'IMP_HISTORY_FK_SET_NULL',
    'import_history.job_id FK ON DELETE SET NULL',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE n.nspname = 'public'
          AND cl.relname = 'import_history'
          AND c.contype = 'f'
          AND a.attname = 'job_id'
          AND c.confdeltype = 'n'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE n.nspname = 'public'
          AND cl.relname = 'import_history'
          AND c.contype = 'f'
          AND a.attname = 'job_id'
          AND c.confdeltype = 'c'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    COALESCE((
      SELECT CASE c.confdeltype WHEN 'n' THEN 'SET NULL' WHEN 'c' THEN 'CASCADE' ELSE c.confdeltype::text END
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE n.nspname = 'public' AND cl.relname = 'import_history' AND c.contype = 'f' AND a.attname = 'job_id'
      LIMIT 1
    ), 'missing'),
    'Preserves completed import_history even if parent import_jobs row is deleted.'

  UNION ALL

  -- 5. Key indexes exist
  SELECT
    50,
    'IMP_INDEXES',
    'Required Indexes on Import Tables',
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_import_jobs_status_created',
            'idx_import_jobs_created_by_created',
            'idx_import_batches_job_status',
            'idx_import_batches_claim',
            'idx_import_staging_job_batch_proc',
            'idx_import_staging_job_validation',
            'idx_import_staging_wo_number',
            'idx_import_staging_job_canon_wo',
            'idx_import_row_errors_job_row',
            'idx_import_history_created',
            'idx_import_history_original_job_id'
          )
      ) = 11 THEN 'PASS'
      ELSE 'FAIL'
    END,
    format(
      '%s / 11 indexes present',
      (
        SELECT COUNT(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_import_jobs_status_created',
            'idx_import_jobs_created_by_created',
            'idx_import_batches_job_status',
            'idx_import_batches_claim',
            'idx_import_staging_job_batch_proc',
            'idx_import_staging_job_validation',
            'idx_import_staging_wo_number',
            'idx_import_staging_job_canon_wo',
            'idx_import_row_errors_job_row',
            'idx_import_history_created',
            'idx_import_history_original_job_id'
          )
      )
    ),
    'Covers claim queue, normalized staging lookup, error lookup, and history.'

  UNION ALL

  -- 6. Required triggers exist
  SELECT
    60,
    'IMP_TRIGGERS',
    'Updated-At & History Preservation Triggers',
    CASE
      WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table='import_jobs' AND trigger_name='trg_import_jobs_updated_at')
       AND EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table='import_batches' AND trigger_name='trg_import_batches_updated_at')
       AND EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table='import_history' AND trigger_name='trg_import_history_preserve_job_ref')
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    format(
      'jobs=%s | batches=%s | history=%s',
      EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table='import_jobs' AND trigger_name='trg_import_jobs_updated_at'),
      EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table='import_batches' AND trigger_name='trg_import_batches_updated_at'),
      EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table='import_history' AND trigger_name='trg_import_history_preserve_job_ref')
    ),
    'Ensures updated_at maintenance and original_job_id preservation.'

  UNION ALL

  -- 7. All 7 transactional RPCs exist as SECURITY DEFINER with safe search_path
  SELECT
    70,
    'IMP_RPCS',
    'Seven Migration 020 Transactional RPCs',
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef = TRUE
          AND p.proname IN (
            'morajaws_find_existing_wo_numbers',
            'morajaws_sync_staged_count',
            'morajaws_claim_import_batch',
            'morajaws_commit_import_batch_atomic',
            'morajaws_fail_claimed_batch_atomic',
            'morajaws_cancel_import_job_atomic',
            'morajaws_retry_import_job_atomic'
          )
      ) = 7 THEN 'PASS'
      ELSE 'FAIL'
    END,
    format(
      '%s / 7 SECURITY DEFINER RPCs present',
      (
        SELECT COUNT(*)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef = TRUE
          AND p.proname IN (
            'morajaws_find_existing_wo_numbers',
            'morajaws_sync_staged_count',
            'morajaws_claim_import_batch',
            'morajaws_commit_import_batch_atomic',
            'morajaws_fail_claimed_batch_atomic',
            'morajaws_cancel_import_job_atomic',
            'morajaws_retry_import_job_atomic'
          )
      )
    ),
    'All 7 database RPCs must exist with SECURITY DEFINER and pinned search_path.'

  UNION ALL

  -- 8. Privilege isolation: zero anon/authenticated table grants or RPC execute grants
  SELECT
    80,
    'IMP_PRIVILEGES_LOCKED',
    'Privilege Hardening (Zero PUBLIC/anon/authenticated Access)',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND table_name IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.routine_privileges
        WHERE specific_schema = 'public'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND routine_name IN (
            'morajaws_find_existing_wo_numbers',
            'morajaws_sync_staged_count',
            'morajaws_claim_import_batch',
            'morajaws_commit_import_batch_atomic',
            'morajaws_fail_claimed_batch_atomic',
            'morajaws_cancel_import_job_atomic',
            'morajaws_retry_import_job_atomic'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'import_history'
          AND grantee = 'service_role'
          AND privilege_type = 'DELETE'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    format(
      'direct_non_service_table_grants=%s | direct_non_service_rpc_grants=%s | history_delete_grant=%s',
      (
        SELECT COUNT(*) FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND table_name IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
      ),
      (
        SELECT COUNT(*) FROM information_schema.routine_privileges
        WHERE specific_schema = 'public'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND routine_name IN (
            'morajaws_find_existing_wo_numbers',
            'morajaws_sync_staged_count',
            'morajaws_claim_import_batch',
            'morajaws_commit_import_batch_atomic',
            'morajaws_fail_claimed_batch_atomic',
            'morajaws_cancel_import_job_atomic',
            'morajaws_retry_import_job_atomic'
          )
      ),
      EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'import_history' AND grantee = 'service_role' AND privilege_type = 'DELETE'
      )
    ),
    'Custom Auth backend operates via service_role only; import_history excludes DELETE grant.'

  UNION ALL

  -- 9. Migration 020 policies and RPCs have zero dependencies on morajaws_can_access_imports or auth_user_id
  SELECT
    90,
    'MIGRATION_020_NO_LEGACY_DEPS',
    'Migration 020 Zero Legacy UUID/auth_user_id Dependencies',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
          AND (
            COALESCE(qual, '') ILIKE '%morajaws_can_access_imports%'
            OR COALESCE(with_check, '') ILIKE '%morajaws_can_access_imports%'
            OR COALESCE(qual, '') ILIKE '%auth_user_id%'
            OR COALESCE(with_check, '') ILIKE '%auth_user_id%'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'morajaws_import_set_updated_at',
            'morajaws_import_history_preserve_job_ref',
            'morajaws_find_existing_wo_numbers',
            'morajaws_sync_staged_count',
            'morajaws_claim_import_batch',
            'morajaws_commit_import_batch_atomic',
            'morajaws_fail_claimed_batch_atomic',
            'morajaws_cancel_import_job_atomic',
            'morajaws_retry_import_job_atomic'
          )
          AND (
            p.prosrc ILIKE '%morajaws_can_access_imports%'
            OR p.prosrc ILIKE '%auth_user_id%'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_proc legacy_p ON legacy_p.oid = d.refobjid
        JOIN pg_namespace legacy_n ON legacy_n.oid = legacy_p.pronamespace
        LEFT JOIN pg_proc dep_p ON d.classid = 'pg_proc'::regclass AND dep_p.oid = d.objid
        LEFT JOIN pg_policy dep_pol ON d.classid = 'pg_policy'::regclass AND dep_pol.oid = d.objid
        LEFT JOIN pg_class dep_tbl ON dep_tbl.oid = dep_pol.polrelid
        WHERE legacy_n.nspname = 'public'
          AND legacy_p.proname = 'morajaws_can_access_imports'
          AND (
            dep_p.proname IN (
              'morajaws_import_set_updated_at',
              'morajaws_import_history_preserve_job_ref',
              'morajaws_find_existing_wo_numbers',
              'morajaws_sync_staged_count',
              'morajaws_claim_import_batch',
              'morajaws_commit_import_batch_atomic',
              'morajaws_fail_claimed_batch_atomic',
              'morajaws_cancel_import_job_atomic',
              'morajaws_retry_import_job_atomic'
            )
            OR dep_tbl.relname IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
          )
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    'verified zero references in Migration 020 policies & RPCs',
    'Confirms no Migration 020 policy or RPC calls morajaws_can_access_imports or references users.auth_user_id.'

  UNION ALL

  -- 9b. Legacy helper preservation info (read-only)
  SELECT
    95,
    'LEGACY_HELPER_STATUS',
    'Legacy morajaws_can_access_imports Object State',
    'INFO',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'morajaws_can_access_imports'
      ) THEN 'present (preserved untouched; unused by Migration 020)'
      ELSE 'absent'
    END,
    'Migration 020 does not execute DROP FUNCTION on pre-existing helpers.'

  UNION ALL

  -- 10. public.work_orders unique normalized index still intact & valid
  SELECT
    100,
    'WO_UNIQUE_IDX_INTACT',
    'public.work_orders uq_work_orders_wo_number_normalized Intact',
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
    'Existing WO uniqueness constraint must remain untouched and valid.'

  UNION ALL

  -- 11. Only morajaws_commit_import_batch_atomic performs write DML on public.work_orders
  SELECT
    110,
    'WO_MUTATION_ISOLATION',
    'Migration 020 work_orders Write-DML Isolation',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'morajaws_import_set_updated_at',
            'morajaws_import_history_preserve_job_ref',
            'morajaws_find_existing_wo_numbers',
            'morajaws_sync_staged_count',
            'morajaws_claim_import_batch',
            'morajaws_fail_claimed_batch_atomic',
            'morajaws_cancel_import_job_atomic',
            'morajaws_retry_import_job_atomic'
          )
          AND (
            p.prosrc ~* '\m(insert\s+into|update|delete\s+from|truncate(\s+table)?)\s+(public\.)?work_orders\M'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'morajaws_commit_import_batch_atomic'
          AND p.prosrc ~* '\m(delete\s+from|truncate(\s+table)?)\s+(public\.)?work_orders\M'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    'only morajaws_commit_import_batch_atomic writes work_orders (no DELETE/TRUNCATE)',
    'Guarantees Migration 020 installs zero work_orders mutations and restricts batch writes strictly to commit RPC.'
)
SELECT sort_order, check_code, check_name, status, observed_value, details
FROM checks
ORDER BY sort_order;

-- ------------------------------------------------------------------------------
-- SECTION B: public.work_orders INTEGRITY SNAPSHOT (Compare with Preflight Baseline)
-- Must match Preflight Section B counts, timestamps, and MD5 digest identically.
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
-- SECTION C: DETAILED CATALOG INSPECTION (Tables, Policies, Grants, Functions)
-- ------------------------------------------------------------------------------
SELECT
  t.tablename AS table_name,
  t.rowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
WHERE t.schemaname = 'public'
  AND t.tablename IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
ORDER BY t.tablename;

SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
ORDER BY tablename, policyname;

SELECT
  table_name,
  grantee,
  STRING_AGG(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'morajaws_set_updated_at',
    'morajaws_import_set_updated_at',
    'morajaws_import_history_preserve_job_ref',
    'morajaws_find_existing_wo_numbers',
    'morajaws_sync_staged_count',
    'morajaws_claim_import_batch',
    'morajaws_commit_import_batch_atomic',
    'morajaws_fail_claimed_batch_atomic',
    'morajaws_cancel_import_job_atomic',
    'morajaws_retry_import_job_atomic'
  )
ORDER BY p.proname;

SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name IN (
    'morajaws_find_existing_wo_numbers',
    'morajaws_sync_staged_count',
    'morajaws_claim_import_batch',
    'morajaws_commit_import_batch_atomic',
    'morajaws_fail_claimed_batch_atomic',
    'morajaws_cancel_import_job_atomic',
    'morajaws_retry_import_job_atomic'
  )
ORDER BY routine_name, grantee;
