import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSupabaseBackendClient } from './supabaseClient.ts';
import {
  canonicalWoKey,
  classifySupabaseError,
  normalizeWoNumber,
  PROTECTED_PRODUCTION_WO_IDS,
  ticketToPostgresRow,
  toDateOnlyString
} from './supabaseAdapter.ts';
import { resolveLeaderForWorkOrder } from './appFlowHelpers.ts';
import type {
  ImportBatchStatus,
  ImportBatchSummary,
  ImportHistoryRecord,
  ImportJobStatus,
  ImportJobSummary,
  ImportRowErrorRecord,
  ImportTemplateType
} from '../src/types/index.ts';

export const DEFAULT_IMPORT_BATCH_SIZE = 500;
export const MIN_IMPORT_BATCH_SIZE = 25;
export const MAX_IMPORT_BATCH_SIZE = 500;
export const MAX_STAGE_CHUNK_ROWS = 500;
export const MAX_IMPORT_JOB_ROWS = 25000;

export interface ImportOperatorUser {
  id: string;
  name: string;
  role: string;
}

export interface StagedRowInput {
  rowNumber?: number;
  raw?: Record<string, any>;
  mapped?: Record<string, any>;
  woNumber?: string;
  workOrderNumber?: string;
  idCustomer?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  area?: string;
  clusterName?: string;
  streetName?: string;
  contactorName?: string;
  contractorName?: string;
  appointmentDate?: string;
  slotTime?: string;
  fdtCode?: string;
  fatCode?: string;
  ticketCategory?: string;
  additionalFields?: Record<string, any>;
  unmappedHeaders?: string[];
  [key: string]: any;
}

