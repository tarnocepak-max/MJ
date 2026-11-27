import type { Ticket, Contractor, CoverageArea, User, TicketMessage } from '../src/types/index.ts';
import type {
  SlaPeriod,
  SlaTier,
  SlaThresholdConfig,
  SlaGovernanceActionRecord,
  SlaVendorRow,
  SlaSlotTrendItem,
  SlaInsightItem,
  SlaComplianceMatrixItem,
  SlaBreachTicketItem,
  SlaPksLedgerItem,
  SlaTelemetryPayload
} from '../src/types/sla.ts';
import { isContractorMatch, isAreaMatch } from './appFlowHelpers.ts';

export const DEFAULT_SLA_THRESHOLD_CONFIG: SlaThresholdConfig = {
  globalSlaTarget: 98.4,
  excellentMin: 98.0,
  goodMin: 94.0,
  warningMin: 90.0,
  ftrTarget: 95.0,
  maxDispatchResponseMinutes: 45,
  opmMaxLossDbm: -22.0,
  requiredPhotoCount: 4,
  criticalRemainingMinutes: 15,
  defaultDailyQuotaPerTech: 4,
  ruleVersionLabel: 'v4.18 (Revision 3 - 2026)',
  pksRules: {
    clauseReference: 'Klausul Perjanjian Kerjasama (PKS) 2026',
    bonusEnabled: true,
    bonusRatePerCompliantWo: 85000,
    toleranceMinRate: 97.0,
    penaltyRatePerBreachWo: 500000,
    isCustomConfigured: false
  }
};

export function normalizeSlaConfig(raw: any): SlaThresholdConfig {
  const base = DEFAULT_SLA_THRESHOLD_CONFIG;
  if (!raw || typeof raw !== 'object') {
    return {
      ...base,
      pksRules: { ...base.pksRules }
    };
  }

  const num = (v: any, fallback: number, min: number, max: number): number => {
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  const pksRaw = raw.pksRules && typeof raw.pksRules === 'object' ? raw.pksRules : {};

  return {
    globalSlaTarget: num(raw.globalSlaTarget, base.globalSlaTarget, 50, 100),
    excellentMin: num(raw.excellentMin, base.excellentMin, 50, 100),
    goodMin: num(raw.goodMin, base.goodMin, 40, 100),
    warningMin: num(raw.warningMin, base.warningMin, 20, 100),
    ftrTarget: num(raw.ftrTarget, base.ftrTarget, 50, 100),
    maxDispatchResponseMinutes: Math.round(num(raw.maxDispatchResponseMinutes, base.maxDispatchResponseMinutes, 5, 240)),
    opmMaxLossDbm: num(raw.opmMaxLossDbm, base.opmMaxLossDbm, -35, -10),
    requiredPhotoCount: Math.round(num(raw.requiredPhotoCount, base.requiredPhotoCount, 1, 10)),
    criticalRemainingMinutes: Math.round(num(raw.criticalRemainingMinutes, base.criticalRemainingMinutes, 5, 180)),
    defaultDailyQuotaPerTech: Math.round(num(raw.defaultDailyQuotaPerTech, base.defaultDailyQuotaPerTech, 1, 20)),
    ruleVersionLabel: typeof raw.ruleVersionLabel === 'string' && raw.ruleVersionLabel.trim()
      ? raw.ruleVersionLabel.trim()
      : base.ruleVersionLabel,
    pksRules: {
      clauseReference: typeof pksRaw.clauseReference === 'string' && pksRaw.clauseReference.trim()
        ? pksRaw.clauseReference.trim()
        : base.pksRules.clauseReference,
      bonusEnabled: typeof pksRaw.bonusEnabled === 'boolean' ? pksRaw.bonusEnabled : base.pksRules.bonusEnabled,
      bonusRatePerCompliantWo: Math.round(num(pksRaw.bonusRatePerCompliantWo, base.pksRules.bonusRatePerCompliantWo, 0, 10000000)),
      toleranceMinRate: num(pksRaw.toleranceMinRate, base.pksRules.toleranceMinRate, 50, 100),
      penaltyRatePerBreachWo: Math.round(num(pksRaw.penaltyRatePerBreachWo, base.pksRules.penaltyRatePerBreachWo, 0, 50000000)),
      isCustomConfigured: Boolean(pksRaw.isCustomConfigured)
    }
  };
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01', januari: '01',
  feb: '02', february: '02', februari: '02',
  mar: '03', march: '03', maret: '03',
  apr: '04', april: '04',
  may: '05', mei: '05',
  jun: '06', june: '06', juni: '06',
  jul: '07', july: '07', juli: '07',
  aug: '08', august: '08', agustus: '08', agt: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', oktober: '10', okt: '10',
  nov: '11', november: '11',
  dec: '12', december: '12', desember: '12', des: '12'
};

export function toJakartaDateKey(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD (or YYYY-MM-DDTHH:mm:ss...)
  const isoDateMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDateMatch) {
    // If full ISO timestamp with Z or offset, convert to Asia/Jakarta date
    if (s.includes('T') && (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s))) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        try {
          return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(d);
        } catch {
          return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        }
      }
    }
    return `${isoDateMatch[1]}-${isoDateMatch[2].padStart(2, '0')}-${isoDateMatch[3].padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const mon = dmyMatch[2].padStart(2, '0');
    const yr = dmyMatch[3];
    if (Number(mon) >= 1 && Number(mon) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${yr}-${mon}-${day}`;
    }
  }

  // "15 Nov 2026" or "15 November 2026"
  const textMatch = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (textMatch) {
    const day = textMatch[1].padStart(2, '0');
    const mon = MONTH_MAP[textMatch[2].toLowerCase()];
    const yr = textMatch[3];
    if (mon) return `${yr}-${mon}-${day}`;
  }

  return null;
}

