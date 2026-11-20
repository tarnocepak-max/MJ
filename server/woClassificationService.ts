/**
 * MORAJAWS — Centralized Server-Side WO Classification Engine
 * Evaluates Work Orders against Asia/Jakarta (UTC+7) calendar date strictly
 * from Appointment Date (never createdAt or generic date fallback).
 *
 * Categories:
 *  - TODAY     : Appointment Date == Jakarta today AND not completed/closed
 *  - UPCOMING  : Appointment Date > Jakarta today AND not completed/closed
 *  - OVERDUE   : Appointment Date < Jakarta today AND not completed/closed
 *  - COMPLETED : Has an officially recognized completed/closed status
 *  - EXCEPTION : Appointment Date is missing or invalid
 *
 * IMPORTANT: OVERDUE is strictly a display/query classification.
 * Never mutates original statusWOAgent, statusWOInstaller, or statusWhatsApp.
 */

export type WoClassification = 'TODAY' | 'UPCOMING' | 'OVERDUE' | 'COMPLETED' | 'EXCEPTION';
export type WoDateBucket = 'TODAY' | 'UPCOMING' | 'PAST' | 'EXCEPTION';
export type OverdueDurationBucket = '1_day' | '2_3_days' | '4_7_days' | 'gt_7_days';

export interface WoClassificationResult {
  classification: WoClassification;
  dateBucket: WoDateBucket;
  appointmentDateWIB: string | null;
  referenceDateWIB: string;
  isCompleted: boolean;
  isOverdue: boolean;
  isException: boolean;
  overdueDays: number;
  overdueDurationBucket: OverdueDurationBucket | null;
  exceptionReason?: string;
}

export interface OverdueSummaryMetrics {
  totalOverdue: number;
  overdue1Day: number;
  overdue2To3Days: number;
  overdue4To7Days: number;
  criticalOverdueGt7Days: number;
  maxOverdueDays: number;
  avgOverdueDays: number;
}

export interface WoClassificationSummary {
  total: number;
  today: number;
  upcoming: number;
  overdue: number;
  completed: number;
  exception: number;
  todayTotalAllStatuses: number;
  overdueBreakdown: OverdueSummaryMetrics;
}

export function getJakartaDateStringServer(dateInput: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dateInput);
  } catch {
    const jakartaMs = dateInput.getTime() + 7 * 60 * 60 * 1000;
    return new Date(jakartaMs).toISOString().slice(0, 10);
  }
}

function isValidYmdCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Strictly normalizes Appointment Date string/Date/Excel serial to YYYY-MM-DD in Asia/Jakarta.
 * Rejects invalid dates such as "2026-02-30", "invalid", or empty strings -> returns null.
 */
export function normalizeStrictAppointmentDateServer(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Support valid Excel serial date numbers (e.g. 46000)
    if (raw >= 25569 && raw <= 90000) {
      const utcMs = Math.round((raw - 25569) * 86400 * 1000);
      const dt = new Date(utcMs);
      if (!Number.isNaN(dt.getTime())) {
        return getJakartaDateStringServer(dt);
      }
    }
    return null;
  }

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : getJakartaDateStringServer(raw);
  }

  const str = String(raw).trim();
  if (!str) return null;
  const lower = str.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'invalid date' || lower === 'nan' || lower === '-') {
    return null;
  }

  // ISO YYYY-MM-DD (optionally with timestamp)
  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T|\s)/);
  if (ymdMatch) {
    const y = Number(ymdMatch[1]);
    const m = Number(ymdMatch[2]);
    const d = Number(ymdMatch[3]);
    // If string has explicit UTC/offset timestamp (T...Z or T...+00:00), convert to Jakarta date
    if (str.includes('T') && (str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str))) {
      const dt = new Date(str);
      if (!Number.isNaN(dt.getTime())) {
        return getJakartaDateStringServer(dt);
      }
      return null;
    }
    if (!isValidYmdCalendarDate(y, m, d)) return null;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s|$)/);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    if (!isValidYmdCalendarDate(y, m, d)) return null;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return null;
}

/**
 * Extracts Appointment Date strictly from appointment-specific fields ONLY.
 * Never falls back to `date`, `ticketDate`, `createdAt`, or `importDate`.
 */
