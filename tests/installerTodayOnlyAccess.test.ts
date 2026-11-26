import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from '../server/supabaseClient.ts';

import {
  createExpressApp,
  SERVER_SESSIONS,
  getJakartaDateStringServer
} from '../server.ts';

import {
  isInstallerActiveCheckedInUnfinished,
  isTicketVisibleToInstallerToday
} from '../src/services/woLifecycleService.ts';

import {
  isInstallerActiveCheckedInUnfinished as isInstallerActiveCheckedInUnfinishedServer,
  isTicketVisibleToInstallerToday as isTicketVisibleToInstallerTodayServer
} from '../server/woClassificationService.ts';

import type { Ticket, User } from '../src/types/index.ts';

// ---------------------------------------------------------------------------
// Date Helpers (Asia/Jakarta WIB)
// ---------------------------------------------------------------------------
function getJakartaDateOffset(offsetDays: number): string {
  const baseDateStr = getJakartaDateStringServer(new Date());
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const TODAY_WIB = getJakartaDateOffset(0);
const YESTERDAY_WIB = getJakartaDateOffset(-1);
const TOMORROW_WIB = getJakartaDateOffset(1);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SUPERADMIN_USER: User = {
  id: 'usr_super_t',
  username: 'super_test',
  name: 'Superadmin Test',
  role: 'super_admin',
  active: true
};

const DISPATCH_USER: User = {
  id: 'usr_dispatch_t',
  username: 'dispatch_test',
  name: 'Dispatch Test',
  role: 'dispatch',
  active: true
};

const LEADER_USER: User = {
  id: 'usr_leader_t',
  username: 'leader_test',
  name: 'Leader Fiberindo',
  role: 'leader',
  contractorId: 'ctr_fm_t',
  contractor: 'PT Fiberindo Mitra',
  area: 'Bandung 02',
  active: true
};

const INSTALLER_A: User = {
  id: 'usr_inst_a',
  username: 'installer_a',
  name: 'Andi Saputra',
  role: 'installer',
  contractorId: 'ctr_fm_t',
  contractor: 'PT Fiberindo Mitra',
  area: 'Bandung 02',
  phone: '081211110001',
  active: true
};

const INSTALLER_B: User = {
  id: 'usr_inst_b',
  username: 'installer_b',
  name: 'Budi Santoso',
  role: 'installer',
  contractorId: 'ctr_fm_t',
  contractor: 'PT Fiberindo Mitra',
  area: 'Bandung 02',
  phone: '081211110002',
  active: true
};

function makeRow(overrides: Record<string, any>) {
  const id = overrides.id || `wo_${Math.random().toString(36).slice(2, 8)}`;
  const woNumber = overrides.wo_number || overrides.woNumber || `WO-${id.toUpperCase()}`;
  const appointmentDate = overrides.appointment_date || overrides.appointmentDate || TODAY_WIB;
  const installerId = overrides.installer_id !== undefined ? overrides.installer_id : overrides.installerId;
  const installerName = overrides.installer_name !== undefined ? overrides.installer_name : overrides.installerName;

  return {
    id,
    wo_number: woNumber,
    id_customer: overrides.id_customer || '1234567',
    customer_name: overrides.customer_name || `Pelanggan ${woNumber}`,
    customer_address: 'Jl. Merdeka No. 10, Bandung',
    customer_contact: '081299998888',
    contractor_id: 'ctr_fm_t',
    contractor_name: 'PT Fiberindo Mitra',
    contactor_name: 'PT Fiberindo Mitra',
    area: 'Bandung 02',
    appointment_date: appointmentDate,
    slot_time: overrides.slot_time || '09:00 - 11:00',
    status_wo_agent: overrides.status_wo_agent || 'In Progress',
    status_wo_installer: overrides.status_wo_installer || 'Assigned',
    installer_id: installerId ?? null,
    installer_name: installerName ?? null,
    check_in_at: overrides.check_in_at ?? null,
    check_out_at: overrides.check_out_at ?? null,
    work_session_status: overrides.work_session_status ?? null,
    approval_status: overrides.approval_status ?? null,
    ticket_result: overrides.ticket_result ?? null,
    closed_at: overrides.closed_at ?? null,
    is_deleted: false,
    is_archived: false,
    created_at: '2026-11-20T08:00:00.000Z',
    updated_at: overrides.updated_at || new Date().toISOString(),
    payload: {
      id,
      woNumber,
      idCustomer: overrides.id_customer || '1234567',
      customerName: overrides.customer_name || `Pelanggan ${woNumber}`,
      customerAddress: 'Jl. Merdeka No. 10, Bandung',
      customerContact: '081299998888',
      contractorId: 'ctr_fm_t',
      contractorName: 'PT Fiberindo Mitra',
      contactorName: 'PT Fiberindo Mitra',
      area: 'Bandung 02',
      appointmentDate,
      slotTime: overrides.slot_time || '09:00 - 11:00',
      statusWOAgent: overrides.status_wo_agent || 'In Progress',
      statusWOInstaller: overrides.status_wo_installer || 'Assigned',
      installerId: installerId ?? undefined,
      installerName: installerName ?? undefined,
      assignedTo: installerId ?? undefined,
      assignedToUid: installerId ?? undefined,
      checkInAt: overrides.check_in_at ?? undefined,
      checkOutAt: overrides.check_out_at ?? undefined,
      workSessionStatus: overrides.work_session_status ?? undefined,
      approvalStatus: overrides.approval_status ?? undefined,
      ticketResult: overrides.ticket_result ?? undefined,
      closedAt: overrides.closed_at ?? undefined,
      isDeleted: false,
      isArchived: false,
      ...(overrides.payload || {})
    },
    ...overrides
  };
}

function createMockSupabase(opts: { workOrders: any[]; users: any[] }) {
  const workOrders = opts.workOrders.map(w => ({ ...w, payload: { ...(w.payload || {}) } }));
  const users = opts.users.map(u => ({ ...u, payload: { ...(u.payload || {}) } }));
  const historyRows: any[] = [];
  const auditLogs: any[] = [];
  const messages: any[] = [];

  const getTableStore = (table: string) => {
    if (table === 'work_orders') return workOrders;
    if (table === 'users') return users;
    if (table === 'wo_assignment_history') return historyRows;
    if (table === 'audit_logs') return auditLogs;
    if (table === 'ticket_messages') return messages;
    return [];
  };

  const applyCondition = (row: any, col: string, op: string, val: any): boolean => {
    const rowVal = row[col] !== undefined ? row[col] : row.payload?.[col];
    if (op === 'eq') return rowVal === val;
    if (op === 'neq') return rowVal !== val;
    if (op === 'gte') return String(rowVal || '') >= String(val || '');
    if (op === 'lte') return String(rowVal || '') <= String(val || '');
    if (op === 'in') return Array.isArray(val) && val.includes(rowVal);
    if (op === 'ilike') {
      const pattern = String(val).replace(/%/g, '').toLowerCase();
      return String(rowVal || '').toLowerCase().includes(pattern);
    }
    return true;
  };

  const evalOr = (row: any, expr: string): boolean => {
    const parts = expr.split(',');
    return parts.some(part => {
      const m = part.trim().match(/^([^.]+)\.(eq|ilike)\.(.+)$/);
      if (!m) return false;
      const [, col, op, val] = m;
      return applyCondition(row, col, op, val);
    });
  };

  const buildQuery = (table: string) => {
    const store = getTableStore(table);
    const filters: Array<(r: any) => boolean> = [];
    let limitVal: number | null = null;
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
    let opMode: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let writePayload: any = null;
    let countMode: string | null = null;

    const execute = async () => {
      if (opMode === 'insert') {
        const items = Array.isArray(writePayload) ? writePayload : [writePayload];
        const inserted: any[] = [];
        for (const item of items) {
          const rec = { ...item, id: item.id || `${table}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
          store.push(rec);
          inserted.push(rec);
        }
        const data = singleMode !== 'none' ? inserted[0] || null : inserted;
        return { data, error: null, count: inserted.length };
      }

      if (opMode === 'upsert') {
        const items = Array.isArray(writePayload) ? writePayload : [writePayload];
        const out: any[] = [];
        for (const item of items) {
          const idx = store.findIndex(r => r.id === item.id || (item.wo_number && r.wo_number === item.wo_number));
          if (idx >= 0) {
            store[idx] = { ...store[idx], ...item, payload: { ...(store[idx].payload || {}), ...(item.payload || {}) } };
            out.push(store[idx]);
          } else {
            const rec = { ...item, id: item.id || `${table}_${Date.now()}` };
            store.push(rec);
            out.push(rec);
          }
        }
        const data = singleMode !== 'none' ? out[0] || null : out;
        return { data, error: null, count: out.length };
      }

      if (opMode === 'update') {
        const matched = store.filter(r => filters.every(fn => fn(r)));
        for (const r of matched) {
          Object.assign(r, writePayload);
          if (writePayload.payload) {
            r.payload = { ...(r.payload || {}), ...writePayload.payload };
          }
        }
        const data = singleMode !== 'none' ? matched[0] || null : matched;
        return { data, error: null, count: matched.length };
      }

      let rows = store.filter(r => filters.every(fn => fn(r)));
      const totalCount = rows.length;
      if (orderCol) {
        const c = orderCol;
        rows = [...rows].sort((a, b) => {
          const av = String(a[c] ?? '');
          const bv = String(b[c] ?? '');
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (rangeFrom !== null && rangeTo !== null) {
        rows = rows.slice(rangeFrom, rangeTo + 1);
      } else if (limitVal !== null) {
        rows = rows.slice(0, limitVal);
      }

      if (singleMode === 'single') {
        if (rows.length === 0) return { data: null, error: { code: 'PGRST116', message: 'Not found' }, count: 0 };
        return { data: rows[0], error: null, count: 1 };
      }
      if (singleMode === 'maybeSingle') {
        return { data: rows[0] || null, error: null, count: rows.length };
      }
      return { data: rows, error: null, count: countMode ? totalCount : rows.length };
    };

    const builder: any = {
      select: (_cols?: string, opts?: { count?: string }) => {
        if (opts?.count) countMode = opts.count;
        return builder;
      },
      insert: (payload: any) => {
        opMode = 'insert';
        writePayload = payload;
        return builder;
      },
      upsert: (payload: any) => {
        opMode = 'upsert';
        writePayload = payload;
        return builder;
      },
      update: (payload: any) => {
        opMode = 'update';
        writePayload = payload;
        return builder;
      },
      eq: (col: string, val: any) => {
        filters.push(r => applyCondition(r, col, 'eq', val));
        return builder;
      },
      neq: (col: string, val: any) => {
        filters.push(r => applyCondition(r, col, 'neq', val));
        return builder;
      },
      gte: (col: string, val: any) => {
        filters.push(r => applyCondition(r, col, 'gte', val));
        return builder;
      },
      lte: (col: string, val: any) => {
        filters.push(r => applyCondition(r, col, 'lte', val));
        return builder;
      },
      in: (col: string, val: any[]) => {
        filters.push(r => applyCondition(r, col, 'in', val));
        return builder;
      },
      ilike: (col: string, val: string) => {
        filters.push(r => applyCondition(r, col, 'ilike', val));
        return builder;
      },
      or: (expr: string) => {
        filters.push(r => evalOr(r, expr));
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      limit: (n: number) => {
        limitVal = n;
        return builder;
      },
      range: (from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return builder;
      },
      single: () => {
        singleMode = 'single';
        return execute();
      },
      maybeSingle: () => {
        singleMode = 'maybeSingle';
        return execute();
      },
      then: (resolve: any, reject: any) => execute().then(resolve, reject)
    };
    return builder;
  };

  return {
    client: {
      from: (table: string) => buildQuery(table)
    } as any,
    getWorkOrders: () => workOrders
  };
}

function makeSession(token: string, user: User) {
  const nowIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
  return {
    sessionId: `sess_${user.id}`,
    token,
    userId: user.id,
    username: user.username!,
    name: user.name,
    role: user.role,
    contractor: user.contractor,
    contractorId: user.contractorId,
    area: user.area,
    phone: user.phone,
    sessionVersion: 1,
    loginAt: nowIso,
    lastActivityAt: nowIso,
    expiresAt: futureIso,
    status: 'active' as const,
    ipAddress: '127.0.0.1',
    userAgent: 'InstallerTodayOnlyTestSuite',
    deviceType: user.role === 'installer' ? ('mobile' as const) : ('desktop' as const)
  };
}

async function startTestServer(workOrders: any[]) {
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock_service_role_key_for_test';

  const dbUsers = [SUPERADMIN_USER, DISPATCH_USER, LEADER_USER, INSTALLER_A, INSTALLER_B].map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    contractor_id: u.contractorId || null,
    contractor: u.contractor || null,
    area: u.area || null,
    phone: u.phone || null,
    active: true,
    is_deleted: false,
    session_version: 1,
    payload: u
  }));

  const mock = createMockSupabase({ workOrders, users: dbUsers });
  setSupabaseBackendClientForTesting(mock.client);

  const savedSessions = [...SERVER_SESSIONS];
  SERVER_SESSIONS.length = 0;
  SERVER_SESSIONS.push(
    makeSession('tok_super', SUPERADMIN_USER),
    makeSession('tok_dispatch', DISPATCH_USER),
    makeSession('tok_leader', LEADER_USER),
    makeSession('tok_inst_a', INSTALLER_A),
    makeSession('tok_inst_b', INSTALLER_B)
  );

  const app = await createExpressApp({ skipVite: true, apiOnly: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const cleanup = async () => {
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
  };

  return { baseUrl, mock, cleanup };
}

async function openSseReader(url: string, token: string) {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readUntilMatch = async (predicate: (evt: { event: string; data: any }) => boolean, timeoutMs = 4000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          try {
            const parsed = JSON.parse(dataLines.join('\n'));
            const evt = { event: eventName, data: parsed };
            if (predicate(evt)) return evt;
          } catch {}
        }
      }
      const remaining = Math.max(50, deadline - Date.now());
      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ done: true; value: undefined }>(resolve =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining)
      );
      const { value, done } = await Promise.race([readPromise, timeoutPromise]);
      if (done || !value) break;
      buffer += decoder.decode(value, { stream: true });
    }
    return null;
  };

  return {
    readUntilMatch,
    close: () => {
      controller.abort();
      reader.cancel().catch(() => {});
    }
  };
}

// ---------------------------------------------------------------------------
// Unit tests for shared classification helpers (client + server parity)
// ---------------------------------------------------------------------------
test('Unit: Client & server today+active-checkin helpers stay strictly aligned', () => {
  const todayWo = { id: '1', appointmentDate: TODAY_WIB, statusWOInstaller: 'Assigned' } as Ticket;
  const yesterdayWo = { id: '2', appointmentDate: YESTERDAY_WIB, statusWOInstaller: 'Assigned' } as Ticket;
  const tomorrowWo = { id: '3', appointmentDate: TOMORROW_WIB, statusWOInstaller: 'Assigned' } as Ticket;
  const yesterdayCheckedIn = {
    id: '4',
    appointmentDate: YESTERDAY_WIB,
    statusWOInstaller: 'In Progress',
    checkInAt: new Date(Date.now() - 3600_000).toISOString(),
    workSessionStatus: 'Sedang Dikerjakan'
  } as Ticket;
  const yesterdayCheckedOut = {
    id: '5',
    appointmentDate: YESTERDAY_WIB,
    statusWOInstaller: 'Completed',
    checkInAt: '2026-11-24T09:00:00Z',
    checkOutAt: '2026-11-24T11:00:00Z'
  } as Ticket;

  for (const [isVis, isActive] of [
    [isTicketVisibleToInstallerToday, isInstallerActiveCheckedInUnfinished],
    [isTicketVisibleToInstallerTodayServer, isInstallerActiveCheckedInUnfinishedServer]
  ] as const) {
    assert.equal(isVis(todayWo, TODAY_WIB), true);
    assert.equal(isVis(yesterdayWo, TODAY_WIB), false);
    assert.equal(isVis(tomorrowWo, TODAY_WIB), false);
    assert.equal(isActive(yesterdayCheckedIn), true);
    assert.equal(isVis(yesterdayCheckedIn, TODAY_WIB), true);
    assert.equal(isActive(yesterdayCheckedOut), false);
    assert.equal(isVis(yesterdayCheckedOut, TODAY_WIB), false);
  }
});

// ---------------------------------------------------------------------------
// End-to-End Integration Scenarios 1..11
// ---------------------------------------------------------------------------
test('Scenarios 1-4, 7, 9, 10, 11: Strict today-only backend access, active check-in exception, search isolation, cross-date rejection, historical integrity & staff non-regression', async () => {
  const workOrders = [
    makeRow({
      id: 'wo_today_1',
      wo_number: 'WO-TODAY-001',
      appointment_date: TODAY_WIB,
      installer_id: INSTALLER_A.id,
      installer_name: INSTALLER_A.name,
      status_wo_installer: 'Assigned'
    }),
    makeRow({
      id: 'wo_today_2',
      wo_number: 'WO-TODAY-002',
      appointment_date: TODAY_WIB,
      installer_id: INSTALLER_A.id,
      installer_name: INSTALLER_A.name,
      status_wo_installer: 'In Progress',
      check_in_at: new Date().toISOString(),
      work_session_status: 'Sedang Dikerjakan'
    }),
    makeRow({
      id: 'wo_today_3',
      wo_number: 'WO-TODAY-003',
      appointment_date: TODAY_WIB,
      installer_id: INSTALLER_A.id,
      installer_name: INSTALLER_A.name,
      status_wo_installer: 'Completed',
      check_in_at: new Date(Date.now() - 7200_000).toISOString(),
      check_out_at: new Date(Date.now() - 1800_000).toISOString()
    }),
    makeRow({
      id: 'wo_yesterday',
      wo_number: 'WO-YESTERDAY-999',
      appointment_date: YESTERDAY_WIB,
      installer_id: INSTALLER_A.id,
      installer_name: INSTALLER_A.name,
      status_wo_installer: 'Assigned'
    }),
    makeRow({
      id: 'wo_tomorrow',
      wo_number: 'WO-TOMORROW-888',
      appointment_date: TOMORROW_WIB,
      installer_id: INSTALLER_A.id,
      installer_name: INSTALLER_A.name,
      status_wo_installer: 'Assigned'
    }),
    makeRow({
      id: 'wo_other_inst',
      wo_number: 'WO-OTHER-INST-777',
      appointment_date: TODAY_WIB,
      installer_id: INSTALLER_B.id,
      installer_name: INSTALLER_B.name,
      status_wo_installer: 'Assigned'
    }),
    makeRow({
      id: 'wo_active_checkin_yesterday',
      wo_number: 'WO-ACTIVE-OVERNIGHT',
      appointment_date: YESTERDAY_WIB,
      installer_id: INSTALLER_A.id,
      installer_name: INSTALLER_A.name,
      status_wo_installer: 'In Progress',
      status_wo_agent: 'In Progress',
      check_in_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
      check_out_at: null,
      work_session_status: 'Sedang Dikerjakan'
    })
  ];

  const { baseUrl, mock, cleanup } = await startTestServer(workOrders);
  try {
    // Scenarios 1, 2, 3, 4, 10, 11: Bootstrap & progressive refresh for Installer A
    const bootRes = await fetch(`${baseUrl}/api/bootstrap?mode=full`, {
      headers: { Authorization: 'Bearer tok_inst_a' }
    });
    assert.equal(bootRes.status, 200);
    const bootJson = await bootRes.json();
    const bootIds = new Set((bootJson.tickets || []).map((t: any) => t.id));

    assert.equal(bootIds.has('wo_today_1'), true, 'Scenario 1/4: Today task 1 must appear');
    assert.equal(bootIds.has('wo_today_2'), true, 'Scenario 4: Today task 2 must appear');
    assert.equal(bootIds.has('wo_today_3'), true, 'Scenario 4: Today completed task 3 must appear');
    assert.equal(bootIds.has('wo_active_checkin_yesterday'), true, 'Scenario 10: Checked-in unfinished WO past midnight must stay accessible');
    assert.equal(bootIds.has('wo_yesterday'), false, 'Scenario 2: Yesterday non-checked-in task must NOT appear');
    assert.equal(bootIds.has('wo_tomorrow'), false, 'Scenario 3: Tomorrow task must NOT appear');
    assert.equal(bootIds.has('wo_other_inst'), false, 'Other installer task must NOT appear');

    // Scenario 11: Page refresh via progressive endpoint
    const progRes = await fetch(`${baseUrl}/api/work-orders/progressive?phase=full&page=1&limit=100`, {
      headers: { Authorization: 'Bearer tok_inst_a' }
    });
    assert.equal(progRes.status, 200);
    const progJson = await progRes.json();
    const progIds = new Set((progJson.tickets || []).map((t: any) => t.id));
    assert.equal(progIds.has('wo_today_1'), true);
    assert.equal(progIds.has('wo_today_2'), true);
    assert.equal(progIds.has('wo_today_3'), true);
    assert.equal(progIds.has('wo_active_checkin_yesterday'), true);
    assert.equal(progIds.has('wo_yesterday'), false);
    assert.equal(progIds.has('wo_tomorrow'), false);
    assert.equal(progIds.has('wo_other_inst'), false);

    // Scenario 7: Searching yesterday's WO number returns 0 results or 403
    const searchProgRes = await fetch(
      `${baseUrl}/api/work-orders/progressive?phase=full&search=${encodeURIComponent('WO-YESTERDAY-999')}`,
      { headers: { Authorization: 'Bearer tok_inst_a' } }
    );
    assert.equal(searchProgRes.status, 200);
    const searchProgJson = await searchProgRes.json();
    assert.equal((searchProgJson.tickets || []).length, 0, 'Scenario 7: Searching yesterday WO in progressive must return 0');

    const crossDateSearchRes = await fetch(
      `${baseUrl}/api/tickets/search?q=${encodeURIComponent('WO-YESTERDAY-999')}`,
      { headers: { Authorization: 'Bearer tok_inst_a' } }
    );
    assert.equal(crossDateSearchRes.status, 403, 'Scenario 7: Cross-date /api/tickets/search must return 403 for Installer');

    // Scenario 9: Direct API cross-date bypass attempts ALL rejected (403)
    const crossDateEndpoints = [
      { method: 'GET', url: `/api/tickets?appointmentDate=${YESTERDAY_WIB}` },
      { method: 'GET', url: `/api/bootstrap?date=${TOMORROW_WIB}` },
      { method: 'GET', url: `/api/work-orders/progressive?appointmentDate=${YESTERDAY_WIB}` },
      { method: 'GET', url: `/api/work-orders/progressive?includeArchived=true` },
      { method: 'GET', url: `/api/dashboard/kpi-summary?date=${YESTERDAY_WIB}` },
      { method: 'GET', url: `/api/work-orders/overdue` },
      { method: 'GET', url: `/api/work-orders/classifications?category=OVERDUE` },
      { method: 'GET', url: `/api/work-orders/progress-history?dateFrom=${YESTERDAY_WIB}&dateTo=${TODAY_WIB}` },
      { method: 'GET', url: `/api/supabase/work-orders?appointmentDate=${TOMORROW_WIB}` },
      { method: 'GET', url: `/api/work-orders/wo_yesterday` },
      { method: 'GET', url: `/api/tickets/wo_yesterday` },
      { method: 'GET', url: `/api/supabase/work-orders/wo_yesterday` },
      { method: 'GET', url: `/api/tickets/wo_tomorrow/messages` },
      { method: 'GET', url: `/api/tickets/WO-YESTERDAY-999/assignment-history` },
      { method: 'GET', url: `/api/storage/download?woNumber=WO-YESTERDAY-999&category=work-orders&storagePath=work-orders/WO-YESTERDAY-999/photo.jpg` },
      { method: 'PATCH', url: `/api/supabase/work-orders/wo_yesterday`, body: { remarksWOInstaller: 'Bypass test' } },
      { method: 'PATCH', url: `/api/tickets/wo_tomorrow`, body: { remarksWOInstaller: 'Bypass test' } }
    ];

    for (const ep of crossDateEndpoints) {
      const resp = await fetch(`${baseUrl}${ep.url}`, {
        method: ep.method,
        headers: {
          Authorization: 'Bearer tok_inst_a',
          ...(ep.body ? { 'Content-Type': 'application/json' } : {})
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert.equal(resp.status, 403, `Scenario 9: ${ep.method} ${ep.url} must return 403 for Installer, got ${resp.status}`);
    }

    // Scenario 10b: Active checked-in overnight WO can be completed / checked-out, then drops out of scope
    const finishOvernightRes = await fetch(`${baseUrl}/api/tickets/wo_active_checkin_yesterday`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer tok_inst_a',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        checkOutAt: new Date().toISOString(),
        statusWOInstaller: 'Completed',
        workSessionStatus: 'Selesai'
      })
    });
    assert.equal(finishOvernightRes.status, 200, 'Scenario 10: Installer must be able to finish/check-out active overnight WO');

    const afterFinishRes = await fetch(`${baseUrl}/api/work-orders/progressive?phase=full&page=1&limit=100`, {
      headers: { Authorization: 'Bearer tok_inst_a' }
    });
    const afterFinishJson = await afterFinishRes.json();
    const afterFinishIds = new Set((afterFinishJson.tickets || []).map((t: any) => t.id));
    assert.equal(
      afterFinishIds.has('wo_active_checkin_yesterday'),
      false,
      'Scenario 10: Once checked out/completed, yesterday overnight WO no longer appears in active Installer today scope'
    );

    // Historical preservation & Superadmin/Dispatch/Leader non-regression
    const dbRows = mock.getWorkOrders();
    assert.ok(dbRows.some(r => r.id === 'wo_yesterday' && !r.is_deleted), 'Historical yesterday WO must remain intact in DB');
    assert.ok(dbRows.some(r => r.id === 'wo_tomorrow' && !r.is_deleted), 'Upcoming tomorrow WO must remain intact in DB');

    const dispatchSearchRes = await fetch(
      `${baseUrl}/api/tickets/search?q=${encodeURIComponent('WO-YESTERDAY-999')}`,
      { headers: { Authorization: 'Bearer tok_dispatch' } }
    );
    assert.equal(dispatchSearchRes.status, 200, 'Dispatch cross-date search remains unaffected');
    const dispatchSearchJson = await dispatchSearchRes.json();
    assert.equal(dispatchSearchJson.count, 1);

    const leaderOverdueRes = await fetch(`${baseUrl}/api/work-orders/overdue`, {
      headers: { Authorization: 'Bearer tok_leader' }
    });
    assert.equal(leaderOverdueRes.status, 200, 'Leader overdue access remains unaffected');

    const superKpiRes = await fetch(`${baseUrl}/api/dashboard/kpi-summary?date=${YESTERDAY_WIB}`, {
      headers: { Authorization: 'Bearer tok_super' }
    });
    assert.equal(superKpiRes.status, 200, 'Superadmin historical KPI access remains unaffected');
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenarios 5 & 6: Realtime SSE & Delta Sync (Assignment + Reassignment Removal)
// ---------------------------------------------------------------------------
test('Scenarios 5-6: Realtime SSE + /api/sync/delta immediately adds newly assigned today WO and revokes reassigned WO from previous Installer', async () => {
  const workOrders = [
    makeRow({
      id: 'wo_rt_unassigned',
      wo_number: 'WO-RT-NEW-01',
      appointment_date: TODAY_WIB,
      installer_id: null,
      installer_name: null,
      status_wo_installer: 'Unassigned'
    }),
    makeRow({
      id: 'wo_rt_reassign',
      wo_number: 'WO-RT-REASSIGN-02',
      appointment_date: TODAY_WIB,
      installer_id: INSTALLER_A.id,
      installer_name: INSTALLER_A.name,
      status_wo_installer: 'Assigned'
    }),
    makeRow({
      id: 'wo_rt_yesterday',
      wo_number: 'WO-RT-YEST-03',
      appointment_date: YESTERDAY_WIB,
      installer_id: INSTALLER_A.id,
      installer_name: INSTALLER_A.name,
      status_wo_installer: 'Assigned'
    })
  ];

  const { baseUrl, cleanup } = await startTestServer(workOrders);
  const sseA = await openSseReader(`${baseUrl}/api/supabase/realtime/stream?tables=work_orders`, 'tok_inst_a');
  const sseB = await openSseReader(`${baseUrl}/api/supabase/realtime/stream?tables=work_orders`, 'tok_inst_b');

  try {
    // Wait for initial SSE handshakes
    await sseA.readUntilMatch(e => e.data?.type === 'connected');
    await sseB.readUntilMatch(e => e.data?.type === 'connected');

    // Scenario 5: Leader assigns new today WO to Installer A -> SSE must deliver UPDATE to Installer A
    const assignRes = await fetch(`${baseUrl}/api/tickets/wo_rt_unassigned/assign`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok_leader',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        installerId: INSTALLER_A.id,
        installerName: INSTALLER_A.name,
        slotTime: '13:00 - 15:00'
      })
    });
    assert.equal(assignRes.status, 200);

    const sseNewForA = await sseA.readUntilMatch(
      e => e.data?.table === 'work_orders' && e.data?.eventType === 'UPDATE' && e.data?.record?.id === 'wo_rt_unassigned'
    );
    assert.ok(sseNewForA, 'Scenario 5: Installer A SSE stream must receive newly assigned today WO in realtime');

    // Scenario 6: Leader reassigns wo_rt_reassign from Installer A to Installer B
    const reassignRes = await fetch(`${baseUrl}/api/tickets/reassign`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok_leader',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ticketId: 'wo_rt_reassign',
        woNumber: 'WO-RT-REASSIGN-02',
        newInstallerId: INSTALLER_B.id,
        newInstallerName: INSTALLER_B.name,
        reason: 'Pemerataan teknisi area Bandung'
      })
    });
    assert.equal(reassignRes.status, 200);

    const sseRevokedForA = await sseA.readUntilMatch(
      e => e.data?.table === 'work_orders' && e.data?.eventType === 'ACCESS_REVOKED' && e.data?.record?.id === 'wo_rt_reassign'
    );
    assert.ok(sseRevokedForA, 'Scenario 6: Installer A SSE stream must receive ACCESS_REVOKED when WO is reassigned away');

    const sseAssignedForB = await sseB.readUntilMatch(
      e => e.data?.table === 'work_orders' && e.data?.eventType === 'UPDATE' && e.data?.record?.id === 'wo_rt_reassign'
    );
    assert.ok(sseAssignedForB, 'Scenario 6: Installer B SSE stream must receive reassigned WO in realtime');

    // Fallback delta-sync check: scopedActiveIds for Installer A excludes wo_rt_reassign & wo_rt_yesterday, includes wo_rt_unassigned
    const deltaARes = await fetch(`${baseUrl}/api/sync/delta?since=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`, {
      headers: { Authorization: 'Bearer tok_inst_a' }
    });
    assert.equal(deltaARes.status, 200);
    const deltaAJson = await deltaARes.json();
    assert.ok(Array.isArray(deltaAJson.scopedActiveIds), 'Delta sync must provide scopedActiveIds for Installer');
    assert.equal(deltaAJson.scopedActiveIds.includes('wo_rt_unassigned'), true);
    assert.equal(deltaAJson.scopedActiveIds.includes('wo_rt_reassign'), false, 'Reassigned WO removed from scopedActiveIds');
    assert.equal(deltaAJson.scopedActiveIds.includes('wo_rt_yesterday'), false, 'Yesterday WO excluded from scopedActiveIds');
  } finally {
    sseA.close();
    sseB.close();
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 8: UI Removal & Cross-Date URL Guard Verification
// ---------------------------------------------------------------------------
test('Scenario 8: Cross-date UI controls removed completely and App.tsx URL cross-date guard active', () => {
  const portalSrc = fs.readFileSync(path.resolve('src/components/portals/InstallerPortal.tsx'), 'utf8');
  const bottomNavSrc = fs.readFileSync(path.resolve('src/components/layout/InstallerBottomNav.tsx'), 'utf8');
  const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const notifSrc = fs.readFileSync(path.resolve('src/components/notification/useNotificationCenter.ts'), 'utf8');
  const uiCfgSrc = fs.readFileSync(path.resolve('src/context/UIConfigContext.tsx'), 'utf8');

  assert.equal(portalSrc.includes('Lihat Semua Tanggal'), false, 'Button "Lihat Semua Tanggal" must be removed');
  assert.equal(portalSrc.includes('setDateScope'), false, 'dateScope state/toggle must be removed');
  assert.equal(portalSrc.includes("if (bucket === 'selesai') return true"), false, 'Historical completed leak must be removed');
  assert.equal(portalSrc.includes('Work Order Lapangan'), true, 'Title Work Order Lapangan preserved');
  assert.equal(portalSrc.includes('installer-realtime-status'), true, 'Realtime status indicator present');

  assert.equal(bottomNavSrc.includes('installer_history'), false, 'installer_history removed from InstallerBottomNav');
  assert.equal(bottomNavSrc.includes('installer_progress'), false, 'installer_progress removed from InstallerBottomNav');

  assert.equal(appSrc.includes('inspectAndRejectCrossDateUrl'), true, 'URL cross-date guard present in App.tsx');
  assert.equal(appSrc.includes("'installer_history'"), false, 'installer_history route removed from App.tsx');
  assert.equal(appSrc.includes("'installer_progress'"), false, 'installer_progress route removed from App.tsx');
  assert.equal(notifSrc.includes("'installer_history'"), false, 'installer_history removed from useNotificationCenter');
  assert.equal(uiCfgSrc.includes("{ id: 'installer_history'"), false, 'installer_history removed from DEFAULT_NAVIGATION_ITEMS');
});
