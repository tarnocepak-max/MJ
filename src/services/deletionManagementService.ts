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

export type PermanentDeleteOperationStatus =
  | 'preparing'
  | 'verifying'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed';

export type PermanentDeleteItemStatus =
  | 'pending'
  | 'deleted'
  | 'already_deleted'
  | 'blocked_fk'
  | 'protected'
  | 'failed';

export interface PermanentDeleteItemResult {
  recordId: string;
  category: DeletionCategory;
  subEntity?: DeletionSubEntity;
  woNumber?: string;
  label?: string;
  status: PermanentDeleteItemStatus;
  code?: string;
  message?: string;
  transactionId?: string;
  processedAt?: string;
}

export interface PermanentDeleteOperationState {
  operationId: string;
  fingerprint: string;
  status: PermanentDeleteOperationStatus;
  stageLabel: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  reason: string;
  confirmText: string;
  totalCount: number;
  processedCount: number;
  succeededCount: number;
  alreadyDeletedCount: number;
  blockedCount: number;
  failedCount: number;
  chunkSize: number;
  nextIndex: number;
  targets: Array<{
    category: DeletionCategory;
    recordId: string;
    subEntity?: DeletionSubEntity;
    woNumber?: string;
    label?: string;
  }>;
  results: PermanentDeleteItemResult[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  lastError?: string | null;
}

export interface RecentPermanentAuditResponse {
  success: boolean;
  totalLogsChecked: number;
  recentLogs: DeletionLogRecord[];
  woExistenceMap: Record<string, { exists: boolean; isDeleted?: boolean; woNumber?: string }>;
  error?: string;
}

export interface ParsedDeletionApiResponse<T = any> {
  ok: boolean;
  data: T | null;
  statusCode: number;
  contentType: string;
  requestId?: string;
  code?: string;
  error?: string;
  isHtml?: boolean;
  isWarmupHtml?: boolean;
}

const HTML_WARMUP_MARKERS = [
  'starting server...',
  '<title>starting server',
  'please wait while your application starts',
  'application is starting'
];

export function detectHtmlPayload(text: string, contentType: string): { isHtml: boolean; isWarmupHtml: boolean } {
  const ct = String(contentType || '').toLowerCase();
  const trimmed = String(text || '').trim().toLowerCase();
  const looksLikeHtmlBody =
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<!doctype') ||
    (trimmed.includes('<head>') && trimmed.includes('<body')) ||
    trimmed.includes('<title>');
  const isWarmupHtml = HTML_WARMUP_MARKERS.some(marker => trimmed.includes(marker));
  const isHtml = ct.includes('text/html') || looksLikeHtmlBody || isWarmupHtml;
  return { isHtml, isWarmupHtml };
}

export async function parseDeletionApiResponse<T = any>(
  res: Response,
  endpoint: string
): Promise<ParsedDeletionApiResponse<T>> {
  const contentType = res.headers?.get?.('content-type') || '';
  const headerReqId = res.headers?.get?.('x-request-id') || undefined;
  let text = '';
  try {
    text = await res.text();
  } catch {
    return {
      ok: false,
      data: null,
      statusCode: res.status,
      contentType,
      requestId: headerReqId,
      code: 'READ_RESPONSE_FAILED',
      error: `Gagal membaca respons dari ${endpoint} (HTTP ${res.status}).`
    };
  }

  const { isHtml, isWarmupHtml } = detectHtmlPayload(text, contentType);
  if (isHtml) {
    return {
      ok: false,
      data: null,
      statusCode: res.status,
      contentType,
      requestId: headerReqId,
      isHtml: true,
      isWarmupHtml,
      code: isWarmupHtml ? 'HTML_WARMUP_RESPONSE' : 'HTML_RESPONSE',
      error: isWarmupHtml
        ? 'Server backend sedang memulai ulang atau merespons halaman warmup (HTML), bukan data JSON. Silakan klik Coba Lagi dalam beberapa detik.'
        : `Endpoint ${endpoint} mengembalikan halaman HTML (HTTP ${res.status}), bukan JSON. Periksa routing backend API.`
    };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: res.ok,
      data: res.ok ? ({} as T) : null,
      statusCode: res.status,
      contentType,
      requestId: headerReqId,
      code: res.ok ? undefined : 'EMPTY_RESPONSE',
      error: res.ok ? undefined : `Server mengembalikan respons kosong dari ${endpoint} (HTTP ${res.status}).`
    };
  }

