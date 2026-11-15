import React from 'react';
import { WhatsAppConfirmationStatus, TicketStatusWOAgent, TicketStatusWOInstaller, WOApprovalStatus } from '../../types';

export const StatusAgentBadge: React.FC<{ status: TicketStatusWOAgent | string }> = ({ status }) => {
  const styles: Record<string, string> = {
    'Pending': 'text-[#B45309] bg-[#FEF3C7]/70 border-[#F59E0B]/40 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    'Assigned': 'text-[#3977C9] bg-[#EFF6FF] border-[#BFDBFE] dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
    'In Progress': 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#D8B4FE] dark:border-[#5B35B1]',
    'PROGRESS': 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#D8B4FE] dark:border-[#5B35B1]',
    'Resolved': 'text-[#16A36A] bg-[#ECFDF5] border-[#A7F3D0] dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    'Cancelled': 'text-[#DC4C5A] bg-[#FEF2F2] border-[#FECACA] dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
    'Closed': 'text-[#494453] bg-[#F7F6FA] border-[#E9E5F0] dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold border rounded-md whitespace-nowrap ${styles[status] || styles.Pending}`}>
      {status}
    </span>
  );
};

export const StatusInstallerBadge: React.FC<{ status: TicketStatusWOInstaller | string }> = ({ status }) => {
  const styles: Record<string, string> = {
    'Unassigned': 'text-[#766B83] bg-[#F7F6FA] border-[#E9E5F0] dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
    'Assigned': 'text-[#3977C9] bg-[#EFF6FF] border-[#BFDBFE] dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
    'En Route': 'text-[#B45309] bg-[#FEF3C7]/70 border-[#F59E0B]/40 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    'On Site': 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#D8B4FE] dark:border-[#5B35B1]',
    'In Progress': 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#D8B4FE] dark:border-[#5B35B1]',
    'PROGRESS': 'text-[#431599] bg-[#F0E3FF] border-[#A78BFA]/60 dark:bg-[#35105E] dark:text-[#E9D5FF] dark:border-[#7135B5] font-bold',
    'Installed': 'text-[#0D9488] bg-[#F0FDFA] border-[#99F6E4] dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
    'Pending Technical': 'text-[#C2410C] bg-[#FFF7ED] border-[#FED7AA] dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800',
    'Failed / Cancelled': 'text-[#DC4C5A] bg-[#FEF2F2] border-[#FECACA] dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
    'Completed': 'text-[#16A36A] bg-[#ECFDF5] border-[#A7F3D0] dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold border rounded-md whitespace-nowrap ${styles[status] || styles.Unassigned}`}>
      {status}
    </span>
  );
};

export const StatusWhatsAppBadge: React.FC<{ status: WhatsAppConfirmationStatus }> = ({ status }) => {
  const configs: Record<WhatsAppConfirmationStatus, { label: string; style: string }> = {
    'not_prepared': { label: 'Not Prepared', style: 'text-[#8B8495] bg-[#F7F6FA] border-[#E9E5F0] dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700' },
    'ready': { label: 'Ready to Contact', style: 'text-[#3977C9] bg-[#EFF6FF] border-[#BFDBFE] dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800' },
    'opened_in_whatsapp': { label: 'Opened in WA', style: 'text-[#B45309] bg-[#FEF3C7]/70 border-[#F59E0B]/40 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
    'awaiting_confirmation': { label: 'Awaiting Confirmation', style: 'text-[#431599] bg-[#F4EAFF] border-[#D8CCF3] dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800' },
    'confirmed': { label: 'Customer Confirmed', style: 'text-[#16A36A] bg-[#ECFDF5] border-[#A7F3D0] dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
    'reschedule_requested': { label: 'Reschedule Needed', style: 'text-[#7135B5] bg-[#F5F1FF] border-[#D8CCF3] dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800' },
    'unreachable': { label: 'Unreachable', style: 'text-[#DC4C5A] bg-[#FEF2F2] border-[#FECACA] dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800' },
    'invalid_number': { label: 'Invalid Phone', style: 'text-[#DC4C5A] bg-[#FEF2F2] border-[#FECACA] dark:bg-red-950/40 dark:text-red-300 dark:border-red-800' },
    'cancelled': { label: 'Cancelled', style: 'text-[#766B83] bg-[#F7F6FA] border-[#E9E5F0] dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700' }
  };

  const item = configs[status] || configs.not_prepared;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold border rounded-md whitespace-nowrap ${item.style}`}>
      {item.label}
    </span>
  );
};

export const StatusApprovalBadge: React.FC<{ status?: WOApprovalStatus }> = ({ status }) => {
  if (!status || status === 'NONE') return null;

  const configs: Record<WOApprovalStatus, { label: string; style: string; dot: string }> = {
    'NONE': { label: '', style: '', dot: '' },
    'BUTUH APPROVAL': {
      label: 'BUTUH APPROVAL',
      style: 'bg-[#FEF3C7] text-[#92400E] border-[#F59E0B]/50 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-700 font-bold',
      dot: 'bg-[#E59A27]'
    },
    'APPROVED': {
      label: 'APPROVED',
      style: 'bg-[#ECFDF5] text-[#15803D] border-[#16A36A]/35 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-700 font-bold',
      dot: 'bg-[#16A36A]'
    },
    'REJECTED': {
      label: 'PERLU REVISI',
      style: 'bg-[#FEF2F2] text-[#B91C1C] border-[#DC4C5A]/40 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-700 font-bold',
      dot: 'bg-[#DC4C5A]'
    },
    'REVISI': {
      label: 'PERLU REVISI',
      style: 'bg-[#FFF7ED] text-[#C2410C] border-[#F97316]/40 dark:bg-orange-950/70 dark:text-orange-200 dark:border-orange-700 font-bold',
      dot: 'bg-[#EA580C]'
    }
  };

  const item = configs[status] || configs['BUTUH APPROVAL'];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10.5px] border rounded-md uppercase tracking-wide shrink-0 whitespace-nowrap ${item.style}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
      <span>{item.label}</span>
    </span>
  );
};