function shiftWibDate(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, (d || 1) + offsetDays);
  return new Date(utc).toISOString().slice(0, 10);
}

interface CanonicalSlotDef {
  slotTime: string;
  shortLabel: string;
  startHour: number;
  endHour: number;
  endMinute: number;
}

const CANONICAL_SLOTS: CanonicalSlotDef[] = [
  { slotTime: '09:00 - 11:00 WIB', shortLabel: '09:00-11:00', startHour: 9, endHour: 11, endMinute: 0 },
  { slotTime: '11:00 - 13:00 WIB', shortLabel: '11:00-13:00', startHour: 11, endHour: 13, endMinute: 0 },
  { slotTime: '13:00 - 15:00 WIB', shortLabel: '13:00-15:00', startHour: 13, endHour: 15, endMinute: 0 },
  { slotTime: '15:00 - 17:00 WIB', shortLabel: '15:00-17:00', startHour: 15, endHour: 17, endMinute: 0 }
];

function matchCanonicalSlot(rawSlot?: string | null): { slot: CanonicalSlotDef | null; endHour: number; endMinute: number } {
  const s = String(rawSlot || '').trim();
  if (!s) return { slot: null, endHour: 17, endMinute: 0 };

  const normalized = s.replace(/\./g, ':');
  const rangeMatch = normalized.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (rangeMatch) {
    const startH = parseInt(rangeMatch[1], 10);
    const endH = parseInt(rangeMatch[3], 10);
    const endM = parseInt(rangeMatch[4], 10);
    const matched = CANONICAL_SLOTS.find(c => c.startHour === startH)
      || CANONICAL_SLOTS.find(c => startH >= c.startHour && startH < c.endHour)
      || null;
    return { slot: matched, endHour: endH, endMinute: endM };
  }

  const singleMatch = normalized.match(/(\d{1,2}):(\d{2})/);
  if (singleMatch) {
    const h = parseInt(singleMatch[1], 10);
    const matched = CANONICAL_SLOTS.find(c => h >= c.startHour && h < c.endHour) || null;
    if (matched) return { slot: matched, endHour: matched.endHour, endMinute: matched.endMinute };
  }

  const lower = s.toLowerCase();
  if (lower.includes('slot 1') || lower.includes('pagi')) return { slot: CANONICAL_SLOTS[0], endHour: 11, endMinute: 0 };
  if (lower.includes('slot 2')) return { slot: CANONICAL_SLOTS[1], endHour: 13, endMinute: 0 };
  if (lower.includes('slot 3') || lower.includes('siang')) return { slot: CANONICAL_SLOTS[2], endHour: 15, endMinute: 0 };
  if (lower.includes('slot 4') || lower.includes('sore')) return { slot: CANONICAL_SLOTS[3], endHour: 17, endMinute: 0 };

  return { slot: null, endHour: 17, endMinute: 0 };
}

function parseTimestampMs(raw?: string | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) return ms;
  const dateKey = toJakartaDateKey(s);
  if (dateKey) {
    const fallback = Date.parse(`${dateKey}T12:00:00+07:00`);
    return Number.isNaN(fallback) ? null : fallback;
  }
  return null;
}

function parseOpticalPowerDbm(raw?: string | number | null): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(',', '.');
  if (!s) return null;
  const match = s.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const val = parseFloat(match[0]);
  return Number.isFinite(val) ? val : null;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function classifySlaTier(slaRate: number | null, config: SlaThresholdConfig): SlaTier {
  if (slaRate === null) return 'NO_DATA';
  if (slaRate >= config.excellentMin) return 'EXCELLENT';
  if (slaRate >= config.goodMin) return 'GOOD';
  if (slaRate >= config.warningMin) return 'WARNING';
  return 'CRITICAL';
}

interface EvaluatedTicket {
  ticket: Ticket;
  woDate: string;
  contractorId: string;
  contractorName: string;
  areaName: string;
  slot: CanonicalSlotDef | null;
  slaDeadlineIso: string | null;
  slaDeadlineMs: number | null;
  isCompleted: boolean;
  isCancelled: boolean;
  isOnTime: boolean;
  isLate: boolean;
  isWip: boolean;
  minutesRemaining: number;
  hasFtrSample: boolean;
  isFtrPass: boolean;
  hasPhotoOpmSample: boolean;
  isPhotoPass: boolean;
  hasPhotoSample: boolean;
  isOpmPass: boolean;
  hasOpmSample: boolean;
  responseMinutes: number | null;
  hasCheckIn: boolean;
}

