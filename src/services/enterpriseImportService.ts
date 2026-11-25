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

export interface RunEnterpriseImportParams {
  importName?: string;
  sourceFile: string;
  sourceFormat: string;
  templateType: ImportTemplateType | string;
  duplicatePolicy: 'skip' | 'update_allowed';
  autoRegisterContractors: boolean;
  batchSize?: number;
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

async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...((init.headers as Record<string, string>) || {})
  };
  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const errMsg = json?.error?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(typeof errMsg === 'string' ? errMsg : 'Permintaan import server gagal.');
  }
  return json.data as T;
}

export async function listImportJobs(limit = 20): Promise<ImportJobSummary[]> {
  return apiRequest<ImportJobSummary[]>(`/api/imports/jobs?limit=${limit}`);
}

export async function getImportJobDetail(jobId: string): Promise<ImportJobSummary> {
  return apiRequest<ImportJobSummary>(`/api/imports/jobs/${encodeURIComponent(jobId)}`);
}

export async function listImportHistory(limit = 50): Promise<ImportHistoryRecord[]> {
  return apiRequest<ImportHistoryRecord[]>(`/api/imports/history?limit=${limit}`);
}

export async function getImportJobErrors(jobId: string, limit = 500, offset = 0): Promise<ImportRowErrorRecord[]> {
  return apiRequest<ImportRowErrorRecord[]>(
    `/api/imports/jobs/${encodeURIComponent(jobId)}/errors?limit=${limit}&offset=${offset}`
  );
}

export async function cancelImportJob(jobId: string): Promise<ImportJobSummary> {
  const job = await apiRequest<ImportJobSummary>(`/api/imports/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  return job;
}

export async function downloadImportErrorsCsv(jobId: string): Promise<void> {
  const res = await fetch(`/api/imports/jobs/${encodeURIComponent(jobId)}/errors?format=csv`, {
    headers: getAuthHeaders()
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
  saveActiveImportJobId(jobId);

  let latestJob = await apiRequest<ImportJobSummary>(`/api/imports/jobs/${encodeURIComponent(jobId)}/start`, {
    method: 'POST',
    body: JSON.stringify({}),
    signal: options?.signal
  });
  options?.onJobUpdate?.(latestJob, `Memulai pemrosesan batch (${latestJob.totalBatches} batch)...`);

  while (true) {
    if (options?.signal?.aborted) {
      break;
    }

    const res = await apiRequest<{
      job: ImportJobSummary;
      processedBatch: ImportBatchSummary | null;
      done: boolean;
    }>(`/api/imports/jobs/${encodeURIComponent(jobId)}/process-next`, {
      method: 'POST',
      body: JSON.stringify({ retryFailed: Boolean(options?.retryFailed) }),
      signal: options?.signal
    });

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
    signal: options?.signal
  });
  options?.onJobUpdate?.(queuedJob, 'Mengulang batch yang gagal...');
  return runPendingBatchesLoop(jobId, {
    signal: options?.signal,
    onJobUpdate: options?.onJobUpdate
  });
}

/**
 * Full end-to-end Asynchronous Chunked Batch Import workflow:
 * 1) Creates persistent import_job + batch partition plan on server.
 * 2) Streams parsed rows to import_staging_rows in 400-row chunks (safe under Vercel 4.5MB limit).
 * 3) Triggers sequential idempotent batch execution until completion or cancellation.
 */
export async function executeEnterpriseAsyncImport(params: RunEnterpriseImportParams): Promise<ImportJobSummary> {
  const { rows, signal, onJobUpdate } = params;
  if (!rows || rows.length === 0) {
    throw new Error('Tidak ada baris valid untuk diimpor.');
  }

  // 1. Create job
  let job = await apiRequest<ImportJobSummary>('/api/imports/jobs', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      importName: params.importName || params.sourceFile,
      sourceFile: params.sourceFile,
      sourceFormat: params.sourceFormat,
      templateType: params.templateType,
      duplicatePolicy: params.duplicatePolicy,
      autoRegisterContractors: params.autoRegisterContractors,
      batchSize: params.batchSize || 500,
      totalRows: rows.length
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