export interface InternalStagingRow {
  id: string;
  jobId: string;
  batchNumber: number | null;
  rowNumber: number;
  woNumber: string;
  canonicalWo: string;
  rawPayload: Record<string, any>;
  normalizedPayload: Record<string, any>;
  validationStatus: 'pending' | 'valid' | 'invalid' | 'duplicate';
  processingStatus: 'pending' | 'processing' | 'succeeded' | 'duplicate_skipped' | 'failed' | 'cancelled';
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

export interface WorkOrderCommitResult {
  insertedWoNumbers: string[];
  updatedWoNumbers: string[];
  duplicateWoNumbers: string[];
  failedRows: Array<{ woNumber: string; errorCode: string; errorMessage: string }>;
}

export interface ImportPersistenceStore {
  createJob(job: ImportJobSummary): Promise<void>;
  updateJob(jobId: string, patch: Partial<ImportJobSummary>): Promise<ImportJobSummary | null>;
  getJob(jobId: string): Promise<ImportJobSummary | null>;
  listJobs(limit?: number): Promise<ImportJobSummary[]>;
  upsertBatches(batches: ImportBatchSummary[]): Promise<void>;
  updateBatch(jobId: string, batchNumber: number, patch: Partial<ImportBatchSummary>): Promise<ImportBatchSummary | null>;
  getBatches(jobId: string): Promise<ImportBatchSummary[]>;
  upsertStagingRows(rows: InternalStagingRow[]): Promise<void>;
  getStagingRows(jobId: string, opts?: { batchNumber?: number }): Promise<InternalStagingRow[]>;
  updateStagingRows(rows: InternalStagingRow[]): Promise<void>;
  appendRowErrors(errors: ImportRowErrorRecord[]): Promise<void>;
  getRowErrors(jobId: string, limit?: number, offset?: number): Promise<ImportRowErrorRecord[]>;
  upsertHistory(record: ImportHistoryRecord): Promise<void>;
  listHistory(limit?: number): Promise<ImportHistoryRecord[]>;
  findExistingWoNumbers(canonicalCandidates: Array<{ normWo: string; rawTrimmed: string }>): Promise<Set<string>>;
  commitWorkOrderBatch(params: {
    rows: Record<string, any>[];
    duplicatePolicy: 'skip' | 'update_allowed';
    batchId: string;
    importedBy: string;
  }): Promise<WorkOrderCommitResult>;
  getAuthUsersAndContractors(): Promise<{ users: any[]; contractors: any[] }>;
}

export interface EnterpriseImportHooks {
  onWorkOrdersCommitted?: (info: {
    jobId: string;
    batchNumber: number;
    importedCount: number;
    updatedCount: number;
    committedTickets: Record<string, any>[];
    users: any[];
    user: ImportOperatorUser;
  }) => Promise<void> | void;
  onJobFinalized?: (info: {
    job: ImportJobSummary;
    history: ImportHistoryRecord;
    user: ImportOperatorUser;
  }) => Promise<void> | void;
}

function clampBatchSize(size?: number): number {
  const n = Number(size);
  if (!Number.isFinite(n)) return DEFAULT_IMPORT_BATCH_SIZE;
  return Math.max(MIN_IMPORT_BATCH_SIZE, Math.min(MAX_IMPORT_BATCH_SIZE, Math.floor(n)));
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function computeProgressPercent(job: Pick<ImportJobSummary, 'totalRows' | 'processedRows' | 'status'>): number {
  if (job.totalRows <= 0) {
    return job.status === 'completed' || job.status === 'completed_with_errors' ? 100 : 0;
  }
  const pct = Math.round((Math.min(job.processedRows, job.totalRows) / job.totalRows) * 1000) / 10;
  if (job.status === 'completed' || job.status === 'completed_with_errors') {
    return 100;
  }
  return Math.min(100, Math.max(0, pct));
}

function enrichJobFlags(job: ImportJobSummary, batches?: ImportBatchSummary[]): ImportJobSummary {
  const failedBatchCount = batches ? batches.filter(b => b.status === 'failed').length : 0;
  const pendingBatchCount = batches ? batches.filter(b => b.status === 'pending' || b.status === 'processing').length : 0;
  const hasFailedBatches = failedBatchCount > 0;
  const isTerminal = job.status === 'completed' || job.status === 'cancelled';
  const durationMs = job.startedAt
    ? Math.max(
        0,
        (job.completedAt ? Date.parse(job.completedAt) : job.cancelledAt ? Date.parse(job.cancelledAt) : Date.now()) -
          Date.parse(job.startedAt)
      )
    : job.durationMs ?? null;

  return {
    ...job,
    progressPercent: computeProgressPercent(job),
    durationMs: Number.isFinite(durationMs as number) ? durationMs : null,
    batches: batches ?? job.batches,
    hasFailedBatches,
    canResume:
      !isTerminal &&
      (job.status === 'paused' ||
        job.status === 'queued' ||
        job.status === 'processing' ||
        pendingBatchCount > 0),
    canCancel:
      job.status === 'staging' ||
      job.status === 'queued' ||
      job.status === 'processing' ||
      job.status === 'paused',
    canRetry:
      hasFailedBatches ||
      job.status === 'failed' ||
      (job.status === 'completed_with_errors' && hasFailedBatches)
  };
}

function dbRowToJob(r: any): ImportJobSummary {
  return enrichJobFlags({
    id: r.id,
    importName: r.import_name,
    sourceFile: r.source_file,
    sourceFormat: r.source_format || 'xlsx',
    templateType: (r.template_type || 'CUSTOM') as ImportTemplateType,
    duplicatePolicy: (r.duplicate_policy === 'update_allowed' ? 'update_allowed' : 'skip'),
    autoRegisterContractors: r.auto_register_contractors !== false,
    batchSize: Number(r.batch_size || DEFAULT_IMPORT_BATCH_SIZE),
    totalRows: Number(r.total_rows || 0),
    stagedRows: Number(r.staged_rows || 0),
    processedRows: Number(r.processed_rows || 0),
    successfulRows: Number(r.successful_rows || 0),
    updatedRows: Number(r.updated_rows || 0),
    duplicateRows: Number(r.duplicate_rows || 0),
    failedRows: Number(r.failed_rows || 0),
    totalBatches: Number(r.total_batches || 0),
    completedBatches: Number(r.completed_batches || 0),
    currentBatch: Number(r.current_batch || 0),
    progressPercent: 0,
    status: r.status as ImportJobStatus,
    errorSummary: r.error_summary || null,
    createdBy: r.created_by || 'System',
    createdById: r.created_by_id || null,
    createdAt: r.created_at,
    startedAt: r.started_at || null,
    updatedAt: r.updated_at || r.created_at,
    completedAt: r.completed_at || null,
    cancelledAt: r.cancelled_at || null
  });
}

function dbRowToBatch(r: any): ImportBatchSummary {
  return {
    id: r.id,
    jobId: r.job_id,
    batchNumber: Number(r.batch_number),
    startRow: Number(r.start_row),
    endRow: Number(r.end_row),
    rowCount: Number(r.row_count || 0),
    processedRows: Number(r.processed_rows || 0),
    successfulRows: Number(r.successful_rows || 0),
    duplicateRows: Number(r.duplicate_rows || 0),
    failedRows: Number(r.failed_rows || 0),
    status: r.status as ImportBatchStatus,
    retryCount: Number(r.retry_count || 0),
    errorMessage: r.error_message || null,
    durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : null,
    startedAt: r.started_at || null,
    processedAt: r.processed_at || null
  };
}

function dbRowToStaging(r: any): InternalStagingRow {
  const normWo = normalizeWoNumber(r.wo_number || r.normalized_payload?.woNumber || '');
  return {
    id: r.id,
    jobId: r.job_id,
    batchNumber: typeof r.batch_number === 'number' ? r.batch_number : null,
    rowNumber: Number(r.row_number),
    woNumber: normWo || String(r.wo_number || ''),
    canonicalWo: canonicalWoKey(normWo || r.wo_number || ''),
    rawPayload: r.raw_payload && typeof r.raw_payload === 'object' ? r.raw_payload : {},
    normalizedPayload: r.normalized_payload && typeof r.normalized_payload === 'object' ? r.normalized_payload : {},
    validationStatus: r.validation_status || 'pending',
    processingStatus: r.processing_status || 'pending',
    errorCode: r.error_code || null,
    errorMessage: r.error_message || null,
    createdAt: r.created_at,
    processedAt: r.processed_at || null
  };
}

function dbRowToError(r: any): ImportRowErrorRecord {
  return {
    id: r.id,
    jobId: r.job_id,
    batchNumber: typeof r.batch_number === 'number' ? r.batch_number : null,
    rowNumber: Number(r.row_number),
    woNumber: r.wo_number || null,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    rawPayload: r.raw_payload && typeof r.raw_payload === 'object' ? r.raw_payload : {},
    createdAt: r.created_at
  };
}

function dbRowToHistory(r: any): ImportHistoryRecord {
  return {
    id: r.id,
    jobId: r.job_id,
    importName: r.import_name || null,
    sourceFile: r.source_file || null,
    importedBy: r.imported_by,
    importedById: r.imported_by_id || null,
    totalRows: Number(r.total_rows || 0),
    successCount: Number(r.success_count || 0),
    duplicateCount: Number(r.duplicate_count || 0),
    failedCount: Number(r.failed_count || 0),
    status: r.status || 'completed',
    durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : null,
    createdAt: r.created_at
  };
}

// ==============================================================================
// IN-MEMORY ISOLATED STORE (Used for automated benchmarks, unit & recovery tests)
// Zero production database mutation.
// ==============================================================================
export function createInMemoryImportTestStore(options?: {
  initialWorkOrders?: Record<string, any>[];
  users?: any[];
  contractors?: any[];
  failBatchNumbersOnce?: Set<number>;
  alwaysFailBatchNumbers?: Set<number>;
  simulatedBatchDelayMs?: number;
}): ImportPersistenceStore & {
  workOrdersMap: Map<string, Record<string, any>>;
  getCommittedCount: () => number;
} {
  const jobs = new Map<string, ImportJobSummary>();
  const batchesMap = new Map<string, Map<number, ImportBatchSummary>>();
  const stagingMap = new Map<string, Map<number, InternalStagingRow>>();
  const errorsMap = new Map<string, ImportRowErrorRecord[]>();
  const historyMap = new Map<string, ImportHistoryRecord>();
  const workOrdersMap = new Map<string, Record<string, any>>();
  const failedOnceTracker = new Set<number>();

  for (const wo of options?.initialWorkOrders || []) {
    const key = canonicalWoKey(wo.woNumber || wo.wo_number);
    if (key) workOrdersMap.set(key, { ...wo });
  }

  return {
    workOrdersMap,
    getCommittedCount: () => workOrdersMap.size,

    async createJob(job) {
      jobs.set(job.id, { ...job });
    },
    async updateJob(jobId, patch) {
      const existing = jobs.get(jobId);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      jobs.set(jobId, updated);
      return enrichJobFlags(updated, Array.from(batchesMap.get(jobId)?.values() || []));
    },
    async getJob(jobId) {
      const j = jobs.get(jobId);
      if (!j) return null;
      const bs = Array.from(batchesMap.get(jobId)?.values() || []).sort((a, b) => a.batchNumber - b.batchNumber);
      return enrichJobFlags(j, bs);
    },
    async listJobs(limit = 30) {
      return Array.from(jobs.values())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map(j => enrichJobFlags(j, Array.from(batchesMap.get(j.id)?.values() || [])));
    },
    async upsertBatches(batches) {
      for (const b of batches) {
        if (!batchesMap.has(b.jobId)) batchesMap.set(b.jobId, new Map());
        batchesMap.get(b.jobId)!.set(b.batchNumber, { ...b });
      }
    },
    async updateBatch(jobId, batchNumber, patch) {
      const bMap = batchesMap.get(jobId);
      if (!bMap) return null;
      const prev = bMap.get(batchNumber);
      if (!prev) return null;
      const next = { ...prev, ...patch };
      bMap.set(batchNumber, next);
      return { ...next };
    },
    async getBatches(jobId) {
      return Array.from(batchesMap.get(jobId)?.values() || []).sort((a, b) => a.batchNumber - b.batchNumber);
    },
    async upsertStagingRows(rows) {
      for (const r of rows) {
        if (!stagingMap.has(r.jobId)) stagingMap.set(r.jobId, new Map());
        stagingMap.get(r.jobId)!.set(r.rowNumber, { ...r });
      }
    },
    async getStagingRows(jobId, opts) {
      const all = Array.from(stagingMap.get(jobId)?.values() || []);
      const filtered = typeof opts?.batchNumber === 'number'
        ? all.filter(r => r.batchNumber === opts.batchNumber)
        : all;
      return filtered.sort((a, b) => a.rowNumber - b.rowNumber);
    },
    async updateStagingRows(rows) {
      for (const r of rows) {
        if (!stagingMap.has(r.jobId)) stagingMap.set(r.jobId, new Map());
        stagingMap.get(r.jobId)!.set(r.rowNumber, { ...r });
      }
    },
    async appendRowErrors(errors) {
      for (const e of errors) {
        if (!errorsMap.has(e.jobId)) errorsMap.set(e.jobId, []);
        errorsMap.get(e.jobId)!.push({ ...e });
      }
    },
    async getRowErrors(jobId, limit = 1000, offset = 0) {
      const list = (errorsMap.get(jobId) || []).slice().sort((a, b) => a.rowNumber - b.rowNumber);
      return list.slice(offset, offset + limit);
    },
    async upsertHistory(record) {
      historyMap.set(record.jobId, { ...record });
    },
    async listHistory(limit = 50) {
      return Array.from(historyMap.values())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit);
    },
    async findExistingWoNumbers(candidates) {
      const out = new Set<string>();
      for (const c of candidates) {
        const key = canonicalWoKey(c.normWo);
        if (key && workOrdersMap.has(key)) out.add(key);
      }
      return out;
    },
    async commitWorkOrderBatch({ rows, duplicatePolicy, batchId }) {
      if (options?.simulatedBatchDelayMs) {
        await new Promise(resolve => setTimeout(resolve, options.simulatedBatchDelayMs));
      }
      const matchBatchNum = batchId.match(/_b(\d+)$/);
      const batchNo = matchBatchNum ? Number(matchBatchNum[1]) : 0;
      if (options?.alwaysFailBatchNumbers?.has(batchNo)) {
        throw new Error(`Simulated persistent failure on batch #${batchNo}`);
      }
      if (options?.failBatchNumbersOnce?.has(batchNo) && !failedOnceTracker.has(batchNo)) {
        failedOnceTracker.add(batchNo);
        throw new Error(`Simulated transient failure on batch #${batchNo}`);
      }

      const insertedWoNumbers: string[] = [];
      const updatedWoNumbers: string[] = [];
      const duplicateWoNumbers: string[] = [];
      const failedRows: Array<{ woNumber: string; errorCode: string; errorMessage: string }> = [];

      for (const row of rows) {
        const normWo = normalizeWoNumber(row.woNumber || row.wo_number);
        const key = canonicalWoKey(normWo);
        if (!normWo || !key) {
          failedRows.push({ woNumber: '', errorCode: 'INVALID_WO', errorMessage: 'Nomor WO kosong' });
          continue;
        }
        if (workOrdersMap.has(key)) {
          if (duplicatePolicy === 'update_allowed') {
            workOrdersMap.set(key, { ...workOrdersMap.get(key)!, ...row, updatedAt: new Date().toISOString() });
            updatedWoNumbers.push(normWo);
          } else {
            duplicateWoNumbers.push(normWo);
          }
        } else {
          workOrdersMap.set(key, { ...row, woNumber: normWo, id: row.id || `wo_${normWo}` });
          insertedWoNumbers.push(normWo);
        }
      }

      return { insertedWoNumbers, updatedWoNumbers, duplicateWoNumbers, failedRows };
    },
    async getAuthUsersAndContractors() {
      return {
        users: options?.users || [],
        contractors: options?.contractors || []
      };
    }
  };
}

// ==============================================================================
// PRODUCTION SUPABASE + FALLBACK STORE
// - Uses PostgreSQL tables from Migration 020 when present.
// - Automatically falls back to app_settings + local tmp/data staging buffers
//   if Migration 020 tables have not yet been executed on remote Supabase,
//   while STILL writing valid Work Orders directly to public.work_orders!
// ==============================================================================
class ProductionImportStore implements ImportPersistenceStore {
  private schemaAvailable: boolean | null = null;
  private schemaCheckedAt = 0;
  private fallbackDir: string;

  constructor() {
    const isVercel = Boolean(process.env.VERCEL);
    this.fallbackDir = isVercel
      ? path.join('/tmp', 'morajaws_import_jobs')
      : path.join(process.cwd(), 'data', 'import_jobs');
  }

  private ensureFallbackDir() {
    try {
      if (!fs.existsSync(this.fallbackDir)) {
        fs.mkdirSync(this.fallbackDir, { recursive: true });
      }
    } catch {
      // ignore on read-only paths
    }
  }

  private readLocalJson<T>(fileName: string, defaultVal: T): T {
    try {
      const p = path.join(this.fallbackDir, fileName);
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
      }
    } catch {}
    return defaultVal;
  }

  private writeLocalJson(fileName: string, data: any) {
    try {
      this.ensureFallbackDir();
      const p = path.join(this.fallbackDir, fileName);
      fs.writeFileSync(p, JSON.stringify(data), 'utf8');
    } catch {}
  }

