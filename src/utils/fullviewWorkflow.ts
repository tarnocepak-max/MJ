import type {
  HierarchicalReason,
  HierarchicalStatus,
  Ticket
} from '../types/index.ts';
import {
  buildWhatsAppClickToChatUrl,
  normalizePhoneNumber
} from '../services/whatsappService.ts';
import { normalizeCanonicalReportStatus } from '../services/woLifecycleService.ts';
import { formatJakartaTimeOnly } from '../services/workSessionService.ts';
import { isMeaningfulAddressValue } from './addressFormatter.ts';

export interface ExtractedCustomerContact {
  raw: string;
  label: string;
  telHref: string;
  waUrl: string;
  normalizedDigits: string;
}

const EMPTY_CONTACT_VALUES = new Set(['-', '--', 'n/a', 'na', 'null', 'undefined', 'kosong', 'none']);

function cleanRawContact(val: unknown): string {
  if (val === null || val === undefined) return '';
  const trimmed = String(val).trim();
  if (!trimmed || EMPTY_CONTACT_VALUES.has(trimmed.toLowerCase())) return '';
  return trimmed;
}

/**
 * Extracts real, deduplicated customer phone contacts strictly from existing Ticket fields.
 * Never fabricates placeholder numbers or synthetic fields like subscriptionId.
 */
export function extractCustomerContacts(ticket?: Partial<Ticket> | null): ExtractedCustomerContact[] {
  if (!ticket) return [];

  const candidates: Array<{ label: string; value: unknown }> = [
    { label: 'Utama', value: ticket.customerPhone },
    { label: 'Kontak 1', value: ticket.customerContact1 },
    { label: 'Kontak 2', value: ticket.customerContact2 },
    { label: 'Kontak 3', value: ticket.customerContact3 }
  ];

  const seen = new Set<string>();
  const results: ExtractedCustomerContact[] = [];

  for (const item of candidates) {
    const raw = cleanRawContact(item.value);
    if (!raw) continue;
    const digitsOnly = raw.replace(/\D/g, '');
    const normDigits = normalizePhoneNumber(raw);
    const dedupeKey = normDigits || digitsOnly || raw.toLowerCase();
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const telCleaned = raw.replace(/[^\d+]/g, '');
    const telHref = telCleaned.length >= 6 ? `tel:${telCleaned}` : '';
    const waObj = buildWhatsAppClickToChatUrl(
      raw,
      `Halo ${ticket.customerName || 'Pelanggan'}, saya teknisi terkait penanganan WO ${ticket.woNumber || ''}.`
    );

    results.push({
      raw,
      label: item.label,
      telHref,
      waUrl: waObj.url || '',
      normalizedDigits: normDigits
    });
  }

  return results;
}

export interface CompletedStatusHierarchyResolution {
  availableStatuses: HierarchicalStatus[];
  defaultStatus: HierarchicalStatus | null;
  isConfigured: boolean;
  hasAnyReasons: boolean;
}

