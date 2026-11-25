import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listDeletionItems,
  listDeletionHistory,
  getDeletionFacets,
  inspectWoDependenciesBatch,
  executeSoftDeleteBatch,
  executePermanentDelete,
  executePermanentDeleteBatch,
  executeRestoreBatch,
  type LocalStoreBridge
} from './centralizedDeletionService.ts';

function createTempDeletionBridge(seed?: Partial<any>): { bridge: LocalStoreBridge; audits: any[]; broadcasts: any[] } {
  const audits: any[] = [];
  const broadcasts: any[] = [];
  const db: any = {
    tickets: [],
    assignmentHistory: [],
    technicalReports: [],
    ticketMessages: [],
    attachments: [],
    storageMetadata: [],
    importHistory: [],
    importJobs: [],
    importStagingRows: [],
    users: [],
    contractors: [
      { id: 'c1', name: 'PT Alpha Fiber' },
      { id: 'c2', name: 'PT Beta Net' }
    ],
    coverageAreas: [
      { id: 'a1', name: 'Jakarta Selatan' },
      { id: 'a2', name: 'Bandung' }
    ],
    templates: [],
    deletionLogs: [],
    auditLogs: [],
    appSettings: {},
    ...seed
  };

  const bridge: LocalStoreBridge = {
    db,
    saveDatabaseToDisk: () => {},
    logServerAuditAsync: async (action, entity, entityId, details, user, extra) => {
      audits.push({ action, entity, entityId, details, user, extra });
    },
    broadcastSupabaseChange: (table, event, payload) => {
      broadcasts.push({ table, event, payload });
    },
    revokeUserSessions: () => {},
    isSupabaseMode: () => false,
    isLocalJsonModeAllowed: () => true
  };

  return { bridge, audits, broadcasts };
}

const SUPERADMIN = { id: 'sa-1', name: 'Super Admin', role: 'super_admin' };
const DISPATCH = { id: 'dp-1', name: 'Dispatch Ops', role: 'dispatch' };

test('Header text search handles partial match, case-insensitivity, quotes/symbols, and empty/null values', async () => {
  const { bridge } = createTempDeletionBridge({
    tickets: [
      {
        id: 't1',
        woNumber: 'WO-2026/A-001',
        idCustomer: '1234567',
        customerName: 'PT "Bintang" & Co.',
        appointmentDate: '2026-11-25',
        contactorName: 'PT Alpha Fiber',
        area: 'Jakarta Selatan',
        installerName: 'Budi',
        updatedAt: '2026-11-25T10:00:00Z'
      },
      {
        id: 't2',
        woNumber: 'WO-2026-002',
        idCustomer: '7654321',
        customerName: null,
        appointmentDate: '',
        contactorName: 'PT Beta Net',
        area: 'Bandung',
        installerName: '',
        updatedAt: '2026-11-25T09:00:00Z'
      }
    ]
  });

  // Partial case-insensitive search with special slash
  const resWo = await listDeletionItems(bridge, {
    actorRole: 'super_admin',
    category: 'work_orders',
    woNumber: '2026/a',
    deletionStatus: 'active'
  });
  assert.equal(resWo.total, 1);
  assert.equal(resWo.items[0].id, 't1');

  // Quote & ampersand search on Customer Name
  const resQuote = await listDeletionItems(bridge, {
    actorRole: 'super_admin',
    category: 'work_orders',
    customerName: '"bintang" &',
    deletionStatus: 'active'
  });
  assert.equal(resQuote.total, 1);
  assert.equal(resQuote.items[0].id, 't1');

  // Customer ID partial search
  const resCustId = await listDeletionItems(bridge, {
    actorRole: 'super_admin',
    category: 'work_orders',
    customerId: '65432',
    deletionStatus: 'active'
  });
  assert.equal(resCustId.total, 1);
  assert.equal(resCustId.items[0].id, 't2');
});

