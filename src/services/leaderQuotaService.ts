import { Ticket, User } from '../types/index.ts';
import { getAuthHeaders } from './authService';
import { getTicketAppointmentDate } from './appointmentDateParser';

export interface LeaderQuotaConfig {
  contractorName: string;
  defaultMaxDailyQuota: number;
  enforceStrictLimit: boolean;
  customInstallerLimits: Record<string, number>;
  updatedBy?: string;
  updatedAt?: string;
}

export interface AssignmentFeedEntry {
  id: string;
  ticketId?: string;
  workOrderId?: string;
  woNumber: string;
  contractorName?: string;
  leaderName?: string;
  previousInstallerName?: string;
  newInstallerName?: string;
  installerName?: string;
  slotTime?: string;
  appointmentDate?: string;
  sourceAction?: string;
  previousStatus?: string;
  newStatus?: string;
  reason?: string;
  performedBy?: string;
  performedByRole?: string;
  timestamp: string;
  createdAt?: string;
}

export type SlotIndex = 1 | 2 | 3 | 4;

export interface SlotMatrixCell {
  slotIndex: SlotIndex;
  slotCode: `S${SlotIndex}`;
  slotLabel: string;
  slotWindow: string;
  state: 'ok' | 'assigned' | 'free' | 'locked';
  woNumber?: string;
  shortWoCode?: string;
  customerName?: string;
  ticketId?: string;
  ticket?: Ticket;
}

export interface TechnicianCapacitySummary {
  installer: User;
  assignedCount: number;
  completedCount: number;
  maxLimit: number;
  hasCustomLimit: boolean;
  remainingSlots: number;
  utilizationPct: number;
  isFull: boolean;
  liveStatusLabel: string;
  liveLocationLabel: string;
  liveTone: 'onsite' | 'enroute' | 'inprogress' | 'standby';
  slots: SlotMatrixCell[];
}

export interface AutoBalanceAssignment {
  ticket: Ticket;
  installer: User;
  slotIndex: SlotIndex | null;
}

export interface AutoBalancePlanResult {
  planned: AutoBalanceAssignment[];
  skipped: Array<{ ticket: Ticket; reason: string }>;
}

export const STANDARD_SLOT_DEFINITIONS: Array<{
  index: SlotIndex;
  code: `S${SlotIndex}`;
  label: string;
  windowLabel: string;
}> = [
  { index: 1, code: 'S1', label: 'Slot 1 (09:00 - 11:00)', windowLabel: '09:00 - 11:00 WIB' },
  { index: 2, code: 'S2', label: 'Slot 2 (11:00 - 13:00)', windowLabel: '11:00 - 13:00 WIB' },
  { index: 3, code: 'S3', label: 'Slot 3 (13:00 - 15:00)', windowLabel: '13:00 - 15:00 WIB' },
  { index: 4, code: 'S4', label: 'Slot 4 (15:00 - 17:00)', windowLabel: '15:00 - 17:00 WIB' }
];

export const DEFAULT_LEADER_QUOTA_CONFIG: LeaderQuotaConfig = {
  contractorName: '',
  defaultMaxDailyQuota: 4,
  enforceStrictLimit: true,
  customInstallerLimits: {}
};

export function normalizeSlotIndex(slotTime?: string | null): SlotIndex | null {
  const s = String(slotTime || '').toLowerCase().trim();
  if (!s) return null;
  if (s === '1' || s === 's1' || s.includes('slot 1') || s.includes('09:00') || s.includes('08:00') || s.includes('09.00')) return 1;
  if (s === '2' || s === 's2' || s.includes('slot 2') || s.includes('11:00') || s.includes('10:00') || s.includes('11.00')) return 2;
  if (s === '3' || s === 's3' || s.includes('slot 3') || s.includes('13:00') || s.includes('14:00') || s.includes('13.00')) return 3;
  if (s === '4' || s === 's4' || s.includes('slot 4') || s.includes('15:00') || s.includes('16:00') || s.includes('15.00')) return 4;
  return null;
}

