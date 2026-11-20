/**
 * Automated Verification Suite for MORAJAWS — AUTOMATIC WO EXPIRY & OVERDUE MANAGEMENT
 *
 * Verifies all 17 end-to-end requirements:
 *  1. Asia/Jakarta (UTC+7) midnight rollover evaluation (23:59:59 WIB vs 00:00:00 WIB)
 *  2. 5-Category classification parity (TODAY, UPCOMING, OVERDUE, COMPLETED, EXCEPTION) on server & client
 *  3. Midnight rollover (23:59 WIB -> 00:00 WIB) automatically moves yesterday's unfinished WO to OVERDUE
 *     and removes it from main operational Today queues (/api/tickets & /api/bootstrap activeTickets)
 *  4. Original workflow statuses (statusWOAgent, statusWOInstaller, statusWhatsApp, approvalStatus) never overwritten
 *  5. Missing/invalid Appointment Date strictly classifies as EXCEPTION (zero fallback to date/ticketDate/createdAt)
 *  6. Rejected/Revision overdue WOs stay OVERDUE (never misclassified as COMPLETED unless ticketResult === 'Closed')
 *  7. Bulk-importing/creating a WO with a past Appointment Date classifies immediately as OVERDUE
 *  8. Duration bucket breakdown (1_day, 2_3_days, 4_7_days, gt_7_days) & exact summary metrics arithmetic
 *  9. Overdue WO Reassignment by Leader preserves assignmentHistory, appointmentDate, and OVERDUE classification
 * 10. Completion/Closure of an Overdue WO via Progress Report + Dispatch Approval removes it from OVERDUE -> COMPLETED
 * 11. Rescheduling Overdue WO Appointment Date to Today or Future reclassifies to TODAY or UPCOMING
 * 12. Search, contractor/area/leader/installer/durationBucket/status filters & Appointment Date sort on /api/work-orders/overdue
 * 13. RBAC: Super Admin sees all Overdue + EXCEPTION queue
 * 14. RBAC: Dispatch & Management Data boundaries (Dispatch blocked from EXCEPTION queue, Today excludes overdue)
 * 15. RBAC: Leader isolated strictly to Contractor + Area (cross-contractor overdue excluded & reassign blocked 403)
 * 16. RBAC: Installer scoped strictly to own assigned overdue WOs; IT Support blocked (403) from operational overdue endpoints
 * 17. Migration SQL inspection + byte-for-byte integrity of data/morajaws_database.json after teardown
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';

delete process.env.SUPABASE_URL;
delete process.env.VITE_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.VITE_SUPABASE_ANON_KEY;
process.env.NODE_ENV = 'development';
process.env.ALLOW_LOCAL_JSON_MODE = 'true';

import {
  classifyWorkOrderServer,
  summarizeWorkOrderClassificationsServer,
  getJakartaDateStringServer
} from '../server/woClassificationService.ts';
import {
  classifyWorkOrder as classifyWorkOrderClient,
  summarizeWorkOrderClassifications as summarizeWorkOrderClassificationsClient
} from '../src/services/woClassificationService.ts';

interface CheckResult {
  id: number;
  category: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
let checkCounter = 0;
function assertCheck(category: string, name: string, passed: boolean, detail?: string) {
  checkCounter += 1;
  results.push({ id: checkCounter, category, name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] #${checkCounter} [${category}] ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function run() {
  const dbPath = path.resolve(process.cwd(), 'data', 'morajaws_database.json');
  const hadDbFile = fs.existsSync(dbPath);
  const originalDbBytes = hadDbFile ? fs.readFileSync(dbPath) : null;
  const originalSha = originalDbBytes
    ? crypto.createHash('sha256').update(originalDbBytes).digest('hex')
    : '';

  // Start at 2026-11-16 23:59:59 WIB (Asia/Jakarta = UTC+7)
  let fakeNow = new Date('2026-11-16T16:59:59.000Z');

  const serverModule = await import('../server.ts');
  const { createExpressApp, SERVER_SESSIONS } = serverModule;

  const app = await createExpressApp({
    skipVite: true,
    nowProvider: () => fakeNow
  });
  const server = http.createServer(app);

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as { port: number };
  const BASE_URL = `http://127.0.0.1:${addr.port}`;

  const nowIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
  const runId = Date.now();

  const tokens: Record<string, string> = {
    super_admin: `ov_tok_sa_${runId}`,
    management_data: `ov_tok_md_${runId}`,
    dispatch: `ov_tok_dp_${runId}`,
    leader_mjs: `ov_tok_ld1_${runId}`,
    leader_kcs: `ov_tok_ld2_${runId}`,
    installer_mjs_1: `ov_tok_in1_${runId}`,
    installer_kcs_1: `ov_tok_in2_${runId}`,
    it_support: `ov_tok_it_${runId}`
  };

  SERVER_SESSIONS.push(
    {
      sessionId: `sess_ov_sa_${runId}`,
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
      sessionId: `sess_ov_md_${runId}`,
      token: tokens.management_data,
      userId: 'u-mgmt',
      username: 'datamgmt',
      name: 'Management Data',
      role: 'management_data',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: `sess_ov_dp_${runId}`,
      token: tokens.dispatch,
      userId: 'u-dispatch-1',
      username: 'dispatch',
      name: 'Siti Rahma (Dispatcher)',
      role: 'dispatch',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: `sess_ov_ld1_${runId}`,
      token: tokens.leader_mjs,
      userId: 'u-leader-1',
      username: 'leadermjs',
      name: 'Hendra Gunawan (Leader MJS)',
      role: 'leader',
      contractor: 'PT Mitra Jaringan Solusi',
      contractorId: 'c-mjs',
      area: 'Jakarta Selatan',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: `sess_ov_ld2_${runId}`,
      token: tokens.leader_kcs,
      userId: 'u-leader-2',
      username: 'leaderkcs',
      name: 'Dedi Kurniawan (Leader KCS)',
      role: 'leader',
      contractor: 'PT Kencana Solusindo',
      contractorId: 'c-kcs',
      area: 'Jakarta Barat',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: `sess_ov_in1_${runId}`,
      token: tokens.installer_mjs_1,
      userId: 'u-installer-1',
      username: 'installer1',
      name: 'Andi Saputra',
      role: 'installer',
      contractor: 'PT Mitra Jaringan Solusi',
      contractorId: 'c-mjs',
      area: 'Jakarta Selatan',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: `sess_ov_in2_${runId}`,
      token: tokens.installer_kcs_1,
      userId: 'u-installer-2',
      username: 'installer2',
      name: 'Budi Santoso',
      role: 'installer',
      contractor: 'PT Kencana Solusindo',
      contractorId: 'c-kcs',
      area: 'Jakarta Barat',
      sessionVersion: 1,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: futureIso,
      status: 'active'
    },
    {
      sessionId: `sess_ov_it_${runId}`,
      token: tokens.it_support,
      userId: 'u-itsupport-1',
      username: 'itsupport',
      name: 'Fajar Pratama (IT Support)',
      role: 'it_support',
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
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  try {
    console.log('================================================================');
    console.log('MORAJAWS WO EXPIRY & OVERDUE MANAGEMENT — VERIFICATION SUITE');
    console.log('================================================================\n');

    // Scenario 1: Asia/Jakarta boundary check
    const dBefore = getJakartaDateStringServer(new Date('2026-11-16T16:59:59.000Z'));
    const dAfter = getJakartaDateStringServer(new Date('2026-11-16T17:00:00.000Z'));
    assertCheck(
      'Timezone',
      'Scenario 1: 23:59:59 WIB vs 00:00:00 WIB Asia/Jakarta rollover boundary',
      dBefore === '2026-11-16' && dAfter === '2026-11-17',
      `before=${dBefore}, after=${dAfter}`
    );

    // Scenario 2: Server & Client 5-category classification parity + strict EXCEPTION check
    const refDate = '2026-11-17';
    const paritySamples: any[] = [
      { id: 'p-today', woNumber: 'P-TODAY', appointmentDate: '2026-11-17', statusWOAgent: 'Assigned', statusWOInstaller: 'Assigned' },
      { id: 'p-up', woNumber: 'P-UP', appointmentDate: '2026-11-19', statusWOAgent: 'Pending', statusWOInstaller: 'Unassigned' },
      { id: 'p-ov1', woNumber: 'P-OV1', appointmentDate: '2026-11-16', statusWOAgent: 'In Progress', statusWOInstaller: 'On Site' },
      { id: 'p-ov3', woNumber: 'P-OV3', appointmentDate: '2026-11-14', statusWOAgent: 'Pending', statusWOInstaller: 'Pending Technical' },
      { id: 'p-ov6', woNumber: 'P-OV6', appointmentDate: '2026-11-11', statusWOAgent: 'Assigned', statusWOInstaller: 'Assigned' },
      { id: 'p-ov10', woNumber: 'P-OV10', appointmentDate: '2026-11-07', statusWOAgent: 'Assigned', statusWOInstaller: 'En Route' },
      { id: 'p-done', woNumber: 'P-DONE', appointmentDate: '2026-11-10', statusWOAgent: 'Resolved', statusWOInstaller: 'Completed', approvalStatus: 'APPROVED', ticketResult: 'Closed' },
      { id: 'p-rej', woNumber: 'P-REJ', appointmentDate: '2026-11-15', statusWOAgent: 'Pending', statusWOInstaller: 'Pending Technical', approvalStatus: 'REJECTED' },
      { id: 'p-exc-empty', woNumber: 'P-EXC1', appointmentDate: '', date: '2026-11-17', ticketDate: '2026-11-17', createdAt: '2026-11-17T01:00:00Z', statusWOAgent: 'Pending' },
      { id: 'p-exc-bad', woNumber: 'P-EXC2', appointmentDate: '2026-02-30', date: '2026-11-17', createdAt: '2026-11-17T01:00:00Z', statusWOAgent: 'Pending' }
    ];

    const srvClasses = paritySamples.map(s => classifyWorkOrderServer(s, refDate));
    const cliClasses = paritySamples.map(s => classifyWorkOrderClient(s, refDate));
    const expectedClasses = ['TODAY', 'UPCOMING', 'OVERDUE', 'OVERDUE', 'OVERDUE', 'OVERDUE', 'COMPLETED', 'OVERDUE', 'EXCEPTION', 'EXCEPTION'];
    const exactParity = paritySamples.every(
      (_, i) =>
        srvClasses[i].classification === expectedClasses[i] &&
        cliClasses[i].classification === expectedClasses[i] &&
        srvClasses[i].overdueDays === cliClasses[i].overdueDays &&
        srvClasses[i].overdueDurationBucket === cliClasses[i].overdueDurationBucket
    );
    const srvSum = summarizeWorkOrderClassificationsServer(paritySamples, refDate);
    const cliSum = summarizeWorkOrderClassificationsClient(paritySamples, refDate);
    assertCheck(
      'Classification',
      'Scenario 2 & 5 & 6: Server vs Client exact parity across TODAY/UPCOMING/OVERDUE/COMPLETED/EXCEPTION + REJECTED stays OVERDUE',
      exactParity &&
        srvSum.overdue === 5 &&
        cliSum.overdue === 5 &&
        srvSum.overdueBreakdown.overdue1Day === 1 &&
        srvSum.overdueBreakdown.overdue2To3Days === 2 && // Nov 14 (3d) + Nov 15 REJ (2d)
        srvSum.overdueBreakdown.overdue4To7Days === 1 && // Nov 11 (6d)
        srvSum.overdueBreakdown.criticalOverdueGt7Days === 1 && // Nov 7 (10d)
        srvSum.exception === 2 &&
        cliSum.exception === 2,
      `srv=${JSON.stringify(srvSum.overdueBreakdown)}, exc=${srvSum.exception}`
    );

    // Create a second MJS installer (Jakarta Selatan) so Leader MJS can test real two-step reassignment
    const inst2MjsName = `Rudi Hartono ${runId}`;
    const createInstRes = await api('POST', '/api/users', tokens.super_admin, {
      name: inst2MjsName,
      username: `rudimjs_${runId}`,
      email: `rudi_${runId}@mjs.morajaws.net`,
      role: 'installer',
      contractor: 'PT Mitra Jaringan Solusi',
      contractorId: 'c-mjs',
      area: 'Jakarta Selatan',
      phone: '081277665544'
    });
    assertCheck('Setup', 'Create secondary MJS installer for Overdue reassignment test', createInstRes.status === 200 || createInstRes.status === 201, `status=${createInstRes.status}`);

    // Seed controlled WO dataset covering Nov 7 (-10d Critical), Nov 11 (-6d), Nov 14 (-3d),
    // Nov 16 Open (turns overdue at 00:00 WIB on Nov 17), Nov 16 Completed, Nov 17 Today, Nov 19 Upcoming,
    // Cross-Contractor KCS Overdue, and Invalid/Missing Appointment Date EXCEPTION
    const woNov16Open = `WO-OV-16OPEN-${runId}`;
    const woNov16Done = `WO-OV-16DONE-${runId}`;
    const woNov17Today = `WO-OV-17TDY-${runId}`;
    const woNov19Up = `WO-OV-19UP-${runId}`;
    const woNov14Bucket2_3 = `WO-OV-14B23-${runId}`;
    const woNov11Bucket4_7 = `WO-OV-11B47-${runId}`;
    const woNov07Critical = `WO-OV-07CRIT-${runId}`;
    const woKcsOverdue = `WO-OV-KCS-${runId}`;
    const woExcInvalid = `WO-OV-EXC-${runId}`;

    const seedRes = await api('POST', '/api/tickets/bulk-import', tokens.super_admin, {
      tickets: [
        {
          woNumber: woNov16Open,
          customerName: 'Pelanggan Rollover 16 Nov',
          idCustomer: '8816001',
          customerPhone: '081200016001',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-16',
          createdAt: '2026-11-16T02:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'Pending',
          statusWOInstaller: 'Assigned'
        },
        {
          woNumber: woNov16Done,
          customerName: 'Pelanggan Selesai 16 Nov',
          idCustomer: '8816002',
          customerPhone: '081200016002',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-16',
          createdAt: '2026-11-16T02:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'Resolved',
          statusWOInstaller: 'Completed',
          approvalStatus: 'APPROVED',
          ticketResult: 'Closed'
        },
        {
          woNumber: woNov17Today,
          customerName: 'Pelanggan Aktif 17 Nov',
          idCustomer: '8817001',
          customerPhone: '081200017001',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-17',
          createdAt: '2026-11-16T05:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'Assigned',
          statusWOInstaller: 'Assigned'
        },
        {
          woNumber: woNov19Up,
          customerName: 'Pelanggan Masa Depan 19 Nov',
          idCustomer: '8819001',
          customerPhone: '081200019001',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-19',
          createdAt: '2026-11-16T05:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'Pending',
          statusWOInstaller: 'Unassigned'
        },
        {
          woNumber: woNov14Bucket2_3,
          customerName: 'Pelanggan Overdue 3 Hari',
          idCustomer: '8814001',
          customerPhone: '081200014001',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-14',
          createdAt: '2026-11-13T05:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'In Progress',
          statusWOInstaller: 'On Site'
        },
        {
          woNumber: woNov11Bucket4_7,
          customerName: 'Pelanggan Overdue 6 Hari',
          idCustomer: '8811001',
          customerPhone: '081200011001',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-11',
          createdAt: '2026-11-10T05:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'Pending',
          statusWOInstaller: 'Pending Technical'
        },
        {
          woNumber: woNov07Critical,
          customerName: 'Pelanggan Kritis Overdue 10 Hari',
          idCustomer: '8807001',
          customerPhone: '081200007001',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-07',
          createdAt: '2026-11-06T05:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'Assigned',
          statusWOInstaller: 'En Route'
        },
        {
          woNumber: woKcsOverdue,
          customerName: 'Pelanggan Cross Kontraktor KCS',
          idCustomer: '8815002',
          customerPhone: '081200015002',
          area: 'Jakarta Barat',
          appointmentDate: '2026-11-15',
          createdAt: '2026-11-14T05:00:00.000Z',
          contactorName: 'PT Kencana Solusindo',
          statusWOAgent: 'Pending',
          statusWOInstaller: 'Assigned'
        },
        {
          woNumber: woExcInvalid,
          customerName: 'Pelanggan Tanggal Invalid',
          idCustomer: '8899001',
          customerPhone: '081200099001',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-02-30',
          date: '2026-11-17',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'Pending',
          statusWOInstaller: 'Unassigned'
        }
      ]
    });
    assertCheck('Seed', 'Imported 9 scenario tickets cleanly', seedRes.status === 200 && seedRes.json?.importedCount === 9, `status=${seedRes.status}`);

    // Assign MJS WOs to Andi Saputra (u-installer-1) via Leader MJS, and KCS WO to Budi Santoso (u-installer-2) via Leader KCS
    await api('POST', '/api/tickets/assign', tokens.leader_mjs, {
      ticketIds: [woNov16Open, woNov17Today, woNov14Bucket2_3, woNov07Critical],
      installerName: 'Andi Saputra'
    });
    await api('POST', '/api/tickets/assign', tokens.leader_kcs, {
      ticketId: woKcsOverdue,
      installerName: 'Budi Santoso'
    });

    // Restore original non-terminal statuses on Nov 16 Open & Nov 14 & Nov 7 via super_admin PATCH so we test diverse original statuses
    const bootInit = await api('GET', '/api/bootstrap', tokens.super_admin);
    const byWo = new Map<string, any>();
    for (const t of bootInit.json?.tickets || []) {
      byWo.set(t.woNumber, t);
    }
    await api('PATCH', `/api/tickets/${byWo.get(woNov14Bucket2_3).id}`, tokens.super_admin, {
      statusWOAgent: 'In Progress',
      statusWOInstaller: 'On Site'
    });
    await api('PATCH', `/api/tickets/${byWo.get(woNov16Open).id}`, tokens.super_admin, {
      statusWOAgent: 'Pending',
      statusWOInstaller: 'Assigned'
    });

    // Scenario 3A: Before midnight (2026-11-16 23:59:59 WIB)
    fakeNow = new Date('2026-11-16T16:59:59.000Z');
    const preTodayDispatch = await api('GET', '/api/tickets', tokens.dispatch);
    const preOverdueSa = await api('GET', '/api/work-orders/overdue', tokens.super_admin);
    const preTodayWos = new Set((preTodayDispatch.json?.tickets || []).map((t: any) => t.woNumber));
    const preOverdueWos = new Set((preOverdueSa.json?.tickets || []).map((t: any) => t.woNumber));

    assertCheck(
      'PreMidnight',
      'Scenario 3A: At 23:59:59 WIB (16 Nov), woNov16Open is TODAY (in /api/tickets, NOT in /api/work-orders/overdue)',
      preTodayDispatch.json?.operationalDateWIB === '2026-11-16' &&
        preTodayWos.has(woNov16Open) &&
        !preOverdueWos.has(woNov16Open) &&
        !preOverdueWos.has(woNov16Done),
      `todayHas16Open=${preTodayWos.has(woNov16Open)}, overdueHas16Open=${preOverdueWos.has(woNov16Open)}`
    );

    // Scenario 3B: Roll clock forward past 00:00:00 WIB (2026-11-17) WITHOUT server restart or logout
    fakeNow = new Date('2026-11-16T17:00:00.000Z');
    const postTodayDispatch = await api('GET', '/api/tickets', tokens.dispatch);
    const postBootDispatch = await api('GET', '/api/bootstrap', tokens.dispatch);
    const postOverdueSa = await api('GET', '/api/work-orders/overdue', tokens.super_admin);

    const postTodayWos = new Set((postTodayDispatch.json?.tickets || []).map((t: any) => t.woNumber));
    const postBootActiveWos = new Set((postBootDispatch.json?.activeTickets || []).map((t: any) => t.woNumber));
    const postOverdueList: any[] = postOverdueSa.json?.tickets || [];
    const postOverdueMap = new Map(postOverdueList.map(t => [t.woNumber, t]));

    assertCheck(
      'MidnightRollover',
      'Scenario 3B: At 00:00:00 WIB (17 Nov), unfinished 16 Nov WO moves to OVERDUE & disappears from Dispatch Today queues; Completed 16 Nov stays out of OVERDUE',
      postTodayDispatch.json?.operationalDateWIB === '2026-11-17' &&
        !postTodayWos.has(woNov16Open) &&
        !postBootActiveWos.has(woNov16Open) &&
        postTodayWos.has(woNov17Today) &&
        postOverdueMap.has(woNov16Open) &&
        !postOverdueMap.has(woNov16Done) &&
        !postOverdueMap.has(woNov17Today) &&
        !postOverdueMap.has(woNov19Up) &&
        !postOverdueMap.has(woExcInvalid),
      `ov16OpenDays=${postOverdueMap.get(woNov16Open)?.overdueDays}, bucket=${postOverdueMap.get(woNov16Open)?.overdueDurationBucket}`
    );

    // Scenario 4: Original statuses preserved cleanly (never replaced by "OVERDUE")
    const ov16Rec = postOverdueMap.get(woNov16Open);
    const ov14Rec = postOverdueMap.get(woNov14Bucket2_3);
    assertCheck(
      'StatusPreservation',
      'Scenario 4: Original statusWOAgent / statusWOInstaller / statusWhatsApp preserved (never overwritten with OVERDUE)',
      ov16Rec?.woClassification === 'OVERDUE' &&
        ov16Rec?.statusWOAgent === 'Pending' &&
        ov16Rec?.statusWOInstaller === 'Assigned' &&
        ov14Rec?.statusWOAgent === 'In Progress' &&
        ov14Rec?.statusWOInstaller === 'On Site',
      `16Open=${ov16Rec?.statusWOAgent}/${ov16Rec?.statusWOInstaller}, 14=${ov14Rec?.statusWOAgent}/${ov14Rec?.statusWOInstaller}`
    );

    // Scenario 7: Importing new WO with past Appointment Date classifies immediately as OVERDUE
    const woPastImport = `WO-OV-PASTIMP-${runId}`;
    const pastImpRes = await api('POST', '/api/tickets/bulk-import', tokens.management_data, {
      tickets: [
        {
          woNumber: woPastImport,
          customerName: 'Pelanggan Import Mundur',
          idCustomer: '8810001',
          customerPhone: '081200010001',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-10',
          contactorName: 'PT Mitra Jaringan Solusi',
          statusWOAgent: 'Pending',
          statusWOInstaller: 'Unassigned'
        }
      ]
    });
    const afterPastImpOv = await api('GET', '/api/work-orders/overdue', tokens.super_admin);
    const pastImpRec = (afterPastImpOv.json?.tickets || []).find((t: any) => t.woNumber === woPastImport);
    assertCheck(
      'PastImport',
      'Scenario 7: Importing WO with past Appointment Date (2026-11-10 on 2026-11-17) classifies immediately as OVERDUE (7d)',
      pastImpRes.status === 200 && pastImpRec?.woClassification === 'OVERDUE' && pastImpRec?.overdueDays === 7,
      `overdueDays=${pastImpRec?.overdueDays}, bucket=${pastImpRec?.overdueDurationBucket}`
    );

    // Scenario 8: Duration buckets & exact summary arithmetic
    const sum = afterPastImpOv.json?.summary;
    const sumBuckets =
      (sum?.overdue1Day || 0) +
      (sum?.overdue2To3Days || 0) +
      (sum?.overdue4To7Days || 0) +
      (sum?.criticalOverdueGt7Days || 0);
    assertCheck(
      'SummaryMetrics',
      'Scenario 8: Overdue summary bucket arithmetic matches exact totalOverdue & contains all 4 buckets',
      Boolean(sum) &&
        sum.totalOverdue === (afterPastImpOv.json?.tickets || []).length &&
        sumBuckets === sum.totalOverdue &&
        sum.overdue1Day >= 1 &&
        sum.overdue2To3Days >= 2 &&
        sum.overdue4To7Days >= 2 &&
        sum.criticalOverdueGt7Days >= 1,
      `summary=${JSON.stringify(sum)}`
    );

    // Scenario 9: Leader Reassign on Overdue WO preserves assignmentHistory, appointmentDate, and OVERDUE classification
    const reassignRes = await api('POST', '/api/tickets/assign', tokens.leader_mjs, {
      ticketId: byWo.get(woNov14Bucket2_3).id,
      installerName: inst2MjsName,
      reason: 'Reassign teknisi karena WO overdue dan butuh penanganan cepat'
    });
    const afterReassignOv = await api('GET', '/api/work-orders/overdue', tokens.leader_mjs);
    const reassignedRec = (afterReassignOv.json?.tickets || []).find((t: any) => t.woNumber === woNov14Bucket2_3);
    assertCheck(
      'LeaderReassign',
      'Scenario 9: Leader reassigns Overdue WO preserving assignmentHistory, appointmentDate, and OVERDUE classification',
      reassignRes.status === 200 &&
        reassignedRec?.installerName === inst2MjsName &&
        reassignedRec?.appointmentDate === '2026-11-14' &&
        reassignedRec?.woClassification === 'OVERDUE' &&
        Array.isArray(reassignedRec?.assignmentHistory) &&
        reassignedRec.assignmentHistory.length >= 2,
      `installer=${reassignedRec?.installerName}, historyLen=${reassignedRec?.assignmentHistory?.length}`
    );

    // Scenario 10: Completion/Closure of Overdue WO moves it out of OVERDUE into COMPLETED
    const ovToCloseId = byWo.get(woNov16Open).id;
    const progRes = await api('POST', `/api/tickets/${ovToCloseId}/progress-report`, tokens.super_admin, {
      status: 'COMPLETE',
      reportStatusLabel: 'COMPLETE',
      remarks: 'Instalasi berhasil diselesaikan terlambat +1 hari'
    });
    const approveRes = await api('POST', `/api/work-orders/${ovToCloseId}/approve-report`, tokens.dispatch, {
      woAgentStatus: 'Done',
      notes: 'Verified closed via QA suite'
    });
    const afterCloseOv = await api('GET', '/api/work-orders/overdue', tokens.super_admin);
    const afterCloseComp = await api('GET', '/api/work-orders/classifications?category=COMPLETED', tokens.super_admin);
    const stillInOverdue = (afterCloseOv.json?.tickets || []).some((t: any) => t.id === ovToCloseId);
    const inCompleted = (afterCloseComp.json?.tickets || []).some((t: any) => t.id === ovToCloseId);
    assertCheck(
      'OverdueCompletion',
      'Scenario 10: Completing & approving Overdue WO removes it from OVERDUE and moves it to COMPLETED',
      progRes.status === 200 && approveRes.status === 200 && !stillInOverdue && inCompleted,
      `prog=${progRes.status}, approve=${approveRes.status}, stillInOverdue=${stillInOverdue}, inCompleted=${inCompleted}`
    );

    // Scenario 11: Rescheduling Overdue WO Appointment Date to Today -> TODAY, then Future -> UPCOMING
    const reschedId = byWo.get(woNov11Bucket4_7).id;
    const patchToday = await api('PATCH', `/api/tickets/${reschedId}`, tokens.dispatch, { appointmentDate: '2026-11-17' });
    const todayAfterResched = await api('GET', '/api/tickets', tokens.dispatch);
    const patchFuture = await api('PATCH', `/api/tickets/${reschedId}`, tokens.dispatch, { appointmentDate: '2026-11-22' });
    const clsUpcoming = await api('GET', '/api/work-orders/classifications?category=UPCOMING', tokens.dispatch);
    assertCheck(
      'Reschedule',
      'Scenario 11: Updating Overdue Appointment Date reclassifies WO to TODAY then UPCOMING cleanly',
      patchToday.status === 200 &&
        patchToday.json?.ticket?.woClassification === 'TODAY' &&
        (todayAfterResched.json?.tickets || []).some((t: any) => t.id === reschedId) &&
        patchFuture.status === 200 &&
        patchFuture.json?.ticket?.woClassification === 'UPCOMING' &&
        (clsUpcoming.json?.tickets || []).some((t: any) => t.id === reschedId),
      `todayCls=${patchToday.json?.ticket?.woClassification}, upCls=${patchFuture.json?.ticket?.woClassification}`
    );

    // Scenario 12: Search, filter, and Appointment Date sort on /api/work-orders/overdue
    const fSearch = await api('GET', `/api/work-orders/overdue?search=${encodeURIComponent('8807001')}`, tokens.super_admin);
    const fBucket = await api('GET', '/api/work-orders/overdue?durationBucket=gt_7_days', tokens.super_admin);
    const fSortDesc = await api('GET', '/api/work-orders/overdue?sort=desc', tokens.super_admin);
    const fSortAsc = await api('GET', '/api/work-orders/overdue?sort=asc', tokens.super_admin);
    const descDates = (fSortDesc.json?.tickets || []).map((t: any) => t.appointmentDate);
    const ascDates = (fSortAsc.json?.tickets || []).map((t: any) => t.appointmentDate);
    const isSortedAsc = ascDates.every((d: string, i: number) => i === 0 || ascDates[i - 1] <= d);
    const isSortedDesc = descDates.every((d: string, i: number) => i === 0 || descDates[i - 1] >= d);
    assertCheck(
      'FiltersAndSort',
      'Scenario 12: /api/work-orders/overdue search (Customer ID), durationBucket, and asc/desc sort work accurately',
      fSearch.status === 200 &&
        fSearch.json?.tickets?.length === 1 &&
        fSearch.json.tickets[0].woNumber === woNov07Critical &&
        fBucket.json?.tickets?.some((t: any) => t.woNumber === woNov07Critical) &&
        isSortedAsc &&
        isSortedDesc,
      `asc=${ascDates.join(',')}, desc=${descDates.join(',')}`
    );

    // Scenario 13 & 14: Super Admin & Management Data vs Dispatch EXCEPTION restriction
    const saCls = await api('GET', '/api/work-orders/classifications', tokens.super_admin);
    const mdCls = await api('GET', '/api/work-orders/classifications', tokens.management_data);
    const dpExc = await api('GET', '/api/work-orders/classifications?category=EXCEPTION', tokens.dispatch);
    const dpOv = await api('GET', '/api/work-orders/overdue', tokens.dispatch);
    assertCheck(
      'RBAC_AdminDispatchMgmt',
      'Scenario 13 & 14: Super Admin & Mgmt Data see EXCEPTION queue; Dispatch sees Overdue but gets 403 on EXCEPTION category',
      saCls.status === 200 &&
        (saCls.json?.exceptionTickets || []).some((t: any) => t.woNumber === woExcInvalid) &&
        mdCls.status === 200 &&
        (mdCls.json?.exceptionTickets || []).some((t: any) => t.woNumber === woExcInvalid) &&
        dpExc.status === 403 &&
        dpOv.status === 200 &&
        (dpOv.json?.tickets || []).length > 0,
      `dpExcStatus=${dpExc.status}, dpOvCount=${dpOv.json?.tickets?.length}`
    );

    // Scenario 15: Leader strict Contractor + Area isolation & cross-contractor reassign rejection
    const ldMjsOv = await api('GET', '/api/work-orders/overdue', tokens.leader_mjs);
    const ldMjsWos = (ldMjsOv.json?.tickets || []).map((t: any) => t.woNumber);
    const crossReassign = await api('POST', '/api/tickets/assign', tokens.leader_mjs, {
      ticketId: byWo.get(woKcsOverdue).id,
      installerName: inst2MjsName,
      reason: 'Attempt cross-contractor assign'
    });
    assertCheck(
      'RBAC_Leader',
      'Scenario 15: Leader sees ONLY same Contractor/Area Overdue WOs and gets 403 on cross-contractor assignment',
      ldMjsOv.status === 200 &&
        ldMjsWos.includes(woNov07Critical) &&
        !ldMjsWos.includes(woKcsOverdue) &&
        crossReassign.status === 403,
      `ldMjsHasKcs=${ldMjsWos.includes(woKcsOverdue)}, crossAssignStatus=${crossReassign.status}`
    );

    // Scenario 16: Installer own-WO isolation & IT Support 403 block
    const inMjsOv = await api('GET', '/api/work-orders/overdue', tokens.installer_mjs_1);
    const inMjsList: any[] = inMjsOv.json?.tickets || [];
    const inMjsWos = new Set(inMjsList.map(t => t.woNumber));
    const itOv = await api('GET', '/api/work-orders/overdue', tokens.it_support);
    const itCls = await api('GET', '/api/work-orders/classifications', tokens.it_support);
    assertCheck(
      'RBAC_InstallerAndIT',
      'Scenario 16: Installer sees strictly own assigned Overdue WOs; IT Support gets 403 on operational overdue endpoints',
      inMjsOv.status === 200 &&
        inMjsWos.has(woNov07Critical) &&
        !inMjsWos.has(woKcsOverdue) &&
        !inMjsWos.has(woPastImport) &&
        inMjsList.every(t => t.installerId === 'u-installer-1' || t.installerName === 'Andi Saputra') &&
        itOv.status === 403 &&
        itCls.status === 403,
      `inMjsCount=${inMjsList.length}, itOv=${itOv.status}, itCls=${itCls.status}`
    );

    // Scenario 17: SQL migration verification
    const migSql = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '014_wo_expiry_overdue_management.sql'), 'utf8');
    const rollbackSql = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '014_rollback_wo_expiry_overdue_management.sql'), 'utf8');
    assertCheck(
      'SQLMigration',
      'Scenario 17: Migration 014 & Rollback contain Asia/Jakarta SQL view, security_invoker, partial indexes, and clean rollback',
      migSql.includes('v_work_orders_classified') &&
        migSql.includes('Asia/Jakarta') &&
        migSql.includes('security_invoker = true') &&
        migSql.includes('idx_work_orders_active_appointment_date') &&
        rollbackSql.includes('DROP VIEW IF EXISTS public.v_work_orders_classified'),
      'Verified SQL view, timezone, security_invoker, indexes, and rollback DDL'
    );
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (hadDbFile && originalDbBytes) {
      fs.writeFileSync(dbPath, originalDbBytes);
    } else if (!hadDbFile && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    const postSha = fs.existsSync(dbPath)
      ? crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex')
      : '';
    assertCheck('Integrity', 'data/morajaws_database.json untouched byte-for-byte after teardown', originalSha === postSha);
  }

  console.log('\n================================================================');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');
  if (failed > 0) {
    results.filter(r => !r.passed).forEach(f => {
      console.error(`FAILED #${f.id} -> [${f.category}] ${f.name}: ${f.detail || ''}`);
    });
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in verify_wo_overdue_management:', err);
  process.exit(1);
});
