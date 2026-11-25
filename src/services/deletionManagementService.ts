import { getAuthHeaders } from './authService';

export type DeletionCategory =
  | 'work_orders'
  | 'assignment_history'
  | 'technical_reports'
  | 'ticket_messages'
  | 'attachments'
  | 'import_history'
  | 'import_staging'
  | 'other_data';

export type DeletionSubEntity =
  | 'all'
  | 'users'
  | 'contractors'
  | 'coverage_areas'
  | 'wa_templates'
  | 'droplist_items'
  | 'chat_categories';

export type DeletionMode = 'soft_delete' | 'permanent_delete' | 'restore';
export type DeletionType = 'soft_delete' | 'permanent_delete' | 'restore';

export interface DeletionNavContext {
  category?: DeletionCategory;
  subEntity?: DeletionSubEntity;
  mode?: DeletionMode;
  search?: string;
}

export interface CategorySummaryCounts {
  active: number;
  deleted: number;
  total: number;
}

export type CategoryCountsSummaryMap = Record<DeletionCategory, CategorySummaryCounts>;

export interface DeletionItemRow {
  id: string;
  category: DeletionCategory;
  subEntity?: DeletionSubEntity;
  woNumber?: string;
  customerId?: string;
  customerName?: string;
  appointmentDate?: string;
  contractor?: string;
  area?: string;
  installerName?: string;
  assignmentStatus?: string;
  statusWOAgent?: string;
  statusWOInstaller?: string;
  workOrderId?: string;
  ticketId?: string;
  assignedBy?: string;
  senderName?: string;
  senderRole?: string;
  message?: string;
  notes?: string;
  statusInstaller?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  storageProvider?: string;
  storagePath?: string;
  jobId?: string;
  importName?: string;
  sourceFile?: string;
  importedBy?: string;
  totalRows?: number;
  successCount?: number;
  duplicateCount?: number;
  failedCount?: number;
  stagedRows?: number;
  processedRows?: number;
  status?: string;
  label?: string;
  identifier?: string;
  role?: string;
  active?: boolean;
  isLockedActive?: boolean;
  isProtected?: boolean;
  isArchived?: boolean;
  isDeleted: boolean;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deletionReason?: string | null;
  deletionStatus: string;
  createdAt?: string;
  rawDetail?: Record<string, any>;
}

export interface WoDependencySummary {
  found: boolean;
  id: string;
  woNumber: string;
  customerName?: string;
  isDeleted?: boolean;
  isArchived?: boolean;
  isProtected?: boolean;
  activeImportLock?: boolean;
  counts: {
    assignment_history: number;
    ticket_messages: number;
    technical_reports: number;
    attachments: number;
    wo_progress_report_history: number;
    wo_distribution_logs: number;
    wo_kendala_reports: number;
    wo_photo_evidence: number;
  };
  blockingTotal: number;
  canSoftDelete: boolean;
  canPermanentDelete: boolean;
  blockingReasons: string[];
}

