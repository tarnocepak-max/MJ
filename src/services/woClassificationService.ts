import {
  Ticket,
  WoClassification,
  OverdueDurationBucket,
  OverdueSummaryMetrics,
  WoClassificationSummary
} from '../types';
import { getJakartaDateString, parseAppointmentDate } from './appointmentDateParser';

export type WoDateBucket = 'TODAY' | 'UPCOMING' | 'PAST' | 'EXCEPTION';

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

/**
 * Strictly resolves Appointment Date from appointment-specific fields ONLY.
 * Rejects missing or malformed dates cleanly so they fall into EXCEPTION.
 */
export function getStrictAppointmentDateClient(ticket: Partial<Ticket> | any): string | null {
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
      const parsed = parseAppointmentDate(c);
      if (parsed.isValid && parsed.date) {
        return parsed.date;
      }
    }
  }
  return null;
}

/**
 * Authoritative frontend completion check mirroring server & SQL view `v_work_orders_classified`.
 */
export function isWoCompletedOrClosed(ticket: Partial<Ticket> | any): boolean {
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

  const agent = String(ticket.statusWOAgent || '').trim().toLowerCase();
  if (['done', 'resolved', 'closed', 'cancel', 'cancelled'].includes(agent)) {
    return true;
  }

  const installer = String(ticket.statusWOInstaller || '').trim().toLowerCase();
  if (['completed', 'installed', 'failed / cancelled', 'cancel', 'cancelled'].includes(installer)) {
    return true;
  }

  return false;
}

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

export function getOverdueDurationLabel(overdueDays: number): string {
  if (!Number.isFinite(overdueDays) || overdueDays <= 0) return '-';
  return `${overdueDays} Hari`;
}

export function getOverdueBucketLabel(bucket: OverdueDurationBucket | null): string {
  switch (bucket) {
    case '1_day':
      return 'Overdue 1 Hari';
    case '2_3_days':
      return 'Overdue 2–3 Hari';
    case '4_7_days':
      return 'Overdue 4–7 Hari';
    case 'gt_7_days':
      return 'Critical (>7 Hari)';
    default:
      return '-';
  }
}

export function classifyWorkOrder(
  ticket: Partial<Ticket> | any,
  referenceDateWIB: string = getJakartaDateString(0)
): WoClassificationResult {
  const parsedRef = parseAppointmentDate(referenceDateWIB);
  const refDate = (parsedRef.isValid && parsedRef.date) ? parsedRef.date : getJakartaDateString(0);
  const appointmentDateWIB = getStrictAppointmentDateClient(ticket);
  const isCompleted = isWoCompletedOrClosed(ticket);

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

export function summarizeWorkOrderClassifications(
  tickets: Ticket[],
  referenceDateWIB: string = getJakartaDateString(0)
): WoClassificationSummary {
  const parsedRef = parseAppointmentDate(referenceDateWIB);
  const refDate = (parsedRef.isValid && parsedRef.date) ? parsedRef.date : getJakartaDateString(0);

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
    const c = classifyWorkOrder(t, refDate);
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

  const overdueBreakdown: OverdueSummaryMetrics = {
    totalOverdue: overdue,
    overdue1Day,
    overdue2To3Days,
    overdue4To7Days,
    criticalOverdueGt7Days,
    maxOverdueDays,
    avgOverdueDays: overdue > 0 ? Math.round((totalOverdueDaysSum / overdue) * 10) / 10 : 0
  };

  return {
    total,
    today,
    upcoming,
    overdue,
    completed,
    exception,
    todayTotalAllStatuses,
    overdueBreakdown
  };
}
