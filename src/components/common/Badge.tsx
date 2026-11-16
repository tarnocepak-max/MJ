import React from 'react';
import { WhatsAppConfirmationStatus, TicketStatusWOAgent, TicketStatusWOInstaller, WOApprovalStatus } from '../../types';

export const StatusAgentBadge: React.FC<{ status: TicketStatusWOAgent | string }> = ({ status }) => {
  const styles: Record<string, string> = {
    'Pending': 'text-[#B45309] bg-[#FEF3C7]/80 border-[#E59A27]/60 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700',
    'Assigned': 'text-[#3977C9] bg-[#EFF6FF] border-[#3977C9]/35 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
    'In Progress': 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#D8B4FE] dark:border-[#5B35B1]',
    'PROGRESS': 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#D8B4FE] dark:border-[#5B35B1]',
    'Resolved': 'text-[#16A36A] bg-[#ECFDF5] border-[#16A36A]/35 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    'Cancelled': 'text-[#DC4C5A] bg-[#FEF2F2] border-[#DC4C5A]/35 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
    'Closed': 'text-[#494453] bg-[#F7F6FA] border-[#CBC3D5] dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums border rounded-full whitespace-nowrap ${styles[status] || styles.Pending}`}>
      {status}
    </span>
  );
};

export const StatusInstallerBadge: React.FC<{ status: TicketStatusWOInstaller | string }> = ({ status }) => {
  const styles: Record<string, string> = {
    'Unassigned': 'text-[#766B83] bg-[#F7F6FA] border-[#E9E5F0] dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
    'Assigned': 'text-[#3977C9] bg-[#EFF6FF] border-[#3977C9]/35 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
    'En Route': 'text-[#B45309] bg-[#FEF3C7]/80 border-[#E59A27]/40 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    'On Site': 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#D8B4FE] dark:border-[#5B35B1]',
    'In Progress': 'text-[#3977C9] bg-[#EFF6FF] border-[#3977C9]/40 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-700',
    'PROGRESS': 'text-[#431599] bg-[#F0E3FF] border-[#A78BFA]/60 dark:bg-[#35105E] dark:text-[#E9D5FF] dark:border-[#7135B5]',
    'Installed': 'text-[#0D9488] bg-[#F0FDFA] border-[#99F6E4] dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
    'Pending Technical': 'text-[#C2410C] bg-[#FFF7ED] border-[#FED7AA] dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800',
    'Failed / Cancelled': 'text-[#DC4C5A] bg-[#FEF2F2] border-[#DC4C5A]/35 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
    'Completed': 'text-white bg-[#16A36A] border-[#16A36A] shadow-2xs dark:bg-emerald-600 dark:border-emerald-500'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums border rounded-full whitespace-nowrap ${styles[status] || styles.Unassigned}`}>
      {status}
    </span>
  );
};

export const StatusWhatsAppBadge: React.FC<{ status: WhatsAppConfirmationStatus }> = ({ status }) => {
  const configs: Record<WhatsAppConfirmationStatus, { label: string; style: string }> = {
    'not_prepared': { label: 'NOT PREPARED', style: 'text-[#8B8495] bg-[#F7F6FA] border-[#E9E5F0] dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700' },
    'ready': { label: 'READY', style: 'text-[#3977C9] bg-[#EFF6FF] border-[#3977C9]/30 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800' },
    'opened_in_whatsapp': { label: 'OPENED', style: 'text-[#B45309] bg-[#FEF3C7]/80 border-[#E59A27]/40 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
    'awaiting_confirmation': { label: 'AWAITING CONFIRMATION', style: 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800' },
    'confirmed': { label: 'CONFIRMED', style: 'text-[#16A36A] bg-[#ECFDF5] border-[#16A36A]/35 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
    'reschedule_requested': { label: 'RESCHEDULE', style: 'text-[#7135B5] bg-[#F5F1FF] border-[#D8CCF3] dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800' },
    'unreachable': { label: 'UNREACHABLE', style: 'text-[#DC4C5A] bg-[#FEF2F2] border-[#FECACA] dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800' },
    'invalid_number': { label: 'INVALID PHONE', style: 'text-[#DC4C5A] bg-[#FEF2F2] border-[#FECACA] dark:bg-red-950/40 dark:text-red-300 dark:border-red-800' },
    'cancelled': { label: 'CANCELLED', style: 'text-[#766B83] bg-[#F7F6FA] border-[#E9E5F0] dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700' }
  };

  const item = configs[status] || configs.not_prepared;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums border rounded-full whitespace-nowrap ${item.style}`}>
      {item.label}
    </span>
  );
};

export const StatusApprovalBadge: React.FC<{ status?: WOApprovalStatus }> = ({ status }) => {
  if (!status || status === 'NONE') return null;

  const configs: Record<WOApprovalStatus, { label: string; style: string; dot: string; pulse?: boolean }> = {
    'NONE': { label: '', style: '', dot: '' },
    'BUTUH APPROVAL': {
      label: 'BUTUH APPROVAL',
      style: 'bg-[#FEF3C7] text-[#92400E] border-[#E59A27]/60 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-700 font-bold',
      dot: 'bg-[#E59A27]',
      pulse: true
    },
    'APPROVED': {
      label: 'APPROVED',
      style: 'bg-[#ECFDF5] text-[#15803D] border-[#16A36A]/40 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-700 font-bold',
      dot: 'bg-[#16A36A]'
    },
    'REJECTED': {
      label: 'REJECTED · REVISI',
      style: 'bg-[#FEF2F2] text-[#B91C1C] border-[#DC4C5A]/45 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-700 font-bold',
      dot: 'bg-[#DC4C5A]'
    },
    'REVISI': {
      label: 'PERLU REVISI',
      style: 'bg-[#FFF7ED] text-[#C2410C] border-[#F97316]/45 dark:bg-orange-950/70 dark:text-orange-200 dark:border-orange-700 font-bold',
      dot: 'bg-[#EA580C]'
    }
  };

  const item = configs[status] || configs['BUTUH APPROVAL'];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] border rounded-full uppercase tracking-wide tabular-nums shrink-0 whitespace-nowrap ${item.style}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${item.dot} ${item.pulse ? 'animate-pulse' : ''}`} />
      <span>{item.label}</span>
    </span>
  );
};

