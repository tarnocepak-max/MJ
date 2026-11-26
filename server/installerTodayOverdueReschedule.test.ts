import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  classifyWorkOrderServer,
  getJakartaDateStringServer,
  isTicketVisibleToInstallerToday
} from './woClassificationService.ts';

test('Objective A & B: Installer today-only isolation, WIB timezone rollover, SSE realtime sync, and Overdue WO appointment reschedule', async () => {
  process.env.ALLOW_LOCAL_JSON_DB = 'true';
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  delete process.env.DATABASE_URL;

  const dataFile = path.resolve('data/morajaws_database.json');
  const hadDataFile = fs.existsSync(dataFile);
  const originalDataBytes = hadDataFile ? fs.readFileSync(dataFile) : null;

  // Dynamic import after setting env so server.ts loads in local test mode cleanly
  const {
    createExpressApp,
    db,
    SERVER_SESSIONS,
    invalidateGlobalConfigCache,
    broadcastSupabaseChange,
    backendRealtimeBus
  } = await import('../server.ts');

  // Clear stale state & test around a UTC-vs-WIB boundary:
  // 2026-11-26T18:00:00Z == 2026-11-27 01:00:00 WIB (UTC is still Nov 26, WIB is already Nov 27!)
  let currentTestNow = new Date('2026-11-26T18:00:00.000Z');
  const wibBeforeMidnight = new Date('2026-11-26T16:59:50.000Z'); // 2026-11-26 23:59:50 WIB
  const wibAfterMidnight = new Date('2026-11-26T17:00:10.000Z');  // 2026-11-27 00:00:10 WIB

  const app = await createExpressApp({
    skipVite: true,
    apiOnly: true,
    nowProvider: () => currentTestNow
  });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  db.tickets = [];
  db.users = [];
  db.auditLogs = [];
  db.ticketMessages = [];
  db.assignmentHistory = [];
  SERVER_SESSIONS.length = 0;
  if (db.appSettings) {
    delete db.appSettings.role_permissions;
  }
  invalidateGlobalConfigCache('role_permissions');

  const mkUser = (
    id: string,
    name: string,
    role: 'super_admin' | 'dispatch' | 'leader' | 'installer',
    extra: Record<string, any> = {}
  ) => {
    const u: any = {
      id,
      username: id,
      email: `${id}@test.local`,
      name,
      role,
      active: true,
      accountStatus: 'active',
      isArchived: false,
      isDeleted: false,
      mustChangePassword: false,
      sessionVersion: 1,
      createdAt: currentTestNow.toISOString(),
      ...extra
    };
    db.users.push(u);
    return u;
  };

  const superAdmin = mkUser('u-sa-test', 'SuperAdmin Test', 'super_admin');
  const dispatchUser = mkUser('u-disp-test', 'Dispatch Test', 'dispatch');
  const leaderSame = mkUser('u-ldr-same', 'Leader Mitra A', 'leader', {
    contractor: 'PT Mitra A',
    contractorId: 'c-mitra-a',
    area: 'Jakarta Selatan'
  });
  const leaderOther = mkUser('u-ldr-other', 'Leader Mitra B', 'leader', {
    contractor: 'PT Mitra B',
    contractorId: 'c-mitra-b',
    area: 'Jakarta Barat'
  });
  const installerA = mkUser('u-inst-a', 'Teknisi Budi', 'installer', {
    contractor: 'PT Mitra A',
    contractorId: 'c-mitra-a',
    area: 'Jakarta Selatan'
  });
  const installerB = mkUser('u-inst-b', 'Teknisi Sari', 'installer', {
    contractor: 'PT Mitra A',
    contractorId: 'c-mitra-a',
    area: 'Jakarta Selatan'
  });

  const makeToken = (u: any) => {
    const token = `tok-${u.id}-${crypto.randomBytes(6).toString('hex')}`;
    const realNowIso = new Date().toISOString();
    SERVER_SESSIONS.push({
      sessionId: `sess-${u.id}-${Date.now()}`,
      token,
      userId: u.id,
      username: u.username,
      userName: u.name,
      name: u.name,
      role: u.role,
      contractor: u.contractor,
      contractorId: u.contractorId,
      area: u.area,
      sessionVersion: 1,
      status: 'active',
      loginAt: realNowIso,
      createdAt: realNowIso,
      lastActivityAt: realNowIso,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString()
    } as any);
    return token;
  };

  const saToken = makeToken(superAdmin);
  const dispToken = makeToken(dispatchUser);
  const ldrSameToken = makeToken(leaderSame);
  const ldrOtherToken = makeToken(leaderOther);
  const instAToken = makeToken(installerA);

  const mkTicket = (overrides: Record<string, any>): Record<string, any> => ({
    id: `wo-${crypto.randomBytes(4).toString('hex')}`,
    woNumber: `WO-TEST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    idCustomer: '1234567',
    customerId: '1234567',
    customerName: 'Pelanggan Uji',
    customerPhone: '081234567890',
    address: 'Jl. Kemang Raya No. 10',
    contactorName: 'PT Mitra A',
    contractorName: 'PT Mitra A',
    contractorId: 'c-mitra-a',
    area: 'Jakarta Selatan',
    leaderName: leaderSame.name,
    installerId: installerA.id,
    installerUserId: installerA.id,
    installerName: installerA.name,
    slotTime: '09:00 - 11:00',
    statusWOAgent: 'Pending',
    statusWOInstaller: 'Assigned',
    statusWhatsApp: 'ready',
    isArchived: false,
    isDeleted: false,
    createdAt: '2026-11-20T05:00:00.000Z',
    updatedAt: '2026-11-26T10:00:00.000Z',
    ...overrides
  });

  // WIB Today when currentTestNow = 2026-11-26T18:00:00Z is 2026-11-27
  const woTodayA = mkTicket({
    id: 'wo-today-a',
    woNumber: 'WO-TODAY-A',
    appointmentDate: '2026-11-27',
    customerName: 'Pelanggan Hari Ini'
  });
  const woYesterdayOverdueA = mkTicket({
    id: 'wo-overdue-a',
    woNumber: 'WO-OVERDUE-A',
    appointmentDate: '2026-11-26',
    customerName: 'Pelanggan Kemarin Overdue'
  });
  const woTomorrowA = mkTicket({
    id: 'wo-tomorrow-a',
    woNumber: 'WO-TOMORROW-A',
    appointmentDate: '2026-11-28',
    customerName: 'Pelanggan Besok'
  });
  const woOtherInstallerToday = mkTicket({
    id: 'wo-today-b',
    woNumber: 'WO-TODAY-B',
    appointmentDate: '2026-11-27',
    installerId: installerB.id,
    installerUserId: installerB.id,
    installerName: installerB.name,
    customerName: 'Pelanggan Teknisi Lain'
  });
  const woActiveCheckInPast = mkTicket({
    id: 'wo-active-checkin',
    woNumber: 'WO-ACTIVE-CHECKIN',
    appointmentDate: '2026-11-26',
    checkInAt: '2026-11-26T15:30:00.000Z',
    workSessionStatus: 'Sedang Dikerjakan',
    statusWOInstaller: 'PROGRESS',
    customerName: 'Pelanggan Sedang Check-In'
  });
  const woClosedOverdue = mkTicket({
    id: 'wo-closed-old',
    woNumber: 'WO-CLOSED-OLD',
    appointmentDate: '2026-11-24',
    statusWOAgent: 'Done',
    ticketResult: 'Closed',
    approvalStatus: 'APPROVED',
    customerName: 'Pelanggan Sudah Closed'
  });
  const woOtherContractorOverdue = mkTicket({
    id: 'wo-other-contr-overdue',
    woNumber: 'WO-OTHER-CONTR',
    appointmentDate: '2026-11-25',
    contactorName: 'PT Mitra B',
    contractorName: 'PT Mitra B',
    contractorId: 'c-mitra-b',
    area: 'Jakarta Barat',
    leaderName: leaderOther.name,
    installerId: 'u-inst-other',
    installerUserId: 'u-inst-other',
    installerName: 'Teknisi Mitra B'
  });

  db.tickets.push(
    woTodayA,
    woYesterdayOverdueA,
    woTomorrowA,
    woOtherInstallerToday,
    woActiveCheckInPast,
    woClosedOverdue,
    woOtherContractorOverdue
  );

  const reqJson = (urlPath: string, token?: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) || {})
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${baseUrl}${urlPath}`, { ...init, headers });
  };

  try {
    // 1. Timezone UTC vs WIB verification: 2026-11-26T18:00:00Z MUST resolve todayWIB = 2026-11-27
    assert.equal(getJakartaDateStringServer(currentTestNow), '2026-11-27');

    // Installer /api/tickets returns ONLY today WIB (2026-11-27) + active unfinished check-in exception
    const instTicketsRes = await reqJson('/api/tickets', instAToken);
    assert.equal(instTicketsRes.status, 200);
    const instTicketsBody = await instTicketsRes.json();
    assert.equal(instTicketsBody.operationalDateWIB, '2026-11-27');
    const instIds = (instTicketsBody.tickets || []).map((t: any) => t.id);
    assert.ok(instIds.includes(woTodayA.id), 'Today WIB WO must appear for Installer');
    assert.ok(instIds.includes(woActiveCheckInPast.id), 'Active unfinished Check-In WO across midnight must remain accessible');
    assert.equal(instIds.includes(woYesterdayOverdueA.id), false, 'Yesterday non-checked-in WO must NOT appear for Installer');
    assert.equal(instIds.includes(woTomorrowA.id), false, 'Tomorrow WO must NOT appear for Installer');
    assert.equal(instIds.includes(woOtherInstallerToday.id), false, 'Other Installer WO must NOT appear');

    // Check /api/work-orders/progressive, /api/supabase/work-orders, /api/work-orders, /api/work-orders/classifications
    for (const ep of [
      '/api/work-orders/progressive?phase=full&limit=50',
      '/api/supabase/work-orders?limit=25&page=1',
      '/api/work-orders',
      '/api/work-orders/classifications?category=TODAY'
    ]) {
      const r = await reqJson(ep, instAToken);
      assert.equal(r.status, 200, `${ep} should succeed for Installer today view`);
      const body = await r.json();
      const list = body.tickets || body.data || body.workOrders || [];
      const ids = list.map((t: any) => t.id);
      assert.equal(ids.includes(woYesterdayOverdueA.id), false, `${ep} must exclude yesterday WO`);
      assert.equal(ids.includes(woTomorrowA.id), false, `${ep} must exclude tomorrow WO`);
      assert.ok(ids.includes(woTodayA.id), `${ep} must include today WIB WO`);
    }

    // 2. Midnight 00:00 WIB rollover transition test (23:59:50 WIB -> 00:00:10 WIB)
    currentTestNow = wibBeforeMidnight; // 2026-11-26 WIB
    const beforeMidnightRes = await reqJson('/api/tickets', instAToken);
    const beforeMidnightBody = await beforeMidnightRes.json();
    assert.equal(beforeMidnightBody.operationalDateWIB, '2026-11-26');
    const beforeIds = (beforeMidnightBody.tickets || []).map((t: any) => t.id);
    assert.ok(beforeIds.includes(woYesterdayOverdueA.id), 'Before 00:00 WIB, 2026-11-26 WO is today task');
    assert.equal(beforeIds.includes(woTodayA.id), false, 'Before 00:00 WIB, 2026-11-27 WO is tomorrow and hidden');

    currentTestNow = wibAfterMidnight; // 2026-11-27 WIB
    const afterMidnightRes = await reqJson('/api/tickets', instAToken);
    const afterMidnightBody = await afterMidnightRes.json();
    assert.equal(afterMidnightBody.operationalDateWIB, '2026-11-27');
    const afterIds = (afterMidnightBody.tickets || []).map((t: any) => t.id);
    assert.equal(afterIds.includes(woYesterdayOverdueA.id), false, 'After 00:00 WIB, 2026-11-26 non-checked-in WO must drop automatically');
    assert.ok(afterIds.includes(woTodayA.id), 'After 00:00 WIB, 2026-11-27 WO must appear automatically');

    // Restore test reference clock to 2026-11-27 WIB
    currentTestNow = new Date('2026-11-26T18:00:00.000Z');

    // 3. Cross-date URL/query & endpoint bypass attempts by Installer MUST return 403
    const forbiddenInstallerUrls = [
      '/api/tickets?date=2026-11-26',
      '/api/tickets?appointmentDate=2026-11-28',
      '/api/tickets?startDate=2026-11-25&endDate=2026-11-28',
      '/api/work-orders/progressive?includeArchived=true',
      '/api/work-orders/progressive?includeOverdue=true',
      '/api/work-orders/progressive?showAll=true',
      '/api/supabase/work-orders?allDates=true',
      '/api/supabase/work-orders?dateScope=all',
      '/api/work-orders/classifications?category=OVERDUE',
      '/api/work-orders/overdue',
      '/api/tickets/search?q=WO-OVERDUE-A',
      `/api/work-orders/${encodeURIComponent(woYesterdayOverdueA.id)}`,
      `/api/supabase/work-orders/${encodeURIComponent(woYesterdayOverdueA.id)}`,
      `/api/tickets/${encodeURIComponent(woYesterdayOverdueA.id)}/messages`
    ];
    for (const url of forbiddenInstallerUrls) {
      const denyRes = await reqJson(url, instAToken);
      assert.equal(denyRes.status, 403, `Installer request to ${url} MUST be rejected with 403, got ${denyRes.status}`);
    }

    // Installer attempting to mutate appointmentDate on their own today's WO -> 403
    const instPatchDate = await reqJson(`/api/supabase/work-orders/${encodeURIComponent(woTodayA.id)}`, instAToken, {
      method: 'PATCH',
      body: JSON.stringify({ appointmentDate: '2026-11-28' })
    });
    assert.equal(instPatchDate.status, 403);
    assert.equal(woTodayA.appointmentDate, '2026-11-27');

    // 4. Objective B: Overdue Reschedule Authorization & Guards
    // Installer strictly forbidden on dedicated endpoint
    const instReschedTry = await reqJson(`/api/work-orders/${encodeURIComponent(woYesterdayOverdueA.id)}/reschedule-appointment`, instAToken, {
      method: 'POST',
      body: JSON.stringify({ appointmentDate: '2026-11-27' })
    });
    assert.equal(instReschedTry.status, 403);

    // Leader WITHOUT dynamic permission (default matrix) -> 403
    const ldrDeniedByPerm = await reqJson(`/api/work-orders/${encodeURIComponent(woYesterdayOverdueA.id)}/reschedule-appointment`, ldrSameToken, {
      method: 'POST',
      body: JSON.stringify({ appointmentDate: '2026-11-27' })
    });
    assert.equal(ldrDeniedByPerm.status, 403);

    // Grant Leader 'manage_leader_schedule' dynamically -> allowed ONLY in own contractor/area, forbidden for PT Mitra B!
    db.appSettings = db.appSettings || {};
    db.appSettings.role_permissions = {
      leader: ['login', 'view_contractor_wo', 'access_live_chat', 'assign_technician', 'create_installer', 'manage_leader_schedule']
    };
    invalidateGlobalConfigCache('role_permissions');

    const ldrDeniedCrossScope = await reqJson(`/api/work-orders/${encodeURIComponent(woOtherContractorOverdue.id)}/reschedule-appointment`, ldrSameToken, {
      method: 'POST',
      body: JSON.stringify({ appointmentDate: '2026-11-27' })
    });
    assert.equal(ldrDeniedCrossScope.status, 403, 'Leader must NOT reschedule WO outside their contractor/area');

    // Active Check-In WO cannot be rescheduled (409 WO_ACTIVE_CHECKIN) & preserves old date
    const activeCheckInResched = await reqJson(`/api/work-orders/${encodeURIComponent(woActiveCheckInPast.id)}/reschedule-appointment`, saToken, {
      method: 'POST',
      body: JSON.stringify({ appointmentDate: '2026-11-27' })
    });
    assert.equal(activeCheckInResched.status, 409);
    const activeCheckInBody = await activeCheckInResched.json();
    assert.equal(activeCheckInBody.code, 'WO_ACTIVE_CHECKIN');
    assert.equal(woActiveCheckInPast.appointmentDate, '2026-11-26');

    // Completed/Closed WO cannot be rescheduled (409 WO_ALREADY_COMPLETED)
    const closedResched = await reqJson(`/api/work-orders/${encodeURIComponent(woClosedOverdue.id)}/reschedule-appointment`, saToken, {
      method: 'POST',
      body: JSON.stringify({ appointmentDate: '2026-11-27' })
    });
    assert.equal(closedResched.status, 409);
    assert.equal(woClosedOverdue.appointmentDate, '2026-11-24');

    // Invalid calendar date or empty date -> 400 & preserves old appointmentDate
    for (const badDate of ['', '2026-02-30', 'not-a-date']) {
      const badRes = await reqJson(`/api/work-orders/${encodeURIComponent(woYesterdayOverdueA.id)}/reschedule-appointment`, dispToken, {
        method: 'POST',
        body: JSON.stringify({ appointmentDate: badDate })
      });
      assert.equal(badRes.status, 400, `Date "${badDate}" must fail with 400`);
      assert.equal(woYesterdayOverdueA.appointmentDate, '2026-11-26', 'Failed save must preserve old date');
    }

    // 5. Reschedule Overdue WO -> Today WIB by Dispatch + capture SSE realtime broadcast + verify reclassification + Installer visibility
    const emittedEvents: any[] = [];
    const onBusChange = (evt: any) => emittedEvents.push(evt);
    backendRealtimeBus.on('change', onBusChange);
    try {
      const reschedTodayRes = await reqJson(`/api/work-orders/${encodeURIComponent(woYesterdayOverdueA.id)}/reschedule-appointment`, dispToken, {
        method: 'POST',
        body: JSON.stringify({
          appointmentDate: '2026-11-27',
          reason: 'Pelanggan minta kunjungan ulang hari ini WIB'
        })
      });
      assert.equal(reschedTodayRes.status, 200);
      const reschedTodayBody = await reschedTodayRes.json();
      assert.equal(reschedTodayBody.success, true);
      assert.equal(reschedTodayBody.oldAppointmentDate, '2026-11-26');
      assert.equal(reschedTodayBody.newAppointmentDate, '2026-11-27');
      assert.equal(reschedTodayBody.ticket?.appointmentDate, '2026-11-27');
      assert.equal(reschedTodayBody.ticket?.woClassification, 'TODAY');

      // Non-date fields strictly preserved
      assert.equal(reschedTodayBody.ticket?.woNumber, woYesterdayOverdueA.woNumber);
      assert.equal(reschedTodayBody.ticket?.customerName, woYesterdayOverdueA.customerName);
      assert.equal(reschedTodayBody.ticket?.idCustomer, woYesterdayOverdueA.idCustomer);
      assert.equal(reschedTodayBody.ticket?.installerId, woYesterdayOverdueA.installerId);
      assert.equal(reschedTodayBody.ticket?.installerName, woYesterdayOverdueA.installerName);
      assert.equal(reschedTodayBody.ticket?.statusWOAgent, 'Pending');
      assert.equal(reschedTodayBody.ticket?.statusWOInstaller, 'Assigned');

      // SSE realtime event emitted with updated record
      const sseUpdateEvt = emittedEvents.find(
        e => e.table === 'work_orders' && e.eventType === 'UPDATE' && e.record?.id === woYesterdayOverdueA.id
      );
      assert.ok(sseUpdateEvt, 'Realtime SSE work_orders UPDATE event must be broadcast');
      assert.equal(sseUpdateEvt.record.appointmentDate, '2026-11-27');
    } finally {
      backendRealtimeBus.off('change', onBusChange);
    }

    // Verify Overdue WO list no longer contains woYesterdayOverdueA
    const overdueAfterTodayRes = await reqJson('/api/work-orders/overdue', dispToken);
    assert.equal(overdueAfterTodayRes.status, 200);
    const overdueAfterTodayBody = await overdueAfterTodayRes.json();
    assert.equal(
      (overdueAfterTodayBody.tickets || []).some((t: any) => t.id === woYesterdayOverdueA.id),
      false,
      'Rescheduled-to-today WO must exit Overdue WO list immediately'
    );

    // Verify Installer now sees woYesterdayOverdueA in today's tasks
    const instAfterReschedRes = await reqJson('/api/tickets', instAToken);
    const instAfterReschedBody = await instAfterReschedRes.json();
    assert.ok(
      (instAfterReschedBody.tickets || []).some((t: any) => t.id === woYesterdayOverdueA.id),
      'Rescheduled-to-today WO assigned to Installer must immediately appear in Installer today view'
    );

    // Verify Audit Log recorded the schedule change
    const auditResched = db.auditLogs.find(
      (a: any) =>
        a.action === 'Appointment Date Rescheduled' &&
        (a.entityId === woYesterdayOverdueA.woNumber || a.target === woYesterdayOverdueA.woNumber)
    );
    assert.ok(auditResched, 'Audit log for Appointment Date Rescheduled must exist');
    assert.ok(String(auditResched.details || '').includes('2026-11-26') && String(auditResched.details || '').includes('2026-11-27'));

    // 6. Reschedule same WO to Future date (2026-11-29) by authorized Leader within own scope -> moves to UPCOMING & disappears from Installer today view
    const ldrReschedFuture = await reqJson(`/api/work-orders/${encodeURIComponent(woYesterdayOverdueA.id)}/reschedule-appointment`, ldrSameToken, {
      method: 'POST',
      body: JSON.stringify({ appointmentDate: '2026-11-29' })
    });
    assert.equal(ldrReschedFuture.status, 200);
    const ldrFutureBody = await ldrReschedFuture.json();
    assert.equal(ldrFutureBody.ticket?.woClassification, 'UPCOMING');

    const instAfterFutureRes = await reqJson('/api/tickets', instAToken);
    const instAfterFutureBody = await instAfterFutureRes.json();
    assert.equal(
      (instAfterFutureBody.tickets || []).some((t: any) => t.id === woYesterdayOverdueA.id),
      false,
      'WO rescheduled to future date must immediately disappear from Installer today view'
    );

    // 7. Reschedule to an older past date (< todayWIB, e.g. 2026-11-25) -> stays in OVERDUE
    const reschedOlderPast = await reqJson(`/api/work-orders/${encodeURIComponent(woYesterdayOverdueA.id)}/reschedule-appointment`, saToken, {
      method: 'POST',
      body: JSON.stringify({ appointmentDate: '2026-11-25' })
    });
    assert.equal(reschedOlderPast.status, 200);
    const olderPastBody = await reschedOlderPast.json();
    assert.equal(olderPastBody.ticket?.woClassification, 'OVERDUE');
    assert.equal(olderPastBody.ticket?.overdueDays, 2);

    const overdueCheckRes = await reqJson('/api/work-orders/overdue', saToken);
    const overdueCheckBody = await overdueCheckRes.json();
    assert.ok(
      (overdueCheckBody.tickets || []).some((t: any) => t.id === woYesterdayOverdueA.id),
      'WO rescheduled to date < todayWIB must remain in Overdue WO list'
    );

    // 8. Pure function sanity checks on classification & visibility
    assert.equal(
      isTicketVisibleToInstallerToday({ appointmentDate: '2026-11-27' }, '2026-11-27'),
      true
    );
    assert.equal(
      isTicketVisibleToInstallerToday({ appointmentDate: '2026-11-26' }, '2026-11-27'),
      false
    );
    assert.equal(
      classifyWorkOrderServer({ appointmentDate: '2026-11-26', statusWOAgent: 'Pending' }, '2026-11-27').classification,
      'OVERDUE'
    );

    // 9. Static UI verification: InstallerPortal has zero cross-date "Semua" / "Lihat Semua Tanggal" controls
    const installerPortalSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/portals/InstallerPortal.tsx'),
      'utf-8'
    );
    assert.equal(installerPortalSrc.includes('Lihat Semua Tanggal'), false, 'InstallerPortal must NOT contain Lihat Semua Tanggal');
    assert.ok(installerPortalSrc.includes('Work Order Lapangan'), 'InstallerPortal must preserve title Work Order Lapangan');
    assert.ok(installerPortalSrc.includes('Tugas Baru'), 'InstallerPortal must preserve Tugas Baru tab');
    assert.ok(installerPortalSrc.includes('Dalam Proses'), 'InstallerPortal must preserve Dalam Proses tab');
    assert.ok(installerPortalSrc.includes('Selesai'), 'InstallerPortal must preserve Selesai tab');
    assert.ok(installerPortalSrc.includes('installer-realtime-status'), 'InstallerPortal must preserve realtime sync indicator');

    const overdueViewSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/tickets/OverdueWorkOrdersView.tsx'),
      'utf-8'
    );
    assert.ok(overdueViewSrc.includes('Ubah Schedule Appointment Date'), 'OverdueWorkOrdersView must expose Ubah Schedule Appointment Date');
  } finally {
    server.closeAllConnections?.();
    server.close();
    delete process.env.ALLOW_LOCAL_JSON_DB;
    if (hadDataFile && originalDataBytes) {
      fs.writeFileSync(dataFile, originalDataBytes);
    } else if (!hadDataFile && fs.existsSync(dataFile)) {
      fs.unlinkSync(dataFile);
    }
  }
});
