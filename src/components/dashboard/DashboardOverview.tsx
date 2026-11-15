import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket } from '../../types';
import { Ticket as TicketIcon, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';

interface DashboardOverviewProps {
  onNavigate: (tab: string) => void;
}

/**
 * Operational dashboard: intentionally limited to the primary WO indicators.
 * Contractor performance and daily appointment breakdowns remain available
 * in their dedicated operational/report menus, not on this landing page.
 */
export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onNavigate }) => {
  const { tickets, currentUser, scopedTickets, todayWIB } = useApp();
  const roleRestricted = currentUser?.role === 'leader' || currentUser?.role === 'installer';
  const source = roleRestricted ? scopedTickets : tickets;

  const active = useMemo(
    () =>
      (source || []).filter(
        (t: Ticket) => !t.isArchived && !t.isDeleted && getTicketAppointmentDate(t) === todayWIB
      ),
    [source, todayWIB]
  );
  const counts = useMemo(() => ({
    total: active.length,
    attention: active.filter(t =>
      ['Pending', 'Unassigned', 'Failed / Cancelled', 'Pending Technical'].includes(String(t.statusWOInstaller)) ||
      ['Pending', 'Cancelled'].includes(String(t.statusWOAgent))
    ).length,
    progress: active.filter(t =>
      ['In Progress', 'PROGRESS', 'En Route', 'On Site'].includes(String(t.statusWOInstaller)) ||
      ['In Progress', 'PROGRESS'].includes(String(t.statusWOAgent))
    ).length,
    completed: active.filter(t =>
      ['Completed', 'Installed', 'Resolved', 'Closed'].includes(String(t.statusWOInstaller)) ||
      ['Resolved', 'Closed'].includes(String(t.statusWOAgent))
    ).length
  }), [active]);

  const cards = [
    {
      label: 'Total WO Aktif',
      sub: `todayWIB: ${todayWIB}`,
      value: counts.total,
      icon: TicketIcon,
      tone: 'bg-[#F4EAFF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]'
    },
    {
      label: 'Perlu Perhatian',
      sub: 'Pending / Kendala',
      value: counts.attention,
      icon: AlertTriangle,
      tone: 'bg-[#FEF3C7] text-[#E59A27] dark:bg-amber-950/60 dark:text-amber-300'
    },
    {
      label: 'Dalam Pengerjaan',
      sub: 'On-site & En-route',
      value: counts.progress,
      icon: Clock,
      tone: 'bg-[#EFF6FF] text-[#3977C9] dark:bg-blue-950/60 dark:text-blue-300'
    },
    {
      label: 'Selesai',
      sub: 'Installed / Closed',
      value: counts.completed,
      icon: CheckCircle2,
      tone: 'bg-[#ECFDF5] text-[#16A36A] dark:bg-emerald-950/60 dark:text-emerald-300'
    }
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] p-4 sm:p-5 shadow-2xs">
        <div>
          <h1 className="font-display text-xl font-bold text-[#211A2E] dark:text-white tracking-tight">
            Dashboard Monitoring
          </h1>
          <p className="text-xs sm:text-sm text-[#766B83] dark:text-[#CEC0E8] mt-0.5">
            Ringkasan operasional Work Order hari ini ({todayWIB} WIB)
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('tickets')}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#431599] hover:bg-[#5B35B1] px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <TicketIcon className="w-4 h-4 shrink-0" />
          <span>Lihat Tiket WO</span>
        </button>
      </header>

      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {cards.map(({ label, sub, value, icon: Icon, tone }) => (
          <article
            key={label}
            className="rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#1E1238] p-4 shadow-2xs hover:border-[#D8CCF3] dark:hover:border-[#5B35B1] transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA]">
                {label}
              </span>
              <span className={`rounded-lg p-2 shrink-0 ${tone}`}>
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 font-display text-2xl font-bold tabular-nums text-[#211A2E] dark:text-white">
              {value.toLocaleString('id-ID')}
            </div>
            <div className="mt-1 text-[11px] font-medium text-[#8B8495] dark:text-[#CEC0E8]/70 font-mono">
              {sub}
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#1E1238] p-4 sm:p-5 shadow-2xs">
        <h2 className="font-display text-sm font-bold text-[#211A2E] dark:text-white">
          Akses Cepat Operasional
        </h2>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('tickets')}
            className="rounded-lg border border-[#D8CCF3] dark:border-[#5B35B1] bg-[#F5F1FF] dark:bg-[#35105E]/60 hover:bg-[#F0E3FF] dark:hover:bg-[#35105E] px-3.5 py-2 text-xs font-semibold text-[#431599] dark:text-[#E9D5FF] transition-colors cursor-pointer whitespace-nowrap"
          >
            Daftar Work Order
          </button>
          {['super_admin', 'management_data'].includes(currentUser?.role || '') && (
            <button
              type="button"
              onClick={() => onNavigate('import')}
              className="rounded-lg border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#160D29] hover:bg-[#F7F6FA] dark:hover:bg-[#35105E]/50 px-3.5 py-2 text-xs font-semibold text-[#211A2E] dark:text-[#CEC0E8] transition-colors cursor-pointer whitespace-nowrap"
            >
              Import Data WO
            </button>
          )}
          {currentUser?.role === 'dispatch' && (
            <button
              type="button"
              onClick={() => onNavigate('form_sameday')}
              className="rounded-lg border border-[#D8CCF3] bg-[#7135B5] hover:bg-[#431599] px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              + Form Sameday
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('contact_centre')}
            className="rounded-lg border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#160D29] hover:bg-[#F7F6FA] dark:hover:bg-[#35105E]/50 px-3.5 py-2 text-xs font-semibold text-[#211A2E] dark:text-[#CEC0E8] transition-colors cursor-pointer whitespace-nowrap"
          >
            Contact Centre
          </button>
        </div>
      </section>
    </div>
  );
};
