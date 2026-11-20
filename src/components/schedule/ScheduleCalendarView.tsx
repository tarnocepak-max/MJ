import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket } from '../../types';
import {
  Calendar as CalendarIcon,
  Clock,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  UserCheck,
  Building2,
  MapPin,
  CheckCircle2,
  CalendarDays,
  List,
  Eye,
  Phone,
  RotateCcw
} from 'lucide-react';
import {
  formatAppointmentDateDisplay,
  parseAppointmentDate,
  getJakartaDateString,
  getJakartaDateParts,
  getTicketAppointmentDate
} from '../../services/appointmentDateParser';
import { StatusInstallerBadge, StatusAgentBadge } from '../common/Badge';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';

interface ScheduleCalendarViewProps {
  onSelectTicket: (ticket: Ticket) => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

export const ScheduleCalendarView: React.FC<ScheduleCalendarViewProps> = ({
  onSelectTicket,
  onOpenWhatsApp
}) => {
  const { isCompactUI } = useResponsiveViewport();
  const { tickets, contractors, users, currentUser } = useApp();

  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'list'>('day');
  const [selectedDate, setSelectedDate] = useState<string>(() => getJakartaDateString(0));
  const [slotFilter, setSlotFilter] = useState('ALL');
  const [areaFilter, setAreaFilter] = useState('ALL');
  const [contractorFilter, setContractorFilter] = useState('ALL');
  const [installerFilter, setInstallerFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const STANDARD_SLOTS = [
    '09:00 - 11:00 WIB',
    '11:00 - 13:00 WIB',
    '13:00 - 15:00 WIB',
    '15:00 - 17:00 WIB'
  ];

  // Scoped tickets based on user role
  const scopedTickets = useMemo(() => {
    return (tickets || []).filter(t => {
      if (!t || t.isArchived || t.isDeleted) return false;
      if (currentUser?.role === 'super_admin' || currentUser?.role === 'dispatch') return true;
      if (currentUser?.role === 'leader') {
        const cName = (t.contactorName || t.contractorName || '').toLowerCase();
        return !currentUser.contractor || cName === (currentUser.contractor || '').toLowerCase();
      }
      if (currentUser?.role === 'installer') {
        return (t.installerName || '').toLowerCase() === (currentUser?.name || '').toLowerCase();
      }
      return true;
    });
  }, [tickets, currentUser]);

  // Unique areas
  const areas = useMemo(() => {
    const set = new Set<string>();
    scopedTickets.forEach(t => { if (t?.area) set.add(t.area); });
    return Array.from(set);
  }, [scopedTickets]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return (scopedTickets || []).filter(t => {
      if (slotFilter !== 'ALL' && !String(t.slotTime || '').includes(slotFilter.slice(0, 5))) return false;
      if (areaFilter !== 'ALL' && t.area !== areaFilter) return false;
      if (contractorFilter !== 'ALL') {
        const c = t.contactorName || t.contractorName || '';
        if (c !== contractorFilter) return false;
      }
      if (installerFilter !== 'ALL') {
        if ((t.installerName || '') !== installerFilter) return false;
      }
      if (statusFilter !== 'ALL') {
        if (t.statusWOInstaller !== statusFilter && t.statusWOAgent !== statusFilter) return false;
      }
      if (searchQuery && typeof searchQuery === 'string' && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const m1 = (t.woNumber ? String(t.woNumber).toLowerCase() : '').includes(q);
        const m2 = (t.customerName ? String(t.customerName).toLowerCase() : '').includes(q);
        const m3 = (t.idCustomer || t.customerId || '').toLowerCase().includes(q);
        const m4 = (t.installerName || '').toLowerCase().includes(q);
        if (!m1 && !m2 && !m3 && !m4) return false;
      }
      return true;
    });
  }, [scopedTickets, slotFilter, areaFilter, contractorFilter, installerFilter, statusFilter, searchQuery]);

  // Day view tickets (matching selectedDate)
  const dayTickets = useMemo(() => {
    return filteredTickets.filter(t => {
      const raw = t.appointmentDate || '';
      const parsed = parseAppointmentDate(raw);
      const d = parsed.date || (raw.length >= 10 ? raw.slice(0, 10) : raw.trim());
      return d === selectedDate;
    });
  }, [filteredTickets, selectedDate]);

  // Unscheduled tickets
  const unscheduledTickets = useMemo(() => {
    return filteredTickets.filter(t => {
      const parsed = parseAppointmentDate(t.appointmentDate);
      return parsed.isEmpty || !parsed.date;
    });
  }, [filteredTickets]);

  // Overdue tickets check
  const isOverdue = (t: Ticket): boolean => {
    const raw = t.appointmentDate || '';
    const parsed = parseAppointmentDate(raw);
    const d = parsed.date;
    if (!d) return false;
    const isCompleted = t.statusWOInstaller === 'Completed' || t.statusWOAgent === 'Closed' || t.statusWOAgent === 'Resolved';
    if (isCompleted) return false;
    return d < getJakartaDateString(0);
  };

  const handlePrevDay = () => {
    try {
      const cur = new Date(selectedDate);
      cur.setDate(cur.getDate() - 1);
      setSelectedDate(cur.toISOString().split('T')[0]);
    } catch {}
  };

  const handleNextDay = () => {
    try {
      const cur = new Date(selectedDate);
      cur.setDate(cur.getDate() + 1);
      setSelectedDate(cur.toISOString().split('T')[0]);
    } catch {}
  };

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div className={`bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col ${isCompactUI ? '' : 'sm:flex-row sm:items-center'} justify-between gap-3.5`}>
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#0F172A] dark:bg-[#1E293B] border border-slate-800 dark:border-slate-700 text-[#38BDF8] flex items-center justify-center font-bold shadow-xs shrink-0">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                Jadwal Appointment &amp; Manajemen Kalender Work Order
              </h2>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#2563EB]/10 text-[#2563EB] dark:bg-[#38BDF8]/15 dark:text-[#38BDF8] border border-[#2563EB]/20 dark:border-[#38BDF8]/30 whitespace-nowrap">
                WIB (Asia/Jakarta)
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Jadwal dihitung presisi berdasarkan Appointment Date resmi dari data impor. Tidak tertukar dengan tanggal upload atau tanggal lapor.
            </p>
          </div>
        </div>
        {/* View Switcher: Day, Week, Month, List */}
        <div className="grid grid-cols-4 sm:flex items-center p-1 bg-slate-100 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setViewMode('day')}
            className={`px-2.5 sm:px-3 py-1.5 min-h-[44px] sm:min-h-[34px] rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              viewMode === 'day'
                ? 'bg-[#2563EB] text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Harian
          </button>
          <button
            type="button"
            onClick={() => setViewMode('week')}
            className={`px-2.5 sm:px-3 py-1.5 min-h-[44px] sm:min-h-[34px] rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              viewMode === 'week'
                ? 'bg-[#2563EB] text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Mingguan
          </button>
          <button
            type="button"
            onClick={() => setViewMode('month')}
            className={`px-2.5 sm:px-3 py-1.5 min-h-[44px] sm:min-h-[34px] rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              viewMode === 'month'
                ? 'bg-[#2563EB] text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Bulanan
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-2.5 sm:px-3 py-1.5 min-h-[44px] sm:min-h-[34px] rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              viewMode === 'list'
                ? 'bg-[#2563EB] text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Agenda
          </button>
        </div>
      </div>

      {/* Date Navigation & Filters Toolbar */}
      <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-xs space-y-3 text-xs">
        {/* Navigation Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrevDay}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1E293B] dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                title="Hari Sebelumnya"
                aria-label="Hari Sebelumnya"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex-1 sm:flex-none text-center px-3.5 py-2 min-h-[44px] sm:min-h-[36px] flex items-center justify-center bg-[#0F172A] dark:bg-[#1E293B] border border-slate-800 dark:border-slate-700 rounded-xl font-bold font-mono tabular-nums text-xs sm:text-sm text-white whitespace-nowrap">
                {formatAppointmentDateDisplay(selectedDate)}
              </div>
              <button
                type="button"
                onClick={handleNextDay}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1E293B] dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                title="Hari Berikutnya"
                aria-label="Hari Berikutnya"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 sm:pb-0">
              <button
                type="button"
                onClick={() => setSelectedDate(getJakartaDateString(0))}
                className={`px-3 py-2 min-h-[44px] sm:min-h-[34px] text-xs font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  selectedDate === getJakartaDateString(0)
                    ? 'bg-[#2563EB] text-white shadow-xs font-bold'
                    : 'bg-slate-100 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                Hari Ini ({getJakartaDateParts(0).labelShort})
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(getJakartaDateString(1))}
                className={`px-3 py-2 min-h-[44px] sm:min-h-[34px] text-xs font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  selectedDate === getJakartaDateString(1)
                    ? 'bg-[#2563EB] text-white shadow-xs font-bold'
                    : 'bg-slate-100 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                Besok ({getJakartaDateParts(1).labelShort})
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(getJakartaDateString(2))}
                className={`px-3 py-2 min-h-[44px] sm:min-h-[34px] text-xs font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  selectedDate === getJakartaDateString(2)
                    ? 'bg-[#2563EB] text-white shadow-xs font-bold'
                    : 'bg-slate-100 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                Lusa ({getJakartaDateParts(2).labelShort})
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-2">
            <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums text-xs">
              Total Tiket Jadwal Ini: <strong className="text-[#2563EB] dark:text-[#38BDF8] font-bold">{dayTickets.length}</strong> WO
            </span>
          </div>
        </div>

        {/* Filters Row */}
        <div className={`grid ${isCompactUI ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6'} gap-2.5`}>
          <div className={`relative ${isCompactUI ? 'col-span-1 sm:col-span-2' : 'col-span-1 sm:col-span-2'}`}>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari WO, ID, Nama, Teknisi..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[36px] pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
          <select
            value={slotFilter}
            onChange={e => setSlotFilter(e.target.value)}
            className="min-h-[44px] sm:min-h-[36px] px-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="ALL">Semua Slot Waktu</option>
            {STANDARD_SLOTS.map(slot => (
              <option key={slot} value={slot}>{slot}</option>
            ))}
          </select>
          <select
            value={areaFilter}
            onChange={e => setAreaFilter(e.target.value)}
            className="min-h-[44px] sm:min-h-[36px] px-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="ALL">Semua Area</option>
            {areas.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            value={contractorFilter}
            onChange={e => setContractorFilter(e.target.value)}
            className="min-h-[44px] sm:min-h-[36px] px-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="ALL">Semua Kontraktor</option>
            {contractors.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="min-h-[44px] sm:min-h-[36px] px-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="ALL">Semua Status</option>
            <option value="Assigned">Assigned</option>
            <option value="En Route">En Route</option>
            <option value="On Site">On Site</option>
            <option value="Completed">Completed</option>
            <option value="Pending Technical">Pending Technical</option>
          </select>
        </div>
      </div>

      {/* Date Difference Clarification Pill (Strict TAHAP 7 requirement) */}
      <div className="p-3.5 bg-slate-100/80 dark:bg-[#0F172A] rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-start sm:items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8] shrink-0 mt-0.5 sm:mt-0" />
          <span className="leading-relaxed">
            <strong className="text-slate-900 dark:text-white">Pembedaan Tanggal:</strong> Kalender ini murni merefleksikan <strong className="text-slate-900 dark:text-white">Appointment Date</strong> resmi pelanggan.
            Field Date Upload, Date Assign Agent, dan Tanggal Laporan dipertahankan sebagai atribut histori audit terpisah.
          </span>
        </div>
        {unscheduledTickets.length > 0 && (
          <span className="px-2.5 py-1 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold rounded-lg shrink-0 font-mono tabular-nums">
            {unscheduledTickets.length} Belum Ada Jadwal
          </span>
        )}
      </div>

      {/* Main Schedule View Body */}
      {viewMode === 'day' && (
        <div className="space-y-4">
          <div className={`grid ${isCompactUI ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'} gap-4`}>
            {STANDARD_SLOTS.map(slot => {
              const slotKey = slot.slice(0, 5);
              const slotTickets = dayTickets.filter(t => String(t.slotTime || '').includes(slotKey));
              return (
                <div
                  key={slot}
                  className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 dark:text-white">
                      <Clock className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#38BDF8]" />
                      <span className="font-mono tabular-nums">{slot}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#2563EB]/10 text-[#2563EB] dark:bg-[#38BDF8]/15 dark:text-[#38BDF8] font-mono tabular-nums">
                      {slotTickets.length} WO
                    </span>
                  </div>

                  <div className="space-y-2.5 flex-1 overflow-y-auto max-h-96">
                    {slotTickets.length === 0 ? (
                      <div className="py-8 text-center text-slate-400 dark:text-slate-500 text-[11px] italic">
                        Tidak ada WO pada slot ini.
                      </div>
                    ) : (
                      slotTickets.map(t => {
                        const overdue = isOverdue(t);
                        return (
                          <div
                            key={t.id}
                            className={`p-3 rounded-xl border transition-all space-y-2 ${
                              overdue
                                ? 'bg-rose-50/80 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
                                : 'bg-slate-50 dark:bg-[#1E293B] border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                onClick={() => onSelectTicket(t)}
                                className="font-mono font-bold text-xs text-[#2563EB] dark:text-[#38BDF8] hover:underline cursor-pointer tabular-nums"
                              >
                                {t.woNumber}
                              </span>
                              {overdue && (
                                <span className="px-1.5 py-0.5 bg-rose-600 text-white rounded text-[9.5px] font-bold">
                                  OVERDUE
                                </span>
                              )}
                            </div>
                            <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                              {t.customerName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {t.clusterName || t.area}
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t border-slate-200/80 dark:border-slate-700 text-[10.5px] gap-2">
                              <span className="text-slate-600 dark:text-slate-300 truncate">
                                Teknisi: <strong className="text-slate-900 dark:text-white">{t.installerName || 'Unassigned'}</strong>
                              </span>
                              <StatusInstallerBadge status={t.statusWOInstaller} />
                            </div>
                            <div className="flex items-center justify-end gap-1.5 pt-1">
                              <button
                                type="button"
                                onClick={() => onSelectTicket(t)}
                                className="w-full sm:w-auto min-h-[44px] sm:min-h-[32px] px-3 py-1.5 bg-white dark:bg-[#0F172A] hover:bg-[#2563EB] hover:text-white dark:hover:bg-[#2563EB] text-[#2563EB] dark:text-[#38BDF8] rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Detail WO</span>
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* List View / Agenda View */}
      {(viewMode === 'list' || viewMode === 'week' || viewMode === 'month') && (
        <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs space-y-3 text-xs">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800 gap-2">
            <span className="font-bold text-slate-900 dark:text-white text-sm">
              Daftar Agenda Jadwal Appointment (<span className="font-mono tabular-nums text-[#2563EB] dark:text-[#38BDF8]">{filteredTickets.length}</span> WO)
            </span>
            <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px] hidden sm:inline">
              Format Agenda Terstruktur
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredTickets.map(t => {
              const overdue = isOverdue(t);
              return (
                <div key={t.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#1E293B]/60 p-2.5 rounded-xl transition-colors">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        onClick={() => onSelectTicket(t)}
                        className="font-mono font-bold text-xs text-[#2563EB] dark:text-[#38BDF8] hover:underline cursor-pointer tabular-nums"
                      >
                        {t.woNumber}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white truncate">{t.customerName}</span>
                      {overdue && (
                        <span className="px-2 py-0.5 bg-rose-600 text-white rounded text-[10px] font-bold">
                          Overdue
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Appointment: <strong className="text-[#2563EB] dark:text-[#38BDF8] font-medium font-mono tabular-nums">{formatAppointmentDateDisplay(t.appointmentDate)}</strong></span>
                      <span>Slot: <strong className="text-slate-800 dark:text-slate-200 font-mono tabular-nums">{t.slotTime}</strong></span>
                      <span>Area: <strong className="text-slate-700 dark:text-slate-300">{t.area}</strong></span>
                      <span>Mitra: <strong className="text-slate-700 dark:text-slate-300">{t.contactorName || t.contractorName}</strong></span>
                      <span>Teknisi: <strong className="text-emerald-600 dark:text-emerald-400">{t.installerName || 'Belum Di-assign'}</strong></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 self-stretch sm:self-auto justify-between sm:justify-end shrink-0 pt-1 sm:pt-0">
                    <StatusInstallerBadge status={t.statusWOInstaller} />
                    <button
                      type="button"
                      onClick={() => onSelectTicket(t)}
                      className="px-4 py-2 min-h-[44px] sm:min-h-[36px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl font-bold text-xs shadow-xs transition-colors cursor-pointer"
                    >
                      Buka WO
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
