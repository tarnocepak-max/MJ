import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  normalizeInstallerSearchQuery,
  filterInstallersByQuery,
  resolveSelectedInstallerOption,
  formatInstallerCapacityLabel,
  type SearchableInstallerOption
} from '../src/utils/installerSearch.ts';

import {
  resetWorkOrderSchemaCompatCacheForTests,
  assignTicketInSupabase,
  reassignTicketInSupabase,
  getWorkOrdersFromSupabase,
  getWorkOrdersFromSupabasePaginated,
  getScopedActiveWorkOrderHeadsFromSupabase,
  insertWorkOrderToSupabase,
  bulkImportWorkOrdersToSupabase
} from '../server/supabaseAdapter.ts';

import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from '../server/supabaseClient.ts';

import { createExpressApp, SERVER_SESSIONS } from '../server.ts';

// Exact physical columns in public.work_orders from migrations/001_core_morajaws_schema.sql
const WORK_ORDERS_001_COLUMNS = new Set([
  'id',
  'wo_number',
  'work_order_number',
  'id_customer',
  'customer_id',
  'ticket_number',
  'ticket_date',
  'date',
  'appointment_date',
  'date_upload',
  'file_name',
  'agent_id',
  'customer_name',
  'end_user_name',
  'customer_phone',
  'customer_contact1',
  'customer_contact2',
  'customer_contact3',
  'customer_phone_normalized',
  'street_name',
  'street_alternatif',
  'address',
  'city',
  'postal_code',
  'cluster_name',
  'area',
  'appointment_type',
  'slot_time',
  'ticket_category',
  'initial_ticket_category',
  'installation_type',
  'service_type',
  'homepass_type',
  'homepass_detail_id',
  'olt_code',
  'fdt_code',
  'fat_code',
  'fat_port',
  'dropcore_length',
  'plan',
  'service_aging_maintenance',
  'vendor_name',
  'router',
  'ont_brand',
  'ont_model',
  'router_brand',
  'router_model',
  'router_serial_number',
  'stb1_sn',
  'stb1_mac',
  'stb2_sn',
  'stb2_mac',
  'stb3_sn',
  'stb3_mac',
  'ont_serial_number',
  'ont_mac_address',
  'rg_serial_number',
  'rg_mac_address',
  'contractor_id',
  'contractor_name',
  'contactor_name',
  'leader_name',
  'corlap_name',
  'corlap_contact',
  'installer_name',
  'installer_contact',
  'installer_contact2',
  'installer_email',
  'date_assign_agent',
  'date_assign_technician',
  'assigned_at',
  'assigned_by',
  'reassigned_at',
  'reassigned_by',
  'reassignment_reason',
  'distribution_status',
  'distribution_notes',
  'status_wo_agent',
  'status_wo_installer',
  'status_whatsapp',
  'remarks_wo_installer',
  'remarks_agent',
  'remarks',
  'wa_message_preview',
  'wa_generated_url',
  'wa_last_opened_at',
  'wa_confirmed_at',
  'wa_confirmed_by',
  'wa_confirmation_notes',
  'chat_messages_count',
  'last_message_at',
  'last_message_snippet',
  'check_in_at',
  'work_session_status',
  'work_sessions',
  'closed_at',
  'closed_by',
  'close_notes',
  'reopen_reason',
  'technical_report',
  'is_archived',
  'archived_at',
  'archived_by',
  'is_deleted',
  'deleted_at',
  'deleted_by',
  'deletion_reason',
  'unmapped_headers',
  'additional_fields',
  'imported_at',
  'import_date',
  'import_batch_id',
  'payload',
  'created_at',
  'updated_at',
  'updated_by'
]);

const ASSIGNMENT_HISTORY_001_COLUMNS = new Set([
  'id',
  'work_order_id',
  'wo_number',
  'contractor_id',
  'contractor_name',
  'leader_id',
  'leader_name',
  'previous_installer_name',
  'previous_installer',
  'installer_name',
  'assigned_installer',
  'installer_contact',
  'slot_time',
  'appointment_date',
  'source_action',
  'previous_status',
  'new_status',
  'reason',
  'notes',
  'performed_by_id',
  'performed_by',
  'performed_by_role',
  'payload',
  'created_at'
]);

function pgrst204(col: string, table = 'work_orders') {
  return {
    code: 'PGRST204',
    message: `Could not find the '${col}' column of '${table}' in the schema cache`
  };
}