export function getStrictAppointmentDateServer(ticket: any): string | null {
  if (!ticket || typeof ticket !== 'object') return null;
  const candidates = [
    ticket.appointmentDate,
    ticket.appointment_date,
    ticket.scheduleAppointment,
    ticket.scheduleAppointmentDate,
    ticket.scheduleDate,
    ticket.scheduledDate,
    ticket.schedule_date
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c).trim() !== '') {
      const normalized = normalizeStrictAppointmentDateServer(c);
      if (normalized) return normalized;
    }
  }
  return null;
}

/**
 * Authoritative completion check matching MoraJaws lifecycle & SQL view `v_work_orders_classified`.
 */
export function isWoCompletedOrClosedServer(ticket: any): boolean {
  if (!ticket || typeof ticket !== 'object') return false;

  const ticketResult = String(ticket.ticketResult || '').trim().toLowerCase();
  const approvalStatus = String(ticket.approvalStatus || '').trim().toUpperCase();
  const isRejectedOrRevision =
    approvalStatus === 'REJECTED' ||
    approvalStatus === 'REVISI' ||
    approvalStatus === 'REVISION' ||
    approvalStatus === 'REVISION / REJECTED';

  if (isRejectedOrRevision && ticketResult !== 'closed') {
    return false;
  }

  if (ticketResult === 'closed') return true;
  if (approvalStatus === 'APPROVED') return true;
  if (ticket.closedAt && String(ticket.closedAt).trim()) return true;

  const agent = String(ticket.statusWOAgent || ticket.status_wo_agent || '').trim().toLowerCase();
  if (['done', 'resolved', 'closed', 'cancel', 'cancelled'].includes(agent)) {
    return true;
  }

  const installer = String(ticket.statusWOInstaller || ticket.status_wo_installer || '').trim().toLowerCase();
  if (['completed', 'installed', 'failed / cancelled', 'cancel', 'cancelled'].includes(installer)) {
    return true;
  }

  return false;
}

/**
 * Exact calendar day difference (laterYmd - earlierYmd) in days using UTC midnight.
 */
export function diffCalendarDaysYmd(earlierYmd: string, laterYmd: string): number {
  const [ey, em, ed] = earlierYmd.split('-').map(Number);
  const [ly, lm, ld] = laterYmd.split('-').map(Number);
  if (!ey || !em || !ed || !ly || !lm || !ld) return 0;
  const eUtc = Date.UTC(ey, em - 1, ed);
  const lUtc = Date.UTC(ly, lm - 1, ld);
  return Math.round((lUtc - eUtc) / 86400000);
}

export function getOverdueDurationBucket(overdueDays: number): OverdueDurationBucket | null {
  if (!Number.isFinite(overdueDays) || overdueDays <= 0) return null;
  if (overdueDays === 1) return '1_day';
  if (overdueDays <= 3) return '2_3_days';
  if (overdueDays <= 7) return '4_7_days';
  return 'gt_7_days';
}

export function classifyWorkOrderServer(
  ticket: any,
  referenceDateWIB: string = getJakartaDateStringServer()
): WoClassificationResult {
  const refDate = normalizeStrictAppointmentDateServer(referenceDateWIB) || getJakartaDateStringServer();
  const appointmentDateWIB = getStrictAppointmentDateServer(ticket);
  const isCompleted = isWoCompletedOrClosedServer(ticket);

  if (!appointmentDateWIB) {
    const rawCandidate =
      ticket?.appointmentDate ??
      ticket?.appointment_date ??
      ticket?.scheduleDate ??
      ticket?.scheduledDate;
    const hasRawValue = rawCandidate !== undefined && rawCandidate !== null && String(rawCandidate).trim() !== '';
    return {
      classification: 'EXCEPTION',
      dateBucket: 'EXCEPTION',
      appointmentDateWIB: null,
      referenceDateWIB: refDate,
      isCompleted,
      isOverdue: false,
      isException: true,
      overdueDays: 0,
      overdueDurationBucket: null,
      exceptionReason: hasRawValue
        ? `Format Appointment Date tidak valid (${String(rawCandidate)})`
        : 'Appointment Date kosong'
    };
  }

  const dateBucket: WoDateBucket =
    appointmentDateWIB < refDate
      ? 'PAST'
      : appointmentDateWIB === refDate
      ? 'TODAY'
      : 'UPCOMING';

  if (isCompleted) {
    return {
      classification: 'COMPLETED',
      dateBucket,
      appointmentDateWIB,
      referenceDateWIB: refDate,
      isCompleted: true,
      isOverdue: false,
      isException: false,
      overdueDays: 0,
      overdueDurationBucket: null
    };
  }

  if (appointmentDateWIB < refDate) {
    const overdueDays = Math.max(1, diffCalendarDaysYmd(appointmentDateWIB, refDate));
    return {
      classification: 'OVERDUE',
      dateBucket: 'PAST',
      appointmentDateWIB,
      referenceDateWIB: refDate,
      isCompleted: false,
      isOverdue: true,
      isException: false,
      overdueDays,
      overdueDurationBucket: getOverdueDurationBucket(overdueDays)
    };
  }

  if (appointmentDateWIB === refDate) {
    return {
      classification: 'TODAY',
      dateBucket: 'TODAY',
      appointmentDateWIB,
      referenceDateWIB: refDate,
      isCompleted: false,
      isOverdue: false,
      isException: false,
      overdueDays: 0,
      overdueDurationBucket: null
    };
  }

  return {
    classification: 'UPCOMING',
    dateBucket: 'UPCOMING',
    appointmentDateWIB,
    referenceDateWIB: refDate,
    isCompleted: false,
    isOverdue: false,
    isException: false,
    overdueDays: 0,
    overdueDurationBucket: null
  };
}

