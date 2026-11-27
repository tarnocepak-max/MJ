import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  createExpressApp,
  SERVER_SESSIONS
} from '../server.ts';

import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from '../server/supabaseClient.ts';

import { canRoleNavigateToTab } from '../src/components/notification/useNotificationCenter.ts';

function readWorkspaceFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function createQuotaMockSupabase() {
  const appSettings = new Map<string, any>();
  const appSettingVersions: any[] = [];
  const auditLogs: any[] = [];
  const users = [
    {
      id: 'usr_super_1',
      name: 'Super Admin MoraJaws',
      username: 'superadmin',
      role: 'super_admin',
      active: true,
      is_deleted: false,
      session_version: 1
    },
    {
      id: 'usr_dispatch_1',
      name: 'Dispatch Ops',
      username: 'dispatch_ops',
      role: 'dispatch',
      active: true,
      is_deleted: false,
      session_version: 1
    },
    {
      id: 'usr_leader_1',
      name: 'Leader Mitra A',
      username: 'leader_mitra_a',
      role: 'leader',
      contractor: 'PT Fiberindo Mitra',
      contractor_id: 'ctr_fm_01',
      area: 'Bandung 02',
      active: true,
      is_deleted: false,
      session_version: 1
    },
    {
      id: 'usr_installer_1',
      name: 'Installer Lapangan',
      username: 'inst_lapangan',
      role: 'installer',
      contractor: 'PT Fiberindo Mitra',
      contractor_id: 'ctr_fm_01',
      area: 'Bandung 02',
      active: true,
      is_deleted: false,
      session_version: 1
    }
  ];

  const client: any = {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => {
            const filters: Array<[string, any]> = [];
            const builder: any = {
              eq: (col: string, val: any) => {
                filters.push([col, val]);
                return builder;
              },
              or: () => builder,
              order: () => builder,
              limit: () => builder,
              single: async () => {
                const matched = users.filter(u => filters.every(([c, v]) => (u as any)[c] === v));
                return {
                  data: matched[0] ? { ...matched[0] } : null,
                  error: matched[0] ? null : { code: 'PGRST116', message: 'Not found' }
                };
              },
              maybeSingle: async () => {
                const matched = users.filter(u => filters.every(([c, v]) => (u as any)[c] === v));
                return { data: matched[0] ? { ...matched[0] } : null, error: null };
              },
              then: (resolve: (v: any) => any) => {
                const matched = users.filter(u => filters.every(([c, v]) => (u as any)[c] === v));
                return Promise.resolve({ data: matched.map(u => ({ ...u })), error: null }).then(resolve);
              }
            };
            return builder;
          }
        };
      }

      if (table === 'app_settings') {
        return {
          select: () => {
            let keyFilter = '';
            const builder: any = {
              eq: (col: string, val: any) => {
                if (col === 'setting_key') keyFilter = String(val);
                return builder;
              },
              maybeSingle: async () => {
                const row = appSettings.get(keyFilter) || null;
                return { data: row ? { ...row } : null, error: null };
              },
              then: (resolve: (v: any) => any) => {
                const rows = keyFilter
                  ? (appSettings.has(keyFilter) ? [{ ...appSettings.get(keyFilter) }] : [])
                  : Array.from(appSettings.values());
                return Promise.resolve({ data: rows, error: null }).then(resolve);
              }
            };
            return builder;
          },
          upsert: (rows: any[]) => ({
            select: () => ({
              maybeSingle: async () => {
                const row = rows[0];
                const saved = {
                  ...row,
                  created_at: appSettings.get(row.setting_key)?.created_at || row.updated_at || new Date().toISOString()
                };
                appSettings.set(row.setting_key, saved);
                return { data: { ...saved }, error: null };
              }
            })
          })
        };
      }

      if (table === 'app_setting_versions') {
        return {
          insert: (rows: any[]) => ({
            select: () => ({
              maybeSingle: async () => {
                const rec = { ...rows[0], id: `ver_${appSettingVersions.length + 1}` };
                appSettingVersions.push(rec);
                return { data: rec, error: null };
              }
            })
          })
        };
      }

      if (table === 'audit_logs') {
        return {
          insert: (rows: any[]) => {
            auditLogs.push(...rows);
            return Promise.resolve({ data: rows, error: null });
          },
          select: () => Promise.resolve({ data: auditLogs, error: null })
        };
      }

      return {
        select: () => {
          const builder: any = {
            eq: () => builder,
            or: () => builder,
            order: () => builder,
            limit: () => builder,
            single: async () => ({ data: null, error: { code: 'PGRST116', message: 'Not found' } }),
            maybeSingle: async () => ({ data: null, error: null }),
            then: (resolve: (v: any) => any) => Promise.resolve({ data: [], error: null }).then(resolve)
          };
          return builder;
        }
      };
    }
  };

  return { client, appSettings, auditLogs };
}