  if (contentType && !contentType.toLowerCase().includes('json') && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return {
      ok: false,
      data: null,
      statusCode: res.status,
      contentType,
      requestId: headerReqId,
      code: 'NON_JSON_RESPONSE',
      error: `Respons dari ${endpoint} bertipe "${contentType}" (HTTP ${res.status}), bukan JSON.`
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      data: null,
      statusCode: res.status,
      contentType,
      requestId: headerReqId,
      code: 'INVALID_JSON_RESPONSE',
      error: `Respons dari ${endpoint} bukan format JSON yang valid (HTTP ${res.status}).`
    };
  }

  const requestId = parsed?.requestId || headerReqId;
  if (!res.ok) {
    const code =
      parsed?.code ||
      (res.status === 503
        ? 'SERVICE_UNAVAILABLE'
        : res.status === 502 || res.status === 504
        ? 'GATEWAY_TIMEOUT'
        : res.status === 401
        ? 'UNAUTHENTICATED'
        : res.status === 403
        ? 'FORBIDDEN'
        : 'HTTP_ERROR');
    return {
      ok: false,
      data: parsed,
      statusCode: res.status,
      contentType,
      requestId,
      code,
      error:
        parsed?.error ||
        (res.status === 503
          ? 'Layanan backend atau database sementara tidak tersedia (HTTP 503). Silakan coba lagi.'
          : `Permintaan ke ${endpoint} gagal (HTTP ${res.status}).`)
    };
  }

  return {
    ok: true,
    data: parsed as T,
    statusCode: res.status,
    contentType,
    requestId,
    code: parsed?.code
  };
}

class RequestTimeoutError extends Error {
  constructor(message = 'Koneksi atau waktu permintaan habis saat menunggu respons server.') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

export function isTimeoutOrNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof RequestTimeoutError) return true;
  const msg = String((err as any)?.message || '').toLowerCase();
  const name = String((err as any)?.name || '');
  return (
    name === 'AbortError' ||
    name === 'TypeError' ||
    msg.includes('timeout') ||
    msg.includes('batas waktu') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('504') ||
    msg.includes('502')
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 25_000): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new RequestTimeoutError('Permintaan ke server melebihi batas waktu (timeout).');
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function formatTransportError(err: unknown, fallback: string): { error: string; code: string } {
  if (err instanceof RequestTimeoutError) {
    return { error: err.message, code: 'REQUEST_TIMEOUT' };
  }
  const msg = String((err as any)?.message || '');
  if (isTimeoutOrNetworkError(err)) {
    return {
      error: 'Koneksi jaringan ke server terputus atau timeout. Periksa koneksi lalu klik Coba Lagi.',
      code: 'NETWORK_ERROR'
    };
  }
  return { error: msg || fallback, code: 'CLIENT_FETCH_ERROR' };
}

export async function fetchDeletionCategoriesSummary(): Promise<{
  success: boolean;
  summary?: CategoryCountsSummaryMap;
  error?: string;
  code?: string;
  requestId?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/deletion/categories-summary', {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    const parsed = await parseDeletionApiResponse<any>(res, '/api/deletion/categories-summary');
    if (!parsed.ok || !parsed.data?.success) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || `Gagal memuat ringkasan kategori (${res.status})`,
        code: parsed.code || parsed.data?.code,
        requestId: parsed.requestId
      };
    }
    return { success: true, summary: parsed.data.summary, requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal memuat ringkasan kategori.');
    return { success: false, ...info };
  }
}

