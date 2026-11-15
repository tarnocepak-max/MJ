/**
 * End-to-End Verification Suite: Global Superadmin Control & Automatic Database Persistence
 *
 * Tests all 10 mandatory scenarios:
 *  1. Super Admin mengubah setting global -> tersimpan di DB (app_settings + global_config_versions + audit_logs)
 *  2. User lain refresh -> konfigurasi terbaru tetap berlaku dari DB
 *  3. Device berbeda login -> bootstrapGlobalConfigs memuat konfigurasi & versi terbaru
 *  4. Perubahan menu (navigation_doc) -> menu global seluruh user mengikuti konfigurasi DB
 *  5. Perubahan permission (role_permissions) -> RBAC mengikuti konfigurasi terbaru di backend & frontend + core super_admin lock-out guard
 *  6. Browser ditutup & dibuka kembali -> localStorage kosong, bootstrap dari DB tetap mengembalikan konfigurasi terbaru
 *  7. DB gagal (PostgreSQL error / 503) -> tidak dianggap berhasil, state sebelumnya dipertahankan & error muncul
 *  8. Role non-Super Admin mengubah konfigurasi global / master data -> ditolak HTTP 403 & DB tidak berubah
 *  9. Concurrent edit -> expectedVersion usang ditolak HTTP 409 VERSION_CONFLICT & dapat diselesaikan dengan forceOverwrite
 * 10. Rollback konfigurasi -> memulihkan nilai versi target sebagai versi maju baru (append-only) + broadcast SSE real-time
 */

import http from 'http';
import { createExpressApp, SERVER_SESSIONS, db, invalidateGlobalConfigCache } from '../server.ts';
import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from '../server/supabaseClient.ts';
import {
  bootstrapGlobalConfigs,
  getGlobalConfig,
  saveGlobalConfig,
  getConfigVersions,
  rollbackGlobalConfig,
  saveRolePermissionsToServer,
  getRolePermissionsFromServer,
  setTrackedConfigVersion,
  ConfigConflictError
} from '../src/services/globalConfigService.ts';
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission,
  setDynamicRolePermissions
} from '../src/services/authService.ts';
import {
  DEFAULT_CANONICAL_CATEGORIES,
  DEFAULT_STANDALONE_MENUS,
  DEFAULT_SUBMENU_ITEMS
} from '../src/constants/defaultConfig.ts';

interface CheckResult {
  id: number;
  name: string;
  passed: boolean;
  detail: string;
}

const checks: CheckResult[] = [];
function assertCheck(id: number, name: string, passed: boolean, detail: string) {
  checks.push({ id, name, passed, detail });
  console.log(`${passed ? '[PASS]' : '[FAIL]'} #${id} ${name}\n       ${detail}`);
}

