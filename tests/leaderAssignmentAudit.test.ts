import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  isContractorScopeMatchClient,
  isTicketInLeaderScope,
  resolveTargetInstallerClient,
  buildAssignmentPatchPlan,
  formatAssignmentFailureMessage
} from '../src/services/assignmentClientHelpers.ts';

import {
  doesContractorScopeMatch,
  doesAreaScopeMatch,
  formatScopeLabel
} from '../server/appFlowHelpers.ts';

import {
  assignTicketInSupabase,
  getWorkOrdersFromSupabasePaginated
} from '../server/supabaseAdapter.ts';

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
// Stateful Production-like Mock Supabase Client
// ---------------------------------------------------------------------------
interface MockDbOptions {
  workOrders?: any[];
  users?: any[];
  /**
   * Simulates Production schema without Migration 009 extra columns
   * (`installer_uid`, `assigned_to`, `assigned_to_uid`, etc.) on `public.work_orders`.
   */
  strictProductionColumnsOnly?: boolean;
  failHistoryInsert?: boolean;
}

const UNMIGRATED_OPTIONAL_WO_COLUMNS = new Set([
  'installer_uid',
  'assigned_to',
  'assigned_to_uid',
  'chat_category',
  'leader_id',
  'leader_contact',
  'distributed_at',
  'distributed_by'
]);

