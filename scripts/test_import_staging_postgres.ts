/**
 * MORAJAWS ENTERPRISE ASYNCHRONOUS IMPORT — REAL POSTGRESQL STAGING TEST HARNESS
 *
 * Usage (Staging Supabase ONLY — strictly refuses production or missing staging config):
 *   APP_ENV=staging \
 *   STAGING_SUPABASE_URL=https://lvytgqsvxntnvlohmrxi.supabase.co \
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY=<staging_service_role_key> \
 *     npx tsx scripts/test_import_staging_postgres.ts
 *
 * Tests real PostgreSQL Migration 020 tables & ACID RPCs across:
 *   1. Strict environment & project isolation (APP_ENV=staging + STAGING_SUPABASE_PROJECT_ID)
 *   2. Staging & Batch execution scales: 100, 500, 1000, 3000, 5000 WOs
 *   3. Latency measurement (staging + batch commit + total ms)
 *   4. Duplicate handling ('skip' & 'update_allowed')
 *   5. Concurrent processNextBatch() contention & distributed PostgreSQL lock safety
 *   6. Resume after simulated client refresh & cancel-during-processing
 *   7. import_history preservation when import_jobs row is deleted (ON DELETE SET NULL)
 *   8. Verified cleanup of synthetic WO-STG-HARNESS-* & import_jobs rows while
 *      explicitly verifying and logging intentionally retained import_history ledger rows
 *      (DELETE on import_history is intentionally revoked by Migration 020).
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { getSupabaseBackendClient } from '../server/supabaseClient.ts';
import {
  extractSupabaseProjectId,
  getAppEnvironment,
  getEnvironmentConfig,
  STAGING_SUPABASE_PROJECT_ID,
  validateEnvironmentStartup
} from '../server/environmentConfig.ts';
import { EnterpriseImportEngine, ImportServiceError } from '../server/importJobService.ts';

function buildStagingRows(count: number, runNamespace: string, scopeSuffix: string) {
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const woNumber = `WO-STG-HARNESS-${runNamespace}-${scopeSuffix}-${String(i).padStart(5, '0')}`;
    rows.push({
      rowNumber: i,
      mapped: {
        woNumber,
        idCustomer: String(7000000 + i),
        customerName: `[STAGING-HARNESS:${runNamespace}] Customer ${i}`,
        customerPhone: `081900${String(i).padStart(6, '0')}`,
        contractorName: 'PT Staging Harness Contractor',
        area: 'STAGING-HARNESS-AREA',
        appointmentDate: '2026-11-28',
        slotTime: '08:30 - 11:30'
      },
      raw: {
        'WO Number': woNumber,
        'ID Customer': String(7000000 + i)
      }
    });
  }
  return rows;
}

interface CleanupReport {
  deletedWorkOrders: number;
  deletedJobs: number;
  retainedHistoryRows: Array<{
    id: string;
    jobId: string | null;
    originalJobId: string | null;
    importName: string | null;
    status: string;
  }>;
  errors: string[];
}

async function cleanupAndVerifyStagingArtifacts(
  createdJobIds: string[],
  runNamespace: string
): Promise<CleanupReport> {
  const client = getSupabaseBackendClient();
  const report: CleanupReport = {
    deletedWorkOrders: 0,
    deletedJobs: 0,
    retainedHistoryRows: [],
    errors: []
  };

  if (!client) {
    report.errors.push('Supabase backend client tidak tersedia saat cleanup.');
    return report;
  }

  const woLikePattern = `WO-STG-HARNESS-${runNamespace}-%`;

  // 1. Delete ONLY synthetic work_orders created by this isolated run namespace
  const { data: deletedWoRows, error: woDelErr } = await client
    .from('work_orders')
    .delete()
    .like('wo_number', woLikePattern)
    .select('id');

  if (woDelErr) {
    report.errors.push(`Gagal menghapus work_orders synthetic (${woLikePattern}): ${woDelErr.message}`);
  } else {
    report.deletedWorkOrders = Array.isArray(deletedWoRows) ? deletedWoRows.length : 0;
  }

  const { count: remainingWoCount, error: woCheckErr } = await client
    .from('work_orders')
    .select('id', { count: 'exact', head: true })
    .like('wo_number', woLikePattern);

  if (woCheckErr) {
    report.errors.push(`Gagal memverifikasi sisa work_orders (${woLikePattern}): ${woCheckErr.message}`);
  } else if ((remainingWoCount ?? 0) > 0) {
    report.errors.push(`Masih tersisa ${remainingWoCount} work_orders synthetic (${woLikePattern}) setelah cleanup.`);
  }

  // 2. Delete ONLY import_jobs created by this run (cascades import_batches, import_staging_rows,
  //    import_row_errors, and triggers ON DELETE SET NULL on import_history.job_id).
  if (createdJobIds.length > 0) {
    const { data: deletedJobRows, error: jobDelErr } = await client
      .from('import_jobs')
      .delete()
      .in('id', createdJobIds)
      .select('id');

    if (jobDelErr) {
      report.errors.push(`Gagal menghapus import_jobs: ${jobDelErr.message}`);
    } else {
      report.deletedJobs = Array.isArray(deletedJobRows) ? deletedJobRows.length : 0;
    }

    const { count: remainingJobsCount, error: jobCheckErr } = await client
      .from('import_jobs')
      .select('id', { count: 'exact', head: true })
      .in('id', createdJobIds);

    if (jobCheckErr) {
      report.errors.push(`Gagal memverifikasi sisa import_jobs: ${jobCheckErr.message}`);
    } else if ((remainingJobsCount ?? 0) > 0) {
      report.errors.push(`Masih tersisa ${remainingJobsCount} import_jobs setelah cleanup.`);
    }

    // 3. Do NOT attempt DELETE on import_history (DELETE privilege is intentionally revoked).
    //    Instead verify & log intentionally retained audit ledger rows (job_id = NULL, original_job_id intact).
    const { data: retainedHist, error: histErr } = await client
      .from('import_history')
      .select('id, job_id, original_job_id, import_name, status')
      .in('original_job_id', createdJobIds)
      .order('created_at', { ascending: true });

    if (histErr) {
      report.errors.push(`Gagal memverifikasi retained import_history: ${histErr.message}`);
    } else {
      const rows = Array.isArray(retainedHist) ? retainedHist : [];
      for (const r of rows) {
        if (r.job_id !== null) {
          report.errors.push(
            `import_history ${r.id} masih memiliki job_id=${r.job_id} padahal parent import_jobs sudah dihapus.`
          );
        }
        report.retainedHistoryRows.push({
          id: r.id,
          jobId: r.job_id,
          originalJobId: r.original_job_id,
          importName: r.import_name,
          status: r.status
        });
      }
    }
  }

  return report;
}

async function main() {
  const activeEnv = getAppEnvironment();
  const envValidation = validateEnvironmentStartup('staging');
  const stagingConfig = getEnvironmentConfig('staging');
  const explicitStagingUrl = (process.env.STAGING_SUPABASE_URL || '').trim();
  const explicitStagingKey = (
    process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.STAGING_SUPABASE_SECRET_KEY ||
    ''
  ).trim();

  if (activeEnv !== 'staging') {
    console.error(
      `[ABORTED] Skrip staging test ini WAJIB dijalankan dengan APP_ENV=staging (terdeteksi APP_ENV=${activeEnv}).`
    );
    process.exit(3);
  }

  if (!explicitStagingUrl || !explicitStagingKey) {
    console.error(
      '[BLOCKED] STAGING_SUPABASE_URL dan STAGING_SUPABASE_SERVICE_ROLE_KEY wajib dikonfigurasi eksplisit pada environment staging.'
    );
    process.exit(2);
  }

  const projectId = extractSupabaseProjectId(stagingConfig.supabaseUrl);
  if (!envValidation.valid || projectId !== STAGING_SUPABASE_PROJECT_ID) {
    console.error(
      `[ABORTED] Validasi isolasi staging gagal (project=${projectId || 'unknown'}, errors=${envValidation.errors.join(' | ')}).`
    );
    process.exit(3);
  }

  const client = getSupabaseBackendClient();
  if (!client) {
    console.error('[BLOCKED] Supabase staging backend client tidak tersedia.');
    process.exit(2);
  }

  const engine = new EnterpriseImportEngine();
  const operator = { id: 'usr_staging_harness', name: 'Staging QA Harness', role: 'super_admin' };
  const runNamespace = `${Date.now().toString(36).toUpperCase()}`;
  const createdJobIds: string[] = [];
  let testFailed = false;

  try {
    console.log(`[Staging Test] Environment=${activeEnv}, Project=${projectId}, Namespace=WO-STG-HARNESS-${runNamespace}`);

    // 1. Scale benchmarks: 100, 500, 1000, 3000, 5000 WOs
    for (const scale of [100, 500, 1000, 3000, 5000]) {
      const scopeSuffix = `S${scale}`;
      const rows = buildStagingRows(scale, runNamespace, scopeSuffix);
      const tStart = Date.now();
      const job = await engine.createImportJob(
        {
          importName: `[STAGING-HARNESS:${runNamespace}] Scale ${scale}`,
          sourceFile: `staging_harness_${runNamespace}_${scale}.xlsx`,
          totalRows: scale,
          batchSize: 500,
          clientRequestId: `stg_harness_${runNamespace}_scale_${scale}`
        },
        operator
      );
      createdJobIds.push(job.id);

      const tStageStart = Date.now();
      for (let i = 0; i < rows.length; i += 400) {
        await engine.stageJobRows(job.id, rows.slice(i, i + 400), { startRowNumber: i + 1 });
      }
      const stageMs = Date.now() - tStageStart;

      await engine.startJob(job.id);
      const tProcessStart = Date.now();
      let latest = job;
      while (true) {
        const res = await engine.processNextBatch(job.id, operator);
        latest = res.job;
        if (res.done) break;
      }
      const processMs = Date.now() - tProcessStart;
      const totalMs = Date.now() - tStart;

      assert.equal(latest.status, 'completed', `Scale ${scale} status mismatch`);
      assert.equal(latest.successfulRows, scale, `Scale ${scale} successfulRows mismatch`);
      console.log(
        `[PASS] Scale ${scale} WOs -> stage=${stageMs}ms, process=${processMs}ms, total=${totalMs}ms, batches=${latest.completedBatches}`
      );
    }

    // 2. Duplicate skip vs update_allowed + Concurrent contention test
    const baseRows = buildStagingRows(50, runNamespace, 'DUP');
    const dupJob = await engine.createImportJob(
      {
        importName: `[STAGING-HARNESS:${runNamespace}] Dup Skip`,
        sourceFile: `staging_harness_${runNamespace}_dup_skip.xlsx`,
        totalRows: 50,
        batchSize: 50,
        duplicatePolicy: 'skip',
        clientRequestId: `stg_harness_${runNamespace}_dup_skip`
      },
      operator
    );
    createdJobIds.push(dupJob.id);
    await engine.stageJobRows(dupJob.id, baseRows);
    await engine.startJob(dupJob.id);

    const [c1, c2] = await Promise.allSettled([
      engine.processNextBatch(dupJob.id, operator),
      engine.processNextBatch(dupJob.id, operator)
    ]);
    const okCount = [c1, c2].filter(r => r.status === 'fulfilled').length;
    assert.equal(okCount, 1, 'Expected exactly 1 worker to win batch lock');
    const cErr = [c1, c2].find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (cErr && cErr.reason instanceof ImportServiceError) {
      assert.ok(['BATCH_LOCK_CONTENTION', 'IMPORT_BATCH_LOCK_LOST'].includes(cErr.reason.code));
    }

    const updRows = baseRows.map(r => ({
      ...r,
      mapped: { ...r.mapped, area: 'STAGING-HARNESS-AREA-UPDATED' }
    }));
    const updJob = await engine.createImportJob(
      {
        importName: `[STAGING-HARNESS:${runNamespace}] Dup Update`,
        sourceFile: `staging_harness_${runNamespace}_dup_update.xlsx`,
        totalRows: 50,
        batchSize: 50,
        duplicatePolicy: 'update_allowed',
        clientRequestId: `stg_harness_${runNamespace}_dup_update`
      },
      operator
    );
    createdJobIds.push(updJob.id);
    await engine.stageJobRows(updJob.id, updRows);
    await engine.startJob(updJob.id);
    const updRes = await engine.processNextBatch(updJob.id, operator);
    assert.equal(updRes.job.status, 'completed');
    assert.equal(updRes.job.updatedRows, 50);

    // 3. Cancellation & Resume test
    const canRows = buildStagingRows(100, runNamespace, 'CAN');
    const canJob = await engine.createImportJob(
      {
        importName: `[STAGING-HARNESS:${runNamespace}] Cancel Test`,
        sourceFile: `staging_harness_${runNamespace}_cancel.xlsx`,
        totalRows: 100,
        batchSize: 50,
        clientRequestId: `stg_harness_${runNamespace}_cancel`
      },
      operator
    );
    createdJobIds.push(canJob.id);
    await engine.stageJobRows(canJob.id, canRows);
    await engine.startJob(canJob.id);
    await engine.processNextBatch(canJob.id, operator);
    const resumedView = await engine.getImportJobDetail(canJob.id);
    assert.equal(resumedView?.completedBatches, 1);
    const cancelledJob = await engine.cancelImportJob(canJob.id, operator);
    assert.equal(cancelledJob.status, 'cancelled');

    // 4. Verify import_history survives deletion of parent import_jobs row (ON DELETE SET NULL)
    const { error: delDupJobErr } = await client.from('import_jobs').delete().eq('id', dupJob.id);
    assert.equal(delDupJobErr, null, `Unexpected error deleting import_jobs ${dupJob.id}: ${delDupJobErr?.message}`);
    const { data: histRow, error: histErr } = await client
      .from('import_history')
      .select('id, job_id, original_job_id, success_count')
      .eq('original_job_id', dupJob.id)
      .maybeSingle();
    assert.equal(histErr, null);
    assert.ok(histRow, 'import_history record must survive import_jobs deletion');
    assert.equal(histRow.job_id, null);
    assert.equal(histRow.original_job_id, dupJob.id);
    console.log('[PASS] import_history survived import_jobs deletion with job_id=NULL & original_job_id preserved.');

    console.log('[ALL STAGING POSTGRESQL TESTS PASSED]');
  } catch (err) {
    testFailed = true;
    throw err;
  } finally {
    const cleanup = await cleanupAndVerifyStagingArtifacts(createdJobIds, runNamespace);
    if (cleanup.errors.length > 0) {
      console.error('[CLEANUP FAILED]', cleanup.errors);
      if (!testFailed) {
        process.exitCode = 1;
      }
    } else {
      console.log(
        `[Cleanup Verified] Removed ${cleanup.deletedWorkOrders} synthetic work_orders and ${cleanup.deletedJobs} import_jobs (with cascaded batches/staging/errors).`
      );
      console.log(
        `[Audit Retention Verified] Intentionally retained ${cleanup.retainedHistoryRows.length} staging import_history ledger rows (DELETE revoked by design; job_id=NULL, original_job_id preserved):`,
        cleanup.retainedHistoryRows.map(r => ({ id: r.id, originalJobId: r.originalJobId, status: r.status }))
      );
    }
  }
}

main().catch((err) => {
  console.error('[FAILED]', err);
  process.exit(1);
});