test('Combined header filters (Contractor, Area, Assignment Status, Date Range) and facets work together accurately', async () => {
  const { bridge } = createTempDeletionBridge({
    tickets: [
      {
        id: 't1',
        woNumber: 'WO-101',
        idCustomer: '1111111',
        customerName: 'Andi',
        appointmentDate: '2026-11-20',
        contactorName: 'PT Alpha Fiber',
        area: 'Jakarta Selatan',
        installerName: 'Teknisi A',
        updatedAt: '2026-11-20T08:00:00Z'
      },
      {
        id: 't2',
        woNumber: 'WO-102',
        idCustomer: '2222222',
        customerName: 'Budi',
        appointmentDate: '2026-11-24',
        contactorName: 'PT Alpha Fiber',
        area: 'Jakarta Selatan',
        installerName: '',
        updatedAt: '2026-11-24T08:00:00Z'
      },
      {
        id: 't3',
        woNumber: 'WO-103',
        idCustomer: '3333333',
        customerName: 'Citra',
        appointmentDate: '2026-11-26',
        contactorName: 'PT Beta Net',
        area: 'Bandung',
        installerName: 'Teknisi B',
        updatedAt: '2026-11-26T08:00:00Z'
      }
    ]
  });

  const facets = await getDeletionFacets(bridge, 'super_admin', 'work_orders');
  assert.ok(facets.contractors.includes('PT Alpha Fiber'));
  assert.ok(facets.areas.includes('Bandung'));

  const combined = await listDeletionItems(bridge, {
    actorRole: 'super_admin',
    category: 'work_orders',
    contractor: 'PT Alpha Fiber',
    area: 'Jakarta Selatan',
    assignmentStatus: 'Unassigned',
    appointmentDateFrom: '2026-11-22',
    appointmentDateTo: '2026-11-28',
    deletionStatus: 'active'
  });
  assert.equal(combined.total, 1);
  assert.equal(combined.items[0].id, 't2');
});

test('Appointment Date sorting sorts across ALL pages BEFORE pagination with NULLS LAST', async () => {
  const { bridge } = createTempDeletionBridge({
    tickets: [
      { id: 'n1', woNumber: 'WO-NULL-1', appointmentDate: '', updatedAt: '2026-11-30T10:00:00Z' },
      { id: 'd3', woNumber: 'WO-25', appointmentDate: '2026-11-25', updatedAt: '2026-11-10T10:00:00Z' },
      { id: 'd1', woNumber: 'WO-10', appointmentDate: '2026-11-10', updatedAt: '2026-11-11T10:00:00Z' },
      { id: 'd4', woNumber: 'WO-28', appointmentDate: '2026-11-28', updatedAt: '2026-11-12T10:00:00Z' },
      { id: 'd2', woNumber: 'WO-15', appointmentDate: '2026-11-15', updatedAt: '2026-11-13T10:00:00Z' },
      { id: 'n2', woNumber: 'WO-NULL-2', appointmentDate: null, updatedAt: '2026-11-29T10:00:00Z' }
    ]
  });

  // Ascending: oldest -> newest, NULLS LAST across pages (pageSize=5 => page 1 has 4 dated + 1 null, page 2 has 1 null)
  const ascPage1 = await listDeletionItems(bridge, {
    actorRole: 'super_admin',
    category: 'work_orders',
    sortBy: 'appointment_date',
    sortDir: 'asc',
    page: 1,
    pageSize: 5,
    deletionStatus: 'active'
  });
  assert.deepEqual(
    ascPage1.items.map(i => i.id),
    ['d1', 'd2', 'd3', 'd4', 'n1']
  );

  const ascPage2 = await listDeletionItems(bridge, {
    actorRole: 'super_admin',
    category: 'work_orders',
    sortBy: 'appointment_date',
    sortDir: 'asc',
    page: 2,
    pageSize: 5,
    deletionStatus: 'active'
  });
  assert.deepEqual(
    ascPage2.items.map(i => i.id),
    ['n2']
  );

  // Descending: newest -> oldest, STILL NULLS LAST!
  const descPage1 = await listDeletionItems(bridge, {
    actorRole: 'super_admin',
    category: 'work_orders',
    sortBy: 'appointment_date',
    sortDir: 'desc',
    page: 1,
    pageSize: 5,
    deletionStatus: 'active'
  });
  assert.deepEqual(
    descPage1.items.map(i => i.id),
    ['d4', 'd3', 'd2', 'd1', 'n1']
  );
});

