import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startPermanentDeleteOperation,
  stepPermanentDeleteOperation,
  loadPermanentDeleteOperation,
  getActiveOrRecentPermanentDeleteOperations,
  executePermanentDeleteBatch,
  auditRecentPermanentDeletes,
  type LocalStoreBridge,
  type DeletionTargetInput
} from './centralizedDeletionService.ts';
import {
  executeCentralizedPermanentDeleteBatch,
  resumeOrExecutePermanentDeleteOperation,
  saveActivePermanentDeleteOpId,
  loadSavedPermanentDeleteOpId,
  clearSavedPermanentDeleteOpId
} from '../src/services/deletionManagementService.ts';

function createTempBridge(seed?: Partial<any>): {
  bridge: LocalStoreBridge;
  audits: any[];
  broadcasts: any[];
} {
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
    contractors: [{ id: 'c1', name: 'PT Alpha Fiber' }],
    coverageAreas: [{ id: 'a1', name: 'Jakarta Selatan' }],
    templates: [],
    deletionLogs: [],
    deletionOperations: [],
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

function makeCleanWos(count: number, prefix = 'WO-SIM'): any[] {
  return Array.from({ length: count }, (_, i) => {
    const num = String(i + 1).padStart(3, '0');
    return {
      id: `id-${prefix}-${num}`,
      woNumber: `${prefix}-${num}`,
      idCustomer: String(1000000 + i),
      customerName: `Pelanggan Uji ${num}`,
      appointmentDate: '2026-11-26',
      contactorName: 'PT Alpha Fiber',
      area: 'Jakarta Selatan',
      isDeleted: true,
      updatedAt: '2026-11-26T08:00:00Z'
    };
  });
}

const SUPERADMIN = { id: 'sa-1', name: 'Super Admin', role: 'super_admin' };

/**
 * Installs a temporary in-memory window.sessionStorage & global fetch router
 * backed by the real server/centralizedDeletionService functions for isolated E2E simulation.
 */
function withSimulatedApiEnv<T>(
  bridge: LocalStoreBridge,
  options: {
    onStep?: (callNum: number, body: any) => Promise<Response | null>;
    onStatus?: (callNum: number, opId: string) => Promise<Response | null>;
  },
  fn: () => Promise<T>
): Promise<T> {
  const origWindow = (globalThis as any).window;
  const origLocalStorage = (globalThis as any).localStorage;
  const origFetch = globalThis.fetch;
  const storageMap = new Map<string, string>();
  const localMap = new Map<string, string>();
  let stepCallCount = 0;
  let statusCallCount = 0;

  (globalThis as any).localStorage = {
    getItem: (k: string) => (localMap.has(k) ? localMap.get(k)! : null),
    setItem: (k: string, v: string) => {
      localMap.set(k, String(v));
    },
    removeItem: (k: string) => {
      localMap.delete(k);
    }
  };

  (globalThis as any).window = {
    sessionStorage: {
      getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
      setItem: (k: string, v: string) => {
        storageMap.set(k, String(v));
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      }
    }
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.endsWith('/api/deletion/permanent-delete-batch/start') && method === 'POST') {
      const res = await startPermanentDeleteOperation(
        bridge,
        SUPERADMIN,
        body.targets || [],
        body.confirmText || '',
        body.reason || '',
        { operationId: body.operationId, chunkSize: body.chunkSize }
      );
      return new Response(JSON.stringify(res), {
        status: res.success ? 200 : 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.endsWith('/api/deletion/permanent-delete-batch/step') && method === 'POST') {
      stepCallCount++;
      if (options.onStep) {
        const override = await options.onStep(stepCallCount, body);
        if (override) return override;
      }
      const res = await stepPermanentDeleteOperation(bridge, SUPERADMIN, body.operationId, body.chunkSize);
      return new Response(JSON.stringify(res), {
        status: res.success ? 200 : 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.includes('/api/deletion/operations/') && !url.endsWith('/active') && method === 'GET') {
      statusCallCount++;
      const opId = decodeURIComponent(url.split('/api/deletion/operations/')[1].split('?')[0]);
      if (options.onStatus) {
        const override = await options.onStatus(statusCallCount, opId);
        if (override) return override;
      }
      const op = await loadPermanentDeleteOperation(bridge, opId);
      if (!op) {
        return new Response(JSON.stringify({ success: false, code: 'OPERATION_NOT_FOUND', error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ success: true, operation: op }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Unexpected fetch URL in simulation: ${method} ${url}`);
  }) as typeof fetch;

  return fn().finally(() => {
    globalThis.fetch = origFetch;
    if (origWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
    if (origLocalStorage === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = origLocalStorage;
    }
  });
}

test('Scenario 1: Hapus permanen 1 WO bersih', async () => {
  const wos = makeCleanWos(2, 'WO-ONE');
  const { bridge, audits } = createTempBridge({ tickets: wos });

  const res = await executePermanentDeleteBatch(
    bridge,
    SUPERADMIN,
    [{ category: 'work_orders', recordId: wos[0].id, woNumber: wos[0].woNumber }],
    wos[0].woNumber,
    'Uji hapus permanen 1 WO bersih'
  );

  assert.equal(res.success, true);
  assert.equal(res.succeeded.length, 1);
  assert.equal(res.failed.length, 0);
  assert.equal(res.operation?.status, 'completed');
  assert.equal(res.operation?.succeededCount, 1);
  assert.equal(bridge.db.tickets.length, 1);
  assert.equal(bridge.db.tickets[0].id, wos[1].id);
  assert.equal(bridge.db.deletionLogs.filter((l: any) => l.status === 'success').length, 1);
  assert.equal(audits.filter(a => a.action === 'Permanent Delete Batch Summary').length, 1);
});

test('Scenario 2: Hapus permanen beberapa WO (7 WO across 2 chunks)', async () => {
  const wos = makeCleanWos(9, 'WO-MULTI');
  const selected = wos.slice(0, 7);
  const { bridge } = createTempBridge({ tickets: wos });

  const targets: DeletionTargetInput[] = selected.map(w => ({
    category: 'work_orders',
    recordId: w.id,
    woNumber: w.woNumber
  }));

  const res = await executePermanentDeleteBatch(
    bridge,
    SUPERADMIN,
    targets,
    'HAPUS PERMANEN 7 DATA',
    'Uji hapus permanen 7 WO bertahap',
    { chunkSize: 5 }
  );

  assert.equal(res.success, true);
  assert.equal(res.operation?.totalCount, 7);
  assert.equal(res.operation?.processedCount, 7);
  assert.equal(res.operation?.succeededCount, 7);
  assert.equal(bridge.db.tickets.length, 2);
});

test('Scenario 3: Hapus permanen 23 WO sekaligus tanpa timeout (chunk 5+5+5+5+3)', async () => {
  const wos23 = makeCleanWos(23, 'WO-23B');
  const untouched = makeCleanWos(5, 'WO-SAFE');
  const { bridge, audits } = createTempBridge({ tickets: [...wos23, ...untouched] });

  const targets = wos23.map(w => ({
    category: 'work_orders' as const,
    recordId: w.id,
    woNumber: w.woNumber
  }));

  const progressUpdates: number[] = [];
  let result: any;

  await withSimulatedApiEnv(bridge, {}, async () => {
    result = await executeCentralizedPermanentDeleteBatch({
      targets,
      confirmText: 'HAPUS PERMANEN 23 DATA',
      reason: 'Simulasi hapus permanen 23 WO bertahap',
      onProgress: op => {
        progressUpdates.push(op.processedCount);
      }
    });
  });

  assert.equal(result.success, true);
  assert.equal(result.operation.status, 'completed');
  assert.equal(result.operation.totalCount, 23);
  assert.equal(result.operation.processedCount, 23);
  assert.equal(result.operation.succeededCount, 23);
  assert.equal(result.operation.alreadyDeletedCount, 0);
  assert.equal(result.operation.blockedCount, 0);
  assert.equal(result.operation.failedCount, 0);
  assert.ok(progressUpdates.includes(5));
  assert.ok(progressUpdates.includes(10));
  assert.ok(progressUpdates.includes(15));
  assert.ok(progressUpdates.includes(20));
  assert.ok(progressUpdates.includes(23));
  assert.equal(bridge.db.tickets.length, 5);
  assert.equal(bridge.db.deletionLogs.filter((l: any) => l.status === 'success').length, 23);
  assert.equal(audits.filter(a => a.action === 'Permanent Delete Batch Summary').length, 1);
});

test('Scenario 4: Hapus permanen WO dengan relasi FK (Zero-Cascade blocks FK WO while deleting clean WOs)', async () => {
  const wos = makeCleanWos(4, 'WO-FK');
  const blockedWo = wos[1];
  const { bridge } = createTempBridge({
    tickets: wos,
    assignmentHistory: [{ id: 'ah-1', ticketId: blockedWo.id, woNumber: blockedWo.woNumber }],
    ticketMessages: [{ id: 'tm-1', ticketId: blockedWo.id, woNumber: blockedWo.woNumber, message: 'Ada histori chat' }]
  });

  const targets = wos.slice(0, 3).map(w => ({
    category: 'work_orders' as const,
    recordId: w.id,
    woNumber: w.woNumber
  }));

  const res = await executePermanentDeleteBatch(
    bridge,
    SUPERADMIN,
    targets,
    'HAPUS PERMANEN 3 DATA',
    'Uji proteksi FK Zero-Cascade'
  );

  assert.equal(res.success, false);
  assert.equal(res.operation?.status, 'partial');
  assert.equal(res.operation?.succeededCount, 2);
  assert.equal(res.operation?.blockedCount, 1);
  const blockedItem = res.operation?.results.find(r => r.recordId === blockedWo.id);
  assert.equal(blockedItem?.status, 'blocked_fk');
  assert.equal(blockedItem?.code, 'HAS_BLOCKING_RELATIONS');
  // Blocked WO & its relations MUST still exist; wos[3] untouched
  assert.equal(bridge.db.tickets.length, 2);
  assert.ok(bridge.db.tickets.some((t: any) => t.id === blockedWo.id));
  assert.equal(bridge.db.assignmentHistory.length, 1);
  assert.equal(bridge.db.ticketMessages.length, 1);
});

test('Scenario 5: Simulasi koneksi terputus di tengah proses lalu lanjutkan tanpa duplikasi', async () => {
  const wos = makeCleanWos(12, 'WO-DROP');
  const { bridge, audits } = createTempBridge({ tickets: wos });
  const targets = wos.map(w => ({
    category: 'work_orders' as const,
    recordId: w.id,
    woNumber: w.woNumber
  }));

  await withSimulatedApiEnv(
    bridge,
    {
      onStep: async callNum => {
        // Chunk 1 (5) succeeds, Chunk 2 fails with fatal non-retryable network error on status recovery
        if (callNum === 2) {
          throw new TypeError('Failed to fetch');
        }
        return null;
      },
      onStatus: async callNum => {
        // Simulate offline during reconciliation backoff on first attempt of test
        if (callNum <= 4) {
          throw new TypeError('Failed to fetch');
        }
        return null;
      }
    },
    async () => {
      const firstRun = await executeCentralizedPermanentDeleteBatch({
        targets,
        confirmText: 'HAPUS PERMANEN 12 DATA',
        reason: 'Simulasi koneksi terputus di chunk ke-2',
        operationId: 'op_sim_drop_1'
      });

      assert.equal(firstRun.needsResume, true);
      assert.equal(firstRun.operation?.succeededCount, 5);
      assert.equal(bridge.db.tickets.length, 7);

      // Reconnect succeeds -> resume remaining 7 WOs
      const resumed = await resumeOrExecutePermanentDeleteOperation({
        operationId: 'op_sim_drop_1',
        chunkSize: 5
      });

      assert.equal(resumed.completed, true);
      assert.equal(resumed.operation?.status, 'completed');
      assert.equal(resumed.operation?.succeededCount, 12);
      assert.equal(resumed.operation?.alreadyDeletedCount, 0);
      assert.equal(bridge.db.tickets.length, 0);
      assert.equal(bridge.db.deletionLogs.filter((l: any) => l.status === 'success').length, 12);
      assert.equal(audits.filter(a => a.action === 'Permanent Delete Batch Summary').length, 1);
    }
  );
});

test('Scenario 6: Simulasi timeout di frontend sementara backend menyelesaikan proses', async () => {
  const wos = makeCleanWos(5, 'WO-TIMEO');
  const { bridge, audits } = createTempBridge({ tickets: wos });
  const targets = wos.map(w => ({
    category: 'work_orders' as const,
    recordId: w.id,
    woNumber: w.woNumber
  }));

  await withSimulatedApiEnv(
    bridge,
    {
      onStep: async (callNum, body) => {
        if (callNum === 1) {
          // Backend actually completes the step, but client socket aborts with timeout!
          await stepPermanentDeleteOperation(bridge, SUPERADMIN, body.operationId, body.chunkSize);
          const abortErr = new Error('The user aborted a request.');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        return null;
      }
    },
    async () => {
      const res = await executeCentralizedPermanentDeleteBatch({
        targets,
        confirmText: 'HAPUS PERMANEN 5 DATA',
        reason: 'Simulasi timeout frontend saat backend selesai',
        operationId: 'op_sim_fe_timeout'
      });

      assert.equal(res.success, true);
      assert.equal(res.recoveredFromTimeout, true);
      assert.equal(res.operation?.status, 'completed');
      assert.equal(res.operation?.succeededCount, 5);
      assert.equal(bridge.db.tickets.length, 0);
      assert.equal(bridge.db.deletionLogs.filter((l: any) => l.status === 'success').length, 5);
      assert.equal(audits.filter(a => a.action === 'Permanent Delete Batch Summary').length, 1);
    }
  );
});

test('Scenario 7: Klik ganda / repeated submission idempoten tanpa eksekusi ganda', async () => {
  const wos = makeCleanWos(6, 'WO-DBL');
  const { bridge, audits } = createTempBridge({ tickets: wos });
  const targets = wos.map(w => ({
    category: 'work_orders' as const,
    recordId: w.id,
    woNumber: w.woNumber
  }));

  // 7a. Same operationId started twice
  const s1 = await startPermanentDeleteOperation(
    bridge,
    SUPERADMIN,
    targets,
    'HAPUS PERMANEN 6 DATA',
    'Simulasi klik ganda idempoten',
    { operationId: 'op_sim_dbl_1', chunkSize: 5 }
  );
  assert.equal(s1.success, true);

  const s2 = await startPermanentDeleteOperation(
    bridge,
    SUPERADMIN,
    targets,
    'HAPUS PERMANEN 6 DATA',
    'Simulasi klik ganda idempoten',
    { operationId: 'op_sim_dbl_1', chunkSize: 5 }
  );
  assert.equal(s2.success, true);
  assert.equal(s2.alreadyInProgress, true);
  assert.equal(s2.operation?.operationId, 'op_sim_dbl_1');

  // 7b. Different operationId but identical active fingerprint while in-flight
  const s3 = await startPermanentDeleteOperation(
    bridge,
    SUPERADMIN,
    targets,
    'HAPUS PERMANEN 6 DATA',
    'Simulasi klik ganda idempoten',
    { operationId: 'op_sim_dbl_other', chunkSize: 5 }
  );
  assert.equal(s3.success, true);
  assert.equal(s3.alreadyInProgress, true);
  assert.equal(s3.operation?.operationId, 'op_sim_dbl_1');

  // Complete operation
  await stepPermanentDeleteOperation(bridge, SUPERADMIN, 'op_sim_dbl_1', 5);
  await stepPermanentDeleteOperation(bridge, SUPERADMIN, 'op_sim_dbl_1', 5);

  // 7c. Replaying completed operationId returns alreadyCompleted without re-deleting or duplicating audit
  const s4 = await startPermanentDeleteOperation(
    bridge,
    SUPERADMIN,
    targets,
    'HAPUS PERMANEN 6 DATA',
    'Simulasi klik ganda idempoten',
    { operationId: 'op_sim_dbl_1' }
  );
  assert.equal(s4.alreadyCompleted, true);
  assert.equal(bridge.db.deletionLogs.filter((l: any) => l.status === 'success').length, 6);
  assert.equal(audits.filter(a => a.action === 'Permanent Delete Batch Summary').length, 1);

  // 7d. Starting a new operation for already-deleted WOs marks them already_deleted without re-deleting/audit spam
  const s5 = await executePermanentDeleteBatch(
    bridge,
    SUPERADMIN,
    targets,
    'HAPUS PERMANEN 6 DATA',
    'Uji ulang target yang sudah terhapus'
  );
  assert.equal(s5.operation?.alreadyDeletedCount, 6);
  assert.equal(s5.operation?.succeededCount, 0);
  assert.equal(bridge.db.deletionLogs.filter((l: any) => l.status === 'success').length, 6);
});

test('Scenario 8: Simulasi refresh halaman di tengah operasi (sessionStorage + active operations resume)', async () => {
  const wos = makeCleanWos(11, 'WO-REF');
  const { bridge } = createTempBridge({ tickets: wos });
  const targets = wos.map(w => ({
    category: 'work_orders' as const,
    recordId: w.id,
    woNumber: w.woNumber
  }));

  await withSimulatedApiEnv(bridge, {}, async () => {
    const started = await startPermanentDeleteOperation(
      bridge,
      SUPERADMIN,
      targets,
      'HAPUS PERMANEN 11 DATA',
      'Simulasi refresh di tengah proses',
      { operationId: 'op_sim_refresh_1', chunkSize: 5 }
    );
    assert.equal(started.success, true);

    // Execute chunk 1 (5 items), save opId to sessionStorage, then simulate reload
    saveActivePermanentDeleteOpId('op_sim_refresh_1');
    await stepPermanentDeleteOperation(bridge, SUPERADMIN, 'op_sim_refresh_1', 5);

    const activeOps = await getActiveOrRecentPermanentDeleteOperations(bridge, SUPERADMIN);
    assert.ok(activeOps.some(o => o.operationId === 'op_sim_refresh_1' && o.processedCount === 5));

    // After reload: UI reads sessionStorage opId and resumes remaining 6 items
    const recoveredId = loadSavedPermanentDeleteOpId();
    assert.equal(recoveredId, 'op_sim_refresh_1');

    const resumed = await resumeOrExecutePermanentDeleteOperation({
      operationId: recoveredId!,
      chunkSize: 5
    });
    assert.equal(resumed.completed, true);
    assert.equal(resumed.operation?.succeededCount, 11);
    assert.equal(bridge.db.tickets.length, 0);
    clearSavedPermanentDeleteOpId();
    assert.equal(loadSavedPermanentDeleteOpId(), null);
  });
});

test('Scenario 9 & 10: Verifikasi data yang tidak dipilih tetap utuh & log audit/deletion akurat + read-only audit helper', async () => {
  const selected = makeCleanWos(3, 'WO-SEL');
  const untouched = makeCleanWos(4, 'WO-KEEP');
  const { bridge, audits } = createTempBridge({
    tickets: [...selected, ...untouched],
    assignmentHistory: [{ id: 'ah-keep', ticketId: untouched[0].id, woNumber: untouched[0].woNumber }],
    ticketMessages: [{ id: 'tm-keep', ticketId: untouched[1].id, woNumber: untouched[1].woNumber, message: 'Tetap ada' }]
  });

  const targets = selected.map(w => ({
    category: 'work_orders' as const,
    recordId: w.id,
    woNumber: w.woNumber
  }));

  const res = await executePermanentDeleteBatch(
    bridge,
    SUPERADMIN,
    targets,
    'HAPUS PERMANEN 3 DATA',
    'Verifikasi isolasi data tidak dipilih & log'
  );

  assert.equal(res.success, true);
  // Scenario 9: Unselected WOs & relations 100% untouched
  assert.equal(bridge.db.tickets.length, 4);
  for (const keep of untouched) {
    assert.ok(bridge.db.tickets.some((t: any) => t.id === keep.id && t.woNumber === keep.woNumber));
  }
  assert.equal(bridge.db.assignmentHistory.length, 1);
  assert.equal(bridge.db.ticketMessages.length, 1);

  // Scenario 10: Exact logs & read-only audit helper
  const pdLogs = bridge.db.deletionLogs.filter((l: any) => l.deletionType === 'permanent_delete');
  assert.equal(pdLogs.length, 3);
  assert.equal(audits.filter(a => a.action === 'Permanent Delete Batch Summary').length, 1);

  const auditReport = await auditRecentPermanentDeletes(bridge, 20);
  assert.equal(auditReport.totalLogsChecked, 3);
  for (const s of selected) {
    assert.equal(auditReport.woExistenceMap[s.id]?.exists, false);
  }
  // Ensure read-only audit mutated nothing
  assert.equal(bridge.db.tickets.length, 4);
  assert.equal(bridge.db.deletionLogs.length, 3);
});
