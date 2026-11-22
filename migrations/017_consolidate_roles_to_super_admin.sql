-- ==============================================================================
-- MORAJAWS MIGRATION 017: KONSOLIDASI ROLE RBAC KE SUPERADMIN
-- Menghapus permanen role 'management_data' (Data Management) & 'it_support' (IT Support)
-- dan menggabungkan seluruh hak akses, akun pengguna, dan policy RLS ke 'super_admin'.
-- Idempotent & Transactional.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Pastikan baris role 'super_admin' ada dan gabungkan seluruh izinnya
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_super_role_id TEXT;
  v_merged_perms JSONB;
  v_consolidated_core TEXT[] := ARRAY[
    'login',
    'manage_users',
    'create_user',
    'create_installer',
    'update_user',
    'toggle_user_status',
    'delete_user',
    'import_data',
    'manage_field_mapping',
    'view_all_wo',
    'view_contractor_wo',
    'view_assigned_wo',
    'distribute_wo',
    'manage_leader_schedule',
    'edit_technical_report',
    'access_live_chat',
    'manage_contractors',
    'view_audit_logs',
    'database_management',
    'delete_wo_data',
    'edit_wo_data',
    'system_health',
    'application_configuration',
    'ui_configuration',
    'setting_droplist',
    'manage_whatsapp_templates'
  ];
BEGIN
  SELECT id INTO v_super_role_id
  FROM public.roles
  WHERE code = 'super_admin'
  LIMIT 1;

  IF v_super_role_id IS NULL THEN
    v_super_role_id := 'role-super-admin';
    INSERT INTO public.roles (id, code, name, description, permissions, updated_by, updated_at)
    VALUES (
      v_super_role_id,
      'super_admin',
      'Superadmin',
      'Otoritas penuh sistem MoraJaws (termasuk Data Management & IT Support)',
      to_jsonb(v_consolidated_core),
      'System Migration 017',
      NOW()
    );
  END IF;

  -- Kumpulkan gabungan permission dari super_admin, management_data, it_support, dan izin inti tergabung
  SELECT COALESCE(jsonb_agg(DISTINCT perm ORDER BY perm), to_jsonb(v_consolidated_core))
  INTO v_merged_perms
  FROM (
    SELECT jsonb_array_elements_text(r.permissions) AS perm
    FROM public.roles r
    WHERE r.code IN ('super_admin', 'management_data', 'it_support')
      AND jsonb_typeof(r.permissions) = 'array'
    UNION
    SELECT unnest(v_consolidated_core) AS perm
  ) combined;

  UPDATE public.roles
  SET
    permissions = v_merged_perms,
    updated_by = 'System Migration 017',
    updated_at = NOW()
  WHERE code = 'super_admin';

  -- ----------------------------------------------------------------------------
  -- 2. Migrasi seluruh akun pengguna (in-place) dari management_data / it_support
  --    ke super_admin tanpa menghapus akun atau mengubah riwayat / kredensial.
  -- ----------------------------------------------------------------------------
  UPDATE public.users
  SET
    role = 'super_admin',
    role_id = v_super_role_id,
    permissions = (
      SELECT COALESCE(jsonb_agg(DISTINCT p ORDER BY p), '[]'::jsonb)
      FROM (
        SELECT jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(public.users.permissions) = 'array' THEN public.users.permissions
            ELSE '[]'::jsonb
          END
        ) AS p
        UNION
        SELECT jsonb_array_elements_text(v_merged_perms) AS p
      ) user_perms
    ),
    session_version = COALESCE(session_version, 1) + 1,
    payload = CASE
      WHEN payload IS NOT NULL AND jsonb_typeof(payload) = 'object' THEN
        jsonb_set(
          payload,
          '{sessionVersion}',
          to_jsonb(COALESCE(session_version, 1) + 1),
          true
        )
      ELSE payload
    END,
    updated_at = NOW()
  WHERE role IN ('management_data', 'it_support')
     OR role_id IN (
       SELECT id FROM public.roles WHERE code IN ('management_data', 'it_support')
     );

  -- ----------------------------------------------------------------------------
  -- 3. Cabut sesi auth aktif bagi akun yang baru dimigrasikan agar token segar
  -- ----------------------------------------------------------------------------
  IF to_regclass('public.auth_sessions') IS NOT NULL THEN
    UPDATE public.auth_sessions s
    SET
      status = 'revoked',
      revoked_at = COALESCE(revoked_at, NOW())
    FROM public.users u
    WHERE s.user_id = u.id
      AND u.role = 'super_admin'
      AND s.status = 'active'
      AND u.updated_at >= NOW() - INTERVAL '1 minute';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 4. Bersihkan app_settings (role_permissions & navigation configs)
  -- ----------------------------------------------------------------------------
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    -- 4a. role_permissions
    UPDATE public.app_settings
    SET
      value = jsonb_set(
        (value - 'management_data' - 'it_support'),
        '{super_admin}',
        (
          SELECT COALESCE(jsonb_agg(DISTINCT perm ORDER BY perm), v_merged_perms)
          FROM (
            SELECT jsonb_array_elements_text(value->'super_admin') AS perm
            WHERE jsonb_typeof(value->'super_admin') = 'array'
            UNION
            SELECT jsonb_array_elements_text(value->'management_data') AS perm
            WHERE jsonb_typeof(value->'management_data') = 'array'
            UNION
            SELECT jsonb_array_elements_text(value->'it_support') AS perm
            WHERE jsonb_typeof(value->'it_support') = 'array'
            UNION
            SELECT jsonb_array_elements_text(v_merged_perms) AS perm
          ) perms_union
        ),
        true
      ),
      updated_at = NOW()
    WHERE key = 'role_permissions'
      AND jsonb_typeof(value) = 'object';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 5. Hapus permanen baris role 'management_data' & 'it_support'
  -- ----------------------------------------------------------------------------
  DELETE FROM public.roles
  WHERE code IN ('management_data', 'it_support');
