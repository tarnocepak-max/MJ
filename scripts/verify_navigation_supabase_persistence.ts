/**
 * End-to-End Verification Suite: Navigation Configuration -> Supabase PostgreSQL Persistence
 *
 * Tests the complete pipeline:
 *   supabaseConfigService.ts / navigationService.ts -> supabaseDb.ts -> Express API
 *   (/api/supabase/settings/:key) -> server/supabaseAdapter.ts -> public.app_settings
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { createExpressApp, SERVER_SESSIONS, db } from '../server.ts';
import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from '../server/supabaseClient.ts';
import {
  saveNavigationDocToSupabase,
  loadNavigationDocFromSupabase
} from '../src/services/supabaseConfigService.ts';
import {
  saveNavigationConfigToSupabase,
  loadNavigationConfigFromSupabase
} from '../src/services/navigationService.ts';
import {
  DEFAULT_CANONICAL_CATEGORIES,
  DEFAULT_STANDALONE_MENUS,
  DEFAULT_SUBMENU_ITEMS
} from '../src/constants/defaultConfig.ts';
import { DEFAULT_NAVIGATION_CONFIG } from '../src/constants/defaultNavigationConfig.ts';

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

interface AppSettingRow {
  setting_key: string;
  setting_value: any;
  description: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

function createNavigationTestSupabaseMock() {
  const appSettingsRows = new Map<string, AppSettingRow>();
  let forcedAppSettingsError: any = null;
  let forceUnconfirmedUpsert = false;

  const usersList = [
    { id: 'u_superadmin_nav', username: 'superadmin', name: 'Super Admin', role: 'super_admin', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } },
    { id: 'u_dispatch_nav', username: 'dispatch_1', name: 'Dispatch User', role: 'dispatch', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } },
    { id: 'u_leader_nav', username: 'leader_1', name: 'Leader User', role: 'leader', contractor: 'PT Mora', area: 'Jakarta', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } },
    { id: 'u_installer_nav', username: 'installer_1', name: 'Installer User', role: 'installer', contractor: 'PT Mora', area: 'Jakarta', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } },
    { id: 'u_mgmt_nav', username: 'mgmt_1', name: 'Management Data', role: 'management_data', active: true, is_deleted: false, session_version: 1, payload: { sessionVersion: 1 } }
  ];

  const makeBuilder = (rowsSource: () => { data: any[]; error: any }) => {
    const filters: Array<(row: any) => boolean> = [];
    const apply = () => {
      const res = rowsSource();
      if (res.error) return { data: null, error: res.error };
      let out = Array.isArray(res.data) ? [...res.data] : [];
      for (const f of filters) out = out.filter(f);
      return { data: out, error: null };
    };
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => {
        filters.push((row: any) => String(row?.[col] ?? '') === String(val ?? ''));
        return chain;
      },
      neq: (col: string, val: any) => {
        filters.push((row: any) => String(row?.[col] ?? '') !== String(val ?? ''));
        return chain;
      },
      or: () => chain,
      ilike: (col: string, val: string) => {
        const clean = String(val ?? '').replace(/%/g, '').toLowerCase();
        filters.push((row: any) => String(row?.[col] ?? '').toLowerCase().includes(clean));
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        const res = apply();
        if (res.error) return { data: null, error: res.error };
        return { data: res.data?.[0] ?? null, error: null };
      },
      single: async () => {
        const res = apply();
        if (res.error) return { data: null, error: res.error };
        return { data: res.data?.[0] ?? null, error: res.data?.[0] ? null : { code: 'PGRST116', message: 'Not found' } };
      },
      then: (resolve: any) => resolve(apply())
    };
    return chain;
  };

  const mockClient: any = {
    from: (table: string) => {
      if (table === 'app_settings') {
        return {
          select: (_cols?: string) => {
            let filterKey: string | null = null;
            const chain: any = {
              eq: (col: string, val: any) => {
                if (col === 'setting_key') filterKey = String(val);
                return chain;
              },
              order: () => chain,
              maybeSingle: async () => {
                if (forcedAppSettingsError) return { data: null, error: forcedAppSettingsError };
                if (filterKey !== null) {
                  return { data: appSettingsRows.get(filterKey) ?? null, error: null };
                }
                const first = Array.from(appSettingsRows.values())[0] ?? null;
                return { data: first, error: null };
              },
              then: (resolve: any) => {
                if (forcedAppSettingsError) return resolve({ data: null, error: forcedAppSettingsError });
                if (filterKey !== null) {
                  const row = appSettingsRows.get(filterKey);
                  return resolve({ data: row ? [row] : [], error: null });
                }
                return resolve({ data: Array.from(appSettingsRows.values()), error: null });
              }
            };
            return chain;
          },
          upsert: (rows: any[], opts?: { onConflict?: string }) => {
            if (!Array.isArray(rows)) {
              throw new Error('upsert expected array payload for PostgreSQL compatibility');
            }
            if (opts?.onConflict !== 'setting_key') {
              throw new Error(`Expected onConflict='setting_key', received '${opts?.onConflict}'`);
            }
            return {
              select: (_cols?: string) => ({
                maybeSingle: async () => {
                  if (forcedAppSettingsError) {
                    return { data: null, error: forcedAppSettingsError };
                  }
                  if (forceUnconfirmedUpsert) {
                    return { data: null, error: null };
                  }
                  const input = rows[0];
                  const existing = appSettingsRows.get(input.setting_key);
                  const now = input.updated_at || new Date().toISOString();
                  const stored: AppSettingRow = {
                    setting_key: input.setting_key,
                    setting_value: JSON.parse(JSON.stringify(input.setting_value)),
                    description: input.description ?? existing?.description ?? null,
                    updated_by: input.updated_by ?? null,
                    created_at: existing?.created_at ?? now,
                    updated_at: now
                  };
                  appSettingsRows.set(input.setting_key, stored);
                  return { data: stored, error: null };
                }
              })
            };
          }
        };
      }

      if (table === 'users') {
        return {
          select: () => makeBuilder(() => ({ data: usersList, error: null }))
        };
      }

      if (table === 'audit_logs') {
        return {
          insert: () => makeBuilder(() => ({ data: [], error: null })),
          select: () => makeBuilder(() => ({ data: [], error: null }))
        };
      }

      return {
        select: () => makeBuilder(() => ({ data: [], error: null })),
        insert: () => makeBuilder(() => ({ data: [], error: null }))
      };
    }
  };

  return {
    mockClient,
    getRows: () => appSettingsRows,
    setForcedError: (err: any) => { forcedAppSettingsError = err; },
    setForceUnconfirmedUpsert: (flag: boolean) => { forceUnconfirmedUpsert = flag; }
  };
}

function setupSessions() {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  SERVER_SESSIONS.length = 0;

  const roles = [
    { sessionId: 's_sa', token: 'tok_superadmin_test_123', userId: 'u_superadmin_nav', username: 'superadmin', name: 'Super Admin', role: 'super_admin' as const },
    { sessionId: 's_disp', token: 'tok_dispatch_test_123', userId: 'u_dispatch_nav', username: 'dispatch_1', name: 'Dispatch User', role: 'dispatch' as const },
    { sessionId: 's_lead', token: 'tok_leader_test_123', userId: 'u_leader_nav', username: 'leader_1', name: 'Leader User', role: 'leader' as const },
    { sessionId: 's_inst', token: 'tok_installer_test_123', userId: 'u_installer_nav', username: 'installer_1', name: 'Installer User', role: 'installer' as const },
    { sessionId: 's_mgmt', token: 'tok_mgmt_test_123', userId: 'u_mgmt_nav', username: 'mgmt_1', name: 'Management Data', role: 'management_data' as const }
  ];

  for (const r of roles) {
    SERVER_SESSIONS.push({
      ...r,
      sessionVersion: 1,
      loginAt: now,
      lastActivityAt: now,
      expiresAt: future,
      status: 'active',
      ipAddress: '127.0.0.1',
      userAgent: 'NavPersistenceTest',
      deviceType: 'desktop'
    });
  }

  if (Array.isArray(db.users)) {
    for (const u of db.users) {
      u.sessionVersion = 1;
      (u as any).session_version = 1;
    }
  }
}

async function run() {
  const mock = createNavigationTestSupabaseMock();
  setSupabaseBackendClientForTesting(mock.mockClient);
  setupSessions();

  const app = await createExpressApp({ skipVite: true });
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Browser-like storage & fetch shim so frontend services execute directly against real Express HTTP
  let activeSessionToken: string | null = 'tok_superadmin_test_123';
  const localStore = new Map<string, string>();
  const syncStorage = () => {
    if (activeSessionToken) {
      localStore.set('morajaws_auth_session', JSON.stringify({ token: activeSessionToken }));
    } else {
      localStore.delete('morajaws_auth_session');
    }
  };
  syncStorage();

  (globalThis as any).localStorage = {
    getItem: (k: string) => localStore.get(k) ?? null,
    setItem: (k: string, v: string) => { localStore.set(k, String(v)); },
    removeItem: (k: string) => { localStore.delete(k); },
    clear: () => localStore.clear()
  };

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/')) {
      return originalFetch(`${baseUrl}${url}`, init);
    }
    return originalFetch(input, init);
  };

  try {
    // 1. INSERT new navigation_doc as Super Admin
    const initialDoc = {
      categories: DEFAULT_CANONICAL_CATEGORIES.map(c => ({ ...c })),
      standaloneMenus: DEFAULT_STANDALONE_MENUS.map(m => ({ ...m })),
      submenuItems: DEFAULT_SUBMENU_ITEMS.map(s => ({ ...s })),
      accordionSettings: { allowMultipleOpenGroups: true },
      navigationVersion: 1,
      updatedAt: '2026-11-15T01:00:00.000Z',
      updatedBy: 'Super Admin'
    };
    const insertRes = await saveNavigationDocToSupabase(initialDoc);
    const rowAfterInsert = mock.getRows().get('navigation_doc');
    const createdAtInitial = rowAfterInsert?.created_at;
    assertCheck(
      1,
      'INSERT konfigurasi navigasi baru (navigation_doc) ke app_settings',
      Boolean(
        insertRes.success &&
        mock.getRows().size === 1 &&
        rowAfterInsert &&
        rowAfterInsert.setting_key === 'navigation_doc' &&
        rowAfterInsert.setting_value.categories.length === DEFAULT_CANONICAL_CATEGORIES.length &&
        rowAfterInsert.setting_value.standaloneMenus.length === DEFAULT_STANDALONE_MENUS.length &&
        rowAfterInsert.setting_value.submenuItems.length === DEFAULT_SUBMENU_ITEMS.length
      ),
      `rows=${mock.getRows().size}, categories=${rowAfterInsert?.setting_value?.categories?.length}, standalone=${rowAfterInsert?.setting_value?.standaloneMenus?.length}, submenus=${rowAfterInsert?.setting_value?.submenuItems?.length}`
    );

    // 2. UPDATE existing navigation_doc (edit category label, standalone label, preserve icons & roles)
    await new Promise(r => setTimeout(r, 15));
    const editedDoc = {
      ...initialDoc,
      categories: initialDoc.categories.map((c, idx) =>
        idx === 0 ? { ...c, name: 'Contractor & Wilayah Operasi' } : c
      ),
      standaloneMenus: initialDoc.standaloneMenus.map(m =>
        m.id === 'dashboard' ? { ...m, label: 'Pusat Monitoring Utama' } : m
      ),
      navigationVersion: 2,
      updatedAt: new Date().toISOString(),
      updatedBy: 'Super Admin'
    };
    const updateRes = await saveNavigationDocToSupabase(editedDoc);
    const rowAfterUpdate = mock.getRows().get('navigation_doc');
    const allSubmenusPreserved = rowAfterUpdate?.setting_value?.submenuItems?.length === DEFAULT_SUBMENU_ITEMS.length;
    const iconAndRolesPreserved = rowAfterUpdate?.setting_value?.standaloneMenus?.every((m: any) => Boolean(m.icon) && Array.isArray(m.roles));
    assertCheck(
      2,
      'UPDATE konfigurasi navigasi existing tanpa menghilangkan menu, submenu, ikon, atau role',
      Boolean(
        updateRes.success &&
        mock.getRows().size === 1 &&
        rowAfterUpdate?.setting_value?.categories?.[0]?.name === 'Contractor & Wilayah Operasi' &&
        rowAfterUpdate?.setting_value?.standaloneMenus?.find((m: any) => m.id === 'dashboard')?.label === 'Pusat Monitoring Utama' &&
        rowAfterUpdate?.created_at === createdAtInitial &&
        allSubmenusPreserved &&
        iconAndRolesPreserved
      ),
      `rows=${mock.getRows().size}, createdAtPreserved=${rowAfterUpdate?.created_at === createdAtInitial}, submenus=${rowAfterUpdate?.setting_value?.submenuItems?.length}, iconsAndRolesIntact=${iconAndRolesPreserved}`
    );

    // 3. Repeated UPSERT (5x) without duplicating records
    for (let i = 3; i <= 7; i++) {
      await saveNavigationDocToSupabase({
        ...editedDoc,
        navigationVersion: i,
        updatedAt: new Date().toISOString()
      });
    }
    const navKeysCount = Array.from(mock.getRows().keys()).filter(k => k === 'navigation_doc').length;
    assertCheck(
      3,
      'UPSERT berulang (5x berturut-turut) tidak membuat duplikasi record',
      navKeysCount === 1 && mock.getRows().size === 1 && mock.getRows().get('navigation_doc')?.setting_value?.navigationVersion === 7,
      `navigation_doc count=${navKeysCount}, total rows=${mock.getRows().size}, latestVersion=${mock.getRows().get('navigation_doc')?.setting_value?.navigationVersion}`
    );

    // 4. Refresh & Logout/Re-login simulation across roles
    activeSessionToken = null;
    syncStorage();
    let unauthRejected = false;
    let unauthErrMsg = '';
    try {
      await loadNavigationDocFromSupabase();
    } catch (err: any) {
      unauthRejected = true;
      unauthErrMsg = err?.message || '';
    }

    // Login as Dispatch, Leader, Installer, then Super Admin (re-login)
    const loadedByRole: Record<string, string | undefined> = {};
    for (const [roleName, tok] of [
      ['dispatch', 'tok_dispatch_test_123'],
      ['leader', 'tok_leader_test_123'],
      ['installer', 'tok_installer_test_123'],
      ['super_admin', 'tok_superadmin_test_123']
    ]) {
      activeSessionToken = tok;
      syncStorage();
      const loaded = await loadNavigationDocFromSupabase();
      loadedByRole[roleName] = loaded?.categories?.[0]?.name;
    }

    assertCheck(
      4,
      'Sinkronisasi pasca-refresh & logout/login ulang across roles (semua role membaca data tersimpan, unauthenticated ditolak 401)',
      Boolean(
        unauthRejected &&
        unauthErrMsg.includes('401') &&
        loadedByRole.dispatch === 'Contractor & Wilayah Operasi' &&
        loadedByRole.leader === 'Contractor & Wilayah Operasi' &&
        loadedByRole.installer === 'Contractor & Wilayah Operasi' &&
        loadedByRole.super_admin === 'Contractor & Wilayah Operasi'
      ),
      `unauthRejected=${unauthRejected} (${unauthErrMsg}), loadedByRole=${JSON.stringify(loadedByRole)}`
    );

    // 5. Unauthorized role save attempt MUST be rejected 403 & NOT overwrite DB
    const forbiddenRoles: Array<[string, string]> = [
      ['dispatch', 'tok_dispatch_test_123'],
      ['leader', 'tok_leader_test_123'],
      ['installer', 'tok_installer_test_123'],
      ['management_data', 'tok_mgmt_test_123']
    ];
    let allForbiddenRejected = true;
    const rejectionMsgs: string[] = [];
    for (const [roleName, tok] of forbiddenRoles) {
      activeSessionToken = tok;
      syncStorage();
      try {
        await saveNavigationDocToSupabase({
          ...editedDoc,
          categories: [{ ...editedDoc.categories[0], name: 'HIJACKED_' + roleName }]
        });
        allForbiddenRejected = false;
      } catch (err: any) {
        const m = err?.message || '';
        rejectionMsgs.push(`${roleName}: ${m}`);
        if (!m.includes('403') || m.includes('Gagal menyimpan ke Supabase PostgreSQL: Gagal menyimpan')) {
          allForbiddenRejected = false;
        }
      }
    }
    const dbIntactAfterForbidden = mock.getRows().get('navigation_doc')?.setting_value?.categories?.[0]?.name === 'Contractor & Wilayah Operasi';
    assertCheck(
      5,
      'Penolakan RBAC untuk role tanpa izin (dispatch, leader, installer, management_data -> HTTP 403, data DB utuh)',
      allForbiddenRejected && dbIntactAfterForbidden,
      `dbIntact=${dbIntactAfterForbidden} | sample=${rejectionMsgs[0]}`
    );

    // 6. Legacy navigation_config endpoint also works for Super Admin & blocks non-super_admin
    activeSessionToken = 'tok_superadmin_test_123';
    syncStorage();
    const navCfgRes = await saveNavigationConfigToSupabase(DEFAULT_NAVIGATION_CONFIG, 'Super Admin');
    const navCfgLoaded = await loadNavigationConfigFromSupabase();
    assertCheck(
      6,
      'Endpoint navigation_config (NavigationContext) juga tersimpan & terbaca konsisten di app_settings',
      Boolean(navCfgRes.success && navCfgLoaded && navCfgLoaded.categories.length === DEFAULT_NAVIGATION_CONFIG.categories.length),
      `updatedAt=${navCfgRes.updatedAt}, categories=${navCfgLoaded?.categories?.length}`
    );

    // 7. Validation & Real DB/RLS error surfacing (no secret leak, no double generic wrapper)
    let invalidPayloadRejected = false;
    try {
      await saveNavigationDocToSupabase({
        ...editedDoc,
        categories: []
      });
    } catch (err: any) {
      invalidPayloadRejected = Boolean(err?.message?.includes('400') && err?.message?.includes('INVALID_NAVIGATION_CATEGORIES'));
    }

    mock.setForcedError({
      code: '42501',
      message: 'new row violates row-level security policy for table "app_settings"',
      hint: 'Ensure service_role policy is active'
    });
    let rlsErrorSurfaced = false;
    let rlsMsg = '';
    try {
      await saveNavigationDocToSupabase(editedDoc);
    } catch (err: any) {
      rlsMsg = err?.message || '';
      rlsErrorSurfaced =
        rlsMsg.includes('HTTP 403') &&
        rlsMsg.includes('42501') &&
        rlsMsg.includes('app_settings') &&
        rlsMsg.includes('UPSERT') &&
        !rlsMsg.includes('tok_superadmin_test_123') &&
        !rlsMsg.includes('SERVICE_ROLE');
    }

    mock.setForcedError({
      code: 'PGRST205',
      message: "Could not find the table 'public.app_settings' in the schema cache"
    });
    let schemaErrSurfaced = false;
    try {
      await saveNavigationDocToSupabase(editedDoc);
    } catch (err: any) {
      const m = err?.message || '';
      schemaErrSurfaced = m.includes('HTTP 503') && m.includes('PGRST205') && m.includes('app_settings');
    }
    mock.setForcedError(null);

    const savedSnapshotBackup = mock.getRows().get('navigation_doc');
    mock.getRows().delete('navigation_doc');
    mock.setForceUnconfirmedUpsert(true);
    let unconfirmedCaught = false;
    try {
      await saveNavigationDocToSupabase(editedDoc);
    } catch (err: any) {
      unconfirmedCaught = Boolean(err?.message?.includes('UPSERT_NO_CONFIRMATION'));
    }
    mock.setForceUnconfirmedUpsert(false);
    if (savedSnapshotBackup) {
      mock.getRows().set('navigation_doc', savedSnapshotBackup);
    }

    assertCheck(
      7,
      'Validasi payload (400), error RLS (42501->403), schema error (PGRST205->503), dan unconfirmed upsert fail-closed tanpa bocorkan secret',
      invalidPayloadRejected && rlsErrorSurfaced && schemaErrSurfaced && unconfirmedCaught,
      `invalid=${invalidPayloadRejected}, rls=${rlsErrorSurfaced} ("${rlsMsg}"), schema=${schemaErrSurfaced}, unconfirmed=${unconfirmedCaught}`
    );

    // 8. Migration 010 & Frontend isolation check
    const migSql = fs.readFileSync(path.resolve('migrations/010_app_settings_navigation_alignment.sql'), 'utf8');
    const migExecutableSql = migSql
      .split('\n')
      .map(line => line.replace(/--.*$/, ''))
      .join('\n');
    const hasSafeDdl =
      /CREATE TABLE IF NOT EXISTS public\.app_settings/i.test(migExecutableSql) &&
      /setting_key\s+text\s+PRIMARY\s+KEY/i.test(migExecutableSql) &&
      /ENABLE ROW LEVEL SECURITY/i.test(migExecutableSql) &&
      migExecutableSql.includes('app_settings_service_role_all') &&
      /REVOKE ALL ON TABLE public\.app_settings FROM anon,\s*authenticated/i.test(migExecutableSql) &&
      !/\b(DROP\s+TABLE|TRUNCATE(\s+TABLE)?|DELETE\s+FROM)\b/i.test(migExecutableSql);

    const uiConfigSrc = fs.readFileSync(path.resolve('src/context/UIConfigContext.tsx'), 'utf8');
    const noSecretInUi = !uiConfigSrc.includes('SUPABASE_SERVICE_ROLE_KEY') && !uiConfigSrc.includes('createClient(');

    assertCheck(
      8,
      'Migration 010 aman (idempotent, RLS aktif, zero DROP/TRUNCATE/DELETE) & frontend bebas secret',
      hasSafeDdl && noSecretInUi,
      `hasSafeDdl=${hasSafeDdl}, noSecretInUi=${noSecretInUi}`
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
    resetSupabaseBackendClientForTesting();
    server.close();
  }

  const failed = checks.filter(c => !c.passed);
  console.log(`\nSummary: ${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