function createGlobalPersistenceMockSupabase() {
  const appSettingsRows = new Map<string, any>();
  const versionRows: any[] = [];
  const auditLogsRows: any[] = [];
  const waTemplateRows: any[] = [];
  const roleRows = new Map<string, any>([
    ['super_admin', { id: 'role_sa', code: 'super_admin', name: 'Super Admin', permissions: [...DEFAULT_ROLE_PERMISSIONS.super_admin], version: 1, updated_at: new Date().toISOString() }],
    ['dispatch', { id: 'role_disp', code: 'dispatch', name: 'Dispatch', permissions: [...DEFAULT_ROLE_PERMISSIONS.dispatch], version: 1, updated_at: new Date().toISOString() }],
    ['leader', { id: 'role_lead', code: 'leader', name: 'Leader / Korlap', permissions: [...DEFAULT_ROLE_PERMISSIONS.leader], version: 1, updated_at: new Date().toISOString() }],
    ['installer', { id: 'role_inst', code: 'installer', name: 'Installer', permissions: [...DEFAULT_ROLE_PERMISSIONS.installer], version: 1, updated_at: new Date().toISOString() }],
    ['management_data', { id: 'role_mgmt', code: 'management_data', name: 'Management Data', permissions: [...DEFAULT_ROLE_PERMISSIONS.management_data], version: 1, updated_at: new Date().toISOString() }],
    ['it_support', { id: 'role_it', code: 'it_support', name: 'IT Support', permissions: [...DEFAULT_ROLE_PERMISSIONS.it_support], version: 1, updated_at: new Date().toISOString() }]
  ]);

  const usersList = [
    { id: 'u_sa_global', username: 'superadmin', name: 'Super Admin Global', role: 'super_admin', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } },
    { id: 'u_disp_global', username: 'dispatch1', name: 'Dispatch One', role: 'dispatch', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } },
    { id: 'u_lead_global', username: 'leader1', name: 'Leader One', role: 'leader', contractor: 'PT Mora', area: 'Jakarta', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } },
    { id: 'u_inst_global', username: 'installer1', name: 'Installer One', role: 'installer', contractor: 'PT Mora', area: 'Jakarta', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } },
    { id: 'u_mgmt_global', username: 'mgmt1', name: 'Management Data One', role: 'management_data', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } }
  ];

  let forcedAppSettingsError: any = null;
  let forceUnconfirmedUpsert = false;

  const buildSelectChain = (rowsFn: () => { data: any[]; error: any }) => {
    const filters: Array<(r: any) => boolean> = [];
    let limitNum: number | null = null;
    let orderCol: string | null = null;
    let orderAsc = false;

    const execute = () => {
      const base = rowsFn();
      if (base.error) return { data: null, error: base.error };
      let out = [...base.data];
      for (const f of filters) out = out.filter(f);
      if (orderCol) {
        out.sort((a, b) => {
          const av = String(a?.[orderCol!] ?? '');
          const bv = String(b?.[orderCol!] ?? '');
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limitNum !== null) out = out.slice(0, limitNum);
      return { data: out, error: null };
    };

    const chain: any = {
      eq: (col: string, val: any) => {
        filters.push((r) => String(r?.[col] ?? '') === String(val ?? ''));
        return chain;
      },
      neq: (col: string, val: any) => {
        filters.push((r) => String(r?.[col] ?? '') !== String(val ?? ''));
        return chain;
      },
      ilike: (col: string, val: string) => {
        const clean = String(val ?? '').replace(/%/g, '').toLowerCase();
        filters.push((r) => String(r?.[col] ?? '').toLowerCase().includes(clean));
        return chain;
      },
      or: () => chain,
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = Boolean(opts?.ascending);
        return chain;
      },
      limit: (n: number) => {
        limitNum = n;
        return chain;
      },
      maybeSingle: async () => {
        const res = execute();
        if (res.error) return { data: null, error: res.error };
        return { data: res.data[0] ?? null, error: null };
      },
      single: async () => {
        const res = execute();
        if (res.error) return { data: null, error: res.error };
        return { data: res.data[0] ?? null, error: res.data[0] ? null : { code: 'PGRST116', message: 'Not found' } };
      },
      then: (resolve: any) => resolve(execute())
    };
    return chain;
  };

  const mockClient: any = {
    from: (table: string) => {
      if (table === 'app_settings') {
        return {
          select: () =>
            buildSelectChain(() => {
              if (forcedAppSettingsError) return { data: [], error: forcedAppSettingsError };
              return { data: Array.from(appSettingsRows.values()), error: null };
            }),
          upsert: (rows: any[]) => ({
            select: () => ({
              maybeSingle: async () => {
                if (forcedAppSettingsError) return { data: null, error: forcedAppSettingsError };
                if (forceUnconfirmedUpsert) return { data: null, error: null };
                const input = rows[0];
                const existing = appSettingsRows.get(input.setting_key);
                const stored = {
                  setting_key: input.setting_key,
                  setting_value: JSON.parse(JSON.stringify(input.setting_value)),
                  version: input.version ?? (existing ? (existing.version || 1) + 1 : 1),
                  description: input.description ?? existing?.description ?? null,
                  updated_by: input.updated_by ?? null,
                  updated_by_id: input.updated_by_id ?? null,
                  created_at: existing?.created_at || new Date().toISOString(),
                  updated_at: input.updated_at || new Date().toISOString()
                };
                appSettingsRows.set(input.setting_key, stored);
                return { data: stored, error: null };
              }
            })
          })
        };
      }

      if (table === 'global_config_versions') {
        return {
          select: () => buildSelectChain(() => ({ data: [...versionRows], error: null })),
          insert: async (rows: any[]) => {
            for (const r of rows) {
              versionRows.unshift(JSON.parse(JSON.stringify(r)));
            }
            return { data: rows, error: null };
          }
        };
      }

      if (table === 'roles') {
        return {
          select: () => buildSelectChain(() => ({ data: Array.from(roleRows.values()), error: null })),
          update: (patch: any) => ({
            eq: async (col: string, val: any) => {
              if (col === 'code') {
                const existing = roleRows.get(String(val));
                if (existing) {
                  roleRows.set(String(val), {
                    ...existing,
                    ...patch,
                    version: (existing.version || 1) + 1
                  });
                }
              }
              return { data: null, error: null };
            }
          })
        };
      }

      if (table === 'audit_logs') {
        return {
          select: () => buildSelectChain(() => ({ data: [...auditLogsRows], error: null })),
          insert: async (rows: any[]) => {
            for (const r of rows) {
              auditLogsRows.unshift(JSON.parse(JSON.stringify(r)));
            }
            return { data: rows, error: null };
          }
        };
      }

      if (table === 'wa_templates') {
        return {
          select: () => buildSelectChain(() => ({ data: [...waTemplateRows], error: null })),
          insert: (rows: any[]) => ({
            select: () => ({
              maybeSingle: async () => {
                const row = JSON.parse(JSON.stringify(rows[0]));
                waTemplateRows.push(row);
                return { data: row, error: null };
              }
            })
          })
        };
      }

      if (table === 'users') {
        return {
          select: () => buildSelectChain(() => ({ data: [...usersList], error: null }))
        };
      }

      return {
        select: () => buildSelectChain(() => ({ data: [], error: null })),
        insert: async (rows: any[]) => ({ data: rows, error: null }),
        upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        delete: () => ({ eq: async () => ({ data: null, error: null }) })
      };
    }
  };

  return {
    mockClient,
    appSettingsRows,
    versionRows,
    auditLogsRows,
    roleRows,
    waTemplateRows,
    usersList,
    setForcedError: (err: any) => {
      forcedAppSettingsError = err;
    },
    setForceUnconfirmedUpsert: (flag: boolean) => {
      forceUnconfirmedUpsert = flag;
    }
  };
}

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    }
  };
}

