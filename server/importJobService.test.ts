import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInMemoryImportTestStore,
  EnterpriseImportEngine,
  ImportServiceError
} from './importJobService';

function makeSyntheticRows(count: number, prefix = 'WO-UNIT') {
  const rows = [];
  for (let i = 1; i <= count; i++) {
    rows.push({
      rowNumber: i,
      mapped: {
        woNumber: `${prefix}-${String(i).padStart(5, '0')}`,
        idCustomer: String(1000000 + i),
        customerName: `Pelanggan ${i}`,
        customerPhone: `0812345${String(i).padStart(5, '0')}`,
        contractorName: 'PT Fiberindo Mitra',
        area: 'BANDUNG 02',
        appointmentDate: '2026-11-26',
        slotTime: '08:30 - 11:30'
      },
      raw: {
        'WO Number': `${prefix}-${String(i).padStart(5, '0')}`,
        'ID Customer': String(1000000 + i)
      }
    });
  }
  return rows;
}

test('ProductionImportStore fails loudly with DATABASE_UNAVAILABLE (503) and zero silent fallback when Supabase is unconfigured', async () => {
  const engine = new EnterpriseImportEngine(); // Uses ProductionImportStore by default
  await assert.rejects(
    () =>
      engine.createImportJob(
        {
          sourceFile: 'test.xlsx',
          totalRows: 10
        },
        { id: 'usr_sa', name: 'Superadmin', role: 'super_admin' }
      ),
    (err: any) => {
      assert.ok(err instanceof ImportServiceError);
      assert.equal(err.code, 'DATABASE_UNAVAILABLE');
      assert.equal(err.statusCode, 503);
      return true;
    }
  );

  await assert.rejects(
    () => engine.listImportJobs(10),
    (err: any) => {
      assert.ok(err instanceof ImportServiceError);
      assert.equal(err.code, 'DATABASE_UNAVAILABLE');
      assert.equal(err.statusCode, 503);
      return true;
    }
  );
});

test('Distributed batch locking prevents double processing on concurrent processNextBatch calls and recovers expired locks', async () => {
  const store = createInMemoryImportTestStore({
    simulatedBatchDelayMs: 60
  });
  const engine = new EnterpriseImportEngine(store);
  const operator = { id: 'usr_sa', name: 'Superadmin', role: 'super_admin' };

  // 1-batch job (50 rows)
  const job = await engine.createImportJob(
    { sourceFile: 'concurrent.xlsx', totalRows: 50, batchSize: 50 },
    operator
  );
  await engine.stageJobRows(job.id, makeSyntheticRows(50, 'WO-LOCK'));
  await engine.startJob(job.id);

  // Simulate 2 concurrent serverless workers hitting process-next simultaneously
  const [res1, res2] = await Promise.allSettled([
    engine.processNextBatch(job.id, operator),
    engine.processNextBatch(job.id, operator)
  ]);

  const fulfilled = [res1, res2].filter(r => r.status === 'fulfilled');
  const rejected = [res1, res2].filter(r => r.status === 'rejected') as PromiseRejectedResult[];

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal((rejected[0].reason as ImportServiceError).code, 'BATCH_LOCK_CONTENTION');
  assert.equal((rejected[0].reason as ImportServiceError).statusCode, 409);
  assert.equal(store.getCommittedCount(), 50);

  // Now verify stale lock expiration recovery on a 2-batch job
  const store2 = createInMemoryImportTestStore();
  const engine2 = new EnterpriseImportEngine(store2);
  const job2 = await engine2.createImportJob(
    { sourceFile: 'stale_lock.xlsx', totalRows: 50, batchSize: 25 },
    operator
  );
  await engine2.stageJobRows(job2.id, makeSyntheticRows(50, 'WO-STALE'));

  // Claim batch 1 manually as a crashed worker, then expire its lock TTL
  const claim1 = await store2.claimNextBatch({ jobId: job2.id, workerId: 'crashed_worker_1', lockTtlSeconds: 30 });
  assert.equal(claim1.claimed, true);
  assert.equal(claim1.batch?.batchNumber, 1);

  // While lock is fresh, claiming batch 1 explicitly fails with BATCH_LOCKED_BY_ANOTHER_WORKER
  const blockedClaim = await store2.claimNextBatch({
    jobId: job2.id,
    workerId: 'worker_2',
    batchNumber: 1,
    lockTtlSeconds: 30
  });
  assert.equal(blockedClaim.claimed, false);
  assert.equal(blockedClaim.reason, 'BATCH_LOCKED_BY_ANOTHER_WORKER');

  // After lock expires, worker_2 recovers batch 1 cleanly
  store2.expireLockForTest(job2.id, 1);
  const recoveredRes = await engine2.processNextBatch(job2.id, operator, { batchNumber: 1 });
  assert.equal(recoveredRes.processedBatch?.status, 'completed');
  assert.equal(recoveredRes.processedBatch?.retryCount, 1);
  assert.equal(store2.getCommittedCount(), 25);
});

