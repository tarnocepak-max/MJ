import crypto from 'crypto';
import { getSupabaseBackendClient } from './supabaseClient.ts';
import {
  canonicalWoKey,
  classifySupabaseError,
  normalizeWoNumber,
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
export const MAX_STAGING_ROW_BYTES = 65536;
export const DEFAULT_BATCH_LOCK_TTL_SECONDS = 120;
export const ALLOWED_IMPORT_TEMPLATE_TYPES = new Set([
  'BASE_DATA_WO',
  'WO_KORLAP',
  'INSTALLER_WO',
  'ASSIGNED_TEKNISI',
  'CUSTOM',
  'TEXT_TO_TABLE',
  'XLSX',
  'CSV',
  'JSON'
]);

export class ImportServiceError extends Error {
  code: string;
  statusCode: number;
  retryable: boolean;

  constructor(message: string, code = 'IMPORT_ERROR', statusCode = 400, retryable = false) {
    super(message);
    this.name = 'ImportServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

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

export interface ClaimBatchResult {
  claimed: boolean;
  reason:
    | 'CLAIMED'
    | 'JOB_NOT_FOUND'
    | 'JOB_CANCELLED'
    | 'JOB_ALREADY_COMPLETED'
    | 'STAGING_INCOMPLETE'
    | 'BATCH_LOCKED_BY_ANOTHER_WORKER'
    | 'NO_ELIGIBLE_BATCH';
  job: ImportJobSummary | null;
  batch: ImportBatchSummary | null;
}

export interface AtomicBatchCommitResult {
  job: ImportJobSummary;
  batch: ImportBatchSummary;
  insertedWoNumbers: string[];
  updatedWoNumbers: string[];
  duplicateWoNumbers: string[];
  failedRows: Array<{ woNumber: string; errorCode: string; errorMessage: string }>;
  hasMorePending: boolean;
  historyWritten: boolean;
  history: ImportHistoryRecord | null;
}

export interface AtomicBatchFailResult {
  job: ImportJobSummary;
  batch: ImportBatchSummary;
  hasMorePending: boolean;
  historyWritten: boolean;
  history: ImportHistoryRecord | null;
}

export interface ImportPersistenceStore {
  ensureSchemaReady?(): Promise<void>;
  createJob(job: ImportJobSummary, opts?: { clientRequestId?: string }): Promise<void>;
  findJobByClientRequestId?(clientRequestId: string): Promise<ImportJobSummary | null>;
  getJob(jobId: string): Promise<ImportJobSummary | null>;
  listJobs(limit?: number): Promise<ImportJobSummary[]>;
  upsertBatches(batches: ImportBatchSummary[]): Promise<void>;
  getBatches(jobId: string): Promise<ImportBatchSummary[]>;
  getStagingLookupIndex(jobId: string): Promise<{
    rowNumbers: Set<number>;
    canonicalWos: Set<string>;
    maxRowNumber: number;
  }>;
  upsertStagingRows(rows: InternalStagingRow[]): Promise<void>;
  getStagingRows(jobId: string, opts?: { batchNumber?: number }): Promise<InternalStagingRow[]>;
  syncStagedCount(jobId: string): Promise<ImportJobSummary | null>;
  clearRowErrorsForRows?(jobId: string, rowNumbers: number[]): Promise<void>;
  appendRowErrors(errors: ImportRowErrorRecord[]): Promise<void>;
  getRowErrors(jobId: string, limit?: number, offset?: number): Promise<ImportRowErrorRecord[]>;
  listHistory(limit?: number): Promise<ImportHistoryRecord[]>;
  findExistingWoNumbers(canonicalCandidates: Array<{ normWo: string; rawTrimmed: string }>): Promise<Set<string>>;
  getAuthUsersAndContractors(): Promise<{ users: any[]; contractors: any[] }>;
  startJobAtomic(jobId: string): Promise<ImportJobSummary>;
  claimNextBatch(params: {
    jobId: string;
    workerId: string;
    batchNumber?: number;
    retryFailed?: boolean;
    lockTtlSeconds?: number;
  }): Promise<ClaimBatchResult>;
  commitClaimedBatchAtomic(params: {
    jobId: string;
    batchNumber: number;
    workerId: string;
    woRows: Record<string, any>[];
    duplicatePolicy: 'skip' | 'update_allowed';
    durationMs: number;
    importedBy: string;
    importedById?: string | null;
  }): Promise<AtomicBatchCommitResult>;
  failClaimedBatchAtomic(params: {
    jobId: string;
    batchNumber: number;
    workerId: string;
    errorMessage: string;
    durationMs: number;
  }): Promise<AtomicBatchFailResult>;
  cancelJobAtomic(params: {
    jobId: string;
    cancelledBy: string;
    cancelledById?: string | null;
  }): Promise<ImportJobSummary>;
  retryFailedBatchesAtomic(jobId: string): Promise<ImportJobSummary>;
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
    duplicatePolicy: r.duplicate_policy === 'update_allowed' ? 'update_allowed' : 'skip',
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
    jobId: r.job_id || r.original_job_id || '',
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
// IN-MEMORY ISOLATED STORE (Strictly for unit/contract tests via explicit DI)
// NEVER instantiated by ProductionImportStore or Express production routes.
// ==============================================================================
interface InMemoryBatchState extends ImportBatchSummary {
  lockedBy?: string | null;
  lockedAt?: string | null;
  lockExpiresAt?: string | null;
  updatedRows?: number;
}

export function createInMemoryImportTestStore(options?: {
  initialWorkOrders?: Record<string, any>[];
  users?: any[];
  contractors?: any[];
  failBatchNumbersOnce?: Set<number>;
  alwaysFailBatchNumbers?: Set<number>;
  transientCommitFailuresLeft?: Map<number, number>;
  simulatedBatchDelayMs?: number;
  lockTtlMsOverride?: number;
}): ImportPersistenceStore & {
  workOrdersMap: Map<string, Record<string, any>>;
  getCommittedCount: () => number;
  expireLockForTest: (jobId: string, batchNumber: number) => void;
  deleteJobPreserveHistoryForTest: (jobId: string) => void;
} {
  const jobs = new Map<string, ImportJobSummary>();
  const clientRequestIndex = new Map<string, string>();
  const batchesMap = new Map<string, Map<number, InMemoryBatchState>>();
  const stagingMap = new Map<string, Map<number, InternalStagingRow>>();
  const errorsMap = new Map<string, ImportRowErrorRecord[]>();
  const historyMap = new Map<string, ImportHistoryRecord & { originalJobId?: string; jobIdOrNull: string | null }>();
  const workOrdersMap = new Map<string, Record<string, any>>();
  const failedOnceTracker = new Set<number>();

  for (const wo of options?.initialWorkOrders || []) {
    const key = canonicalWoKey(wo.woNumber || wo.wo_number);
    if (key) workOrdersMap.set(key, { ...wo });
  }

  const getSortedBatches = (jobId: string): ImportBatchSummary[] =>
    Array.from(batchesMap.get(jobId)?.values() || [])
      .sort((a, b) => a.batchNumber - b.batchNumber)
      .map(({ lockedBy: _lb, lockedAt: _la, lockExpiresAt: _le, updatedRows: _ur, ...rest }) => ({ ...rest }));

  return {
    workOrdersMap,
    getCommittedCount: () => workOrdersMap.size,
    expireLockForTest(jobId: string, batchNumber: number) {
      const b = batchesMap.get(jobId)?.get(batchNumber);
      if (b) {
        b.lockExpiresAt = new Date(Date.now() - 10_000).toISOString();
      }
    },
    deleteJobPreserveHistoryForTest(jobId: string) {
      jobs.delete(jobId);
      batchesMap.delete(jobId);
      stagingMap.delete(jobId);
      errorsMap.delete(jobId);
      const h = historyMap.get(jobId);
      if (h) {
        h.jobIdOrNull = null;
      }
    },

    async ensureSchemaReady() {
      return;
    },

    async createJob(job, opts) {
      jobs.set(job.id, { ...job });
      if (opts?.clientRequestId) {
        clientRequestIndex.set(opts.clientRequestId, job.id);
      }
    },

    async findJobByClientRequestId(clientRequestId) {
      const id = clientRequestIndex.get(clientRequestId);
      if (!id) return null;
      const j = jobs.get(id);
      if (!j || j.status === 'cancelled') return null;
      return enrichJobFlags(j, getSortedBatches(id));
    },

    async getJob(jobId) {
      const j = jobs.get(jobId);
      if (!j) return null;
      return enrichJobFlags(j, getSortedBatches(jobId));
    },

    async listJobs(limit = 30) {
      return Array.from(jobs.values())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map(j => enrichJobFlags(j, getSortedBatches(j.id)));
    },

    async upsertBatches(batches) {
      for (const b of batches) {
        if (!batchesMap.has(b.jobId)) batchesMap.set(b.jobId, new Map());
        batchesMap.get(b.jobId)!.set(b.batchNumber, { ...b, lockedBy: null, lockedAt: null, lockExpiresAt: null, updatedRows: 0 });
      }
    },

    async getBatches(jobId) {
      return getSortedBatches(jobId);
    },

    async getStagingLookupIndex(jobId) {
      const all = Array.from(stagingMap.get(jobId)?.values() || []);
      const rowNumbers = new Set<number>();
      const canonicalWos = new Set<string>();
      let maxRowNumber = 0;
      for (const r of all) {
        rowNumbers.add(r.rowNumber);
        if (r.rowNumber > maxRowNumber) maxRowNumber = r.rowNumber;
        if (r.canonicalWo) canonicalWos.add(r.canonicalWo);
      }
      return { rowNumbers, canonicalWos, maxRowNumber };
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

    async syncStagedCount(jobId) {
      const existing = jobs.get(jobId);
      if (!existing) return null;
      const stagedCount = stagingMap.get(jobId)?.size || 0;
      const next: ImportJobSummary = {
        ...existing,
        stagedRows: stagedCount,
        totalRows: Math.max(existing.totalRows, stagedCount),
        status: existing.status === 'staging' && stagedCount >= Math.max(existing.totalRows, 1) ? 'queued' : existing.status,
        updatedAt: new Date().toISOString()
      };
      jobs.set(jobId, next);
      return enrichJobFlags(next, getSortedBatches(jobId));
    },

    async clearRowErrorsForRows(jobId, rowNumbers) {
      if (rowNumbers.length === 0) return;
      const rowSet = new Set(rowNumbers);
      const list = errorsMap.get(jobId) || [];
      errorsMap.set(jobId, list.filter(e => !rowSet.has(e.rowNumber)));
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

    async listHistory(limit = 50) {
      return Array.from(historyMap.values())
        .map(({ originalJobId, jobIdOrNull, ...rest }) => ({
          ...rest,
          jobId: jobIdOrNull || originalJobId || rest.jobId
        }))
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

    async getAuthUsersAndContractors() {
      return {
        users: options?.users || [],
        contractors: options?.contractors || []
      };
    },

    async startJobAtomic(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new ImportServiceError(`Import job "${jobId}" tidak ditemukan.`, 'IMPORT_JOB_NOT_FOUND', 404);
      if (job.status === 'cancelled') throw new ImportServiceError('Import job sudah dibatalkan.', 'IMPORT_JOB_CANCELLED', 409);
      if (job.status === 'completed') return enrichJobFlags(job, getSortedBatches(jobId));
      if (job.status === 'staging' && job.stagedRows < Math.max(job.totalRows, 1)) {
        throw new ImportServiceError(
          `Staging belum lengkap (${job.stagedRows}/${job.totalRows} baris).`,
          'IMPORT_STAGING_INCOMPLETE',
          409
        );
      }
      const next: ImportJobSummary = {
        ...job,
        status: 'processing',
        startedAt: job.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      jobs.set(jobId, next);
      return enrichJobFlags(next, getSortedBatches(jobId));
    },

    async claimNextBatch({ jobId, workerId, batchNumber, retryFailed, lockTtlSeconds }) {
      const job = jobs.get(jobId);
      if (!job) return { claimed: false, reason: 'JOB_NOT_FOUND', job: null, batch: null };
      if (job.status === 'cancelled') return { claimed: false, reason: 'JOB_CANCELLED', job: enrichJobFlags(job, getSortedBatches(jobId)), batch: null };
      if (job.status === 'completed') return { claimed: false, reason: 'JOB_ALREADY_COMPLETED', job: enrichJobFlags(job, getSortedBatches(jobId)), batch: null };
      if (job.status === 'staging' && job.stagedRows < Math.max(job.totalRows, 1)) {
        return { claimed: false, reason: 'STAGING_INCOMPLETE', job: enrichJobFlags(job, getSortedBatches(jobId)), batch: null };
      }

      const nowMs = Date.now();
      const allBatches = Array.from(batchesMap.get(jobId)?.values() || []).sort((a, b) => a.batchNumber - b.batchNumber);
      const eligible = allBatches.find(b => {
        if (typeof batchNumber === 'number' && b.batchNumber !== batchNumber) return false;
        if (b.status === 'pending') return true;
        if (retryFailed && b.status === 'failed') return true;
        if (b.status === 'processing') {
          const exp = b.lockExpiresAt ? Date.parse(b.lockExpiresAt) : 0;
          return !exp || exp < nowMs;
        }
        return false;
      });

      if (!eligible) {
        const lockedByOther = allBatches.some(b => {
          if (typeof batchNumber === 'number' && b.batchNumber !== batchNumber) return false;
          if (b.status !== 'processing') return false;
          const exp = b.lockExpiresAt ? Date.parse(b.lockExpiresAt) : nowMs + 60_000;
          return exp >= nowMs;
        });
        return {
          claimed: false,
          reason: lockedByOther ? 'BATCH_LOCKED_BY_ANOTHER_WORKER' : 'NO_ELIGIBLE_BATCH',
          job: enrichJobFlags(job, getSortedBatches(jobId)),
          batch: null
        };
      }

      const nowIso = new Date(nowMs).toISOString();
      const ttlMs = options?.lockTtlMsOverride ?? (lockTtlSeconds || DEFAULT_BATCH_LOCK_TTL_SECONDS) * 1000;
      const wasStaleOrFailed =
        eligible.status === 'failed' ||
        (eligible.status === 'processing' && eligible.lockedBy !== workerId && Boolean(eligible.startedAt));

      eligible.status = 'processing';
      eligible.lockedBy = workerId;
      eligible.lockedAt = nowIso;
      eligible.lockExpiresAt = new Date(nowMs + ttlMs).toISOString();
      eligible.retryCount = wasStaleOrFailed ? eligible.retryCount + 1 : eligible.retryCount;
      eligible.startedAt = eligible.startedAt || nowIso;
      eligible.errorMessage = null;

      const updatedJob: ImportJobSummary = {
        ...job,
        status: 'processing',
        startedAt: job.startedAt || nowIso,
        currentBatch: eligible.batchNumber,
        updatedAt: nowIso
      };
      jobs.set(jobId, updatedJob);

      const { lockedBy: _lb, lockedAt: _la, lockExpiresAt: _le, updatedRows: _ur, ...cleanBatch } = eligible;
      return {
        claimed: true,
        reason: 'CLAIMED',
        job: enrichJobFlags(updatedJob, getSortedBatches(jobId)),
        batch: { ...cleanBatch }
      };
    },

    async commitClaimedBatchAtomic({ jobId, batchNumber, workerId, woRows, duplicatePolicy, durationMs, importedBy, importedById }) {
      if (options?.simulatedBatchDelayMs) {
        await new Promise(resolve => setTimeout(resolve, options.simulatedBatchDelayMs));
      }
      const job = jobs.get(jobId);
      if (!job) throw new ImportServiceError(`Import job "${jobId}" tidak ditemukan.`, 'IMPORT_JOB_NOT_FOUND', 404);
      if (job.status === 'cancelled') throw new ImportServiceError(`Job ${jobId} sudah dibatalkan.`, 'IMPORT_JOB_CANCELLED', 409);

      const batch = batchesMap.get(jobId)?.get(batchNumber);
      if (!batch) throw new ImportServiceError(`Batch #${batchNumber} tidak ditemukan.`, 'IMPORT_BATCH_NOT_FOUND', 404);
      if (batch.status === 'completed') throw new ImportServiceError(`Batch #${batchNumber} sudah completed.`, 'IMPORT_BATCH_ALREADY_COMPLETED', 409);
      if (batch.status !== 'processing' || batch.lockedBy !== workerId) {
        throw new ImportServiceError(`Lock batch #${batchNumber} telah hilang atau dipegang worker lain.`, 'IMPORT_BATCH_LOCK_LOST', 409);
      }

      const transientLeft = options?.transientCommitFailuresLeft?.get(batchNumber) ?? 0;
      if (transientLeft > 0) {
        options!.transientCommitFailuresLeft!.set(batchNumber, transientLeft - 1);
        throw new ImportServiceError(`Simulated transient failure on batch #${batchNumber}`, 'DATABASE_TRANSIENT_ERROR', 503, true);
      }
      if (options?.alwaysFailBatchNumbers?.has(batchNumber)) {
        throw new ImportServiceError(`Simulated persistent failure on batch #${batchNumber}`, 'DB_COMMIT_FAILED', 500, false);
      }
      if (options?.failBatchNumbersOnce?.has(batchNumber) && !failedOnceTracker.has(batchNumber)) {
        failedOnceTracker.add(batchNumber);
        throw new ImportServiceError(`Simulated persistent-once failure on batch #${batchNumber}`, 'DB_COMMIT_FAILED', 500, false);
      }

      const insertedWoNumbers: string[] = [];
      const updatedWoNumbers: string[] = [];
      const duplicateWoNumbers: string[] = [];
      const failedRows: Array<{ woNumber: string; errorCode: string; errorMessage: string }> = [];

      // Snapshot rollback barrier for atomic in-memory commit
      for (const row of woRows) {
        const normWo = normalizeWoNumber(row.wo_number || row.work_order_number || row.woNumber);
        const key = canonicalWoKey(normWo);
        if (!normWo || !key) {
          failedRows.push({ woNumber: '', errorCode: 'INVALID_WO', errorMessage: 'Nomor WO kosong' });
          continue;
        }
        if (workOrdersMap.has(key)) {
          const existingWo = workOrdersMap.get(key)!;
          if (
            Boolean(existingWo.isDeleted || existingWo.is_deleted) ||
            Boolean(existingWo.isArchived || existingWo.is_archived)
          ) {
            duplicateWoNumbers.push(normWo);
          } else if (duplicatePolicy === 'update_allowed') {
            workOrdersMap.set(key, { ...existingWo, ...row, updated_at: new Date().toISOString(), updated_by: importedBy });
            updatedWoNumbers.push(normWo);
          } else {
            duplicateWoNumbers.push(normWo);
          }
        } else {
          workOrdersMap.set(key, { ...row, wo_number: normWo, woNumber: normWo, id: row.id || `wo_${normWo}` });
          insertedWoNumbers.push(normWo);
        }
      }

      const nowIso = new Date().toISOString();
      const insertedSet = new Set(insertedWoNumbers.map(w => canonicalWoKey(w)));
      const updatedSet = new Set(updatedWoNumbers.map(w => canonicalWoKey(w)));
      const dupSet = new Set(duplicateWoNumbers.map(w => canonicalWoKey(w)));
      const failMap = new Map(failedRows.map(f => [canonicalWoKey(f.woNumber), f]));

      const batchStaging = Array.from(stagingMap.get(jobId)?.values() || []).filter(r => r.batchNumber === batchNumber);
      for (const sr of batchStaging) {
        if (sr.validationStatus !== 'valid' || !['pending', 'processing', 'failed'].includes(sr.processingStatus)) continue;
        const k = canonicalWoKey(sr.woNumber);
        if (insertedSet.has(k) || updatedSet.has(k)) {
          sr.processingStatus = 'succeeded';
          sr.errorCode = null;
          sr.errorMessage = null;
          sr.processedAt = nowIso;
        } else if (dupSet.has(k)) {
          sr.processingStatus = 'duplicate_skipped';
          sr.errorCode = 'DUPLICATE_CONFLICT';
          sr.errorMessage = `Nomor WO ${sr.woNumber} sudah terdaftar di database.`;
          sr.processedAt = nowIso;
          if (!errorsMap.has(jobId)) errorsMap.set(jobId, []);
          errorsMap.get(jobId)!.push({
            id: makeId('imperr'),
            jobId,
            batchNumber,
            rowNumber: sr.rowNumber,
            woNumber: sr.woNumber,
            errorCode: 'DUPLICATE_CONFLICT',
            errorMessage: sr.errorMessage,
            rawPayload: sr.rawPayload,
            createdAt: nowIso
          });
        } else {
          const fi = failMap.get(k) || { errorCode: 'COMMIT_FAILED', errorMessage: `Baris WO ${sr.woNumber} gagal disimpan.` };
          sr.processingStatus = 'failed';
          sr.errorCode = fi.errorCode;
          sr.errorMessage = fi.errorMessage;
          sr.processedAt = nowIso;
          if (!errorsMap.has(jobId)) errorsMap.set(jobId, []);
          errorsMap.get(jobId)!.push({
            id: makeId('imperr'),
            jobId,
            batchNumber,
            rowNumber: sr.rowNumber,
            woNumber: sr.woNumber,
            errorCode: fi.errorCode,
            errorMessage: fi.errorMessage,
            rawPayload: sr.rawPayload,
            createdAt: nowIso
          });
        }
      }

      const alreadyDup = batchStaging.filter(r => r.validationStatus === 'duplicate').length;
      const alreadyInv = batchStaging.filter(r => r.validationStatus === 'invalid').length;

      batch.status = 'completed';
      batch.processedRows = batchStaging.length;
      batch.successfulRows = insertedWoNumbers.length + updatedWoNumbers.length;
      batch.updatedRows = updatedWoNumbers.length;
      batch.duplicateRows = alreadyDup + duplicateWoNumbers.length;
      batch.failedRows = alreadyInv + failedRows.length;
      batch.errorMessage = null;
      batch.durationMs = Math.max(1, durationMs);
      batch.lockedBy = null;
      batch.lockedAt = null;
      batch.lockExpiresAt = null;
      batch.processedAt = nowIso;

      const allBatches = Array.from(batchesMap.get(jobId)?.values() || []);
      const allStaging = Array.from(stagingMap.get(jobId)?.values() || []);
      const completedBatches = allBatches.filter(b => b.status === 'completed').length;
      const failedBatches = allBatches.filter(b => b.status === 'failed').length;
      const pendingBatches = allBatches.filter(b => b.status === 'pending' || b.status === 'processing').length;
      const jobUpdatedRows = allBatches.reduce((sum, b) => sum + (b.updatedRows || 0), 0);

      let processedRows = 0;
      let successfulRows = 0;
      let duplicateRows = 0;
      let failedRowsCount = 0;
      for (const r of allStaging) {
        if (r.processingStatus === 'succeeded') {
          processedRows++;
          successfulRows++;
        } else if (r.processingStatus === 'duplicate_skipped') {
          processedRows++;
          duplicateRows++;
        } else if (r.processingStatus === 'failed') {
          processedRows++;
          failedRowsCount++;
        } else if (r.processingStatus === 'cancelled') {
          processedRows++;
        }
      }

      let nextStatus: ImportJobStatus = job.status;
      let completedAt = job.completedAt || null;
      let errorSummary = job.errorSummary || null;
      if (pendingBatches === 0) {
        completedAt = completedAt || nowIso;
        if (failedBatches > 0 && successfulRows === 0) {
          nextStatus = 'failed';
          errorSummary = allBatches.find(b => b.status === 'failed')?.errorMessage || `${failedBatches} batch gagal diproses.`;
        } else if (failedBatches > 0 || failedRowsCount > 0) {
          nextStatus = 'completed_with_errors';
          errorSummary = `${failedRowsCount} baris tidak valid/gagal diproses (${failedBatches} batch error).`;
        } else {
          nextStatus = 'completed';
          errorSummary = null;
        }
      } else {
        nextStatus = 'processing';
      }

      const nextJob: ImportJobSummary = {
        ...job,
        processedRows,
        successfulRows,
        updatedRows: jobUpdatedRows,
        duplicateRows,
        failedRows: failedRowsCount,
        completedBatches,
        status: nextStatus,
        errorSummary,
        completedAt,
        updatedAt: nowIso
      };
      jobs.set(jobId, nextJob);

      let history: ImportHistoryRecord | null = null;
      let historyWritten = false;
      if (pendingBatches === 0 && ['completed', 'completed_with_errors', 'failed'].includes(nextStatus)) {
        const jobDurMs = nextJob.startedAt
          ? Math.max(1, Date.parse(completedAt || nowIso) - Date.parse(nextJob.startedAt))
          : null;
        history = {
          id: `imphist_${jobId}`,
          jobId,
          importName: nextJob.importName,
          sourceFile: nextJob.sourceFile,
          importedBy: nextJob.createdBy || importedBy,
          importedById: nextJob.createdById || importedById || null,
          totalRows: nextJob.totalRows,
          successCount: successfulRows,
          duplicateCount: duplicateRows,
          failedCount: failedRowsCount,
          status: nextStatus,
          durationMs: jobDurMs,
          createdAt: nowIso
        };
        historyMap.set(jobId, { ...history, originalJobId: jobId, jobIdOrNull: jobId });
        historyWritten = true;
      }

      const { lockedBy: _lb, lockedAt: _la, lockExpiresAt: _le, updatedRows: _ur, ...cleanBatch } = batch;
      return {
        job: enrichJobFlags(nextJob, getSortedBatches(jobId)),
        batch: { ...cleanBatch },
        insertedWoNumbers,
        updatedWoNumbers,
        duplicateWoNumbers,
        failedRows,
        hasMorePending: pendingBatches > 0,
        historyWritten,
        history
      };
    },

    async failClaimedBatchAtomic({ jobId, batchNumber, workerId, errorMessage, durationMs }) {
      const job = jobs.get(jobId);
      if (!job) throw new ImportServiceError(`Import job "${jobId}" tidak ditemukan.`, 'IMPORT_JOB_NOT_FOUND', 404);
      const batch = batchesMap.get(jobId)?.get(batchNumber);
      if (!batch) throw new ImportServiceError(`Batch #${batchNumber} tidak ditemukan.`, 'IMPORT_BATCH_NOT_FOUND', 404);

      if (batch.status === 'completed') {
        const { lockedBy: _lb, lockedAt: _la, lockExpiresAt: _le, updatedRows: _ur, ...cleanBatch } = batch;
        return {
          job: enrichJobFlags(job, getSortedBatches(jobId)),
          batch: { ...cleanBatch },
          hasMorePending: false,
          historyWritten: false,
          history: null
        };
      }
      if (batch.status !== 'processing' || batch.lockedBy !== workerId) {
        throw new ImportServiceError(`Lock batch #${batchNumber} dipegang worker lain atau sudah dilepaskan.`, 'IMPORT_BATCH_LOCK_LOST', 409);
      }

      const nowIso = new Date().toISOString();
      const batchStaging = Array.from(stagingMap.get(jobId)?.values() || []).filter(r => r.batchNumber === batchNumber);
      for (const sr of batchStaging) {
        if (sr.validationStatus === 'valid' && (sr.processingStatus === 'pending' || sr.processingStatus === 'processing')) {
          sr.processingStatus = 'failed';
          sr.errorCode = 'BATCH_COMMIT_FAILED';
          sr.errorMessage = errorMessage;
          sr.processedAt = nowIso;
        }
      }

      const dupPre = batchStaging.filter(r => r.validationStatus === 'duplicate').length;
      const invPre = batchStaging.filter(r => r.validationStatus === 'invalid').length;
      const validFailed = batchStaging.filter(r => r.validationStatus === 'valid' && r.processingStatus === 'failed').length;

      batch.status = 'failed';
      batch.processedRows = batchStaging.length;
      batch.successfulRows = 0;
      batch.updatedRows = 0;
      batch.duplicateRows = dupPre;
      batch.failedRows = validFailed + invPre;
      batch.errorMessage = errorMessage;
      batch.durationMs = Math.max(1, durationMs);
      batch.lockedBy = null;
      batch.lockedAt = null;
      batch.lockExpiresAt = null;
      batch.processedAt = nowIso;

      const allBatches = Array.from(batchesMap.get(jobId)?.values() || []);
      const allStaging = Array.from(stagingMap.get(jobId)?.values() || []);
      const completedBatches = allBatches.filter(b => b.status === 'completed').length;
      const failedBatches = allBatches.filter(b => b.status === 'failed').length;
      const pendingBatches = allBatches.filter(b => b.status === 'pending' || b.status === 'processing').length;

      let processedRows = 0;
      let successfulRows = 0;
      let duplicateRows = 0;
      let failedRowsCount = 0;
      for (const r of allStaging) {
        if (r.processingStatus === 'succeeded') { processedRows++; successfulRows++; }
        else if (r.processingStatus === 'duplicate_skipped') { processedRows++; duplicateRows++; }
        else if (r.processingStatus === 'failed') { processedRows++; failedRowsCount++; }
        else if (r.processingStatus === 'cancelled') { processedRows++; }
      }

      let nextStatus: ImportJobStatus = job.status;
      let completedAt = job.completedAt || null;
      let errorSummary = errorMessage;
      if (job.status === 'cancelled') {
        nextStatus = 'cancelled';
      } else if (pendingBatches === 0) {
        completedAt = completedAt || nowIso;
        nextStatus = successfulRows === 0 ? 'failed' : 'completed_with_errors';
        errorSummary = successfulRows === 0 ? errorMessage : `${failedRowsCount} baris tidak valid/gagal diproses (${failedBatches} batch error).`;
      } else {
        nextStatus = 'processing';
      }

      const nextJob: ImportJobSummary = {
        ...job,
        processedRows,
        successfulRows,
        duplicateRows,
        failedRows: failedRowsCount,
        completedBatches,
        status: nextStatus,
        errorSummary,
        completedAt,
        updatedAt: nowIso
      };
      jobs.set(jobId, nextJob);

      let history: ImportHistoryRecord | null = null;
      let historyWritten = false;
      if (pendingBatches === 0 && ['completed_with_errors', 'failed'].includes(nextStatus)) {
        history = {
          id: `imphist_${jobId}`,
          jobId,
          importName: nextJob.importName,
          sourceFile: nextJob.sourceFile,
          importedBy: nextJob.createdBy,
          importedById: nextJob.createdById || null,
          totalRows: nextJob.totalRows,
          successCount: successfulRows,
          duplicateCount: duplicateRows,
          failedCount: failedRowsCount,
          status: nextStatus,
          durationMs: nextJob.startedAt ? Math.max(1, Date.parse(completedAt || nowIso) - Date.parse(nextJob.startedAt)) : null,
          createdAt: nowIso
        };
        historyMap.set(jobId, { ...history, originalJobId: jobId, jobIdOrNull: jobId });
        historyWritten = true;
      }

      const { lockedBy: _lb, lockedAt: _la, lockExpiresAt: _le, updatedRows: _ur, ...cleanBatch } = batch;
      return {
        job: enrichJobFlags(nextJob, getSortedBatches(jobId)),
        batch: { ...cleanBatch },
        hasMorePending: pendingBatches > 0,
        historyWritten,
        history
      };
    },

    async cancelJobAtomic({ jobId, cancelledBy, cancelledById }) {
      const job = jobs.get(jobId);
      if (!job) throw new ImportServiceError(`Import job "${jobId}" tidak ditemukan.`, 'IMPORT_JOB_NOT_FOUND', 404);
      if (job.status === 'completed') return enrichJobFlags(job, getSortedBatches(jobId));

      const nowIso = new Date().toISOString();
      for (const b of batchesMap.get(jobId)?.values() || []) {
        if (b.status === 'pending' || b.status === 'processing') {
          b.status = 'cancelled';
          b.lockedBy = null;
          b.lockedAt = null;
          b.lockExpiresAt = null;
          b.processedAt = nowIso;
        }
      }
      for (const sr of stagingMap.get(jobId)?.values() || []) {
        if (sr.processingStatus === 'pending' || sr.processingStatus === 'processing') {
          sr.processingStatus = 'cancelled';
          sr.processedAt = nowIso;
        }
      }

      const nextJob: ImportJobSummary = {
        ...job,
        status: 'cancelled',
        cancelledAt: job.cancelledAt || nowIso,
        updatedAt: nowIso
      };
      jobs.set(jobId, nextJob);
      historyMap.set(jobId, {
        id: `imphist_${jobId}`,
        jobId,
        originalJobId: jobId,
        jobIdOrNull: jobId,
        importName: nextJob.importName,
        sourceFile: nextJob.sourceFile,
        importedBy: cancelledBy || nextJob.createdBy,
        importedById: cancelledById || nextJob.createdById || null,
        totalRows: nextJob.totalRows,
        successCount: nextJob.successfulRows,
        duplicateCount: nextJob.duplicateRows,
        failedCount: nextJob.failedRows,
        status: 'cancelled',
        durationMs: nextJob.startedAt ? Math.max(1, Date.now() - Date.parse(nextJob.startedAt)) : null,
        createdAt: nowIso
      });
      return enrichJobFlags(nextJob, getSortedBatches(jobId));
    },

    async retryFailedBatchesAtomic(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new ImportServiceError(`Import job "${jobId}" tidak ditemukan.`, 'IMPORT_JOB_NOT_FOUND', 404);
      if (job.status === 'cancelled') throw new ImportServiceError('Import job sudah dibatalkan dan tidak dapat di-retry.', 'IMPORT_JOB_CANCELLED', 409);

      const failedNums: number[] = [];
      for (const b of batchesMap.get(jobId)?.values() || []) {
        if (b.status === 'failed') {
          b.status = 'pending';
          b.retryCount += 1;
          b.errorMessage = null;
          b.lockedBy = null;
          b.lockedAt = null;
          b.lockExpiresAt = null;
          failedNums.push(b.batchNumber);
        }
      }
      if (failedNums.length === 0) return enrichJobFlags(job, getSortedBatches(jobId));

      const failedSet = new Set(failedNums);
      for (const sr of stagingMap.get(jobId)?.values() || []) {
        if (sr.batchNumber !== null && failedSet.has(sr.batchNumber) && sr.validationStatus === 'valid' && sr.processingStatus === 'failed') {
          sr.processingStatus = 'pending';
          sr.errorCode = null;
          sr.errorMessage = null;
          sr.processedAt = null;
        }
      }

      const nextJob: ImportJobSummary = {
        ...job,
        status: 'processing',
        completedAt: null,
        errorSummary: null,
        updatedAt: new Date().toISOString()
      };
      jobs.set(jobId, nextJob);
      return enrichJobFlags(nextJob, getSortedBatches(jobId));
    }
  };
}

// ==============================================================================
// PRODUCTION POSTGRESQL STORE (Strict Relational Persistence + Acid RPCs)
// - ZERO silent fallback to app_settings, local JSON files, or memory.
// - Fails explicitly with 503 MIGRATION_020_REQUIRED if Migration 020 tables or
//   transactional RPCs are missing from PostgreSQL.
// ==============================================================================
class ProductionImportStore implements ImportPersistenceStore {
  private schemaVerified = false;

  private getRequiredClient() {
    const client = getSupabaseBackendClient();
    if (!client) {
      throw new ImportServiceError(
        'Database authoritative PostgreSQL/Supabase belum dikonfigurasi pada server.',
        'DATABASE_UNAVAILABLE',
        503,
        true
      );
    }
    return client;
  }

  private wrapDbError(error: any, target: string, operation: string): ImportServiceError {
    if (error instanceof ImportServiceError) return error;

    const code = String(error?.code || '').trim();
    const rawMsg = String(error?.message || error?.details || error?.hint || error || '').trim();

    // Missing Migration 020 tables, columns, or RPC functions
    if (
      code === '42P01' ||
      code === '42883' ||
      code === '42703' ||
      code === 'PGRST202' ||
      code === 'PGRST204' ||
      code === 'PGRST205' ||
      /could not find the (function|table)|does not exist|schema cache/i.test(rawMsg)
    ) {
      this.schemaVerified = false;
      return new ImportServiceError(
        `Skema/RPC Enterprise Import (Migration 020) belum tersedia atau belum lengkap pada PostgreSQL (${target}/${operation}): ${rawMsg}. Jalankan migrations/020_enterprise_import_architecture.sql terlebih dahulu.`,
        'MIGRATION_020_REQUIRED',
        503,
        false
      );
    }

    // Explicit PL/pgSQL domain exceptions from Migration 020 RPCs
    if (rawMsg.includes('IMPORT_JOB_NOT_FOUND')) {
      return new ImportServiceError('Import job tidak ditemukan di database.', 'IMPORT_JOB_NOT_FOUND', 404, false);
    }
    if (rawMsg.includes('IMPORT_BATCH_NOT_FOUND')) {
      return new ImportServiceError('Batch impor tidak ditemukan di database.', 'IMPORT_BATCH_NOT_FOUND', 404, false);
    }
    if (rawMsg.includes('IMPORT_JOB_CANCELLED')) {
      return new ImportServiceError('Import job telah dibatalkan.', 'IMPORT_JOB_CANCELLED', 409, false);
    }
    if (rawMsg.includes('IMPORT_BATCH_ALREADY_COMPLETED')) {
      return new ImportServiceError('Batch impor sudah berstatus completed.', 'IMPORT_BATCH_ALREADY_COMPLETED', 409, false);
    }
    if (rawMsg.includes('IMPORT_BATCH_LOCK_LOST')) {
      return new ImportServiceError('Lock pemrosesan batch dipegang worker lain atau telah kedaluwarsa.', 'IMPORT_BATCH_LOCK_LOST', 409, false);
    }

    const classified = classifySupabaseError(error, { table: target, operation });
    const isTransient =
      classified.isUnavailable ||
      code === '57P01' ||
      code === '57P03' ||
      code === '40001' ||
      code === '40P01' ||
      code === '08006' ||
      code === '08001' ||
      /timeout|timed out|etimedout|econnreset|econnrefused|fetch failed|502|503|504|connection|pool/i.test(rawMsg);

    if (isTransient) {
      return new ImportServiceError(
        classified.message || `Gangguan koneksi sementara ke database (${operation}): ${rawMsg}`,
        'DATABASE_TRANSIENT_ERROR',
        503,
        true
      );
    }

    return new ImportServiceError(
      classified.message || rawMsg || `Operasi database ${target}.${operation} gagal.`,
      code || 'DATABASE_ERROR',
      500,
      false
    );
  }

  async ensureSchemaReady(): Promise<void> {
    if (this.schemaVerified) return;
    const client = this.getRequiredClient();

    // 1. Verify all 5 Migration 020 tables are reachable
    const tables = ['import_jobs', 'import_batches', 'import_staging_rows', 'import_row_errors', 'import_history'] as const;
    for (const tbl of tables) {
      const { error } = await client.from(tbl).select('id').limit(1);
      if (error) {
        throw this.wrapDbError(error, tbl, 'schema_probe');
      }
    }

    // 2. Verify Migration 020 RPC functions & updated_rows/locked_by schema are deployed
    const [batchColProbe, historyColProbe, rpcProbe, dupLookupProbe] = await Promise.all([
      client.from('import_batches').select('id, locked_by, lock_expires_at, updated_rows').limit(1),
      client.from('import_history').select('id, original_job_id').limit(1),
      client.rpc('morajaws_claim_import_batch', {
        p_job_id: '__migration_020_schema_probe__',
        p_worker_id: 'schema_probe',
        p_batch_number: null,
        p_retry_failed: false,
        p_lock_ttl_seconds: 30
      }),
      client.rpc('morajaws_find_existing_wo_numbers', {
        p_wo_numbers: []
      })
    ]);

    if (batchColProbe.error) throw this.wrapDbError(batchColProbe.error, 'import_batches', 'schema_probe');
    if (historyColProbe.error) throw this.wrapDbError(historyColProbe.error, 'import_history', 'schema_probe');
    if (rpcProbe.error) throw this.wrapDbError(rpcProbe.error, 'morajaws_claim_import_batch', 'rpc_probe');
    if (dupLookupProbe.error) throw this.wrapDbError(dupLookupProbe.error, 'morajaws_find_existing_wo_numbers', 'rpc_probe');

    this.schemaVerified = true;
  }

  async createJob(job: ImportJobSummary, opts?: { clientRequestId?: string }): Promise<void> {
    await this.ensureSchemaReady();
    const client = this.getRequiredClient();
    const metadata = opts?.clientRequestId ? { clientRequestId: opts.clientRequestId } : {};
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
        metadata,
        created_by: job.createdBy,
        created_by_id: job.createdById || null,
        created_at: job.createdAt,
        started_at: job.startedAt || null,
        updated_at: job.updatedAt,
        completed_at: job.completedAt || null,
        cancelled_at: job.cancelledAt || null
      }
    ]);
    if (error) {
      throw this.wrapDbError(error, 'import_jobs', 'createJob');
    }
  }

  async findJobByClientRequestId(clientRequestId: string): Promise<ImportJobSummary | null> {
    if (!clientRequestId) return null;
    await this.ensureSchemaReady();
    const client = this.getRequiredClient();
    const { data, error } = await client
      .from('import_jobs')
      .select('*')
      .eq('metadata->>clientRequestId', clientRequestId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw this.wrapDbError(error, 'import_jobs', 'findJobByClientRequestId');
    }
    if (!data) return null;
    const batches = await this.getBatches(data.id);
    return enrichJobFlags(dbRowToJob(data), batches);
  }

  async getJob(jobId: string): Promise<ImportJobSummary | null> {
    const client = this.getRequiredClient();
    const { data, error } = await client.from('import_jobs').select('*').eq('id', jobId).maybeSingle();
    if (error) {
      throw this.wrapDbError(error, 'import_jobs', 'getJob');
    }
    if (!data) return null;
    const batches = await this.getBatches(jobId);
    return enrichJobFlags(dbRowToJob(data), batches);
  }

  async listJobs(limit = 30): Promise<ImportJobSummary[]> {
    const client = this.getRequiredClient();
    const { data, error } = await client
      .from('import_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      throw this.wrapDbError(error, 'import_jobs', 'listJobs');
    }
    return (data || []).map(dbRowToJob);
  }

  async upsertBatches(batches: ImportBatchSummary[]): Promise<void> {
    if (batches.length === 0) return;
    const client = this.getRequiredClient();
    for (let i = 0; i < batches.length; i += 200) {
      const payload = batches.slice(i, i + 200).map(b => ({
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
      if (error) {
        throw this.wrapDbError(error, 'import_batches', 'upsertBatches');
      }
    }
  }

  async getBatches(jobId: string): Promise<ImportBatchSummary[]> {
    const client = this.getRequiredClient();
    const { data, error } = await client
      .from('import_batches')
      .select('*')
      .eq('job_id', jobId)
      .order('batch_number', { ascending: true });
    if (error) {
      throw this.wrapDbError(error, 'import_batches', 'getBatches');
    }
    return (data || []).map(dbRowToBatch);
  }

  async getStagingLookupIndex(jobId: string): Promise<{
    rowNumbers: Set<number>;
    canonicalWos: Set<string>;
    maxRowNumber: number;
  }> {
    const client = this.getRequiredClient();
    const rowNumbers = new Set<number>();
    const canonicalWos = new Set<string>();
    let maxRowNumber = 0;
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await client
        .from('import_staging_rows')
        .select('row_number, wo_number')
        .eq('job_id', jobId)
        .order('row_number', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) {
        throw this.wrapDbError(error, 'import_staging_rows', 'getStagingLookupIndex');
      }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const rn = Number(r.row_number);
        if (Number.isFinite(rn)) {
          rowNumbers.add(rn);
          if (rn > maxRowNumber) maxRowNumber = rn;
        }
        const canon = canonicalWoKey(r.wo_number);
        if (canon) canonicalWos.add(canon);
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    return { rowNumbers, canonicalWos, maxRowNumber };
  }

  async upsertStagingRows(rows: InternalStagingRow[]): Promise<void> {
    if (rows.length === 0) return;
    const client = this.getRequiredClient();
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
        throw this.wrapDbError(error, 'import_staging_rows', 'upsertStagingRows');
      }
    }
  }

  async getStagingRows(jobId: string, opts?: { batchNumber?: number }): Promise<InternalStagingRow[]> {
    const client = this.getRequiredClient();
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
      if (error) {
        throw this.wrapDbError(error, 'import_staging_rows', 'getStagingRows');
      }
      if (!data || data.length === 0) break;
      out.push(...data.map(dbRowToStaging));
      if (data.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  }

  async syncStagedCount(jobId: string): Promise<ImportJobSummary | null> {
    const client = this.getRequiredClient();
    const { data, error } = await client.rpc('morajaws_sync_staged_count', {
      p_job_id: jobId
    });
    if (error) {
      throw this.wrapDbError(error, 'morajaws_sync_staged_count', 'rpc');
    }
    if (!data) return null;
    const batches = await this.getBatches(jobId);
    return enrichJobFlags(dbRowToJob(data), batches);
  }

  async clearRowErrorsForRows(jobId: string, rowNumbers: number[]): Promise<void> {
    if (rowNumbers.length === 0) return;
    const client = this.getRequiredClient();
    for (let i = 0; i < rowNumbers.length; i += 200) {
      const slice = rowNumbers.slice(i, i + 200);
      const { error } = await client
        .from('import_row_errors')
        .delete()
        .eq('job_id', jobId)
        .in('row_number', slice);
      if (error) {
        throw this.wrapDbError(error, 'import_row_errors', 'clearRowErrorsForRows');
      }
    }
  }

  async appendRowErrors(errors: ImportRowErrorRecord[]): Promise<void> {
    if (errors.length === 0) return;
    const client = this.getRequiredClient();
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
      const { error } = await client.from('import_row_errors').insert(chunk);
      if (error) {
        throw this.wrapDbError(error, 'import_row_errors', 'appendRowErrors');
      }
    }
  }

  async getRowErrors(jobId: string, limit = 1000, offset = 0): Promise<ImportRowErrorRecord[]> {
    const client = this.getRequiredClient();
    const { data, error } = await client
      .from('import_row_errors')
      .select('*')
      .eq('job_id', jobId)
      .order('row_number', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) {
      throw this.wrapDbError(error, 'import_row_errors', 'getRowErrors');
    }
    return (data || []).map(dbRowToError);
  }

  async listHistory(limit = 50): Promise<ImportHistoryRecord[]> {
    const client = this.getRequiredClient();
    const { data, error } = await client
      .from('import_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      throw this.wrapDbError(error, 'import_history', 'listHistory');
    }
    return (data || []).map(dbRowToHistory);
  }

  async findExistingWoNumbers(candidates: Array<{ normWo: string; rawTrimmed: string }>): Promise<Set<string>> {
    const existingSet = new Set<string>();
    const client = this.getRequiredClient();
    if (candidates.length === 0) return existingSet;

    const allInputs = Array.from(
      new Set(candidates.flatMap(c => [c.normWo, c.rawTrimmed]).filter(Boolean))
    );
    const chunkSize = 250;
    for (let i = 0; i < allInputs.length; i += chunkSize) {
      const slice = allInputs.slice(i, i + chunkSize);
      if (slice.length === 0) continue;

      const { data, error } = await client.rpc('morajaws_find_existing_wo_numbers', {
        p_wo_numbers: slice
      });

      if (error) {
        throw this.wrapDbError(error, 'morajaws_find_existing_wo_numbers', 'rpc');
      }

      (data || []).forEach((r: any) => {
        const key = canonicalWoKey(typeof r === 'string' ? r : r?.canonical_wo ?? '');
        if (key) existingSet.add(key);
      });
    }

    return existingSet;
  }

  async getAuthUsersAndContractors(): Promise<{ users: any[]; contractors: any[] }> {
    const client = this.getRequiredClient();
    const [uRes, cRes] = await Promise.all([
      client
        .from('users')
        .select('id, name, role, contractor, contractor_id, area, phone, active, is_deleted, is_archived, account_status')
        .eq('is_deleted', false),
      client.from('contractors').select('id, name, code, leader_id, leader_name, active, is_archived')
    ]);
    if (uRes.error) throw this.wrapDbError(uRes.error, 'users', 'getAuthUsersAndContractors');
    if (cRes.error) throw this.wrapDbError(cRes.error, 'contractors', 'getAuthUsersAndContractors');

    const users = (uRes.data || []).map((u: any) => {
      const accountStatus = String(u.account_status || '').trim().toLowerCase();
      const isArchived = Boolean(u.is_archived);
      const isDeleted = Boolean(u.is_deleted);
      const isActive = u.active !== false && !isDeleted && !isArchived && (!accountStatus || accountStatus === 'active');
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        contractor: u.contractor,
        contractorId: u.contractor_id,
        area: u.area,
        phone: u.phone,
        active: isActive,
        isDeleted,
        isArchived,
        accountStatus: accountStatus || 'active'
      };
    });
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
  }

  async startJobAtomic(jobId: string): Promise<ImportJobSummary> {
    await this.ensureSchemaReady();
    const client = this.getRequiredClient();
    const existing = await this.getJob(jobId);
    if (!existing) {
      throw new ImportServiceError(`Import job "${jobId}" tidak ditemukan.`, 'IMPORT_JOB_NOT_FOUND', 404);
    }
    if (existing.status === 'cancelled') {
      throw new ImportServiceError('Import job sudah dibatalkan.', 'IMPORT_JOB_CANCELLED', 409);
    }
    if (existing.status === 'completed') {
      return existing;
    }
    if (existing.status === 'staging' && existing.stagedRows < Math.max(existing.totalRows, 1)) {
      throw new ImportServiceError(
        `Staging belum lengkap (${existing.stagedRows}/${existing.totalRows} baris).`,
        'IMPORT_STAGING_INCOMPLETE',
        409
      );
    }

    const { data, error } = await client
      .from('import_jobs')
      .update({
        status: 'processing',
        started_at: existing.startedAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)
      .neq('status', 'cancelled')
      .select('*')
      .maybeSingle();

    if (error) {
      throw this.wrapDbError(error, 'import_jobs', 'startJobAtomic');
    }
    if (!data) {
      const refreshed = await this.getJob(jobId);
      if (refreshed?.status === 'cancelled') {
        throw new ImportServiceError('Import job sudah dibatalkan.', 'IMPORT_JOB_CANCELLED', 409);
      }
      throw new ImportServiceError(`Import job "${jobId}" tidak dapat dimulai.`, 'START_JOB_FAILED', 409);
    }
    const batches = await this.getBatches(jobId);
    return enrichJobFlags(dbRowToJob(data), batches);
  }

  async claimNextBatch(params: {
    jobId: string;
    workerId: string;
    batchNumber?: number;
    retryFailed?: boolean;
    lockTtlSeconds?: number;
  }): Promise<ClaimBatchResult> {
    await this.ensureSchemaReady();
    const client = this.getRequiredClient();
    const { data, error } = await client.rpc('morajaws_claim_import_batch', {
      p_job_id: params.jobId,
      p_worker_id: params.workerId,
      p_batch_number: typeof params.batchNumber === 'number' ? params.batchNumber : null,
      p_retry_failed: Boolean(params.retryFailed),
      p_lock_ttl_seconds: params.lockTtlSeconds ?? DEFAULT_BATCH_LOCK_TTL_SECONDS
    });

    if (error) {
      throw this.wrapDbError(error, 'morajaws_claim_import_batch', 'rpc');
    }

    const batches = data?.job ? await this.getBatches(params.jobId) : [];
    const job = data?.job ? enrichJobFlags(dbRowToJob(data.job), batches) : null;
    const batch = data?.batch ? dbRowToBatch(data.batch) : null;

    return {
      claimed: Boolean(data?.claimed),
      reason: (data?.reason || 'NO_ELIGIBLE_BATCH') as ClaimBatchResult['reason'],
      job,
      batch
    };
  }

  async commitClaimedBatchAtomic(params: {
    jobId: string;
    batchNumber: number;
    workerId: string;
    woRows: Record<string, any>[];
    duplicatePolicy: 'skip' | 'update_allowed';
    durationMs: number;
    importedBy: string;
    importedById?: string | null;
  }): Promise<AtomicBatchCommitResult> {
    const client = this.getRequiredClient();
    const { data, error } = await client.rpc('morajaws_commit_import_batch_atomic', {
      p_job_id: params.jobId,
      p_batch_number: params.batchNumber,
      p_worker_id: params.workerId,
      p_wo_rows: params.woRows,
      p_duplicate_policy: params.duplicatePolicy,
      p_duration_ms: Math.max(1, Math.floor(params.durationMs || 1)),
      p_imported_by: params.importedBy || 'System',
      p_imported_by_id: params.importedById || null
    });

    if (error) {
      throw this.wrapDbError(error, 'morajaws_commit_import_batch_atomic', 'rpc');
    }

    const batches = await this.getBatches(params.jobId);
    const job = enrichJobFlags(dbRowToJob(data.job), batches);
    const batch = dbRowToBatch(data.batch);
    return {
      job,
      batch,
      insertedWoNumbers: Array.isArray(data.insertedWoNumbers) ? data.insertedWoNumbers.map(String) : [],
      updatedWoNumbers: Array.isArray(data.updatedWoNumbers) ? data.updatedWoNumbers.map(String) : [],
      duplicateWoNumbers: Array.isArray(data.duplicateWoNumbers) ? data.duplicateWoNumbers.map(String) : [],
      failedRows: Array.isArray(data.failedRows) ? data.failedRows : [],
      hasMorePending: Boolean(data.hasMorePending),
      historyWritten: Boolean(data.historyWritten),
      history: data.history ? dbRowToHistory(data.history) : null
    };
  }

  async failClaimedBatchAtomic(params: {
    jobId: string;
    batchNumber: number;
    workerId: string;
    errorMessage: string;
    durationMs: number;
  }): Promise<AtomicBatchFailResult> {
    const client = this.getRequiredClient();
    const { data, error } = await client.rpc('morajaws_fail_claimed_batch_atomic', {
      p_job_id: params.jobId,
      p_batch_number: params.batchNumber,
      p_worker_id: params.workerId,
      p_error_message: params.errorMessage,
      p_duration_ms: Math.max(1, Math.floor(params.durationMs || 1))
    });

    if (error) {
      throw this.wrapDbError(error, 'morajaws_fail_claimed_batch_atomic', 'rpc');
    }

    const batches = await this.getBatches(params.jobId);
    return {
      job: enrichJobFlags(dbRowToJob(data.job), batches),
      batch: dbRowToBatch(data.batch),
      hasMorePending: Boolean(data.hasMorePending),
      historyWritten: Boolean(data.historyWritten),
      history: data.history ? dbRowToHistory(data.history) : null
    };
  }

  async cancelJobAtomic(params: {
    jobId: string;
    cancelledBy: string;
    cancelledById?: string | null;
  }): Promise<ImportJobSummary> {
    await this.ensureSchemaReady();
    const client = this.getRequiredClient();
    const { data, error } = await client.rpc('morajaws_cancel_import_job_atomic', {
      p_job_id: params.jobId,
      p_cancelled_by: params.cancelledBy || 'System',
      p_cancelled_by_id: params.cancelledById || null
    });

    if (error) {
      throw this.wrapDbError(error, 'morajaws_cancel_import_job_atomic', 'rpc');
    }
    const batches = await this.getBatches(params.jobId);
    return enrichJobFlags(dbRowToJob(data), batches);
  }

  async retryFailedBatchesAtomic(jobId: string): Promise<ImportJobSummary> {
    await this.ensureSchemaReady();
    const client = this.getRequiredClient();
    const { data, error } = await client.rpc('morajaws_retry_import_job_atomic', {
      p_job_id: jobId
    });

    if (error) {
      throw this.wrapDbError(error, 'morajaws_retry_import_job_atomic', 'rpc');
    }
    const batches = await this.getBatches(jobId);
    return enrichJobFlags(dbRowToJob(data), batches);
  }
}

// ==============================================================================
// ENTERPRISE ASYNCHRONOUS BATCH IMPORT ENGINE
// - Zero reliance on Node.js in-memory locks (uses PostgreSQL row locks).
// - Zero silent fallback on production persistence errors.
// ==============================================================================
export class EnterpriseImportEngine {
  private store: ImportPersistenceStore;
  private hooks: EnterpriseImportHooks;

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
      clientRequestId?: string;
    },
    user: ImportOperatorUser
  ): Promise<ImportJobSummary> {
    const totalRows = Math.max(0, Math.floor(Number(params.totalRows) || 0));
    if (totalRows <= 0) {
      throw new ImportServiceError('Jumlah baris totalRows harus lebih dari 0.', 'INVALID_ROW_COUNT', 400);
    }
    if (totalRows > MAX_IMPORT_JOB_ROWS) {
      throw new ImportServiceError(
        `Maksimum ${MAX_IMPORT_JOB_ROWS.toLocaleString()} baris per job impor untuk menjaga stabilitas sistem.`,
        'INVALID_ROW_COUNT',
        400
      );
    }

    const templateType = String(params.templateType || 'CUSTOM').trim().toUpperCase();
    if (!ALLOWED_IMPORT_TEMPLATE_TYPES.has(templateType)) {
      throw new ImportServiceError(
        `Template type "${templateType}" tidak dikenali.`,
        'INVALID_TEMPLATE_TYPE',
        400
      );
    }

    const clientRequestId =
      typeof params.clientRequestId === 'string' && params.clientRequestId.trim()
        ? params.clientRequestId.trim().slice(0, 120)
        : undefined;

    if (this.store.ensureSchemaReady) {
      await this.store.ensureSchemaReady();
    }

    if (clientRequestId && this.store.findJobByClientRequestId) {
      const existingByReq = await this.store.findJobByClientRequestId(clientRequestId);
      if (existingByReq) {
        return existingByReq;
      }
    }

    const batchSize = clampBatchSize(params.batchSize);
    const totalBatches = Math.ceil(totalRows / batchSize);
    const now = new Date().toISOString();
    const jobId = makeId('impjob');

    const job: ImportJobSummary = enrichJobFlags({
      id: jobId,
      importName: (params.importName || params.sourceFile || `Import ${now.slice(0, 10)}`).trim().slice(0, 255),
      sourceFile: (params.sourceFile || 'import_data.xlsx').trim().slice(0, 255),
      sourceFormat: (params.sourceFormat || 'xlsx').trim().toLowerCase().slice(0, 32),
      templateType: templateType as ImportTemplateType,
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

    await this.store.createJob(job, { clientRequestId });

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
   * Uses lightweight staging lookup index (row_number + wo_number only) so
   * multi-chunk jobs up to 25,000 rows remain O(N) without JSONB re-downloads.
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
    if (!job) {
      throw new ImportServiceError(`Import job "${jobId}" tidak ditemukan.`, 'IMPORT_JOB_NOT_FOUND', 404);
    }
    if (job.status === 'cancelled') {
      throw new ImportServiceError('Import job telah dibatalkan dan tidak dapat menerima data staging.', 'IMPORT_JOB_CANCELLED', 409);
    }
    if (job.status !== 'staging') {
      throw new ImportServiceError(
        `Import job berstatus "${job.status}" dan tidak lagi menerima data staging.`,
        'INVALID_JOB_STATE',
        409
      );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ImportServiceError('Payload rows staging tidak boleh kosong.', 'INVALID_ROWS', 400);
    }
    if (rows.length > MAX_STAGE_CHUNK_ROWS) {
      throw new ImportServiceError(
        `Maksimal ${MAX_STAGE_CHUNK_ROWS} baris per request staging untuk mencegah payload overflow.`,
        'STAGE_CHUNK_TOO_LARGE',
        400
      );
    }
    if (
      opts?.startRowNumber !== undefined &&
      (!Number.isInteger(opts.startRowNumber) || opts.startRowNumber < 1 || opts.startRowNumber > job.totalRows)
    ) {
      throw new ImportServiceError(
        `startRowNumber harus bilangan bulat antara 1 dan ${job.totalRows}.`,
        'INVALID_ROW_NUMBER',
        400
      );
    }

    const stagingIdx = await this.store.getStagingLookupIndex(jobId);
    const seenCanonicalInJob = stagingIdx.canonicalWos;
    const existingRowNums = stagingIdx.rowNumbers;

    // Pre-extract WO candidates for batch DB duplicate lookup
    const normalizedCandidates: Array<{ normWo: string; rawTrimmed: string }> = [];
    for (const r of rows) {
      const m = r?.mapped && typeof r.mapped === 'object' ? r.mapped : r;
      const rawWoVal = m?.woNumber ?? m?.workOrderNumber ?? m?.wo_number ?? '';
      const rawTrimmed = typeof rawWoVal === 'string' || typeof rawWoVal === 'number' ? String(rawWoVal).trim() : '';
      const normWo = normalizeWoNumber(rawWoVal);
      if (normWo) normalizedCandidates.push({ normWo, rawTrimmed });
    }
    const existingInDbSet = await this.store.findExistingWoNumbers(normalizedCandidates);

    const baseStart = opts?.startRowNumber ?? stagingIdx.maxRowNumber + 1;
    const strictMode = opts?.validationMode !== 'standard' && job.templateType !== 'ASSIGNED_TEKNISI';
    const now = new Date().toISOString();

    const stagedBatch: InternalStagingRow[] = [];
    const stagedRowNumbers: number[] = [];
    const validationErrorsToRecord: ImportRowErrorRecord[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    const isInvalidScalarType = (val: unknown) =>
      val !== undefined &&
      val !== null &&
      typeof val !== 'string' &&
      typeof val !== 'number';

    for (let i = 0; i < rows.length; i++) {
      const input = rows[i] || {};
      if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_STAGING_ROW_BYTES) {
        throw new ImportServiceError(
          `Ukuran payload baris staging ke-${i + 1} melebihi batas aman 64KB.`,
          'PAYLOAD_TOO_LARGE',
          413
        );
      }

      let rowNum: number;
      if (input.rowNumber !== undefined) {
        const parsedRn = Number(input.rowNumber);
        if (!Number.isInteger(parsedRn) || parsedRn < 1 || parsedRn > job.totalRows) {
          throw new ImportServiceError(
            `Nomor baris staging (${input.rowNumber}) harus antara 1 dan ${job.totalRows}.`,
            'INVALID_ROW_NUMBER',
            400
          );
        }
        rowNum = parsedRn;
      } else {
        rowNum = baseStart + i;
        while (existingRowNums.has(rowNum)) {
          rowNum++;
        }
        if (rowNum > job.totalRows) {
          throw new ImportServiceError(
            `Nomor baris staging (${rowNum}) melebihi totalRows (${job.totalRows}).`,
            'INVALID_ROW_NUMBER',
            400
          );
        }
      }
      existingRowNums.add(rowNum);
      stagedRowNumbers.push(rowNum);

      const batchNumber = Math.min(job.totalBatches, Math.max(1, Math.ceil(rowNum / job.batchSize)));
      const rawPayload = input.raw && typeof input.raw === 'object' ? { ...input.raw } : { ...input };
      const mappedSrc = input.mapped && typeof input.mapped === 'object' ? { ...input.mapped } : { ...input };

      const rawWoVal = mappedSrc.woNumber ?? mappedSrc.workOrderNumber ?? mappedSrc.wo_number ?? '';
      const woStr = typeof rawWoVal === 'string' || typeof rawWoVal === 'number' ? String(rawWoVal).trim() : '';
      const normWo = normalizeWoNumber(woStr);
      const canonWo = canonicalWoKey(normWo);

      let errCode = '';
      let errMsg = '';
      let validationStatus: InternalStagingRow['validationStatus'] = 'valid';
      let processingStatus: InternalStagingRow['processingStatus'] = 'pending';

      // 0. Scalar type & length sanity check on core text/date fields
      const scalarFieldsToCheck: Array<[string, unknown, number]> = [
        ['woNumber', rawWoVal, 120],
        ['customerName', mappedSrc.customerName, 300],
        ['customerPhone', mappedSrc.customerPhone, 100],
        ['contractorName', mappedSrc.contractorName ?? mappedSrc.contactorName, 250],
        ['area', mappedSrc.area, 250],
        ['slotTime', mappedSrc.slotTime, 120],
        ['appointmentDate', mappedSrc.appointmentDate, 100]
      ];
      for (const [fieldName, fieldVal, maxLen] of scalarFieldsToCheck) {
        if (isInvalidScalarType(fieldVal)) {
          validationStatus = 'invalid';
          processingStatus = 'failed';
          errCode = 'INVALID_FIELD_TYPE';
          errMsg = `Field "${fieldName}" harus berupa teks/angka, bukan objek atau boolean.`;
          break;
        }
        if (fieldVal !== undefined && fieldVal !== null && String(fieldVal).length > maxLen) {
          validationStatus = 'invalid';
          processingStatus = 'failed';
          errCode = 'FIELD_TOO_LONG';
          errMsg = `Field "${fieldName}" melebihi batas panjang ${maxLen} karakter.`;
          break;
        }
      }

      // 1. WO Number check
      if (!errCode && (!normWo || normWo.length < 3 || !/^[A-Z0-9._-]+$/i.test(normWo))) {
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
      const contractorVal = isInvalidScalarType(mappedSrc.contractorName ?? mappedSrc.contactorName)
        ? ''
        : String(mappedSrc.contractorName || mappedSrc.contactorName || '').trim();
      const areaVal = isInvalidScalarType(mappedSrc.area)
        ? ''
        : String(mappedSrc.area || '').trim();
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

      const resolvedUnmappedHeaders: string[] = Array.isArray(mappedSrc.unmappedHeaders)
        ? mappedSrc.unmappedHeaders.map((h: any) => String(h)).filter(Boolean)
        : Array.isArray(input.unmappedHeaders)
        ? input.unmappedHeaders.map((h: any) => String(h)).filter(Boolean)
        : [];
      const baseAdditionalFields: Record<string, any> =
        mappedSrc.additionalFields && typeof mappedSrc.additionalFields === 'object'
          ? { ...mappedSrc.additionalFields }
          : input.additionalFields && typeof input.additionalFields === 'object'
          ? { ...input.additionalFields }
          : {};
      for (const uh of resolvedUnmappedHeaders) {
        if (!(uh in baseAdditionalFields) && Object.prototype.hasOwnProperty.call(rawPayload, uh)) {
          baseAdditionalFields[uh] = rawPayload[uh];
        }
      }

      const normalizedPayload: Record<string, any> = {
        ...mappedSrc,
        woNumber: normWo || woStr,
        workOrderNumber: normWo || woStr,
        idCustomer: isInvalidScalarType(rawCustId) ? undefined : String(rawCustId ?? '').trim() || undefined,
        customerId: isInvalidScalarType(rawCustId) ? undefined : String(rawCustId ?? '').trim() || undefined,
        contractorName: contractorVal || undefined,
        contactorName: contractorVal || undefined,
        area: areaVal || undefined,
        appointmentDate: normalizedDate || undefined,
        fileName: mappedSrc.fileName || job.sourceFile,
        importDate: mappedSrc.importDate || new Date().toISOString().slice(0, 10),
        additionalFields: baseAdditionalFields,
        unmappedHeaders: resolvedUnmappedHeaders
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
    if (this.store.clearRowErrorsForRows && stagedRowNumbers.length > 0) {
      await this.store.clearRowErrorsForRows(jobId, stagedRowNumbers);
    }
    if (validationErrorsToRecord.length > 0) {
      await this.store.appendRowErrors(validationErrorsToRecord);
    }

    const updatedJob = await this.store.syncStagedCount(jobId);

    return {
      job: updatedJob || job,
      stagedCount: stagedBatch.length,
      validCount,
      invalidCount,
      duplicateCount
    };
  }

  async startJob(jobId: string): Promise<ImportJobSummary> {
    return this.store.startJobAtomic(jobId);
  }

  /**
   * Distributed-safe, ACID single-batch execution step for Vercel serverless & Node.js.
   * - Uses PostgreSQL FOR UPDATE SKIP LOCKED via claimNextBatch() — zero Node.js memory locks.
   * - Commits work_orders + import_staging_rows + import_row_errors + import_batches +
   *   import_jobs + import_history atomically in a single PostgreSQL transaction.
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
    if (opts?.batchNumber !== undefined && (!Number.isInteger(opts.batchNumber) || opts.batchNumber < 1)) {
      throw new ImportServiceError('Nomor batch harus bilangan bulat positif (>= 1).', 'INVALID_BATCH_NUMBER', 400);
    }

    const workerId = makeId('worker');
    const claim = await this.store.claimNextBatch({
      jobId,
      workerId,
      batchNumber: opts?.batchNumber,
      retryFailed: opts?.retryFailed,
      lockTtlSeconds: DEFAULT_BATCH_LOCK_TTL_SECONDS
    });

    if (!claim.claimed) {
      if (claim.reason === 'JOB_NOT_FOUND' || !claim.job) {
        throw new ImportServiceError(`Import job "${jobId}" tidak ditemukan.`, 'IMPORT_JOB_NOT_FOUND', 404);
      }
      if (claim.reason === 'STAGING_INCOMPLETE') {
        throw new ImportServiceError(
          `Staging belum lengkap (${claim.job.stagedRows}/${claim.job.totalRows} baris).`,
          'IMPORT_STAGING_INCOMPLETE',
          409
        );
      }
      if (claim.reason === 'BATCH_LOCKED_BY_ANOTHER_WORKER') {
        throw new ImportServiceError(
          'Batch impor sedang dikunci dan diproses oleh instance worker lain. Silakan coba lagi sesaat.',
          'BATCH_LOCK_CONTENTION',
          409,
          true
        );
      }
      if (opts?.batchNumber !== undefined && opts.batchNumber > claim.job.totalBatches) {
        throw new ImportServiceError(
          `Batch #${opts.batchNumber} di luar jangkauan job (total ${claim.job.totalBatches} batch).`,
          'INVALID_BATCH_NUMBER',
          400
        );
      }
      return {
        job: claim.job,
        processedBatch: null,
        done: true
      };
    }

    const job = claim.job!;
    const targetBatch = claim.batch!;
    const batchStartMs = Date.now();

    try {
      const [batchRows, authCtx] = await Promise.all([
        this.store.getStagingRows(jobId, { batchNumber: targetBatch.batchNumber }),
        this.store.getAuthUsersAndContractors()
      ]);

      const validPendingRows = batchRows.filter(
        r =>
          r.validationStatus === 'valid' &&
          (r.processingStatus === 'pending' || r.processingStatus === 'failed' || r.processingStatus === 'processing')
      );

      const enrichedTickets: Record<string, any>[] = validPendingRows.map(r => {
        const t = { ...r.normalizedPayload };
        const dist = resolveLeaderForWorkOrder(t, authCtx.users, authCtx.contractors);
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

      const batchTag = `${jobId}_b${targetBatch.batchNumber}`;
      const nowIso = new Date().toISOString();
      const woRows = enrichedTickets.map(ticket =>
        ticketToPostgresRow({
          ...ticket,
          importBatchId: batchTag,
          importedAt: ticket.importedAt || nowIso,
          updatedBy: user.name || 'Import'
        })
      );

      // Retry ONLY transient database/network failures (never retry permanent errors or lock/cancel conflicts)
      let commitRes: AtomicBatchCommitResult | null = null;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          commitRes = await this.store.commitClaimedBatchAtomic({
            jobId,
            batchNumber: targetBatch.batchNumber,
            workerId,
            woRows,
            duplicatePolicy: job.duplicatePolicy,
            durationMs: Math.max(1, Date.now() - batchStartMs),
            importedBy: user.name,
            importedById: user.id
          });
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          const isRetryable = err instanceof ImportServiceError ? err.retryable : false;
          if (!isRetryable || attempt >= 1) {
            break;
          }
          await new Promise(res => setTimeout(res, 150 * (attempt + 1)));
        }
      }

      if (!commitRes || lastErr) {
        throw lastErr || new ImportServiceError('Commit batch atomik gagal.', 'COMMIT_BATCH_FAILED', 500, false);
      }

      if ((commitRes.insertedWoNumbers.length > 0 || commitRes.updatedWoNumbers.length > 0) && this.hooks.onWorkOrdersCommitted) {
        const committedSet = new Set(
          [...commitRes.insertedWoNumbers, ...commitRes.updatedWoNumbers].map(w => canonicalWoKey(w))
        );
        const committedTickets = enrichedTickets.filter(o => committedSet.has(canonicalWoKey(o.woNumber)));
        await Promise.resolve(
          this.hooks.onWorkOrdersCommitted({
            jobId,
            batchNumber: targetBatch.batchNumber,
            importedCount: commitRes.insertedWoNumbers.length,
            updatedCount: commitRes.updatedWoNumbers.length,
            committedTickets,
            users: authCtx.users,
            user
          })
        ).catch(() => {});
      }

      if (commitRes.historyWritten && commitRes.history && this.hooks.onJobFinalized) {
        await Promise.resolve(
          this.hooks.onJobFinalized({
            job: commitRes.job,
            history: commitRes.history,
            user
          })
        ).catch(() => {});
      }

      return {
        job: commitRes.job,
        processedBatch: commitRes.batch,
        done: !commitRes.hasMorePending
      };
    } catch (batchErr: any) {
      // If cancellation or lock conflict prevented commit, rethrow cleanly without overwriting status to failed
      if (
        batchErr instanceof ImportServiceError &&
        (batchErr.code === 'IMPORT_JOB_CANCELLED' ||
          batchErr.code === 'IMPORT_BATCH_LOCK_LOST' ||
          batchErr.code === 'IMPORT_BATCH_ALREADY_COMPLETED' ||
          batchErr.code === 'MIGRATION_020_REQUIRED' ||
          batchErr.code === 'DATABASE_UNAVAILABLE')
      ) {
        throw batchErr;
      }

      const failRes = await this.store.failClaimedBatchAtomic({
        jobId,
        batchNumber: targetBatch.batchNumber,
        workerId,
        errorMessage: batchErr?.message || `Batch #${targetBatch.batchNumber} gagal diproses.`,
        durationMs: Math.max(1, Date.now() - batchStartMs)
      });

      if (failRes.historyWritten && failRes.history && this.hooks.onJobFinalized) {
        await Promise.resolve(
          this.hooks.onJobFinalized({
            job: failRes.job,
            history: failRes.history,
            user
          })
        ).catch(() => {});
      }

      return {
        job: failRes.job,
        processedBatch: failRes.batch,
        done: !failRes.hasMorePending
      };
    }
  }

  /**
   * Atomically re-queues ONLY failed batches without reprocessing completed batches.
   */
  async retryFailedBatches(jobId: string, user: ImportOperatorUser): Promise<ImportJobSummary> {
    void user;
    return this.store.retryFailedBatchesAtomic(jobId);
  }

  /**
   * Atomically cancels pending/processing batches while preserving committed batches.
   */
  async cancelImportJob(jobId: string, user: ImportOperatorUser): Promise<ImportJobSummary> {
    return this.store.cancelJobAtomic({
      jobId,
      cancelledBy: user.name,
      cancelledById: user.id
    });
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