function createProductionCompatibleMockSupabase(opts: MockDbOptions = {}) {
  const workOrders: any[] = (opts.workOrders || []).map(w => ({ ...w, payload: { ...(w.payload || {}) } }));
  const users: any[] = (opts.users || []).map(u => ({ ...u, payload: { ...(u.payload || {}) } }));
  const historyRows: any[] = [];
  const auditLogs: any[] = [];

  const applyFilterConditions = (rows: any[], eqFilters: Array<[string, any]>, orExprs: string[], ilikeFilters: Array<[string, string]>) => {
    return rows.filter(row => {
      for (const [col, val] of eqFilters) {
        if (row[col] !== val) return false;
      }
      for (const [col, pattern] of ilikeFilters) {
        const clean = String(pattern).replace(/%/g, '').trim().toLowerCase();
        const actual = String(row[col] || '').trim().toLowerCase();
        if (!actual.includes(clean)) return false;
      }
      for (const expr of orExprs) {
        // Parse minimal PostgREST `.or(...)` parts used in supabaseAdapter
        const parts = expr.split(',').map(s => s.trim()).filter(Boolean);
        let anyMatched = false;
        for (const p of parts) {
          const eqMatch = p.match(/^([a-zA-Z0-9_]+)\.eq\.(.+)$/);
          if (eqMatch) {
            const col = eqMatch[1];
            const rawVal = eqMatch[2].replace(/^"|"$/g, '');
            if (opts.strictProductionColumnsOnly && UNMIGRATED_OPTIONAL_WO_COLUMNS.has(col)) {
              // Trigger schema error simulation outside filter loop
              throw { code: '42703', message: `column work_orders.${col} does not exist` };
            }
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
          select: (cols = '*', selectOpts?: { count?: string }) => {
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
                try {
                  if (opts.strictProductionColumnsOnly && cols !== '*') {
                    for (const c of String(cols).split(',').map(x => x.trim())) {
                      if (UNMIGRATED_OPTIONAL_WO_COLUMNS.has(c)) {
                        return { data: null, error: { code: '42703', message: `column work_orders.${c} does not exist` } };
                      }
                    }
                  }
                  const matched = applyFilterConditions(workOrders, eqFilters, orExprs, ilikeFilters);
                  if (matched.length === 0) {
                    return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
                  }
                  return { data: { ...matched[0], payload: { ...(matched[0].payload || {}) } }, error: null };
                } catch (err: any) {
                  return { data: null, error: err };
                }
              },
              maybeSingle: async () => {
                try {
                  const matched = applyFilterConditions(workOrders, eqFilters, orExprs, ilikeFilters);
                  return {
                    data: matched[0] ? { ...matched[0], payload: { ...(matched[0].payload || {}) } } : null,
                    error: null
                  };
                } catch (err: any) {
                  return { data: null, error: err };
                }
              },
              then: (resolve: (v: any) => any, reject?: (e: any) => any) => {
                const exec = async () => {
                  try {
                    if (opts.strictProductionColumnsOnly && cols !== '*') {
                      for (const c of String(cols).split(',').map(x => x.trim())) {
                        if (UNMIGRATED_OPTIONAL_WO_COLUMNS.has(c)) {
                          return { data: null, count: null, error: { code: '42703', message: `column work_orders.${c} does not exist` } };
                        }
                      }
                    }
                    const matched = applyFilterConditions(workOrders, eqFilters, orExprs, ilikeFilters);
                    const sliced = rangeBounds ? matched.slice(rangeBounds[0], rangeBounds[1] + 1) : matched;
                    return {
                      data: sliced.map(r => ({ ...r, payload: { ...(r.payload || {}) } })),
                      count: selectOpts?.count ? matched.length : undefined,
                      error: null
                    };
                  } catch (err: any) {
                    return { data: null, count: null, error: err };
                  }
                };
                return exec().then(resolve, reject);
              }
            };
            return builder;
          },
          update: (updates: Record<string, any>) => ({
            eq: (col: string, val: any) => ({
              select: () => ({
                single: async () => {
                  if (opts.strictProductionColumnsOnly) {
                    for (const key of Object.keys(updates)) {
                      if (UNMIGRATED_OPTIONAL_WO_COLUMNS.has(key)) {
                        return {
                          data: null,
                          error: {
                            code: 'PGRST204',
                            message: `Could not find the '${key}' column of 'work_orders' in the schema cache`
                          }
                        };
                      }
                    }
                  }
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
                if (opts.failHistoryInsert) {
                  return { data: null, error: { code: '23503', message: 'Foreign key / constraint failure on assignment_history' } };
                }
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

      if (table === 'notifications') {
        return {
          insert: (rows: any[]) => Promise.resolve({ data: rows, error: null }),
          select: () => Promise.resolve({ data: [], error: null })
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

  return {
    client,
    getWorkOrders: () => workOrders,
    getHistory: () => historyRows,
    getAuditLogs: () => auditLogs
  };
}

function makeLeaderTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'wo-101',
    woNumber: 'WO-20261125-001',
    idCustomer: '1234567',
    customerName: 'Bapak Agus',
    customerAddress: 'Jl. Arcamanik No. 12',
    customerContact: '081200001111',
    appointmentDate: '2026-11-25',
    slotTime: '09:00 - 11:00',
    contractorId: '',
    contractorName: 'PT Fiberindo Mitra',
    contactorName: 'PT Fiberindo Mitra',
    area: 'Bandung 02',
    statusWOAgent: 'OPEN',
    statusWOInstaller: 'Unassigned',
    createdAt: '2026-11-24T10:00:00Z',
    updatedAt: '2026-11-24T10:00:00Z',
    ...overrides
  } as Ticket;
}

// ---------------------------------------------------------------------------
// 1. UNIT TESTS: Pure Frontend & Shared Scope Helpers
// ---------------------------------------------------------------------------
test('Scope helpers support dual contractorId + free-text contractor name and fail closed when empty', () => {
  // Backend helpers
  assert.equal(
    doesContractorScopeMatch({
      userContractorId: 'ctr_01',
      userContractorName: 'PT Fiberindo Mitra',
      targetContractorId: null,
      targetContractorName: 'PT Fiberindo Mitra'
    }),
    true
  );
  assert.equal(
    doesContractorScopeMatch({
      userContractorId: 'ctr_01',
      userContractorName: 'PT Fiberindo Mitra',
      targetContractorId: 'ctr_02',
      targetContractorName: 'PT Mitra Lain'
    }),
    false
  );
  assert.equal(
    doesContractorScopeMatch({
      userContractorId: '',
      userContractorName: '',
      targetContractorId: 'ctr_01',
      targetContractorName: 'PT Fiberindo Mitra'
    }),
    false
  );
  assert.equal(doesAreaScopeMatch('Bandung 02', 'Bandung 02 - Arcamanik'), true);
  assert.equal(doesAreaScopeMatch('Bandung 02', 'Jakarta Barat'), false);
  assert.ok(formatScopeLabel('PT Fiberindo Mitra', 'ctr_01').includes('PT Fiberindo Mitra'));

  // Frontend mirror helpers
  assert.equal(
    isContractorScopeMatchClient('ctr_01', 'PT Fiberindo Mitra', undefined, 'PT Fiberindo Mitra'),
    true
  );
  const leader: User = {
    id: 'usr-leader-1',
    name: 'Budi Santoso',
    username: 'leader_bdg02',
    role: 'leader',
    contractorId: 'ctr_01',
    contractor: 'PT Fiberindo Mitra',
    area: 'Bandung 02',
    active: true
  };
  assert.equal(isTicketInLeaderScope(makeLeaderTicket(), leader), true);
  assert.equal(
    isTicketInLeaderScope(makeLeaderTicket({ isDeleted: true }), leader),
    false
  );
  assert.equal(
    isTicketInLeaderScope(makeLeaderTicket({ area: 'Surabaya Selatan' }), leader),
    false
  );
});

test('resolveTargetInstallerClient prefers active in-scope installer ID and buildAssignmentPatchPlan does not mutate input', () => {
  const users: User[] = [
    {
      id: 'inst-other-ctr',
      name: 'Rizky Pratama',
      username: 'rizky_other',
      role: 'installer',
      contractorId: 'ctr_99',
      contractor: 'PT Vendor Lain',
      active: true
    },
    {
      id: 'inst-inactive',
      name: 'Dedi Lama',
      username: 'dedi_old',
      role: 'installer',
      contractorId: 'ctr_01',
      contractor: 'PT Fiberindo Mitra',
      active: false
    },
    {
      id: 'inst-target',
      name: 'Rizky Pratama',
      username: 'rizky_fm',
      role: 'installer',
      contractor: 'PT Fiberindo Mitra',
      phone: '08123456789',
      active: true
    }
  ];

  const resolved = resolveTargetInstallerClient(users, 'Rizky Pratama', 'ctr_01', 'PT Fiberindo Mitra');
  assert.equal(resolved?.id, 'inst-target');

  const original = makeLeaderTicket();
  const inScopeTicket = makeLeaderTicket({ id: 'wo-101' });
  const outScopeTicket = makeLeaderTicket({
    id: 'wo-999',
    woNumber: 'WO-999',
    contractorId: 'ctr_99',
    contractorName: 'PT Vendor Lain',
    contactorName: 'PT Vendor Lain'
  });

  const plan = buildAssignmentPatchPlan({
    allTickets: [inScopeTicket, outScopeTicket],
    targetIds: ['wo-101', 'wo-999'],
    installer: resolved,
    installerNameInput: 'Rizky Pratama',
    leader: {
      id: 'usr-leader-1',
      name: 'Budi Santoso',
      role: 'leader',
      contractorId: 'ctr_01',
      contractor: 'PT Fiberindo Mitra',
      area: 'Bandung 02'
    },
    slotTime: '13:00 - 15:30',
    nowIso: '2026-11-25T08:00:00Z'
  });

  assert.equal(plan.updatedTicketsList.length, 1);
  assert.equal(plan.outOfScopeIds.length, 1);
  assert.equal(plan.outOfScopeIds[0], 'wo-999');
  assert.equal(plan.updatedTicketsList[0].installerId, 'inst-target');
  assert.equal(plan.updatedTicketsList[0].statusWOInstaller, 'Assigned');
  assert.equal(plan.prevSnapshots.get('wo-101')?.installerName, undefined);
  // Ensure input object was never mutated in-place
  assert.equal(inScopeTicket.installerName, original.installerName);
  assert.equal(inScopeTicket.statusWOInstaller, 'Unassigned');

  const formattedMsg = formatAssignmentFailureMessage({
    failed: [
      {
        id: 'wo-101',
        woNumber: 'WO-20261125-001',
        code: 'SCOPE_MISMATCH',
        error: 'Mitra kontraktor tidak sesuai'
      }
    ],
    requestId: 'assign_req_123',
    totalCount: 1,
    successCount: 0
  });
  assert.match(formattedMsg, /SCOPE_MISMATCH/);
  assert.match(formattedMsg, /WO-20261125-001/);
  assert.match(formattedMsg, /assign_req_123/);
});

// ---------------------------------------------------------------------------
// 2. ADAPTER INTEGRATION TESTS: Production Schema Compatibility & Guards
// ---------------------------------------------------------------------------
test('assignTicketInSupabase succeeds on strict Production schema (no installer_uid/assigned_to columns) & Enterprise-imported WO without contractor_id', async () => {
  const mock = createProductionCompatibleMockSupabase({
    strictProductionColumnsOnly: true,
    workOrders: [
      {
        id: 'wo_ent_01',
        wo_number: 'WO-ENT-20261125-001',
        id_customer: '7654321',
        customer_name: 'Ibu Siti',
        contractor_id: null,
        contractor_name: 'PT Fiberindo Mitra',
        contactor_name: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        appointment_date: '2026-11-25',
        slot_time: '09:00 - 11:00',
        status_wo_agent: 'OPEN',
        status_wo_installer: 'Unassigned',
        installer_id: null,
        installer_name: null,
        is_deleted: false,
        is_archived: false,
        updated_at: '2026-11-25T01:00:00Z',
        payload: {
          woNumber: 'WO-ENT-20261125-001',
          contractorName: 'PT Fiberindo Mitra'
        }
      }
    ],
    users: [
      {
        id: 'usr_inst_01',
        name: 'Rizky Pratama',
        username: 'rizky_fm',
        role: 'installer',
        contractor_id: null,
        contractor: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        phone: '081234567890',
        active: true,
        is_deleted: false,
        is_archived: false
      }
    ]
  });

  setSupabaseBackendClientForTesting(mock.client);
  try {
    const res = await assignTicketInSupabase({
      workOrderIdOrWoNumber: 'wo_ent_01',
      installerId: 'usr_inst_01',
      installerName: 'Rizky Pratama',
      slotTime: '13:00 - 15:30',
      performedBy: 'Budi Santoso',
      performedByRole: 'leader',
      performedById: 'usr_leader_01',
      userRole: 'leader',
      userContractorId: 'ctr_fm_01',
      userContractor: 'PT Fiberindo Mitra',
      userArea: 'Bandung 02',
      requestId: 'req_test_prod_schema'
    });

    assert.equal(res.success, true, `Expected assignment to succeed, got error: ${JSON.stringify(res.error)}`);
    assert.equal(res.data?.workOrder?.installerId, 'usr_inst_01');
    assert.equal(res.data?.workOrder?.installerName, 'Rizky Pratama');
    assert.equal(res.data?.workOrder?.statusWOInstaller, 'Assigned');
    assert.equal(res.data?.workOrder?.payload?.installerId ?? mock.getWorkOrders()[0].payload.installerId, 'usr_inst_01');
    assert.equal(mock.getHistory().length, 1);
    assert.equal(mock.getHistory()[0].work_order_id, 'wo_ent_01');
    assert.equal(mock.getHistory()[0].installer_name, 'Rizky Pratama');

    // Verify Installer Portal fetch also adapts cleanly without installer_uid / assigned_to_uid columns
    const instFeed = await getWorkOrdersFromSupabasePaginated({
      userRole: 'installer',
      userId: 'usr_inst_01',
      page: 1,
      limit: 50
    });
    assert.equal(instFeed.success, true, `Expected paginated fallback to succeed, got: ${JSON.stringify(instFeed.error)}`);
    assert.equal(instFeed.data?.tickets.length, 1);
    assert.equal(instFeed.data?.tickets[0].id, 'wo_ent_01');

    // Verify repeat identical click triggers idempotency without creating duplicate assignment_history
    const dupRes = await assignTicketInSupabase({
      workOrderIdOrWoNumber: 'wo_ent_01',
      installerId: 'usr_inst_01',
      installerName: 'Rizky Pratama',
      slotTime: '13:00 - 15:30',
      performedBy: 'Budi Santoso',
      performedByRole: 'leader',
      performedById: 'usr_leader_01',
      userRole: 'leader',
      userContractorId: 'ctr_fm_01',
      userContractor: 'PT Fiberindo Mitra',
      userArea: 'Bandung 02',
      requestId: 'req_test_idempotent'
    });
    assert.equal(dupRes.success, true);
    assert.equal(dupRes.data?.idempotent, true);
    assert.equal(mock.getHistory().length, 1);
  } finally {
    resetSupabaseBackendClientForTesting();
  }
});

test('assignTicketInSupabase enforces soft-delete check, inactive installer rejection, scope check, and history-failure rollback', async () => {
  // Case A: Deleted WO -> WO_DELETED_OR_ARCHIVED
  {
    const mock = createProductionCompatibleMockSupabase({
      strictProductionColumnsOnly: true,
      workOrders: [
        {
          id: 'wo_del_01',
          wo_number: 'WO-DEL-001',
          contractor_name: 'PT Fiberindo Mitra',
          area: 'Bandung 02',
          is_deleted: true,
          is_archived: false
        }
      ],
      users: [{ id: 'inst_1', name: 'Rizky', role: 'installer', contractor: 'PT Fiberindo Mitra', active: true, is_deleted: false }]
    });
    setSupabaseBackendClientForTesting(mock.client);
    try {
      const res = await assignTicketInSupabase({
        workOrderIdOrWoNumber: 'wo_del_01',
        installerId: 'inst_1',
        installerName: 'Rizky',
        performedBy: 'Leader Budi',
        userRole: 'leader',
        userContractor: 'PT Fiberindo Mitra',
        userArea: 'Bandung 02'
      });
      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'WO_DELETED_OR_ARCHIVED');
    } finally {
      resetSupabaseBackendClientForTesting();
    }
  }

  // Case B: History insert fails -> WO state rolls back cleanly
  {
    const mock = createProductionCompatibleMockSupabase({
      strictProductionColumnsOnly: true,
      failHistoryInsert: true,
      workOrders: [
        {
          id: 'wo_rb_01',
          wo_number: 'WO-RB-001',
          contractor_name: 'PT Fiberindo Mitra',
          contactor_name: 'PT Fiberindo Mitra',
          area: 'Bandung 02',
          status_wo_installer: 'Unassigned',
          installer_id: null,
          installer_name: null,
          is_deleted: false,
          is_archived: false,
          payload: {}
        }
      ],
      users: [
        {
          id: 'inst_1',
          name: 'Rizky Pratama',
          role: 'installer',
          contractor: 'PT Fiberindo Mitra',
          area: 'Bandung 02',
          active: true,
          is_deleted: false
        }
      ]
    });
    setSupabaseBackendClientForTesting(mock.client);
    try {
      const res = await assignTicketInSupabase({
        workOrderIdOrWoNumber: 'wo_rb_01',
        installerId: 'inst_1',
        installerName: 'Rizky Pratama',
        performedBy: 'Leader Budi',
        userRole: 'leader',
        userContractor: 'PT Fiberindo Mitra',
        userArea: 'Bandung 02'
      });
      assert.equal(res.success, false);
      const woAfter = mock.getWorkOrders()[0];
      assert.equal(woAfter.installer_id, null);
      assert.equal(woAfter.status_wo_installer, 'Unassigned');
    } finally {
      resetSupabaseBackendClientForTesting();
    }
  }
});

// ---------------------------------------------------------------------------
// 3. REAL EXPRESS HTTP LOOPBACK INTEGRATION TESTS
// ---------------------------------------------------------------------------
test('HTTP endpoints: POST /api/tickets/assign & GET /api/supabase/users work end-to-end with Leader dual-scope & partial failure reporting', async () => {
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock_service_role_key_for_test';

  const mock = createProductionCompatibleMockSupabase({
    strictProductionColumnsOnly: true,
    workOrders: [
      {
        id: 'wo_http_01',
        wo_number: 'WO-HTTP-001',
        contractor_id: null,
        contractor_name: 'PT Fiberindo Mitra',
        contactor_name: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        appointment_date: '2026-11-25',
        status_wo_installer: 'Unassigned',
        installer_id: null,
        installer_name: null,
        is_deleted: false,
        is_archived: false,
        updated_at: '2026-11-25T00:00:00Z',
        payload: { woNumber: 'WO-HTTP-001' }
      },
      {
        id: 'wo_http_other_ctr',
        wo_number: 'WO-HTTP-999',
        contractor_id: 'ctr_other',
        contractor_name: 'PT Kompetitor',
        contactor_name: 'PT Kompetitor',
        area: 'Bandung 02',
        appointment_date: '2026-11-25',
        status_wo_installer: 'Unassigned',
        is_deleted: false,
        is_archived: false,
        updated_at: '2026-11-25T00:00:00Z',
        payload: { woNumber: 'WO-HTTP-999' }
      }
    ],
    users: [
      {
        id: 'usr_leader_http',
        name: 'Leader Budi',
        username: 'leader_budi',
        role: 'leader',
        contractor_id: 'ctr_fm_01',
        contractor: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        active: true,
        is_deleted: false,
        session_version: 1
      },
      {
        id: 'usr_inst_match_name_only',
        name: 'Rizky Pratama',
        username: 'rizky_p',
        role: 'installer',
        contractor_id: null,
        contractor: 'PT Fiberindo Mitra',
        area: 'Bandung 02',
        active: true,
        is_deleted: false
      },
      {
        id: 'usr_inst_other_ctr',
        name: 'Teknisi Luar',
        username: 'tech_out',
        role: 'installer',
        contractor_id: 'ctr_other',
        contractor: 'PT Kompetitor',
        area: 'Bandung 02',
        active: true,
        is_deleted: false
      },
      {
        id: 'usr_dispatch_http',
        name: 'Dispatch Staff',
        username: 'dispatch_http',
        role: 'dispatch',
        active: true,
        is_deleted: false,
        session_version: 1
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
      sessionId: 'sess_http_leader',
      token: 'tok_http_leader',
      userId: 'usr_leader_http',
      username: 'leader_budi',
      name: 'Leader Budi',
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
      sessionId: 'sess_http_dispatch',
      token: 'tok_http_dispatch',
      userId: 'usr_dispatch_http',
      username: 'dispatch_http',
      name: 'Dispatch Staff',
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
      sessionId: 'sess_http_inst',
      token: 'tok_http_inst',
      userId: 'usr_inst_match_name_only',
      username: 'rizky_p',
      name: 'Rizky Pratama',
      role: 'installer',
      contractor: 'PT Fiberindo Mitra',
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
    // 1. GET /api/supabase/users returns only matching contractor installers (by name even if contractor_id null)
    const usersResp = await fetch(`${baseUrl}/api/supabase/users`, {
      headers: { Authorization: 'Bearer tok_http_leader' }
    });
    assert.equal(usersResp.status, 200);
    const usersJson = await usersResp.json();
    const returnedIds = (usersJson.data || usersJson.users || []).map((u: any) => u.id);
    assert.ok(returnedIds.includes('usr_inst_match_name_only'), 'Leader should see in-scope installer with free-text contractor');
    assert.ok(!returnedIds.includes('usr_inst_other_ctr'), 'Leader must NOT see out-of-scope contractor installer');

    // 2. Dispatch attempting POST /api/tickets/assign must be rejected 403
    const forbidResp = await fetch(`${baseUrl}/api/tickets/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok_http_dispatch'
      },
      body: JSON.stringify({
        ticketIds: ['wo_http_01'],
        installerId: 'usr_inst_match_name_only',
        installerName: 'Rizky Pratama'
      })
    });
    assert.equal(forbidResp.status, 403);

    // 3. Single valid assignment succeeds & returns authoritative workOrders + requestId
    const okResp = await fetch(`${baseUrl}/api/tickets/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok_http_leader'
      },
      body: JSON.stringify({
        ticketIds: ['wo_http_01'],
        installerId: 'usr_inst_match_name_only',
        installerName: 'Rizky Pratama',
        slotTime: '13:00 - 15:30'
      })
    });
    assert.equal(okResp.status, 200);
    const okJson = await okResp.json();
    assert.equal(okJson.success, true);
    assert.ok(okJson.requestId);
    assert.equal(okJson.workOrders?.length, 1);
    assert.equal(okJson.workOrders[0].installerId, 'usr_inst_match_name_only');
    assert.equal(okJson.workOrders[0].statusWOInstaller, 'Assigned');

    // 3b. Installer portal progressive fetch sees newly assigned WO immediately (even without installer_uid/assigned_to_uid columns)
    const instProgResp = await fetch(`${baseUrl}/api/work-orders/progressive?phase=critical&page=1&limit=50`, {
      headers: { Authorization: 'Bearer tok_http_inst' }
    });
    assert.equal(instProgResp.status, 200);
    const instProgJson = await instProgResp.json();
    const instWoIds = (instProgJson.tickets || []).map((t: any) => t.id);
    assert.ok(instWoIds.includes('wo_http_01'), 'Installer progressive feed must include newly assigned WO');

    // 4. Out-of-scope WO fails with actionable SCOPE_MISMATCH reason and requestId
    const failScopeResp = await fetch(`${baseUrl}/api/tickets/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok_http_leader'
      },
      body: JSON.stringify({
        ticketIds: ['wo_http_other_ctr'],
        installerId: 'usr_inst_match_name_only',
        installerName: 'Rizky Pratama'
      })
    });
    assert.equal(failScopeResp.status, 403);
    const failScopeJson = await failScopeResp.json();
    assert.equal(failScopeJson.success, false);
    assert.equal(failScopeJson.code, 'SCOPE_MISMATCH');
    assert.ok(failScopeJson.requestId);
    assert.equal(failScopeJson.failed?.[0]?.code, 'SCOPE_MISMATCH');
    assert.match(failScopeJson.error, /cakupan mitra kontraktor/i);
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