export interface DeletionLogRecord {
  id: string;
  transactionId: string;
  deletionType: DeletionType;
  category: DeletionCategory;
  sourceTable: string;
  recordId: string;
  woNumber?: string | null;
  actorUserId?: string | null;
  actorName: string;
  actorRole: string;
  reason?: string | null;
  relatedCounts: Record<string, number>;
  status: 'success' | 'failed' | 'rejected';
  errorMessage?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface DeletionListResponse {
  success: boolean;
  items: DeletionItemRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  error?: string;
  code?: string;
}

export interface DeletionHistoryResponse {
  success: boolean;
  logs: DeletionLogRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  error?: string;
  code?: string;
}

export interface DeletionFacets {
  contractors: string[];
  areas: string[];
  assignmentStatuses: string[];
}

export interface BatchDependenciesResponse {
  success: boolean;
  items: WoDependencySummary[];
  blockedCount: number;
  eligibleCount: number;
  error?: string;
  code?: string;
}

async function safeParseJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Permintaan ke server melebihi batas waktu (timeout). Silakan periksa koneksi lalu coba lagi.');
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function fetchDeletionCategoriesSummary(): Promise<{
  success: boolean;
  summary?: CategoryCountsSummaryMap;
  error?: string;
  code?: string;
}> {
  const res = await fetchWithTimeout('/api/deletion/categories-summary', {
    method: 'GET',
    credentials: 'include',
    headers: getAuthHeaders()
  });
  const json = await safeParseJson(res);
  if (!res.ok || !json.success) {
    return {
      success: false,
      error: json.error || `Gagal memuat ringkasan kategori (${res.status})`,
      code: json.code
    };
  }
  return { success: true, summary: json.summary };
}

export async function fetchDeletionFacets(category: DeletionCategory): Promise<{
  success: boolean;
  facets?: DeletionFacets;
  error?: string;
}> {
  const qs = new URLSearchParams({ category });
  const res = await fetchWithTimeout(`/api/deletion/facets?${qs.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: getAuthHeaders()
  });
  const json = await safeParseJson(res);
  if (!res.ok || !json.success) {
    return { success: false, error: json.error || `Gagal memuat opsi filter (${res.status})` };
  }
  return { success: true, facets: json.facets };
}

export interface FetchDeletionItemsParams {
  category: DeletionCategory;
  subEntity?: DeletionSubEntity;
  mode?: DeletionMode;
  search?: string;
  woNumber?: string;
  customerId?: string;
  customerName?: string;
  contractor?: string;
  area?: string;
  assignmentStatus?: string;
  appointmentDate?: string;
  appointmentDateFrom?: string;
  appointmentDateTo?: string;
  recordIdQuery?: string;
  summaryQuery?: string;
  actorQuery?: string;
  status?: string;
  deletionStatus?: 'all' | 'active' | 'soft_deleted';
  sortBy?: 'default' | 'appointment_date' | 'created_at';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export async function fetchDeletionItems(params: FetchDeletionItemsParams): Promise<DeletionListResponse> {
  const qs = new URLSearchParams();
  qs.set('category', params.category);
  if (params.subEntity) qs.set('subEntity', params.subEntity);
  if (params.mode) qs.set('mode', params.mode);
  if (params.search) qs.set('search', params.search);
  if (params.woNumber) qs.set('woNumber', params.woNumber);
  if (params.customerId) qs.set('customerId', params.customerId);
  if (params.customerName) qs.set('customerName', params.customerName);
  if (params.contractor && params.contractor !== 'all') qs.set('contractor', params.contractor);
  if (params.area && params.area !== 'all') qs.set('area', params.area);
  if (params.assignmentStatus && params.assignmentStatus !== 'all') qs.set('assignmentStatus', params.assignmentStatus);
  if (params.appointmentDate) qs.set('appointmentDate', params.appointmentDate);
  if (params.appointmentDateFrom) qs.set('appointmentDateFrom', params.appointmentDateFrom);
  if (params.appointmentDateTo) qs.set('appointmentDateTo', params.appointmentDateTo);
  if (params.recordIdQuery) qs.set('recordIdQuery', params.recordIdQuery);
  if (params.summaryQuery) qs.set('summaryQuery', params.summaryQuery);
  if (params.actorQuery) qs.set('actorQuery', params.actorQuery);
  if (params.status && params.status !== 'all') qs.set('status', params.status);
  if (params.deletionStatus) qs.set('deletionStatus', params.deletionStatus);
  if (params.sortBy && params.sortBy !== 'default') {
    qs.set('sortBy', params.sortBy);
    qs.set('sortDir', params.sortDir || 'asc');
  } else if (params.sortDir) {
    qs.set('sortDir', params.sortDir);
  }
  qs.set('page', String(params.page || 1));
  qs.set('pageSize', String(params.pageSize || 25));

  const res = await fetchWithTimeout(`/api/deletion/items?${qs.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: getAuthHeaders()
  });
  const json = await safeParseJson(res);
  if (!res.ok || !json.success) {
    return {
      success: false,
      items: [],
      total: 0,
      page: 1,
      pageSize: params.pageSize || 25,
      totalPages: 1,
      error: json.error || `Gagal mengambil daftar data (${res.status})`,
      code: json.code
    };
  }
  return json as DeletionListResponse;
}

export async function inspectRecordDependencies(
  category: DeletionCategory,
  id: string
): Promise<{
  success: boolean;
  dependencies?: WoDependencySummary;
  error?: string;
  code?: string;
}> {
  const res = await fetchWithTimeout(`/api/deletion/dependencies/${encodeURIComponent(category)}/${encodeURIComponent(id)}`, {
    method: 'GET',
    credentials: 'include',
    headers: getAuthHeaders()
  });
  const json = await safeParseJson(res);
  if (!res.ok || !json.success) {
    return {
      success: false,
      error: json.error || `Gagal memeriksa dependensi (${res.status})`,
      code: json.code
    };
  }
  return { success: true, dependencies: json.dependencies };
}

export async function inspectBatchDependencies(
  category: DeletionCategory,
  recordIds: string[]
): Promise<BatchDependenciesResponse> {
  const res = await fetchWithTimeout('/api/deletion/dependencies/batch', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({ category, recordIds })
  });
  const json = await safeParseJson(res);
  if (!res.ok || !json.success) {
    return {
      success: false,
      items: [],
      blockedCount: 0,
      eligibleCount: 0,
      error: json.error || `Gagal memeriksa dependensi batch (${res.status})`,
      code: json.code
    };
  }
  return json as BatchDependenciesResponse;
}