test('Transient retry succeeds automatically while persistent batch error isolates failed batch and supports selective retry', async () => {
  const transientMap = new Map<number, number>([[1, 1]]); // Batch 1 fails once transiently, succeeds on auto-retry
  const store = createInMemoryImportTestStore({
    transientCommitFailuresLeft: transientMap,
    failBatchNumbersOnce: new Set([2]) // Batch 2 fails persistently first time, succeeds on manual retry
  });
  const engine = new EnterpriseImportEngine(store);
  const operator = { id: 'usr_dp', name: 'Dispatch', role: 'dispatch' };

  const job = await engine.createImportJob(
    { sourceFile: 'retry.xlsx', totalRows: 75, batchSize: 25 },
    operator
  );
  await engine.stageJobRows(job.id, makeSyntheticRows(75, 'WO-RETRY'));
  await engine.startJob(job.id);

  // Batch 1: transient failure auto-retries and completes
  const b1 = await engine.processNextBatch(job.id, operator);
  assert.equal(b1.processedBatch?.batchNumber, 1);
  assert.equal(b1.processedBatch?.status, 'completed');
  assert.equal(store.getCommittedCount(), 25);

  // Batch 2: persistent failure isolated as failed
  const b2 = await engine.processNextBatch(job.id, operator);
  assert.equal(b2.processedBatch?.batchNumber, 2);
  assert.equal(b2.processedBatch?.status, 'failed');
  assert.equal(b2.done, false);

  // Batch 3: continues normally
  const b3 = await engine.processNextBatch(job.id, operator);
  assert.equal(b3.processedBatch?.batchNumber, 3);
  assert.equal(b3.processedBatch?.status, 'completed');
  assert.equal(store.getCommittedCount(), 50);
  assert.equal(b3.job.status, 'completed_with_errors');

  // Selective retry re-queues ONLY batch 2 (does NOT replay batch 1 or 3)
  const retriedJob = await engine.retryFailedBatches(job.id, operator);
  assert.equal(retriedJob.status, 'processing');

  const b2Retry = await engine.processNextBatch(job.id, operator);
  assert.equal(b2Retry.processedBatch?.batchNumber, 2);
  assert.equal(b2Retry.processedBatch?.status, 'completed');
  assert.equal(b2Retry.job.status, 'completed');
  assert.equal(b2Retry.job.successfulRows, 75);
  assert.equal(store.getCommittedCount(), 75);
});