  private async isRelationalSchemaReady(): Promise<boolean> {
    const client = getSupabaseBackendClient();
    if (!client) return false;

    const now = Date.now();
    if (this.schemaAvailable === true) return true;
    if (this.schemaAvailable === false && now - this.schemaCheckedAt < 60_000) {
      return false;
    }

    try {
      const { error } = await client.from('import_jobs').select('id').limit(1);
      this.schemaCheckedAt = now;
      if (!error) {
        this.schemaAvailable = true;
        return true;
      }
      const classified = classifySupabaseError(error, { table: 'import_jobs', operation: 'probe' });
      if (classified.isSchemaError) {
        this.schemaAvailable = false;
        return false;
      }
      // Other transient error: do not misclassify as missing schema permanently
      return false;
    } catch {
      this.schemaCheckedAt = now;
      return false;
    }
  }

  private async readFallbackSetting<T>(key: string, defaultVal: T): Promise<T> {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        const { data, error } = await client
          .from('app_settings')
          .select('value')
          .eq('key', key)
          .maybeSingle();
        if (!error && data && data.value !== undefined && data.value !== null) {
          return data.value as T;
        }
      } catch {}
    }
    return this.readLocalJson<T>(`${key}.json`, defaultVal);
  }

  private async writeFallbackSetting(key: string, value: any, updatedBy = 'System'): Promise<void> {
    this.writeLocalJson(`${key}.json`, value);
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        await client.from('app_settings').upsert(
          {
            key,
            value,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy
          },
          { onConflict: 'key' }
        );
      } catch {}
    }
  }

  async createJob(job: ImportJobSummary): Promise<void> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const { error } = await client.from('import_jobs').insert([
        {
          id: job.id,
          import_name: job.importName,
          source_file: job.sourceFile,
          source_format: job.sourceFormat,
          template_type: job.templateType,
          duplicate_policy: job.duplicatePolicy,
          auto_register_contractors: job.autoRegisterContractors,
          batch_size: job.batchSize,
          total_rows: job.totalRows,
          staged_rows: job.stagedRows,
          processed_rows: job.processedRows,
          successful_rows: job.successfulRows,
          updated_rows: job.updatedRows,
          duplicate_rows: job.duplicateRows,
          failed_rows: job.failedRows,
          total_batches: job.totalBatches,
          completed_batches: job.completedBatches,
          current_batch: job.currentBatch,
          status: job.status,
          error_summary: job.errorSummary || null,
          created_by: job.createdBy,
          created_by_id: job.createdById || null,
          created_at: job.createdAt,
          started_at: job.startedAt || null,
          updated_at: job.updatedAt,
          completed_at: job.completedAt || null,
          cancelled_at: job.cancelledAt || null
        }
      ]);
      if (!error) return;
    }

    await this.writeFallbackSetting(`morajaws_imp_job_${job.id}`, job, job.createdBy);
    const index = await this.readFallbackSetting<string[]>('morajaws_imp_jobs_index', []);
    const nextIndex = [job.id, ...index.filter(id => id !== job.id)].slice(0, 60);
    await this.writeFallbackSetting('morajaws_imp_jobs_index', nextIndex, job.createdBy);
  }

  async updateJob(jobId: string, patch: Partial<ImportJobSummary>): Promise<ImportJobSummary | null> {
    const client = getSupabaseBackendClient();
    const now = new Date().toISOString();
    if (client && (await this.isRelationalSchemaReady())) {
      const dbPatch: Record<string, any> = { updated_at: now };
      if (patch.totalRows !== undefined) dbPatch.total_rows = patch.totalRows;
      if (patch.stagedRows !== undefined) dbPatch.staged_rows = patch.stagedRows;
      if (patch.processedRows !== undefined) dbPatch.processed_rows = patch.processedRows;
      if (patch.successfulRows !== undefined) dbPatch.successful_rows = patch.successfulRows;
      if (patch.updatedRows !== undefined) dbPatch.updated_rows = patch.updatedRows;
      if (patch.duplicateRows !== undefined) dbPatch.duplicate_rows = patch.duplicateRows;
      if (patch.failedRows !== undefined) dbPatch.failed_rows = patch.failedRows;
      if (patch.totalBatches !== undefined) dbPatch.total_batches = patch.totalBatches;
      if (patch.completedBatches !== undefined) dbPatch.completed_batches = patch.completedBatches;
      if (patch.currentBatch !== undefined) dbPatch.current_batch = patch.currentBatch;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      if (patch.errorSummary !== undefined) dbPatch.error_summary = patch.errorSummary;
      if (patch.startedAt !== undefined) dbPatch.started_at = patch.startedAt;
      if (patch.completedAt !== undefined) dbPatch.completed_at = patch.completedAt;
      if (patch.cancelledAt !== undefined) dbPatch.cancelled_at = patch.cancelledAt;

      const { data, error } = await client
        .from('import_jobs')
        .update(dbPatch)
        .eq('id', jobId)
        .select('*')
        .maybeSingle();
      if (!error && data) {
        const batches = await this.getBatches(jobId);
        return enrichJobFlags(dbRowToJob(data), batches);
      }
    }

    const existing = await this.readFallbackSetting<ImportJobSummary | null>(`morajaws_imp_job_${jobId}`, null);
    if (!existing) return null;
    const next = { ...existing, ...patch, updatedAt: now };
    await this.writeFallbackSetting(`morajaws_imp_job_${jobId}`, next);
    const batches = await this.getBatches(jobId);
    return enrichJobFlags(next, batches);
  }

  async getJob(jobId: string): Promise<ImportJobSummary | null> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const { data, error } = await client.from('import_jobs').select('*').eq('id', jobId).maybeSingle();
      if (!error && data) {
        const batches = await this.getBatches(jobId);
        return enrichJobFlags(dbRowToJob(data), batches);
      }
    }
    const existing = await this.readFallbackSetting<ImportJobSummary | null>(`morajaws_imp_job_${jobId}`, null);
    if (!existing) return null;
    const batches = await this.getBatches(jobId);
    return enrichJobFlags(existing, batches);
  }

  async listJobs(limit = 30): Promise<ImportJobSummary[]> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const { data, error } = await client
        .from('import_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!error && Array.isArray(data)) {
        return data.map(dbRowToJob);
      }
    }
    const index = await this.readFallbackSetting<string[]>('morajaws_imp_jobs_index', []);
    const results: ImportJobSummary[] = [];
    for (const id of index.slice(0, limit)) {
      const j = await this.readFallbackSetting<ImportJobSummary | null>(`morajaws_imp_job_${id}`, null);
      if (j) results.push(enrichJobFlags(j));
    }
    return results;
  }

  async upsertBatches(batches: ImportBatchSummary[]): Promise<void> {
    if (batches.length === 0) return;
    const jobId = batches[0].jobId;
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const payload = batches.map(b => ({
        id: b.id,
        job_id: b.jobId,
        batch_number: b.batchNumber,
        start_row: b.startRow,
        end_row: b.endRow,
        row_count: b.rowCount,
        processed_rows: b.processedRows,
        successful_rows: b.successfulRows,
        duplicate_rows: b.duplicateRows,
        failed_rows: b.failedRows,
        status: b.status,
        retry_count: b.retryCount,
        error_message: b.errorMessage || null,
        duration_ms: b.durationMs ?? null,
        started_at: b.startedAt || null,
        processed_at: b.processedAt || null
      }));
      const { error } = await client
        .from('import_batches')
        .upsert(payload, { onConflict: 'job_id,batch_number' });
      if (!error) return;
    }

    const existing = await this.readFallbackSetting<ImportBatchSummary[]>(`morajaws_imp_batches_${jobId}`, []);
    const map = new Map<number, ImportBatchSummary>();
    existing.forEach(b => map.set(b.batchNumber, b));
    batches.forEach(b => map.set(b.batchNumber, b));
    await this.writeFallbackSetting(
      `morajaws_imp_batches_${jobId}`,
      Array.from(map.values()).sort((a, b) => a.batchNumber - b.batchNumber)
    );
  }

  async updateBatch(jobId: string, batchNumber: number, patch: Partial<ImportBatchSummary>): Promise<ImportBatchSummary | null> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const dbPatch: Record<string, any> = {};
      if (patch.processedRows !== undefined) dbPatch.processed_rows = patch.processedRows;
      if (patch.successfulRows !== undefined) dbPatch.successful_rows = patch.successfulRows;
      if (patch.duplicateRows !== undefined) dbPatch.duplicate_rows = patch.duplicateRows;
      if (patch.failedRows !== undefined) dbPatch.failed_rows = patch.failedRows;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      if (patch.retryCount !== undefined) dbPatch.retry_count = patch.retryCount;
      if (patch.errorMessage !== undefined) dbPatch.error_message = patch.errorMessage;
      if (patch.durationMs !== undefined) dbPatch.duration_ms = patch.durationMs;
      if (patch.startedAt !== undefined) dbPatch.started_at = patch.startedAt;
      if (patch.processedAt !== undefined) dbPatch.processed_at = patch.processedAt;

      const { data, error } = await client
        .from('import_batches')
        .update(dbPatch)
        .eq('job_id', jobId)
        .eq('batch_number', batchNumber)
        .select('*')
        .maybeSingle();
      if (!error && data) return dbRowToBatch(data);
    }

    const existing = await this.readFallbackSetting<ImportBatchSummary[]>(`morajaws_imp_batches_${jobId}`, []);
    let updated: ImportBatchSummary | null = null;
    const next = existing.map(b => {
      if (b.batchNumber !== batchNumber) return b;
      updated = { ...b, ...patch };
      return updated;
    });
    await this.writeFallbackSetting(`morajaws_imp_batches_${jobId}`, next);
    return updated;
  }

  async getBatches(jobId: string): Promise<ImportBatchSummary[]> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const { data, error } = await client
        .from('import_batches')
        .select('*')
        .eq('job_id', jobId)
        .order('batch_number', { ascending: true });
      if (!error && Array.isArray(data)) {
        return data.map(dbRowToBatch);
      }
    }
    return await this.readFallbackSetting<ImportBatchSummary[]>(`morajaws_imp_batches_${jobId}`, []);
  }

  async upsertStagingRows(rows: InternalStagingRow[]): Promise<void> {
    if (rows.length === 0) return;
    const jobId = rows[0].jobId;
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map(r => ({
          id: r.id,
          job_id: r.jobId,
          batch_number: r.batchNumber,
          row_number: r.rowNumber,
          wo_number: r.woNumber,
          raw_payload: r.rawPayload,
          normalized_payload: r.normalizedPayload,
          validation_status: r.validationStatus,
          processing_status: r.processingStatus,
          error_code: r.errorCode || null,
          error_message: r.errorMessage || null,
          created_at: r.createdAt,
          processed_at: r.processedAt || null
        }));
        const { error } = await client
          .from('import_staging_rows')
          .upsert(chunk, { onConflict: 'job_id,row_number' });
        if (error) {
          throw new Error(`Staging insert error: ${error.message}`);
        }
      }
      return;
    }

    // Group fallback staging rows by batchNumber to keep each app_settings entry small (< 1MB)
    const grouped = new Map<number, InternalStagingRow[]>();
    for (const r of rows) {
      const bNo = r.batchNumber ?? 0;
      if (!grouped.has(bNo)) grouped.set(bNo, []);
      grouped.get(bNo)!.push(r);
    }
    for (const [bNo, list] of grouped.entries()) {
      const key = `morajaws_imp_stg_${jobId}_b${bNo}`;
      const existing = await this.readFallbackSetting<InternalStagingRow[]>(key, []);
      const rowMap = new Map<number, InternalStagingRow>();
      existing.forEach(item => rowMap.set(item.rowNumber, item));
      list.forEach(item => rowMap.set(item.rowNumber, item));
      await this.writeFallbackSetting(
        key,
        Array.from(rowMap.values()).sort((a, b) => a.rowNumber - b.rowNumber)
      );
    }
  }

  async getStagingRows(jobId: string, opts?: { batchNumber?: number }): Promise<InternalStagingRow[]> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const out: InternalStagingRow[] = [];
      let offset = 0;
      const pageSize = 500;
      while (true) {
        let q = client
          .from('import_staging_rows')
          .select('*')
          .eq('job_id', jobId)
          .order('row_number', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (typeof opts?.batchNumber === 'number') {
          q = q.eq('batch_number', opts.batchNumber);
        }
        const { data, error } = await q;
        if (error) throw new Error(`Read staging rows error: ${error.message}`);
        if (!data || data.length === 0) break;
        out.push(...data.map(dbRowToStaging));
        if (data.length < pageSize) break;
        offset += pageSize;
      }
      return out;
    }

    if (typeof opts?.batchNumber === 'number') {
      return await this.readFallbackSetting<InternalStagingRow[]>(
        `morajaws_imp_stg_${jobId}_b${opts.batchNumber}`,
        []
      );
    }

    const batches = await this.getBatches(jobId);
    const all: InternalStagingRow[] = [];
    const batchNums = Array.from(new Set([0, ...batches.map(b => b.batchNumber)]));
    for (const bNo of batchNums) {
      const part = await this.readFallbackSetting<InternalStagingRow[]>(`morajaws_imp_stg_${jobId}_b${bNo}`, []);
      all.push(...part);
    }
    return all.sort((a, b) => a.rowNumber - b.rowNumber);
  }

  async updateStagingRows(rows: InternalStagingRow[]): Promise<void> {
    await this.upsertStagingRows(rows);
  }

  async appendRowErrors(errors: ImportRowErrorRecord[]): Promise<void> {
    if (errors.length === 0) return;
    const jobId = errors[0].jobId;
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      for (let i = 0; i < errors.length; i += 200) {
        const chunk = errors.slice(i, i + 200).map(e => ({
          id: e.id,
          job_id: e.jobId,
          batch_number: e.batchNumber ?? null,
          row_number: e.rowNumber,
          wo_number: e.woNumber || null,
          error_code: e.errorCode,
          error_message: e.errorMessage,
          raw_payload: e.rawPayload || {},
          created_at: e.createdAt
        }));
        await client.from('import_row_errors').insert(chunk);
      }
      return;
    }

    const key = `morajaws_imp_err_${jobId}`;
    const existing = await this.readFallbackSetting<ImportRowErrorRecord[]>(key, []);
    const seen = new Set(existing.map(e => `${e.rowNumber}:${e.errorCode}`));
    const merged = [...existing];
    for (const err of errors) {
      const k = `${err.rowNumber}:${err.errorCode}`;
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(err);
      }
    }
    await this.writeFallbackSetting(key, merged.slice(0, 5000));
  }

  async getRowErrors(jobId: string, limit = 1000, offset = 0): Promise<ImportRowErrorRecord[]> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const { data, error } = await client
        .from('import_row_errors')
        .select('*')
        .eq('job_id', jobId)
        .order('row_number', { ascending: true })
        .range(offset, offset + limit - 1);
      if (!error && Array.isArray(data)) {
        return data.map(dbRowToError);
      }
    }
    const existing = await this.readFallbackSetting<ImportRowErrorRecord[]>(`morajaws_imp_err_${jobId}`, []);
    return existing.sort((a, b) => a.rowNumber - b.rowNumber).slice(offset, offset + limit);
  }

  async upsertHistory(record: ImportHistoryRecord): Promise<void> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const { error } = await client.from('import_history').upsert(
        [
          {
            id: record.id,
            job_id: record.jobId,
            import_name: record.importName || null,
            source_file: record.sourceFile || null,
            imported_by: record.importedBy,
            imported_by_id: record.importedById || null,
            total_rows: record.totalRows,
            success_count: record.successCount,
            duplicate_count: record.duplicateCount,
            failed_count: record.failedCount,
            status: record.status,
            duration_ms: record.durationMs ?? null,
            created_at: record.createdAt
          }
        ],
        { onConflict: 'job_id' }
      );
      if (!error) return;
    }

    const existing = await this.readFallbackSetting<ImportHistoryRecord[]>('morajaws_imp_history_list', []);
    const next = [record, ...existing.filter(h => h.jobId !== record.jobId)].slice(0, 100);
    await this.writeFallbackSetting('morajaws_imp_history_list', next, record.importedBy);
  }

  async listHistory(limit = 50): Promise<ImportHistoryRecord[]> {
    const client = getSupabaseBackendClient();
    if (client && (await this.isRelationalSchemaReady())) {
      const { data, error } = await client
        .from('import_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!error && Array.isArray(data)) {
        return data.map(dbRowToHistory);
      }
    }
    const existing = await this.readFallbackSetting<ImportHistoryRecord[]>('morajaws_imp_history_list', []);
    return existing.slice(0, limit);
  }

  async findExistingWoNumbers(candidates: Array<{ normWo: string; rawTrimmed: string }>): Promise<Set<string>> {
    const existingSet = new Set<string>();
    const client = getSupabaseBackendClient();
    if (!client || candidates.length === 0) return existingSet;

    const chunkSize = 150;
    for (let i = 0; i < candidates.length; i += chunkSize) {
      const slice = candidates.slice(i, i + chunkSize);
      const woList = Array.from(
        new Set(slice.flatMap(c => [c.normWo, c.rawTrimmed, c.rawTrimmed.toUpperCase()]).filter(Boolean))
      );
      if (woList.length === 0) continue;

      const { data, error } = await client
        .from('work_orders')
        .select('wo_number')
        .in('wo_number', woList);

      if (error) {
        const classified = classifySupabaseError(error, { table: 'work_orders', operation: 'duplicate_check' });
        throw new Error(classified.message);
      }

      (data || []).forEach((r: any) => {
        const key = canonicalWoKey(r.wo_number);
        if (key) existingSet.add(key);
      });
    }

    return existingSet;
  }

  async commitWorkOrderBatch(params: {
    rows: Record<string, any>[];
    duplicatePolicy: 'skip' | 'update_allowed';
    batchId: string;
    importedBy: string;
  }): Promise<WorkOrderCommitResult> {
    const client = getSupabaseBackendClient();
    if (!client) {
      throw new Error('Supabase client belum dikonfigurasi pada server.');
    }

    const out: WorkOrderCommitResult = {
      insertedWoNumbers: [],
      updatedWoNumbers: [],
      duplicateWoNumbers: [],
      failedRows: []
    };

    const chunkSize = 100;
    for (let i = 0; i < params.rows.length; i += chunkSize) {
      const slice = params.rows.slice(i, i + chunkSize);
      const candidates = slice.map(r => {
        const normWo = normalizeWoNumber(r.woNumber || r.workOrderNumber);
        const rawTrimmed = String(r.woNumber || r.workOrderNumber || '').trim();
        return { normWo, rawTrimmed, row: r };
      });

      const existingKeys = await this.findExistingWoNumbers(candidates);
      const freshDbRows: Record<string, any>[] = [];
      const updateCandidates: Array<{ normWo: string; data: Record<string, any> }> = [];

      for (const item of candidates) {
        const key = canonicalWoKey(item.normWo);
        if (!item.normWo || !key) {
          out.failedRows.push({ woNumber: '', errorCode: 'INVALID_WO', errorMessage: 'Nomor WO kosong' });
          continue;
        }
        if (PROTECTED_PRODUCTION_WO_IDS.has(item.normWo)) {
          out.duplicateWoNumbers.push(item.normWo);
          continue;
        }
        if (existingKeys.has(key)) {
          if (params.duplicatePolicy === 'update_allowed') {
            updateCandidates.push({ normWo: item.normWo, data: item.row });
          } else {
            out.duplicateWoNumbers.push(item.normWo);
          }
          continue;
        }

        freshDbRows.push(
          ticketToPostgresRow({
            ...item.row,
            woNumber: item.normWo,
            workOrderNumber: item.normWo,
            importBatchId: params.batchId,
            importedAt: item.row.importedAt || new Date().toISOString(),
            updatedBy: params.importedBy || 'Import'
          })
        );
      }

      if (freshDbRows.length > 0) {
        const { error: insertErr } = await client.from('work_orders').insert(freshDbRows);
        if (!insertErr) {
          freshDbRows.forEach(r => out.insertedWoNumbers.push(String(r.wo_number)));
        } else {
          const classified = classifySupabaseError(insertErr, { table: 'work_orders', operation: 'batch_insert' });
          if (classified.isUnavailable) {
            throw new Error(classified.message);
          }
          // Isolate conflicting/invalid rows cleanly
          for (const single of freshDbRows) {
            const { error: sErr } = await client.from('work_orders').insert([single]);
            if (!sErr) {
              out.insertedWoNumbers.push(String(single.wo_number));
            } else {
              const sClass = classifySupabaseError(sErr, { table: 'work_orders', operation: 'single_insert' });
              if (sClass.isDuplicate || sClass.code === '23505') {
                if (params.duplicatePolicy === 'update_allowed') {
                  updateCandidates.push({
                    normWo: String(single.wo_number),
                    data: candidates.find(c => c.normWo === single.wo_number)?.row || {}
                  });
                } else {
                  out.duplicateWoNumbers.push(String(single.wo_number));
                }
              } else {
                out.failedRows.push({
                  woNumber: String(single.wo_number),
                  errorCode: sClass.code || 'DB_INSERT_ERROR',
                  errorMessage: sClass.message
                });
              }
            }
          }
        }
      }

      for (const upd of updateCandidates) {
        const safeUpdate: Record<string, any> = {
          updated_at: new Date().toISOString(),
          updated_by: params.importedBy || 'ImportUpdate'
        };
        if (upd.data.appointmentDate) safeUpdate.appointment_date = toDateOnlyString(upd.data.appointmentDate);
        if (upd.data.slotTime) safeUpdate.slot_time = String(upd.data.slotTime).trim();
        if (upd.data.customerPhone) safeUpdate.customer_phone = String(upd.data.customerPhone).trim();
        if (upd.data.streetName) safeUpdate.street_name = String(upd.data.streetName).trim();
        if (upd.data.clusterName) safeUpdate.cluster_name = String(upd.data.clusterName).trim();
        if (upd.data.area) safeUpdate.area = String(upd.data.area).trim();
        if (upd.data.contactorName || upd.data.contractorName) {
          const cVal = String(upd.data.contractorName || upd.data.contactorName).trim();
          safeUpdate.contractor_name = cVal;
          safeUpdate.contactor_name = cVal;
        }
        if (upd.data.fatCode) safeUpdate.fat_code = String(upd.data.fatCode).trim();
        if (upd.data.fdtCode) safeUpdate.fdt_code = String(upd.data.fdtCode).trim();
        if (upd.data.leaderId) safeUpdate.leader_name = upd.data.leaderName || null;

        const { error: updErr } = await client
          .from('work_orders')
          .update(safeUpdate)
          .eq('wo_number', upd.normWo);

        if (updErr) {
          out.failedRows.push({
            woNumber: upd.normWo,
            errorCode: 'DB_UPDATE_ERROR',
            errorMessage: updErr.message
          });
        } else {
          out.updatedWoNumbers.push(upd.normWo);
        }
      }
    }

    return out;
  }

  async getAuthUsersAndContractors(): Promise<{ users: any[]; contractors: any[] }> {
    const client = getSupabaseBackendClient();
    if (!client) return { users: [], contractors: [] };
    try {
      const [uRes, cRes] = await Promise.all([
        client.from('users').select('id, name, role, contractor, contractor_id, area, phone, active, is_deleted').eq('is_deleted', false),
        client.from('contractors').select('id, name, code, leader_id, leader_name, active, is_archived')
      ]);
      const users = (uRes.data || []).map((u: any) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        contractor: u.contractor,
        contractorId: u.contractor_id,
        area: u.area,
        phone: u.phone,
        active: u.active !== false,
        isDeleted: Boolean(u.is_deleted)
      }));
      const contractors = (cRes.data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        leaderId: c.leader_id,
        leaderName: c.leader_name,
        active: c.active !== false,
        isArchived: Boolean(c.is_archived)
      }));
      return { users, contractors };
    } catch {
      return { users: [], contractors: [] };
    }
  }
}

