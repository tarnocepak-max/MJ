import { Ticket, User, Contractor, CoverageArea, TicketMessage, AuditLog, WOKpiSummary, ProgressReportHistoryItem, OverdueSummaryMetrics, WoClassificationSummary, RealtimeConnectionState, RealtimeDiagnosticLog, RealtimeStatusInfo } from '../types';
import { getAuthHeaders } from './authService';

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
  data?: T;
  updatedAt?: string | null;
  setting?: any;
  error?: SupabaseErrorPayload;
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
  installerName?: string;
  statusWOAgent?: string;
  statusWOInstaller?: string;
  appointmentDate?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
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

    try {
      const res = await fetch('/api/supabase/work-orders', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(ticket)
      });
      const json = await res.json();
      return json;
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghubungi backend Supabase proxy' }
      };
    }
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

    try {
      const res = await fetch(`/api/supabase/work-orders/${encodeURIComponent(id)}`, {
        headers: getAuthHeaders()
      });
      const json = await res.json();
      return json;
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal mengambil data dari Supabase proxy' }
      };
    }
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

    try {
      const query = new URLSearchParams(options as any).toString();
      const res = await fetch(`/api/supabase/work-orders?${query}`, {
        headers: getAuthHeaders()
      });
      const json = await res.json();
      return json;
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal mengambil list tiket dari Supabase proxy' }
      };
    }
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

    try {
      const res = await fetch(`/api/supabase/work-orders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates)
      });
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memperbarui data di Supabase proxy' }
      };
    }
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

    try {
      const res = await fetch(`/api/supabase/work-orders/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason, deletedBy })
      });
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal soft delete di Supabase proxy' }
      };
    }
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

    try {
      const res = await fetch(`/api/supabase/work-orders/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ archivedBy })
      });
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal mengarsipkan data di Supabase proxy' }
      };
    }
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
        deletedAt: undefined,
        updatedAt: new Date().toISOString()
      };
      SANDBOX_STORE.workOrders.set(id, restored);
      return { success: true, data: restored };
    }

    try {
      const res = await fetch(`/api/supabase/work-orders/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ restoredBy })
      });
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memulihkan data di Supabase proxy' }
      };
    }
  }

  /**
   * BATCH WRITE / BULK IMPORT: Insert multiple work orders with file and database deduplication
   */
  async batchCreateWorkOrders(tickets: Ticket[], batchId?: string, isSandbox = false): Promise<SupabaseResponse<any>> {
    if (isSandbox) {
      const summary = {
        totalSubmitted: tickets.length,
        imported: 0,
        skippedDuplicates: 0,
        duplicateInFile: [] as string[],
        duplicateExisting: [] as string[]
      };

      const seenInBatch = new Set<string>();

      for (const t of tickets) {
        const norm = (t.woNumber || '').trim().toUpperCase().replace(/\s+/g, '');
        if (seenInBatch.has(norm)) {
          summary.skippedDuplicates++;
          summary.duplicateInFile.push(norm);
          continue;
        }
        seenInBatch.add(norm);

        const existsInStore = Array.from(SANDBOX_STORE.workOrders.values()).some(
          x => (x.woNumber || '').trim().toUpperCase().replace(/\s+/g, '') === norm
        );

        if (existsInStore) {
          summary.skippedDuplicates++;
          summary.duplicateExisting.push(norm);
          continue;
        }

        const id = t.id || `migration_sandbox_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        SANDBOX_STORE.workOrders.set(id, { ...t, id, importBatchId: batchId || `sandbox_batch_${Date.now()}` });
        summary.imported++;
      }

      return { success: true, data: summary };
    }

    try {
      const res = await fetch('/api/supabase/work-orders/bulk-import', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ tickets, batchId })
      });
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal batch import di Supabase proxy' }
      };
    }
  }

  // ---------------------------------------------------------------------------
  // USER MANAGEMENT VIA EXPRESS BACKEND PROXY
  // ---------------------------------------------------------------------------

  async getUsers(includeDeleted = false): Promise<SupabaseResponse<User[]>> {
    try {
      const res = await fetch(`/api/supabase/users?includeDeleted=${includeDeleted}`, {
        headers: getAuthHeaders()
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat pengguna' } };
    }
  }

  async getUserById(id: string): Promise<SupabaseResponse<User | null>> {
    try {
      const res = await fetch(`/api/supabase/users/${encodeURIComponent(id)}`, {
        headers: getAuthHeaders()
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat detail pengguna' } };
    }
  }

  async createUser(user: Partial<User>): Promise<SupabaseResponse<User>> {
    try {
      const res = await fetch('/api/supabase/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(user)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal membuat pengguna' } };
    }
  }

  async updateUser(id: string, updates: Partial<User>): Promise<SupabaseResponse<User>> {
    try {
      const res = await fetch(`/api/supabase/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memperbarui pengguna' } };
    }
  }

  async deleteUser(id: string, reason: string): Promise<SupabaseResponse<any>> {
    try {
      const res = await fetch(`/api/supabase/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason })
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghapus pengguna' } };
    }
  }

  async resetUserPassword(id: string): Promise<SupabaseResponse<any>> {
    try {
      const res = await fetch(`/api/supabase/users/${encodeURIComponent(id)}/reset-password`, {
        method: 'POST',
        headers: getAuthHeaders()
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
      const res = await fetch('/api/supabase/contractors', {
        headers: getAuthHeaders()
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat kontraktor' } };
    }
  }

  async createContractor(contractor: Partial<Contractor>): Promise<SupabaseResponse<Contractor>> {
    try {
      const res = await fetch('/api/supabase/contractors', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(contractor)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menyimpan kontraktor' } };
    }
  }

  async updateContractor(id: string, updates: Partial<Contractor>): Promise<SupabaseResponse<Contractor>> {
    try {
      const res = await fetch(`/api/supabase/contractors/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memperbarui kontraktor' } };
    }
  }

  async deleteContractor(id: string): Promise<SupabaseResponse<boolean>> {
    try {
      const res = await fetch(`/api/supabase/contractors/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghapus kontraktor' } };
    }
  }

  async getCoverageAreas(): Promise<SupabaseResponse<CoverageArea[]>> {
    try {
      const res = await fetch('/api/supabase/coverage-areas', {
        headers: getAuthHeaders()
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat area coverage' } };
    }
  }

  async createCoverageArea(area: Partial<CoverageArea>): Promise<SupabaseResponse<CoverageArea>> {
    try {
      const res = await fetch('/api/supabase/coverage-areas', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(area)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menyimpan area coverage' } };
    }
  }

  async updateCoverageArea(id: string, updates: Partial<CoverageArea>): Promise<SupabaseResponse<CoverageArea>> {
    try {
      const res = await fetch(`/api/supabase/coverage-areas/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memperbarui area coverage' } };
    }
  }

  async deleteCoverageArea(id: string): Promise<SupabaseResponse<boolean>> {
    try {
      const res = await fetch(`/api/supabase/coverage-areas/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menghapus area coverage' } };
    }
  }

  async getWaTemplates(): Promise<SupabaseResponse<any[]>> {
    try {
      const res = await fetch('/api/supabase/wa-templates', {
        headers: getAuthHeaders()
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat template WhatsApp' } };
    }
  }

  async saveWaTemplate(template: any): Promise<SupabaseResponse<any>> {
    try {
      const res = await fetch('/api/supabase/wa-templates', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(template)
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal menyimpan template WhatsApp' } };
    }
  }

  async deleteWaTemplate(id: string): Promise<SupabaseResponse<boolean>> {
    try {
      const res = await fetch(`/api/supabase/wa-templates/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
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
      const res = await fetch(`/api/supabase/settings/${encodeURIComponent(key)}`, {
        headers: getAuthHeaders()
      });
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
      const res = await fetch(`/api/supabase/settings/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: getAuthHeaders(),
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
      const res = await fetch(`/api/supabase/audit-logs?limit=${limit}`, {
        headers: getAuthHeaders()
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: { code: 'NETWORK_ERROR', message: err?.message || 'Gagal memuat audit log' } };
    }
  }

  async markTicketMessagesDelivered(
    ticketId: string
  ): Promise<SupabaseResponse<{ updatedIds?: string[]; deliveredAt?: string }>> {
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/messages/delivered`, {
        method: 'POST',
        headers: getAuthHeaders()
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
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/messages/read`, {
        method: 'POST',
        headers: getAuthHeaders()
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
      const res = await fetch('/api/livechat/unread-summary', {
        headers: getAuthHeaders()
      });
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
      const res = await fetch(`/api/dashboard/kpi-summary${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders()
      });
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
      const res = await fetch(`/api/work-orders/${encodeURIComponent(ticketId)}/approve-report`, {
        method: 'POST',
        headers: getAuthHeaders(),
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
      const res = await fetch(`/api/work-orders/${encodeURIComponent(ticketId)}/request-revision`, {
        method: 'POST',
        headers: getAuthHeaders(),
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
      const res = await fetch(`/api/work-orders/progress-history${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders()
      });
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
      const res = await fetch(`/api/work-orders/overdue${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders()
      });
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
      const res = await fetch(`/api/work-orders/classifications${qs}`, {
        headers: getAuthHeaders()
      });
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

  public getRealtimeStatus(): RealtimeStatusInfo {
    return {
      state: this.sseConnectionState,
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
      this.addRealtimeLog('info', 'BROWSER_ONLINE', 'Jaringan perangkat kembali aktif. Menyambungkan ulang SSE...');
      this.sseReconnectAttempt = 0;
      this.ensureMultiplexedSse(true);
    });

    window.addEventListener('morajaws:auth-changed', () => {
      const nextToken = getAuthHeaders().Authorization || '';
      if (!nextToken) {
        this.teardownMultiplexedSse(true);
        return;
      }
      if (this.sseListeners.size > 0 && nextToken !== this.sseActiveToken) {
        this.addRealtimeLog('info', 'AUTH_TOKEN_ROTATED', 'Token sesi diperbarui. Menyambungkan ulang stream SSE...');
        this.sseReconnectAttempt = 0;
        this.teardownMultiplexedSse(true);
        this.ensureMultiplexedSse(true);
      }
    });
  }

  public reconnectRealtimeNow() {
    if (this.sseListeners.size === 0) return;
    this.addRealtimeLog('info', 'MANUAL_RECONNECT', 'Permintaan sambung ulang manual dari pengguna.');
    this.sseReconnectAttempt = 0;
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

  private ensureMultiplexedSse(isImmediateReconnect: boolean = false) {
    this.attachBrowserOnlineListeners();
    if (this.sseListeners.size === 0) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setRealtimeConnectionState('disconnected');
      return;
    }

    const authHeaders = getAuthHeaders();
    const currentToken = authHeaders.Authorization || '';
    if (!currentToken) {
      this.setRealtimeConnectionState('disconnected');
      return;
    }

    // If token changed, tear down old stream so new user gets clean scoped stream
    if (this.sseActiveToken && this.sseActiveToken !== currentToken) {
      this.teardownMultiplexedSse(true);
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
      try {
        const headers: Record<string, string> = {
          ...authHeaders,
          Accept: 'text/event-stream'
        };
        if (this.sseLastEventId) {
          headers['Last-Event-ID'] = this.sseLastEventId;
        }

        const response = await fetch('/api/supabase/realtime/stream', {
          headers,
          signal: abortController.signal
        });

        if (!response.ok || !response.body) {
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
          this.sseListeners.size > 0 &&
          (typeof navigator === 'undefined' || navigator.onLine !== false) &&
          (!abortController.signal.aborted || abortedByWatchdogOrError) &&
          Boolean(getAuthHeaders().Authorization);

        if (shouldRetry) {
          this.setRealtimeConnectionState('reconnecting');
          const attempt = this.sseReconnectAttempt;
          this.sseReconnectAttempt = attempt + 1;
          const baseDelay = Math.min(30000, 1000 * Math.pow(2, attempt));
          const jitter = Math.floor(Math.random() * 500);
          const delayMs = baseDelay + jitter;
          if (this.sseReconnectTimer) clearTimeout(this.sseReconnectTimer);
          this.addRealtimeLog('info', 'SSE_RETRY_SCHEDULED', `Percobaan ulang #${attempt + 1} dalam ${(delayMs / 1000).toFixed(1)}s`);
          this.sseReconnectTimer = setTimeout(() => {
            this.sseReconnectTimer = null;
            this.ensureMultiplexedSse(true);
          }, delayMs);
        } else if (this.sseListeners.size === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
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
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketIdOrWo)}/messages${suffix}`, {
        headers: { ...getAuthHeaders() }
      });
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
   * Subscribes to real-time events via shared multiplexed backend SSE stream.
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
