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
  displayRole?: 'installer' | 'leader' | 'dispatch' | 'super_admin';
}

export function formatInstallerStatusDisplay(rawStatus?: string | null, displayRole?: string): string {
  const clean = String(rawStatus || '').trim();
  const upper = clean.toUpperCase();
  if (displayRole === 'installer' && (upper === 'ASSIGNED' || upper === 'SUDAH ASSIGN')) {
    return 'REQUESTED';
  }
  return clean || 'Unassigned';
}

const BADGE_TONES = {
  neutral:
    'bg-[#F8FAFD] text-[#52647A] border-[#DDE6F0] dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700',
  blue:
    'bg-[#E7F1FB] text-[#3E81C6] border-[#B6D4F4] dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800',
  amber:
    'bg-[#FFF2D9] text-[#C88735] border-[#F4D392] dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700',
  green:
    'bg-[#E4F5EC] text-[#218A63] border-[#AEE0C6] dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700',
  violet:
    'bg-[#F0EDFF] text-[#5145A6] border-[#D4CEFA] dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700',
  orange:
    'bg-[#FFF2D9] text-[#C88735] border-[#F4D392] dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-700',
  red:
    'bg-[#FCE9EB] text-[#D45B66] border-[#F2BCC2] dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700',
  deepRed:
    'bg-[#FCE9EB] text-[#9B2C37] border-[#E79AA2] dark:bg-rose-950/80 dark:text-rose-100 dark:border-rose-600',
  slateDark:
    'bg-[#26364A] text-white border-[#1C2A3B] dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700'
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

  // COMPLETE / DONE / APPROVED
  if (u === 'APPROVED - DONE') {
    return { label: 'APPROVED - DONE', style: BADGE_TONES.green, dot: 'bg-[#218A63] dark:bg-[#15803D]' };
  }
  if (u === 'APPROVED - PENDING') {
    return { label: 'APPROVED - PENDING', style: BADGE_TONES.amber, dot: 'bg-[#C88735] dark:bg-[#B45309]' };
  }
  if (u === 'APPROVED - RESCHEDULE') {
    return { label: 'APPROVED - RESCHEDULE', style: BADGE_TONES.blue, dot: 'bg-[#3E81C6] dark:bg-blue-400' };
  }
  if (u === 'APPROVED - CANCEL') {
    return { label: 'APPROVED - CANCEL', style: BADGE_TONES.deepRed, dot: 'bg-[#9B2C37] dark:bg-rose-400' };
  }
  if (u === 'APPROVED') {
    return { label: 'APPROVED', style: BADGE_TONES.green, dot: 'bg-[#218A63] dark:bg-[#15803D]' };
  }
  if (u === 'DONE') {
    return { label: 'DONE', style: BADGE_TONES.green, dot: 'bg-[#218A63] dark:bg-[#15803D]' };
  }
  if (u === 'COMPLETE' || u === 'COMPLETED' || u === 'INSTALLED' || u === 'RESOLVED') {
    return { label: u === 'RESOLVED' ? 'RESOLVED' : 'COMPLETE', style: BADGE_TONES.green, dot: 'bg-[#218A63] dark:bg-[#15803D]' };
  }

  // WAITING APPROVAL / BUTUH APPROVAL
  if (u === 'BUTUH APPROVAL' || u === 'WAITING APPROVAL' || u === 'PENDING APPROVAL') {
    return {
      label: variant === 'approval' ? 'WAITING APPROVAL' : s.toUpperCase(),
      style: BADGE_TONES.orange,
      dot: 'bg-[#C88735] dark:bg-[#C2410C]'
    };
  }

  // CANCEL / REVISION / REJECTED
  if (u === 'CANCEL' || u === 'CANCELLED' || u === 'FAILED / CANCELLED') {
    return { label: 'CANCEL', style: BADGE_TONES.deepRed, dot: 'bg-[#9B2C37] dark:bg-rose-400' };
  }
  if (u === 'REJECTED' || u === 'REVISI' || u === 'REVISION' || u === 'REVISION / REJECTED' || u === 'PERLU REVISI') {
    return { label: 'REVISION / REJECTED', style: BADGE_TONES.red, dot: 'bg-[#D45B66] dark:bg-[#B91C1C]' };
  }

  // RESCHEDULE
  if (u.includes('RESCHEDULE')) {
    return { label: 'RESCHEDULE', style: BADGE_TONES.blue, dot: 'bg-[#3E81C6] dark:bg-blue-400' };
  }

  // PENDING
  if (u === 'PENDING' || u === 'PENDING TECHNICAL') {
    return { label: 'PENDING', style: BADGE_TONES.amber, dot: 'bg-[#C88735] dark:bg-[#B45309]' };
  }

  // ASSIGNED / REQUESTED / CHECK-IN / PROGRESS
  if (u === 'ASSIGNED' || u === 'SUDAH ASSIGN' || u === 'REQUESTED') {
    return { label: u === 'REQUESTED' ? 'REQUESTED' : 'ASSIGNED', style: BADGE_TONES.blue, dot: 'bg-[#3E81C6] dark:bg-[#1D4ED8]' };
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
    return { label, style: BADGE_TONES.blue, dot: 'bg-[#3E81C6] dark:bg-[#1D4ED8]' };
  }
  if (u === 'SELESAI' || u === 'CHECK-OUT') {
    return { label: 'CHECK-OUT', style: BADGE_TONES.green, dot: 'bg-[#218A63] dark:bg-[#15803D]' };
  }

  // UNASSIGNED / BELUM CHECK-IN
  if (u === 'UNASSIGNED' || u === 'BELUM ASSIGN' || u === 'BELUM CHECK-IN' || u === 'BELUM TERDISTRIBUSI') {
    return { label: s.toUpperCase(), style: BADGE_TONES.neutral, dot: 'bg-[#8492A5] dark:bg-[#64748B]' };
  }

  return { label: s.toUpperCase(), style: BADGE_TONES.neutral };
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  variant = 'auto',
  size = 'xs',
  className = '',
  displayRole
}) => {
  const effectiveStatus = formatInstallerStatusDisplay(status, displayRole);
  const { label, style, dot } = resolveBadgeStyle(effectiveStatus || '-', variant);
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
  else if (upper === 'DONE' || upper === 'RESOLVED' || upper === 'COMPLETE' || upper === 'COMPLETED') tone = BADGE_TONES.green;
  else if (upper === 'CANCELLED' || upper === 'CANCEL') tone = BADGE_TONES.deepRed;
  else if (upper === 'RESCHEDULE') tone = BADGE_TONES.blue;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums border rounded-full whitespace-nowrap ${tone}`}>
      {norm || 'Pending'}
    </span>
  );
};

export const StatusInstallerBadge: React.FC<{
  status: TicketStatusWOInstaller | string;
  displayRole?: 'installer' | 'leader' | 'dispatch' | 'super_admin';
}> = ({ status, displayRole }) => {
  const norm = formatInstallerStatusDisplay(status, displayRole);
  const upper = norm.toUpperCase();
  let tone = BADGE_TONES.neutral;
  if (upper === 'COMPLETE' || upper === 'COMPLETED' || upper === 'INSTALLED') tone = BADGE_TONES.green;
  else if (upper === 'PENDING' || upper === 'PENDING TECHNICAL') tone = BADGE_TONES.amber;
  else if (upper.includes('RESCHEDULE')) tone = BADGE_TONES.blue;
  else if (upper.includes('CANCEL') || upper.includes('FAILED')) tone = BADGE_TONES.deepRed;
  else if (upper === 'ASSIGNED' || upper === 'REQUESTED' || upper === 'EN ROUTE' || upper === 'ON SITE' || upper === 'IN PROGRESS' || upper === 'PROGRESS') tone = BADGE_TONES.blue;

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
    'reschedule_requested': { label: 'RESCHEDULE', style: BADGE_TONES.blue },
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
        <span className="w-1.5 h-1.5 rounded-full bg-[#218A63] dark:bg-[#15803D]" />
        <span>APPROVED</span>
      </span>
    );
  }

  if (upper === 'REJECTED' || upper === 'REVISI' || upper === 'REVISION' || upper === 'REVISION / REJECTED') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] border rounded-full uppercase tracking-wide tabular-nums shrink-0 whitespace-nowrap font-bold ${BADGE_TONES.red}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-[#D45B66] dark:bg-[#B91C1C]" />
        <span>REVISION / REJECTED</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] border rounded-full uppercase tracking-wide tabular-nums shrink-0 whitespace-nowrap font-bold ${BADGE_TONES.orange}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#C88735] dark:bg-[#C2410C]" />
      <span>BUTUH APPROVAL</span>
    </span>
  );
};