// ==============================================================================
// ENTERPRISE ASYNCHRONOUS BATCH IMPORT ENGINE
// ==============================================================================
export class EnterpriseImportEngine {
  private store: ImportPersistenceStore;
  private hooks: EnterpriseImportHooks;
  private activeBatchLocks = new Set<string>();

  constructor(store?: ImportPersistenceStore, hooks?: EnterpriseImportHooks) {
    this.store = store || new ProductionImportStore();
    this.hooks = hooks || {};
  }

  async createImportJob(
    params: {
      importName?: string;
      sourceFile: string;
      sourceFormat?: string;
      templateType?: ImportTemplateType | string;
      duplicatePolicy?: 'skip' | 'update_allowed';
      autoRegisterContractors?: boolean;
      batchSize?: number;
      totalRows: number;
    },
    user: ImportOperatorUser
  ): Promise<ImportJobSummary> {
    const totalRows = Math.max(0, Math.floor(Number(params.totalRows) || 0));
    if (totalRows <= 0) {
      throw new Error('Jumlah baris totalRows harus lebih dari 0.');
    }
    if (totalRows > MAX_IMPORT_JOB_ROWS) {
      throw new Error(`Maksimum ${MAX_IMPORT_JOB_ROWS.toLocaleString()} baris per job impor untuk menjaga stabilitas sistem.`);
    }

    const batchSize = clampBatchSize(params.batchSize);
    const totalBatches = Math.ceil(totalRows / batchSize);
    const now = new Date().toISOString();
    const jobId = makeId('impjob');

    const job: ImportJobSummary = enrichJobFlags({
      id: jobId,
      importName: (params.importName || params.sourceFile || `Import ${now.slice(0, 10)}`).trim(),
      sourceFile: (params.sourceFile || 'import_data.xlsx').trim(),
      sourceFormat: (params.sourceFormat || 'xlsx').trim().toLowerCase(),
      templateType: (params.templateType || 'CUSTOM') as ImportTemplateType,
      duplicatePolicy: params.duplicatePolicy === 'update_allowed' ? 'update_allowed' : 'skip',
      autoRegisterContractors: params.autoRegisterContractors !== false,
      batchSize,
      totalRows,
      stagedRows: 0,
      processedRows: 0,
      successfulRows: 0,
      updatedRows: 0,
      duplicateRows: 0,
      failedRows: 0,
      totalBatches,
      completedBatches: 0,
      currentBatch: 0,
      progressPercent: 0,
      status: 'staging',
      errorSummary: null,
      createdBy: user.name,
      createdById: user.id,
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      completedAt: null,
      cancelledAt: null
    });

    await this.store.createJob(job);

    const batches: ImportBatchSummary[] = [];
    for (let b = 1; b <= totalBatches; b++) {
      const startRow = (b - 1) * batchSize + 1;
      const endRow = Math.min(totalRows, b * batchSize);
      batches.push({
        id: `${jobId}_b${b}`,
        jobId,
        batchNumber: b,
        startRow,
        endRow,
        rowCount: endRow - startRow + 1,
        processedRows: 0,
        successfulRows: 0,
        duplicateRows: 0,
        failedRows: 0,
        status: 'pending',
        retryCount: 0,
        errorMessage: null,
        durationMs: null,
        startedAt: null,
        processedAt: null
      });
    }
    await this.store.upsertBatches(batches);

    return (await this.store.getJob(jobId)) || job;
  }

