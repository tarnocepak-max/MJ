import React from 'react';
import {
  WhatsAppConfirmationStatus,
  TicketStatusWOAgent,
  TicketStatusWOInstaller,
  WOApprovalStatus
} from '../../types';

export type StatusBadgeVariant =
  | 'auto'
  | 'assignment'
  | 'checkin'
  | 'report'
  | 'approval'
  | 'wo_agent';

interface StatusBadgeProps {
  status?: string | null;
  variant?: StatusBadgeVariant;
  size?: 'xs' | 'sm';
  className?: string;
}

const BADGE_TONES = {
  neutral:
    'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1] dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700',
  blue:
    'bg-[#EFF6FF] text-[#1D4ED8] border-[#93C5FD] dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800',
  amber:
    'bg-[#FEF3C7] text-[#B45309] border-[#FCD34D] dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700',
  green:
    'bg-[#ECFDF5] text-[#15803D] border-[#86EFAC] dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700',
  violet:
    'bg-[#F5F1FF] text-[#6D28D9] border-[#D8B4FE] dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700',
  orange:
    'bg-[#FFF7ED] text-[#C2410C] border-[#FDBA74] dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-700',
  red:
    'bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5] dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700',
  slateDark:
    'bg-[#334155] text-white border-[#1E293B] dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700'
};

function resolveBadgeStyle(rawStatus: string, variant: StatusBadgeVariant): { label: string; style: string; dot?: string } {
  const s = (rawStatus || '').trim();
  const u = s.toUpperCase();

  if (!s || u === '-' || u === 'NONE') {
    return { label: '-', style: BADGE_TONES.neutral };
  }

  // CLOSED
  if (u === 'CLOSED' || u === 'WO CLOSED') {
    return { label: 'CLOSED', style: BADGE_TONES.slateDark, dot: 'bg-white/80' };
  }

  // COMPLETE / APPROVED
  if (u === 'APPROVED') {
    return { label: 'APPROVED', style: BADGE_TONES.green, dot: 'bg-[#15803D]' };
  }
  if (u === 'COMPLETE' || u === 'COMPLETED' || u === 'INSTALLED' || u === 'RESOLVED') {
    return { label: u === 'RESOLVED' ? 'RESOLVED' : 'COMPLETE', style: BADGE_TONES.green, dot: 'bg-[#15803D]' };
  }

  // WAITING APPROVAL / BUTUH APPROVAL
  if (u === 'BUTUH APPROVAL' || u === 'WAITING APPROVAL' || u === 'PENDING APPROVAL') {
    return {
      label: variant === 'approval' ? 'WAITING APPROVAL' : s.toUpperCase(),
      style: BADGE_TONES.orange,
      dot: 'bg-[#C2410C]'
    };
  }

  // CANCEL / REVISION / REJECTED
  if (u === 'CANCEL' || u === 'CANCELLED' || u === 'FAILED / CANCELLED') {
    return { label: 'CANCEL', style: BADGE_TONES.red, dot: 'bg-[#B91C1C]' };
  }
  if (u === 'REJECTED' || u === 'REVISI' || u === 'REVISION' || u === 'REVISION / REJECTED' || u === 'PERLU REVISI') {
    return { label: 'REVISION / REJECTED', style: BADGE_TONES.red, dot: 'bg-[#B91C1C]' };
  }

  // RESCHEDULE
  if (u.includes('RESCHEDULE')) {
    return { label: 'RESCHEDULE', style: BADGE_TONES.violet, dot: 'bg-[#6D28D9]' };
  }

  // PENDING
  if (u === 'PENDING' || u === 'PENDING TECHNICAL') {
    return { label: 'PENDING', style: BADGE_TONES.amber, dot: 'bg-[#B45309]' };
  }

  // ASSIGNED / CHECK-IN / PROGRESS
  if (u === 'ASSIGNED' || u === 'SUDAH ASSIGN') {
    return { label: 'ASSIGNED', style: BADGE_TONES.blue, dot: 'bg-[#1D4ED8]' };
  }
  if (u === 'CHECK-IN' || u === 'SUDAH CHECK-IN' || u === 'PROGRESS' || u === 'IN PROGRESS' || u === 'ON SITE' || u === 'EN ROUTE' || u === 'SEDANG DIKERJAKAN') {
    const label =
      variant === 'checkin'
        ? 'CHECK-IN · PROGRESS'
        : u === 'IN PROGRESS'
        ? 'IN PROGRESS'
        : u === 'PROGRESS'
        ? 'PROGRESS'
        : s.toUpperCase();
    return { label, style: BADGE_TONES.blue, dot: 'bg-[#1D4ED8]' };
  }
  if (u === 'SELESAI' || u === 'CHECK-OUT') {
    return { label: 'CHECK-OUT', style: BADGE_TONES.green, dot: 'bg-[#15803D]' };
  }

  // UNASSIGNED / BELUM CHECK-IN
  if (u === 'UNASSIGNED' || u === 'BELUM ASSIGN' || u === 'BELUM CHECK-IN' || u === 'BELUM TERDISTRIBUSI') {
    return { label: s.toUpperCase(), style: BADGE_TONES.neutral, dot: 'bg-[#64748B]' };
  }

  return { label: s.toUpperCase(), style: BADGE_TONES.neutral };
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  variant = 'auto',
  size = 'xs',
  className = ''
}) => {
  const { label, style, dot } = resolveBadgeStyle(status || '-', variant);
  const sizeClass = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-2.5 py-0.5 text-[10px]';

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${sizeClass} font-bold uppercase tracking-wide tabular-nums border rounded-full whitespace-nowrap shrink-0 ${style} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
      <span>{label}</span>
    </span>
  );
};