function createStrict001SupabaseMock(seed: { workOrders: any[]; users: any[] }) {
  const workOrders = seed.workOrders.map(w => ({ ...w, payload: { ...(w.payload || {}) } }));
  const users = seed.users.map(u => ({ ...u, payload: { ...(u.payload || {}) } }));
  const historyRows: any[] = [];
  const auditRows: any[] = [];
  let pgrst204Count = 0;

  const findInvalidWorkOrderColumn = (obj: Record<string, any>): string | null => {
    // Intentionally report non-001 columns in a deterministic order (putting assigned_to before installer_id
    // to reproduce the exact multi-column masking bug!)
    const priorityOrder = ['assigned_to', 'installer_id', 'installer_uid', 'assigned_to_uid', 'chat_category'];
    for (const key of priorityOrder) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && !WORK_ORDERS_001_COLUMNS.has(key)) {
        return key;
      }
    }
    for (const key of Object.keys(obj)) {
      if (!WORK_ORDERS_001_COLUMNS.has(key)) {
        return key;
      }
    }
    return null;
  };

  const validateSelectCols = (colsStr: string): string | null => {
    if (!colsStr || colsStr.trim() === '*') return null;
    const cols = colsStr
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    for (const col of cols) {
      const bare = col.split('->>')[0].split('->')[0].trim();
      if (!WORK_ORDERS_001_COLUMNS.has(bare)) {
        return bare;
      }
    }
    return null;
  };

  const getFieldValue = (row: Record<string, any>, fieldExpr: string): any => {
    const jsonMatch = fieldExpr.match(/^payload->>([a-zA-Z0-9_]+)$/);
    if (jsonMatch) {
      return row.payload?.[jsonMatch[1]];
    }
    return row[fieldExpr];
  };

  const validateFilterField = (fieldExpr: string): string | null => {
    const bare = fieldExpr.split('->>')[0].split('->')[0].trim();
    if (!WORK_ORDERS_001_COLUMNS.has(bare)) {
      return bare;
    }
    return null;
  };

  const evalOrExpr = (row: Record<string, any>, expr: string): { ok: boolean; invalidCol?: string } => {
    const parts = expr.split(',').map(s => s.trim()).filter(Boolean);
    let matched = false;
    for (const p of parts) {
      const eqMatch = p.match(/^([a-zA-Z0-9_>-]+)\.eq\.(.+)$/);
      if (eqMatch) {
        const inv = validateFilterField(eqMatch[1]);
        if (inv) return { ok: false, invalidCol: inv };
        const expected = eqMatch[2].replace(/^"|"$/g, '');
        if (String(getFieldValue(row, eqMatch[1]) ?? '') === expected) {
          matched = true;
        }
        continue;
      }
      const ilikeMatch = p.match(/^([a-zA-Z0-9_>-]+)\.ilike\.(.+)$/);
      if (ilikeMatch) {
        const inv = validateFilterField(ilikeMatch[1]);
        if (inv) return { ok: false, invalidCol: inv };
        const rawPat = ilikeMatch[2].replace(/^"|"$/g, '');
        const hasWildcard = rawPat.includes('%');
        const needle = rawPat.replace(/%/g, '').trim().toLowerCase();
        const actual = String(getFieldValue(row, ilikeMatch[1]) ?? '').trim().toLowerCase();
        if (hasWildcard ? actual.includes(needle) : actual === needle) {
          matched = true;
        }
      }
    }
    return { ok: matched };
  };

  const buildSelectChain = (rows: any[], tableName: string, cols = '*', opts?: { count?: string }) => {
    const eqs: Array<[string, any]> = [];
    const neqs: Array<[string, any]> = [];
    const ilikes: Array<[string, string]> = [];
    const ins: Array<[string, any[]]> = [];
    const ors: string[] = [];
    let rangeBounds: [number, number] | null = null;
    let limitNum: number | null = null;

    const execute = async () => {
      if (tableName === 'work_orders') {
        const badSelectCol = validateSelectCols(cols);
        if (badSelectCol) {
          pgrst204Count++;
          return { data: null, count: null, error: pgrst204(badSelectCol, 'work_orders') };
        }
        for (const [col] of [...eqs, ...neqs, ...ilikes, ...ins]) {
          const inv = validateFilterField(col);
          if (inv) {
            pgrst204Count++;
            return { data: null, count: null, error: pgrst204(inv, 'work_orders') };
          }
        }
        for (const expr of ors) {
          const check = evalOrExpr({}, expr);
          if (check.invalidCol) {
            pgrst204Count++;
            return { data: null, count: null, error: pgrst204(check.invalidCol, 'work_orders') };
          }
        }
      }

      const filtered = rows.filter(row => {
        for (const [col, val] of eqs) {
          if (getFieldValue(row, col) !== val) return false;
        }
        for (const [col, val] of neqs) {
          if (getFieldValue(row, col) === val) return false;
        }
        for (const [col, vals] of ins) {
          if (!vals.includes(getFieldValue(row, col))) return false;
        }
        for (const [col, pattern] of ilikes) {
          const rawPat = String(pattern);
          const hasWildcard = rawPat.includes('%');
          const needle = rawPat.replace(/%/g, '').trim().toLowerCase();
          const actual = String(getFieldValue(row, col) ?? '').trim().toLowerCase();
          if (hasWildcard ? !actual.includes(needle) : actual !== needle) return false;
        }
        for (const expr of ors) {
          if (!evalOrExpr(row, expr).ok) return false;
        }
        return true;
      });

      let sliced = filtered;
      if (rangeBounds) {
        sliced = sliced.slice(rangeBounds[0], rangeBounds[1] + 1);
      } else if (limitNum !== null) {
        sliced = sliced.slice(0, limitNum);
      }

      return {
        data: sliced.map(r => ({ ...r, payload: r.payload ? { ...r.payload } : {} })),
        count: opts?.count === 'exact' ? filtered.length : null,
        error: null
      };
    };

    const chain: any = {
      eq: (col: string, val: any) => {
        eqs.push([col, val]);
        return chain;
      },
      neq: (col: string, val: any) => {
        neqs.push([col, val]);
        return chain;
      },
      in: (col: string, vals: any[]) => {
        ins.push([col, vals]);
        return chain;
      },
      ilike: (col: string, pattern: string) => {
        ilikes.push([col, pattern]);
        return chain;
      },
      gte: () => chain,
      gt: () => chain,
      or: (expr: string) => {
        ors.push(expr);
        return chain;
      },
      order: () => chain,
      range: (from: number, to: number) => {
        rangeBounds = [from, to];
        return chain;
      },
      limit: (n: number) => {
        limitNum = n;
        return chain;
      },
      maybeSingle: async () => {
        const res = await execute();
        if (res.error) return { data: null, error: res.error };
        return { data: res.data?.[0] || null, error: null };
      },
      single: async () => {
        const res = await execute();
        if (res.error) return { data: null, error: res.error };
        return { data: res.data?.[0] || null, error: null };
      },
      then: (resolve: any, reject: any) => execute().then(resolve, reject)
    };
    return chain;
  };

  const client: any = {
    getWorkOrders: () => workOrders,
    getHistory: () => historyRows,
    getPgrst204Count: () => pgrst204Count,
    from: (table: string) => {
      if (table === 'work_orders') {
        return {
          select: (cols = '*', opts?: { count?: string }) => buildSelectChain(workOrders, 'work_orders', cols, opts),
          insert: (rowsInput: any[]) => {
            const rowsToInsert = Array.isArray(rowsInput) ? rowsInput : [rowsInput];
            const execInsert = async () => {
              for (const r of rowsToInsert) {
                const invalidCol = findInvalidWorkOrderColumn(r);
                if (invalidCol) {
                  pgrst204Count++;
                  return { data: null, error: pgrst204(invalidCol, 'work_orders') };
                }
              }
              const inserted: any[] = [];
              for (const r of rowsToInsert) {
                const clone = { ...r, payload: { ...(r.payload || {}) } };
                workOrders.push(clone);
                inserted.push({ ...clone });
              }
              return { data: inserted, error: null };
            };
            return {
              select: () => ({
                single: async () => {
                  const res = await execInsert();
                  return { data: res.data?.[0] || null, error: res.error };
                },
                maybeSingle: async () => {
                  const res = await execInsert();
                  return { data: res.data?.[0] || null, error: res.error };
                },
                then: (resolve: any, reject: any) => execInsert().then(resolve, reject)
              }),
              then: (resolve: any, reject: any) => execInsert().then(resolve, reject)
            };
          },
          update: (patch: Record<string, any>) => {
            const eqs: Array<[string, any]> = [];
            const execUpdate = async () => {
              const invalidCol = findInvalidWorkOrderColumn(patch);
              if (invalidCol) {
                pgrst204Count++;
                return { data: null, error: pgrst204(invalidCol, 'work_orders') };
              }
              const updated: any[] = [];
              for (let i = 0; i < workOrders.length; i++) {
                const row = workOrders[i];
                const matches = eqs.every(([col, val]) => row[col] === val);
                if (matches) {
                  workOrders[i] = {
                    ...row,
                    ...patch,
                    payload: { ...(row.payload || {}), ...(patch.payload || {}) }
                  };
                  updated.push({ ...workOrders[i] });
                }
              }
              return { data: updated, error: null };
            };
            const chain: any = {
              eq: (col: string, val: any) => {
                eqs.push([col, val]);
                return chain;
              },
              select: () => ({
                single: async () => {
                  const res = await execUpdate();
                  return { data: res.data?.[0] || null, error: res.error };
                },
                maybeSingle: async () => {
                  const res = await execUpdate();
                  return { data: res.data?.[0] || null, error: res.error };
                },
                then: (resolve: any, reject: any) => execUpdate().then(resolve, reject)
              }),
              then: (resolve: any, reject: any) => execUpdate().then(resolve, reject)
            };
            return chain;
          }
        };
      }

      if (table === 'users') {
        return {
          select: (cols = '*', opts?: { count?: string }) => buildSelectChain(users, 'users', cols, opts)
        };
      }

      if (table === 'assignment_history') {
        return {
          select: (cols = '*', opts?: { count?: string }) => buildSelectChain(historyRows, 'assignment_history', cols, opts),
          insert: (rowsInput: any[]) => {
            const rowsToInsert = Array.isArray(rowsInput) ? rowsInput : [rowsInput];
            const execInsert = async () => {
              for (const r of rowsToInsert) {
                for (const key of Object.keys(r)) {
                  if (!ASSIGNMENT_HISTORY_001_COLUMNS.has(key)) {
                    pgrst204Count++;
                    return { data: null, error: pgrst204(key, 'assignment_history') };
                  }
                }
              }
              const inserted: any[] = [];
              for (const r of rowsToInsert) {
                const clone = { ...r, payload: { ...(r.payload || {}) } };
                historyRows.push(clone);
                inserted.push(clone);
              }
              return { data: inserted, error: null };
            };
            return {
              select: () => ({
                maybeSingle: async () => {
                  const res = await execInsert();
                  return { data: res.data?.[0] || null, error: res.error };
                },
                then: (resolve: any, reject: any) => execInsert().then(resolve, reject)
              }),
              then: (resolve: any, reject: any) => execInsert().then(resolve, reject)
            };
          }
        };
      }

      if (table === 'audit_logs') {
        return {
          insert: (rowsInput: any[]) => {
            const rowsToInsert = Array.isArray(rowsInput) ? rowsInput : [rowsInput];
            auditRows.push(...rowsToInsert);
            return Promise.resolve({ data: rowsToInsert, error: null });
          }
        };
      }

      return {
        select: () => buildSelectChain([], table),
        insert: () => Promise.resolve({ data: [], error: null })
      };
    }
  };

  return client;
}

