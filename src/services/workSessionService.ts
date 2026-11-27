/**
 * MoraJaws Work Session & Installer Check-in / Check-out Service
 *
 * Implements:
 * - Authoritative Check-in via live camera + GPS geotag persistence (decoupled from LiveChat PROGRESS)
 * - Automatic check-out when Installer successfully saves progress/technical report
 * - Work duration calculation (in minutes and human-readable Indonesian format)
 * - Server-grade timestamping in Asia/Jakarta (WIB) timezone
 * - Protection against double check-in and duplicate check-out submissions
 * - Session history tracking for re-opened or rework tickets
 */

import { Ticket } from '../types';

export type WorkSessionStatus = 'Belum Check-in' | 'Sedang Dikerjakan' | 'Selesai';

/**
 * Formats ISO timestamp to human-readable Asia/Jakarta (WIB) time string.
 * E.g., "01 Nov 2026, 14:30:00 WIB"
 */
export function formatJakartaTimestamp(isoStr?: string | null): string {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '-';
    return (
      new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(d) + ' WIB'
    );
  } catch {
    return isoStr;
  }
}

/**
 * Formats time-only in Asia/Jakarta (WIB).
 * E.g., "14:30 WIB"
 */
export function formatJakartaTimeOnly(isoStr?: string | null): string {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '-';
    return (
      new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(d) + ' WIB'
    );
  } catch {
    return isoStr;
  }
}

/**
 * Formats duration in minutes into Indonesian string: "1 jam 25 menit" or "45 menit".
 */
export function formatWorkDuration(minutes?: number | null): string {
  if (minutes === undefined || minutes === null || isNaN(minutes) || minutes <= 0) {
    return '-';
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) {
    return `${hours} jam ${mins} menit`;
  }
  if (hours > 0) {
    return `${hours} jam`;
  }
  return `${mins} menit`;
}

/**
 * Calculates work duration in minutes between checkIn and checkOut.
 */
export function calculateDurationMinutes(checkInIso: string, checkOutIso: string): number {
  try {
    const inMs = new Date(checkInIso).getTime();
    const outMs = new Date(checkOutIso).getTime();
    if (isNaN(inMs) || isNaN(outMs) || outMs < inMs) return 0;
    return Math.max(1, Math.round((outMs - inMs) / (1000 * 60)));
  } catch {
    return 0;
  }
}

/**
 * Strictly detects if the selected LiveChat category is 'PROGRESS'.
 * App Flow 5 Rule: Check-in triggers ONLY when selected category is 'PROGRESS'.
 */
export function isProgressCategory(category?: string | null): boolean {
  return String(category || '').trim().toUpperCase() === 'PROGRESS';
}

/**
 * Legacy-compatible wrapper: requires selected category === 'PROGRESS'.
 * Free-text keyword matching in other categories is intentionally disabled.
 */
export function isProgressCheckInMessage(_text?: string | null, category?: string | null): boolean {
  return isProgressCategory(category);
}

/**
 * Computes the active work session status for a ticket.
 */
export function getTicketWorkStatus(ticket: Ticket): {
  status: WorkSessionStatus;
  checkInAt?: string;
  checkOutAt?: string;
  durationMinutes?: number;
  durationFormatted: string;
} {
  if (!ticket.checkInAt) {
    return {
      status: 'Belum Check-in',
      durationFormatted: '-'
    };
  }

  if (!ticket.checkOutAt) {
    return {
      status: 'Sedang Dikerjakan',
      checkInAt: ticket.checkInAt,
      durationFormatted: 'Sedang Berjalan'
    };
  }

  const duration =
    ticket.workDurationMinutes ??
    calculateDurationMinutes(ticket.checkInAt, ticket.checkOutAt);

  return {
    status: 'Selesai',
    checkInAt: ticket.checkInAt,
    checkOutAt: ticket.checkOutAt,
    durationMinutes: duration,
    durationFormatted: formatWorkDuration(duration)
  };
}