test('Validation, duplicate policies (skip vs update_allowed), protected WO guard, cancellation, and import_history survival', async () => {
  const store = createInMemoryImportTestStore({
    initialWorkOrders: [
      { woNumber: 'WO-EXIST-001', wo_number: 'WO-EXIST-001', area: 'OLD_AREA' },
      { id: 'wo_1793825457141_u4bnht', woNumber: 'WO-EXPRESS-TEST-1793825456810', wo_number: 'WO-EXPRESS-TEST-1793825456810' }
    ]
  });
  const engine = new EnterpriseImportEngine(store);
  const operator = { id: 'usr_sa', name: 'Superadmin', role: 'super_admin' };

  const rows = [
    ...makeSyntheticRows(2, 'WO-VALID'),
    {
      rowNumber: 3,
      mapped: {
        woNumber: 'WO-EXIST-001',
        idCustomer: '1234567',
        contractorName: 'PT A',
        area: 'NEW_AREA',
        appointmentDate: '2026-11-26'
      }
    },
    {
      rowNumber: 4,
      mapped: {
        woNumber: 'WO-BAD-CID',
        idCustomer: '123', // Not 7 digits -> invalid
        contractorName: 'PT A',
        area: 'BDG',
        appointmentDate: '2026-11-26'
      }
    },
    {
      rowNumber: 5,
      mapped: {
        woNumber: 'WO-BAD-DATE',
        idCustomer: '7654321',
        contractorName: 'PT A',
        area: 'BDG',
        appointmentDate: '2026-02-31' // Invalid calendar date
      }
    },
    {
      rowNumber: 6,
      mapped: {
        woNumber: 'WO-EXPRESS-TEST-1793825456810', // Protected historical WO
        idCustomer: '7654322',
        contractorName: 'PT A',
        area: 'BDG',
        appointmentDate: '2026-11-26'
      }
    }
  ];

  const job = await engine.createImportJob(
    { sourceFile: 'mixed.xlsx', totalRows: rows.length, batchSize: 25, duplicatePolicy: 'skip' },
    operator
  );
  const staged = await engine.stageJobRows(job.id, rows);
  assert.equal(staged.validCount, 2); // WO-VALID-00001, WO-VALID-00002 (existing & protected already marked duplicate in skip mode)
  assert.equal(staged.duplicateCount, 2); // WO-EXIST-001 + WO-EXPRESS-TEST-1793825456810
  assert.equal(staged.invalidCount, 2); // WO-BAD-CID, WO-BAD-DATE

  const processed = await engine.processNextBatch(job.id, operator);
  assert.equal(processed.job.successfulRows, 2);
  assert.equal(processed.job.duplicateRows, 2);
  assert.equal(processed.job.failedRows, 2);
  assert.equal(processed.job.status, 'completed_with_errors');

  // Also test update_allowed policy + protected WO guard inside commitClaimedBatchAtomic
  const updJob = await engine.createImportJob(
    { sourceFile: 'update_allowed.xlsx', totalRows: 2, batchSize: 25, duplicatePolicy: 'update_allowed' },
    operator
  );
  const updStaged = await engine.stageJobRows(updJob.id, [
    {
      rowNumber: 1,
      mapped: {
        woNumber: 'WO-EXIST-001',
        idCustomer: '1234567',
        contractorName: 'PT A',
        area: 'NEW_AREA',
        appointmentDate: '2026-11-26'
      }
    },
    {
      rowNumber: 2,
      mapped: {
        woNumber: 'WO-EXPRESS-TEST-1793825456810',
        idCustomer: '7654322',
        contractorName: 'PT A',
        area: 'SHOULD_NOT_OVERWRITE',
        appointmentDate: '2026-11-26'
      }
    }
  ]);
  assert.equal(updStaged.validCount, 2);
  const updProcessed = await engine.processNextBatch(updJob.id, operator);
  assert.equal(updProcessed.job.updatedRows, 1); // WO-EXIST-001 updated
  assert.equal(updProcessed.job.duplicateRows, 1); // Protected historical WO guarded & skipped
  assert.equal(store.workOrdersMap.get('wo-exist-001')?.area, 'NEW_AREA');
  assert.notEqual(store.workOrdersMap.get('wo-express-test-1793825456810')?.area, 'SHOULD_NOT_OVERWRITE');

  // Verify history survives even if job row is deleted (ON DELETE SET NULL + original_job_id)
  store.deleteJobPreserveHistoryForTest(job.id);
  const history = await engine.listImportHistory(10);
  assert.ok(history.some(h => h.jobId === job.id && h.successCount === 2));

  // Verify mid-flight cancellation preserves already-committed batches and cancels remaining batches
  const cancelJob = await engine.createImportJob(
    { sourceFile: 'cancel.xlsx', totalRows: 50, batchSize: 25 },
    operator
  );
  await engine.stageJobRows(cancelJob.id, makeSyntheticRows(50, 'WO-CAN'));
  await engine.processNextBatch(cancelJob.id, operator); // Batch 1 committed
  const cancelled = await engine.cancelImportJob(cancelJob.id, operator);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.completedBatches, 1);

  const afterCancel = await engine.processNextBatch(cancelJob.id, operator);
  assert.equal(afterCancel.done, true);
  assert.equal(afterCancel.processedBatch, null);
});

test('Scale contract harness processes 5,000 rows in 500-row batches consistently', async () => {
  const store = createInMemoryImportTestStore();
  const engine = new EnterpriseImportEngine(store);
  const operator = { id: 'usr_sa', name: 'Superadmin', role: 'super_admin' };
  const rows = makeSyntheticRows(5000, 'WO-SCALE');

  const job = await engine.createImportJob(
    { sourceFile: 'scale_5000.xlsx', totalRows: 5000, batchSize: 500 },
    operator
  );
  assert.equal(job.totalBatches, 10);

  for (let i = 0; i < rows.length; i += 400) {
    await engine.stageJobRows(job.id, rows.slice(i, i + 400), { startRowNumber: i + 1 });
  }

  let latest = await engine.startJob(job.id);
  let steps = 0;
  while (true) {
    const step = await engine.processNextBatch(job.id, operator);
    latest = step.job;
    steps++;
    if (step.done) break;
    assert.ok(steps <= 12, 'Infinite batch loop detected');
  }

  assert.equal(latest.status, 'completed');
  assert.equal(latest.successfulRows, 5000);
  assert.equal(latest.completedBatches, 10);
  assert.equal(store.getCommittedCount(), 5000);
});
