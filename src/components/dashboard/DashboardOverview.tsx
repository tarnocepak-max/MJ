import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket } from '../../types';
import { Ticket as TicketIcon, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';

interface DashboardOverviewProps {
  onNavigate: (tab: string) => void;
}

/**
 * Operational dashboard: intentionally limited to the primary WO indicators.
 * Contractor performance and daily appointment breakdowns remain available
 * in their dedicated operational/report menus, not on this landing page.
 */
export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onNavigate }) => {
  const { tickets, currentUser, scopedTickets } = useApp();
  const roleRestricted = currentUser?.role === 'leader' || currentUser?.role === 'installer';
  const source = roleRestricted ? scopedTickets : tickets;

  const active = useMemo(
    () => (source || []).filter((t: Ticket) => !t.isArchived && !t.isDeleted),
    [source]
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
    { label: 'Total WO Aktif', value: counts.total, icon: TicketIcon, tone: 'bg-violet-50 text-violet-600' },
    { label: 'Perlu Perhatian', value: counts.attention, icon: AlertTriangle, tone: 'bg-amber-50 text-amber-600' },
    { label: 'Dalam Pengerjaan', value: counts.progress, icon: Clock, tone: 'bg-blue-50 text-blue-600' },
    { label: 'Selesai', value: counts.completed, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600' }
  ];

  return (
    <main className="space-y-5 bg-slate-50/70 min-h-full p-1 sm:p-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Ringkasan operasional Work Order</p>
        </div>
        <button onClick={() => onNavigate('tickets')} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700">
          Lihat Tiket WO
        </button>
      </header>
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-medium text-slate-500">{label}</span>
              <span className={`rounded-lg p-2 ${tone}`}><Icon className="h-4 w-4" /></span>
            </div>
            <div className="mt-3 text-2xl font-bold tabular-nums text-slate-900">{value.toLocaleString('id-ID')}</div>
          </article>
        ))}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Akses Cepat</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => onNavigate('tickets')} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700">Daftar Work Order</button>
          {['super_admin', 'dispatch'].includes(currentUser?.role || '') && (
            <button onClick={() => onNavigate('import')} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">Import WO</button>
          )}
          <button onClick={() => onNavigate('contact_centre')} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">LiveChat</button>
        </div>
      </section>
    </main>
  );
};