export function attachClassificationMetadata<T extends Record<string, any>>(
  ticket: T,
  referenceDateWIB: string = getJakartaDateStringServer()
): T & {
  woClassification: WoClassification;
  overdueDays: number;
  overdueDurationBucket: OverdueDurationBucket | null;
  classificationDateWIB: string;
} {
  const res = classifyWorkOrderServer(ticket, referenceDateWIB);
  return {
    ...ticket,
    woClassification: res.classification,
    overdueDays: res.overdueDays,
    overdueDurationBucket: res.overdueDurationBucket,
    classificationDateWIB: res.referenceDateWIB
  };
}

export function summarizeWorkOrderClassificationsServer(
  tickets: any[],
  referenceDateWIB: string = getJakartaDateStringServer()
): WoClassificationSummary {
  const refDate = normalizeStrictAppointmentDateServer(referenceDateWIB) || getJakartaDateStringServer();
  let total = 0;
  let today = 0;
  let upcoming = 0;
  let overdue = 0;
  let completed = 0;
  let exception = 0;
  let todayTotalAllStatuses = 0;

  let overdue1Day = 0;
  let overdue2To3Days = 0;
  let overdue4To7Days = 0;
  let criticalOverdueGt7Days = 0;
  let maxOverdueDays = 0;
  let totalOverdueDaysSum = 0;

  for (const t of tickets || []) {
    if (!t || t.isDeleted || t.isArchived) continue;
    total++;
    const c = classifyWorkOrderServer(t, refDate);
    if (c.dateBucket === 'TODAY') {
      todayTotalAllStatuses++;
    }
    switch (c.classification) {
      case 'TODAY':
        today++;
        break;
      case 'UPCOMING':
        upcoming++;
        break;
      case 'OVERDUE':
        overdue++;
        totalOverdueDaysSum += c.overdueDays;
        if (c.overdueDays > maxOverdueDays) maxOverdueDays = c.overdueDays;
        if (c.overdueDurationBucket === '1_day') overdue1Day++;
        else if (c.overdueDurationBucket === '2_3_days') overdue2To3Days++;
        else if (c.overdueDurationBucket === '4_7_days') overdue4To7Days++;
        else if (c.overdueDurationBucket === 'gt_7_days') criticalOverdueGt7Days++;
        break;
      case 'COMPLETED':
        completed++;
        break;
      case 'EXCEPTION':
        exception++;
        break;
    }
  }

  return {
    total,
    today,
    upcoming,
    overdue,
    completed,
    exception,
    todayTotalAllStatuses,
    overdueBreakdown: {
      totalOverdue: overdue,
      overdue1Day,
      overdue2To3Days,
      overdue4To7Days,
      criticalOverdueGt7Days,
      maxOverdueDays,
      avgOverdueDays: overdue > 0 ? Math.round((totalOverdueDaysSum / overdue) * 10) / 10 : 0
    }
  };
}
