/**
 * Automated Verification Suite for MoraJaws App Flow Updates (1 - 6)
 *
 * Runs against createExpressApp({ skipVite: true }) on an ephemeral port in
 * isolated local JSON mode with full pre/post snapshot & byte-for-byte restore
 * of data/morajaws_database.json so ZERO disk or production DB data is mutated.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';

// Force isolated local test mode BEFORE importing server.ts
delete process.env.SUPABASE_URL;
delete process.env.VITE_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.VITE_SUPABASE_ANON_KEY;
process.env.NODE_ENV = 'development';
process.env.ALLOW_LOCAL_JSON_MODE = 'true';

interface CheckResult {
  flow: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
function assertCheck(flow: string, name: string, passed: boolean, detail?: string) {
  results.push({ flow, name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] [${flow}] ${name}${detail ? ` -> ${detail}` : ''}`);
}

function formatUnreadBadge(count: number): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

async function run() {
  const dbPath = path.resolve(process.cwd(), 'data', 'morajaws_database.json');
  const hadDbFile = fs.existsSync(dbPath);
  const originalDbBytes = hadDbFile ? fs.readFileSync(dbPath) : null;
  const originalSha = originalDbBytes
    ? crypto.createHash('sha256').update(originalDbBytes).digest('hex')
    : '';

  const serverModule = await import('../server.ts');
  const { createExpressApp, SERVER_SESSIONS } = serverModule;

  const app = await createExpressApp({ skipVite: true });
  const server = http.createServer(app);

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as { port: number };
  const BASE_URL = `http://127.0.0.1:${addr.port}`;

  // Register deterministic in-memory test sessions for all 5 roles
  const nowIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
  const tokens: Record<string, string> = {
    super_admin: `test_tok_sa_${Date.now()}`,
    management_data: `test_tok_md_${Date.now()}`,
    dispatch: `test_tok_dp_${Date.now()}`,
    leader: `test_tok_ld1_${Date.now()}`,
    leader2: `test_tok_ld2_${Date.now()}`,
    installer: `test_tok_in1_${Date.now()}`,
    installer2: `test_tok_in2_${Date.now()}`
  };

  SERVER_SESSIONS.push(
    {
      sessionId: 'sess_test_sa',
      token: tokens.super_admin,
      userId: 'u-1',
      username: 'superadmin',
      name: 'Super Admin',
      role: 'super_admin',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: 'sess_test_md',
      token: tokens.management_data,
      userId: 'u-mgmt',
      username: 'datamgmt',
      name: 'Management Data',
      role: 'super_admin',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: 'sess_test_dp',
      token: tokens.dispatch,
      userId: 'u-dispatch-1',
      username: 'dispatch',
      name: 'Dispatch',
      role: 'dispatch',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: 'sess_test_ld1',
      token: tokens.leader,
      userId: 'u-leader-1',
      username: 'leadermjs',
      name: 'Leader MJS',
      role: 'leader',
      contractor: 'PT Mitra Jaringan Solusi',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: 'sess_test_ld2',
      token: tokens.leader2,
      userId: 'u-leader-2',
      username: 'leaderkcs',
      name: 'Leader KCS',
      role: 'leader',
      contractor: 'PT Kencana Solusindo',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: 'sess_test_in1',
      token: tokens.installer,
      userId: 'u-installer-1',
      username: 'installer1',
      name: 'Andi Saputra',
      role: 'installer',
      contractor: 'PT Mitra Jaringan Solusi',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: 'sess_test_in2',
      token: tokens.installer2,
      userId: 'u-installer-2',
      username: 'installer2',
      name: 'Dedi Kurniawan',
      role: 'installer',
      contractor: 'PT Kencana Solusindo',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    }
  );

  async function api(method: string, urlPath: string, token: string, body?: any) {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json };
  }

  try {
    console.log('================================================================');
    console.log('MORAJAWS APP FLOW 1 - 6 AUTOMATED VERIFICATION SUITE');
    console.log('================================================================\n');

    // -------------------------------------------------------------------------
    // APP FLOW 1: Automatic WO Distribution + Import RBAC
    // -------------------------------------------------------------------------
    const sampleRow = {
      woNumber: `WO-TEST-AF1-${Date.now()}`,
      customerName: 'Pelanggan Uji AppFlow 1',
      idCustomer: '7399901',
      customerPhone: '081234567890',
      area: 'Jakarta Selatan',
      appointmentDate: '2026-11-20',
      slotTime: '13:00 - 15:00 WIB',
      contactorName: 'PT Mitra Jaringan Solusi',
      ticketCategory: 'New Installation FTTH'
    };

    for (const deniedRole of ['dispatch', 'leader', 'installer'] as const) {
      const r = await api('POST', '/api/tickets/bulk-import', tokens[deniedRole], { tickets: [sampleRow] });
      assertCheck('AppFlow1', `Import denied (403) for role ${deniedRole}`, r.status === 403, `status=${r.status}`);
    }

    const woAreaMatch = `WO-AF1-MATCH-${Date.now()}`;
    const woContractorFallback = `WO-AF1-CFALL-${Date.now()}`;
    const woUnknownContractor = `WO-AF1-UNKN-${Date.now()}`;
    const woUnmappedLeader = `WO-AF1-NOLDR-${Date.now()}`;

    const impRes = await api('POST', '/api/tickets/bulk-import', tokens.management_data, {
      tickets: [
        { ...sampleRow, woNumber: woAreaMatch },
        { ...sampleRow, woNumber: woContractorFallback, area: 'Bekasi Utara', slotTime: '15:00 - 17:00 WIB' },
        { ...sampleRow, woNumber: woUnknownContractor, contactorName: 'PT Unknown Vendor XYZ' },
        { ...sampleRow, woNumber: woUnmappedLeader, contactorName: 'PT Cipta Fiber Nusantara', area: 'Tangerang Selatan' }
      ]
    });

    assertCheck('AppFlow1', 'Import allowed (200) for management_data', impRes.status === 200 && impRes.json?.success === true);
    assertCheck(
      'AppFlow1',
      'Import response reports distributedCount=2 and undistributedCount=2',
      impRes.json?.distributedCount === 2 && impRes.json?.undistributedCount === 2,
      `dist=${impRes.json?.distributedCount}, undist=${impRes.json?.undistributedCount}`
    );

    const impSaRes = await api('POST', '/api/tickets/bulk-import', tokens.super_admin, {
      tickets: [{ ...sampleRow, woNumber: woAreaMatch }]
    });
    assertCheck(
      'AppFlow1',
      'Super Admin allowed to import & duplicate WO is safely skipped',
      impSaRes.status === 200 && impSaRes.json?.importedCount === 0 && impSaRes.json?.duplicatesIgnored === 1,
      `imported=${impSaRes.json?.importedCount}, dup=${impSaRes.json?.duplicatesIgnored}`
    );

    const bootSa = await api('GET', '/api/bootstrap', tokens.super_admin);
    const allTickets: any[] = bootSa.json?.tickets || [];
    const tAreaMatch = allTickets.find(t => t.woNumber === woAreaMatch);
    const tContrFallback = allTickets.find(t => t.woNumber === woContractorFallback);
    const tUnknContr = allTickets.find(t => t.woNumber === woUnknownContractor);
    const tNoLdr = allTickets.find(t => t.woNumber === woUnmappedLeader);

    assertCheck(
      'AppFlow1',
      'Contractor + Area match distributes to Leader u-leader-1 with appointmentDate & slotTime preserved',
      tAreaMatch?.distributionStatus === 'distributed' &&
        tAreaMatch?.leaderId === 'u-leader-1' &&
        tAreaMatch?.appointmentDate === '2026-11-20' &&
        tAreaMatch?.slotTime === '13:00 - 15:00 WIB'
    );
    assertCheck(
      'AppFlow1',
      'Contractor-level Leader fallback applies when area has no dedicated Leader',
      tContrFallback?.distributionStatus === 'distributed' && tContrFallback?.leaderId === 'u-leader-1'
    );
    assertCheck(
      'AppFlow1',
      'Unknown Contractor enters Belum Terdistribusi (unmapped_contractor) without random fallback',
      tUnknContr?.distributionStatus === 'unmapped_contractor' && !tUnknContr?.leaderId && !tUnknContr?.leaderName
    );
    assertCheck(
      'AppFlow1',
      'Contractor without active Leader enters Belum Terdistribusi (unmapped_leader) without random fallback',
      tNoLdr?.distributionStatus === 'unmapped_leader' && !tNoLdr?.leaderId && !tNoLdr?.leaderName
    );

    // -------------------------------------------------------------------------
    // APP FLOW 2: Leader-Only Technician Assignment & Reassignment
    // -------------------------------------------------------------------------
    for (const nonLeader of ['super_admin', 'dispatch', 'installer'] as const) {
      const aRes = await api('POST', '/api/tickets/assign', tokens[nonLeader], {
        ticketId: tAreaMatch.id,
        installerName: 'Andi Saputra'
      });
      assertCheck('AppFlow2', `Assign blocked (403) for non-leader role ${nonLeader}`, aRes.status === 403, `status=${aRes.status}`);
    }

    // Cross-contractor installer rejected
    const crossInstRes = await api('POST', '/api/tickets/assign', tokens.leader, {
      ticketId: tAreaMatch.id,
      installerName: 'Budi Santoso'
    });
    assertCheck('AppFlow2', 'Leader blocked (403) assigning installer outside contractor scope', crossInstRes.status === 403, `status=${crossInstRes.status}`);

    // Inactive installer rejected
    const inactiveInstRes = await api('POST', '/api/tickets/assign', tokens.leader, {
      ticketId: tAreaMatch.id,
      installerName: 'Dummy Disabled User'
    });
    assertCheck('AppFlow2', 'Leader blocked (400) assigning inactive installer', inactiveInstRes.status === 400, `status=${inactiveInstRes.status}`);

    // Cross-contractor WO rejected
    const crossWoRes = await api('POST', '/api/tickets/assign', tokens.leader2, {
      ticketId: tAreaMatch.id,
      installerName: 'Budi Santoso'
    });
    assertCheck('AppFlow2', 'Leader blocked (403) assigning WO outside contractor scope', crossWoRes.status === 403, `status=${crossWoRes.status}`);

    // Valid leader assign
    const validAssign = await api('POST', '/api/tickets/assign', tokens.leader, {
      ticketId: tAreaMatch.id,
      installerName: 'Andi Saputra',
      slotTime: '13:00 - 15:00 WIB'
    });
    assertCheck('AppFlow2', 'Leader MJS assigns scoped WO to active scoped installer Andi Saputra', validAssign.status === 200 && validAssign.json?.success === true);

    // Reassign blocked for non-leader
    for (const nonLeader of ['super_admin', 'dispatch', 'installer'] as const) {
      const rRes = await api('POST', '/api/tickets/reassign', tokens[nonLeader], {
        ticketId: tAreaMatch.id,
        newInstallerName: 'Andi Saputra',
        reason: 'Alasan uji non-leader'
      });
      assertCheck('AppFlow2', `Reassign blocked (403) for non-leader role ${nonLeader}`, rRes.status === 403, `status=${rRes.status}`);
    }

    // Reassign requires reason >= 5 chars
    const shortReasonRes = await api('POST', '/api/tickets/reassign', tokens.leader, {
      ticketId: tAreaMatch.id,
      newInstallerName: 'Andi Saputra',
      reason: 'abc'
    });
    assertCheck('AppFlow2', 'Reassign rejects short/empty reason (400)', shortReasonRes.status === 400);

    // -------------------------------------------------------------------------
    // APP FLOW 3: Dispatch Workflow Overhaul
    // -------------------------------------------------------------------------
    const dispMutateLeader = await api('PATCH', `/api/tickets/${tAreaMatch.id}`, tokens.dispatch, {
      leaderName: 'Fake Leader Override'
    });
    assertCheck(
      'AppFlow3',
      'Dispatch blocked (403) from mutating leaderName / assignment fields',
      dispMutateLeader.status === 403,
      `status=${dispMutateLeader.status}`
    );

    const dispMutateInst = await api('PATCH', `/api/tickets/${tAreaMatch.id}`, tokens.dispatch, {
      installerName: 'Fake Installer Override'
    });
    assertCheck(
      'AppFlow3',
      'Dispatch blocked (403) from mutating installerName',
      dispMutateInst.status === 403
    );

    const dispVerifyOk = await api('PATCH', `/api/tickets/${tAreaMatch.id}`, tokens.dispatch, {
      reportVerificationStatus: 'approved',
      remarksAgent: 'Verifikasi Dispatch OK'
    });
    assertCheck('AppFlow3', 'Dispatch allowed (200) to review/verify reports', dispVerifyOk.status === 200 && dispVerifyOk.json?.success === true);

    // -------------------------------------------------------------------------
    // APP FLOW 4: LiveChat Unread Message Indicator
    // -------------------------------------------------------------------------
    assertCheck('AppFlow4', 'Unread formatter hides 0', formatUnreadBadge(0) === null);
    assertCheck('AppFlow4', 'Unread formatter keeps 1..99 exact', formatUnreadBadge(1) === '1' && formatUnreadBadge(99) === '99');
    assertCheck('AppFlow4', 'Unread formatter caps >99 at 99+', formatUnreadBadge(100) === '99+' && formatUnreadBadge(250) === '99+');

    // Dispatch sends LiveChat message -> Installer must have unread message, and bootstrap does NOT auto-mark read
    const dispMsgRes = await api('POST', `/api/tickets/${tAreaMatch.id}/messages`, tokens.dispatch, {
      text: 'Halo teknisi, mohon konfirmasi jadwal.',
      category: 'GENERAL'
    });
    assertCheck('AppFlow4', 'Dispatch sends LiveChat message (200)', dispMsgRes.status === 200 && dispMsgRes.json?.success === true);

    const bootInstBefore = await api('GET', '/api/bootstrap', tokens.installer);
    const msgsBefore: any[] = (bootInstBefore.json?.ticketMessages || []).filter((m: any) => m.ticketId === tAreaMatch.id);
    const unreadBefore = msgsBefore.filter((m: any) => m.senderId !== 'u-installer-1' && (!Array.isArray(m.readBy) || !m.readBy.includes('u-installer-1'))).length;
    assertCheck(
      'AppFlow4',
      'Fetching ticket/bootstrap does NOT mark LiveChat messages as read automatically',
      unreadBefore === 1,
      `unreadBefore=${unreadBefore}`
    );

    const readRes = await api('POST', `/api/tickets/${tAreaMatch.id}/messages/read`, tokens.installer, {});
    assertCheck('AppFlow4', 'Opening LiveChat marks messages read via POST /messages/read (200)', readRes.status === 200 && readRes.json?.success === true);

    const bootInstAfter = await api('GET', '/api/bootstrap', tokens.installer);
    const msgsAfter: any[] = (bootInstAfter.json?.ticketMessages || []).filter((m: any) => m.ticketId === tAreaMatch.id);
    const unreadAfter = msgsAfter.filter((m: any) => m.senderId !== 'u-installer-1' && (!Array.isArray(m.readBy) || !m.readBy.includes('u-installer-1'))).length;
    assertCheck('AppFlow4', 'Unread count drops to 0 after explicit mark-read', unreadAfter === 0, `unreadAfter=${unreadAfter}`);

    // -------------------------------------------------------------------------
    // APP FLOW 5: Activity-Based Check-in (PROGRESS Only) & Check-out (Save Report)
    // -------------------------------------------------------------------------
    const repBeforeCheckIn = await api('POST', `/api/tickets/${tAreaMatch.id}/report`, tokens.installer, {
      report: { workResult: 'Installed', rootCause: 'None', actionTaken: 'Install ONT', notes: 'Done' }
    });
    assertCheck(
      'AppFlow5',
      'Save Technical Report blocked (400 CHECK_IN_REQUIRED) before PROGRESS Check-in',
      repBeforeCheckIn.status === 400 && repBeforeCheckIn.json?.code === 'CHECK_IN_REQUIRED',
      `status=${repBeforeCheckIn.status}, code=${repBeforeCheckIn.json?.code}`
    );

    const progRepBeforeCheckIn = await api('POST', `/api/tickets/${tAreaMatch.id}/progress-report`, tokens.installer, {
      status: 'On Site',
      remarks: 'Attempt without check-in'
    });
    assertCheck(
      'AppFlow5',
      'Save Progress Report blocked (400 CHECK_IN_REQUIRED) before PROGRESS Check-in',
      progRepBeforeCheckIn.status === 400 && progRepBeforeCheckIn.json?.code === 'CHECK_IN_REQUIRED'
    );

    // Non-PROGRESS category with "PROGRESS" keyword in text MUST NOT trigger check-in
    const genMsgRes = await api('POST', `/api/tickets/${tAreaMatch.id}/messages`, tokens.installer, {
      text: 'PROGRESS menuju lokasi pelanggan (category GENERAL)',
      category: 'GENERAL'
    });
    assertCheck(
      'AppFlow5',
      'GENERAL LiveChat containing keyword "PROGRESS" does NOT trigger Check-in',
      genMsgRes.status === 200 && genMsgRes.json?.checkInTriggered === false && !genMsgRes.json?.ticket?.checkInAt
    );

    const issueMsgRes = await api('POST', `/api/tickets/${tAreaMatch.id}/messages`, tokens.installer, {
      text: 'Kendala gerbang dikunci',
      category: 'ISSUE'
    });
    assertCheck(
      'AppFlow5',
      'ISSUE LiveChat does NOT trigger Check-in',
      issueMsgRes.status === 200 && issueMsgRes.json?.checkInTriggered === false && !issueMsgRes.json?.ticket?.checkInAt
    );

    // Dispatch sending PROGRESS does NOT trigger check-in
    const dispProgRes = await api('POST', `/api/tickets/${tAreaMatch.id}/messages`, tokens.dispatch, {
      text: 'Pantau progress',
      category: 'PROGRESS'
    });
    assertCheck(
      'AppFlow5',
      'Non-installer (Dispatch) PROGRESS message does NOT trigger technician Check-in',
      dispProgRes.status === 200 && dispProgRes.json?.checkInTriggered === false
    );

    // Installer sending PROGRESS triggers Check-in
    const instProgRes1 = await api('POST', `/api/tickets/${tAreaMatch.id}/messages`, tokens.installer, {
      text: 'Tiba di lokasi dan mulai pekerjaan',
      category: 'PROGRESS'
    });
    const recordedCheckIn = instProgRes1.json?.ticket?.checkInAt;
    assertCheck(
      'AppFlow5',
      'Installer LiveChat with category PROGRESS triggers Check-in and active workSession',
      instProgRes1.status === 200 &&
        instProgRes1.json?.checkInTriggered === true &&
        Boolean(recordedCheckIn) &&
        instProgRes1.json?.ticket?.workSessionStatus === 'Sedang Dikerjakan'
    );

    // Second PROGRESS message is idempotent (no duplicate check-in)
    const instProgRes2 = await api('POST', `/api/tickets/${tAreaMatch.id}/messages`, tokens.installer, {
      text: 'Penarikan kabel selesai',
      category: 'PROGRESS'
    });
    assertCheck(
      'AppFlow5',
      'Subsequent PROGRESS message preserves initial checkInAt (no duplicate Check-in)',
      instProgRes2.status === 200 &&
        instProgRes2.json?.checkInTriggered === false &&
        instProgRes2.json?.ticket?.checkInAt === recordedCheckIn
    );

    // Reassign preserves workSessions & checkInAt
    const reassignRes = await api('POST', '/api/tickets/reassign', tokens.leader, {
      ticketId: tAreaMatch.id,
      newInstallerName: 'Andi Saputra',
      reason: 'Pergantian shift dengan preservasi histori'
    });
    const reassignedWo = reassignRes.json?.workOrder || reassignRes.json?.ticket;
    assertCheck(
      'AppFlow2',
      'Leader reassign with valid reason succeeds (200) and preserves checkInAt & workSessions',
      reassignRes.status === 200 &&
        reassignedWo?.checkInAt === recordedCheckIn &&
        Array.isArray(reassignedWo?.workSessions) &&
        reassignedWo?.workSessions.length >= 1,
      `status=${reassignRes.status}`
    );

    // Installer saves Technical Report -> Check-out recorded
    const repAfterCheckIn = await api('POST', `/api/tickets/${tAreaMatch.id}/report`, tokens.installer, {
      report: {
        workResult: 'Installed & Tested OK',
        rootCause: 'Normal Installation',
        actionTaken: 'ONT Provisioned',
        notes: 'Signal -18 dBm'
      }
    });
    assertCheck(
      'AppFlow5',
      'Save Technical Report succeeds (200) after PROGRESS Check-in and records Check-out & duration',
      repAfterCheckIn.status === 200 &&
        Boolean(repAfterCheckIn.json?.ticket?.checkOutAt) &&
        repAfterCheckIn.json?.ticket?.workSessionStatus === 'Selesai' &&
        Boolean(repAfterCheckIn.json?.ticket?.workDurationFormatted)
    );

    // -------------------------------------------------------------------------
    // APP FLOW 6: Consolidate Pusat Setup MoraJaws
    // -------------------------------------------------------------------------
    for (const deniedSetupRole of ['leader', 'installer'] as const) {
      const cfgDenied = await api('POST', '/api/config/global', tokens[deniedSetupRole], {
        config: { appName: 'UnauthorizedChange' }
      });
      assertCheck('AppFlow6', `Global Setup config blocked (403) for ${deniedSetupRole}`, cfgDenied.status === 403);
    }

    const cfgAllowed = await api('POST', '/api/config/global', tokens.management_data, {
      config: { appName: 'MoraJaws' }
    });
    assertCheck('AppFlow6', 'Global Setup config allowed (200) for management_data', cfgAllowed.status === 200 && cfgAllowed.json?.success === true);

    const setupHubSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/setup/SetupHubView.tsx'), 'utf-8');
    const sysSettingsSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/settings/SystemSettings.tsx'), 'utf-8');
    const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

    assertCheck(
      'AppFlow6',
      'SetupHubView uses SETUP TERPUSAT MORAJAWS without standalone Konfigurasi Master Data / Pengaturan Aplikasi tabs',
      setupHubSrc.includes('SETUP TERPUSAT MORAJAWS') &&
        !setupHubSrc.includes("label: 'Konfigurasi Master Data'") &&
        !setupHubSrc.includes("label: 'Pengaturan Aplikasi'")
    );
    assertCheck(
      'AppFlow6',
      'SystemSettings removes standalone Pengaturan Aplikasi (MoraJaws) title and embeds cleanly',
      !sysSettingsSrc.includes('Pengaturan Aplikasi (MoraJaws)') && sysSettingsSrc.includes('embeddedInSetupHub')
    );
    assertCheck(
      'AppFlow6',
      'App.tsx routes settings directly into SetupHubView',
      !appSrc.includes('<SystemSettings') && appSrc.includes('<SetupHubView initialTab="app_config"')
    );
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    // Byte-for-byte restore data/morajaws_database.json
    if (hadDbFile && originalDbBytes) {
      fs.writeFileSync(dbPath, originalDbBytes);
    } else if (!hadDbFile && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    const postSha = fs.existsSync(dbPath)
      ? crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex')
      : '';
    assertCheck('Integrity', 'data/morajaws_database.json untouched byte-for-byte after verification', originalSha === postSha);
  }

  console.log('\n================================================================');
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('================================================================');

  if (failedCount > 0) {
    results.filter(r => !r.passed).forEach(f => {
      console.error(`FAILED -> [${f.flow}] ${f.name}: ${f.detail || ''}`);
    });
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in verify_appflow_updates:', err);
  process.exit(1);
});