  /**
   * Validates and persists a staging slice (up to 500 rows per HTTP request).
   * Detects intra-job duplicates, database duplicates, invalid Customer IDs,
   * missing/invalid WO Numbers, invalid calendar Appointment Dates, and preserves
   * all unmapped fields + blank cells cleanly.
   */
  async stageJobRows(
    jobId: string,
    rows: StagedRowInput[],
    opts?: {
      startRowNumber?: number;
      validationMode?: 'strict' | 'standard';
    }
  ): Promise<{
    job: ImportJobSummary;
    stagedCount: number;
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
  }> {
    const job = await this.store.getJob(jobId);
    if (!job) throw new Error(`Import job "${jobId}" tidak ditemukan.`);
    if (job.status === 'cancelled') throw new Error('Import job telah dibatalkan dan tidak dapat menerima data staging.');
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Payload rows staging tidak boleh kosong.');
    }
    if (rows.length > MAX_STAGE_CHUNK_ROWS) {
      throw new Error(`Maksimal ${MAX_STAGE_CHUNK_ROWS} baris per request staging untuk mencegah payload overflow.`);
    }

    const existingStaged = await this.store.getStagingRows(jobId);
    const seenCanonicalInJob = new Set<string>(existingStaged.map(r => r.canonicalWo).filter(Boolean));
    const existingRowNums = new Set<number>(existingStaged.map(r => r.rowNumber));