export async function fetchDeletionFacets(category: DeletionCategory): Promise<{
  success: boolean;
  facets?: DeletionFacets;
  error?: string;
  code?: string;
  requestId?: string;
}> {
  try {
    const qs = new URLSearchParams({ category });
    const res = await fetchWithTimeout(`/api/deletion/facets?${qs.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    const parsed = await parseDeletionApiResponse<any>(res, '/api/deletion/facets');
    if (!parsed.ok || !parsed.data?.success) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || `Gagal memuat opsi filter (${res.status})`,
        code: parsed.code || parsed.data?.code,
        requestId: parsed.requestId
      };
    }
    return { success: true, facets: parsed.data.facets, requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal memuat opsi dropdown filter.');
    return { success: false, ...info };
  }
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

export async function fetchDeletionItems(
  params: FetchDeletionItemsParams
): Promise<DeletionListResponse & { requestId?: string }> {
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

  try {
    const res = await fetchWithTimeout(`/api/deletion/items?${qs.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    const parsed = await parseDeletionApiResponse<DeletionListResponse>(res, '/api/deletion/items');
    if (!parsed.ok || !parsed.data?.success) {
      return {
        success: false,
        items: [],
        total: 0,
        page: 1,
        pageSize: params.pageSize || 25,
        totalPages: 1,
        error: parsed.error || parsed.data?.error || `Gagal mengambil daftar data (${res.status})`,
        code: parsed.code || parsed.data?.code,
        requestId: parsed.requestId
      };
    }
    return { ...(parsed.data as DeletionListResponse), requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal mengambil daftar data.');
    return {
      success: false,
      items: [],
      total: 0,
      page: 1,
      pageSize: params.pageSize || 25,
      totalPages: 1,
      ...info
    };
  }
}

export async function inspectRecordDependencies(
  category: DeletionCategory,
  id: string
): Promise<{
  success: boolean;
  dependencies?: WoDependencySummary;
  error?: string;
  code?: string;
  requestId?: string;
}> {
  const endpoint = `/api/deletion/dependencies/${encodeURIComponent(category)}/${encodeURIComponent(id)}`;
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    const parsed = await parseDeletionApiResponse<any>(res, endpoint);
    if (!parsed.ok || !parsed.data?.success) {
      return {
        success: false,
        error: parsed.error || parsed.data?.error || `Gagal memeriksa dependensi (${res.status})`,
        code: parsed.code || parsed.data?.code,
        requestId: parsed.requestId
      };
    }
    return { success: true, dependencies: parsed.data.dependencies, requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal memeriksa dependensi record.');
    return { success: false, ...info };
  }
}

export async function inspectBatchDependencies(
  category: DeletionCategory,
  recordIds: string[]
): Promise<BatchDependenciesResponse & { requestId?: string }> {
  try {
    const res = await fetchWithTimeout('/api/deletion/dependencies/batch', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ category, recordIds })
    });
    const parsed = await parseDeletionApiResponse<BatchDependenciesResponse>(res, '/api/deletion/dependencies/batch');
    if (!parsed.ok || !parsed.data?.success) {
      return {
        success: false,
        items: [],
        blockedCount: 0,
        eligibleCount: 0,
        error: parsed.error || parsed.data?.error || `Gagal memeriksa dependensi batch (${res.status})`,
        code: parsed.code || parsed.data?.code,
        requestId: parsed.requestId
      };
    }
    return { ...(parsed.data as BatchDependenciesResponse), requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal memeriksa dependensi batch.');
    return {
      success: false,
      items: [],
      blockedCount: 0,
      eligibleCount: 0,
      ...info
    };
  }
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
  requestId?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/deletion/soft-delete', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    }, 30_000);
    const parsed = await parseDeletionApiResponse<any>(res, '/api/deletion/soft-delete');
    const json = parsed.data || {};
    if (!parsed.ok || (!json.success && (!json.succeeded || json.succeeded.length === 0))) {
      return {
        success: false,
        transactionId: json.transactionId,
        succeeded: json.succeeded || [],
        failed: json.failed || [],
        error: parsed.error || json.error || `Gagal menjalankan soft delete (${res.status})`,
        code: parsed.code || json.code,
        requestId: parsed.requestId
      };
    }
    return { ...json, requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal menghubungi server saat soft delete.');
    return { success: false, succeeded: [], failed: [], ...info };
  }
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
  requestId?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/deletion/permanent-delete', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    }, 30_000);
    const parsed = await parseDeletionApiResponse<any>(res, '/api/deletion/permanent-delete');
    const json = parsed.data || {};
    if (!parsed.ok || !json.success) {
      return {
        success: false,
        transactionId: json.transactionId,
        relatedCounts: json.relatedCounts,
        error: parsed.error || json.error || `Hapus permanen ditolak (${res.status})`,
        code: parsed.code || json.code,
        requestId: parsed.requestId
      };
    }
    return { ...json, requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal menghubungi server saat hapus permanen.');
    return { success: false, ...info };
  }
}

const ACTIVE_PERM_DELETE_STORAGE_KEY = 'morajaws_active_perm_delete_op';

export function saveActivePermanentDeleteOpId(operationId: string): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(
        ACTIVE_PERM_DELETE_STORAGE_KEY,
        JSON.stringify({ operationId, savedAt: Date.now() })
      );
    }
  } catch {}
}