// =============================================================================
// PART B: Searchable Installer Selector Pure Logic Tests
// =============================================================================

test('installerSearch: normalizes extra spaces & case and filters by name or username', () => {
  const options: SearchableInstallerOption[] = [
    { id: 'u1', name: 'Rayhan Arfzan', username: 'rayhan.a', assignedCount: 0, maxLimit: 10 },
    { id: 'u2', name: 'Andi Saputra', username: 'installer1', assignedCount: 4, maxLimit: 10 },
    { id: 'u3', name: 'Budi Santoso', username: 'budi_jaksel', assignedCount: 10, maxLimit: 10, isFull: true }
  ];

  assert.equal(normalizeInstallerSearchQuery('   RAYHAN    arfzan  '), 'rayhan arfzan');
  assert.deepEqual(filterInstallersByQuery(options, '  rayHAN   ').map(o => o.id), ['u1']);
  assert.deepEqual(filterInstallersByQuery(options, 'INSTALLER1').map(o => o.id), ['u2']);
  assert.deepEqual(filterInstallersByQuery(options, 'budi_JAKSEL').map(o => o.id), ['u3']);
  assert.deepEqual(filterInstallersByQuery(options, 'tidak_ada_xyz'), []);
  assert.equal(
    formatInstallerCapacityLabel(options[0]),
    'Rayhan Arfzan (0/10)'
  );
  assert.equal(
    formatInstallerCapacityLabel(options[2]),
    'Budi Santoso (10/10) - PENUH'
  );
});