    // Pre-extract WO candidates for batch DB duplicate lookup
    const normalizedCandidates: Array<{ normWo: string; rawTrimmed: string }> = [];
    for (const r of rows) {
      const m = r?.mapped && typeof r.mapped === 'object' ? r.mapped : r;
      const rawWoVal = m?.woNumber ?? m?.workOrderNumber ?? m?.wo_number ?? '';
      const rawTrimmed = (typeof rawWoVal === 'string' || typeof rawWoVal === 'number') ? String(rawWoVal).trim() : '';
      const normWo = normalizeWoNumber(rawWoVal);
      if (normWo) normalizedCandidates.push({ normWo, rawTrimmed });
    }
    const existingInDbSet = await this.store.findExistingWoNumbers(normalizedCandidates);

    const baseStart = opts?.startRowNumber ?? existingStaged.length + 1;
    const strictMode = opts?.validationMode !== 'standard' && job.templateType !== 'ASSIGNED_TEKNISI';
    const now = new Date().toISOString();

    const stagedBatch: InternalStagingRow[] = [];
    const validationErrorsToRecord: ImportRowErrorRecord[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const input = rows[i] || {};
      let rowNum = Number(input.rowNumber);
      if (!Number.isFinite(rowNum) || rowNum < 1) {
        rowNum = baseStart + i;
      }
      while (existingRowNums.has(rowNum)) {
        rowNum++;
      }
      existingRowNums.add(rowNum);

      const batchNumber = Math.min(job.totalBatches, Math.max(1, Math.ceil(rowNum / job.batchSize)));
      const rawPayload = input.raw && typeof input.raw === 'object' ? { ...input.raw } : { ...input };
      const mappedSrc = input.mapped && typeof input.mapped === 'object' ? { ...input.mapped } : { ...input };

      const rawWoVal = mappedSrc.woNumber ?? mappedSrc.workOrderNumber ?? mappedSrc.wo_number ?? '';
      const woStr = (typeof rawWoVal === 'string' || typeof rawWoVal === 'number') ? String(rawWoVal).trim() : '';
      const normWo = normalizeWoNumber(woStr);
      const canonWo = canonicalWoKey(normWo);

      let errCode = '';
      let errMsg = '';
      let validationStatus: InternalStagingRow['validationStatus'] = 'valid';
      let processingStatus: InternalStagingRow['processingStatus'] = 'pending';

      // 1. WO Number check
      if (!normWo || normWo.length < 3 || !/^[A-Z0-9._-]+$/i.test(normWo)) {
        validationStatus = 'invalid';
        processingStatus = 'failed';
        errCode = !normWo ? 'MISSING_WO_NUMBER' : 'INVALID_WO_NUMBER';
        errMsg = !normWo
          ? 'Nomor WO wajib diisi dan tidak boleh kosong.'
          : `Format Nomor WO "${woStr}" tidak valid.`;
      }

      // 2. Customer ID check (7 digits)
      const rawCustId = mappedSrc.idCustomer ?? mappedSrc.customerId ?? '';
      if (!errCode) {
        if (typeof rawCustId !== 'string' && typeof rawCustId !== 'number' && rawCustId !== undefined && rawCustId !== null) {
          validationStatus = 'invalid';
          processingStatus = 'failed';
          errCode = 'INVALID_CUSTOMER_ID_TYPE';
          errMsg = 'Customer ID harus berupa string atau angka 7 digit.';
        } else {
          const cleanCid = String(rawCustId ?? '').trim();
          if (!cleanCid && strictMode) {
            validationStatus = 'invalid';
            processingStatus = 'failed';
            errCode = 'MISSING_CUSTOMER_ID';
            errMsg = 'Customer ID wajib diisi (7 digit angka).';
          } else if (cleanCid && !/^\d{7}$/.test(cleanCid)) {
            validationStatus = 'invalid';
            processingStatus = 'failed';
            errCode = 'INVALID_CUSTOMER_ID_FORMAT';
            errMsg = `Customer ID "${cleanCid}" tidak valid (harus tepat 7 digit angka).`;
          }
        }
      }

      // 3. Appointment Date check
      const rawAppDate = mappedSrc.appointmentDate;
      let normalizedDate: string | null = null;
      if (!errCode) {
        const strDate = rawAppDate === null || rawAppDate === undefined ? '' : String(rawAppDate).trim();
        if (!strDate || strDate === '-' || strDate.toLowerCase() === 'null') {
          if (strictMode) {
            validationStatus = 'invalid';
            processingStatus = 'failed';
            errCode = 'MISSING_APPOINTMENT_DATE';
            errMsg = 'Appointment Date wajib diisi dengan tanggal kalender yang valid.';
          }
        } else {
          normalizedDate = toDateOnlyString(strDate);
          if (!normalizedDate) {
            validationStatus = 'invalid';
            processingStatus = 'failed';
            errCode = 'INVALID_APPOINTMENT_DATE';
            errMsg = `Appointment Date "${strDate}" tidak valid atau bukan tanggal kalender sah.`;
          }
        }
      }

      // 4. Contractor & Area check in strict mode
      const contractorVal = String(mappedSrc.contractorName || mappedSrc.contactorName || '').trim();
      const areaVal = String(mappedSrc.area || '').trim();
      if (!errCode && strictMode) {
        if (!contractorVal) {
          validationStatus = 'invalid';
          processingStatus = 'failed';
          errCode = 'MISSING_CONTRACTOR';
          errMsg = 'Nama Contractor / Vendor wajib diisi.';
        } else if (!areaVal) {
          validationStatus = 'invalid';
          processingStatus = 'failed';
          errCode = 'MISSING_AREA';
          errMsg = 'Area kerja wajib diisi.';
        }
      }

      // 5. Duplicate check (in-file first, then DB when duplicatePolicy === 'skip')
      if (!errCode) {
        if (seenCanonicalInJob.has(canonWo)) {
          validationStatus = 'duplicate';
          processingStatus = 'duplicate_skipped';
          errCode = 'DUPLICATE_IN_FILE';
          errMsg = `Nomor WO ${normWo} duplikat di dalam file/batch impor yang sama.`;
        } else {
          seenCanonicalInJob.add(canonWo);
          if (existingInDbSet.has(canonWo) && job.duplicatePolicy === 'skip') {
            validationStatus = 'duplicate';
            processingStatus = 'duplicate_skipped';
            errCode = 'DUPLICATE_EXISTING_DB';
            errMsg = `Nomor WO ${normWo} sudah terdaftar di database (dilewati sesuai kebijakan skip).`;
          }
        }
      }

      const normalizedPayload: Record<string, any> = {
        ...mappedSrc,
        woNumber: normWo || woStr,
        workOrderNumber: normWo || woStr,
        idCustomer: String(rawCustId ?? '').trim() || undefined,
        customerId: String(rawCustId ?? '').trim() || undefined,
        contractorName: contractorVal || undefined,
        contactorName: contractorVal || undefined,
        area: areaVal || undefined,
        appointmentDate: normalizedDate || undefined,
        fileName: mappedSrc.fileName || job.sourceFile,
        importDate: mappedSrc.importDate || new Date().toISOString().slice(0, 10),
        additionalFields:
          mappedSrc.additionalFields && typeof mappedSrc.additionalFields === 'object'
            ? mappedSrc.additionalFields
            : input.additionalFields && typeof input.additionalFields === 'object'
            ? input.additionalFields
            : {},
        unmappedHeaders: Array.isArray(mappedSrc.unmappedHeaders)
          ? mappedSrc.unmappedHeaders
          : Array.isArray(input.unmappedHeaders)
          ? input.unmappedHeaders
          : []
      };

      if (validationStatus === 'valid') validCount++;
      else if (validationStatus === 'duplicate') {
        duplicateCount++;
        validationErrorsToRecord.push({
          id: makeId('imperr'),
          jobId,
          batchNumber,
          rowNumber: rowNum,
          woNumber: normWo || woStr || null,
          errorCode: errCode || 'DUPLICATE_WO',
          errorMessage: errMsg,
          rawPayload,
          createdAt: now
        });
      } else {
        invalidCount++;
        validationErrorsToRecord.push({
          id: makeId('imperr'),
          jobId,
          batchNumber,
          rowNumber: rowNum,
          woNumber: normWo || woStr || null,
          errorCode: errCode || 'VALIDATION_ERROR',
          errorMessage: errMsg,
          rawPayload,
          createdAt: now
        });
      }

      stagedBatch.push({
        id: `${jobId}_r${rowNum}`,
        jobId,
        batchNumber,
        rowNumber: rowNum,
        woNumber: normWo || woStr,
        canonicalWo: canonWo,
        rawPayload,
        normalizedPayload,
        validationStatus,
        processingStatus,
        errorCode: errCode || null,
        errorMessage: errMsg || null,
        createdAt: now,
        processedAt: validationStatus === 'valid' ? null : now
      });
    }

    await this.store.upsertStagingRows(stagedBatch);
    if (validationErrorsToRecord.length > 0) {
      await this.store.appendRowErrors(validationErrorsToRecord);
    }

    // Recalculate job staging count accurately
    const allStagedAfter = await this.store.getStagingRows(jobId);
    const totalStagedNow = allStagedAfter.length;
    const isStagingComplete = totalStagedNow >= job.totalRows;

