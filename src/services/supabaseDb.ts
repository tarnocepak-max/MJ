import { Ticket, User, Contractor, CoverageArea, TicketMessage, AuditLog, WOKpiSummary, ProgressReportHistoryItem, OverdueSummaryMetrics, WoClassificationSummary, RealtimeConnectionState, RealtimeDiagnosticLog, RealtimeStatusInfo } from '../types';
import { authenticatedFetch, getAuthHeaders, getClientSessionIdentityKey, tryRefreshMoraJawsSession } from './authService';

// ==============================================================================
// MORAJAWS SUPABASE REPOSITORY LAYER (SECURE BACKEND PROXY ADAPTER)
// Strictly eliminates all direct browser-to-Supabase connections.
// Every database operation routes through the Express backend proxy:
// - Authorization: Bearer <token> is strictly attached to all requests.
// - Realtime subscriptions use Server-Sent Events (SSE) via /api/supabase/realtime/stream.
// - Backend enforces all RBAC, role scopes, and data sanitization.
// ==============================================================================

export interface SupabaseErrorPayload {
  code: string;
  message: string;
  httpStatus?: number;
  details?: any;
  hint?: string;
  table?: string;
  operation?: string;
  isSchemaError?: boolean;
  isDuplicate?: boolean;
  isNotFound?: boolean;
}

export interface SupabaseResponse<T = any> {
  success: boolean;
  partialSuccess?: boolean;
  data?: T;
  updatedAt?: string | null;
  setting?: any;
  error?: SupabaseErrorPayload;
}

async function fetchJsonSafe(
  url: string,
  init: RequestInit = {},
  timeoutMs = 25_000
): Promise<{ ok: boolean; status: number; json: any; networkError?: string; timedOut?: boolean }> {
  try {
    const res = await authenticatedFetch(url, init, { timeoutMs });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      json: null,
      timedOut: isAbort,
      networkError: isAbort
        ? 'Koneksi ke server melebihi batas waktu (timeout).'
        : (err?.message || 'Gagal menghubungi backend Supabase proxy')
    };
  }
}

function normalizeProxyError(
  status: number,
  json: any,
  operation: string,
  table: string,
  fallbackMessage: string
): SupabaseErrorPayload {
  const rawErr = json && typeof json === 'object' ? json.error : undefined;
  if (rawErr && typeof rawErr === 'object') {
    return {
      code: String(rawErr.code || json?.code || `HTTP_${status}`),
      message: String(rawErr.message || json?.message || fallbackMessage),
      httpStatus: Number(rawErr.httpStatus || status),
      details: rawErr.details,
      hint: rawErr.hint,
      table: rawErr.table || table,
      operation: rawErr.operation || operation,
      isSchemaError: Boolean(rawErr.isSchemaError),
      isDuplicate: Boolean(rawErr.isDuplicate),
      isNotFound: Boolean(rawErr.isNotFound)
    };
  }
  if (typeof rawErr === 'string' && rawErr.trim()) {
    return {
      code: String(json?.code || `HTTP_${status}`),
      message: rawErr.trim(),
      httpStatus: status,
      table,
      operation
    };
  }
  if (json && typeof json === 'object' && typeof json.message === 'string' && json.message.trim()) {
    return {
      code: String(json.code || `HTTP_${status}`),
      message: json.message.trim(),
      httpStatus: status,
      table,
      operation
    };
  }
  return {
    code: `HTTP_${status}`,
    message: `${fallbackMessage} (HTTP ${status})`,
    httpStatus: status,
    table,
    operation
  };
}

export function formatSupabaseErrorMessage(err: any, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  const baseMsg = typeof err.message === 'string' && err.message.trim() ? err.message.trim() : fallback;
  const metaParts: string[] = [];
  if (err.httpStatus) metaParts.push(`HTTP ${err.httpStatus}`);
  if (err.code && err.code !== `HTTP_${err.httpStatus}`) metaParts.push(`Code: ${err.code}`);
  if (err.table) metaParts.push(`Tabel: ${err.table}`);
  if (err.operation) metaParts.push(`Operasi: ${err.operation}`);
  const suffix = metaParts.length > 0 ? ` [${metaParts.join(' | ')}]` : '';
  const hint = typeof err.hint === 'string' && err.hint.trim() ? ` (${err.hint.trim()})` : '';
  return `${baseMsg}${suffix}${hint}`;
}

export interface WorkOrderFilterOptions {
  area?: string;
  contractorId?: string;
  contractor?: string;
  installerName?: string;
  statusWOAgent?: string;
  statusWOInstaller?: string;
  appointmentDate?: string;
  search?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  page?: number;
  lightweight?: boolean;
}

export interface RealtimeSubscriptionOptions {
  table?: 'work_orders' | 'ticket_messages' | 'progress_reports' | 'audit_logs' | 'users' | 'app_settings' | 'roles' | 'contractors' | 'coverage_areas' | 'wa_templates' | 'system_operational_date' | 'installer_tracking' | 'presence' | 'livechat_ephemeral';
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | 'TYPING' | 'PRESENCE_UPDATE' | 'DELIVERY_RECEIPT' | 'READ_RECEIPT' | 'ACCESS_REVOKED' | '*';
  filter?: string;
  onPayload: (payload: any) => void;
  onError?: (error: any) => void;
}

// In-Memory Sandbox Mock Store for isolated local testing
const SANDBOX_STORE = {
  workOrders: new Map<string, Ticket>(),
  messages: new Map<string, TicketMessage>(),
  auditLogs: new Array<AuditLog>()
};

export class SupabaseRepository {
  private static instance: SupabaseRepository;

  private constructor() {}

  public static getInstance(): SupabaseRepository {
    if (!SupabaseRepository.instance) {
      SupabaseRepository.instance = new SupabaseRepository();
    }
    return SupabaseRepository.instance;
  }

  // ---------------------------------------------------------------------------
  // WORK ORDER OPERATIONS VIA EXPRESS BACKEND PROXY
  // ---------------------------------------------------------------------------

