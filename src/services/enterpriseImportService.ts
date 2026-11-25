import { getAuthHeaders } from './authService';
import {
  ImportBatchSummary,
  ImportHistoryRecord,
  ImportJobSummary,
  ImportRowErrorRecord,
  ImportTemplateType
} from '../types/index.ts';
import { safeSessionStorageRemove, safeSessionStorageSet } from '../utils/safeStorage';

const ACTIVE_IMPORT_JOB_KEY = 'morajaws_active_import_job_id';
const STAGE_CHUNK_SIZE = 400; // Well below Vercel 4.5MB payload limit even for 46-column rows
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const STAGE_REQUEST_TIMEOUT_MS = 45_000;
const BATCH_REQUEST_TIMEOUT_MS = 55_000;

export interface RunEnterpriseImportParams {
  importName?: string;
  sourceFile: string;
  sourceFormat: string;
  templateType: ImportTemplateType | string;
  duplicatePolicy: 'skip' | 'update_allowed';
  autoRegisterContractors: boolean;
  batchSize?: number;
  clientRequestId?: string;
  rows: Array<{
    rowNumber: number;
    raw?: Record<string, any>;
    mapped: Record<string, any>;
  }>;
  validationMode?: 'strict' | 'standard';
  signal?: AbortSignal;
  onJobUpdate?: (job: ImportJobSummary, phaseLabel?: string) => void;
}

export function getSavedActiveImportJobId(): string | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    const id = window.sessionStorage.getItem(ACTIVE_IMPORT_JOB_KEY);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function saveActiveImportJobId(jobId: string | null): void {
  if (!jobId) {
    safeSessionStorageRemove(ACTIVE_IMPORT_JOB_KEY);
    return;
  }
  safeSessionStorageSet(ACTIVE_IMPORT_JOB_KEY, jobId);
}

class ImportApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  diagnosticCode?: string;
  target?: string;
  constructor(
    message: string,
    status: number,
    code: string,
    retryable = false,
    diagnosticCode?: string,
    target?: string
  ) {
    super(message);
    this.name = 'ImportApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    if (diagnosticCode) this.diagnosticCode = diagnosticCode;
    if (target) this.target = target;
  }
}

function makeClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `impreq_${crypto.randomUUID()}`;
  }
  return `impreq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createAbortError(): Error {
  const err = new Error('Operasi import dibatalkan.');
  err.name = 'AbortError';
  return err;
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function computeBackoffMs(attempt: number, baseMs = 450, maxMs = 6000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * Math.min(350, exp * 0.3));
  return Math.min(maxMs, exp + jitter);
}

function isTransientImportError(err: unknown): boolean {
  if (!err || (err instanceof Error && err.name === 'AbortError')) return false;
  if (err instanceof ImportApiError) {
    if (
      err.code === 'MIGRATION_020_REQUIRED' ||
      err.code === 'PERMISSION_DENIED' ||
      err.code === 'DATABASE_UNAVAILABLE' ||
      err.code === 'IMPORT_JOB_CANCELLED' ||
      err.code === 'IMPORT_STAGING_INCOMPLETE' ||
      err.code === 'INVALID_JOB_STATE' ||
      err.diagnosticCode === 'TABLE_MISSING' ||
      err.diagnosticCode === 'RPC_MISSING' ||
      err.diagnosticCode === 'RPC_SIGNATURE_MISMATCH' ||
      err.diagnosticCode === 'PERMISSION_DENIED' ||
      err.diagnosticCode === 'INVALID_SCHEMA'
    ) {
      return false;
    }
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      return false;
    }
    return err.retryable || err.status === 408 || err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504 || err.code === 'DATABASE_TRANSIENT_ERROR';
  }
  // Browser fetch network errors throw TypeError
  return err instanceof TypeError;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const callerSignal = init.signal ?? undefined;
  if (callerSignal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (err: any) {
    if (timedOut && !callerSignal?.aborted) {
      throw new ImportApiError(
        `Permintaan ke server import timeout setelah ${Math.round(timeoutMs / 1000)} detik.`,
        408,
        'REQUEST_TIMEOUT',
        true
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

async function apiRequest<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxRetries?: number } = {}
): Promise<T> {
  const maxRetries = Math.max(0, init.maxRetries ?? 2);
  const callerSignal = init.signal ?? undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (callerSignal?.aborted) {
      throw createAbortError();
    }
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...((init.headers as Record<string, string>) || {})
      };
      const res = await fetchWithTimeout(url, { ...init, headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) {
        const errMsg = json?.error?.message || json?.error || `HTTP ${res.status}`;
        const errCode = String(json?.error?.code || json?.code || `HTTP_${res.status}`);
        const diagnosticCode = typeof json?.error?.diagnosticCode === 'string' ? json.error.diagnosticCode : undefined;
        const target = typeof json?.error?.target === 'string' ? json.error.target : undefined;
        const isSchemaOrPermissionError =
          errCode === 'MIGRATION_020_REQUIRED' ||
          errCode === 'PERMISSION_DENIED' ||
          diagnosticCode === 'TABLE_MISSING' ||
          diagnosticCode === 'RPC_MISSING' ||
          diagnosticCode === 'RPC_SIGNATURE_MISMATCH' ||
          diagnosticCode === 'PERMISSION_DENIED' ||
          diagnosticCode === 'INVALID_SCHEMA';
        const retryable = isSchemaOrPermissionError
          ? false
          : Boolean(json?.error?.retryable) ||
            res.status === 408 ||
            res.status === 429 ||
            res.status === 502 ||
            res.status === 503 ||
            res.status === 504;
        throw new ImportApiError(
          typeof errMsg === 'string' ? errMsg : 'Permintaan import server gagal.',
          res.status,
          errCode,
          retryable,
          diagnosticCode,
          target
        );
      }
      return json.data as T;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isTransientImportError(err)) {
        await waitWithAbort(computeBackoffMs(attempt), callerSignal);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

const inFlightDetailRequests = new Map<string, Promise<ImportJobSummary>>();
const activeJobLoops = new Map<string, Promise<ImportJobSummary>>();

export async function listImportJobs(limit = 20): Promise<ImportJobSummary[]> {
  return apiRequest<ImportJobSummary[]>(`/api/imports/jobs?limit=${limit}`, { maxRetries: 2 });
}

export async function getImportJobDetail(jobId: string): Promise<ImportJobSummary> {
  const existing = inFlightDetailRequests.get(jobId);
  if (existing) return existing;

  const req = apiRequest<ImportJobSummary>(`/api/imports/jobs/${encodeURIComponent(jobId)}`, {
    maxRetries: 2
  }).finally(() => {
    inFlightDetailRequests.delete(jobId);
  });
  inFlightDetailRequests.set(jobId, req);
  return req;
}

export async function listImportHistory(limit = 50): Promise<ImportHistoryRecord[]> {
  return apiRequest<ImportHistoryRecord[]>(`/api/imports/history?limit=${limit}`, { maxRetries: 2 });
}

export async function getImportJobErrors(jobId: string, limit = 500, offset = 0): Promise<ImportRowErrorRecord[]> {
  return apiRequest<ImportRowErrorRecord[]>(
    `/api/imports/jobs/${encodeURIComponent(jobId)}/errors?limit=${limit}&offset=${offset}`,
    { maxRetries: 2 }
  );
}

export async function cancelImportJob(jobId: string): Promise<ImportJobSummary> {
  const job = await apiRequest<ImportJobSummary>(`/api/imports/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
    maxRetries: 1
  });
  return job;
}