export function loadSavedPermanentDeleteOpId(): string | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(ACTIVE_PERM_DELETE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.operationId && Date.now() - Number(parsed.savedAt || 0) < 30 * 60_000) {
        return String(parsed.operationId);
      }
    }
  } catch {}
  return null;
}

export function clearSavedPermanentDeleteOpId(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(ACTIVE_PERM_DELETE_STORAGE_KEY);
    }
  } catch {}
}

export function createClientOperationId(): string {
  const rnd =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 12);
  return `op_pd_${Date.now()}_${rnd}`;
}

export async function startPermanentDeleteOperationApi(payload: {
  targets: Array<{
    category: DeletionCategory;
    recordId: string;
    subEntity?: DeletionSubEntity;
    woNumber?: string;
    label?: string;
  }>;
  confirmText: string;
  reason: string;
  operationId?: string;
  chunkSize?: number;
}): Promise<{
  success: boolean;
  alreadyInProgress?: boolean;
  alreadyCompleted?: boolean;
  operation?: PermanentDeleteOperationState;
  error?: string;
  code?: string;
  requestId?: string;
}> {
  const res = await fetchWithTimeout(
    '/api/deletion/permanent-delete-batch/start',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    },
    20_000
  );
  if (res.status === 502 || res.status === 504) {
    throw new RequestTimeoutError(`Server gateway timeout (${res.status}).`);
  }
  const parsed = await parseDeletionApiResponse<any>(res, '/api/deletion/permanent-delete-batch/start');
  if (parsed.isWarmupHtml) {
    throw new RequestTimeoutError(parsed.error || 'Server merespons halaman warmup saat memulai operasi.');
  }
  const json = parsed.data || {};
  if (!parsed.ok || !json.success) {
    return {
      success: false,
      error: parsed.error || json.error || `Gagal memulai operasi hapus permanen (${res.status})`,
      code: parsed.code || json.code,
      requestId: parsed.requestId
    };
  }
  return { ...json, requestId: parsed.requestId };
}

export async function stepPermanentDeleteOperationApi(
  operationId: string,
  chunkSize = 5
): Promise<{
  success: boolean;
  inProgress?: boolean;
  operation?: PermanentDeleteOperationState;
  error?: string;
  code?: string;
  requestId?: string;
}> {
  const res = await fetchWithTimeout(
    '/api/deletion/permanent-delete-batch/step',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ operationId, chunkSize })
    },
    22_000
  );
  if (res.status === 502 || res.status === 504) {
    throw new RequestTimeoutError(`Server gateway timeout (${res.status}).`);
  }
  const parsed = await parseDeletionApiResponse<any>(res, '/api/deletion/permanent-delete-batch/step');
  if (parsed.isWarmupHtml) {
    throw new RequestTimeoutError(parsed.error || 'Server merespons halaman warmup saat memproses chunk.');
  }
  const json = parsed.data || {};
  if (!parsed.ok || !json.success) {
    return {
      success: false,
      error: parsed.error || json.error || `Gagal memproses chunk hapus permanen (${res.status})`,
      code: parsed.code || json.code,
      operation: json.operation,
      requestId: parsed.requestId
    };
  }
  return { ...json, requestId: parsed.requestId };
}

