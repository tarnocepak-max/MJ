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

export type UnsuccessOptionKey = 'pending' | 'reschedule' | 'cancel';

export interface UnsuccessCategoryOption {
  key: UnsuccessOptionKey;
  title: string;
  description: string;
  flowType: 'progress_report';
  matchedStatus: HierarchicalStatus | null;
  reasons: HierarchicalReason[];
  isConfigured: boolean;
}

export interface SemanticStatusToneStyles {
  cardSelected: string;
  cardIdle: string;
  iconSelected: string;
  iconIdle: string;
  radioSelected: string;
  badge: string;
  accentText: string;
  focusRing: string;
  dot: string;
}

const SEMANTIC_UNSUCCESS_STYLES: Record<UnsuccessOptionKey, SemanticStatusToneStyles> = {
  pending: {
    cardSelected:
      'bg-[#FFF2D9] dark:bg-amber-950/55 border-[#D4933E] dark:border-amber-500 text-[#9D661F] dark:text-amber-100 shadow-xs',
    cardIdle:
      'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#E8DDFF] hover:border-[#D4933E]/70',
    iconSelected: 'bg-[#D4933E] dark:bg-amber-600 text-white',
    iconIdle: 'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#C88735] dark:text-amber-300',
    radioSelected: 'bg-[#C88735] dark:bg-amber-500 border-[#C88735] dark:border-amber-500 text-white',
    badge:
      'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-200 border-[#F2CF95] dark:border-amber-700',
    accentText: 'text-[#9D661F] dark:text-amber-300',
    focusRing: 'focus:ring-[#C88735] dark:focus:ring-amber-500',
    dot: 'bg-[#C88735] dark:bg-amber-500'
  },
  reschedule: {
    cardSelected:
      'bg-[#E7F1FB] dark:bg-blue-950/55 border-[#3E81C6] dark:border-blue-500 text-[#1E4F8A] dark:text-blue-100 shadow-xs',
    cardIdle:
      'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#E8DDFF] hover:border-[#3E81C6]/70',
    iconSelected: 'bg-[#3E81C6] dark:bg-blue-600 text-white',
    iconIdle: 'bg-[#E7F1FB] dark:bg-blue-950/60 text-[#3E81C6] dark:text-blue-300',
    radioSelected: 'bg-[#3E81C6] dark:bg-blue-500 border-[#3E81C6] dark:border-blue-500 text-white',
    badge:
      'bg-[#E7F1FB] dark:bg-blue-950/60 text-[#1E4F8A] dark:text-blue-200 border-[#B6D4F4] dark:border-blue-700',
    accentText: 'text-[#1E4F8A] dark:text-blue-300',
    focusRing: 'focus:ring-[#3E81C6] dark:focus:ring-blue-500',
    dot: 'bg-[#3E81C6] dark:bg-blue-500'
  },
  cancel: {
    cardSelected:
      'bg-[#FCE9EB] dark:bg-rose-950/60 border-[#9B2C37] dark:border-rose-500 text-[#7F1D27] dark:text-rose-100 shadow-xs',
    cardIdle:
      'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#E8DDFF] hover:border-[#9B2C37]/70',
    iconSelected: 'bg-[#9B2C37] dark:bg-rose-700 text-white',
    iconIdle: 'bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-300',
    radioSelected: 'bg-[#9B2C37] dark:bg-rose-600 border-[#9B2C37] dark:border-rose-600 text-white',
    badge:
      'bg-[#FCE9EB] dark:bg-rose-950/65 text-[#9B2C37] dark:text-rose-200 border-[#F2BCC2] dark:border-rose-700',
    accentText: 'text-[#9B2C37] dark:text-rose-300',
    focusRing: 'focus:ring-[#9B2C37] dark:focus:ring-rose-500',
    dot: 'bg-[#9B2C37] dark:bg-rose-500'
  }
};

export function getUnsuccessOptionSemanticStyles(key: UnsuccessOptionKey): SemanticStatusToneStyles {
  return SEMANTIC_UNSUCCESS_STYLES[key] || SEMANTIC_UNSUCCESS_STYLES.pending;
}

export function getReportStatusSurfaceTint(rawStatus?: string | null): string {
  const canonical = normalizeCanonicalReportStatus(rawStatus);
  if (canonical === 'COMPLETE') {
    return 'border-l-4 border-l-[#218A63] dark:border-l-emerald-500';
  }
  if (canonical === 'PENDING') {
    return 'border-l-4 border-l-[#C88735] dark:border-l-amber-500';
  }
  if (canonical === 'RESCHEDULE') {
    return 'border-l-4 border-l-[#3E81C6] dark:border-l-blue-500';
  }
  if (canonical === 'CANCEL') {
    return 'border-l-4 border-l-[#9B2C37] dark:border-l-rose-600';
  }
  return '';
}

/**
 * Resolves the 3 Unsuccess workflow options (`Pending`, `Reschedule`, `Cancel`)
 * against the active `hierarchicalStatuses` configuration.
 * Kendala lapangan is reported through `Pending` + Level-2 Reason + Remarks.
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
      description: 'Pekerjaan tertunda atau terkendala di lapangan (termasuk kendala teknis, akses lokasi, atau material).',
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
      description: 'Pekerjaan dibatalkan di lapangan berdasarkan permintaan pelanggan atau validasi kondisi lokasi.',
      flowType: 'progress_report',
      matchedStatus: cancelStatus,
      reasons: getActiveReasonsForStatus(cancelStatus),
      isConfigured: Boolean(cancelStatus && getActiveReasonsForStatus(cancelStatus).length > 0)
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