    const updatedJob = await this.store.updateJob(jobId, {
      stagedRows: totalStagedNow,
      totalRows: Math.max(job.totalRows, totalStagedNow),
      status: isStagingComplete && job.status === 'staging' ? 'queued' : job.status
    });

    return {
      job: updatedJob || job,
      stagedCount: stagedBatch.length,
      validCount,
      invalidCount,
      duplicateCount
    };
  }

  async startJob(jobId: string): Promise<ImportJobSummary> {
    const job = await this.store.getJob(jobId);
    if (!job) throw new Error(`Import job "${jobId}" tidak ditemukan.`);
    if (job.status === 'cancelled') throw new Error('Import job sudah dibatalkan.');
    if (job.status === 'completed') return job;

    const updated = await this.store.updateJob(jobId, {
      status: 'processing',
      startedAt: job.startedAt || new Date().toISOString()
    });
    return updated || job;
  }

  /**
   * Idempotent single-batch execution step designed for chunked Vercel serverless
   * or Node.js background loop execution.
   * - Never re-processes batches already marked 'completed'.
   * - Stops safely if job is cancelled.
   * - Isolates row errors & transient batch errors cleanly.
   */
  async processNextBatch(
    jobId: string,
    user: ImportOperatorUser,
    opts?: { batchNumber?: number; retryFailed?: boolean }
  ): Promise<{
    job: ImportJobSummary;
    processedBatch: ImportBatchSummary | null;
    done: boolean;
  }> {
    if (this.activeBatchLocks.has(jobId)) {
      const current = await this.store.getJob(jobId);
      if (!current) throw new Error(`Import job "${jobId}" tidak ditemukan.`);
      return { job: current, processedBatch: null, done: current.status === 'completed' || current.status === 'cancelled' };
    }

    this.activeBatchLocks.add(jobId);
    try {
      const job = await this.store.getJob(jobId);
      if (!job) throw new Error(`Import job "${jobId}" tidak ditemukan.`);
      if (job.status === 'cancelled') {
        return { job, processedBatch: null, done: true };
      }

      const batches = await this.store.getBatches(jobId);
      let targetBatch: ImportBatchSummary | undefined;

      if (typeof opts?.batchNumber === 'number') {
        targetBatch = batches.find(b => b.batchNumber === opts.batchNumber);
      } else if (opts?.retryFailed) {
        targetBatch = batches.find(b => b.status === 'failed');
      } else {
        targetBatch = batches.find(b => b.status === 'pending' || b.status === 'processing');
      }

      if (!targetBatch) {
        const finalized = await this.recomputeAndFinalizeJob(jobId, user);
        return { job: finalized, processedBatch: null, done: true };
      }

      // Idempotency guard: never re-run a completed batch
      if (targetBatch.status === 'completed') {
        const currentJob = await this.recomputeAndFinalizeJob(jobId, user);
        const remaining = (await this.store.getBatches(jobId)).some(
          b => b.status === 'pending' || b.status === 'processing'
        );
        return { job: currentJob, processedBatch: targetBatch, done: !remaining };
      }

      const batchStartMs = Date.now();
      const startedAtIso = new Date().toISOString();
      const nextRetryCount = targetBatch.status === 'failed' ? targetBatch.retryCount + 1 : targetBatch.retryCount;

      await this.store.updateJob(jobId, {
        status: 'processing',
        startedAt: job.startedAt || startedAtIso,
        currentBatch: targetBatch.batchNumber
      });
      await this.store.updateBatch(jobId, targetBatch.batchNumber, {
        status: 'processing',
        retryCount: nextRetryCount,
        startedAt: startedAtIso,
        errorMessage: null
      });

      const batchRows = await this.store.getStagingRows(jobId, { batchNumber: targetBatch.batchNumber });
      const { users, contractors } = await this.store.getAuthUsersAndContractors();

      const validPendingRows = batchRows.filter(
        r => r.validationStatus === 'valid' && (r.processingStatus === 'pending' || r.processingStatus === 'failed')
      );
      const alreadyDupCount = batchRows.filter(r => r.validationStatus === 'duplicate').length;
      const alreadyInvalidCount = batchRows.filter(r => r.validationStatus === 'invalid').length;

      const enrichedObjects: Record<string, any>[] = validPendingRows.map(r => {
        const t = { ...r.normalizedPayload };
        const dist = resolveLeaderForWorkOrder(t, users, contractors);
        return {
          ...t,
          woNumber: r.woNumber,
          workOrderNumber: r.woNumber,
          contractorId: dist.contractorId || t.contractorId || undefined,
          contractorName: dist.contractorName || t.contractorName || t.contactorName || '',
          contactorName: dist.contactorName || t.contactorName || t.contractorName || '',
          leaderId: dist.matched ? dist.leaderId : undefined,
          leaderName: dist.matched ? dist.leaderName : undefined,
          leaderContact: dist.matched ? dist.leaderContact : undefined,
          corlapName: dist.matched ? dist.corlapName : '',
          distributionStatus: dist.distributionStatus,
          distributionNotes: dist.distributionNotes
        };
      });

      let batchSuccess = 0;
      let batchUpdated = 0;
      let batchDup = alreadyDupCount;
      let batchFailed = alreadyInvalidCount;
      let batchErrorMsg: string | null = null;
      let batchFinalStatus: ImportBatchStatus = 'completed';

      try {
        // Retry transient DB errors up to 2 times with short exponential backoff
        let commitRes: WorkOrderCommitResult | null = null;
        let lastErr: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            commitRes = await this.store.commitWorkOrderBatch({
              rows: enrichedObjects,
              duplicatePolicy: job.duplicatePolicy,
              batchId: `${jobId}_b${targetBatch.batchNumber}`,
              importedBy: user.name
            });
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err;
            await new Promise(res => setTimeout(res, 150 * (attempt + 1)));
          }
        }

        if (!commitRes || lastErr) {
          throw lastErr || new Error('Commit batch gagal.');
        }

        const insertedSet = new Set(commitRes.insertedWoNumbers.map(w => canonicalWoKey(w)));
        const updatedSet = new Set(commitRes.updatedWoNumbers.map(w => canonicalWoKey(w)));
        const dupSet = new Set(commitRes.duplicateWoNumbers.map(w => canonicalWoKey(w)));
        const failedMap = new Map<string, { errorCode: string; errorMessage: string }>();
        commitRes.failedRows.forEach(fr => {
          failedMap.set(canonicalWoKey(fr.woNumber), { errorCode: fr.errorCode, errorMessage: fr.errorMessage });
        });

        batchSuccess = commitRes.insertedWoNumbers.length;
        batchUpdated = commitRes.updatedWoNumbers.length;
        batchDup += commitRes.duplicateWoNumbers.length;
        batchFailed += commitRes.failedRows.length;

        const nowIso = new Date().toISOString();
        const rowUpdates: InternalStagingRow[] = [];
        const newRowErrors: ImportRowErrorRecord[] = [];

        for (const sr of validPendingRows) {
          const key = canonicalWoKey(sr.woNumber);
          if (insertedSet.has(key) || updatedSet.has(key)) {
            rowUpdates.push({
              ...sr,
              processingStatus: 'succeeded',
              processedAt: nowIso
            });
          } else if (dupSet.has(key)) {
            rowUpdates.push({
              ...sr,
              processingStatus: 'duplicate_skipped',
              errorCode: 'DUPLICATE_CONFLICT',
              errorMessage: `Nomor WO ${sr.woNumber} sudah terdaftar di database.`,
              processedAt: nowIso
            });
            newRowErrors.push({
              id: makeId('imperr'),
              jobId,
              batchNumber: targetBatch.batchNumber,
              rowNumber: sr.rowNumber,
              woNumber: sr.woNumber,
              errorCode: 'DUPLICATE_CONFLICT',
              errorMessage: `Nomor WO ${sr.woNumber} sudah terdaftar di database.`,
              rawPayload: sr.rawPayload,
              createdAt: nowIso
            });
          } else {
            const failInfo = failedMap.get(key) || {
              errorCode: 'COMMIT_FAILED',
              errorMessage: `Baris WO ${sr.woNumber} gagal disimpan ke database.`
            };
            rowUpdates.push({
              ...sr,
              processingStatus: 'failed',
              errorCode: failInfo.errorCode,
              errorMessage: failInfo.errorMessage,
              processedAt: nowIso
            });
            newRowErrors.push({
              id: makeId('imperr'),
              jobId,
              batchNumber: targetBatch.batchNumber,
              rowNumber: sr.rowNumber,
              woNumber: sr.woNumber,
              errorCode: failInfo.errorCode,
              errorMessage: failInfo.errorMessage,
              rawPayload: sr.rawPayload,
              createdAt: nowIso
            });
          }
        }

        if (rowUpdates.length > 0) await this.store.updateStagingRows(rowUpdates);
        if (newRowErrors.length > 0) await this.store.appendRowErrors(newRowErrors);

        // Emit realtime/notification hook for newly inserted tickets in this batch
        if ((batchSuccess > 0 || batchUpdated > 0) && this.hooks.onWorkOrdersCommitted) {
          const committedTickets = enrichedObjects.filter(o => {
            const k = canonicalWoKey(o.woNumber);
            return insertedSet.has(k) || updatedSet.has(k);
          });
          await Promise.resolve(
            this.hooks.onWorkOrdersCommitted({
              jobId,
              batchNumber: targetBatch.batchNumber,
              importedCount: batchSuccess,
              updatedCount: batchUpdated,
              committedTickets,
              users,
              user
            })
          ).catch(() => {});
        }
      } catch (batchErr: any) {
        batchFinalStatus = 'failed';
        batchErrorMsg = batchErr?.message || `Batch #${targetBatch.batchNumber} gagal diproses.`;
        batchFailed = validPendingRows.length + alreadyInvalidCount;

        const nowIso = new Date().toISOString();
        const failedUpdates = validPendingRows.map(sr => ({
          ...sr,
          processingStatus: 'failed' as const,
          errorCode: 'BATCH_COMMIT_FAILED',
          errorMessage: batchErrorMsg!,
          processedAt: nowIso
        }));
        if (failedUpdates.length > 0) {
          await this.store.updateStagingRows(failedUpdates);
        }
      }

      const durationMs = Math.max(1, Date.now() - batchStartMs);
      const processedBatch = await this.store.updateBatch(jobId, targetBatch.batchNumber, {
        status: batchFinalStatus,
        processedRows: batchRows.length,
        successfulRows: batchSuccess + batchUpdated,
        duplicateRows: batchDup,
        failedRows: batchFailed,
        errorMessage: batchErrorMsg,
        durationMs,
        processedAt: new Date().toISOString()
      });

      const updatedJob = await this.recomputeAndFinalizeJob(jobId, user);
      const nextBatches = await this.store.getBatches(jobId);
      const hasMorePending = nextBatches.some(b => b.status === 'pending' || b.status === 'processing');

      return {
        job: updatedJob,
        processedBatch: processedBatch || targetBatch,
        done: !hasMorePending
      };
    } finally {
      this.activeBatchLocks.delete(jobId);
    }
  }

  private async recomputeAndFinalizeJob(jobId: string, user: ImportOperatorUser): Promise<ImportJobSummary> {
    const currentJob = await this.store.getJob(jobId);
    if (!currentJob) throw new Error(`Import job "${jobId}" tidak ditemukan.`);
    const batches = await this.store.getBatches(jobId);
    const stagingRows = await this.store.getStagingRows(jobId);

    const completedBatches = batches.filter(b => b.status === 'completed').length;
    const failedBatches = batches.filter(b => b.status === 'failed').length;
    const pendingBatches = batches.filter(b => b.status === 'pending' || b.status === 'processing').length;

    let processedRows = 0;
    let successfulRows = 0;
    let duplicateRows = 0;
    let failedRows = 0;

    if (stagingRows.length > 0) {
      for (const r of stagingRows) {
        if (r.processingStatus === 'succeeded') {
          processedRows++;
          successfulRows++;
        } else if (r.processingStatus === 'duplicate_skipped') {
          processedRows++;
          duplicateRows++;
        } else if (r.processingStatus === 'failed') {
          processedRows++;
          failedRows++;
        } else if (r.processingStatus === 'cancelled') {
          processedRows++;
        }
      }
    } else {
      for (const b of batches) {
        if (b.status === 'completed' || b.status === 'failed') {
          processedRows += b.processedRows;
          successfulRows += b.successfulRows;
          duplicateRows += b.duplicateRows;
          failedRows += b.failedRows;
        }
      }
    }

    let nextStatus: ImportJobStatus = currentJob.status;
    let completedAt = currentJob.completedAt;
    let errorSummary = currentJob.errorSummary || null;

    if (currentJob.status === 'cancelled') {
      nextStatus = 'cancelled';
    } else if (pendingBatches === 0) {
      completedAt = completedAt || new Date().toISOString();
      if (failedBatches > 0 && successfulRows === 0) {
        nextStatus = 'failed';
        const firstErr = batches.find(b => b.status === 'failed')?.errorMessage;
        errorSummary = firstErr || `${failedBatches} batch gagal diproses.`;
      } else if (failedBatches > 0 || failedRows > 0) {
        nextStatus = 'completed_with_errors';
        errorSummary = `${failedRows} baris tidak valid/gagal diproses (${failedBatches} batch error).`;
      } else {
        nextStatus = 'completed';
        errorSummary = null;
      }
    } else {
      nextStatus = 'processing';
    }

    const updated =
      (await this.store.updateJob(jobId, {
        processedRows,
        successfulRows,
        duplicateRows,
        failedRows,
        completedBatches,
        status: nextStatus,
        errorSummary,
        completedAt
      })) || currentJob;

    // Write permanent import_history ledger once all pending batches finish
    if (
      pendingBatches === 0 &&
      (nextStatus === 'completed' || nextStatus === 'completed_with_errors' || nextStatus === 'failed')
    ) {
      const durationMs = updated.startedAt
        ? Math.max(1, Date.parse(completedAt || new Date().toISOString()) - Date.parse(updated.startedAt))
        : null;
      const historyRecord: ImportHistoryRecord = {
        id: `imphist_${jobId}`,
        jobId,
        importName: updated.importName,
        sourceFile: updated.sourceFile,
        importedBy: updated.createdBy,
        importedById: updated.createdById || null,
        totalRows: updated.totalRows,
        successCount: successfulRows,
        duplicateCount: duplicateRows,
        failedCount: failedRows,
        status: nextStatus,
        durationMs,
        createdAt: new Date().toISOString()
      };
      await this.store.upsertHistory(historyRecord);

      if (this.hooks.onJobFinalized) {
        await Promise.resolve(
          this.hooks.onJobFinalized({ job: updated, history: historyRecord, user })
        ).catch(() => {});
      }
    }

    return updated;
  }

  /**
   * Re-queues ONLY failed batches without reprocessing already completed batches.
   */
  async retryFailedBatches(jobId: string, user: ImportOperatorUser): Promise<ImportJobSummary> {
    const job = await this.store.getJob(jobId);
    if (!job) throw new Error(`Import job "${jobId}" tidak ditemukan.`);
    if (job.status === 'cancelled') throw new Error('Import job sudah dibatalkan dan tidak dapat di-retry.');

    const batches = await this.store.getBatches(jobId);
    const failedBatches = batches.filter(b => b.status === 'failed');
    if (failedBatches.length === 0) {
      return job;
    }

    for (const fb of failedBatches) {
      await this.store.updateBatch(jobId, fb.batchNumber, {
        status: 'pending',
        retryCount: (fb.retryCount || 0) + 1,
        errorMessage: null
      });
      const batchRows = await this.store.getStagingRows(jobId, { batchNumber: fb.batchNumber });
      const resetRows = batchRows
        .filter(r => r.validationStatus === 'valid' && r.processingStatus === 'failed')
        .map(r => ({
          ...r,
          processingStatus: 'pending' as const,
          errorCode: null,
          errorMessage: null,
          processedAt: null
        }));
      if (resetRows.length > 0) {
        await this.store.updateStagingRows(resetRows);
      }
    }

    const updated = await this.store.updateJob(jobId, {
      status: 'processing',
      completedAt: null,
      errorSummary: null
    });

    const refreshed = updated || (await this.store.getJob(jobId))!;
    void user;
    return refreshed;
  }

  /**
   * Safely cancels pending/processing batches while preserving any already committed batches.
   */
  async cancelImportJob(jobId: string, user: ImportOperatorUser): Promise<ImportJobSummary> {
    const job = await this.store.getJob(jobId);
    if (!job) throw new Error(`Import job "${jobId}" tidak ditemukan.`);
    if (job.status === 'completed') return job;

    const batches = await this.store.getBatches(jobId);
    const nowIso = new Date().toISOString();

    for (const b of batches) {
      if (b.status === 'pending' || b.status === 'processing') {
        await this.store.updateBatch(jobId, b.batchNumber, {
          status: 'cancelled',
          processedAt: nowIso
        });
      }
    }

    const updated =
      (await this.store.updateJob(jobId, {
        status: 'cancelled',
        cancelledAt: nowIso
      })) || job;

    const historyRecord: ImportHistoryRecord = {
      id: `imphist_${jobId}`,
      jobId,
      importName: updated.importName,
      sourceFile: updated.sourceFile,
      importedBy: user.name || updated.createdBy,
      importedById: user.id || updated.createdById || null,
      totalRows: updated.totalRows,
      successCount: updated.successfulRows,
      duplicateCount: updated.duplicateRows,
      failedCount: updated.failedRows,
      status: 'cancelled',
      durationMs: updated.startedAt ? Math.max(1, Date.now() - Date.parse(updated.startedAt)) : null,
      createdAt: nowIso
    };
    await this.store.upsertHistory(historyRecord);

    return (await this.store.getJob(jobId)) || updated;
  }

  async listImportJobs(limit = 30): Promise<ImportJobSummary[]> {
    return this.store.listJobs(limit);
  }

  async getImportJobDetail(jobId: string): Promise<ImportJobSummary | null> {
    return this.store.getJob(jobId);
  }

  async getImportJobErrors(jobId: string, limit = 1000, offset = 0): Promise<ImportRowErrorRecord[]> {
    return this.store.getRowErrors(jobId, limit, offset);
  }

  async formatJobErrorsCsv(jobId: string): Promise<string> {
    const errors = await this.store.getRowErrors(jobId, 5000, 0);
    const esc = (v: unknown) => {
      const s = String(v ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };
    const header = ['Row Number', 'Batch Number', 'WO Number', 'Error Code', 'Error Message', 'Created At'].join(',');
    const lines = errors.map(e =>
      [
        esc(e.rowNumber),
        esc(e.batchNumber ?? ''),
        esc(e.woNumber ?? ''),
        esc(e.errorCode),
        esc(e.errorMessage),
        esc(e.createdAt)
      ].join(',')
    );
    return [header, ...lines].join('\n');
  }

  async listImportHistory(limit = 50): Promise<ImportHistoryRecord[]> {
    return this.store.listHistory(limit);
  }
}