test('RBAC Backend: /api/leader/quota-config strictly super_admin only (403 for dispatch/leader/installer); /api/leader/technician-capacity read-only for leader & super_admin', async () => {
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock_service_role_key_for_test';

  const mock = createQuotaMockSupabase();
  setSupabaseBackendClientForTesting(mock.client);
  const savedSessions = [...SERVER_SESSIONS];
  SERVER_SESSIONS.length = 0;

  const nowIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();

  SERVER_SESSIONS.push(
    {
      sessionId: 'sess_sa',
      token: 'tok_sa',
      userId: 'usr_super_1',
      username: 'superadmin',
      name: 'Super Admin MoraJaws',
      role: 'super_admin',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active',
      ipAddress: '127.0.0.1',
      userAgent: 'TestSuite',
      deviceType: 'desktop'
    },
    {
      sessionId: 'sess_disp',
      token: 'tok_disp',
      userId: 'usr_dispatch_1',
      username: 'dispatch_ops',
      name: 'Dispatch Ops',
      role: 'dispatch',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active',
      ipAddress: '127.0.0.1',
      userAgent: 'TestSuite',
      deviceType: 'desktop'
    },
    {
      sessionId: 'sess_lead',
      token: 'tok_lead',
      userId: 'usr_leader_1',
      username: 'leader_mitra_a',
      name: 'Leader Mitra A',
      role: 'leader',
      contractor: 'PT Fiberindo Mitra',
      contractorId: 'ctr_fm_01',
      area: 'Bandung 02',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active',
      ipAddress: '127.0.0.1',
      userAgent: 'TestSuite',
      deviceType: 'desktop'
    },
    {
      sessionId: 'sess_inst',
      token: 'tok_inst',
      userId: 'usr_installer_1',
      username: 'inst_lapangan',
      name: 'Installer Lapangan',
      role: 'installer',
      contractor: 'PT Fiberindo Mitra',
      contractorId: 'ctr_fm_01',
      area: 'Bandung 02',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active',
      ipAddress: '127.0.0.1',
      userAgent: 'TestSuite',
      deviceType: 'mobile'
    }
  );

  const app = await createExpressApp({ skipVite: true, apiOnly: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. PUT /api/leader/quota-config by Superadmin succeeds and saves for requested contractor
    const saPut = await fetch(`${baseUrl}/api/leader/quota-config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok_sa'
      },
      body: JSON.stringify({
        contractorName: 'PT Fiberindo Mitra',
        defaultMaxDailyQuota: 6,
        enforceStrictLimit: true,
        customInstallerLimits: { 'Installer Lapangan': 8 }
      })
    });
    assert.equal(saPut.status, 200);
    const saPutJson = await saPut.json();
    assert.equal(saPutJson.success, true);
    assert.equal(saPutJson.config.defaultMaxDailyQuota, 6);
    assert.equal(saPutJson.config.enforceStrictLimit, true);

    // 2. GET /api/leader/quota-config by Superadmin returns 200
    const saGet = await fetch(`${baseUrl}/api/leader/quota-config?contractor=${encodeURIComponent('PT Fiberindo Mitra')}`, {
      headers: { Authorization: 'Bearer tok_sa' }
    });
    assert.equal(saGet.status, 200);
    const saGetJson = await saGet.json();
    assert.equal(saGetJson.config.defaultMaxDailyQuota, 6);
    assert.equal(saGetJson.config.customInstallerLimits['Installer Lapangan'], 8);

    // 3. GET & PUT /api/leader/quota-config MUST return 403 FORBIDDEN_SUPERADMIN_ONLY for dispatch, leader, installer
    for (const [roleLabel, token] of [
      ['dispatch', 'tok_disp'],
      ['leader', 'tok_lead'],
      ['installer', 'tok_inst']
    ] as const) {
      const getRes = await fetch(`${baseUrl}/api/leader/quota-config?contractor=${encodeURIComponent('PT Fiberindo Mitra')}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(getRes.status, 403, `Expected GET quota-config 403 for ${roleLabel}`);
      const getJson = await getRes.json();
      assert.equal(getJson.code, 'FORBIDDEN_SUPERADMIN_ONLY');

      const putRes = await fetch(`${baseUrl}/api/leader/quota-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          contractorName: 'PT Fiberindo Mitra',
          defaultMaxDailyQuota: 10,
          enforceStrictLimit: false
        })
      });
      assert.equal(putRes.status, 403, `Expected PUT quota-config 403 for ${roleLabel}`);
      const putJson = await putRes.json();
      assert.equal(putJson.code, 'FORBIDDEN_SUPERADMIN_ONLY');
    }

    // 4. GET /api/leader/technician-capacity:
    //    - Leader gets 200 readOnly scoped to own contractor (ignores cross-contractor query)
    //    - Superadmin gets 200
    //    - Dispatch & Installer get 403
    const leadCap = await fetch(`${baseUrl}/api/leader/technician-capacity?contractor=PT+Kompetitor+Lain`, {
      headers: { Authorization: 'Bearer tok_lead' }
    });
    assert.equal(leadCap.status, 200);
    const leadCapJson = await leadCap.json();
    assert.equal(leadCapJson.readOnly, true);
    assert.equal(leadCapJson.config.contractorName, 'PT Fiberindo Mitra');
    assert.equal(leadCapJson.config.defaultMaxDailyQuota, 6);

    const saCap = await fetch(`${baseUrl}/api/leader/technician-capacity?contractor=${encodeURIComponent('PT Fiberindo Mitra')}`, {
      headers: { Authorization: 'Bearer tok_sa' }
    });
    assert.equal(saCap.status, 200);

    for (const [roleLabel, token] of [
      ['dispatch', 'tok_disp'],
      ['installer', 'tok_inst']
    ] as const) {
      const capRes = await fetch(`${baseUrl}/api/leader/technician-capacity`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(capRes.status, 403, `Expected GET technician-capacity 403 for ${roleLabel}`);
    }
  } finally {
    if (typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    SERVER_SESSIONS.length = 0;
    SERVER_SESSIONS.push(...savedSessions);
    resetSupabaseBackendClientForTesting();
    if (prevSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevSupabaseUrl;
    if (prevSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseKey;
  }
});

test('Frontend RBAC & Navigation: quota_settings accessible strictly by super_admin only', () => {
  assert.equal(canRoleNavigateToTab('super_admin', 'quota_settings'), true);
  assert.equal(canRoleNavigateToTab('dispatch', 'quota_settings'), false);
  assert.equal(canRoleNavigateToTab('leader', 'quota_settings'), false);
  assert.equal(canRoleNavigateToTab('installer', 'quota_settings'), false);

  const uiConfigSrc = readWorkspaceFile('src/context/UIConfigContext.tsx');
  assert.match(uiConfigSrc, /if \(item\.id === 'quota_settings'\)[\s\S]*?roles:\s*\['super_admin'\]/);

  const sidebarSrc = readWorkspaceFile('src/components/layout/Sidebar.tsx');
  assert.match(sidebarSrc, /menuId === 'quota_settings'[\s\S]*?userRole === 'super_admin'/);

  const appSrc = readWorkspaceFile('src/App.tsx');
  assert.match(appSrc, /currentUser\?\.role !== 'super_admin' && targetTab === 'quota_settings'/);
});

test('UI Audit #1: Ticket MyRepublic uses Expandable Table Row (no row-detail checkbox), keeps operational bulk checkboxes', () => {
  const tableSrc = readWorkspaceFile('src/components/tickets/TicketsTable.tsx');
  const mobileSrc = readWorkspaceFile('src/components/tickets/TicketMobileCard.tsx');

  // Dedicated Expand/Collapse button + smooth inline expansion
  assert.match(tableSrc, /data-testid=\{`ticket-expand-\$\{ticket\.woNumber\}`\}/);
  assert.match(tableSrc, /aria-expanded=\{isExpanded\}/);
  assert.match(tableSrc, /animate-in fade-in slide-in-from-top-1 duration-200/);
  assert.match(tableSrc, /toggleInlineDrawer\(ticket\)/);

  // Mobile card also has explicit expand/collapse control without touching bulk checkbox
  assert.match(mobileSrc, /aria-label=\{isExpanded \? `Collapse detail \$\{ticket\.woNumber\}` : `Expand detail \$\{ticket\.woNumber\}`\}/);
  assert.match(mobileSrc, /aria-expanded=\{isExpanded\}/);
  assert.match(mobileSrc, /animate-in fade-in slide-in-from-top-1 duration-200/);

  // Operational bulk-selection toolbar & checkboxes remain preserved
  assert.match(tableSrc, /TableSelectionToolbar/);
  assert.match(tableSrc, /handleToggleSelect/);
  assert.match(mobileSrc, /onToggleSelect/);
});

test('UI Audit #2 & #3: Leader Assign WO removes Ganti Password & Smart Dispatch/Auto-Balance; Quota UI restricted to Superadmin', () => {
  const leaderPortalSrc = readWorkspaceFile('src/components/portals/LeaderPortal.tsx');
  const commandHubSrc = readWorkspaceFile('src/components/portals/StitchLeaderCommandHub.tsx');
  const matrixPanelSrc = readWorkspaceFile('src/components/portals/LeaderAssignMatrixPanel.tsx');
  const reassignViewSrc = readWorkspaceFile('src/components/portals/LeaderReassignView.tsx');
  const quotaSidebarSrc = readWorkspaceFile('src/components/portals/LeaderQuotaSidebar.tsx');
  const quotaModalsSrc = readWorkspaceFile('src/components/portals/LeaderQuotaModals.tsx');

  // Leader Assign WO / Portal must not contain Ganti Password or Smart Dispatch / Auto-Balance
  assert.doesNotMatch(leaderPortalSrc, /Ganti Password/);
  assert.doesNotMatch(leaderPortalSrc, /setIsChangePasswordModalOpen/);
  assert.doesNotMatch(leaderPortalSrc, /Smart Dispatch/);
  assert.doesNotMatch(leaderPortalSrc, /handleExecuteAutoBalance/);
  assert.doesNotMatch(leaderPortalSrc, /computeAutoBalancePlan/);

  assert.doesNotMatch(commandHubSrc, /Smart Auto-Balance/);
  assert.doesNotMatch(commandHubSrc, /Auto-Balance/);
  assert.doesNotMatch(commandHubSrc, /computeAutoBalancePlan/);
  assert.doesNotMatch(commandHubSrc, /handleExecuteAutoBalance/);

  assert.doesNotMatch(matrixPanelSrc, /Auto-Balance/);
  assert.doesNotMatch(matrixPanelSrc, /onExecuteAutoBalance/);
  assert.doesNotMatch(reassignViewSrc, /onExecuteAutoBalance/);

  // Quota management strictly gated by isSuperAdminRole / canManageQuota
  assert.match(leaderPortalSrc, /const isSuperAdminRole = currentUser\.role === 'super_admin'/);
  assert.match(leaderPortalSrc, /canManageQuota=\{isSuperAdminRole\}/);
  assert.match(quotaSidebarSrc, /canManageQuota\s*=\s*false/);
  assert.match(quotaModalsSrc, /canManageQuota:\s*boolean/);
  assert.match(quotaModalsSrc, /if\s*\(!canManageQuota\s*\|\|\s*isSaving\)\s*return/);
});

test('UI Audit #4: Overdue WO removes all checkboxes & selection toolbar and standardizes actions into Kebab Menu (⋮)', () => {
  const overdueSrc = readWorkspaceFile('src/components/tickets/OverdueWorkOrdersView.tsx');

  assert.doesNotMatch(overdueSrc, /type="checkbox"/);
  assert.doesNotMatch(overdueSrc, /TableSelectionToolbar/);
  assert.doesNotMatch(overdueSrc, /selectedTicketIds/);
  assert.doesNotMatch(overdueSrc, /Pilih Semua di Halaman/);

  // Standardized Kebab Menu with Ubah Schedule Appointment Date preserved
  assert.match(overdueSrc, /ActionDropdownMenu/);
  assert.match(overdueSrc, /renderRowActionMenu/);
  assert.match(overdueSrc, /Ubah Schedule Appointment Date/);
  assert.match(overdueSrc, /canRescheduleTicket/);
});

test('UI Audit #5: Dashboard Monitoring orders Monitoring Status Operasional (#1) before Approval Work Order (#2) for Superadmin & Dispatch', () => {
  const overviewSrc = readWorkspaceFile('src/components/dashboard/DashboardOverview.tsx');
  const heroSrc = readWorkspaceFile('src/components/dashboard/OpsCommandHero.tsx');
  const kpiSrc = readWorkspaceFile('src/components/dashboard/DashboardKpiSummaryCards.tsx');

  // Overview passes operational_and_approval into OpsCommandHero's overviewTopSlot and perspectives_only below
  assert.match(overviewSrc, /overviewTopSlot=\{/);
  assert.match(overviewSrc, /sectionMode="operational_and_approval"/);
  assert.match(overviewSrc, /sectionMode=\{isMonitoringPriorityRole \? 'perspectives_only' : 'full'\}/);

  // OpsCommandHero renders overviewTopSlot inside overview before Stitch workspace
  assert.match(heroSrc, /\{activeView === 'overview' && \([\s\S]*?\{overviewTopSlot\}[\s\S]*?<StitchDispatchWorkspace/);

  // Inside DashboardKpiSummaryCards, Position 1 (Monitoring Status Operasional) appears before Position 2 (Approval Work Order)
  const posOperational = kpiSrc.indexOf('data-testid="dashboard-monitoring-operational"');
  const posApproval = kpiSrc.indexOf('data-testid="dashboard-approval-work-order"');
  assert.ok(posOperational !== -1, 'Missing dashboard-monitoring-operational section');
  assert.ok(posApproval !== -1, 'Missing dashboard-approval-work-order section');
  assert.ok(posOperational < posApproval, 'Monitoring Status Operasional must render before Approval Work Order');
  assert.match(kpiSrc, /Monitoring Status Operasional/);
  assert.match(kpiSrc, /Approval Work Order/);
});

test('UI Audit #6: UI Duplication Cleanup removes redundant KPIs, duplicate status badges, Fast Lane CTA, and duplicate headers', () => {
  const cmdSrc = readWorkspaceFile('src/components/dashboard/StitchOpsCommandCenter.tsx');
  const dispatchWsSrc = readWorkspaceFile('src/components/dashboard/StitchDispatchWorkspace.tsx');
  const slaSrc = readWorkspaceFile('src/components/sla/SlaTelemetryDashboardView.tsx');
  const verDeskSrc = readWorkspaceFile('src/components/dashboard/DispatchVerificationDesk.tsx');
  const ticketsSrc = readWorkspaceFile('src/components/tickets/TicketsTable.tsx');
  const mobileCardSrc = readWorkspaceFile('src/components/tickets/TicketMobileCard.tsx');
  const leaderProgSrc = readWorkspaceFile('src/components/portals/LeaderProgressDashboardView.tsx');
  const installerDashSrc = readWorkspaceFile('src/components/portals/InstallerDashboardView.tsx');

  // StitchOpsCommandCenter: no duplicate token matrix, secondary KPI strip, or duplicate hero H1
  assert.doesNotMatch(cmdSrc, /Standardized Operational Status Token Matrix/);
  assert.doesNotMatch(cmdSrc, /Secondary Tactical KPI Strip/);
  assert.doesNotMatch(cmdSrc, /APPROVAL RATE/);
  assert.doesNotMatch(cmdSrc, /Active Role: SUPERADMIN/);
  assert.match(cmdSrc, /Geotag &amp; Optical Node Telemetry/);
  assert.match(cmdSrc, /ticket\.statusWOAgent !== 'Closed' && String\(ticket\.ticketResult \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'closed'/);

  // StitchDispatchWorkspace: compact context bar instead of duplicate 4-tile KPI strip
  assert.doesNotMatch(dispatchWsSrc, /ACTIVE WOS/);
  assert.doesNotMatch(dispatchWsSrc, /PENDING DISPATCH/);
  assert.match(dispatchWsSrc, /Compact Dispatch Context Bar/);

  // SlaTelemetryDashboardView: compact header when embedded in dashboard_monitoring
  assert.match(slaSrc, /viewContext === 'dashboard_monitoring'/);

  // DispatchVerificationDesk: no duplicate Waiting Verification tile in Section 2B
  assert.doesNotMatch(verDeskSrc, /Waiting Verification/);

  // TicketsTable & TicketMobileCard: no duplicate Fast Lane CTA card; Closed badge guarded cleanly
  assert.doesNotMatch(ticketsSrc, /KPI 6: Fast Lane CTA Card/);
  assert.doesNotMatch(ticketsSrc, /Fast Lane/);
  assert.match(ticketsSrc, /String\(ticket\.ticketResult \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'closed' && ticket\.statusWOAgent !== 'Closed'/);
  assert.match(mobileCardSrc, /String\(ticket\.ticketResult \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'closed' && ticket\.statusWOAgent !== 'Closed'/);

  // LeaderProgressDashboardView: no duplicate 6-chip strip below 6-card Status KPI grid
  assert.doesNotMatch(leaderProgSrc, /filterChips\.map/);
  assert.match(leaderProgSrc, /Semua Status \(\{statCounts\.total\}\)/);

  // InstallerDashboardView: no duplicate Progress Pekerjaan Hari Ini bar in Section 5
  assert.doesNotMatch(installerDashSrc, /Progress Pekerjaan Hari Ini/);
});