function evaluateTicket(
  ticket: Ticket,
  woDate: string,
  contractorId: string,
  contractorName: string,
  nowMs: number,
  config: SlaThresholdConfig
): EvaluatedTicket {
  const { slot, endHour, endMinute } = matchCanonicalSlot(ticket.slotTime);
  const hh = String(Math.min(23, Math.max(0, endHour))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, endMinute))).padStart(2, '0');
  const slaDeadlineIso = `${woDate}T${hh}:${mm}:00+07:00`;
  const parsedDeadline = Date.parse(slaDeadlineIso);
  const slaDeadlineMs = Number.isNaN(parsedDeadline) ? null : parsedDeadline;

  const instStatus = String(ticket.statusWOInstaller || '').trim();
  const agentStatus = String(ticket.statusWOAgent || '').trim();
  const approval = String(ticket.approvalStatus || '').trim().toUpperCase();

  const isCancelled = instStatus === 'Failed / Cancelled' || agentStatus === 'Cancelled';
  const isCompleted = !isCancelled && (
    instStatus === 'Completed'
    || instStatus === 'Installed'
    || agentStatus === 'Closed'
    || agentStatus === 'Resolved'
    || approval === 'APPROVED'
  );

  const completedAtMs =
    parseTimestampMs(ticket.technicalReport?.submittedAt)
    || parseTimestampMs(ticket.checkOutAt)
    || parseTimestampMs(ticket.closedAt)
    || parseTimestampMs(ticket.approvedAt)
    || parseTimestampMs(ticket.updatedAt);

  let isOnTime = false;
  let isLate = false;
  let isWip = false;
  let minutesRemaining = 9999;

  if (slaDeadlineMs !== null) {
    minutesRemaining = Math.round((slaDeadlineMs - nowMs) / 60000);
  }

  if (isCompleted) {
    if (slaDeadlineMs !== null && completedAtMs !== null) {
      isOnTime = completedAtMs <= slaDeadlineMs;
      isLate = !isOnTime;
    } else {
      isOnTime = true;
    }
  } else if (!isCancelled) {
    if (slaDeadlineMs !== null && minutesRemaining < 0) {
      isLate = true;
    } else {
      isWip = true;
    }
  }

  // FTR (First-Time-Right) evaluation
  const hasReport = Boolean(ticket.technicalReport && (ticket.technicalReport.submittedAt || ticket.technicalReport.workResult || ticket.technicalReport.mainCategory));
  const hasReworkHistory = Boolean(
    ticket.rejectedAt
    || approval === 'REJECTED'
    || approval === 'REVISI'
    || (ticket.progressReports || []).some(pr => pr.approvalStatus === 'REJECTED' || pr.approvalStatus === 'REVISI')
  );
  const hasFtrSample = hasReport || isCompleted || hasReworkHistory || instStatus === 'Failed / Cancelled';
  const isFtrPass = hasFtrSample && !hasReworkHistory && !isCancelled;

  // Check-in & Response Time evaluation (authoritative Check-In timestamp or active workSession only)
  const hasCheckIn = Boolean(
    ticket.checkInAt
    || ticket.workStartedAt
    || (ticket.workSessions && ticket.workSessions.length > 0)
  );

  const dispatchStartMs =
    parseTimestampMs(ticket.assignedAt)
    || parseTimestampMs(ticket.dateAssignTechnician)
    || parseTimestampMs(ticket.dateAssignAgent)
    || parseTimestampMs(ticket.createdAt);
  const ackMs =
    parseTimestampMs(ticket.checkInAt)
    || parseTimestampMs(ticket.workStartedAt)
    || (ticket.workSessions && ticket.workSessions[0]?.checkInAt ? parseTimestampMs(ticket.workSessions[0].checkInAt) : null);

  let responseMinutes: number | null = null;
  if (dispatchStartMs !== null && ackMs !== null) {
    const diffMin = Math.round((ackMs - dispatchStartMs) / 60000);
    if (diffMin >= 0 && diffMin <= 720) {
      responseMinutes = diffMin;
    }
  }

  // Photo & OPM compliance
  const photos = ticket.technicalReport?.photos || [];
  const legacyPhotoCount = [ticket.technicalReport?.photoBeforeUrl, ticket.technicalReport?.photoAfterUrl].filter(Boolean).length;
  const effectivePhotoCount = Math.max(photos.length, legacyPhotoCount);
  const hasPhotoSample = hasReport || effectivePhotoCount > 0;
  const isPhotoPass = hasPhotoSample && effectivePhotoCount >= config.requiredPhotoCount;

  const opmRaw = ticket.technicalReport?.opticalPowerDbm ?? ticket.technicalReport?.opticalPowerRx;
  const parsedOpm = parseOpticalPowerDbm(opmRaw);
  const hasOpmSample = parsedOpm !== null;
  const isOpmPass = hasOpmSample && parsedOpm! >= config.opmMaxLossDbm && parsedOpm! <= 0;

  const hasPhotoOpmSample = hasPhotoSample || hasOpmSample;

  return {
    ticket,
    woDate,
    contractorId,
    contractorName,
    areaName: String(ticket.area || '').trim() || 'Area Belum Ditentukan',
    slot,
    slaDeadlineIso,
    slaDeadlineMs,
    isCompleted,
    isCancelled,
    isOnTime,
    isLate,
    isWip,
    minutesRemaining,
    hasFtrSample,
    isFtrPass,
    hasPhotoOpmSample,
    isPhotoPass,
    hasPhotoSample,
    isOpmPass,
    hasOpmSample,
    responseMinutes,
    hasCheckIn
  };
}