test('Soft delete preserves related records and supports Superadmin restore + Dispatch restriction', async () => {
  const { bridge } = createTempDeletionBridge({
    tickets: [
      { id: 'wo-1', woNumber: 'WO-SAFE-1', customerName: 'Test 1', isDeleted: false },
      { id: 'wo-2', woNumber: 'WO-SAFE-2', customerName: 'Test 2', isDeleted: false }
    ],
    assignmentHistory: [{ id: 'ah-1', ticketId: 'wo-1', woNumber: 'WO-SAFE-1', installerName: 'Budi' }],
    ticketMessages: [{ id: 'tm-1', ticketId: 'wo-1', woNumber: 'WO-SAFE-1', message: 'Chat msg' }]
  });

  // Dispatch can soft delete work_orders
  const sdRes = await executeSoftDeleteBatch(
    bridge,
    DISPATCH,
    [{ category: 'work_orders', recordId: 'wo-1' }],
    'Duplikasi data uji coba'
  );
  assert.equal(sdRes.success, true);
  assert.equal(bridge.db.tickets.find((t: any) => t.id === 'wo-1').isDeleted, true);
  // Relations MUST remain intact
  assert.equal(bridge.db.assignmentHistory.length, 1);
  assert.equal(bridge.db.ticketMessages.length, 1);

  // Dispatch MUST be blocked from Permanent Delete & Restore
  const pdBlocked = await executePermanentDelete(
    bridge,
    DISPATCH,
    { category: 'work_orders', recordId: 'wo-2' },
    'WO-SAFE-2',
    'Test unauthorized'
  );
  assert.equal(pdBlocked.success, false);
  assert.equal(pdBlocked.code, 'FORBIDDEN_ROLE');

  await assert.rejects(
    () => executeRestoreBatch(bridge, DISPATCH, [{ category: 'work_orders', recordId: 'wo-1' }], 'Restore attempt'),
    /Superadmin/
  );

  // Superadmin restores wo-1 cleanly
  const restoreRes = await executeRestoreBatch(
    bridge,
    SUPERADMIN,
    [{ category: 'work_orders', recordId: 'wo-1' }],
    'Pemulihan terverifikasi'
  );
  assert.equal(restoreRes.success, true);
  assert.equal(bridge.db.tickets.find((t: any) => t.id === 'wo-1').isDeleted, false);
});

test('Permanent delete batch blocks FK dependencies, requires exact phrase, rolls back on commit error, and logs audit history', async () => {
  const { bridge, audits } = createTempDeletionBridge({
    tickets: [
      { id: 'wo-rel', woNumber: 'WO-WITH-REL', customerName: 'Has Relations' },
      { id: 'wo-clean-1', woNumber: 'WO-CLEAN-1', customerName: 'Clean 1' },
      { id: 'wo-clean-2', woNumber: 'WO-CLEAN-2', customerName: 'Clean 2' }
    ],
    assignmentHistory: [{ id: 'ah-rel', ticketId: 'wo-rel', woNumber: 'WO-WITH-REL' }]
  });

  // Batch dependency inspection detects 1 blocked, 2 eligible
  const depsBatch = await inspectWoDependenciesBatch(bridge, ['wo-rel', 'wo-clean-1', 'wo-clean-2']);
  assert.equal(depsBatch.blockedCount, 1);
  assert.equal(depsBatch.eligibleCount, 2);

  // Wrong confirmation text rejected without modifying DB
  const wrongConfirm = await executePermanentDeleteBatch(
    bridge,
    SUPERADMIN,
    [
      { category: 'work_orders', recordId: 'wo-clean-1' },
      { category: 'work_orders', recordId: 'wo-clean-2' }
    ],
    'HAPUS SALAH',
    'Alasan hapus permanen test'
  );
  assert.equal(wrongConfirm.success, false);
  assert.equal(wrongConfirm.code, 'CONFIRMATION_MISMATCH');
  assert.equal(bridge.db.tickets.length, 3);

  // Simulated mid-transaction disk failure rolls back atomic mutation
  bridge.beforeCommitHook = () => {
    throw new Error('SIMULATED_IO_FAILURE');
  };
  const rolledBack = await executePermanentDeleteBatch(
    bridge,
    SUPERADMIN,
    [{ category: 'work_orders', recordId: 'wo-clean-1' }],
    'WO-CLEAN-1',
    'Simulasi kegagalan transaksi'
  );
  assert.equal(rolledBack.success, false);
  assert.equal(rolledBack.code, 'TRANSACTION_ROLLED_BACK');
  assert.equal(bridge.db.tickets.length, 3);
  bridge.beforeCommitHook = undefined;

  // Mixed batch: wo-rel rejected due to FK, wo-clean-1 & wo-clean-2 deleted cleanly
  const mixedRes = await executePermanentDeleteBatch(
    bridge,
    SUPERADMIN,
    [
      { category: 'work_orders', recordId: 'wo-rel' },
      { category: 'work_orders', recordId: 'wo-clean-1' },
      { category: 'work_orders', recordId: 'wo-clean-2' }
    ],
    'HAPUS PERMANEN 3 DATA',
    'Pembersihan data staging terisolasi'
  );
  assert.equal(mixedRes.succeeded.length, 2);
  assert.equal(mixedRes.failed.length, 1);
  assert.equal(mixedRes.failed[0].code, 'HAS_BLOCKING_RELATIONS');
  assert.equal(bridge.db.tickets.length, 1);
  assert.equal(bridge.db.tickets[0].id, 'wo-rel');
  assert.ok(audits.length >= 2);

  // Deletion History returns structured `logs` with column header filters
  const historyRes = await listDeletionHistory(bridge, {
    woOrRecordQuery: 'WO-WITH-REL',
    status: 'rejected'
  });
  assert.equal(historyRes.logs.length, 1);
  assert.equal(historyRes.logs[0].woNumber, 'WO-WITH-REL');
});