test('installerSearch: preserves selected option when dropdown options refresh or temporarily exclude it', () => {
  const cached: SearchableInstallerOption = {
    id: 'u1',
    name: 'Rayhan Arfzan',
    username: 'rayhan.a',
    assignedCount: 1,
    maxLimit: 10
  };
  const refreshedEmpty: SearchableInstallerOption[] = [];
  const preserved = resolveSelectedInstallerOption(refreshedEmpty, 'Rayhan Arfzan', 'name', cached);
  assert.ok(preserved);
  assert.equal(preserved?.id, 'u1');
  assert.equal(preserved?.username, 'rayhan.a');

  const preservedById = resolveSelectedInstallerOption(refreshedEmpty, 'u1', 'id', cached);
  assert.equal(preservedById?.name, 'Rayhan Arfzan');
});

// =============================================================================
// PART A: Strict 001_core_morajaws_schema.sql Supabase Assign/Reassign Tests
// =============================================================================

test('Supabase strict 001 schema: Assign & Reassign recover from PGRST204 installer_id/assigned_to mismatch and persist via payload', async () => {
  resetWorkOrderSchemaCompatCacheForTests();
  const mock = createStrict001SupabaseMock({
    users: [
      {
        id: 'u-inst-a',
        name: 'Andi Saputra',
        username: 'installer1',
        phone: '081200001111',
        role: 'installer',
        contractor_id: 'ctr-mjs',
        contractor: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        active: true,
        is_deleted: false
      },
      {
        id: 'u-inst-b',
        name: 'Rayhan Arfzan',
        username: 'rayhan_arfzan',
        phone: '081200002222',
        role: 'installer',
        contractor_id: 'ctr-mjs',
        contractor: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        active: true,
        is_deleted: false
      }
    ],
    workOrders: [
      {
        id: 'wo-101',
        wo_number: 'WO20261126001',
        id_customer: '7654321',
        customer_name: 'Ibu Rina',
        appointment_date: '2026-11-26',
        contractor_id: 'ctr-mjs',
        contractor_name: 'PT Mitra Jaringan Solusi',
        contactor_name: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        status_wo_agent: 'Pending',
        status_wo_installer: 'Unassigned',
        is_archived: false,
        is_deleted: false,
        payload: { id: 'wo-101', woNumber: 'WO20261126001', contractor: 'PT Mitra Jaringan Solusi', area: 'Jakarta Selatan' }
      },
      {
        id: 'wo-102',
        wo_number: 'WO20261126002',
        id_customer: '7654322',
        customer_name: 'Pak Budi',
        appointment_date: '2026-11-26',
        contractor_id: 'ctr-mjs',
        contractor_name: 'PT Mitra Jaringan Solusi',
        contactor_name: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        status_wo_agent: 'Pending',
        status_wo_installer: 'Unassigned',
        is_archived: false,
        is_deleted: false,
        payload: { id: 'wo-102', woNumber: 'WO20261126002', contractor: 'PT Mitra Jaringan Solusi', area: 'Jakarta Selatan' }
      }
    ]
  });

  setSupabaseBackendClientForTesting(mock);
  try {
    // 1. First Assign: triggers discovery & strips missing columns without failing
    const assign1 = await assignTicketInSupabase({
      workOrderIdOrWoNumber: 'wo-101',
      installerName: 'Andi Saputra',
      installerId: 'u-inst-a',
      performedBy: 'Hendra Gunawan',
      performedByRole: 'leader',
      performedById: 'u-leader-1',
      userRole: 'leader',
      userContractor: 'PT Mitra Jaringan Solusi',
      userContractorId: 'ctr-mjs',
      userArea: 'Jakarta Selatan'
    });
    assert.equal(assign1.success, true, `assign1 failed: ${assign1.error?.message}`);
    assert.equal(assign1.data?.workOrder?.installerId, 'u-inst-a');
    assert.equal(assign1.data?.workOrder?.installerName, 'Andi Saputra');
    assert.equal(assign1.data?.workOrder?.statusWOInstaller, 'Assigned');

    // Verify stored row never contains physical installer_id column and preserves canonical ID in payload
    const rawRow1 = mock.getWorkOrders().find((r: any) => r.id === 'wo-101');
    assert.equal(Object.prototype.hasOwnProperty.call(rawRow1, 'installer_id'), false);
    assert.equal(rawRow1.installer_name, 'Andi Saputra');
    assert.equal(rawRow1.payload.installerId, 'u-inst-a');

    // 2. Second Assign (using cached missing columns + username resolution + extra whitespace)
    const pgrstBeforeSecond = mock.getPgrst204Count();
    const assign2 = await assignTicketInSupabase({
      workOrderIdOrWoNumber: 'WO20261126002',
      installerName: '  rayhan_arfzan  ',
      performedBy: 'Hendra Gunawan',
      performedByRole: 'leader',
      performedById: 'u-leader-1',
      userRole: 'leader',
      userContractor: 'PT Mitra Jaringan Solusi',
      userContractorId: 'ctr-mjs',
      userArea: 'Jakarta Selatan'
    });
    assert.equal(assign2.success, true, `assign2 failed: ${assign2.error?.message}`);
    assert.equal(assign2.data?.workOrder?.installerId, 'u-inst-b');
    assert.equal(assign2.data?.workOrder?.installerName, 'Rayhan Arfzan');
    assert.equal(
      mock.getPgrst204Count() - pgrstBeforeSecond,
      0,
      'Subsequent assign should have zero PGRST204 errors once cache is warm'
    );

    // 3. Reassign WO20261126001 from Installer A -> Installer B
    const reassign = await reassignTicketInSupabase({
      workOrderIdOrWoNumber: 'wo-101',
      previousInstallerName: 'Andi Saputra',
      newInstallerName: 'Rayhan Arfzan',
      newInstallerId: 'u-inst-b',
      reason: 'Teknisi sebelumnya overload, alihkan ke Rayhan',
      performedBy: 'Hendra Gunawan',
      performedByRole: 'leader',
      performedById: 'u-leader-1',
      userRole: 'leader',
      userContractor: 'PT Mitra Jaringan Solusi',
      userContractorId: 'ctr-mjs',
      userArea: 'Jakarta Selatan'
    });
    assert.equal(reassign.success, true, `reassign failed: ${reassign.error?.message}`);
    assert.equal(reassign.data?.workOrder?.installerId, 'u-inst-b');
    assert.equal(reassign.data?.workOrder?.installerName, 'Rayhan Arfzan');
    assert.equal(reassign.data?.history?.previous_installer_name, 'Andi Saputra');
    assert.equal(reassign.data?.history?.installer_name, 'Rayhan Arfzan');

    // 4. Read back via getWorkOrdersFromSupabase, paginated Installer view (JSONB payload fallback), & scoped heads
    const listAll = await getWorkOrdersFromSupabase({ lightweight: true });
    assert.equal(listAll.success, true, `listAll failed: ${listAll.error?.message}`);
    assert.equal(listAll.data?.length, 2);

    const installerPage = await getWorkOrdersFromSupabasePaginated({
      userRole: 'installer',
      userId: 'u-inst-b',
      page: 1,
      limit: 20,
      lightweight: true
    });
    assert.equal(installerPage.success, true, `installerPage failed: ${installerPage.error?.message}`);
    assert.equal(installerPage.data?.tickets.length, 2);

    const heads = await getScopedActiveWorkOrderHeadsFromSupabase();
    assert.equal(heads.success, true, `heads failed: ${heads.error?.message}`);
    assert.equal(heads.data?.length, 2);

    // 5. Single & bulk import on strict 001 schema also work without PGRST204
    const ins = await insertWorkOrderToSupabase({
      id: 'wo-103',
      woNumber: 'WO20261126003',
      idCustomer: '7654323',
      customerName: 'Ibu Nina',
      contractor: 'PT Mitra Jaringan Solusi',
      area: 'Jakarta Selatan',
      installerId: 'u-inst-a',
      installerName: 'Andi Saputra',
      statusWOInstaller: 'Assigned'
    });
    assert.equal(ins.success, true, `insertWorkOrder failed: ${ins.error?.message}`);

    const bulkIns = await bulkImportWorkOrdersToSupabase([
      {
        id: 'wo-104',
        woNumber: 'WO20261126004',
        idCustomer: '7654324',
        customerName: 'Pak Darto',
        contractor: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan'
      }
    ]);
    assert.equal(bulkIns.success, true, `bulkImport failed: ${bulkIns.error?.message}`);
    assert.equal(bulkIns.data?.imported, 1);
  } finally {
    resetSupabaseBackendClientForTesting();
    resetWorkOrderSchemaCompatCacheForTests();
  }
});