  /**
   * CREATE: Insert a work order via Express Backend Proxy
   */
  async createWorkOrder(ticket: Ticket, isSandbox = false): Promise<SupabaseResponse<Ticket>> {
    if (isSandbox || ticket.id?.startsWith('migration_sandbox') || ticket.woNumber?.startsWith('SANDBOX-')) {
      const id = ticket.id || `migration_sandbox_${Date.now()}`;
      if (Array.from(SANDBOX_STORE.workOrders.values()).some(t => t.woNumber.toUpperCase() === ticket.woNumber.toUpperCase())) {
        return {
          success: false,
          error: {
            code: '23505',
            isDuplicate: true,
            message: `Duplikasi terdeteksi: Nomor WO ${ticket.woNumber} sudah ada.`
          }
        };
      }
      const newTicket: Ticket = {
        ...ticket,
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      SANDBOX_STORE.workOrders.set(id, newTicket);
      return { success: true, data: newTicket };
    }

    const { ok, status, json, networkError } = await fetchJsonSafe('/api/supabase/work-orders', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(ticket)
    });
    if (networkError) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: networkError }
      };
    }
    if (!ok || !json || json.success !== true) {
      return {
        success: false,
        error: normalizeProxyError(status, json, 'INSERT', 'work_orders', 'Gagal membuat Work Order di Supabase')
      };
    }
    return json;
  }

  /**
   * GET BY ID: Retrieve single work order via Express Backend Proxy
   */
  async getWorkOrderById(id: string, isSandbox = false): Promise<SupabaseResponse<Ticket | null>> {
    if (isSandbox || id.startsWith('migration_sandbox')) {
      const t = SANDBOX_STORE.workOrders.get(id);
      if (!t) {
        return {
          success: false,
          error: { code: 'PGRST116', isNotFound: true, message: `Work Order ${id} tidak ditemukan.` }
        };
      }
      return { success: true, data: t };
    }

    const { ok, status, json, networkError } = await fetchJsonSafe(`/api/supabase/work-orders/${encodeURIComponent(id)}`, {
      headers: getAuthHeaders()
    });
    if (networkError) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: networkError }
      };
    }
    if (!ok || !json || json.success !== true) {
      return {
        success: false,
        error: normalizeProxyError(status, json, 'SELECT', 'work_orders', 'Gagal mengambil detail Work Order')
      };
    }
    return json;
  }

  /**
   * GET LIST: Retrieve work orders with server-side RBAC scoping
   */
  async getWorkOrders(options: WorkOrderFilterOptions = {}, isSandbox = false): Promise<SupabaseResponse<Ticket[]>> {
    if (isSandbox) {
      let list = Array.from(SANDBOX_STORE.workOrders.values());
      if (!options.includeDeleted) list = list.filter(t => !t.isDeleted);
      if (!options.includeArchived) list = list.filter(t => !t.isArchived);
      if (options.area) list = list.filter(t => t.area === options.area);
      if (options.installerName) list = list.filter(t => t.installerName === options.installerName);
      if (options.appointmentDate) list = list.filter(t => t.appointmentDate === options.appointmentDate);
      return { success: true, data: list };
    }

    const qs = new URLSearchParams();
    Object.entries(options).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        qs.set(k, String(v));
      }
    });
    const { ok, status, json, networkError } = await fetchJsonSafe(`/api/supabase/work-orders?${qs.toString()}`, {
      headers: getAuthHeaders()
    });
    if (networkError) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: networkError }
      };
    }
    if (!ok || !json || json.success !== true) {
      return {
        success: false,
        error: normalizeProxyError(status, json, 'SELECT', 'work_orders', 'Gagal mengambil daftar Work Order')
      };
    }
    return json;
  }

  /**
   * PAGINATED GET: Retrieve a single page of Work Orders with server/DB-level filtering & projection
   */
  async getWorkOrdersPaginated(
    options: WorkOrderFilterOptions & { phase?: 'critical' | 'full'; sortBy?: string; sortDir?: 'asc' | 'desc' } = {}
  ): Promise<{
    success: boolean;
    tickets: Ticket[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    serverTime?: string;
    error?: string;
    httpStatus?: number;
  }> {
    try {
      const qs = new URLSearchParams();
      qs.set('phase', options.phase || 'critical');
      qs.set('page', String(options.page || 1));
      qs.set('limit', String(options.limit || 100));
      if (options.area) qs.set('area', options.area);
      if (options.contractor) qs.set('contractor', options.contractor);
      if (options.statusWOAgent) qs.set('statusWOAgent', options.statusWOAgent);
      if (options.statusWOInstaller) qs.set('statusWOInstaller', options.statusWOInstaller);
      if (options.appointmentDate) qs.set('appointmentDate', options.appointmentDate);
      if (options.search) qs.set('search', options.search);
      if (options.includeArchived) qs.set('includeArchived', 'true');
      if (options.sortBy) qs.set('sortBy', options.sortBy);
      if (options.sortDir) qs.set('sortDir', options.sortDir);

      const res = await fetch(`/api/work-orders/progressive?${qs.toString()}`, {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        return {
          success: false,
          tickets: [],
          total: 0,
          page: options.page || 1,
          limit: options.limit || 100,
          totalPages: 1,
          httpStatus: res.status,
          error: json?.error?.message || json?.error || `Gagal memuat data WO (${res.status})`
        };
      }
      return {
        success: true,
        tickets: Array.isArray(json.tickets) ? json.tickets : [],
        total: Number(json.total || 0),
        page: Number(json.page || 1),
        limit: Number(json.limit || 100),
        totalPages: Number(json.totalPages || 1),
        serverTime: json.serverTime
      };
    } catch (err: any) {
      return {
        success: false,
        tickets: [],
        total: 0,
        page: options.page || 1,
        limit: options.limit || 100,
        totalPages: 1,
        error: err?.message || 'Koneksi jaringan bermasalah saat memuat Work Order.'
      };
    }
  }

  /**
   * UPLOAD ASSET: Uploads image/signature/document via /api/storage/adapter/upload (Supabase Storage + public.attachments)
   * with bounded retry on transient network/5xx errors and explicit failure reporting.
   */
  async uploadAssetToStorage(params: {
    fileName: string;
    fileData: string;
    mimeType: string;
    fileCategory: 'image_report' | 'wo_document' | 'chat_attachment' | 'user_profile';
    relatedWoNumber?: string;
    ticketId?: string;
    maxRetries?: number;
  }): Promise<{
    success: boolean;
    downloadUrl?: string;
    storagePath?: string;
    fileId?: string;
    error?: string;
    httpStatus?: number;
  }> {
    const maxRetries = Math.min(2, Math.max(0, params.maxRetries ?? 1));
    let lastError = 'Gagal mengunggah lampiran.';
    let lastStatus = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 25_000) : null;
        const res = await fetch('/api/storage/adapter/upload', {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          signal: controller?.signal,
          body: JSON.stringify({
            fileName: params.fileName,
            fileData: params.fileData,
            mimeType: params.mimeType,
            fileCategory: params.fileCategory,
            relatedWoNumber: params.relatedWoNumber,
            ticketId: params.ticketId
          })
        });
        if (timer) clearTimeout(timer);

        lastStatus = res.status;
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success && json.downloadUrl) {
          return {
            success: true,
            downloadUrl: json.downloadUrl,
            storagePath: json.metadata?.filePath,
            fileId: json.metadata?.fileId
          };
        }

        lastError =
          res.status === 401
            ? 'Sesi login telah berakhir. Silakan login kembali.'
            : json?.error?.message || json?.error || `Upload gagal (${res.status})`;

        // Do not retry 4xx validation / auth / permission errors
        if (res.status >= 400 && res.status < 500) {
          return { success: false, error: lastError, httpStatus: res.status };
        }
      } catch (err: any) {
        lastError = err?.name === 'AbortError'
          ? 'Timeout jaringan saat mengunggah file ke server.'
          : err?.message || 'Koneksi terputus saat mengunggah file.';
      }

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }

    return { success: false, error: lastError, httpStatus: lastStatus || undefined };
  }

  /**
   * UPDATE: Partial update of a work order via Express Backend Proxy
   */
  async updateWorkOrder(id: string, updates: Partial<Ticket>, isSandbox = false): Promise<SupabaseResponse<Ticket>> {
    if (isSandbox || id.startsWith('migration_sandbox')) {
      const existing = SANDBOX_STORE.workOrders.get(id);
      if (!existing) {
        return {
          success: false,
          error: { code: 'PGRST116', isNotFound: true, message: `Work order ${id} tidak ditemukan.` }
        };
      }
      const updated: Ticket = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString()
      };
      SANDBOX_STORE.workOrders.set(id, updated);
      return { success: true, data: updated };
    }

    const { ok, status, json, networkError } = await fetchJsonSafe(`/api/supabase/work-orders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    if (networkError) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: networkError }
      };
    }
    if (!ok || !json || json.success !== true) {
      return {
        success: false,
        error: normalizeProxyError(status, json, 'UPDATE', 'work_orders', 'Gagal memperbarui Work Order di Supabase')
      };
    }
    return json;
  }

  /**
   * SOFT DELETE: Mark work order as deleted (Restricted to Superadmin)
   */
  async deleteWorkOrder(id: string, reason?: string, deletedBy?: string, isSandbox = false): Promise<SupabaseResponse<Ticket>> {
    if (isSandbox || id.startsWith('migration_sandbox')) {
      const existing = SANDBOX_STORE.workOrders.get(id);
      if (!existing) {
        return {
          success: false,
          error: { code: 'PGRST116', isNotFound: true, message: `Work order ${id} tidak ditemukan.` }
        };
      }
      const deleted: Ticket = {
        ...existing,
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: deletedBy || 'Tester',
        deletionReason: reason || 'Sandbox Soft Delete'
      };
      SANDBOX_STORE.workOrders.set(id, deleted);
      return { success: true, data: deleted };
    }

    const { ok, status, json, networkError } = await fetchJsonSafe(`/api/supabase/work-orders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason, deletedBy })
    });
    if (networkError) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: networkError }
      };
    }
    if (!ok || !json || json.success !== true) {
      return {
        success: false,
        error: normalizeProxyError(status, json, 'DELETE', 'work_orders', 'Gagal menghapus Work Order di Supabase')
      };
    }
    return json;
  }

  /**
   * ARCHIVE: Move work order to archive via Express Backend Proxy
   */
  async archiveWorkOrder(id: string, archivedBy?: string, isSandbox = false): Promise<SupabaseResponse<Ticket>> {
    if (isSandbox || id.startsWith('migration_sandbox')) {
      const existing = SANDBOX_STORE.workOrders.get(id);
      if (!existing) {
        return {
          success: false,
          error: { code: 'PGRST116', isNotFound: true, message: `Work order ${id} tidak ditemukan.` }
        };
      }
      const archived: Ticket = {
        ...existing,
        isArchived: true,
        archivedAt: new Date().toISOString(),
        archivedBy: archivedBy || 'Tester'
      };
      SANDBOX_STORE.workOrders.set(id, archived);
      return { success: true, data: archived };
    }

    const { ok, status, json, networkError } = await fetchJsonSafe(`/api/supabase/work-orders/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ archivedBy })
    });
    if (networkError) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: networkError }
      };
    }
    if (!ok || !json || json.success !== true) {
      return {
        success: false,
        error: normalizeProxyError(status, json, 'ARCHIVE', 'work_orders', 'Gagal mengarsipkan Work Order')
      };
    }
    return json;
  }

  /**
   * RESTORE: Restore an archived or soft-deleted work order via Express Backend Proxy
   */
  async restoreWorkOrder(id: string, restoredBy?: string, isSandbox = false): Promise<SupabaseResponse<Ticket>> {
    if (isSandbox || id.startsWith('migration_sandbox')) {
      const existing = SANDBOX_STORE.workOrders.get(id);
      if (!existing) {
        return {
          success: false,
          error: { code: 'PGRST116', isNotFound: true, message: `Work order ${id} tidak ditemukan.` }
        };
      }
      const restored: Ticket = {
        ...existing,
        isArchived: false,
        isDeleted: false,
        archivedAt: undefined,
        archivedBy: undefined,
        deletedAt: undefined,
        deletedBy: undefined,
        deletionReason: undefined,
        updatedAt: new Date().toISOString()
      };
      SANDBOX_STORE.workOrders.set(id, restored);
      return { success: true, data: restored };
    }

    const { ok, status, json, networkError } = await fetchJsonSafe(`/api/supabase/work-orders/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ restoredBy })
    });
    if (networkError) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: networkError }
      };
    }
    if (!ok || !json || json.success !== true) {
      return {
        success: false,
        error: normalizeProxyError(status, json, 'RESTORE', 'work_orders', 'Gagal memulihkan Work Order')
      };
    }
    return json;
  }

  /**
   * LIST SOFT-DELETED WORK ORDERS: Strictly Superadmin-authorized backend endpoint
   */
  async getDeletedWorkOrders(
    options: { search?: string; limit?: number } = {},
    isSandbox = false
  ): Promise<SupabaseResponse<Ticket[]>> {
    if (isSandbox) {
      const q = String(options.search || '').trim().toLowerCase();
      let list = Array.from(SANDBOX_STORE.workOrders.values()).filter(t => t.isDeleted === true);
      if (q) {
        list = list.filter(t =>
          String(t.woNumber || '').toLowerCase().includes(q) ||
          String(t.customerName || '').toLowerCase().includes(q) ||
          String(t.idCustomer || t.customerId || '').toLowerCase().includes(q) ||
          String(t.contactorName || t.contractorName || '').toLowerCase().includes(q) ||
          String(t.area || '').toLowerCase().includes(q) ||
          String(t.deletedBy || '').toLowerCase().includes(q)
        );
      }
      list.sort((a, b) => String(b.deletedAt || b.updatedAt || '').localeCompare(String(a.deletedAt || a.updatedAt || '')));
      return { success: true, data: list.slice(0, options.limit || 200) };
    }

    const qs = new URLSearchParams();
    if (options.search && options.search.trim()) qs.set('search', options.search.trim());
    if (options.limit) qs.set('limit', String(options.limit));
    const url = `/api/supabase/work-orders/deleted${qs.toString() ? `?${qs.toString()}` : ''}`;

    const { ok, status, json, networkError } = await fetchJsonSafe(url, {
      headers: getAuthHeaders()
    });
    if (networkError) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: networkError }
      };
    }
    if (!ok || !json || json.success !== true) {
      return {
        success: false,
        error: normalizeProxyError(status, json, 'SELECT', 'work_orders', 'Gagal mengambil daftar WO terhapus')
      };
    }
    return json;
  }

  /**
   * BATCH WRITE / BULK IMPORT: Chunked persistence with accurate partial-failure reporting & HTTP verification
   */
  async batchCreateWorkOrders(
    tickets: Ticket[],
    batchId?: string,
    isSandbox = false,
    options?: { chunkSize?: number }
  ): Promise<SupabaseResponse<any>> {
    if (!Array.isArray(tickets) || tickets.length === 0) {
      return {
        success: true,
        data: {
          totalSubmitted: 0,
          imported: 0,
          skippedDuplicates: 0,
          invalidCount: 0,
          failedCount: 0,
          partialSuccess: false,
          importedWoNumbers: [],
          failedWoNumbers: [],
          duplicateInFileWoNumbers: [],
          duplicateExistingWoNumbers: [],
          invalidRows: [],
          failedErrors: []
        }
      };
    }

    if (isSandbox) {
      const summary = {
        totalSubmitted: tickets.length,
        imported: 0,
        skippedDuplicates: 0,
        invalidCount: 0,
        failedCount: 0,
        partialSuccess: false,
        importedWoNumbers: [] as string[],
        failedWoNumbers: [] as string[],
        duplicateInFile: [] as string[],
        duplicateExisting: [] as string[],
        duplicateInFileWoNumbers: [] as string[],
        duplicateExistingWoNumbers: [] as string[],
        invalidRows: [] as Array<{ index: number; reason: string; rawWo?: string }>,
        failedErrors: [] as string[]
      };

      const seenInBatch = new Set<string>();

      for (const t of tickets) {
        const norm = String(t.woNumber || '').trim().toUpperCase().replace(/\s+/g, '');
        if (!norm || norm.length < 3) {
          summary.invalidCount++;
          continue;
        }
        if (seenInBatch.has(norm)) {
          summary.skippedDuplicates++;
          summary.duplicateInFile.push(norm);
          summary.duplicateInFileWoNumbers.push(norm);
          continue;
        }
        seenInBatch.add(norm);

        const existsInStore = Array.from(SANDBOX_STORE.workOrders.values()).some(
          x => String(x.woNumber || '').trim().toUpperCase().replace(/\s+/g, '') === norm
        );

        if (existsInStore) {
          summary.skippedDuplicates++;
          summary.duplicateExisting.push(norm);
          summary.duplicateExistingWoNumbers.push(norm);
          continue;
        }

        const id = t.id || `migration_sandbox_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        SANDBOX_STORE.workOrders.set(id, { ...t, id, importBatchId: batchId || `sandbox_batch_${Date.now()}` });
        summary.importedWoNumbers.push(norm);
        summary.imported++;
      }

      return { success: true, data: summary };
    }

    const chunkSize = Math.max(10, Math.min(100, options?.chunkSize || 60));
    const aggregated = {
      totalSubmitted: tickets.length,
      imported: 0,
      skippedDuplicates: 0,
      invalidCount: 0,
      failedCount: 0,
      partialSuccess: false,
      importedWoNumbers: [] as string[],
      failedWoNumbers: [] as string[],
      duplicateInFileWoNumbers: [] as string[],
      duplicateExistingWoNumbers: [] as string[],
      invalidRows: [] as Array<{ index: number; reason: string; rawWo?: string }>,
      failedErrors: [] as string[]
    };
    let lastErrorPayload: SupabaseErrorPayload | undefined;

    for (let offset = 0; offset < tickets.length; offset += chunkSize) {
      const chunk = tickets.slice(offset, offset + chunkSize);
      const chunkLabel = `Chunk ${Math.floor(offset / chunkSize) + 1}`;
      const chunkWoList = chunk.map(c => String(c?.woNumber || c?.workOrderNumber || '').trim().toUpperCase()).filter(Boolean);

      const { ok, status, json, networkError } = await fetchJsonSafe(
        '/api/supabase/work-orders/bulk-import',
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ tickets: chunk, batchId })
        },
        28_000
      );

      if (networkError) {
        aggregated.failedCount += chunk.length;
        aggregated.failedWoNumbers.push(...chunkWoList);
        aggregated.failedErrors.push(`${chunkLabel}: ${networkError}`);
        lastErrorPayload = { code: 'NETWORK_ERROR', message: networkError };
        continue;
      }

      const d = json?.data;
      if (d && typeof d === 'object') {
        aggregated.imported += Number(d.imported || 0);
        aggregated.skippedDuplicates += Number(d.skippedDuplicates || 0);
        aggregated.invalidCount += Number(d.invalidCount || 0);
        aggregated.failedCount += Number(d.failedCount || 0);
        if (Array.isArray(d.importedWoNumbers)) {
          aggregated.importedWoNumbers.push(...d.importedWoNumbers);
        }
        if (Array.isArray(d.failedWoNumbers)) {
          aggregated.failedWoNumbers.push(...d.failedWoNumbers);
        }
        if (Array.isArray(d.duplicateInFileWoNumbers)) {
          aggregated.duplicateInFileWoNumbers.push(...d.duplicateInFileWoNumbers);
        }
        if (Array.isArray(d.duplicateExistingWoNumbers)) {
          aggregated.duplicateExistingWoNumbers.push(...d.duplicateExistingWoNumbers);
        }
        if (Array.isArray(d.invalidRows)) {
          aggregated.invalidRows.push(
            ...d.invalidRows.map((ir: any) => ({ ...ir, index: offset + Number(ir.index || 0) }))
          );
        }
        if (Array.isArray(d.failedErrors)) {
          aggregated.failedErrors.push(...d.failedErrors);
        }
      }

      if (!ok || !json || json.success !== true) {
        const errPayload = normalizeProxyError(status, json, 'BULK_IMPORT', 'work_orders', `${chunkLabel} gagal disimpan ke database`);
        lastErrorPayload = errPayload;
        // If backend failed without structured per-row breakdown (e.g., 502/503/504/401/403), count whole chunk as failed
        if (!d || (Number(d.failedCount || 0) === 0 && Number(d.imported || 0) === 0 && Number(d.invalidCount || 0) === 0 && Number(d.skippedDuplicates || 0) === 0)) {
          aggregated.failedCount += chunk.length;
          aggregated.failedWoNumbers.push(...chunkWoList);
          aggregated.failedErrors.push(`${chunkLabel}: ${errPayload.message}`);
        }
      }
    }

    const totalInvalidOrFailed = aggregated.failedCount + (aggregated.invalidCount > 0 && aggregated.imported === 0 && aggregated.skippedDuplicates === 0 ? aggregated.invalidCount : 0);
    const hasErrors = aggregated.failedCount > 0 || aggregated.failedErrors.length > 0 || (aggregated.invalidCount > 0 && aggregated.imported === 0 && aggregated.skippedDuplicates === 0);
    aggregated.partialSuccess = aggregated.imported > 0 && (aggregated.failedCount > 0 || aggregated.failedErrors.length > 0);

    return {
      success: !hasErrors && totalInvalidOrFailed === 0,
      partialSuccess: aggregated.partialSuccess,
      data: aggregated,
      ...(hasErrors
        ? {
            error: lastErrorPayload || {
              code: aggregated.partialSuccess ? 'PARTIAL_IMPORT_FAILURE' : 'BULK_IMPORT_FAILED',
              message: aggregated.failedErrors[0] || aggregated.invalidRows[0]?.reason || `${aggregated.failedCount} Work Order gagal disimpan.`
            }
          }
        : {})
    };
  }

  // ---------------------------------------------------------------------------
  // USER MANAGEMENT VIA EXPRESS BACKEND PROXY
  // ---------------------------------------------------------------------------

  async getUsers(includeDeleted = false): Promise<SupabaseResponse<User[]>> {
    const { ok, status, json, networkError } = await fetchJsonSafe(`/api/supabase/users?includeDeleted=${includeDeleted}`, {
      headers: getAuthHeaders()
    });
    if (networkError) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: networkError } };
    }
    if (!ok || !json || json.success !== true) {
      return { success: false, error: normalizeProxyError(status, json, 'SELECT', 'users', 'Gagal memuat pengguna') };
    }
    return json;
  }

  async getUserById(id: string): Promise<SupabaseResponse<User | null>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/users/${encodeURIComponent(id)}`);
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat detail pengguna' } };
    }
  }

  async createUser(user: Partial<User>): Promise<SupabaseResponse<User>> {
    try {
      const res = await authenticatedFetch('/api/supabase/users', {
        method: 'POST',
        body: JSON.stringify(user)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal membuat pengguna' } };
    }
  }

  async updateUser(id: string, updates: Partial<User>): Promise<SupabaseResponse<User>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memperbarui pengguna' } };
    }
  }

  async deleteUser(id: string, reason: string): Promise<SupabaseResponse<any>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason })
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghapus pengguna' } };
    }
  }

  async resetUserPassword(id: string): Promise<SupabaseResponse<any>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/users/${encodeURIComponent(id)}/reset-password`, {
        method: 'POST'
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal reset password pengguna' } };
    }
  }

  // ---------------------------------------------------------------------------
  // CONTRACTORS & COVERAGE AREAS VIA EXPRESS BACKEND PROXY
  // ---------------------------------------------------------------------------

  async getContractors(): Promise<SupabaseResponse<Contractor[]>> {
    try {
      const res = await authenticatedFetch('/api/supabase/contractors');
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat kontraktor' } };
    }
  }

  async createContractor(contractor: Partial<Contractor>): Promise<SupabaseResponse<Contractor>> {
    try {
      const res = await authenticatedFetch('/api/supabase/contractors', {
        method: 'POST',
        body: JSON.stringify(contractor)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menyimpan kontraktor' } };
    }
  }

  async updateContractor(id: string, updates: Partial<Contractor>): Promise<SupabaseResponse<Contractor>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/contractors/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memperbarui kontraktor' } };
    }
  }

  async deleteContractor(id: string): Promise<SupabaseResponse<boolean>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/contractors/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghapus kontraktor' } };
    }
  }

  async getCoverageAreas(): Promise<SupabaseResponse<CoverageArea[]>> {
    try {
      const res = await authenticatedFetch('/api/supabase/coverage-areas');
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat area coverage' } };
    }
  }

  async createCoverageArea(area: Partial<CoverageArea>): Promise<SupabaseResponse<CoverageArea>> {
    try {
      const res = await authenticatedFetch('/api/supabase/coverage-areas', {
        method: 'POST',
        body: JSON.stringify(area)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menyimpan area coverage' } };
    }
  }

  async updateCoverageArea(id: string, updates: Partial<CoverageArea>): Promise<SupabaseResponse<CoverageArea>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/coverage-areas/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memperbarui area coverage' } };
    }
  }

  async deleteCoverageArea(id: string): Promise<SupabaseResponse<boolean>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/coverage-areas/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghapus area coverage' } };
    }
  }

  async getWaTemplates(): Promise<SupabaseResponse<any[]>> {
    try {
      const res = await authenticatedFetch('/api/supabase/wa-templates');
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat template WhatsApp' } };
    }
  }

  async saveWaTemplate(template: any): Promise<SupabaseResponse<any>> {
    try {
      const res = await authenticatedFetch('/api/supabase/wa-templates', {
        method: 'POST',
        body: JSON.stringify(template)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menyimpan template WhatsApp' } };
    }
  }

  async deleteWaTemplate(id: string): Promise<SupabaseResponse<boolean>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/wa-templates/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghapus template WhatsApp' } };
    }
  }

  // ---------------------------------------------------------------------------
  // APP CONFIGURATION & AUDIT LOGS VIA EXPRESS BACKEND PROXY
  // ---------------------------------------------------------------------------

  async getAppSetting(key: string): Promise<SupabaseResponse<any>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/settings/${encodeURIComponent(key)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(
            res.status,
            json,
            'SELECT',
            'app_settings',
            `Gagal memuat pengaturan "${key}"`
          )
        };
      }
      return json;
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: err?.message || `Koneksi jaringan gagal saat memuat pengaturan "${key}"`,
          table: 'app_settings',
          operation: 'SELECT'
        }
      };
    }
  }

  async saveAppSetting(key: string, value: any, description?: string): Promise<SupabaseResponse<boolean>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/settings/${encodeURIComponent(key)}`, {
        method: 'POST',
        body: JSON.stringify({ value, description })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(
            res.status,
            json,
            'UPSERT',
            'app_settings',
            `Gagal menyimpan pengaturan "${key}"`
          )
        };
      }
      return json;
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: err?.message || `Koneksi jaringan gagal saat menyimpan pengaturan "${key}"`,
          table: 'app_settings',
          operation: 'UPSERT'
        }
      };
    }
  }

  async getAuditLogs(limit = 100): Promise<SupabaseResponse<AuditLog[]>> {
    try {
      const res = await authenticatedFetch(`/api/supabase/audit-logs?limit=${limit}`);
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat audit log' } };
    }
  }

  async markTicketMessagesDelivered(
    ticketId: string
  ): Promise<SupabaseResponse<{ updatedIds?: string[]; deliveredAt?: string }>> {
    try {
      const res = await authenticatedFetch(`/api/tickets/${encodeURIComponent(ticketId)}/messages/delivered`, {
        method: 'POST'
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menandai pesan sudah diterima' } };
    }
  }

  async markTicketMessagesRead(
    ticketId: string
  ): Promise<SupabaseResponse<{ updatedIds?: string[]; readAt?: string }>> {
    try {
      const res = await authenticatedFetch(`/api/tickets/${encodeURIComponent(ticketId)}/messages/read`, {
        method: 'POST'
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menandai pesan sudah dibaca' } };
    }
  }

  async getLiveChatUnreadSummary(): Promise<{
    success: boolean;
    totalUnreadMessages?: number;
    unreadTicketsCount?: number;
    unreadByTicket?: Record<string, number>;
    error?: any;
  }> {
    try {
      const res = await authenticatedFetch('/api/livechat/unread-summary');
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat ringkasan unread' } };
    }
  }

  // ---------------------------------------------------------------------------
  // WO LIFECYCLE: KPI SUMMARY, DISPATCH APPROVAL / REVISION, PROGRESS HISTORY
  // ---------------------------------------------------------------------------

  async fetchDashboardKpiSummary(params?: {
    date?: string;
    contractor?: string;
    area?: string;
  }): Promise<SupabaseResponse<WOKpiSummary>> {
    try {
      const search = new URLSearchParams();
      if (params?.date) search.set('date', params.date);
      if (params?.contractor) search.set('contractor', params.contractor);
      if (params?.area) search.set('area', params.area);
      const qs = search.toString();
      const res = await authenticatedFetch(`/api/dashboard/kpi-summary${qs ? `?${qs}` : ''}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(res.status, json, 'SELECT', 'work_orders', 'Gagal memuat ringkasan KPI dashboard')
        };
      }
      return { success: true, data: json.summary || json.data };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghubungi server KPI dashboard' }
      };
    }
  }

  async approveWorkOrderReport(
    ticketId: string,
    notes?: string,
    options?: {
      woAgentStatus?: 'Done' | 'Pending' | 'Reschedule' | 'Cancel';
      remarksAgent?: string;
    }
  ): Promise<SupabaseResponse<Ticket>> {
    try {
      const payload: Record<string, any> = {
        notes: notes || ''
      };
      if (options?.woAgentStatus) {
        payload.woAgentStatus = options.woAgentStatus;
        payload.statusWOAgent = options.woAgentStatus;
      }
      if (options?.remarksAgent !== undefined) {
        payload.remarksAgent = options.remarksAgent;
      }
      const res = await authenticatedFetch(`/api/work-orders/${encodeURIComponent(ticketId)}/approve-report`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(res.status, json, 'APPROVE', 'work_orders', 'Gagal menyetujui laporan WO')
        };
      }
      return { success: true, data: json.ticket || json.data };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghubungi server approval WO' }
      };
    }
  }

  async requestWorkOrderRevision(ticketId: string, reason: string): Promise<SupabaseResponse<Ticket>> {
    try {
      const res = await authenticatedFetch(`/api/work-orders/${encodeURIComponent(ticketId)}/request-revision`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(res.status, json, 'REVISION', 'work_orders', 'Gagal meminta revisi laporan WO')
        };
      }
      return { success: true, data: json.ticket || json.data };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghubungi server revisi WO' }
      };
    }
  }

  async rescheduleWorkOrderAppointment(
    ticketId: string,
    payload: { appointmentDate: string; reason?: string }
  ): Promise<
    SupabaseResponse<Ticket> & {
      oldAppointmentDate?: string | null;
      newAppointmentDate?: string;
      operationalDateWIB?: string;
    }
  > {
    try {
      const res = await authenticatedFetch(
        `/api/work-orders/${encodeURIComponent(ticketId)}/reschedule-appointment`,
        {
          method: 'POST',
          body: JSON.stringify({
            appointmentDate: payload.appointmentDate,
            reason: payload.reason || ''
          })
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(
            res.status,
            json,
            'UPDATE',
            'work_orders',
            'Gagal mengubah Schedule Appointment Date Work Order'
          )
        };
      }
      return {
        success: true,
        data: json.ticket || json.data,
        oldAppointmentDate: json.oldAppointmentDate ?? null,
        newAppointmentDate: json.newAppointmentDate,
        operationalDateWIB: json.operationalDateWIB
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: err?.message || 'Koneksi jaringan gagal saat mengubah Schedule Appointment Date.'
        }
      };
    }
  }

  async fetchProgressReportHistory(params?: {
    search?: string;
    reportStatus?: string;
    approvalStatus?: string;
    contractor?: string;
    area?: string;
    dateFrom?: string;
    dateTo?: string;
    ticketId?: string;
  }): Promise<SupabaseResponse<ProgressReportHistoryItem[]>> {
    try {
      const search = new URLSearchParams();
      if (params?.search) search.set('search', params.search);
      if (params?.reportStatus) search.set('reportStatus', params.reportStatus);
      if (params?.approvalStatus) search.set('approvalStatus', params.approvalStatus);
      if (params?.contractor) search.set('contractor', params.contractor);
      if (params?.area) search.set('area', params.area);
      if (params?.dateFrom) search.set('dateFrom', params.dateFrom);
      if (params?.dateTo) search.set('dateTo', params.dateTo);
      if (params?.ticketId) search.set('ticketId', params.ticketId);
      const qs = search.toString();
      const res = await authenticatedFetch(`/api/work-orders/progress-history${qs ? `?${qs}` : ''}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(res.status, json, 'SELECT', 'wo_progress_report_history', 'Gagal memuat History Progress Report')
        };
      }
      return { success: true, data: json.data || [] };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat History Progress Report' }
      };
    }
  }

  async fetchOverdueWorkOrders(params?: {
    search?: string;
    contractor?: string;
    area?: string;
    leader?: string;
    installer?: string;
    durationBucket?: string;
    statusWOAgent?: string;
    statusWOInstaller?: string;
    sort?: 'asc' | 'desc';
  }): Promise<
    SupabaseResponse<{
      tickets: Ticket[];
      summary: OverdueSummaryMetrics;
      todayWIB: string;
      total: number;
    }>
  > {
    try {
      const search = new URLSearchParams();
      if (params?.search) search.set('search', params.search);
      if (params?.contractor && params.contractor !== 'ALL') search.set('contractor', params.contractor);
      if (params?.area && params.area !== 'ALL') search.set('area', params.area);
      if (params?.leader && params.leader !== 'ALL') search.set('leader', params.leader);
      if (params?.installer && params.installer !== 'ALL') search.set('installer', params.installer);
      if (params?.durationBucket && params.durationBucket !== 'ALL') search.set('durationBucket', params.durationBucket);
      if (params?.statusWOAgent && params.statusWOAgent !== 'ALL') search.set('statusWOAgent', params.statusWOAgent);
      if (params?.statusWOInstaller && params.statusWOInstaller !== 'ALL') search.set('statusWOInstaller', params.statusWOInstaller);
      if (params?.sort) search.set('sort', params.sort);
      const qs = search.toString();
      const res = await authenticatedFetch(`/api/work-orders/overdue${qs ? `?${qs}` : ''}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(res.status, json, 'SELECT', 'work_orders', 'Gagal memuat daftar Overdue WO')
        };
      }
      return {
        success: true,
        data: {
          tickets: Array.isArray(json.tickets) ? json.tickets : [],
          summary: json.summary,
          todayWIB: json.todayWIB,
          total: Number(json.total || 0)
        }
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghubungi endpoint Overdue WO' }
      };
    }
  }

  async fetchWoClassifications(category?: string): Promise<
    SupabaseResponse<{
      todayWIB: string;
      summary: WoClassificationSummary;
      overdueSummary: OverdueSummaryMetrics;
      exceptionTickets: Ticket[];
      tickets: Ticket[];
    }>
  > {
    try {
      const qs = category ? `?category=${encodeURIComponent(category)}` : '';
      const res = await authenticatedFetch(`/api/work-orders/classifications${qs}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success !== true) {
        return {
          success: false,
          error: normalizeProxyError(res.status, json, 'SELECT', 'work_orders', 'Gagal memuat klasifikasi WO')
        };
      }
      return {
        success: true,
        data: {
          todayWIB: json.todayWIB,
          summary: json.summary,
          overdueSummary: json.overdueSummary,
          exceptionTickets: Array.isArray(json.exceptionTickets) ? json.exceptionTickets : [],
          tickets: Array.isArray(json.tickets) ? json.tickets : []
        }
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghubungi endpoint klasifikasi WO' }
      };
    }
  }

  // ---------------------------------------------------------------------------
  // SECURE REALTIME SUBSCRIPTION VIA BACKEND SERVER-SENT EVENTS (SSE)
  // True state machine, exponential backoff + jitter, 45s heartbeat watchdog,
  // Last-Event-ID resume, sanitized ring-buffer logs, & reconnect hooks.
  // ---------------------------------------------------------------------------
  private sseListeners = new Set<RealtimeSubscriptionOptions>();
  private sseAbortController: AbortController | null = null;
  private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sseWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private sseActiveToken: string | null = null;
  private sseConnecting = false;
  private sseReconnectAttempt = 0;
  private sseConnectionState: RealtimeConnectionState = 'disconnected';
  private sseLastEventId: string | null = null;
  private sseLastConnectedAt: string | null = null;
  private sseLastEventAt: string | null = null;
  private sseLastHeartbeatAt: string | null = null;
  private sseBridgeStatus: string | null = null;
  private sseHasConnectedBefore = false;
  private sseWasDisconnected = false;
  private sseDiagnosticLogs: RealtimeDiagnosticLog[] = [];
  private sseStatusSubscribers = new Set<(status: RealtimeStatusInfo) => void>();
  private sseReconnectSubscribers = new Set<() => void>();
  private sseBrowserListenersAttached = false;
  private realtimeTransport: 'sse' | 'delta_polling' = 'sse';
  private recommendedPollMs = 15000;
  private capabilityCheckedToken: string | null = null;
  private capabilityCheckPromise: Promise<'sse' | 'delta_polling'> | null = null;

  private sanitizeDiagnosticText(input: string): string {
    return String(input || '')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/(token|password|secret|key)=([^&\s]+)/gi, '$1=[REDACTED]')
      .slice(0, 220);
  }

  public addRealtimeLog(level: 'info' | 'warn' | 'error', event: string, detail: string) {
    const entry: RealtimeDiagnosticLog = {
      id: `rlog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      event,
      detail: this.sanitizeDiagnosticText(detail)
    };
    this.sseDiagnosticLogs = [entry, ...this.sseDiagnosticLogs].slice(0, 80);
    this.emitRealtimeStatus();
  }

  public getRealtimeTransport(): 'sse' | 'delta_polling' {
    return this.realtimeTransport;
  }

  public setTransportHintFromServer(transport?: 'sse' | 'delta_polling', sseSupported?: boolean, pollMs?: number) {
    if (typeof pollMs === 'number' && pollMs >= 5000) {
      this.recommendedPollMs = pollMs;
    }
    const wantsPolling = transport === 'delta_polling' || sseSupported === false;
    if (wantsPolling) {
      const currentToken = getClientSessionIdentityKey();
      if (currentToken) this.capabilityCheckedToken = currentToken;
      const changed = this.realtimeTransport !== 'delta_polling';
      this.realtimeTransport = 'delta_polling';
      this.sseBridgeStatus = 'delta_polling';
      if (changed || this.sseConnectionState === 'connecting' || this.sseConnectionState === 'disconnected') {
        this.teardownMultiplexedSse(false);
        this.sseReconnectAttempt = 0;
        this.sseHasConnectedBefore = true;
        this.sseLastConnectedAt = this.sseLastConnectedAt || new Date().toISOString();
        this.setRealtimeConnectionState('connected');
        if (changed || this.sseDiagnosticLogs.every(l => l.event !== 'DELTA_POLLING_MODE')) {
          this.addRealtimeLog(
            'info',
            'DELTA_POLLING_MODE',
            `Runtime serverless terdeteksi — sinkronisasi dialihkan ke Delta Polling (${Math.round(this.recommendedPollMs / 1000)}s).`
          );
        }
      }
    }
  }

  public setDeltaPollingSyncOutcome(ok: boolean, details?: { eventAt?: string; error?: string; attempt?: number }) {
    if (this.realtimeTransport !== 'delta_polling') return;
    if (ok) {
      const nowIso = details?.eventAt || new Date().toISOString();
      this.sseReconnectAttempt = 0;
      this.sseLastHeartbeatAt = nowIso;
      if (!this.sseLastConnectedAt) this.sseLastConnectedAt = nowIso;
      this.sseLastEventAt = nowIso;
      this.sseBridgeStatus = 'delta_polling';
      this.setRealtimeConnectionState('connected');
    } else {
      this.sseReconnectAttempt = details?.attempt ?? (this.sseReconnectAttempt + 1);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.setRealtimeConnectionState('disconnected');
      } else {
        this.setRealtimeConnectionState('reconnecting');
      }
      if (details?.error) {
        this.addRealtimeLog('warn', 'DELTA_POLL_RETRY', details.error);
      }
    }
  }

  public dispatchExternalRealtimeEvent(eventPayload: {
    table: string;
    eventType: string;
    record: any;
    timestamp?: string;
  }) {
    if (!eventPayload) return;
    this.sseLastEventAt = eventPayload.timestamp || new Date().toISOString();
    for (const sub of Array.from(this.sseListeners)) {
      if (
        (!sub.table || eventPayload.table === sub.table || (eventPayload as any).entity === sub.table) &&
        (!sub.event || sub.event === '*' || eventPayload.eventType === sub.event)
      ) {
        try {
          sub.onPayload(eventPayload);
        } catch {}
      }
    }
    this.emitRealtimeStatus();
  }

  public getRealtimeStatus(): RealtimeStatusInfo {
    return {
      state: this.sseConnectionState,
      transport: this.realtimeTransport,
      recommendedPollMs: this.recommendedPollMs,
      reconnectAttempt: this.sseReconnectAttempt,
      lastEventId: this.sseLastEventId,
      lastConnectedAt: this.sseLastConnectedAt,
      lastEventAt: this.sseLastEventAt,
      lastHeartbeatAt: this.sseLastHeartbeatAt,
      bridgeStatus: this.sseBridgeStatus,
      logs: this.sseDiagnosticLogs
    };
  }

  private emitRealtimeStatus() {
    const snapshot = this.getRealtimeStatus();
    for (const cb of Array.from(this.sseStatusSubscribers)) {
      try {
        cb(snapshot);
      } catch {}
    }
  }

  private setRealtimeConnectionState(next: RealtimeConnectionState) {
    if (this.sseConnectionState === next) return;
    this.sseConnectionState = next;
    if (next === 'reconnecting' || next === 'disconnected') {
      if (this.sseHasConnectedBefore) {
        this.sseWasDisconnected = true;
      }
    }
    this.emitRealtimeStatus();
  }

  public subscribeRealtimeStatus(cb: (status: RealtimeStatusInfo) => void): () => void {
    this.sseStatusSubscribers.add(cb);
    try {
      cb(this.getRealtimeStatus());
    } catch {}
    return () => {
      this.sseStatusSubscribers.delete(cb);
    };
  }

  public subscribeReconnect(cb: () => void): () => void {
    this.sseReconnectSubscribers.add(cb);
    return () => {
      this.sseReconnectSubscribers.delete(cb);
    };
  }

  private attachBrowserOnlineListeners() {
    if (this.sseBrowserListenersAttached || typeof window === 'undefined') return;
    this.sseBrowserListenersAttached = true;

    window.addEventListener('offline', () => {
      this.addRealtimeLog('warn', 'BROWSER_OFFLINE', 'Koneksi jaringan perangkat terputus.');
      this.teardownMultiplexedSse(false);
      this.setRealtimeConnectionState('disconnected');
    });

    window.addEventListener('online', () => {
      if (this.sseListeners.size === 0) return;
      this.addRealtimeLog('info', 'BROWSER_ONLINE', 'Jaringan perangkat kembali aktif. Menyambungkan ulang sinkronisasi...');
      this.sseReconnectAttempt = 0;
      if (this.realtimeTransport === 'delta_polling') {
        this.setRealtimeConnectionState('connected');
        for (const cb of Array.from(this.sseReconnectSubscribers)) {
          try { cb(); } catch {}
        }
        return;
      }
      this.ensureMultiplexedSse(true);
    });

    window.addEventListener('morajaws:auth-changed', () => {
      const nextToken = getClientSessionIdentityKey() || '';
      if (!nextToken) {
        this.capabilityCheckedToken = null;
        this.capabilityCheckPromise = null;
        this.teardownMultiplexedSse(true);
        return;
      }
      if (this.sseListeners.size > 0 && nextToken !== this.sseActiveToken) {
        this.capabilityCheckedToken = null;
        this.capabilityCheckPromise = null;
        this.addRealtimeLog('info', 'AUTH_TOKEN_ROTATED', 'Token sesi diperbarui. Menyambungkan ulang sinkronisasi...');
        this.sseReconnectAttempt = 0;
        this.teardownMultiplexedSse(true);
        this.ensureMultiplexedSse(true);
      }
    });
  }

  public reconnectRealtimeNow() {
    if (this.sseListeners.size === 0) return;
    this.addRealtimeLog('info', 'MANUAL_RECONNECT', 'Permintaan sinkronisasi ulang manual dari pengguna.');
    this.sseReconnectAttempt = 0;
    if (this.realtimeTransport === 'delta_polling') {
      this.setRealtimeConnectionState('connecting');
      for (const cb of Array.from(this.sseReconnectSubscribers)) {
        try { cb(); } catch {}
      }
      this.setRealtimeConnectionState('connected');
      return;
    }
    this.teardownMultiplexedSse(false);
    this.ensureMultiplexedSse(true);
  }

  private resetHeartbeatWatchdog(abortController: AbortController) {
    if (this.sseWatchdogTimer) {
      clearTimeout(this.sseWatchdogTimer);
    }
    this.sseWatchdogTimer = setTimeout(() => {
      if (this.sseAbortController === abortController && !abortController.signal.aborted) {
        this.addRealtimeLog('warn', 'HEARTBEAT_TIMEOUT', 'Tidak menerima heartbeat SSE dalam 45 detik. Memicu reconnect...');
        abortController.abort();
      }
    }, 45000);
  }

  private async resolveRealtimeTransportCapability(authHeaders: Record<string, string>, currentToken: string): Promise<'sse' | 'delta_polling'> {
    if (this.capabilityCheckedToken === currentToken) {
      return this.realtimeTransport;
    }
    if (this.capabilityCheckPromise) {
      return this.capabilityCheckPromise;
    }

    this.capabilityCheckPromise = (async () => {
      try {
        const { ok, json } = await fetchJsonSafe('/api/realtime/status', { headers: authHeaders }, 6000);
        if (ok && json?.success) {
          this.capabilityCheckedToken = currentToken;
          if (typeof json.recommendedPollMs === 'number' && json.recommendedPollMs >= 5000) {
            this.recommendedPollMs = json.recommendedPollMs;
          }
          if (json.sseSupported === false || json.recommendedTransport === 'delta_polling') {
            this.realtimeTransport = 'delta_polling';
            this.sseBridgeStatus = 'delta_polling';
            return 'delta_polling';
          }
          this.realtimeTransport = 'sse';
          return 'sse';
        }
      } catch {}
      return this.realtimeTransport;
    })().finally(() => {
      this.capabilityCheckPromise = null;
    });

    return this.capabilityCheckPromise;
  }

  private ensureMultiplexedSse(isImmediateReconnect: boolean = false) {
    this.attachBrowserOnlineListeners();
    if (this.sseListeners.size === 0) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setRealtimeConnectionState('disconnected');
      return;
    }

    const authHeaders = getAuthHeaders();
    const currentToken = getClientSessionIdentityKey() || '';
    if (!currentToken) {
      this.setRealtimeConnectionState('disconnected');
      return;
    }

    // If token changed, tear down old stream so new user gets clean scoped stream
    if (this.sseActiveToken && this.sseActiveToken !== currentToken) {
      this.teardownMultiplexedSse(true);
    }

    if (this.realtimeTransport === 'delta_polling') {
      this.sseActiveToken = currentToken;
      this.sseBridgeStatus = 'delta_polling';
      this.sseHasConnectedBefore = true;
      if (!this.sseLastConnectedAt) this.sseLastConnectedAt = new Date().toISOString();
      this.setRealtimeConnectionState('connected');
      return;
    }

    if (this.sseConnecting || this.sseAbortController) return;

    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }

    this.sseConnecting = true;
    this.sseActiveToken = currentToken;
    this.setRealtimeConnectionState(
      isImmediateReconnect || this.sseHasConnectedBefore ? 'reconnecting' : 'connecting'
    );

    const abortController = new AbortController();
    this.sseAbortController = abortController;

    const runStream = async () => {
      let abortedByWatchdogOrError = false;
      let switchedToDeltaPolling = false;
      let immediateServerlessFallback = false;
      try {
        // Negotiate transport capability before opening an SSE connection
        const chosenTransport = await this.resolveRealtimeTransportCapability(authHeaders, currentToken);
        if (abortController.signal.aborted || this.sseListeners.size === 0) {
          return;
        }
        if (chosenTransport === 'delta_polling') {
          switchedToDeltaPolling = true;
          this.setTransportHintFromServer('delta_polling', false, this.recommendedPollMs);
          return;
        }

        const headers: Record<string, string> = {
          ...authHeaders,
          Accept: 'text/event-stream'
        };
        if (this.sseLastEventId) {
          headers['Last-Event-ID'] = this.sseLastEventId;
        }

        let response = await fetch('/api/supabase/realtime/stream', {
          credentials: 'include',
          headers,
          signal: abortController.signal
        });

        if (response.status === 401 && getClientSessionIdentityKey()) {
          const refreshed = await tryRefreshMoraJawsSession();
          if (refreshed && !abortController.signal.aborted) {
            const refreshedHeaders: Record<string, string> = {
              ...getAuthHeaders(),
              Accept: 'text/event-stream'
            };
            if (this.sseLastEventId) {
              refreshedHeaders['Last-Event-ID'] = this.sseLastEventId;
            }
            this.sseActiveToken = getClientSessionIdentityKey();
            response = await fetch('/api/supabase/realtime/stream', {
              credentials: 'include',
              headers: refreshedHeaders,
              signal: abortController.signal
            });
          } else {
            return;
          }
        }

        if (!response.ok || !response.body) {
          if (response.status === 504 || response.status === 502 || response.status === 404) {
            immediateServerlessFallback = true;
            throw new Error(`SSE gateway timeout (HTTP ${response.status})`);
          }
          throw new Error(`Koneksi SSE ditolak oleh server (Status: ${response.status})`);
        }

        this.resetHeartbeatWatchdog(abortController);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!abortController.signal.aborted && this.sseListeners.size > 0) {
          const { done, value } = await reader.read();
          if (done) break;

          // Every received frame or keepalive comment resets the 45s heartbeat watchdog
          this.resetHeartbeatWatchdog(abortController);
          const nowChunkIso = new Date().toISOString();
          this.sseLastHeartbeatAt = nowChunkIso;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';

          for (const block of blocks) {
            const lines = block.split('\n');
            const idLine = lines.find(l => l.startsWith('id:'));
            if (idLine) {
              const evtId = idLine.slice(3).trim();
              if (evtId) this.sseLastEventId = evtId;
            }
            const dataLines = lines
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trim());
            if (dataLines.length === 0) {
              this.emitRealtimeStatus();
              continue;
            }
            const rawJson = dataLines.join('\n');
            try {
              const eventPayload = JSON.parse(rawJson);
              this.sseLastEventAt = eventPayload?.timestamp || nowChunkIso;

              if (eventPayload?.type === 'SERVERLESS_DELTA_MODE' || eventPayload?.transport === 'delta_polling') {
                switchedToDeltaPolling = true;
                this.setTransportHintFromServer(
                  'delta_polling',
                  false,
                  Number(eventPayload.recommendedPollMs) || 15000
                );
                return;
              }

              if (eventPayload?.type === 'CONNECTED') {
                const wasReconnect = this.sseWasDisconnected || this.sseReconnectAttempt > 0;
                this.sseHasConnectedBefore = true;
                this.sseWasDisconnected = false;
                this.sseReconnectAttempt = 0;
                this.sseLastConnectedAt = nowChunkIso;
                if (eventPayload.bridgeStatus) {
                  this.sseBridgeStatus = String(eventPayload.bridgeStatus);
                }
                this.setRealtimeConnectionState('connected');
                this.addRealtimeLog(
                  'info',
                  wasReconnect ? 'SSE_RECONNECTED' : 'SSE_CONNECTED',
                  wasReconnect
                    ? 'Stream SSE tersambung kembali. Menjalankan delta catch-up...'
                    : 'Stream SSE aktif & terverifikasi.'
                );
                if (wasReconnect) {
                  for (const cb of Array.from(this.sseReconnectSubscribers)) {
                    try {
                      cb();
                    } catch {}
                  }
                }
                continue;
              }

              for (const sub of Array.from(this.sseListeners)) {
                if (
                  (!sub.table || eventPayload.table === sub.table || eventPayload.entity === sub.table) &&
                  (!sub.event || sub.event === '*' || eventPayload.eventType === sub.event)
                ) {
                  try {
                    sub.onPayload(eventPayload);
                  } catch {}
                }
              }
              this.emitRealtimeStatus();
            } catch {}
          }
        }
      } catch (err: any) {
        abortedByWatchdogOrError = true;
        if (this.sseListeners.size > 0) {
          const msg = err?.name === 'AbortError' ? 'Stream timeout / dibatalkan untuk reconnect.' : (err?.message || String(err));
          this.addRealtimeLog('warn', 'SSE_DISCONNECTED', msg);
          for (const sub of Array.from(this.sseListeners)) {
            sub.onError?.(err instanceof Error ? err : new Error(msg));
          }
        }
      } finally {
        if (this.sseWatchdogTimer) {
          clearTimeout(this.sseWatchdogTimer);
          this.sseWatchdogTimer = null;
        }
        this.sseConnecting = false;
        if (this.sseAbortController === abortController) {
          this.sseAbortController = null;
        }

        const shouldRetry =
          !switchedToDeltaPolling &&
          this.realtimeTransport !== 'delta_polling' &&
          this.sseListeners.size > 0 &&
          (typeof navigator === 'undefined' || navigator.onLine !== false) &&
          (!abortController.signal.aborted || abortedByWatchdogOrError) &&
          Boolean(getClientSessionIdentityKey());

        if (shouldRetry) {
          const attempt = this.sseReconnectAttempt;
          this.sseReconnectAttempt = attempt + 1;

          // On gateway 502/504/404 or after 2 failed SSE attempts, switch immediately to adaptive Delta Polling
          if (immediateServerlessFallback || this.sseReconnectAttempt >= 2) {
            this.setTransportHintFromServer('delta_polling', false, 15000);
            this.addRealtimeLog(
              'info',
              'SSE_FALLBACK_DELTA_POLLING',
              immediateServerlessFallback
                ? 'Serverless/gateway SSE tidak didukung (502/504) — beralih langsung ke Delta Polling adaptif.'
                : 'SSE gagal berulang kali — beralih otomatis ke mode Delta Polling adaptif.'
            );
            for (const cb of Array.from(this.sseReconnectSubscribers)) {
              try {
                cb();
              } catch {}
            }
            return;
          }

          this.setRealtimeConnectionState('reconnecting');
          const baseDelay = Math.min(30000, 1500 * Math.pow(2, attempt));
          const jitter = Math.floor(Math.random() * 750);
          const delayMs = baseDelay + jitter;
          if (this.sseReconnectTimer) clearTimeout(this.sseReconnectTimer);
          this.addRealtimeLog('info', 'SSE_RETRY_SCHEDULED', `Percobaan ulang #${attempt + 1} dalam ${(delayMs / 1000).toFixed(1)}s`);
          this.sseReconnectTimer = setTimeout(() => {
            this.sseReconnectTimer = null;
            this.ensureMultiplexedSse(true);
          }, delayMs);
        } else if (
          !switchedToDeltaPolling &&
          this.realtimeTransport !== 'delta_polling' &&
          (this.sseListeners.size === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false))
        ) {
          this.setRealtimeConnectionState('disconnected');
        }
      }
    };

    void runStream();
  }

  private teardownMultiplexedSse(resetState: boolean = true) {
    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }
    if (this.sseWatchdogTimer) {
      clearTimeout(this.sseWatchdogTimer);
      this.sseWatchdogTimer = null;
    }
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }
    this.sseConnecting = false;
    this.sseActiveToken = null;
    if (resetState) {
      this.sseReconnectAttempt = 0;
      this.sseHasConnectedBefore = false;
      this.sseWasDisconnected = false;
      this.setRealtimeConnectionState('disconnected');
    }
  }

  async getTicketMessagesPaginated(
    ticketIdOrWo: string,
    options?: { limit?: number; before?: string }
  ): Promise<{ success: boolean; messages: TicketMessage[]; hasMore: boolean; nextCursor: string | null; hasProgressTrigger?: boolean; error?: string }> {
    try {
      const qs = new URLSearchParams();
      if (options?.limit) qs.set('limit', String(options.limit));
      if (options?.before) qs.set('before', String(options.before));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await authenticatedFetch(`/api/tickets/${encodeURIComponent(ticketIdOrWo)}/messages${suffix}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          messages: [],
          hasMore: false,
          nextCursor: null,
          error: json?.error || `Gagal mengambil pesan (${res.status})`
        };
      }
      return {
        success: true,
        messages: Array.isArray(json.messages) ? json.messages : [],
        hasMore: Boolean(json.hasMore),
        nextCursor: json.nextCursor || null,
        hasProgressTrigger: Boolean(json.hasProgressTrigger)
      };
    } catch (err: any) {
      return {
        success: false,
        messages: [],
        hasMore: false,
        nextCursor: null,
        error: err?.message || 'Gagal menghubungi server pesan.'
      };
    }
  }

  /**
   * Subscribes to real-time events via shared multiplexed backend SSE stream or serverless delta-polling coordinator.
   * Completely avoids browser direct connection to Supabase database.
   * Backend enforces all authentication, role permissions, and scoped event filtering.
   */
  subscribeToChanges(options: RealtimeSubscriptionOptions): () => void {
    this.sseListeners.add(options);
    this.ensureMultiplexedSse();

    return () => {
      this.sseListeners.delete(options);
      if (this.sseListeners.size === 0) {
        this.teardownMultiplexedSse(true);
      }
    };
  }
}

export const supabaseDb = SupabaseRepository.getInstance();
