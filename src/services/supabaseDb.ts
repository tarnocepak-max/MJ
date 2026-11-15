import { Ticket, User, Contractor, CoverageArea, TicketMessage, AuditLog } from '../types';
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
  table?: 'work_orders' | 'ticket_messages' | 'audit_logs' | 'users' | 'app_settings' | 'contractors' | 'coverage_areas' | 'wa_templates' | 'system_operational_date';
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
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
   * SOFT DELETE: Mark work order as deleted (Restricted to Management Data)
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

  async markTicketMessagesRead(ticketId: string): Promise<SupabaseResponse<{ updatedCount: number }>> {
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

  // ---------------------------------------------------------------------------
  // SECURE REALTIME SUBSCRIPTION VIA BACKEND SERVER-SENT EVENTS (SSE)
  // ---------------------------------------------------------------------------

  /**
   * Subscribes to real-time events via backend SSE stream.
   * Completely avoids browser direct connection to Supabase database.
   * Backend enforces all authentication, role permissions, and scoped event filtering.
   */
  subscribeToChanges(options: RealtimeSubscriptionOptions): () => void {
    let isAborted = false;
    let abortController = new AbortController();

    const connectSse = async () => {
      try {
        const authHeaders = getAuthHeaders();
        const response = await fetch('/api/supabase/realtime/stream', {
          headers: {
            ...authHeaders,
            Accept: 'text/event-stream'
          },
          signal: abortController.signal
        });

        if (!response.ok || !response.body) {
          options.onError?.(new Error(`Koneksi SSE ditolak oleh server (Status: ${response.status})`));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!isAborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const block of lines) {
            const dataMatch = block.match(/data:\s*(.+)/);
            if (dataMatch) {
              try {
                const eventPayload = JSON.parse(dataMatch[1]);
                if (
                  (!options.table || eventPayload.table === options.table || eventPayload.entity === options.table) &&
                  (!options.event || options.event === '*' || eventPayload.eventType === options.event)
                ) {
                  options.onPayload(eventPayload);
                }
              } catch {}
            }
          }
        }
      } catch (err: any) {
        if (!isAborted) {
          options.onError?.(err);
          // Safe exponential backoff reconnection attempt
          setTimeout(() => {
            if (!isAborted) connectSse();
          }, 5000);
        }
      }
    };

    connectSse();

    return () => {
      isAborted = true;
      abortController.abort();
    };
  }
}

export const supabaseDb = SupabaseRepository.getInstance();
