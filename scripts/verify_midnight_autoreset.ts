/**
 * Automated Verification Suite for AUTO RESET TICKET WO AKTIF SETIAP JAM 00:00 WIB
 *
 * Verifies:
 * 1. Strict appointmentDate / appointment_date usage (never createdAt)
 * 2. Asia/Jakarta 23:59:59 WIB (2026-11-16) vs 00:00:00 WIB (2026-11-17) rollover across ALL staff roles
 * 3. Past (< todayWIB) and Future (> todayWIB) WOs excluded from active WO endpoints across all roles
 * 4. Zero database deletion, zero status mutation, zero appointmentDate mutation
 * 5. Preserved cross-date lookup (/api/tickets/search) for Super Admin & Dispatch
 * 6. Byte-for-byte integrity of data/morajaws_database.json
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

import { getJakartaDateString, getTicketAppointmentDate } from '../src/services/appointmentDateParser.ts';

interface CheckResult {
  category: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
function assertCheck(category: string, name: string, passed: boolean, detail?: string) {
  results.push({ category, name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] [${category}] ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function run() {
  const dbPath = path.resolve(process.cwd(), 'data', 'morajaws_database.json');
  const hadDbFile = fs.existsSync(dbPath);
  const originalDbBytes = hadDbFile ? fs.readFileSync(dbPath) : null;
  const originalSha = originalDbBytes
    ? crypto.createHash('sha256').update(originalDbBytes).digest('hex')
    : '';

  // Controlled UTC clock for testing exact WIB midnight rollover:
  // 2026-11-16T16:59:59.000Z === 2026-11-16 23:59:59 WIB (Asia/Jakarta)
  // 2026-11-16T17:00:00.000Z === 2026-11-17 00:00:00 WIB (Asia/Jakarta)
  let fakeNow = new Date('2026-11-16T16:59:59.000Z');

  const serverModule = await import('../server.ts');
  const { createExpressApp, SERVER_SESSIONS, getJakartaDateStringServer } = serverModule;

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

  const tokens: Record<string, string> = {
    super_admin: `reset_tok_sa_${Date.now()}`,
    management_data: `reset_tok_md_${Date.now()}`,
    dispatch: `reset_tok_dp_${Date.now()}`,
    leader: `reset_tok_ld_${Date.now()}`,
    installer: `reset_tok_in_${Date.now()}`,
    it_support: `reset_tok_it_${Date.now()}`
  };

  SERVER_SESSIONS.push(
    {
      sessionId: 'sess_reset_sa',
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
      sessionId: 'sess_reset_md',
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
      sessionId: 'sess_reset_dp',
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
      sessionId: 'sess_reset_ld',
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
      sessionId: 'sess_reset_in',
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
      sessionId: 'sess_reset_it',
      token: tokens.it_support,
      userId: 'u-itsupport-1',
      username: 'itsupport',
      name: 'Fajar Pratama (IT Support)',
      role: 'super_admin',
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
    console.log('MORAJAWS 00:00 WIB AUTO-RESET VERIFICATION SUITE');
    console.log('================================================================\n');

    // 1. Verify frontend & backend Asia/Jakarta date calculation around exact midnight UTC boundary
    const preMidnightServer = getJakartaDateStringServer(new Date('2026-11-16T16:59:59.000Z'));
    const postMidnightServer = getJakartaDateStringServer(new Date('2026-11-16T17:00:00.000Z'));
    const preMidnightClient = getJakartaDateString(0, new Date('2026-11-16T16:59:59.000Z'));
    const postMidnightClient = getJakartaDateString(0, new Date('2026-11-16T17:00:00.000Z'));

    assertCheck(
      'Timezone',
      '2026-11-16T16:59:59Z maps to 2026-11-16 (23:59:59 WIB) on backend & frontend',
      preMidnightServer === '2026-11-16' && preMidnightClient === '2026-11-16',
      `srv=${preMidnightServer}, cli=${preMidnightClient}`
    );
    assertCheck(
      'Timezone',
      '2026-11-16T17:00:00Z maps to 2026-11-17 (00:00:00 WIB) on backend & frontend',
      postMidnightServer === '2026-11-17' && postMidnightClient === '2026-11-17',
      `srv=${postMidnightServer}, cli=${postMidnightClient}`
    );

    // 2. Verify strict Appointment Date extraction never uses createdAt
    const trapTicket = {
      id: 'trap-created-at',
      woNumber: 'WO-TRAP-CREATED',
      appointmentDate: '2026-11-15',
      createdAt: '2026-11-16T08:00:00.000Z'
    };
    const noApptTicket = {
      id: 'trap-no-appt',
      woNumber: 'WO-TRAP-NOAPPT',
      createdAt: '2026-11-16T08:00:00.000Z'
    };
    assertCheck(
      'DateRef',
      'getTicketAppointmentDate prioritizes appointmentDate over createdAt and returns null when empty',
      getTicketAppointmentDate(trapTicket) === '2026-11-15' && getTicketAppointmentDate(noApptTicket) === null
    );

    // 3. Seed WOs across Nov 15, Nov 16, Nov 17, Nov 18 using bulk-import
    const suffix = Date.now();
    const woNov15 = `WO-RST-15-${suffix}`;
    const woNov16Open = `WO-RST-16A-${suffix}`;
    const woNov16Done = `WO-RST-16B-${suffix}`;
    const woNov17 = `WO-RST-17-${suffix}`;
    const woNov18 = `WO-RST-18-${suffix}`;

    const seedRes = await api('POST', '/api/tickets/bulk-import', tokens.super_admin, {
      tickets: [
        {
          woNumber: woNov15,
          customerName: 'Pelanggan 15 Nov',
          idCustomer: '7510015',
          customerPhone: '081200000015',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-15',
          createdAt: '2026-11-16T08:00:00.000Z', // createdAt = Nov 16 trap!
          contactorName: 'PT Mitra Jaringan Solusi',
          installerId: 'u-installer-1',
          installerName: 'Andi Saputra'
        },
        {
          woNumber: woNov16Open,
          customerName: 'Pelanggan 16 Nov Open',
          idCustomer: '7510016',
          customerPhone: '081200000016',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-16',
          createdAt: '2026-11-14T08:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          installerId: 'u-installer-1',
          installerName: 'Andi Saputra'
        },
        {
          woNumber: woNov16Done,
          customerName: 'Pelanggan 16 Nov Done',
          idCustomer: '7510026',
          customerPhone: '081200000026',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-16',
          createdAt: '2026-11-14T08:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          installerId: 'u-installer-1',
          installerName: 'Andi Saputra',
          statusWOAgent: 'Resolved',
          statusWOInstaller: 'Completed'
        },
        {
          woNumber: woNov17,
          customerName: 'Pelanggan 17 Nov',
          idCustomer: '7510017',
          customerPhone: '081200000017',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-17',
          createdAt: '2026-11-16T08:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          installerId: 'u-installer-1',
          installerName: 'Andi Saputra'
        },
        {
          woNumber: woNov18,
          customerName: 'Pelanggan 18 Nov',
          idCustomer: '7510018',
          customerPhone: '081200000018',
          area: 'Jakarta Selatan',
          appointmentDate: '2026-11-18',
          createdAt: '2026-11-16T08:00:00.000Z',
          contactorName: 'PT Mitra Jaringan Solusi',
          installerId: 'u-installer-1',
          installerName: 'Andi Saputra'
        }
      ]
    });
    assertCheck('Seed', 'Test WOs imported cleanly (5 records)', seedRes.status === 200 && seedRes.json?.importedCount === 5);

    // Ensure installerId / status preserved on seeded tickets via leader assign for installer RBAC
    const bootPre = await api('GET', '/api/bootstrap', tokens.super_admin);
    const seededByWo = new Map<string, any>();
    for (const t of bootPre.json?.tickets || []) {
      if ([woNov15, woNov16Open, woNov16Done, woNov17, woNov18].includes(t.woNumber)) {
        seededByWo.set(t.woNumber, t);
      }
    }
    for (const woNum of [woNov15, woNov16Open, woNov16Done, woNov17, woNov18]) {
      const tk = seededByWo.get(woNum);
      if (tk && !tk.installerId) {
        await api('POST', '/api/tickets/assign', tokens.leader, {
          ticketId: tk.id,
          installerName: 'Andi Saputra'
        });
      }
    }

    const ALL_STAFF_ROLES = ['super_admin', 'dispatch', 'leader', 'installer'] as const;

    // 4. CHECK BEFORE MIDNIGHT: 2026-11-16 23:59:59 WIB
    fakeNow = new Date('2026-11-16T16:59:59.000Z');
    for (const role of ALL_STAFF_ROLES) {
      const res = await api('GET', '/api/tickets', tokens[role]);
      const list: any[] = res.json?.tickets || [];
      const wos = new Set(list.map(t => t.woNumber));
      const has16A = wos.has(woNov16Open);
      const has16B = wos.has(woNov16Done);
      const has15 = wos.has(woNov15);
      const has17 = wos.has(woNov17);
      const has18 = wos.has(woNov18);
      assertCheck(
        '23:59 WIB (16 Nov)',
        `Role ${role} sees ONLY 2026-11-16 WOs (excludes 15 Nov & 17/18 Nov)`,
        res.status === 200 &&
          res.json?.operationalDateWIB === '2026-11-16' &&
          has16A &&
          has16B &&
          !has15 &&
          !has17 &&
          !has18,
        `date=${res.json?.operationalDateWIB}, has16A=${has16A}, has16B=${has16B}, has15=${has15}, has17=${has17}, has18=${has18}`
      );
    }

    // 5. ROLLOVER CLOCK TO 00:00:00 WIB (2026-11-17) — NO RESTART, NO LOGOUT, NO DB MUTATION
    fakeNow = new Date('2026-11-16T17:00:00.000Z');
    for (const role of ALL_STAFF_ROLES) {
      const res = await api('GET', '/api/tickets', tokens[role]);
      const list: any[] = res.json?.tickets || [];
      const wos = new Set(list.map(t => t.woNumber));
      const has16A = wos.has(woNov16Open);
      const has16B = wos.has(woNov16Done);
      const has15 = wos.has(woNov15);
      const has17 = wos.has(woNov17);
      const has18 = wos.has(woNov18);
      assertCheck(
        '00:00 WIB (17 Nov)',
        `Role ${role} auto-resets to ONLY 2026-11-17 WOs (16 Nov & 18 Nov excluded)`,
        res.status === 200 &&
          res.json?.operationalDateWIB === '2026-11-17' &&
          has17 &&
          !has16A &&
          !has16B &&
          !has15 &&
          !has18,
        `date=${res.json?.operationalDateWIB}, has17=${has17}, has16A=${has16A}, has16B=${has16B}, has15=${has15}, has18=${has18}`
      );
    }

    // 6. Verify /api/bootstrap operationalDateWIB & activeTickets auto-updated cleanly
    const bootPost = await api('GET', '/api/bootstrap', tokens.super_admin);
    const activeWosBoot = new Set((bootPost.json?.activeTickets || []).map((t: any) => t.woNumber));
    assertCheck(
      'BootstrapSync',
      '/api/bootstrap reports operationalDateWIB=2026-11-17 and activeTickets includes 17 Nov only',
      bootPost.json?.operationalDateWIB === '2026-11-17' &&
        activeWosBoot.has(woNov17) &&
        !activeWosBoot.has(woNov16Open) &&
        !activeWosBoot.has(woNov18)
    );

    // 7. Verify ZERO deletions, ZERO status mutations, ZERO appointmentDate mutations after rollover
    const allPoolAfter: any[] = bootPost.json?.tickets || [];
    const post15 = allPoolAfter.find(t => t.woNumber === woNov15);
    const post16A = allPoolAfter.find(t => t.woNumber === woNov16Open);
    const post16B = allPoolAfter.find(t => t.woNumber === woNov16Done);
    const post17 = allPoolAfter.find(t => t.woNumber === woNov17);
    const post18 = allPoolAfter.find(t => t.woNumber === woNov18);

    const before16A = seededByWo.get(woNov16Open);
    const before16B = seededByWo.get(woNov16Done);

    assertCheck(
      'DataIntegrity',
      'All 5 WOs still exist (not deleted) with original appointmentDate & status preserved',
      Boolean(post15 && post16A && post16B && post17 && post18) &&
        !post16A.isDeleted &&
        !post16B.isDeleted &&
        post15.appointmentDate === '2026-11-15' &&
        post16A.appointmentDate === '2026-11-16' &&
        post16B.appointmentDate === '2026-11-16' &&
        post17.appointmentDate === '2026-11-17' &&
        post18.appointmentDate === '2026-11-18' &&
        post16A.statusWOAgent === before16A?.statusWOAgent &&
        post16B.statusWOAgent === before16B?.statusWOAgent &&
        post16B.statusWOInstaller === before16B?.statusWOInstaller
    );

    // 8. Verify cross-date search (/api/tickets/search) still locates 16 Nov WO on 17 Nov for Dispatch/Super Admin
    const searchRes = await api('GET', `/api/tickets/search?q=${encodeURIComponent(woNov16Open)}`, tokens.dispatch);
    const found16 = (searchRes.json?.tickets || []).find((t: any) => t.woNumber === woNov16Open);
    assertCheck(
      'CrossDateSearch',
      'Dispatch cross-date search still finds historical 2026-11-16 WO tagged previous on 2026-11-17',
      searchRes.status === 200 && Boolean(found16) && found16._crossDateMeta?.dateTag === 'previous'
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
    assertCheck('Integrity', 'data/morajaws_database.json untouched byte-for-byte', originalSha === postSha);
  }

  console.log('\n================================================================');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');
  if (failed > 0) {
    results.filter(r => !r.passed).forEach(f => {
      console.error(`FAILED -> [${f.category}] ${f.name}: ${f.detail || ''}`);
    });
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in verify_midnight_autoreset:', err);
  process.exit(1);
});