export function formatSlotBadgeLabel(slotTime?: string | null): string {
  const idx = normalizeSlotIndex(slotTime);
  if (idx) {
    const def = STANDARD_SLOT_DEFINITIONS.find(d => d.index === idx);
    if (def) return def.label;
  }
  return String(slotTime || 'Standar Operasional').trim();
}

export function buildShortWoCode(woNumber?: string | null): string {
  const raw = String(woNumber || '').trim();
  if (!raw) return '#WO';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 3) {
    return `#${digits.slice(-3)}`;
  }
  return `#${raw.slice(-4).toUpperCase()}`;
}

export function normalizeQuotaKeySlug(contractorName?: string): string {
  const raw = String(contractorName || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const slug = (raw || 'default').slice(0, 42);
  return `leader_quota_config_${slug}`;
}

export async function fetchLeaderQuotaConfig(contractorName?: string): Promise<{
  success: boolean;
  config: LeaderQuotaConfig;
  key?: string;
  version?: number;
  isPersistedInDb?: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const started = performance.now();
  const qs = contractorName ? `?contractor=${encodeURIComponent(contractorName)}` : '';
  const res = await fetch(`/api/leader/quota-config${qs}`, {
    credentials: 'include',
    headers: getAuthHeaders()
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - started));
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    return {
      success: false,
      config: { ...DEFAULT_LEADER_QUOTA_CONFIG, contractorName: contractorName || '' },
      latencyMs,
      error: json?.error || `Gagal memuat konfigurasi kuota (${res.status})`
    };
  }
  return {
    success: true,
    config: {
      ...DEFAULT_LEADER_QUOTA_CONFIG,
      ...(json.config || {}),
      customInstallerLimits: { ...(json.config?.customInstallerLimits || {}) }
    },
    key: json.key,
    version: json.version,
    isPersistedInDb: json.isPersistedInDb,
    latencyMs
  };
}