export async function downloadImportErrorsCsv(jobId: string): Promise<void> {
  const res = await fetchWithTimeout(`/api/imports/jobs/${encodeURIComponent(jobId)}/errors?format=csv`, {
    headers: getAuthHeaders(),
    timeoutMs: STAGE_REQUEST_TIMEOUT_MS
  });
  if (!res.ok) {
    throw new Error(`Gagal mengunduh laporan error (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `morajaws_import_errors_${jobId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Processes pending batches for an existing job ID sequentially.
 * Safe for both initial execution and resuming an interrupted job after page refresh.
 */
export async function runPendingBatchesLoop(
  jobId: string,
  options?: {
    signal?: AbortSignal;
    retryFailed?: boolean;
    onJobUpdate?: (job: ImportJobSummary, phaseLabel?: string) => void;
  }
): Promise<ImportJobSummary> {
  const existingLoop = activeJobLoops.get(jobId);
  if (existingLoop) {
    return existingLoop;
  }

  const runLoop = (async () => {
    saveActiveImportJobId(jobId);

    let latestJob = await apiRequest<ImportJobSummary>(`/api/imports/jobs/${encodeURIComponent(jobId)}/start`, {
      method: 'POST',
      body: JSON.stringify({}),
      signal: options?.signal,
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: 2
    });
    options?.onJobUpdate?.(latestJob, `Memulai pemrosesan batch (${latestJob.totalBatches} batch)...`);

    let lockWaitAttempts = 0;
    while (true) {
      if (options?.signal?.aborted) {
        break;
      }

      let res: {
        job: ImportJobSummary;
        processedBatch: ImportBatchSummary | null;
        done: boolean;
      };
      try {
        res = await apiRequest<{
          job: ImportJobSummary;
          processedBatch: ImportBatchSummary | null;
          done: boolean;
        }>(`/api/imports/jobs/${encodeURIComponent(jobId)}/process-next`, {
          method: 'POST',
          body: JSON.stringify({ retryFailed: Boolean(options?.retryFailed) }),
          signal: options?.signal,
          timeoutMs: BATCH_REQUEST_TIMEOUT_MS,
          maxRetries: 2
        });
        lockWaitAttempts = 0;
      } catch (err: any) {
        if (
          err instanceof ImportApiError &&
          err.code === 'BATCH_LOCK_CONTENTION' &&
          lockWaitAttempts < 15 &&
          !options?.signal?.aborted
        ) {
          const waitMs = computeBackoffMs(Math.min(lockWaitAttempts, 4), 700, 5000);
          lockWaitAttempts++;
          options?.onJobUpdate?.(latestJob, 'Menunggu batch worker lain selesai...');
          await waitWithAbort(waitMs, options?.signal);
          continue;
        }
        throw err;
      }

      latestJob = res.job;
      const batchLabel = res.processedBatch
        ? `Batch ${res.processedBatch.batchNumber}/${latestJob.totalBatches} (${res.processedBatch.status})`
        : 'Menyelesaikan sinkronisasi...';
      options?.onJobUpdate?.(latestJob, batchLabel);

      if (res.done || latestJob.status === 'completed' || latestJob.status === 'cancelled') {
        break;
      }
    }

    if (
      latestJob.status === 'completed' ||
      latestJob.status === 'completed_with_errors' ||
      latestJob.status === 'cancelled'
    ) {
      saveActiveImportJobId(null);
    }

    return latestJob;
  })().finally(() => {
    activeJobLoops.delete(jobId);
  });

  activeJobLoops.set(jobId, runLoop);
  return runLoop;
}

export async function retryFailedImportBatches(
  jobId: string,
  options?: {
    signal?: AbortSignal;
    onJobUpdate?: (job: ImportJobSummary, phaseLabel?: string) => void;
  }
): Promise<ImportJobSummary> {
  const queuedJob = await apiRequest<ImportJobSummary>(`/api/imports/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    body: JSON.stringify({}),
    signal: options?.signal,
    maxRetries: 2
  });
  options?.onJobUpdate?.(queuedJob, 'Mengulang batch yang gagal...');
  return runPendingBatchesLoop(jobId, {
    signal: options?.signal,
    onJobUpdate: options?.onJobUpdate
  });
}

/**
 * Full end-to-end Asynchronous Chunked Batch Import workflow:
 * 1) Creates persistent import_job + batch partition plan on server (idempotent via clientRequestId).
 * 2) Streams parsed rows to import_staging_rows in 400-row chunks (safe under Vercel 4.5MB limit).
 * 3) Triggers sequential idempotent batch execution until completion or cancellation.
 */
export async function executeEnterpriseAsyncImport(params: RunEnterpriseImportParams): Promise<ImportJobSummary> {
  const { rows, signal, onJobUpdate } = params;
  if (!rows || rows.length === 0) {
    throw new Error('Tidak ada baris valid untuk diimpor.');
  }

  const clientRequestId = params.clientRequestId || makeClientRequestId();

  // 1. Create job (idempotent across transient retry via clientRequestId)
  let job = await apiRequest<ImportJobSummary>('/api/imports/jobs', {
    method: 'POST',
    signal,
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxRetries: 2,
    body: JSON.stringify({
      importName: params.importName || params.sourceFile,
      sourceFile: params.sourceFile,
      sourceFormat: params.sourceFormat,
      templateType: params.templateType,
      duplicatePolicy: params.duplicatePolicy,
      autoRegisterContractors: params.autoRegisterContractors,
      batchSize: params.batchSize || 500,
      totalRows: rows.length,
      clientRequestId
    })
  });

  saveActiveImportJobId(job.id);
  onJobUpdate?.(job, `Menyiapkan staging (${rows.length} baris)...`);

  // 2. Upload staging chunks (max 400 rows each)
  for (let i = 0; i < rows.length; i += STAGE_CHUNK_SIZE) {
    if (signal?.aborted) break;
    const chunk = rows.slice(i, i + STAGE_CHUNK_SIZE);
    const stageRes = await apiRequest<{
      job: ImportJobSummary;
      stagedCount: number;
    }>(`/api/imports/jobs/${encodeURIComponent(job.id)}/stage`, {
      method: 'POST',
      signal,
      timeoutMs: STAGE_REQUEST_TIMEOUT_MS,
      maxRetries: 2,
      body: JSON.stringify({
        rows: chunk,
        startRowNumber: i + 1,
        validationMode: params.validationMode || 'strict'
      })
    });
    job = stageRes.job;
    onJobUpdate?.(
      job,
      `Mengunggah staging ${Math.min(i + chunk.length, rows.length)} / ${rows.length} baris...`
    );
  }

  if (signal?.aborted) {
    return job;
  }

  // 3. Process batches sequentially
  return runPendingBatchesLoop(job.id, { signal, onJobUpdate });
}