// =============================================================================
// PART C: Bulk Reassign Partial-Failure HTTP Accuracy Test
// =============================================================================

test('POST /api/tickets/bulk-reassign reports HTTP 207 partial failure accurately when 1 WO succeeds and 1 WO fails', async () => {
  resetWorkOrderSchemaCompatCacheForTests();
  const mock = createStrict001SupabaseMock({
    users: [
      {
        id: 'u-leader-1',
        name: 'Hendra Gunawan (Leader MJS)',
        username: 'leadermjs',
        role: 'leader',
        contractor_id: 'ctr-mjs',
        contractor: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        active: true,
        is_deleted: false
      },
      {
        id: 'u-inst-a',
        name: 'Andi Saputra',
        username: 'installer1',
        phone: '081200001111',
        role: 'installer',
        contractor_id: 'ctr-mjs',
        contractor: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        active: true,
        is_deleted: false
      },
      {
        id: 'u-inst-b',
        name: 'Rayhan Arfzan',
        username: 'rayhan.a',
        phone: '081200002222',
        role: 'installer',
        contractor_id: 'ctr-mjs',
        contractor: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        active: true,
        is_deleted: false
      }
    ],
    workOrders: [
      {
        id: 'wo-ok-1',
        wo_number: 'WO20261126010',
        customer_name: 'Pelanggan OK',
        contractor_id: 'ctr-mjs',
        contractor_name: 'PT Mitra Jaringan Solusi',
        contactor_name: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        installer_name: 'Andi Saputra',
        status_wo_installer: 'Assigned',
        is_archived: false,
        is_deleted: false,
        payload: { id: 'wo-ok-1', woNumber: 'WO20261126010', installerId: 'u-inst-a', contractor: 'PT Mitra Jaringan Solusi', area: 'Jakarta Selatan' }
      }
    ]
  });

  setSupabaseBackendClientForTesting(mock);
  const app = await createExpressApp({ skipVite: true, apiOnly: true });
  const token = 'test-leader-session-token';
  const nowIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 60_000).toISOString();
  const sessionObj: any = {
    sessionId: 'sess_bulk_reassign_test',
    token,
    userId: 'u-leader-1',
    username: 'leadermjs',
    name: 'Hendra Gunawan (Leader MJS)',
    role: 'leader',
    contractorId: 'ctr-mjs',
    contractor: 'PT Mitra Jaringan Solusi',
    area: 'Jakarta Selatan',
    sessionVersion: 1,
    loginAt: nowIso,
    lastActivityAt: nowIso,
    expiresAt: futureIso,
    status: 'active',
    ipAddress: '127.0.0.1',
    userAgent: 'TestSuite',
    deviceType: 'desktop'
  };
  (SERVER_SESSIONS as any[]).push(sessionObj);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;

  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/tickets/bulk-reassign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        ticketIds: ['wo-ok-1', 'wo-missing-999'],
        newInstallerName: 'Rayhan Arfzan',
        newInstallerId: 'u-inst-b',
        reason: 'Reassign massal dengan 1 WO gagal'
      })
    });
    const body = await res.json();
    assert.equal(res.status, 207);
    assert.equal(body.success, false);
    assert.equal(body.partialSuccess, true);
    assert.equal(body.count, 1);
    assert.equal(body.failedCount, 1);
    assert.equal(body.reassigned?.[0]?.workOrder?.id, 'wo-ok-1');
    assert.equal(body.failed?.[0]?.id, 'wo-missing-999');
  } finally {
    const idx = (SERVER_SESSIONS as any[]).indexOf(sessionObj);
    if (idx !== -1) (SERVER_SESSIONS as any[]).splice(idx, 1);
    await new Promise<void>(resolve => server.close(() => resolve()));
    resetSupabaseBackendClientForTesting();
    resetWorkOrderSchemaCompatCacheForTests();
  }
});
