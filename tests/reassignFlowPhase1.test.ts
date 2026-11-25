import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  executeReassignWorkOrderRequest,
  parseReassignApiResponse,
  validateReassignPreconditions
} from '../src/services/assignmentClientHelpers.ts';

import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from '../server/supabaseClient.ts';

import {
  createExpressApp,
  SERVER_SESSIONS
} from '../server.ts';

import type { Ticket, User } from '../src/types/index.ts';

// ---------------------------------------------------------------------------
// Fixtures & Mock Helpers
// ---------------------------------------------------------------------------
const LEADER_USER: User = {
  id: 'usr_leader_01',
  username: 'leader_budi',
  name: 'Leader Budi',
  role: 'leader',
  contractorId: 'ctr_fm_01',
  contractor: 'PT Fiberindo Mitra',
  area: 'Bandung 02',
  active: true
};

const INSTALLER_A: User = {
  id: 'usr_inst_01',
  username: 'rizky_p',
  name: 'Rizky Pratama',
  role: 'installer',
  contractorId: 'ctr_fm_01',
  contractor: 'PT Fiberindo Mitra',
  area: 'Bandung 02',
  phone: '081211112222',
  active: true
};

const INSTALLER_B: User = {
  id: 'usr_inst_02',
  username: 'andi_w',
  name: 'Andi Wijaya',
  role: 'installer',
  contractorId: 'ctr_fm_01',
  contractor: 'PT Fiberindo Mitra',
  area: 'Bandung 02',
  phone: '081233334444',
  active: true
};

const INSTALLER_INACTIVE: User = {
  id: 'usr_inst_inactive',
  username: 'nonaktif_tech',
  name: 'Teknisi Nonaktif',
  role: 'installer',
  contractorId: 'ctr_fm_01',
  contractor: 'PT Fiberindo Mitra',
  area: 'Bandung 02',
  active: false
};

const INSTALLER_OTHER_CONTRACTOR: User = {
  id: 'usr_inst_other',
  username: 'other_tech',
  name: 'Teknisi Vendor Lain',
  role: 'installer',
  contractorId: 'ctr_other',
  contractor: 'PT Kompetitor',
  area: 'Bandung 02',
  active: true
};

function makeAssignedTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'wo_re_01',
    woNumber: 'WO-REASSIGN-001',
    idCustomer: '1234567',
    customerName: 'Ibu Sari',
    customerAddress: 'Jl. Dago No. 8',
    customerContact: '081299990000',
    appointmentDate: '2026-11-25',
    slotTime: '09:00 - 11:00',
    contractorId: 'ctr_fm_01',
    contractorName: 'PT Fiberindo Mitra',
    contactorName: 'PT Fiberindo Mitra',
    area: 'Bandung 02',
    statusWOAgent: 'In Progress',
    statusWOInstaller: 'Assigned',
    installerId: INSTALLER_A.id,
    installerName: INSTALLER_A.name,
    createdAt: '2026-11-24T08:00:00Z',
    updatedAt: '2026-11-24T08:00:00Z',
    ...overrides
  } as Ticket;
}