export function getActiveReasonsForStatus(status?: HierarchicalStatus | null): HierarchicalReason[] {
  if (!status || !Array.isArray(status.reasons)) return [];
  return status.reasons
    .filter(r => r && r.active !== false && (r as { isActive?: boolean }).isActive !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Resolves active Level-1 Completed statuses and their Level-2 reasons strictly
 * from configured `hierarchicalStatuses` without inventing hardcoded IDs/codes.
 */
export function resolveCompletedStatusHierarchy(
  hierarchicalStatuses: readonly HierarchicalStatus[] | null | undefined
): CompletedStatusHierarchyResolution {
  const activeStatuses = (hierarchicalStatuses || [])
    .filter(s => s && s.active !== false && (s as { isActive?: boolean }).isActive !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const completeStatuses = activeStatuses.filter(s => {
    const canonicalByCode = normalizeCanonicalReportStatus(s.code);
    const canonicalByName = normalizeCanonicalReportStatus(s.name);
    return canonicalByCode === 'COMPLETE' || canonicalByName === 'COMPLETE';
  });

  const defaultStatus = completeStatuses[0] || null;
  const hasAnyReasons = completeStatuses.some(s => getActiveReasonsForStatus(s).length > 0);

  return {
    availableStatuses: completeStatuses,
    defaultStatus,
    isConfigured: completeStatuses.length > 0,
    hasAnyReasons
  };
}

export type UnsuccessOptionKey = 'pending' | 'reschedule' | 'cancel' | 'kendala';

export interface UnsuccessCategoryOption {
  key: UnsuccessOptionKey;
  title: string;
  description: string;
  flowType: 'progress_report' | 'kendala_modal';
  matchedStatus: HierarchicalStatus | null;
  reasons: HierarchicalReason[];
  isConfigured: boolean;
}

/**
 * Resolves the 4 Unsuccess workflow options (`Pending`, `Reschedule`, `Cancel`, `Kendala Lapangan`)
 * against the active `hierarchicalStatuses` configuration.
 */
export function resolveUnsuccessCategories(
  hierarchicalStatuses: readonly HierarchicalStatus[] | null | undefined
): UnsuccessCategoryOption[] {
  const activeStatuses = (hierarchicalStatuses || [])
    .filter(s => s && s.active !== false && (s as { isActive?: boolean }).isActive !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const findByCanonical = (target: 'PENDING' | 'RESCHEDULE' | 'CANCEL'): HierarchicalStatus | null => {
    return (
      activeStatuses.find(
        s =>
          normalizeCanonicalReportStatus(s.code) === target ||
          normalizeCanonicalReportStatus(s.name) === target
      ) || null
    );
  };

  const pendingStatus = findByCanonical('PENDING');
  const rescheduleStatus = findByCanonical('RESCHEDULE');
  const cancelStatus = findByCanonical('CANCEL');

  return [
    {
      key: 'pending',
      title: 'Pending',
      description: 'Pekerjaan belum dapat diselesaikan saat ini dan memerlukan tindak lanjut lanjutan.',
      flowType: 'progress_report',
      matchedStatus: pendingStatus,
      reasons: getActiveReasonsForStatus(pendingStatus),
      isConfigured: Boolean(pendingStatus && getActiveReasonsForStatus(pendingStatus).length > 0)
    },
    {
      key: 'reschedule',
      title: 'Reschedule',
      description: 'Kunjungan perlu dijadwalkan ulang sesuai ketersediaan pelanggan atau kondisi teknis.',
      flowType: 'progress_report',
      matchedStatus: rescheduleStatus,
      reasons: getActiveReasonsForStatus(rescheduleStatus),
      isConfigured: Boolean(rescheduleStatus && getActiveReasonsForStatus(rescheduleStatus).length > 0)
    },
    {
      key: 'cancel',
      title: 'Cancel',
      description: 'Pekerjaan dibatalkan di lapangan berdasarkan permintaan atau validasi kondisi lokasi.',
      flowType: 'progress_report',
      matchedStatus: cancelStatus,
      reasons: getActiveReasonsForStatus(cancelStatus),
      isConfigured: Boolean(cancelStatus && getActiveReasonsForStatus(cancelStatus).length > 0)
    },
    {
      key: 'kendala',
      title: 'Kendala Lapangan',
      description: 'Laporkan hambatan lokasi atau teknis dengan foto bukti langsung ke Leader & Dispatch (#ISSUE).',
      flowType: 'kendala_modal',
      matchedStatus: null,
      reasons: [],
      isConfigured: true
    }
  ];
}

export interface LocationExtraMeta {
  cluster: string;
  homepass: string;
  fatCode: string;
  fdtCode: string;
  rtRw: string;
  blokNomor: string;
}

function pickRecordString(
  record: Record<string, unknown> | undefined,
  keys: string[]
): string {
  if (!record || typeof record !== 'object') return '';
  for (const [rawKey, rawVal] of Object.entries(record)) {
    const norm = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (keys.includes(norm) && isMeaningfulAddressValue(rawVal)) {
      return String(rawVal).trim();
    }
  }
  return '';
}

export function extractLocationExtraMeta(ticket?: Partial<Ticket> | null): LocationExtraMeta {
  if (!ticket) {
    return { cluster: '', homepass: '', fatCode: '', fdtCode: '', rtRw: '', blokNomor: '' };
  }
  const raw = (ticket as { rawColumns?: Record<string, unknown> }).rawColumns;
  const add = ticket.additionalFields as Record<string, unknown> | undefined;

  const cluster = isMeaningfulAddressValue(ticket.clusterName)
    ? String(ticket.clusterName).trim()
    : pickRecordString(raw, ['cluster', 'clustername']) ||
      pickRecordString(add, ['cluster', 'clustername']);

  const hpId = isMeaningfulAddressValue(ticket.homepassDetailId)
    ? String(ticket.homepassDetailId).trim()
    : pickRecordString(raw, ['homepassid', 'homepassdetailid', 'homepass']) ||
      pickRecordString(add, ['homepassid', 'homepassdetailid', 'homepass']);
  const hpType = isMeaningfulAddressValue(ticket.homepassType)
    ? String(ticket.homepassType).trim()
    : '';
  const homepass = [hpId, hpType].filter(Boolean).join(' · ');

  const fatCode = isMeaningfulAddressValue(ticket.fatCode || ticket.fat)
    ? String(ticket.fatCode || ticket.fat).trim()
    : '';
  const fdtCode = isMeaningfulAddressValue(ticket.fdtCode || ticket.fdt)
    ? String(ticket.fdtCode || ticket.fdt).trim()
    : '';

  const rt = pickRecordString(raw, ['rt']) || pickRecordString(add, ['rt']);
  const rw = pickRecordString(raw, ['rw']) || pickRecordString(add, ['rw']);
  const rtrwDirect = pickRecordString(raw, ['rtrw']) || pickRecordString(add, ['rtrw']);
  const rtRw = rtrwDirect || (rt || rw ? `RT ${rt || '-'} / RW ${rw || '-'}` : '');

  const blok = pickRecordString(raw, ['blok', 'block']) || pickRecordString(add, ['blok', 'block']);
  const nomor =
    pickRecordString(raw, ['norumah', 'nomorrumah', 'housenumber']) ||
    pickRecordString(add, ['norumah', 'nomorrumah', 'housenumber']);
  const blokNomor = [blok ? `Blok ${blok.replace(/^blok\s+/i, '')}` : '', nomor ? `No. ${nomor.replace(/^no\.?\s*/i, '')}` : '']
    .filter(Boolean)
    .join(' ');

  return { cluster, homepass, fatCode, fdtCode, rtRw, blokNomor };
}

export function formatFullviewTimeValue(iso?: string | null): string {
  if (!iso || !String(iso).trim()) return '-';
  const formatted = formatJakartaTimeOnly(iso);
  return formatted && formatted !== '-' ? `${formatted} WIB` : '-';
}