END $$;

-- ------------------------------------------------------------------------------
-- 6. Perbarui seluruh Row Level Security (RLS) Policy tanpa role yang dihapus
-- ------------------------------------------------------------------------------

-- 6a. public.users
DROP POLICY IF EXISTS users_select_privileged ON public.users;
CREATE POLICY users_select_privileged ON public.users
FOR SELECT
TO authenticated
USING (
  public.get_auth_user_role(auth.uid()) IN ('super_admin', 'dispatch')
);

-- 6b. public.work_orders
DROP POLICY IF EXISTS wo_authenticated_read ON public.work_orders;
CREATE POLICY wo_authenticated_read ON public.work_orders
FOR SELECT TO authenticated
USING (
  public.get_auth_user_role(auth.uid()) IN ('super_admin', 'dispatch')
  OR (
    public.get_auth_user_role(auth.uid()) = 'leader'
    AND contractor_id IN (SELECT contractor_id FROM public.users WHERE auth_user_id = auth.uid() AND is_deleted = false)
  )
  OR (
    public.get_auth_user_role(auth.uid()) = 'installer'
    AND installer_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid() AND is_deleted = false)
  )
);

-- 6c. public.audit_logs & public.system_error_logs
DROP POLICY IF EXISTS al_privileged_read ON public.audit_logs;
CREATE POLICY al_privileged_read ON public.audit_logs
FOR SELECT TO authenticated
USING (public.get_auth_user_role(auth.uid()) = 'super_admin');

DROP POLICY IF EXISTS sel_privileged_read ON public.system_error_logs;
CREATE POLICY sel_privileged_read ON public.system_error_logs
FOR SELECT TO authenticated
USING (public.get_auth_user_role(auth.uid()) = 'super_admin');

-- 6d. public.app_settings
DROP POLICY IF EXISTS sett_privileged_modify ON public.app_settings;
CREATE POLICY sett_privileged_modify ON public.app_settings
FOR ALL TO authenticated
USING (public.get_auth_user_role(auth.uid()) = 'super_admin')
WITH CHECK (public.get_auth_user_role(auth.uid()) = 'super_admin');

-- 6e. public.wo_progress_report_history & public.wo_distribution_logs
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
          u.role IN ('super_admin', 'dispatch')
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
          u.role IN ('super_admin', 'dispatch')
          OR (
            u.role = 'leader'
            AND (u.leader_id IS NULL OR wo_distribution_logs.leader_id = u.id OR lower(coalesce(wo_distribution_logs.leader_name, '')) = lower(u.name))
          )
        )
    )
  );

COMMIT;