function createReassignMockSupabase(opts: { workOrders: any[]; users: any[] }) {
  const workOrders = opts.workOrders.map(w => ({ ...w, payload: { ...(w.payload || {}) } }));
  const users = opts.users.map(u => ({ ...u, payload: { ...(u.payload || {}) } }));
  const historyRows: any[] = [];
  const auditLogs: any[] = [];

  const applyFilterConditions = (
    rows: any[],
    eqFilters: Array<[string, any]>,
    orExprs: string[],
    ilikeFilters: Array<[string, string]>
  ) => {
    return rows.filter(row => {
      for (const [col, val] of eqFilters) {
        if (row[col] !== val) return false;
      }
      for (const [col, pattern] of ilikeFilters) {
        const clean = String(pattern).replace(/%/g, '').trim().toLowerCase();
        if (!String(row[col] || '').trim().toLowerCase().includes(clean)) return false;
      }
      for (const expr of orExprs) {
        const parts = expr.split(',').map(s => s.trim()).filter(Boolean);
        let anyMatched = false;
        for (const p of parts) {
          const eqMatch = p.match(/^([a-zA-Z0-9_]+)\.eq\.(.+)$/);
          if (eqMatch) {
            const col = eqMatch[1];
            const rawVal = eqMatch[2].replace(/^"|"$/g, '');
            if (String(row[col] || '') === rawVal) anyMatched = true;
          }
          const ilikeMatch = p.match(/^([a-zA-Z0-9_]+)\.ilike\.(.+)$/);
          if (ilikeMatch) {
            const col = ilikeMatch[1];
            const needle = ilikeMatch[2].replace(/%/g, '').trim().toLowerCase();
            if (String(row[col] || '').toLowerCase().includes(needle)) anyMatched = true;
          }
        }
        if (!anyMatched) return false;
      }
      return true;
    });
  };

  const client: any = {
    from: (table: string) => {
      if (table === 'work_orders') {
        return {
          select: (_cols = '*', selectOpts?: { count?: string }) => {
            const eqFilters: Array<[string, any]> = [];
            const ilikeFilters: Array<[string, string]> = [];
            const orExprs: string[] = [];
            let rangeBounds: [number, number] | null = null;
            const builder: any = {
              eq: (col: string, val: any) => {
                eqFilters.push([col, val]);
                return builder;
              },
              ilike: (col: string, val: string) => {
                ilikeFilters.push([col, val]);
                return builder;
              },
              gte: () => builder,
              or: (expr: string) => {
                orExprs.push(expr);
                return builder;
              },
              order: () => builder,
              limit: () => builder,
              range: (from: number, to: number) => {
                rangeBounds = [from, to];
                return builder;
              },
              single: async () => {
                const matched = applyFilterConditions(workOrders, eqFilters, orExprs, ilikeFilters);
                if (matched.length === 0) {
                  return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
                }
                return { data: { ...matched[0], payload: { ...(matched[0].payload || {}) } }, error: null };
              },
              maybeSingle: async () => {
                const matched = applyFilterConditions(workOrders, eqFilters, orExprs, ilikeFilters);
                return {
                  data: matched[0] ? { ...matched[0], payload: { ...(matched[0].payload || {}) } } : null,
                  error: null
                };
              },
              then: (resolve: (v: any) => any, reject?: (e: any) => any) => {
                const matched = applyFilterConditions(workOrders, eqFilters, orExprs, ilikeFilters);
                const sliced = rangeBounds ? matched.slice(rangeBounds[0], rangeBounds[1] + 1) : matched;
                return Promise.resolve({
                  data: sliced.map(r => ({ ...r, payload: { ...(r.payload || {}) } })),
                  count: selectOpts?.count ? matched.length : undefined,
                  error: null
                }).then(resolve, reject);
              }
            };
            return builder;
          },
          update: (updates: Record<string, any>) => ({
            eq: (col: string, val: any) => ({
              select: () => ({
                single: async () => {
                  const idx = workOrders.findIndex(w => w[col] === val);
                  if (idx === -1) {
                    return { data: null, error: { code: 'PGRST116', message: 'Work order not found' } };
                  }
                  const { payload: nextPayload, ...directCols } = updates;
                  workOrders[idx] = {
                    ...workOrders[idx],
                    ...directCols,
                    payload: {
                      ...(workOrders[idx].payload || {}),
                      ...(nextPayload || {})
                    }
                  };
                  return {
                    data: { ...workOrders[idx], payload: { ...workOrders[idx].payload } },
                    error: null
                  };
                }
              })
            })
          })
        };
      }

      if (table === 'users') {
        return {
          select: () => {
            const eqFilters: Array<[string, any]> = [];
            const builder: any = {
              eq: (col: string, val: any) => {
                eqFilters.push([col, val]);
                return builder;
              },
              or: () => builder,
              order: () => builder,
              limit: () => builder,
              single: async () => {
                const matched = users.filter(u => eqFilters.every(([c, v]) => u[c] === v));
                return {
                  data: matched[0] ? { ...matched[0] } : null,
                  error: matched[0] ? null : { code: 'PGRST116', message: 'User not found' }
                };
              },
              maybeSingle: async () => {
                const matched = users.filter(u => eqFilters.every(([c, v]) => u[c] === v));
                return { data: matched[0] ? { ...matched[0] } : null, error: null };
              },
              then: (resolve: (v: any) => any, reject?: (e: any) => any) => {
                const matched = users.filter(u => eqFilters.every(([c, v]) => u[c] === v));
                return Promise.resolve({ data: matched.map(u => ({ ...u })), error: null }).then(resolve, reject);
              }
            };
            return builder;
          }
        };
      }

      if (table === 'assignment_history') {
        return {
          insert: (rows: any[]) => ({
            select: () => ({
              maybeSingle: async () => {
                const saved = { ...rows[0], id: rows[0]?.id || `hist_${historyRows.length + 1}` };
                historyRows.push(saved);
                return { data: saved, error: null };
              }
            })
          }),
          select: () => ({
            eq: () => ({ order: async () => ({ data: historyRows, error: null }) }),
            or: () => ({ order: async () => ({ data: historyRows, error: null }) })
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
        insert: (rows: any[]) => Promise.resolve({ data: rows, error: null }),
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

  return {
    client,
    getWorkOrders: () => workOrders,
    getHistory: () => historyRows
  };
}

// ---------------------------------------------------------------------------
// Test 1: Reassign satu WO berhasil (client async + json.workOrder contract)
// ---------------------------------------------------------------------------
test('1. Reassign satu WO berhasil mengirim newInstallerId, newInstallerName, reason dan membaca json.workOrder', async () => {
  const ticket = makeAssignedTicket();
  let capturedUrl = '';
  let capturedBody: any = null;

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(
      JSON.stringify({
        success: true,
        requestId: 'req_reassign_ok_1',
        message: 'Work Order WO-REASSIGN-001 berhasil dialihkan ke teknisi Andi Wijaya.',
        workOrder: {
          ...ticket,
          installerId: INSTALLER_B.id,
          installerName: INSTALLER_B.name,
          reassignmentReason: 'Teknisi sebelumnya kendala armada'
        },
        historyEntry: {
          id: 'hist_1',
          woNumber: ticket.woNumber,
          previousInstallerName: INSTALLER_A.name,
          newInstallerName: INSTALLER_B.name,
          reason: 'Teknisi sebelumnya kendala armada',
          sourceAction: 'reassign'
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await executeReassignWorkOrderRequest({
    ticket,
    users: [LEADER_USER, INSTALLER_A, INSTALLER_B],
    leader: LEADER_USER,
    newInstallerId: INSTALLER_B.id,
    newInstallerName: INSTALLER_B.name,
    reason: 'Teknisi sebelumnya kendala armada',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_test' },
    fetchImpl: mockFetch
  });

  assert.equal(capturedUrl, '/api/tickets/reassign');
  assert.equal(capturedBody.ticketId, ticket.id);
  assert.equal(capturedBody.woNumber, ticket.woNumber);
  assert.equal(capturedBody.newInstallerId, INSTALLER_B.id);
  assert.equal(capturedBody.newInstallerName, INSTALLER_B.name);
  assert.equal(capturedBody.reason, 'Teknisi sebelumnya kendala armada');

  assert.equal(result.success, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.workOrder?.installerId, INSTALLER_B.id);
  assert.equal(result.workOrder?.installerName, INSTALLER_B.name);
  assert.equal(result.historyEntry?.id, 'hist_1');
});

// ---------------------------------------------------------------------------
// Test 2: Installer ID tidak valid (tanpa ID sintetis inst-*)
// ---------------------------------------------------------------------------
test('2. Installer ID tidak valid atau tidak ada di Supabase langsung ditolak tanpa membuat ID sintetis', async () => {
  const ticket = makeAssignedTicket();
  let fetchCalled = false;
  const mockFetch: typeof fetch = async () => {
    fetchCalled = true;
    throw new Error('Fetch should not be called');
  };

  const resByUnknownId = await executeReassignWorkOrderRequest({
    ticket,
    users: [LEADER_USER, INSTALLER_A, INSTALLER_B],
    leader: LEADER_USER,
    newInstallerId: 'usr_non_existent_999',
    newInstallerName: 'Teknisi Fiktif',
    reason: 'Alasan reassign valid lima karakter',
    headers: { 'Content-Type': 'application/json' },
    fetchImpl: mockFetch
  });

  assert.equal(fetchCalled, false);
  assert.equal(resByUnknownId.success, false);
  assert.equal(resByUnknownId.code, 'INSTALLER_NOT_FOUND');

  // Even if caller passes synthetic timestamp ID like inst-1700000000000, reject it
  const syntheticInstaller: User = {
    ...INSTALLER_B,
    id: 'inst-1764000000000'
  };
  const precheckSynthetic = validateReassignPreconditions({
    ticket,
    users: [LEADER_USER, INSTALLER_A, syntheticInstaller],
    leader: LEADER_USER,
    newInstallerId: syntheticInstaller.id,
    newInstallerName: syntheticInstaller.name,
    reason: 'Alasan reassign valid lima karakter'
  });
  assert.equal(precheckSynthetic.valid, false);
  assert.equal(precheckSynthetic.code, 'INSTALLER_ID_INVALID');
});

// ---------------------------------------------------------------------------
// Test 3: Installer tidak aktif
// ---------------------------------------------------------------------------
test('3. Installer tidak aktif ditolak sebelum mengirim mutasi reassign', async () => {
  const ticket = makeAssignedTicket();
  let fetchCalled = false;

  const result = await executeReassignWorkOrderRequest({
    ticket,
    users: [LEADER_USER, INSTALLER_A, INSTALLER_INACTIVE],
    leader: LEADER_USER,
    newInstallerId: INSTALLER_INACTIVE.id,
    newInstallerName: INSTALLER_INACTIVE.name,
    reason: 'Teknisi sebelumnya berhalangan',
    headers: { 'Content-Type': 'application/json' },
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.success, false);
  assert.equal(result.code, 'INSTALLER_INACTIVE');
  assert.match(result.error || '', /tidak aktif/i);
});

// ---------------------------------------------------------------------------
// Test 4: Leader tidak memiliki scope yang sesuai
// ---------------------------------------------------------------------------
test('4. Leader di luar scope Contractor/Area ditolak baik untuk WO maupun untuk Installer tujuan', async () => {
  const outOfScopeTicket = makeAssignedTicket({
    id: 'wo_other_ctr',
    woNumber: 'WO-OTHER-01',
    contractorId: 'ctr_other',
    contractorName: 'PT Kompetitor',
    contactorName: 'PT Kompetitor'
  });

  const resWoScope = await executeReassignWorkOrderRequest({
    ticket: outOfScopeTicket,
    users: [LEADER_USER, INSTALLER_A, INSTALLER_B],
    leader: LEADER_USER,
    newInstallerId: INSTALLER_B.id,
    newInstallerName: INSTALLER_B.name,
    reason: 'Alasan reassign valid',
    headers: { 'Content-Type': 'application/json' },
    fetchImpl: async () => {
      throw new Error('Should not reach network');
    }
  });
  assert.equal(resWoScope.success, false);
  assert.equal(resWoScope.code, 'SCOPE_MISMATCH');
  assert.equal(resWoScope.httpStatus, 403);

  const inScopeTicket = makeAssignedTicket();
  const resInstScope = await executeReassignWorkOrderRequest({
    ticket: inScopeTicket,
    users: [LEADER_USER, INSTALLER_A, INSTALLER_OTHER_CONTRACTOR],
    leader: LEADER_USER,
    newInstallerId: INSTALLER_OTHER_CONTRACTOR.id,
    newInstallerName: INSTALLER_OTHER_CONTRACTOR.name,
    reason: 'Alasan reassign valid',
    headers: { 'Content-Type': 'application/json' },
    fetchImpl: async () => {
      throw new Error('Should not reach network');
    }
  });
  assert.equal(resInstScope.success, false);
  assert.equal(resInstScope.code, 'SCOPE_MISMATCH');
  assert.equal(resInstScope.httpStatus, 403);
});

// ---------------------------------------------------------------------------
// Test 5 & 6: HTTP 403 & HTTP 409 dari server
// ---------------------------------------------------------------------------
test('5. HTTP 403 dari server ditangani dengan failure dan pesan error backend', async () => {
  const ticket = makeAssignedTicket();
  const result = await executeReassignWorkOrderRequest({
    ticket,
    users: [LEADER_USER, INSTALLER_A, INSTALLER_B],
    leader: LEADER_USER,
    newInstallerId: INSTALLER_B.id,
    newInstallerName: INSTALLER_B.name,
    reason: 'Alasan reassign valid',
    headers: { 'Content-Type': 'application/json' },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 'SCOPE_MISMATCH',
          error: 'Akses Ditolak: Scope Leader tidak valid di server.'
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
  });

  assert.equal(result.success, false);
  assert.equal(result.httpStatus, 403);
  assert.equal(result.code, 'SCOPE_MISMATCH');
  assert.match(result.error || '', /Akses Ditolak/i);
});

test('6. HTTP 409 dari server ditangani dengan failure tanpa menganggap sukses', async () => {
  const ticket = makeAssignedTicket();
  const result = await executeReassignWorkOrderRequest({
    ticket,
    users: [LEADER_USER, INSTALLER_A, INSTALLER_B],
    leader: LEADER_USER,
    newInstallerId: INSTALLER_B.id,
    newInstallerName: INSTALLER_B.name,
    reason: 'Alasan reassign valid',
    headers: { 'Content-Type': 'application/json' },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 'WO_DELETED_OR_ARCHIVED',
          error: 'Work Order sudah dihapus atau diarsipkan.'
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
  });

  assert.equal(result.success, false);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.code, 'WO_DELETED_OR_ARCHIVED');
  assert.match(result.error || '', /dihapus|diarsipkan/i);
});

// ---------------------------------------------------------------------------
// Test 7: Server timeout
// ---------------------------------------------------------------------------
test('7. Server timeout memicu AbortController dan mengembalikan error timeout tanpa fallback lokal', async () => {
  const ticket = makeAssignedTicket();
  const hangingFetch: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });

  const result = await executeReassignWorkOrderRequest({
    ticket,
    users: [LEADER_USER, INSTALLER_A, INSTALLER_B],
    leader: LEADER_USER,
    newInstallerId: INSTALLER_B.id,
    newInstallerName: INSTALLER_B.name,
    reason: 'Alasan reassign valid',
    headers: { 'Content-Type': 'application/json' },
    fetchImpl: hangingFetch,
    timeoutMs: 25
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'REQUEST_TIMEOUT');
  assert.equal(result.httpStatus, 408);
  assert.equal(result.workOrder, undefined);
});

// ---------------------------------------------------------------------------
// Test 8: Response JSON tidak sesuai kontrak
// ---------------------------------------------------------------------------
test('8. Response JSON tidak sesuai kontrak (missing workOrder, legacy json.ticket only, atau non-JSON) ditolak', () => {
  // HTTP 200 with legacy `ticket` instead of `workOrder`
  const missingWorkOrder = parseReassignApiResponse(200, true, {
    success: true,
    ticket: { id: 'wo_1', woNumber: 'WO-1' }
  });
  assert.equal(missingWorkOrder.success, false);
  assert.equal(missingWorkOrder.code, 'INVALID_RESPONSE_CONTRACT');

  // HTTP 200 with null JSON (non-JSON body)
  const nonJson = parseReassignApiResponse(200, true, null);
  assert.equal(nonJson.success, false);
  assert.equal(nonJson.code, 'INVALID_RESPONSE_CONTRACT');

  // HTTP 200 with success: false
  const logicalFail = parseReassignApiResponse(200, true, {
    success: false,
    error: 'Gagal validasi backend'
  });
  assert.equal(logicalFail.success, false);
  assert.equal(logicalFail.error, 'Gagal validasi backend');
});

// ---------------------------------------------------------------------------
// Test 9: Request gagal tidak menghasilkan toast sukses & tidak menutup modal
// ---------------------------------------------------------------------------
test('9. Request gagal tidak menghasilkan toast sukses, tidak menutup modal, dan tidak mengubah state tiket', async () => {
  let ticketsState: Ticket[] = [makeAssignedTicket()];
  let modalOpen = true;
  let toastSuccessCount = 0;
  let toastErrorCount = 0;

  async function simulatedCallerFlow(fetchImpl: typeof fetch) {
    const result = await executeReassignWorkOrderRequest({
      ticket: ticketsState[0],
      users: [LEADER_USER, INSTALLER_A, INSTALLER_B],
      leader: LEADER_USER,
      newInstallerId: INSTALLER_B.id,
      newInstallerName: INSTALLER_B.name,
      reason: 'Alasan reassign valid',
      headers: { 'Content-Type': 'application/json' },
      fetchImpl
    });

    if (!result.success || !result.workOrder) {
      toastErrorCount += 1;
      return result;
    }

    ticketsState = ticketsState.map(t => (t.id === result.workOrder!.id ? result.workOrder! : t));
    modalOpen = false;
    toastSuccessCount += 1;
    return result;
  }

  // Case A: HTTP 500 error
  const failRes = await simulatedCallerFlow(async () =>
    new Response(JSON.stringify({ success: false, error: 'Database unavailable' }), { status: 500 })
  );
  assert.equal(failRes.success, false);
  assert.equal(toastSuccessCount, 0);
  assert.equal(toastErrorCount, 1);
  assert.equal(modalOpen, true);
  assert.equal(ticketsState[0].installerId, INSTALLER_A.id);
  assert.equal(ticketsState[0].installerName, INSTALLER_A.name);

  // Case B: Malformed HTTP 200 without workOrder
  const contractFailRes = await simulatedCallerFlow(async () =>
    new Response(JSON.stringify({ success: true }), { status: 200 })
  );
  assert.equal(contractFailRes.success, false);
  assert.equal(toastSuccessCount, 0);
  assert.equal(toastErrorCount, 2);
  assert.equal(modalOpen, true);
  assert.equal(ticketsState[0].installerId, INSTALLER_A.id);
});

// ---------------------------------------------------------------------------
// Test 10: Real Express HTTP End-to-End & Refresh Setelah Reassignment
// ---------------------------------------------------------------------------
test('10. Real Express POST /api/tickets/reassign & refresh setelah reassignment mempertahankan installer baru dari DB', async () => {
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock_service_role_key_for_test';

  const mock = createReassignMockSupabase({
    workOrders: [
      {
        id: 'wo_e2e_1',
        wo_number: 'WO-E2E-001',
        contractor_id: 'ctr_fm_01',
        contractor_name: 'PT Fiberindo Mitra',
        contactor_name: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        appointment_date: '2026-11-25',
        status_wo_agent: 'In Progress',
        status_wo_installer: 'Assigned',
        installer_id: INSTALLER_A.id,
        installer_name: INSTALLER_A.name,
        is_deleted: false,
        is_archived: false,
        updated_at: '2026-11-25T00:00:00Z',
        payload: {
          woNumber: 'WO-E2E-001',
          installerId: INSTALLER_A.id,
          installerName: INSTALLER_A.name
        }
      },
      {
        id: 'wo_e2e_deleted',
        wo_number: 'WO-E2E-DEL',
        contractor_id: 'ctr_fm_01',
        contractor_name: 'PT Fiberindo Mitra',
        contactor_name: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        appointment_date: '2026-11-25',
        status_wo_installer: 'Assigned',
        installer_id: INSTALLER_A.id,
        installer_name: INSTALLER_A.name,
        is_deleted: true,
        is_archived: false,
        payload: { woNumber: 'WO-E2E-DEL' }
      }
    ],
    users: [
      {
        id: LEADER_USER.id,
        name: LEADER_USER.name,
        username: LEADER_USER.username,
        role: 'leader',
        contractor_id: 'ctr_fm_01',
        contractor: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        active: true,
        is_deleted: false,
        session_version: 1
      },
      {
        id: INSTALLER_A.id,
        name: INSTALLER_A.name,
        username: INSTALLER_A.username,
        role: 'installer',
        contractor_id: 'ctr_fm_01',
        contractor: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        active: true,
        is_deleted: false
      },
      {
        id: INSTALLER_B.id,
        name: INSTALLER_B.name,
        username: INSTALLER_B.username,
        role: 'installer',
        contractor_id: 'ctr_fm_01',
        contractor: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        active: true,
        is_deleted: false
      },
      {
        id: INSTALLER_INACTIVE.id,
        name: INSTALLER_INACTIVE.name,
        username: INSTALLER_INACTIVE.username,
        role: 'installer',
        contractor_id: 'ctr_fm_01',
        contractor: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        active: false,
        is_deleted: false
      },
      {
        id: INSTALLER_OTHER_CONTRACTOR.id,
        name: INSTALLER_OTHER_CONTRACTOR.name,
        username: INSTALLER_OTHER_CONTRACTOR.username,
        role: 'installer',
        contractor_id: 'ctr_other',
        contractor: 'PT Kompetitor',
        area: 'Bandung 02',
        active: true,
        is_deleted: false
      }
    ]
  });

  setSupabaseBackendClientForTesting(mock.client);
  const savedSessions = [...SERVER_SESSIONS];
  SERVER_SESSIONS.length = 0;
  const nowIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
  SERVER_SESSIONS.push(
    {
      sessionId: 'sess_re_leader',
      token: 'tok_re_leader',
      userId: LEADER_USER.id,
      username: LEADER_USER.username!,
      name: LEADER_USER.name,
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
      sessionId: 'sess_re_inst_b',
      token: 'tok_re_inst_b',
      userId: INSTALLER_B.id,
      username: INSTALLER_B.username!,
      name: INSTALLER_B.name,
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
    // A. Client-to-server end-to-end reassign via real HTTP
    const e2eResult = await executeReassignWorkOrderRequest({
      ticket: makeAssignedTicket({ id: 'wo_e2e_1', woNumber: 'WO-E2E-001' }),
      users: [LEADER_USER, INSTALLER_A, INSTALLER_B],
      leader: LEADER_USER,
      newInstallerId: INSTALLER_B.id,
      newInstallerName: INSTALLER_B.name,
      reason: 'Pemerataan slot sore wilayah Bandung 02',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok_re_leader'
      },
      fetchImpl: (url, init) => fetch(`${baseUrl}${url}`, init)
    });

    assert.equal(e2eResult.success, true);
    assert.equal(e2eResult.workOrder?.installerId, INSTALLER_B.id);
    assert.equal(e2eResult.workOrder?.installerName, INSTALLER_B.name);
    assert.ok(e2eResult.historyEntry);
    assert.equal(mock.getHistory().length, 1);

    // B. Refresh from backend progressive feed (simulating page reload / refreshActiveTickets)
    const refreshResp = await fetch(`${baseUrl}/api/work-orders/progressive?phase=critical&page=1&limit=50`, {
      headers: { Authorization: 'Bearer tok_re_inst_b' }
    });
    assert.equal(refreshResp.status, 200);
    const refreshJson = await refreshResp.json();
    const refreshedWo = (refreshJson.tickets || []).find((t: any) => t.id === 'wo_e2e_1');
    assert.ok(refreshedWo, 'Refreshed progressive feed for Installer B must contain reassigned WO');
    assert.equal(refreshedWo.installerId, INSTALLER_B.id);
    assert.equal(refreshedWo.installerName, INSTALLER_B.name);

    // C. Backend HTTP validation checks: invalid ID -> 400, inactive -> 400, scope mismatch -> 403, deleted -> 409
    const badIdResp = await fetch(`${baseUrl}/api/tickets/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_re_leader' },
      body: JSON.stringify({
        ticketId: 'wo_e2e_1',
        woNumber: 'WO-E2E-001',
        newInstallerId: 'missing_id_xyz',
        newInstallerName: 'Andi Wijaya',
        reason: 'Alasan valid lima karakter'
      })
    });
    assert.equal(badIdResp.status, 400);

    const inactiveResp = await fetch(`${baseUrl}/api/tickets/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_re_leader' },
      body: JSON.stringify({
        ticketId: 'wo_e2e_1',
        woNumber: 'WO-E2E-001',
        newInstallerId: INSTALLER_INACTIVE.id,
        newInstallerName: INSTALLER_INACTIVE.name,
        reason: 'Alasan valid lima karakter'
      })
    });
    assert.equal(inactiveResp.status, 400);

    const scopeResp = await fetch(`${baseUrl}/api/tickets/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_re_leader' },
      body: JSON.stringify({
        ticketId: 'wo_e2e_1',
        woNumber: 'WO-E2E-001',
        newInstallerId: INSTALLER_OTHER_CONTRACTOR.id,
        newInstallerName: INSTALLER_OTHER_CONTRACTOR.name,
        reason: 'Alasan valid lima karakter'
      })
    });
    assert.equal(scopeResp.status, 403);

    const conflictResp = await fetch(`${baseUrl}/api/tickets/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_re_leader' },
      body: JSON.stringify({
        ticketId: 'wo_e2e_deleted',
        woNumber: 'WO-E2E-DEL',
        newInstallerId: INSTALLER_B.id,
        newInstallerName: INSTALLER_B.name,
        reason: 'Alasan valid lima karakter'
      })
    });
    assert.equal(conflictResp.status, 409);
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