export interface ComputeSlaTelemetryInput {
  tickets: Ticket[];
  contractors: Contractor[];
  coverageAreas: CoverageArea[];
  users: User[];
  ticketMessages?: TicketMessage[];
  operationalDateWIB: string;
  period: SlaPeriod;
  areaFilter?: string;
  contractorFilter?: string;
  config: SlaThresholdConfig;
  configVersion: number;
  isConfigPersistedInDb: boolean;
  governanceLogs?: SlaGovernanceActionRecord[];
  databaseSource: 'supabase' | 'local_json';
  nowMs?: number;
}

export function computeSlaTelemetryPayload(input: ComputeSlaTelemetryInput): SlaTelemetryPayload {
  const {
    tickets,
    contractors,
    coverageAreas,
    users,
    ticketMessages = [],
    operationalDateWIB,
    period,
    areaFilter = 'ALL',
    contractorFilter = 'ALL',
    config,
    configVersion,
    isConfigPersistedInDb,
    governanceLogs = [],
    databaseSource,
    nowMs = Date.now()
  } = input;

  const startDate =
    period === 'today'
      ? operationalDateWIB
      : period === '7d'
      ? shiftWibDate(operationalDateWIB, -6)
      : `${operationalDateWIB.slice(0, 8)}01`;
  const endDate = operationalDateWIB;

  const activeContractors = (contractors || []).filter(c => c && c.active !== false);
  const activeAreas = (coverageAreas || []).filter(a => a && a.active !== false);
  const activeInstallers = (users || []).filter(u => u && u.role === 'installer' && !u.isDeleted && u.active !== false);
  const activeLeaders = (users || []).filter(u => u && u.role === 'leader' && !u.isDeleted && u.active !== false);

  // Helper to resolve contractor entity for a ticket
  const resolveContractorForTicket = (t: Ticket): { id: string; name: string } => {
    const rawId = String(t.contractorId || '').trim();
    const rawName = String(t.contractorName || t.contactorName || t.vendorName || '').trim();
    const matched = activeContractors.find(c =>
      (rawId && c.id === rawId)
      || (rawName && (isContractorMatch(c.name, rawName) || (c.code && c.code.toLowerCase() === rawName.toLowerCase())))
    );
    if (matched) return { id: matched.id, name: matched.name };
    return { id: rawId || rawName || 'unmapped', name: rawName || 'Vendor Belum Terpetakan' };
  };

  // Filter options strictly from scoped contractors & coverage areas / tickets
  const areaSet = new Set<string>();
  activeAreas.forEach(a => {
    if (a.name) areaSet.add(a.name.trim());
  });
  tickets.forEach(t => {
    if (!t.isDeleted && !t.isArchived && t.area) areaSet.add(String(t.area).trim());
  });

  // Collect tickets in selected period & filter
  const periodTickets: EvaluatedTicket[] = [];
  for (const t of tickets) {
    if (!t || t.isDeleted || t.isArchived) continue;
    const woDate =
      toJakartaDateKey(t.appointmentDate)
      || toJakartaDateKey(t.date)
      || toJakartaDateKey(t.ticketDate)
      || toJakartaDateKey(t.createdAt);
    if (!woDate) continue;
    if (woDate < startDate || woDate > endDate) continue;

    if (areaFilter && areaFilter !== 'ALL' && !isAreaMatch(t.area, areaFilter)) continue;

    const resolvedContractor = resolveContractorForTicket(t);
    if (contractorFilter && contractorFilter !== 'ALL') {
      const targetC = activeContractors.find(c => c.id === contractorFilter || c.name === contractorFilter || c.code === contractorFilter);
      const matchesFilter = targetC
        ? (resolvedContractor.id === targetC.id || isContractorMatch(resolvedContractor.name, targetC.name))
        : (resolvedContractor.id === contractorFilter || isContractorMatch(resolvedContractor.name, contractorFilter));
      if (!matchesFilter) continue;
    }

    periodTickets.push(evaluateTicket(t, woDate, resolvedContractor.id, resolvedContractor.name, nowMs, config));
  }

  // Global KPI aggregates
  const nonCancelled = periodTickets.filter(e => !e.isCancelled);
  const okCount = nonCancelled.filter(e => e.isCompleted && e.isOnTime).length;
  const wipCount = nonCancelled.filter(e => !e.isCompleted && e.isWip).length;
  const lateCount = nonCancelled.filter(e => e.isLate).length;
  const evaluatedCount = okCount + lateCount;
  const globalComplianceRate = evaluatedCount > 0 ? round1((okCount / evaluatedCount) * 100) : null;
  const complianceGap = globalComplianceRate !== null ? round1(globalComplianceRate - config.globalSlaTarget) : null;

  const complianceStatus: SlaTelemetryPayload['kpis']['complianceStatus'] =
    globalComplianceRate === null
      ? 'NO_DATA'
      : globalComplianceRate >= config.globalSlaTarget
      ? 'ON_TARGET'
      : globalComplianceRate >= config.warningMin
      ? 'WARNING'
      : 'CRITICAL';

  const ftrSamples = periodTickets.filter(e => e.hasFtrSample);
  const ftrPassCount = ftrSamples.filter(e => e.isFtrPass).length;
  const ftrRate = ftrSamples.length > 0 ? round1((ftrPassCount / ftrSamples.length) * 100) : null;
  const ftrStatus: SlaTelemetryPayload['kpis']['ftrStatus'] =
    ftrRate === null
      ? 'NO_DATA'
      : ftrRate >= config.ftrTarget
      ? 'STABIL'
      : ftrRate >= config.warningMin
      ? 'PERHATIAN'
      : 'KRITIS';

  const photoOpmSamples = periodTickets.filter(e => e.hasPhotoOpmSample);
  const photoOpmValidCount = photoOpmSamples.filter(e => {
    const photoOk = !e.hasPhotoSample || e.isPhotoPass;
    const opmOk = !e.hasOpmSample || e.isOpmPass;
    return photoOk && opmOk && (e.hasPhotoSample || e.hasOpmSample);
  }).length;
  const photoOpmComplianceRate = photoOpmSamples.length > 0 ? round1((photoOpmValidCount / photoOpmSamples.length) * 100) : null;

  // Breach queue: active (non-completed, non-cancelled) tickets with remaining <= criticalRemainingMinutes
  const breachTickets = nonCancelled
    .filter(e => !e.isCompleted && e.slaDeadlineMs !== null && e.minutesRemaining <= config.criticalRemainingMinutes)
    .sort((a, b) => a.minutesRemaining - b.minutesRemaining);

  const breachVendorIds = new Set(breachTickets.map(b => b.contractorId));

  // Period multiplier for quota denominator (1 day for 'today', else distinct operational dates or days count)
  const daySpan =
    period === 'today'
      ? 1
      : period === '7d'
      ? 7
      : Math.max(1, parseInt(operationalDateWIB.slice(8, 10), 10) || 1);

  // Build Vendor Leaderboard rows from activeContractors (plus any unmapped vendor found in periodTickets)
  const vendorSeedMap = new Map<string, { id: string; name: string; code: string; areas: string[]; leaderName: string; leaderPhone: string }>();
  activeContractors.forEach(c => {
    if (contractorFilter && contractorFilter !== 'ALL' && c.id !== contractorFilter && !isContractorMatch(c.name, contractorFilter)) {
      return;
    }
    if (areaFilter && areaFilter !== 'ALL' && c.coverageAreas && c.coverageAreas.length > 0) {
      const hasArea = c.coverageAreas.some(ca => isAreaMatch(ca, areaFilter));
      if (!hasArea) return;
    }
    const matchedLeader = activeLeaders.find(l =>
      (c.leaderId && l.id === c.leaderId)
      || (l.contractorId && l.contractorId === c.id)
      || isContractorMatch(l.contractor, c.name)
    );
    vendorSeedMap.set(c.id, {
      id: c.id,
      name: c.name,
      code: c.code || c.id.slice(0, 6).toUpperCase(),
      areas: c.coverageAreas || [],
      leaderName: c.leaderName || matchedLeader?.name || 'Korlap Belum Diatur',
      leaderPhone: c.phone || matchedLeader?.phone || ''
    });
  });

  periodTickets.forEach(e => {
    if (!vendorSeedMap.has(e.contractorId)) {
      vendorSeedMap.set(e.contractorId, {
        id: e.contractorId,
        name: e.contractorName,
        code: e.contractorId.slice(0, 6).toUpperCase(),
        areas: [e.areaName].filter(Boolean),
        leaderName: e.ticket.leaderName || e.ticket.corlapName || 'Korlap',
        leaderPhone: e.ticket.leaderContact || e.ticket.corlapContact || ''
      });
    }
  });

  const vendorRowsRaw: SlaVendorRow[] = [];
  vendorSeedMap.forEach(vendor => {
    const vTickets = periodTickets.filter(e => e.contractorId === vendor.id);
    const vNonCancelled = vTickets.filter(e => !e.isCancelled);
    const vOk = vNonCancelled.filter(e => e.isCompleted && e.isOnTime).length;
    const vWip = vNonCancelled.filter(e => !e.isCompleted && e.isWip).length;
    const vLate = vNonCancelled.filter(e => e.isLate).length;
    const vEval = vOk + vLate;
    const vSlaRate = vEval > 0 ? round1((vOk / vEval) * 100) : null;

    const vFtrSamples = vTickets.filter(e => e.hasFtrSample);
    const vFtrPass = vFtrSamples.filter(e => e.isFtrPass).length;
    const vFtrRate = vFtrSamples.length > 0 ? round1((vFtrPass / vFtrSamples.length) * 100) : null;

    const respList = vTickets.map(e => e.responseMinutes).filter((m): m is number => m !== null);
    const avgResponseMinutes = respList.length > 0
      ? Math.round(respList.reduce((acc, cur) => acc + cur, 0) / respList.length)
      : null;

    const techCount = activeInstallers.filter(u =>
      (u.contractorId && u.contractorId === vendor.id) || isContractorMatch(u.contractor, vendor.name)
    ).length;

    const quotaTotal = techCount > 0 ? techCount * config.defaultDailyQuotaPerTech * daySpan : 0;
    const quotaUsed = vNonCancelled.length;
    const quotaUtilizationRate = quotaTotal > 0 ? round1((quotaUsed / quotaTotal) * 100) : null;

    const vBreachCount = breachTickets.filter(b => b.contractorId === vendor.id).length;

    const ticketAreas = Array.from(new Set(vTickets.map(t => t.areaName).filter(Boolean)));
    const allAreas = Array.from(new Set([...vendor.areas, ...ticketAreas])).filter(Boolean);
    const primaryArea = allAreas.slice(0, 2).join(' & ') || 'Semua Area';

    const latestGov = governanceLogs.find(g =>
      (g.contractorId && g.contractorId === vendor.id) || (g.contractorName && isContractorMatch(g.contractorName, vendor.name))
    ) || null;

    vendorRowsRaw.push({
      rank: 0,
      contractorId: vendor.id,
      contractorName: vendor.name,
      contractorCode: vendor.code,
      primaryArea,
      coverageAreas: allAreas,
      activeTechniciansCount: techCount,
      leaderName: vendor.leaderName,
      leaderPhone: vendor.leaderPhone,
      slaStatus: classifySlaTier(vSlaRate, config),
      slaRate: vSlaRate,
      targetGap: vSlaRate !== null ? round1(vSlaRate - config.globalSlaTarget) : null,
      volumeWo: quotaUsed,
      okCount: vOk,
      wipCount: vWip,
      lateCount: vLate,
      onTimeRate: vSlaRate,
      ftrRate: vFtrRate,
      avgResponseMinutes,
      quotaUsed,
      quotaTotal,
      quotaUtilizationRate,
      breachWoCount: vBreachCount,
      latestGovernanceAction: latestGov
    });
  });

  // Sort leaderboard: vendors with data sorted by slaRate desc then volume desc; vendors with no data at bottom
  vendorRowsRaw.sort((a, b) => {
    if (a.slaRate === null && b.slaRate === null) return b.volumeWo - a.volumeWo;
    if (a.slaRate === null) return 1;
    if (b.slaRate === null) return -1;
    if (b.slaRate !== a.slaRate) return b.slaRate - a.slaRate;
    return b.volumeWo - a.volumeWo;
  });

  const vendorLeaderboard = vendorRowsRaw.map((row, idx) => ({ ...row, rank: idx + 1 }));

  // 4-Slot Performance Trend
  const slotTrend: SlaSlotTrendItem[] = CANONICAL_SLOTS.map(slotDef => {
    const slotItems = nonCancelled.filter(e => e.slot?.slotTime === slotDef.slotTime);
    const sOk = slotItems.filter(e => e.isCompleted && e.isOnTime).length;
    const sWip = slotItems.filter(e => !e.isCompleted && e.isWip).length;
    const sLate = slotItems.filter(e => e.isLate).length;
    const sEval = sOk + sLate;
    const sResp = slotItems.map(e => e.responseMinutes).filter((m): m is number => m !== null);
    return {
      slotTime: slotDef.slotTime,
      shortLabel: slotDef.shortLabel,
      volume: slotItems.length,
      okCount: sOk,
      wipCount: sWip,
      lateCount: sLate,
      slaRate: sEval > 0 ? round1((sOk / sEval) * 100) : null,
      avgResponseMinutes: sResp.length > 0 ? Math.round(sResp.reduce((a, b) => a + b, 0) / sResp.length) : null
    };
  });

  // Automated Slot Insights strictly derived from computed slotTrend & vendorLeaderboard
  const slotInsights: SlaInsightItem[] = [];
  const slotsWithRate = slotTrend.filter(s => s.slaRate !== null);
  if (slotsWithRate.length > 0) {
    const worstSlot = [...slotsWithRate].sort((a, b) => (a.slaRate ?? 100) - (b.slaRate ?? 100))[0];
    const bestSlot = [...slotsWithRate].sort((a, b) => (b.slaRate ?? 0) - (a.slaRate ?? 0))[0];

    if (worstSlot && worstSlot.slaRate !== null && worstSlot.slaRate < config.globalSlaTarget) {
      const slotLateItems = nonCancelled.filter(e => e.slot?.slotTime === worstSlot.slotTime && e.isLate);
      const topArea = slotLateItems[0]?.areaName || areaFilter !== 'ALL' ? areaFilter : 'wilayah operasional';
      const respNote = worstSlot.avgResponseMinutes !== null ? ` Rata-rata respon teknisi ${worstSlot.avgResponseMinutes} menit.` : '';
      slotInsights.push({
        id: 'insight_drop_slot',
        tone: 'warning',
        title: `Perlu Perhatian: Slot ${worstSlot.shortLabel} (${worstSlot.slaRate}%)`,
        description: `${worstSlot.lateCount} WO melewati batas waktu pada area ${topArea} (${worstSlot.okCount}/${worstSlot.okCount + worstSlot.lateCount} tepat waktu).${respNote}`
      });
    } else if (slotsWithRate.length > 0) {
      slotInsights.push({
        id: 'insight_all_slots_healthy',
        tone: 'success',
        title: 'Semua Slot Mencapai Target SLA',
        description: `Seluruh slot aktif memenuhi ambang batas target global ${config.globalSlaTarget.toFixed(1)}% pada periode ${period === 'today' ? 'hari ini' : period === '7d' ? '7 hari terakhir' : 'bulan berjalan'}.`
      });
    }

    if (bestSlot && bestSlot.slaRate !== null) {
      const topVendor = vendorLeaderboard.find(v => v.slaRate !== null);
      const vendorNote = topVendor ? `${topVendor.contractorName} mencatat ${topVendor.slaRate}% SLA` : `Pencapaian ${bestSlot.slaRate}%`;
      slotInsights.push({
        id: 'insight_peak_slot',
        tone: 'success',
        title: `Efisiensi Puncak Slot ${bestSlot.shortLabel}`,
        description: `${vendorNote} dengan ${bestSlot.okCount} dari ${bestSlot.okCount + bestSlot.lateCount} WO terselesaikan tepat waktu.`
      });
    }
  } else {
    slotInsights.push({
      id: 'insight_no_slot_data',
      tone: 'info',
      title: 'Belum Ada Data Evaluasi Slot',
      description: 'Statistik per slot jam kerja akan otomatis dihitung setelah Work Order memiliki check-in/penyelesaian pada periode terpilih.'
    });
  }

  // Operational Compliance Matrix (4 Parameters)
  const respSamples = periodTickets.filter(e => e.responseMinutes !== null);
  const respPass = respSamples.filter(e => (e.responseMinutes ?? 9999) <= config.maxDispatchResponseMinutes).length;
  const respRate = respSamples.length > 0 ? round1((respPass / respSamples.length) * 100) : null;

  const checkInPass = nonCancelled.filter(e => e.hasCheckIn).length;
  const checkInRate = nonCancelled.length > 0 ? round1((checkInPass / nonCancelled.length) * 100) : null;

  const opmSamples = periodTickets.filter(e => e.hasOpmSample);
  const opmPass = opmSamples.filter(e => e.isOpmPass).length;
  const opmRate = opmSamples.length > 0 ? round1((opmPass / opmSamples.length) * 100) : null;

  const photoSamples = periodTickets.filter(e => e.hasPhotoSample);
  const photoPass = photoSamples.filter(e => e.isPhotoPass).length;
  const photoRate = photoSamples.length > 0 ? round1((photoPass / photoSamples.length) * 100) : null;

  const operationalMatrix: SlaComplianceMatrixItem[] = [
    {
      id: 'dispatch_arrival',
      title: `1. Kecepatan On-Time Dispatch & Arrival (Max ${config.maxDispatchResponseMinutes} Mnt dari SPK)`,
      subtitle: `${respPass}/${respSamples.length} WO merespon dalam batas ${config.maxDispatchResponseMinutes} menit`,
      complianceRate: respRate,
      passedCount: respPass,
      totalCount: respSamples.length,
      statusTone: respRate !== null && respRate >= config.goodMin ? 'emerald' : 'amber'
    },
    {
      id: 'livechat_checkin',
      title: '2. Check-in Kamera & GPS Geotag Real-time',
      subtitle: `${checkInPass}/${nonCancelled.length} WO aktif memiliki validasi Check-in Kamera + GPS`,
      complianceRate: checkInRate,
      passedCount: checkInPass,
      totalCount: nonCancelled.length,
      statusTone: 'purple'
    },
    {
      id: 'opm_validation',
      title: `3. Validasi Redaman OPM Roset Pelanggan (> ${config.opmMaxLossDbm.toFixed(2)} dBm / Loss < ${Math.abs(config.opmMaxLossDbm).toFixed(2)} dBm)`,
      subtitle: `${opmPass}/${opmSamples.length} Technical Report lolos batas redaman OPM`,
      complianceRate: opmRate,
      passedCount: opmPass,
      totalCount: opmSamples.length,
      statusTone: opmRate !== null && opmRate >= config.goodMin ? 'emerald' : 'amber'
    },
    {
      id: 'photo_evidence',
      title: `4. Kelengkapan ${config.requiredPhotoCount} Foto Eviden Lapangan (FAT, DropCore, Roset, Speedtest)`,
      subtitle: `${photoPass}/${photoSamples.length} Technical Report melampirkan min. ${config.requiredPhotoCount} foto`,
      complianceRate: photoRate,
      passedCount: photoPass,
      totalCount: photoSamples.length,
      statusTone: photoRate !== null && photoRate >= config.excellentMin ? 'emerald' : 'purple'
    }
  ];

  // Critical SLA Breach Alert Queue rows
  const breachQueue: SlaBreachTicketItem[] = breachTickets.map(b => {
    const t = b.ticket;
    const vendorMeta = vendorSeedMap.get(b.contractorId);
    const matchedInstaller = activeInstallers.find(u =>
      (t.installerId && u.id === t.installerId)
      || (t.installerName && u.name.trim().toLowerCase() === t.installerName.trim().toLowerCase())
    );
    const lastAction = governanceLogs.find(g =>
      (g.ticketId && g.ticketId === t.id) || (g.woNumber && g.woNumber === t.woNumber)
    ) || null;

    const issueSummary =
      t.remarksWOInstaller
      || t.remarksAgent
      || t.remarks
      || t.distributionNotes
      || (b.hasCheckIn ? 'Dalam pengerjaan lapangan — mendekati deadline SLA' : 'Menunggu Check-in Kamera & GPS');

    return {
      ticketId: t.id,
      woNumber: t.woNumber,
      customerName: t.customerName || t.endUserName || 'Pelanggan',
      address: [t.address || t.streetName, t.clusterName].filter(Boolean).join(' • ') || b.areaName,
      area: b.areaName,
      contractorId: b.contractorId,
      contractorName: b.contractorName,
      installerName: t.installerName || t.assignedTo || 'Belum Ditugaskan',
      installerPhone: t.installerContact || matchedInstaller?.phone || '',
      leaderName: t.leaderName || t.corlapName || vendorMeta?.leaderName || 'Korlap',
      leaderPhone: t.leaderContact || t.corlapContact || vendorMeta?.leaderPhone || '',
      slotTime: t.slotTime || b.slot?.slotTime || '-',
      appointmentDate: b.woDate,
      slaDeadlineAt: b.slaDeadlineIso,
      minutesRemaining: b.minutesRemaining,
      isOverdue: b.minutesRemaining < 0,
      issueSummary,
      statusWOInstaller: t.statusWOInstaller || 'Unassigned',
      workSessionStatus: t.workSessionStatus || (b.hasCheckIn ? 'Sedang Dikerjakan' : 'Belum Check-in'),
      lastAction
    };
  });

  // Incentive & Penalty Ledger derived strictly from config.pksRules
  const pksItems: SlaPksLedgerItem[] = vendorLeaderboard.map(v => {
    const compliantCount = v.okCount;
    const breachCount = v.lateCount;
    let amount = 0;
    let ledgerType: SlaPksLedgerItem['ledgerType'] = 'NEUTRAL';
    let explanation = 'Belum ada WO terevaluasi pada periode ini';

    if (v.slaRate !== null) {
      if (v.slaRate >= config.globalSlaTarget && config.pksRules.bonusEnabled) {
        amount = compliantCount * config.pksRules.bonusRatePerCompliantWo;
        ledgerType = amount > 0 ? 'BONUS' : 'NEUTRAL';
        explanation = `Memenuhi SLA ${v.slaRate}% (≥ ${config.globalSlaTarget}%) • ${compliantCount} WO patuh`;
      } else if (v.slaRate >= config.pksRules.toleranceMinRate) {
        amount = 0;
        ledgerType = 'NEUTRAL';
        explanation = `SLA ${v.slaRate}% (Dalam batas toleransi ≥ ${config.pksRules.toleranceMinRate}%)`;
      } else {
        amount = -(breachCount * config.pksRules.penaltyRatePerBreachWo);
        ledgerType = amount < 0 ? 'PENALTY' : 'NEUTRAL';
        explanation = `SLA ${v.slaRate}% (Penalti ${breachCount} WO Breach SLA)`;
      }
    }

    return {
      contractorId: v.contractorId,
      contractorName: v.contractorName,
      slaRate: v.slaRate,
      slaStatus: v.slaStatus,
      volumeWo: v.volumeWo,
      compliantWoCount: compliantCount,
      breachWoCount: breachCount,
      amount,
      ledgerType,
      explanation
    };
  });

  const totalBonusAmount = pksItems.filter(i => i.amount > 0).reduce((acc, i) => acc + i.amount, 0);
  const totalPenaltyAmount = pksItems.filter(i => i.amount < 0).reduce((acc, i) => acc + i.amount, 0);
  const totalNetAmount = totalBonusAmount + totalPenaltyAmount;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    operationalDateWIB,
    period,
    dateRange: {
      start: startDate,
      end: endDate
    },
    clusterLabel: `Cluster: JKT-01 (${databaseSource === 'supabase' ? 'Supabase PostgreSQL' : 'Local Dev Store'})`,
    databaseSource,
    config,
    configVersion,
    isConfigPersistedInDb,
    kpis: {
      globalComplianceRate,
      globalTarget: config.globalSlaTarget,
      complianceGap,
      compliantWoCount: okCount,
      evaluatedWoCount: evaluatedCount,
      complianceStatus,
      totalDistributedWo: nonCancelled.length,
      okCount,
      wipCount,
      latCount: lateCount,
      ftrRate,
      ftrTarget: config.ftrTarget,
      ftrPassCount,
      ftrEvaluatedCount: ftrSamples.length,
      ftrStatus,
      photoOpmComplianceRate,
      photoOpmValidCount,
      photoOpmEvaluatedCount: photoOpmSamples.length,
      opmThresholdDbm: config.opmMaxLossDbm,
      requiredPhotoCount: config.requiredPhotoCount,
      criticalBreachCount: breachQueue.length,
      criticalVendorCount: breachVendorIds.size
    },
    vendorLeaderboard,
    slotTrend,
    slotInsights,
    operationalMatrix,
    breachQueue,
    pksLedger: {
      items: pksItems,
      totalNetAmount,
      totalBonusAmount,
      totalPenaltyAmount,
      clauseReference: config.pksRules.clauseReference,
      isCustomConfigured: config.pksRules.isCustomConfigured
    },
    recentGovernanceLogs: (governanceLogs || []).slice(0, 30),
    filterOptions: {
      areas: Array.from(areaSet).sort(),
      contractors: activeContractors.map(c => ({ id: c.id, name: c.name, code: c.code }))
    }
  };
}