export async function fetchPermanentDeleteOperationStatus(operationId: string): Promise<{
  success: boolean;
  operation?: PermanentDeleteOperationState;
  error?: string;
  code?: string;
  requestId?: string;
}> {
  const endpoint = `/api/deletion/operations/${encodeURIComponent(operationId)}`;
  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'GET',
        credentials: 'include',
        headers: getAuthHeaders()
      },
      12_000
    );
    const parsed = await parseDeletionApiResponse<any>(res, endpoint);
    const json = parsed.data || {};
    if (!parsed.ok || !json.success) {
      return {
        success: false,
        error: parsed.error || json.error || `Status operasi tidak ditemukan (${res.status})`,
        code: parsed.code || json.code,
        requestId: parsed.requestId
      };
    }
    return { ...json, requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal membaca status operasi.');
    return { success: false, ...info };
  }
}

export async function fetchActivePermanentDeleteOperations(): Promise<{
  success: boolean;
  operations: PermanentDeleteOperationState[];
  error?: string;
  code?: string;
  requestId?: string;
}> {
  try {
    const res = await fetchWithTimeout(
      '/api/deletion/operations/active',
      {
        method: 'GET',
        credentials: 'include',
        headers: getAuthHeaders()
      },
      12_000
    );
    const parsed = await parseDeletionApiResponse<any>(res, '/api/deletion/operations/active');
    const json = parsed.data || {};
    if (!parsed.ok || !json.success) {
      return {
        success: false,
        operations: [],
        error: parsed.error || json.error,
        code: parsed.code || json.code,
        requestId: parsed.requestId
      };
    }
    return { success: true, operations: json.operations || [], requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal memuat operasi penghapusan aktif.');
    return { success: false, operations: [], ...info };
  }
}

export async function fetchRecentPermanentDeleteAudit(limit = 60): Promise<RecentPermanentAuditResponse & { code?: string; requestId?: string }> {
  try {
    const res = await fetchWithTimeout(
      `/api/deletion/audit-permanent-recent?limit=${encodeURIComponent(String(limit))}`,
      {
        method: 'GET',
        credentials: 'include',
        headers: getAuthHeaders()
      },
      15_000
    );
    const parsed = await parseDeletionApiResponse<RecentPermanentAuditResponse>(res, '/api/deletion/audit-permanent-recent');
    const json = parsed.data;
    if (!parsed.ok || !json?.success) {
      return {
        success: false,
        totalLogsChecked: 0,
        recentLogs: [],
        woExistenceMap: {},
        error: parsed.error || json?.error || `Gagal memuat audit hapus permanen (${res.status})`,
        code: parsed.code,
        requestId: parsed.requestId
      };
    }
    return { ...json, requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal memuat audit hapus permanen terbaru.');
    return {
      success: false,
      totalLogsChecked: 0,
      recentLogs: [],
      woExistenceMap: {},
      ...info
    };
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

export async function resumeOrExecutePermanentDeleteOperation(params: {
  operationId: string;
  existingOperation?: PermanentDeleteOperationState;
  chunkSize?: number;
  onProgress?: (op: PermanentDeleteOperationState, stageText: string) => void;
}): Promise<{
  completed: boolean;
  recoveredFromTimeout?: boolean;
  needsResume?: boolean;
  operation?: PermanentDeleteOperationState;
  error?: string;
}> {
  const { operationId, chunkSize = 5, onProgress } = params;
  saveActivePermanentDeleteOpId(operationId);

  let op = params.existingOperation;
  if (!op) {
    const statusRes = await fetchPermanentDeleteOperationStatus(operationId);
    if (!statusRes.success || !statusRes.operation) {
      return { completed: false, error: statusRes.error || 'Status operasi tidak ditemukan.' };
    }
    op = statusRes.operation;
  }

  let recoveredFromTimeout = false;
  let consecutiveWaitLoops = 0;

  while (op.status === 'preparing' || op.status === 'verifying' || op.status === 'processing') {
    onProgress?.(
      op,
      `Sedang menghapus: ${op.processedCount} dari ${op.totalCount} data diproses (${op.succeededCount} berhasil)...`
    );

    try {
      const stepRes = await stepPermanentDeleteOperationApi(operationId, chunkSize);
      if (stepRes.operation) {
        op = stepRes.operation;
      }

      if (!stepRes.success) {
        return {
          completed: false,
          recoveredFromTimeout,
          needsResume: true,
          operation: op,
          error: stepRes.error || 'Gagal memproses batch hapus permanen.'
        };
      }

      if (stepRes.inProgress) {
        consecutiveWaitLoops++;
        onProgress?.(
          op,
          `Operasi sedang diproses di server (${op.processedCount} dari ${op.totalCount})... Menunggu penyelesaian.`
        );
        if (consecutiveWaitLoops > 20) {
          return {
            completed: false,
            needsResume: true,
            operation: op,
            error: 'Operasi masih berjalan di server. Silakan pantau atau klik Lanjutkan nanti.'
          };
        }
        await sleepMs(1000);
        const pollRes = await fetchPermanentDeleteOperationStatus(operationId);
        if (pollRes.success && pollRes.operation) {
          op = pollRes.operation;
        }
      } else {
        consecutiveWaitLoops = 0;
      }
    } catch (err: any) {
      if (!isTimeoutOrNetworkError(err)) {
        return {
          completed: false,
          needsResume: true,
          operation: op,
          error: err?.message || 'Terjadi kesalahan saat menghapus.'
        };
      }

      // Timeout or dropped connection: reconcile actual status from server instead of failing blindly!
      onProgress?.(op, 'Koneksi terputus / melewati waktu tunggu. Memeriksa status transaksi di server...');
      let reconciled = false;
      for (let attempt = 1; attempt <= 4; attempt++) {
        await sleepMs(attempt * 1000);
        try {
          const checkRes = await fetchPermanentDeleteOperationStatus(operationId);
          if (checkRes.success && checkRes.operation) {
            op = checkRes.operation;
            reconciled = true;
            recoveredFromTimeout = true;
            break;
          }
        } catch {
          // continue retry backoff
        }
      }

      if (!reconciled) {
        return {
          completed: false,
          recoveredFromTimeout,
          needsResume: true,
          operation: op,
          error:
            'Koneksi ke server terputus saat memproses batch. Klik "Cek Status & Lanjutkan" untuk memeriksa progres aktual tanpa menghapus ulang data yang sudah selesai.'
        };
      }

      if (op.status === 'completed' || op.status === 'partial' || op.status === 'failed') {
        break;
      }
    }
  }

  onProgress?.(op, op.stageLabel);
  return {
    completed: true,
    recoveredFromTimeout,
    operation: op
  };
}

export async function executeCentralizedPermanentDeleteBatch(payload: {
  targets: Array<{
    category: DeletionCategory;
    recordId: string;
    subEntity?: DeletionSubEntity;
    woNumber?: string;
    label?: string;
  }>;
  confirmText: string;
  reason: string;
  operationId?: string;
  onProgress?: (op: PermanentDeleteOperationState, stageText: string) => void;
}): Promise<{
  success: boolean;
  transactionId?: string;
  operationId?: string;
  operation?: PermanentDeleteOperationState;
  recoveredFromTimeout?: boolean;
  needsResume?: boolean;
  succeeded?: any[];
  failed?: Array<{ recordId: string; category: string; code: string; error: string }>;
  message?: string;
  error?: string;
  code?: string;
}> {
  const operationId = payload.operationId || createClientOperationId();
  saveActivePermanentDeleteOpId(operationId);

  let startRes: Awaited<ReturnType<typeof startPermanentDeleteOperationApi>>;
  try {
    startRes = await startPermanentDeleteOperationApi({
      targets: payload.targets,
      confirmText: payload.confirmText,
      reason: payload.reason,
      operationId,
      chunkSize: 5
    });
  } catch (err: any) {
    if (isTimeoutOrNetworkError(err)) {
      // Check whether start already registered the operation on server before timing out
      try {
        await sleepMs(900);
        const checkRes = await fetchPermanentDeleteOperationStatus(operationId);
        if (checkRes.success && checkRes.operation) {
          startRes = { success: true, operation: checkRes.operation };
        } else {
          return {
            success: false,
            operationId,
            needsResume: false,
            error: 'Koneksi ke server terputus sebelum operasi dimulai. Tidak ada data yang dihapus; silakan coba lagi.'
          };
        }
      } catch {
        return {
          success: false,
          operationId,
          needsResume: false,
          error: 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.'
        };
      }
    } else {
      throw err;
    }
  }

  if (!startRes.success || !startRes.operation) {
    clearSavedPermanentDeleteOpId();
    return {
      success: false,
      operationId,
      error: startRes.error || 'Hapus permanen batch ditolak oleh server.',
      code: startRes.code
    };
  }

  const runRes = await resumeOrExecutePermanentDeleteOperation({
    operationId: startRes.operation.operationId,
    existingOperation: startRes.operation,
    chunkSize: 5,
    onProgress: payload.onProgress
  });

  const op = runRes.operation;
  if (!op) {
    return {
      success: false,
      operationId,
      needsResume: runRes.needsResume,
      error: runRes.error || 'Gagal menyelesaikan operasi hapus permanen.'
    };
  }

  const succeeded = op.results
    .filter(r => r.status === 'deleted' || r.status === 'already_deleted')
    .map(r => ({ deletedId: r.recordId, woNumber: r.woNumber, status: r.status }));
  const failed = op.results
    .filter(r => r.status === 'blocked_fk' || r.status === 'protected' || r.status === 'failed')
    .map(r => ({
      recordId: r.recordId,
      category: r.category,
      code: r.code || 'PERMANENT_DELETE_FAILED',
      error: r.message || 'Gagal menghapus.'
    }));

  if (runRes.completed) {
    clearSavedPermanentDeleteOpId();
  }

  return {
    success: runRes.completed && failed.length === 0 && succeeded.length > 0,
    transactionId: op.results.find(r => r.transactionId)?.transactionId || op.operationId,
    operationId: op.operationId,
    operation: op,
    recoveredFromTimeout: runRes.recoveredFromTimeout,
    needsResume: runRes.needsResume,
    succeeded,
    failed,
    error: runRes.error || (failed.length > 0 && succeeded.length === 0 ? failed[0].error : undefined),
    message:
      op.status === 'completed'
        ? `Berhasil menghapus permanen ${op.succeededCount} data (${op.alreadyDeletedCount} sudah terhapus sebelumnya).`
        : op.status === 'partial'
        ? `Selesai sebagian: ${op.succeededCount + op.alreadyDeletedCount} selesai, ${op.blockedCount + op.failedCount} gagal/diblokir.`
        : undefined
  };
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
  requestId?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/deletion/restore', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    }, 30_000);
    const parsed = await parseDeletionApiResponse<any>(res, '/api/deletion/restore');
    const json = parsed.data || {};
    if (!parsed.ok || (!json.success && (!json.succeeded || json.succeeded.length === 0))) {
      return {
        success: false,
        transactionId: json.transactionId,
        succeeded: json.succeeded || [],
        failed: json.failed || [],
        error: parsed.error || json.error || `Gagal memulihkan data (${res.status})`,
        code: parsed.code || json.code,
        requestId: parsed.requestId
      };
    }
    return { ...json, requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal menghubungi server saat memulihkan data.');
    return { success: false, succeeded: [], failed: [], ...info };
  }
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
}): Promise<DeletionHistoryResponse & { requestId?: string }> {
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

  try {
    const res = await fetchWithTimeout(`/api/deletion/history?${qs.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    const parsed = await parseDeletionApiResponse<DeletionHistoryResponse>(res, '/api/deletion/history');
    if (!parsed.ok || !parsed.data?.success) {
      return {
        success: false,
        logs: [],
        total: 0,
        page: 1,
        pageSize: params.pageSize || 25,
        totalPages: 1,
        error: parsed.error || parsed.data?.error || `Gagal memuat riwayat penghapusan (${res.status})`,
        code: parsed.code || parsed.data?.code,
        requestId: parsed.requestId
      };
    }
    return { ...(parsed.data as DeletionHistoryResponse), requestId: parsed.requestId };
  } catch (err) {
    const info = formatTransportError(err, 'Gagal memuat riwayat penghapusan.');
    return {
      success: false,
      logs: [],
      total: 0,
      page: 1,
      pageSize: params.pageSize || 25,
      totalPages: 1,
      ...info
    };
  }
}

export function navigateToDataDeletion(context?: DeletionNavContext): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<DeletionNavContext | undefined>('morajaws:navigate-data-deletion', {
      detail: context
    })
  );
}

