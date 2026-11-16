import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { Ticket } from '../../types';
import { Ticket as TicketIcon, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { SlaTelemetryDashboardView } from '../sla/SlaTelemetryDashboardView';

interface DashboardOverviewProps {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
}

const FallbackOperationalOverview: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const { tickets, currentUser, scopedTickets, todayWIB } = useApp();
  const { isMobileView } = useUIConfig();
  const roleRestricted = currentUser?.role === 'leader' || currentUser?.role === 'installer';
  const source = roleRestricted ? scopedTickets : tickets;

  const active = useMemo(
    () =>
      (source || []).filter(
        (t: Ticket) => !t.isArchived && !t.isDeleted && getTicketAppointmentDate(t) === todayWIB
      ),
    [source, todayWIB]
  );
  const counts = useMemo(
    () => ({
      total: active.length,
      attention: active.filter(
        t =>
          ['Pending', 'Unassigned', 'Failed / Cancelled', 'Pending Technical'].includes(
            String(t.statusWOInstaller)
          ) || ['Pending', 'Cancelled'].includes(String(t.statusWOAgent))
      ).length,
      progress: active.filter(
        t =>
          ['In Progress', 'PROGRESS', 'En Route', 'On Site'].includes(String(t.statusWOInstaller)) ||
          ['In Progress', 'PROGRESS'].includes(String(t.statusWOAgent))
      ).length,
      completed: active.filter(
        t =>
          ['Completed', 'Installed', 'Resolved', 'Closed'].includes(String(t.statusWOInstaller)) ||
          ['Resolved', 'Closed'].includes(String(t.statusWOAgent))
      ).length
    }),
    [active]
  );

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

      <section className={`grid gap-3 sm:gap-4 ${isMobileView ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 xl:grid-cols-4'}`}>
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
    </div>
  );
};

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onNavigate, onSelectTicket }) => {
  const { currentUser } = useApp();

  const canViewSlaEngine =
    currentUser?.role === 'super_admin' ||
    currentUser?.role === 'dispatch' ||
    currentUser?.role === 'leader' ||
    currentUser?.role === 'management_data';

  if (canViewSlaEngine) {
    return (
      <SlaTelemetryDashboardView
        viewContext="dashboard_monitoring"
        onNavigate={onNavigate}
        onSelectTicket={onSelectTicket}
      />
    );
  }

  return <FallbackOperationalOverview onNavigate={onNavigate} />;
};