async function runSuite() {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalEnvSupabaseUrl = process.env.SUPABASE_URL;
  const originalEnvSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock_service_role_key_for_verification_only';

  const mock = createGlobalPersistenceMockSupabase();
  setSupabaseBackendClientForTesting(mock.mockClient);

  const storage = createMemoryStorage();
  (globalThis as any).localStorage = storage;

  const app = await createExpressApp({ skipVite: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = raw.startsWith('/') ? `${baseUrl}${raw}` : raw;
    return originalFetch(url, init);
  }) as any;

  // Register real backend session tokens in SERVER_SESSIONS array
  const saToken = 'tok_superadmin_global_test';
  const dispToken = 'tok_dispatch_global_test';
  const leadToken = 'tok_leader_global_test';
  const instToken = 'tok_installer_global_test';
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 8 * 3600_000).toISOString();

  const testSessionEntries = [
    { sessionId: 'gs_sa', token: saToken, userId: 'u_sa_global', username: 'superadmin', name: 'Super Admin Global', role: 'super_admin' as const },
    { sessionId: 'gs_disp', token: dispToken, userId: 'u_disp_global', username: 'dispatch1', name: 'Dispatch One', role: 'dispatch' as const },
    { sessionId: 'gs_lead', token: leadToken, userId: 'u_lead_global', username: 'leader1', name: 'Leader One', role: 'leader' as const },
    { sessionId: 'gs_inst', token: instToken, userId: 'u_inst_global', username: 'installer1', name: 'Installer One', role: 'installer' as const }
  ];
  for (const s of testSessionEntries) {
    SERVER_SESSIONS.push({
      ...s,
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: expiresIso,
      status: 'active',
      ipAddress: '127.0.0.1',
      userAgent: 'GlobalSuperAdminTest',
      deviceType: 'desktop'
    });
  }

  const setActiveUser = (user: any, token: string) => {
    storage.setItem('morajaws_auth_session', JSON.stringify({ token, user }));
    storage.setItem('morajaws_current_user', JSON.stringify(user));
  };

  try {
    // Open a real SSE listener connection as Dispatch user to verify real-time push (Scenario 10 & general SSE)
    const sseEvents: any[] = [];
    const sseReq = http.get(`${baseUrl}/api/supabase/realtime/stream`, {
      headers: { Authorization: `Bearer ${dispToken}` }
    });
    const sseConnected = new Promise<void>((resolve) => {
      sseReq.on('response', (res) => {
        res.setEncoding('utf8');
        let buffer = '';
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data: '));
            if (line) {
              try {
                const parsed = JSON.parse(line.slice(6));
                sseEvents.push(parsed);
                if (parsed.type === 'CONNECTED') resolve();
              } catch {}
            }
          }
        });
      });
    });
    await Promise.race([sseConnected, new Promise((r) => setTimeout(r, 1500))]);

    // -------------------------------------------------------------------------
    // SCENARIO 1: Super Admin changes global setting -> saved in DB
    // -------------------------------------------------------------------------
    setActiveUser(mock.usersList[0], saToken);
    const save1 = await saveGlobalConfig(
      'global_config',
      {
        appName: 'MoraJaws Enterprise v2',
        defaultLanguage: 'id',
        autoRefreshIntervalSeconds: 45,
        maintenanceMode: false
      },
      { module: 'system_settings', notes: 'Initial global setup' }
    );
    const dbRow1 = mock.appSettingsRows.get('global_config');
    const verRow1 = mock.versionRows.find((v) => v.config_key === 'global_config' && v.version === 1);
    const auditRow1 = mock.auditLogsRows.find((a) => a.entity_id === 'global_config');
    assertCheck(
      1,
      'Super Admin changes global setting -> saved in DB (app_settings + global_config_versions + audit_logs)',
      save1.success &&
        save1.version === 1 &&
        dbRow1?.setting_value?.appName === 'MoraJaws Enterprise v2' &&
        Boolean(verRow1) &&
        Boolean(auditRow1),
      `version=${save1.version}, dbAppName=${dbRow1?.setting_value?.appName}, versionRecorded=${Boolean(verRow1)}, audited=${Boolean(auditRow1)}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 2: Another user refreshes -> change persists
    // -------------------------------------------------------------------------
    setActiveUser(mock.usersList[1], dispToken);
    delete (db.appSettings as any).global_config;
    const readByDispatch = await getGlobalConfig<any>('global_config');
    assertCheck(
      2,
      'Another user (Dispatch) refreshes -> latest global setting loaded from PostgreSQL',
      readByDispatch.value?.appName === 'MoraJaws Enterprise v2' && readByDispatch.version === 1,
      `dispatchReadAppName=${readByDispatch.value?.appName}, version=${readByDispatch.version}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 3: Different device login -> latest config loaded via bootstrap
    // -------------------------------------------------------------------------
    setActiveUser(mock.usersList[2], leadToken);
    const bootstrapLeader = await bootstrapGlobalConfigs();
    assertCheck(
      3,
      'Different device/role login (Leader) -> bootstrapGlobalConfigs returns latest configs & versions',
      bootstrapLeader.configs?.global_config?.appName === 'MoraJaws Enterprise v2' &&
        bootstrapLeader.versions?.global_config === 1,
      `leaderBootstrapAppName=${bootstrapLeader.configs?.global_config?.appName}, version=${bootstrapLeader.versions?.global_config}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 4: Menu update -> global menu reflects latest config
    // -------------------------------------------------------------------------
    setActiveUser(mock.usersList[0], saToken);
    const updatedMenuCategories = DEFAULT_CANONICAL_CATEGORIES.map((c, idx) =>
      idx === 0 ? { ...c, label: 'Operasional Harian Global' } : c
    );
    const saveNav = await saveGlobalConfig(
      'navigation_doc',
      {
        categories: updatedMenuCategories,
        standaloneMenus: DEFAULT_STANDALONE_MENUS,
        submenuItems: DEFAULT_SUBMENU_ITEMS
      },
      { module: 'navigation_config', notes: 'Rename primary category globally' }
    );
    setActiveUser(mock.usersList[3], instToken);
    const navForInstaller = await getGlobalConfig<any>('navigation_doc');
    assertCheck(
      4,
      'Menu update by Super Admin -> global menu immediately reflects latest DB config for other users',
      saveNav.success &&
        navForInstaller.value?.categories?.[0]?.label === 'Operasional Harian Global' &&
        navForInstaller.version === 1,
      `savedVer=${saveNav.version}, installerMenuLabel=${navForInstaller.value?.categories?.[0]?.label}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 5: Permission update -> RBAC follows latest config on backend & frontend
    // -------------------------------------------------------------------------
    // 5a: Baseline — leader cannot create WA template (403)
    const preLeaderWaRes = await fetch('/api/supabase/wa-templates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leadToken}`
      },
      body: JSON.stringify({ id: 'tpl_pre_test', name: 'Test Pre', body: 'Hello' })
    });

    // 5b: Super Admin grants 'manage_whatsapp_templates' to leader AND attempts to strip 'login' from super_admin
    setActiveUser(mock.usersList[0], saToken);
    const customMatrix = {
      ...DEFAULT_ROLE_PERMISSIONS,
      super_admin: [], // Should be protected by CORE_SUPER_ADMIN_PERMISSIONS guard!
      leader: [...DEFAULT_ROLE_PERMISSIONS.leader, 'manage_whatsapp_templates']
    };
    const permSave = await saveRolePermissionsToServer(customMatrix, { notes: 'Grant WA template access to leader' });
    setDynamicRolePermissions(permSave.rolePermissions);

    // 5c: Leader immediately calls POST /api/supabase/wa-templates -> allowed (200) without server restart!
    const postLeaderWaRes = await fetch('/api/supabase/wa-templates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leadToken}`
      },
      body: JSON.stringify({ id: 'tpl_post_test', name: 'Leader Allowed Template', body: 'Halo pelanggan' })
    });
    const postLeaderWaJson = await postLeaderWaRes.json().catch(() => null);
    const fetchedMatrix = await getRolePermissionsFromServer();

    assertCheck(
      5,
      'Permission update -> backend requireTemplateManager & frontend hasPermission immediately follow latest DB RBAC matrix + core super_admin lock-out guard holds',
      preLeaderWaRes.status === 403 &&
        postLeaderWaRes.status === 200 &&
        postLeaderWaJson?.success === true &&
        hasPermission('leader', 'manage_whatsapp_templates') === true &&
        fetchedMatrix.rolePermissions.super_admin.includes('application_configuration') &&
        fetchedMatrix.rolePermissions.super_admin.includes('login'),
      `preStatus=${preLeaderWaRes.status}, postStatus=${postLeaderWaRes.status}, frontendLeaderHasPerm=${hasPermission('leader', 'manage_whatsapp_templates')}, saCorePreserved=${fetchedMatrix.rolePermissions.super_admin.includes('application_configuration')}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 6: Browser close & reopen -> clear localStorage + memory, bootstrap from DB
    // -------------------------------------------------------------------------
    storage.clear();
    setTrackedConfigVersion('global_config', 0);
    setTrackedConfigVersion('navigation_doc', 0);
    setActiveUser(mock.usersList[0], saToken);
    const reopenBootstrap = await bootstrapGlobalConfigs();
    assertCheck(
      6,
      'Browser close & reopen (empty localStorage) -> bootstrapGlobalConfigs loads all persisted DB configs & versions',
      reopenBootstrap.configs?.global_config?.appName === 'MoraJaws Enterprise v2' &&
        reopenBootstrap.configs?.navigation_doc?.categories?.[0]?.label === 'Operasional Harian Global' &&
        reopenBootstrap.rolePermissions?.leader?.includes('manage_whatsapp_templates'),
      `reopenAppName=${reopenBootstrap.configs?.global_config?.appName}, reopenNav=${reopenBootstrap.configs?.navigation_doc?.categories?.[0]?.label}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 7: DB failure -> NOT treated as success, previous state preserved & clear error thrown
    // -------------------------------------------------------------------------
    let previousUiValue = (await getGlobalConfig<any>('global_config')).value;
    mock.setForcedError({ code: '08006', message: 'Simulated PostgreSQL connection loss' });
    let dbFailureCaught = false;
    let dbFailureMessage = '';
    try {
      await saveGlobalConfig('global_config', { ...previousUiValue, appName: 'CORRUPTED_LOCAL_ONLY' });
    } catch (err: any) {
      dbFailureCaught = true;
      dbFailureMessage = err?.message || String(err);
    }
    mock.setForcedError(null);
    const afterFailureDbRead = await getGlobalConfig<any>('global_config');
    assertCheck(
      7,
      'DB failure -> rejected cleanly with clear error and previous DB state preserved (no fake success)',
      dbFailureCaught &&
        dbFailureMessage.length > 0 &&
        afterFailureDbRead.value?.appName === 'MoraJaws Enterprise v2' &&
        afterFailureDbRead.version === 1,
      `caught=${dbFailureCaught}, errMsg="${dbFailureMessage}", preservedAppName=${afterFailureDbRead.value?.appName}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 8: Non-Super Admin attempts global config & master data writes -> HTTP 403
    // -------------------------------------------------------------------------
    const nonSaGlobalPut = await fetch('/api/global-config/global_config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dispToken}` },
      body: JSON.stringify({ value: { appName: 'HACKED_BY_DISPATCH' } })
    });
    const nonSaPermPut = await fetch('/api/roles/permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${leadToken}` },
      body: JSON.stringify({ rolePermissions: DEFAULT_ROLE_PERMISSIONS })
    });
    const nonSaOpDatePost = await fetch('/api/system/operational-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${instToken}` },
      body: JSON.stringify({ operationalDate: '2026-12-31', isAuto: false })
    });
    const nonSaContractorPost = await fetch('/api/supabase/contractors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dispToken}` },
      body: JSON.stringify({ name: 'Rogue Vendor', code: 'RV' })
    });
    const stillCleanGlobal = await getGlobalConfig<any>('global_config');
    assertCheck(
      8,
      'Non-Super Admin config & master-data writes -> strictly rejected HTTP 403 & DB untouched',
      nonSaGlobalPut.status === 403 &&
        nonSaPermPut.status === 403 &&
        nonSaOpDatePost.status === 403 &&
        nonSaContractorPost.status === 403 &&
        stillCleanGlobal.value?.appName === 'MoraJaws Enterprise v2',
      `statuses=[global:${nonSaGlobalPut.status}, perms:${nonSaPermPut.status}, opDate:${nonSaOpDatePost.status}, contractor:${nonSaContractorPost.status}]`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 9: Concurrent edit -> stale expectedVersion triggers 409 VERSION_CONFLICT, forceOverwrite resolves
    // -------------------------------------------------------------------------
    setActiveUser(mock.usersList[0], saToken);
    // SA Session A advances global_config to v2
    const saveV2 = await saveGlobalConfig(
      'global_config',
      { appName: 'MoraJaws Enterprise v2.1', defaultLanguage: 'id', autoRefreshIntervalSeconds: 30 },
      { expectedVersion: 1, module: 'system_settings', notes: 'Advance to v2' }
    );
    // SA Session B still holds stale expectedVersion=1 -> MUST throw ConfigConflictError (409)
    let conflictCaught: ConfigConflictError | null = null;
    try {
      await saveGlobalConfig(
        'global_config',
        { appName: 'MoraJaws Stale Overwrite' },
        { expectedVersion: 1, module: 'system_settings' }
      );
    } catch (err: any) {
      if (err instanceof ConfigConflictError || err?.status === 409) {
        conflictCaught = err;
      }
    }
    // Resolve using forceOverwrite: true -> advances to v3
    const resolvedV3 = await saveGlobalConfig(
      'global_config',
      { appName: 'MoraJaws Enterprise v3-Resolved', defaultLanguage: 'en', autoRefreshIntervalSeconds: 60 },
      { forceOverwrite: true, module: 'system_settings', notes: 'Force overwrite after conflict' }
    );
    assertCheck(
      9,
      'Concurrent edit -> stale expectedVersion rejected 409 VERSION_CONFLICT; forceOverwrite resolves cleanly to v3',
      saveV2.version === 2 &&
        Boolean(conflictCaught) &&
        conflictCaught?.conflict?.currentVersion === 2 &&
        conflictCaught?.conflict?.expectedVersion === 1 &&
        resolvedV3.version === 3,
      `v2=${saveV2.version}, conflictCurrentVer=${conflictCaught?.conflict?.currentVersion}, conflictExpectedVer=${conflictCaught?.conflict?.expectedVersion}, resolvedVer=${resolvedV3.version}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 10: Config rollback -> restores v1 snapshot as v4 (append-only) + SSE real-time broadcast
    // -------------------------------------------------------------------------
    await new Promise((r) => setTimeout(r, 80));
    const countEventsBeforeRollback = sseEvents.length;
    const versionsBeforeRollback = await getConfigVersions('global_config', 20);
    const v1Record = versionsBeforeRollback.find((v) => v.version === 1);
    const rbRes = await rollbackGlobalConfig('global_config', {
      targetVersionId: v1Record?.id,
      notes: 'Rollback uji skenario 10 ke v1'
    });
    await new Promise((r) => setTimeout(r, 150));
    const versionsAfterRollback = await getConfigVersions('global_config', 20);
    const latestRollbackEvent = sseEvents
      .slice(countEventsBeforeRollback)
      .find(
        (ev) =>
          ev?.table === 'app_settings' &&
          ev?.record?.key === 'global_config' &&
          ev?.record?.version === 4 &&
          ev?.record?.action === 'ROLLBACK'
      );

    assertCheck(
      10,
      'Config rollback -> restores v1 value as forward version v4 (append-only history) & broadcasts SSE event to active users',
      rbRes.success &&
        rbRes.version === 4 &&
        rbRes.restoredFromVersion === 1 &&
        rbRes.value?.appName === 'MoraJaws Enterprise v2' &&
        versionsAfterRollback.length === 4 &&
        versionsAfterRollback.some((v) => v.version === 4 && v.action === 'ROLLBACK') &&
        Boolean(latestRollbackEvent) &&
        latestRollbackEvent?.record?.version === 4,
      `rbVersion=${rbRes.version}, restoredAppName=${rbRes.value?.appName}, historyLen=${versionsAfterRollback.length}, sseDelivered=${Boolean(latestRollbackEvent)}, sseVersion=${latestRollbackEvent?.record?.version}`
    );

    sseReq.destroy();
  } finally {
    resetSupabaseBackendClientForTesting();
    invalidateGlobalConfigCache();
    for (let i = SERVER_SESSIONS.length - 1; i >= 0; i--) {
      if ([saToken, dispToken, leadToken, instToken].includes(SERVER_SESSIONS[i].token)) {
        SERVER_SESSIONS.splice(i, 1);
      }
    }
    globalThis.fetch = originalFetch;
    if (originalLocalStorage !== undefined) {
      (globalThis as any).localStorage = originalLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
    if (originalEnvSupabaseUrl !== undefined) process.env.SUPABASE_URL = originalEnvSupabaseUrl;
    else delete process.env.SUPABASE_URL;
    if (originalEnvSupabaseServiceKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnvSupabaseServiceKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const passedCount = checks.filter((c) => c.passed).length;
  console.log(`\n=== SUMMARY: ${passedCount}/${checks.length} SCENARIOS PASSED ===`);
  if (passedCount !== checks.length) {
    process.exitCode = 1;
  }
}

runSuite().catch((err) => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