export async function saveLeaderQuotaConfig(config: LeaderQuotaConfig): Promise<{
  success: boolean;
  config?: LeaderQuotaConfig;
  version?: number;
  error?: string;
}> {
  const res = await fetch('/api/leader/quota-config', {
    method: 'PUT',
    credentials: 'include',
    headers: getAuthHeaders(),
    body: JSON.stringify(config)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    return {
      success: false,
      error: json?.error || `Gagal menyimpan konfigurasi kuota (${res.status})`
    };
  }
  return {
    success: true,
    config: json.config,
    version: json.version
  };
}

export async function fetchLeaderAssignmentFeed(options?: {
  contractor?: string;
  action?: string;
  limit?: number;
}): Promise<{ success: boolean; feed: AssignmentFeedEntry[]; error?: string }> {
  const params = new URLSearchParams();
  if (options?.contractor) params.set('contractor', options.contractor);
  if (options?.action) params.set('action', options.action);
  if (options?.limit) params.set('limit', String(options.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/leader/assignment-feed${qs}`, {
    credentials: 'include',
    headers: getAuthHeaders()
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    return {
      success: false,
      feed: [],
      error: json?.error || `Gagal memuat riwayat reassign (${res.status})`
    };
  }
  return {
    success: true,
    feed: Array.isArray(json.feed) ? json.feed : []
  };
}

export async function executeBulkReassignApi(payload: {
  ticketIds: string[];
  newInstallerName: string;
  newInstallerId?: string;
  reason: string;
}): Promise<{
  success: boolean;
  partialSuccess?: boolean;
  count?: number;
  failedCount?: number;
  reassigned?: any[];
  failed?: Array<{ id: string; error: string; code?: string }>;
  message?: string;
  error?: string;
}> {
  const res = await fetch('/api/tickets/bulk-reassign', {
    method: 'POST',
    credentials: 'include',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    return {
      success: false,
      partialSuccess: Boolean(json?.partialSuccess),
      count: typeof json?.count === 'number' ? json.count : Array.isArray(json?.reassigned) ? json.reassigned.length : 0,
      failedCount: typeof json?.failedCount === 'number' ? json.failedCount : Array.isArray(json?.failed) ? json.failed.length : 0,
      reassigned: Array.isArray(json?.reassigned) ? json.reassigned : [],
      failed: Array.isArray(json?.failed) ? json.failed : [],
      message: json?.message,
      error: json?.error || json?.message || `Bulk reassign gagal (${res.status})`
    };
  }
  return json;
}

export function buildTechnicianCapacitySummaries(params: {
  installers: User[];
  todayTickets: Ticket[];
  quotaConfig: LeaderQuotaConfig;
  targetDate: string;
}): TechnicianCapacitySummary[] {
  const { installers, todayTickets, quotaConfig, targetDate } = params;
  const norm = (v?: string | null) => String(v || '').trim().toLowerCase();

  return installers.map(inst => {
    const instTickets = todayTickets.filter(t => {
      if (norm(t.installerName) !== norm(inst.name)) return false;
      if (targetDate) {
        const d = getTicketAppointmentDate(t);
        if (d && d !== targetDate) return false;
      }
      return t.statusWOInstaller !== 'Failed / Cancelled';
    });

    const hasCustomLimit = typeof quotaConfig.customInstallerLimits?.[inst.name] === 'number';
    const maxLimit = hasCustomLimit
      ? quotaConfig.customInstallerLimits[inst.name]
      : (quotaConfig.defaultMaxDailyQuota || 4);

    const assignedCount = instTickets.length;
    const completedCount = instTickets.filter(
      t =>
        t.statusWOInstaller === 'Completed' ||
        t.statusWOInstaller === 'Installed' ||
        t.statusWOAgent === 'Done' ||
        t.statusWOAgent === 'Closed'
    ).length;

    const remainingSlots = Math.max(0, maxLimit - assignedCount);
    const isFull = assignedCount >= maxLimit;
    const utilizationPct = maxLimit > 0 ? Math.min(100, Math.round((assignedCount / maxLimit) * 100)) : 0;

    // Live status derived from active assigned tickets
    const onSiteTicket = instTickets.find(t => t.statusWOInstaller === 'On Site');
    const enRouteTicket = instTickets.find(t => t.statusWOInstaller === 'En Route');
    const assignedTicket = instTickets.find(t => t.statusWOInstaller === 'Assigned');

    let liveStatusLabel = 'Standby';
    let liveLocationLabel = inst.area || 'Basecamp';
    let liveTone: 'onsite' | 'enroute' | 'inprogress' | 'standby' = 'standby';

    if (onSiteTicket) {
      liveStatusLabel = 'On Site';
      liveLocationLabel = onSiteTicket.clusterName || onSiteTicket.area || liveLocationLabel;
      liveTone = 'onsite';
    } else if (enRouteTicket) {
      liveStatusLabel = 'En Route';
      liveLocationLabel = enRouteTicket.clusterName || enRouteTicket.area || liveLocationLabel;
      liveTone = 'enroute';
    } else if (assignedTicket) {
      liveStatusLabel = 'Terjadwal';
      liveLocationLabel = assignedTicket.clusterName || assignedTicket.area || liveLocationLabel;
      liveTone = 'inprogress';
    }

    // Build deterministic 4-slot matrix S1-S4
    const assignedBySlot = new Map<SlotIndex, Ticket>();
    const unslottedTickets: Ticket[] = [];

    instTickets.forEach(t => {
      const idx = normalizeSlotIndex(t.slotTime);
      if (idx && !assignedBySlot.has(idx)) {
        assignedBySlot.set(idx, t);
      } else {
        unslottedTickets.push(t);
      }
    });

    // Place any overflow/unslotted tickets into free slot positions strictly for visibility
    if (unslottedTickets.length > 0) {
      for (const def of STANDARD_SLOT_DEFINITIONS) {
        if (!assignedBySlot.has(def.index) && unslottedTickets.length > 0) {
          const extra = unslottedTickets.shift();
          if (extra) assignedBySlot.set(def.index, extra);
        }
      }
    }

    const slots: SlotMatrixCell[] = STANDARD_SLOT_DEFINITIONS.map(def => {
      const ticket = assignedBySlot.get(def.index);
      if (ticket) {
        const isDone =
          ticket.statusWOInstaller === 'Completed' ||
          ticket.statusWOInstaller === 'Installed' ||
          Boolean(ticket.checkOutAt);
        return {
          slotIndex: def.index,
          slotCode: def.code,
          slotLabel: def.label,
          slotWindow: def.windowLabel,
          state: isDone ? 'ok' : 'assigned',
          woNumber: ticket.woNumber,
          shortWoCode: buildShortWoCode(ticket.woNumber),
          customerName: ticket.customerName,
          ticketId: ticket.id,
          ticket
        };
      }
      return {
        slotIndex: def.index,
        slotCode: def.code,
        slotLabel: def.label,
        slotWindow: def.windowLabel,
        state: isFull && quotaConfig.enforceStrictLimit ? 'locked' : 'free'
      };
    });

    return {
      installer: inst,
      assignedCount,
      completedCount,
      maxLimit,
      hasCustomLimit,
      remainingSlots,
      utilizationPct,
      isFull,
      liveStatusLabel,
      liveLocationLabel,
      liveTone,
      slots
    };
  });
}

export function computeAutoBalancePlan(params: {
  targetTickets: Ticket[];
  installers: User[];
  existingTodayTickets: Ticket[];
  quotaConfig: LeaderQuotaConfig;
}): AutoBalancePlanResult {
  const { targetTickets, installers, existingTodayTickets, quotaConfig } = params;
  const norm = (v?: string | null) => String(v || '').trim().toLowerCase();

  // Mutable working state per installer
  const tracker = installers
    .filter(u => u.role === 'installer' && u.active !== false && !u.isArchived)
    .map(inst => {
      const currentTickets = existingTodayTickets.filter(
        t => norm(t.installerName) === norm(inst.name) && t.statusWOInstaller !== 'Failed / Cancelled'
      );
      const occupiedSlots = new Set<SlotIndex>();
      currentTickets.forEach(t => {
        const sIdx = normalizeSlotIndex(t.slotTime);
        if (sIdx) occupiedSlots.add(sIdx);
      });
      const maxLimit =
        quotaConfig.customInstallerLimits?.[inst.name] || quotaConfig.defaultMaxDailyQuota || 4;
      return {
        installer: inst,
        count: currentTickets.length,
        maxLimit,
        occupiedSlots
      };
    });

  const planned: AutoBalanceAssignment[] = [];
  const skipped: Array<{ ticket: Ticket; reason: string }> = [];

  for (const ticket of targetTickets) {
    if (ticket.installerName && ticket.installerName.trim()) {
      skipped.push({ ticket, reason: 'Sudah memiliki teknisi aktif.' });
      continue;
    }

    const reqSlot = normalizeSlotIndex(ticket.slotTime);
    const woArea = norm(ticket.area);

    // Filter eligible candidates respecting quota & area
    const eligible = tracker.filter(item => {
      if (item.count >= item.maxLimit) return false;
      const instArea = norm(item.installer.area);
      if (woArea && instArea && !woArea.includes(instArea) && !instArea.includes(woArea)) {
        return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      skipped.push({
        ticket,
        reason: 'Semua teknisi cakupan area telah mencapai batas kuota harian.'
      });
      continue;
    }

    // Prefer candidates without a collision in the same appointment slot, then least-loaded
    eligible.sort((a, b) => {
      const aBusyInSlot = reqSlot && a.occupiedSlots.has(reqSlot) ? 1 : 0;
      const bBusyInSlot = reqSlot && b.occupiedSlots.has(reqSlot) ? 1 : 0;
      if (aBusyInSlot !== bBusyInSlot) return aBusyInSlot - bBusyInSlot;
      if (a.count !== b.count) return a.count - b.count;
      return a.installer.name.localeCompare(b.installer.name);
    });

    const chosen = eligible[0];
    chosen.count += 1;
    if (reqSlot) chosen.occupiedSlots.add(reqSlot);

    planned.push({
      ticket,
      installer: chosen.installer,
      slotIndex: reqSlot
    });
  }

  return { planned, skipped };
}