export const StatusAgentBadge: React.FC<{ status: TicketStatusWOAgent | string }> = ({ status }) => {
  const norm = String(status || '').trim();
  const upper = norm.toUpperCase();
  let tone = BADGE_TONES.amber;
  if (upper === 'CLOSED') tone = BADGE_TONES.slateDark;
  else if (upper === 'ASSIGNED' || upper === 'IN PROGRESS' || upper === 'PROGRESS') tone = BADGE_TONES.blue;
  else if (upper === 'RESOLVED' || upper === 'COMPLETE' || upper === 'COMPLETED') tone = BADGE_TONES.green;
  else if (upper === 'CANCELLED' || upper === 'CANCEL') tone = BADGE_TONES.red;
  else if (upper === 'RESCHEDULE') tone = BADGE_TONES.violet;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums border rounded-full whitespace-nowrap ${tone}`}>
      {norm || 'Pending'}
    </span>
  );
};

export const StatusInstallerBadge: React.FC<{ status: TicketStatusWOInstaller | string }> = ({ status }) => {
  const norm = String(status || 'Unassigned').trim();
  const upper = norm.toUpperCase();
  let tone = BADGE_TONES.neutral;
  if (upper === 'COMPLETE' || upper === 'COMPLETED' || upper === 'INSTALLED') tone = BADGE_TONES.green;
  else if (upper === 'PENDING' || upper === 'PENDING TECHNICAL') tone = BADGE_TONES.amber;
  else if (upper.includes('RESCHEDULE')) tone = BADGE_TONES.violet;
  else if (upper.includes('CANCEL') || upper.includes('FAILED')) tone = BADGE_TONES.red;
  else if (upper === 'ASSIGNED' || upper === 'EN ROUTE' || upper === 'ON SITE' || upper === 'IN PROGRESS' || upper === 'PROGRESS') tone = BADGE_TONES.blue;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums border rounded-full whitespace-nowrap ${tone}`}>
      {norm}
    </span>
  );
};

export const StatusWhatsAppBadge: React.FC<{ status: WhatsAppConfirmationStatus }> = ({ status }) => {
  const configs: Record<WhatsAppConfirmationStatus, { label: string; style: string }> = {
    'not_prepared': { label: 'NOT PREPARED', style: BADGE_TONES.neutral },
    'ready': { label: 'READY', style: BADGE_TONES.blue },
    'opened_in_whatsapp': { label: 'OPENED', style: BADGE_TONES.amber },
    'awaiting_confirmation': { label: 'AWAITING CONFIRMATION', style: BADGE_TONES.violet },
    'confirmed': { label: 'CONFIRMED', style: BADGE_TONES.green },
    'reschedule_requested': { label: 'RESCHEDULE', style: BADGE_TONES.violet },
    'unreachable': { label: 'UNREACHABLE', style: BADGE_TONES.red },
    'invalid_number': { label: 'INVALID PHONE', style: BADGE_TONES.red },
    'cancelled': { label: 'CANCELLED', style: BADGE_TONES.neutral }
  };

  const item = configs[status] || configs.not_prepared;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums border rounded-full whitespace-nowrap ${item.style}`}>
      {item.label}
    </span>
  );
};

export const StatusApprovalBadge: React.FC<{ status?: WOApprovalStatus | string }> = ({ status }) => {
  if (!status || status === 'NONE') return null;
  const upper = String(status).trim().toUpperCase();

  if (upper === 'APPROVED') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] border rounded-full uppercase tracking-wide tabular-nums shrink-0 whitespace-nowrap font-bold ${BADGE_TONES.green}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-[#15803D]" />
        <span>APPROVED</span>
      </span>
    );
  }

  if (upper === 'REJECTED' || upper === 'REVISI' || upper === 'REVISION' || upper === 'REVISION / REJECTED') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] border rounded-full uppercase tracking-wide tabular-nums shrink-0 whitespace-nowrap font-bold ${BADGE_TONES.red}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-[#B91C1C]" />
        <span>REVISION / REJECTED</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] border rounded-full uppercase tracking-wide tabular-nums shrink-0 whitespace-nowrap font-bold ${BADGE_TONES.orange}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#C2410C]" />
      <span>BUTUH APPROVAL</span>
    </span>
  );
};