export async function executeCentralizedSoftDelete(payload: {
  targets: Array<{ category: DeletionCategory; recordId: string; subEntity?: DeletionSubEntity }>;
  reason: string;
}): Promise<{
  success: boolean;
  transactionId?: string;
  succeeded?: any[];
  failed?: Array<{ recordId: string; category: string; code: string; error: string }>;
  message?: string;
  error?: string;
  code?: string;
}> {
  const res = await fetchWithTimeout('/api/deletion/soft-delete', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(payload)
  }, 30_000);
  const json = await safeParseJson(res);
  if (!res.ok || (!json.success && (!json.succeeded || json.succeeded.length === 0))) {
    return {
      success: false,
      transactionId: json.transactionId,
      succeeded: json.succeeded || [],
      failed: json.failed || [],
      error: json.error || `Gagal menjalankan soft delete (${res.status})`,
      code: json.code
    };
  }
  return json;
}

export async function executeCentralizedPermanentDelete(payload: {
  category: DeletionCategory;
  subEntity?: DeletionSubEntity;
  recordId: string;
  confirmText: string;
  reason: string;
}): Promise<{
  success: boolean;
  transactionId?: string;
  data?: any;
  relatedCounts?: Record<string, number>;
  message?: string;
  error?: string;
  code?: string;
}> {
  const res = await fetchWithTimeout('/api/deletion/permanent-delete', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(payload)
  }, 30_000);
  const json = await safeParseJson(res);
  if (!res.ok || !json.success) {
    return {
      success: false,
      transactionId: json.transactionId,
      relatedCounts: json.relatedCounts,
      error: json.error || `Hapus permanen ditolak (${res.status})`,
      code: json.code
    };
  }
  return json;
}

export async function executeCentralizedPermanentDeleteBatch(payload: {
  targets: Array<{ category: DeletionCategory; recordId: string; subEntity?: DeletionSubEntity }>;
  confirmText: string;
  reason: string;
}): Promise<{
  success: boolean;
  transactionId?: string;
  succeeded?: any[];
  failed?: Array<{ recordId: string; category: string; code: string; error: string }>;
  message?: string;
  error?: string;
  code?: string;
}> {
  const res = await fetchWithTimeout('/api/deletion/permanent-delete-batch', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(payload)
  }, 30_000);
  const json = await safeParseJson(res);
  if (!res.ok || (!json.success && (!json.succeeded || json.succeeded.length === 0))) {
    return {
      success: false,
      transactionId: json.transactionId,
      succeeded: json.succeeded || [],
      failed: json.failed || [],
      error: json.error || `Hapus permanen batch ditolak (${res.status})`,
      code: json.code
    };
  }
  return json;
}

export async function executeCentralizedRestore(payload: {
  targets: Array<{ category: DeletionCategory; recordId: string; subEntity?: DeletionSubEntity }>;
  reason?: string;
}): Promise<{
  success: boolean;
  transactionId?: string;
  succeeded?: any[];
  failed?: Array<{ recordId: string; category: string; code: string; error: string }>;
  message?: string;
  error?: string;
  code?: string;
}> {
  const res = await fetchWithTimeout('/api/deletion/restore', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(payload)
  }, 30_000);
  const json = await safeParseJson(res);
  if (!res.ok || (!json.success && (!json.succeeded || json.succeeded.length === 0))) {
    return {
      success: false,
      transactionId: json.transactionId,
      succeeded: json.succeeded || [],
      failed: json.failed || [],
      error: json.error || `Gagal memulihkan data (${res.status})`,
      code: json.code
    };
  }
  return json;
}

export async function fetchDeletionHistory(params: {
  search?: string;
  txIdQuery?: string;
  woOrRecordQuery?: string;
  reasonQuery?: string;
  category?: string;
  deletionType?: string;
  actor?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): Promise<DeletionHistoryResponse> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.txIdQuery) qs.set('txIdQuery', params.txIdQuery);
  if (params.woOrRecordQuery) qs.set('woOrRecordQuery', params.woOrRecordQuery);
  if (params.reasonQuery) qs.set('reasonQuery', params.reasonQuery);
  if (params.category && params.category !== 'all') qs.set('category', params.category);
  if (params.deletionType && params.deletionType !== 'all') qs.set('deletionType', params.deletionType);
  if (params.actor && params.actor !== 'all') qs.set('actor', params.actor);
  if (params.status && params.status !== 'all') qs.set('status', params.status);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.sortDir) qs.set('sortDir', params.sortDir);
  qs.set('page', String(params.page || 1));
  qs.set('pageSize', String(params.pageSize || 25));

  const res = await fetchWithTimeout(`/api/deletion/history?${qs.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: getAuthHeaders()
  });
  const json = await safeParseJson(res);
  if (!res.ok || !json.success) {
    return {
      success: false,
      logs: [],
      total: 0,
      page: 1,
      pageSize: params.pageSize || 25,
      totalPages: 1,
      error: json.error || `Gagal memuat riwayat penghapusan (${res.status})`,
      code: json.code
    };
  }
  return json as DeletionHistoryResponse;
}

export function navigateToDataDeletion(context?: DeletionNavContext): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<DeletionNavContext | undefined>('morajaws:navigate-data-deletion', {
      detail: context
    })
  );
}

