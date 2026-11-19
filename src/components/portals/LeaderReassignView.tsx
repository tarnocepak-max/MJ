import React, { useMemo, useState, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  Eye,
  Filter,
  History,
  Info,
  Lightbulb,
  MapPin,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  Users2,
  Wrench,
  X
} from 'lucide-react';
import { Ticket, User } from '../../types/index.ts';
import {
  AssignmentFeedEntry,
  TechnicianCapacitySummary
} from '../../services/leaderQuotaService';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { PaginationBar } from '../common/PaginationBar';
import { formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { getTicketWorkStatus, formatJakartaTimeOnly } from '../../services/workSessionService';

interface LeaderReassignViewProps {
  todayTickets: Ticket[];
  todayWIB: string;
  todayAppointmentDisplay: string;
  displayContractor: string;
  displayArea: string;
  clusterOptions: string[];
  categoryOptions: { name: string; count: number }[];
  technicians: TechnicianCapacitySummary[];
  installers: User[];
  auditFeed: AssignmentFeedEntry[];
  isLeaderRole: boolean;
  databaseStatus: string;
  syncStatus: string;
  quotaUtilizationPct: number;
  totalMaxSlots: number;
  summaryMetrics: {
    total: number;
    unassigned: number;
    assigned: number;
    activeInstallers: number;
    idleInstallers: number;
  };
  onOpenReassignModal: (ticket: Ticket) => void;
  onOpenBulkReassign: () => void;
  onExecuteAutoBalance: () => void;
  onExportExcel: () => void;
  onOpenAuditTrail: () => void;
  onSelectTicket: (ticket: Ticket) => void;
  onRefreshData: () => Promise<void> | void;
  onJumpToAssignTab: () => void;
  onJumpToProgressTab: () => void;
}

type ReassignStatusFilter =
  | 'all'
  | 'eligible'
  | 'problem'
  | 'in_progress'
  | 'waiting'
  | 'unassigned'
  | 'reassigned';

function getInitials(name?: string): string {
  const parts = String(name || 'TK').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TK';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function isTicketProblematic(t: Ticket): boolean {
  return (
    t.statusWOInstaller === 'Pending Technical' ||
    t.statusWOInstaller === 'Failed / Cancelled' ||
    t.statusWOAgent === 'Cancelled' ||
    t.statusWhatsApp === 'reschedule_requested' ||
    Boolean(t.remarksWOInstaller?.trim())
  );
}

function isTicketCompletedOrClosed(t: Ticket): boolean {
  return (
    t.statusWOInstaller === 'Completed' ||
    t.statusWOInstaller === 'Installed' ||
    t.statusWOAgent === 'Closed' ||
    t.statusWOAgent === 'Resolved'
  );
}

function isTicketEligibleForReassign(t: Ticket): boolean {
  return Boolean(t.installerName) && !isTicketCompletedOrClosed(t);
}

function getReassignBadge(t: Ticket): { label: string; cls: string; tone: 'problem' | 'active' | 'waiting' | 'unassigned' | 'done' } {
  if (!t.installerName) {
    return {
      label: 'UNASSIGNED',
      tone: 'unassigned',
      cls: 'bg-[#FEF3C7] dark:bg-amber-950/60 border border-[#FCD34D] dark:border-amber-700 text-[#B45309] dark:text-amber-300'
    };
  }
  if (isTicketCompletedOrClosed(t)) {
    return {
      label: (t.statusWOInstaller || 'COMPLETED').toUpperCase(),
      tone: 'done',
      cls: 'bg-[#DCFCE7] dark:bg-emerald-950/60 border border-[#86EFAC] dark:border-emerald-700 text-[#15803D] dark:text-emerald-300'
    };
  }
  if (t.statusWOInstaller === 'Pending Technical' || t.statusWOInstaller === 'Failed / Cancelled') {
    return {
      label: t.statusWOInstaller.toUpperCase(),
      tone: 'problem',
      cls: 'bg-[#FFDAD6] dark:bg-rose-950/60 border border-[#FCA5A5] dark:border-rose-800 text-[#93000A] dark:text-rose-300'
    };
  }
  if (t.statusWOInstaller === 'On Site' || t.statusWOInstaller === 'En Route' || t.statusWOAgent === 'In Progress') {
    return {
      label: (t.statusWOInstaller || 'IN PROGRESS').toUpperCase(),
      tone: 'active',
      cls: 'bg-[#EEDBFF] dark:bg-[#2E1B59] border border-[#D0BCFF] dark:border-[#5B35B1] text-[#58149C] dark:text-[#DAB9FF]'
    };
  }
  return {
    label: (t.statusWOInstaller || 'ASSIGNED').toUpperCase(),
    tone: 'waiting',
    cls: 'bg-[#E0F2FE] dark:bg-sky-950/60 border border-[#BAE6FD] dark:border-sky-800 text-[#1D4ED8] dark:text-sky-300'
  };
}

export const LeaderReassignView: React.FC<LeaderReassignViewProps> = ({
  todayTickets,
  todayWIB,
  todayAppointmentDisplay,
  displayContractor,
  displayArea,
  clusterOptions,
  categoryOptions,
  technicians,
  installers,
  auditFeed,
  isLeaderRole,
  databaseStatus,
  syncStatus,
  quotaUtilizationPct,
  totalMaxSlots,
  summaryMetrics,
  onOpenReassignModal,
  onOpenBulkReassign,
  onExecuteAutoBalance,
  onExportExcel,
  onOpenAuditTrail,
  onSelectTicket,
  onRefreshData,
  onJumpToAssignTab,
  onJumpToProgressTab
}) => {
  const { isCompactUI } = useResponsiveViewport();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<ReassignStatusFilter>('eligible');
  const [slotFilter, setSlotFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [installerFilter, setInstallerFilter] = useState<string>('ALL');
  const [showMobileAdvancedFilters, setShowMobileAdvancedFilters] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [rowsPerPage, setRowsPerPage] = useState<number>(() => (isCompactUI ? 6 : 10));

  useEffect(() => {
    if (isCompactUI && rowsPerPage > 8) {
      setRowsPerPage(6);
      setCurrentPage(1);
    } else if (!isCompactUI && rowsPerPage === 6) {
      setRowsPerPage(10);
      setCurrentPage(1);
    }
  }, [isCompactUI]);

  const techMap = useMemo(() => {
    const map = new Map<string, TechnicianCapacitySummary>();
    technicians.forEach(item => {
      map.set(item.installer.name.toLowerCase().trim(), item);
    });
    return map;
  }, [technicians]);

  const reassignedTodayCount = useMemo(() => {
    const uniqueWo = new Set<string>();
    auditFeed.forEach(item => {
      const ts = String(item.timestamp || item.createdAt || '');
      if (!ts || ts.slice(0, 10) === todayWIB) {
        if (item.woNumber || item.ticketId) uniqueWo.add(item.woNumber || item.ticketId || '');
      }
    });
    todayTickets.forEach(t => {
      if (t.reassignedAt && t.reassignedAt.slice(0, 10) === todayWIB) {
        uniqueWo.add(t.woNumber || t.id);
      }
    });
    return uniqueWo.size;
  }, [auditFeed, todayTickets, todayWIB]);

  const eligibleCount = useMemo(
    () => todayTickets.filter(isTicketEligibleForReassign).length,
    [todayTickets]
  );

  const problemCount = useMemo(
    () => todayTickets.filter(t => isTicketEligibleForReassign(t) && isTicketProblematic(t)).length,
    [todayTickets]
  );

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return todayTickets.filter(t => {
      // Status filter
      if (statusFilter === 'eligible' && !isTicketEligibleForReassign(t)) return false;
      if (statusFilter === 'problem' && (!isTicketEligibleForReassign(t) || !isTicketProblematic(t))) return false;
      if (
        statusFilter === 'in_progress' &&
        (!t.installerName ||
          (t.statusWOInstaller !== 'On Site' &&
            t.statusWOInstaller !== 'En Route' &&
            t.statusWOAgent !== 'In Progress'))
      ) {
        return false;
      }
      if (
        statusFilter === 'waiting' &&
        (!t.installerName ||
          isTicketCompletedOrClosed(t) ||
          t.statusWOInstaller === 'On Site' ||
          t.statusWOInstaller === 'En Route')
      ) {
        return false;
      }
      if (statusFilter === 'unassigned' && t.installerName) return false;
      if (
        statusFilter === 'reassigned' &&
        !(t.reassignedAt || (t.assignmentHistory && t.assignmentHistory.some(h => h.sourceAction === 'reassign')))
      ) {
        return false;
      }

      // Slot filter
      if (slotFilter !== 'ALL') {
        if (!String(t.slotTime || '').includes(slotFilter)) return false;
      }

      // Category filter
      if (categoryFilter !== 'ALL') {
        if (String(t.ticketCategory || '').trim().toLowerCase() !== categoryFilter.toLowerCase()) {
          return false;
        }
      }

      // Installer filter
      if (installerFilter !== 'ALL') {
        if (String(t.installerName || '').trim().toLowerCase() !== installerFilter.toLowerCase()) {
          return false;
        }
      }

      // Live search
      if (q) {
        const hay = [
          t.woNumber,
          t.idCustomer,
          t.customerName,
          t.customerPhone,
          t.streetName,
          t.clusterName,
          t.area,
          t.installerName,
          t.fatCode,
          t.fdtCode,
          t.ticketCategory
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [todayTickets, statusFilter, slotFilter, categoryFilter, installerFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTickets = useMemo(() => {
    const start = (safePage - 1) * rowsPerPage;
    return filteredTickets.slice(start, start + rowsPerPage);
  }, [filteredTickets, safePage, rowsPerPage]);

  const hasActiveCustomFilter =
    Boolean(searchQuery.trim()) ||
    statusFilter !== 'eligible' ||
    slotFilter !== 'ALL' ||
    categoryFilter !== 'ALL' ||
    installerFilter !== 'ALL';

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('eligible');
    setSlotFilter('ALL');
    setCategoryFilter('ALL');
    setInstallerFilter('ALL');
    setCurrentPage(1);
  };

  const handleTriggerRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const latestReassignEntry = auditFeed[0];

  const activeFilterTags: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (searchQuery.trim()) {
    activeFilterTags.push({
      key: 'q',
      label: `Cari: "${searchQuery.trim()}"`,
      onClear: () => setSearchQuery('')
    });
  }
  if (statusFilter !== 'eligible') {
    const statusLabels: Record<ReassignStatusFilter, string> = {
      all: 'Semua WO Hari Ini',
      eligible: 'Aktif / Siap Reassign',
      problem: 'Kendala / Pending',
      in_progress: 'Sedang Dikerjakan',
      waiting: 'Menunggu Pengerjaan',
      unassigned: 'Belum Di-assign',
      reassigned: 'Pernah Direassign'
    };
    activeFilterTags.push({
      key: 'status',
      label: `Status: ${statusLabels[statusFilter]}`,
      onClear: () => setStatusFilter('eligible')
    });
  }
  if (slotFilter !== 'ALL') {
    activeFilterTags.push({
      key: 'slot',
      label: `Slot: ${slotFilter}`,
      onClear: () => setSlotFilter('ALL')
    });
  }
  if (categoryFilter !== 'ALL') {
    activeFilterTags.push({
      key: 'cat',
      label: `Kategori: ${categoryFilter}`,
      onClear: () => setCategoryFilter('ALL')
    });
  }
  if (installerFilter !== 'ALL') {
    activeFilterTags.push({
      key: 'inst',
      label: `Teknisi: ${installerFilter}`,
      onClear: () => setInstallerFilter('ALL')
    });
  }

  return (
    <div className="space-y-4">
      {/* ============================================================ */}
      {/* 1. HEADER BAR (SYNCED TO DESKTOP vs MOBILE MODE)             */}
      {/* ============================================================ */}
      {isCompactUI ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#58149C] dark:text-[#DAB9FF]">
                <span>{displayContractor}</span>
                <span>·</span>
                <span>{displayArea}</span>
              </div>
              <h2
                className="text-xl font-extrabold text-[#1F1638] dark:text-white tracking-tight mt-0.5"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Reassign WO
              </h2>
              <p className="text-[11.5px] text-[#7D7484] dark:text-[#CEC0E8]">
                Kelola &amp; redistribusi penugasan tim ({todayAppointmentDisplay})
              </p>
            </div>

            <button
              type="button"
              disabled={!isLeaderRole || eligibleCount === 0}
              onClick={onOpenBulkReassign}
              title="Bulk Reassign WO"
              className="w-11 h-11 rounded-2xl bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] border border-[#D0BCFF] dark:border-[#5B35B1] flex items-center justify-center shrink-0 disabled:opacity-45 cursor-pointer"
            >
              <ArrowRightLeft className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile Horizontal Metrics Strip */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            <div className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] text-[11px] font-bold text-[#1F1638] dark:text-white whitespace-nowrap shrink-0 tabular-nums">
              Total <span className="text-[#58149C] dark:text-[#DAB9FF] ml-0.5">{summaryMetrics.total}</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] text-[11px] font-bold text-[#1F1638] dark:text-white whitespace-nowrap shrink-0 tabular-nums flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#6A46C1]" />
              Assigned <span>{summaryMetrics.assigned}</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] text-[11px] font-bold text-[#1F1638] dark:text-white whitespace-nowrap shrink-0 tabular-nums flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#16A36A]" />
              Reassigned <span>{reassignedTodayCount}</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] text-[11px] font-bold text-[#1F1638] dark:text-white whitespace-nowrap shrink-0 tabular-nums flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#BA1A1A]" />
              Unassigned <span>{summaryMetrics.unassigned}</span>
            </div>
          </div>

          {/* Mobile Search + Filter Drawer Trigger */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#7D7484] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Cari ID WO, pelanggan, atau teknisi..."
                className="w-full pl-10 pr-8 py-2.5 min-h-[44px] rounded-2xl bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#58149C]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#7D7484] hover:text-[#1F1638] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowMobileAdvancedFilters(prev => !prev)}
              aria-label="Filter lanjutan"
              className={`min-w-[44px] min-h-[44px] rounded-2xl border flex items-center justify-center cursor-pointer transition-colors ${
                showMobileAdvancedFilters
                  ? 'bg-[#58149C] text-white border-[#58149C]'
                  : 'bg-white dark:bg-[#1E1238] text-[#58149C] dark:text-[#DAB9FF] border-[#E8DDFF] dark:border-[#3E246F]'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>

          {showMobileAdvancedFilters && (
            <div className="p-3 rounded-2xl bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] grid grid-cols-1 gap-2 text-xs">
              <select
                value={statusFilter}
                onChange={e => {
                  setStatusFilter(e.target.value as ReassignStatusFilter);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 min-h-[40px] rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#4B386B] font-semibold text-[#1F1638] dark:text-white"
              >
                <option value="eligible">Aktif / Siap Reassign ({eligibleCount})</option>
                <option value="all">Semua WO Hari Ini ({todayTickets.length})</option>
                <option value="problem">Kendala / Pending ({problemCount})</option>
                <option value="in_progress">Sedang Dikerjakan</option>
                <option value="waiting">Menunggu Pengerjaan</option>
                <option value="reassigned">Pernah Direassign</option>
                <option value="unassigned">Belum Di-assign ({summaryMetrics.unassigned})</option>
              </select>

              <select
                value={installerFilter}
                onChange={e => {
                  setInstallerFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 min-h-[40px] rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#4B386B] font-semibold text-[#1F1638] dark:text-white"
              >
                <option value="ALL">Semua Teknisi</option>
                {installers.map(inst => (
                  <option key={inst.id} value={inst.name}>
                    {inst.name}
                  </option>
                ))}
              </select>

              <select
                value={categoryFilter}
                onChange={e => {
                  setCategoryFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 min-h-[40px] rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#4B386B] font-semibold text-[#1F1638] dark:text-white"
              >
                <option value="ALL">Semua Kategori</option>
                {categoryOptions.map(cat => (
                  <option key={cat.name} value={cat.name}>
                    {cat.name} ({cat.count})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mobile Quick Filter Chips */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {[
              { id: 'eligible' as const, label: 'Siap Reassign', count: eligibleCount },
              { id: 'problem' as const, label: 'Kendala Lapangan', count: problemCount, dot: 'bg-[#D97706]' },
              { id: 'reassigned' as const, label: 'Sudah Dialihkan', count: reassignedTodayCount },
              { id: 'all' as const, label: 'Semua WO', count: todayTickets.length }
            ].map(chip => {
              const active = statusFilter === chip.id && categoryFilter === 'ALL';
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(chip.id);
                    setCategoryFilter('ALL');
                    setCurrentPage(1);
                  }}
                  className={`px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer transition-all ${
                    active
                      ? 'bg-[#58149C] text-white shadow-xs'
                      : 'bg-white dark:bg-[#1E1238] text-[#4B4452] dark:text-[#CEC0E8] border border-[#E8DDFF] dark:border-[#3E246F]'
                  }`}
                >
                  {chip.dot && <span className={`w-2 h-2 rounded-full ${chip.dot}`} />}
                  <span>{chip.label}</span>
                  <span className={`font-mono text-[10.5px] ${active ? 'text-[#EEDBFF]' : 'text-[#7D7484]'}`}>
                    {chip.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* DESKTOP HEADER + 4 KPI CARDS + MULTI-FILTER TOOLBAR */
        <>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3.5">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] text-[10.5px] font-extrabold uppercase tracking-wider">
                  CLUSTER DISPATCH CONTROL
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#15803D] dark:text-emerald-300">
                  <RefreshCw className={`w-3 h-3 ${syncStatus === 'SYNCING' ? 'animate-spin' : ''}`} />
                  <span>
                    {databaseStatus === 'connected' ? 'Live Sync Active' : 'Mode Offline'} · {todayAppointmentDisplay}
                  </span>
                </span>
              </div>

              <h2
                className="text-2xl font-extrabold text-[#1F1638] dark:text-white tracking-tight"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Reassign WO
              </h2>
              <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8]">
                Kelola dan alihkan penugasan Work Order untuk <strong className="text-[#1F1638] dark:text-white">{displayContractor}</strong> ({displayArea}) tanpa menghilangkan riwayat kerja teknisi.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenAuditTrail}
                className="btn-3d-secondary px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <History className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                <span>Riwayat Audit ({auditFeed.length})</span>
              </button>

              <button
                type="button"
                onClick={onExportExcel}
                className="btn-3d-secondary px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                <span>Ekspor Data</span>
              </button>

              <button
                type="button"
                disabled={!isLeaderRole || eligibleCount === 0}
                onClick={onOpenBulkReassign}
                className="btn-3d-primary px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-45 cursor-pointer"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Bulk Reassign</span>
              </button>
            </div>
          </div>

          {/* 4 KPI SUMMARY CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            {/* KPI 1: Total WO */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setCurrentPage(1);
              }}
              className="text-left bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(31,22,56,0.04)] hover:border-[#58149C] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                  Total Work Orders
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#F3EAFF] dark:bg-[#2C1A4E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center">
                  <ClipboardList className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-[#1F1638] dark:text-white font-display tabular-nums">
                  {summaryMetrics.total}
                </span>
                <span className="text-xs font-semibold text-[#7D7484] dark:text-[#A79BC0]">Tiket</span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#F3EAFF] dark:border-[#35105E] flex items-center justify-between text-[11px]">
                <span className="text-[#15803D] dark:text-emerald-300 font-semibold">
                  {eligibleCount} siap reassign
                </span>
                <span className="font-bold text-[#58149C] dark:text-[#DAB9FF]">Hari Ini</span>
              </div>
            </button>

            {/* KPI 2: Unassigned WO */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter('unassigned');
                setCurrentPage(1);
              }}
              className="text-left bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(31,22,56,0.04)] hover:border-[#BA1A1A] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                  Unassigned WO
                </span>
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    summaryMetrics.unassigned > 0
                      ? 'bg-[#FFDAD6] dark:bg-rose-950/60 text-[#BA1A1A] dark:text-rose-300'
                      : 'bg-[#DCFCE7] dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-300'
                  }`}
                >
                  {summaryMetrics.unassigned > 0 ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span
                  className={`text-2xl font-extrabold font-display tabular-nums ${
                    summaryMetrics.unassigned > 0
                      ? 'text-[#BA1A1A] dark:text-rose-400'
                      : 'text-[#15803D] dark:text-emerald-300'
                  }`}
                >
                  {summaryMetrics.unassigned}
                </span>
                <span className="text-xs font-semibold text-[#7D7484] dark:text-[#A79BC0]">
                  {summaryMetrics.unassigned > 0 ? 'Tiket' : 'Tertangani'}
                </span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#F3EAFF] dark:border-[#35105E] flex items-center justify-between text-[11px]">
                <span className="text-[#4B4452] dark:text-[#CEC0E8] font-medium">
                  {summaryMetrics.unassigned > 0 ? 'Perlu penugasan awal' : 'Antrean unassigned kosong'}
                </span>
                {summaryMetrics.unassigned > 0 && isLeaderRole && (
                  <span
                    onClick={e => {
                      e.stopPropagation();
                      onExecuteAutoBalance();
                    }}
                    className="font-bold text-[#58149C] dark:text-[#DAB9FF] hover:underline"
                  >
                    Auto-Balance
                  </span>
                )}
              </div>
            </button>

            {/* KPI 3: WO In Field (Active) */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter('eligible');
                setCurrentPage(1);
              }}
              className="text-left bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(31,22,56,0.04)] hover:border-[#6A46C1] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                  WO In Field (Active)
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center">
                  <Users2 className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-[#58149C] dark:text-[#DAB9FF] font-display tabular-nums">
                  {summaryMetrics.assigned}
                </span>
                <span className="text-xs font-semibold text-[#7D7484] dark:text-[#A79BC0]">
                  / {totalMaxSlots} Slot
                </span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#F3EAFF] dark:border-[#35105E] flex items-center justify-between text-[11px]">
                <span className="text-[#4B4452] dark:text-[#CEC0E8] font-medium">
                  {summaryMetrics.activeInstallers} Teknisi Aktif
                </span>
                <span className="font-bold font-mono text-[#58149C] dark:text-[#DAB9FF] tabular-nums">
                  {quotaUtilizationPct}% Load
                </span>
              </div>
            </button>

            {/* KPI 4: WO Reassigned */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter('reassigned');
                setCurrentPage(1);
              }}
              className="text-left bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(31,22,56,0.04)] hover:border-[#58149C] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                  WO Reassigned
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#F3EAFF] dark:bg-[#2C1A4E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center">
                  <ArrowRightLeft className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-[#1F1638] dark:text-white font-display tabular-nums">
                  {reassignedTodayCount}
                </span>
                <span className="text-xs font-semibold text-[#7D7484] dark:text-[#A79BC0]">Tiket Hari Ini</span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#F3EAFF] dark:border-[#35105E] flex items-center justify-between text-[11px]">
                <span className="text-[#4B4452] dark:text-[#CEC0E8] truncate">
                  {latestReassignEntry
                    ? `Terakhir: ${latestReassignEntry.woNumber || '-'}`
                    : 'Belum ada alihan hari ini'}
                </span>
                <span className="font-bold text-[#58149C] dark:text-[#DAB9FF] shrink-0">
                  Audit Log
                </span>
              </div>
            </button>
          </div>

          {/* MULTI-FILTER TOOLBAR */}
          <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(31,22,56,0.04)] space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
              <div className="md:col-span-4 relative">
                <Search className="w-4 h-4 text-[#7D7484] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Cari Nomor WO, Pelanggan, ODP/FAT, atau Teknisi..."
                  className="w-full pl-9 pr-8 py-2 min-h-[40px] rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#4B386B] text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#58149C]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Bersihkan pencarian"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7D7484] hover:text-[#1F1638] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="md:col-span-2">
                <select
                  value={statusFilter}
                  onChange={e => {
                    setStatusFilter(e.target.value as ReassignStatusFilter);
                    setCurrentPage(1);
                  }}
                  aria-label="Filter Status WO"
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#4B386B] text-xs font-semibold text-[#1F1638] dark:text-white cursor-pointer"
                >
                  <option value="eligible">Siap Reassign ({eligibleCount})</option>
                  <option value="all">Semua WO ({todayTickets.length})</option>
                  <option value="problem">Kendala / Pending ({problemCount})</option>
                  <option value="in_progress">Sedang Dikerjakan</option>
                  <option value="waiting">Menunggu Pengerjaan</option>
                  <option value="reassigned">Pernah Direassign</option>
                  <option value="unassigned">Unassigned ({summaryMetrics.unassigned})</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={slotFilter}
                  onChange={e => {
                    setSlotFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Filter Slot Jadwal"
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#4B386B] text-xs font-semibold text-[#1F1638] dark:text-white cursor-pointer"
                >
                  <option value="ALL">Semua Slot Waktu</option>
                  <option value="09:00">Slot 1 (09:00 - 11:00)</option>
                  <option value="11:00">Slot 2 (11:00 - 13:00)</option>
                  <option value="13:00">Slot 3 (13:00 - 15:00)</option>
                  <option value="15:00">Slot 4 (15:00 - 17:00)</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={categoryFilter}
                  onChange={e => {
                    setCategoryFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Filter Kategori Tiket"
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#4B386B] text-xs font-semibold text-[#1F1638] dark:text-white cursor-pointer"
                >
                  <option value="ALL">Semua Kategori</option>
                  {categoryOptions.map(cat => (
                    <option key={cat.name} value={cat.name}>
                      {cat.name} ({cat.count})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={installerFilter}
                  onChange={e => {
                    setInstallerFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Filter Teknisi Saat Ini"
                  className="w-full px-3 py-2 min-h-[40px] rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#4B386B] text-xs font-semibold text-[#1F1638] dark:text-white cursor-pointer"
                >
                  <option value="ALL">Semua Teknisi</option>
                  {installers.map(inst => (
                    <option key={inst.id} value={inst.name}>
                      {inst.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Active Filter Tags Row */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#F3EAFF] dark:border-[#35105E]">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-[#7D7484] dark:text-[#A79BC0] mr-1">
                  Filter Aktif:
                </span>
                {activeFilterTags.length === 0 ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#F8F1FF] dark:bg-[#261942] text-[#58149C] dark:text-[#DAB9FF] font-semibold">
                    WO Aktif Siap Reassign ({todayAppointmentDisplay})
                  </span>
                ) : (
                  activeFilterTags.map(tag => (
                    <button
                      key={tag.key}
                      type="button"
                      onClick={tag.onClear}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] font-bold hover:bg-[#DAB9FF]/60 cursor-pointer"
                    >
                      <span>{tag.label}</span>
                      <X className="w-3 h-3" />
                    </button>
                  ))
                )}

                {problemCount > 0 && statusFilter !== 'problem' && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('problem');
                      setCurrentPage(1);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FEF3C7] dark:bg-amber-950/60 text-[#B45309] dark:text-amber-300 border border-[#FCD34D] dark:border-amber-800 font-bold cursor-pointer"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    <span>Kendala / Catatan ({problemCount})</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-[#7D7484] dark:text-[#A79BC0] tabular-nums">
                  {filteredTickets.length} dari {todayTickets.length} WO
                </span>
                {hasActiveCustomFilter && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="btn-3d-secondary px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Filter</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/* 2. MAIN CONTENT: EMPTY STATE OR TABLE (DESKTOP) / CARDS (MOBILE) */}
      {/* ============================================================ */}
      {filteredTickets.length === 0 ? (
        <div className="bg-white dark:bg-[#1E1238] rounded-3xl border border-[#E8DDFF] dark:border-[#3E246F] p-6 sm:p-10 shadow-[0_4px_18px_rgba(31,22,56,0.05)] space-y-6">
          <div className="max-w-xl mx-auto text-center space-y-4">
            <div className="relative inline-flex items-center justify-center">
              <div className="w-20 h-20 rounded-3xl bg-[#F3EAFF] dark:bg-[#2C1A4E] border border-[#E8DDFF] dark:border-[#4B386B] flex items-center justify-center text-[#58149C] dark:text-[#DAB9FF] shadow-inner">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <span className="absolute -bottom-2 px-2.5 py-0.5 rounded-full bg-[#58149C] text-white font-mono text-[10px] font-extrabold shadow-sm">
                0 ANTREAN
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              <h3
                className="text-lg sm:text-xl font-extrabold text-[#1F1638] dark:text-white"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {hasActiveCustomFilter
                  ? 'Tidak Ada Work Order yang Cocok'
                  : 'Tidak Ada Work Order yang Memerlukan Reassign'}
              </h3>
              <p className="text-xs sm:text-sm text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
                {hasActiveCustomFilter
                  ? 'Tidak ditemukan Work Order dalam cakupan Anda yang sesuai dengan kombinasi filter atau kata kunci pencarian saat ini.'
                  : `Semua Work Order dalam tanggung jawab ${displayContractor} (${displayArea}) berjalan sesuai penjadwalan atau telah diselesaikan.`}
              </p>
            </div>

            {activeFilterTags.length > 0 && (
              <div className="inline-flex flex-wrap items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] text-[11px]">
                <Info className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                <span className="font-semibold text-[#4B4452] dark:text-[#CEC0E8]">Kriteria aktif:</span>
                {activeFilterTags.map(tag => (
                  <span
                    key={tag.key}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-[#261942] font-mono font-bold text-[#58149C] dark:text-[#DAB9FF]"
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              {hasActiveCustomFilter && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="btn-3d-primary px-5 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer"
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Reset Semua Filter</span>
                </button>
              )}

              <button
                type="button"
                disabled={isRefreshing}
                onClick={handleTriggerRefresh}
                className="btn-3d-secondary px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF] ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>{isRefreshing ? 'Menyegarkan...' : 'Segarkan Data WO'}</span>
              </button>

              {summaryMetrics.unassigned > 0 && (
                <button
                  type="button"
                  onClick={onJumpToAssignTab}
                  className="btn-3d-secondary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Assign {summaryMetrics.unassigned} WO Baru</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                </button>
              )}
            </div>
          </div>

          {/* 3 Real Quick-Glance Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#F3EAFF] dark:border-[#35105E]">
            <div className="p-3.5 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#261942] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0 shadow-xs">
                <Activity className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold text-[#7D7484] dark:text-[#A79BC0]">
                  Utilisasi Kuota Tim
                </div>
                <div className="font-bold text-xs text-[#1F1638] dark:text-white font-mono tabular-nums mt-0.5">
                  {quotaUtilizationPct}% ({summaryMetrics.assigned}/{totalMaxSlots} Slot)
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#261942] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0 shadow-xs">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold text-[#7D7484] dark:text-[#A79BC0]">
                  Distribusi Wilayah
                </div>
                <div className="font-bold text-xs text-[#1F1638] dark:text-white truncate mt-0.5">
                  {clusterOptions.length || 1} Cluster · {displayArea}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#261942] text-[#15803D] dark:text-emerald-300 flex items-center justify-center shrink-0 shadow-xs">
                <UserCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold text-[#7D7484] dark:text-[#A79BC0]">
                  Status Tim Lapangan
                </div>
                <div className="font-bold text-xs text-[#15803D] dark:text-emerald-300 font-mono tabular-nums mt-0.5">
                  {summaryMetrics.activeInstallers} Aktif · {summaryMetrics.idleInstallers} Siaga
                </div>
              </div>
            </div>
          </div>

          {/* Leader Tips Banner */}
          <div className="p-3.5 rounded-2xl bg-[#F3EAFF] dark:bg-[#261942] border border-[#E8DDFF] dark:border-[#4B386B] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                <Lightbulb className="w-4 h-4" />
              </div>
              <p className="text-[11.5px] text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
                <strong className="text-[#58149C] dark:text-[#DAB9FF]">Tips Leader:</strong> Pantau tab{' '}
                <button
                  type="button"
                  onClick={onJumpToProgressTab}
                  className="font-bold underline text-[#58149C] dark:text-[#DAB9FF] cursor-pointer"
                >
                  Progress Live
                </button>{' '}
                untuk melihat Check-in lapangan atau kendala teknis secara real-time sebelum memutuskan pengalihan tugas teknisi.
              </p>
            </div>
            <button
              type="button"
              onClick={onJumpToProgressTab}
              className="text-xs font-extrabold text-[#58149C] dark:text-[#DAB9FF] flex items-center gap-1 whitespace-nowrap shrink-0 hover:underline cursor-pointer"
            >
              <span>Buka Progress Live</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : isCompactUI ? (
        /* ============================================================ */
        /* 3A. MOBILE MODE: TACTILE CARD STREAM                         */
        /* ============================================================ */
        <div className="space-y-3">
          <div className="space-y-3">
            {paginatedTickets.map(t => {
              const badge = getReassignBadge(t);
              const eligible = isTicketEligibleForReassign(t);
              const techInfo = t.installerName
                ? techMap.get(t.installerName.toLowerCase().trim())
                : undefined;
              const workStat = getTicketWorkStatus(t);
              const accentClass =
                badge.tone === 'problem'
                  ? 'border-l-4 border-l-[#D97706]'
                  : badge.tone === 'active'
                  ? 'border-l-4 border-l-[#58149C]'
                  : badge.tone === 'unassigned'
                  ? 'border-l-4 border-l-[#BA1A1A]'
                  : 'border-l-4 border-l-[#6A46C1]';

              return (
                <article
                  key={t.id}
                  className={`bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-4 shadow-[0_3px_12px_rgba(31,22,56,0.05)] space-y-3 ${accentClass}`}
                >
                  {/* Card Top Row */}
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectTicket(t)}
                      className="inline-flex items-center gap-1.5 font-mono text-xs font-extrabold text-[#58149C] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                    >
                      <Wrench className="w-3.5 h-3.5 shrink-0" />
                      <span>{t.woNumber}</span>
                    </button>

                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>

                  {/* Customer Info */}
                  <div>
                    <h3 className="font-bold text-sm text-[#1F1638] dark:text-white leading-snug">
                      {t.customerName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#7D7484] dark:text-[#A79BC0] mt-0.5">
                      {t.customerPhone && (
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3" />
                          {t.customerPhone}
                        </span>
                      )}
                      <span>·</span>
                      <span className="truncate">
                        {t.fatCode || t.clusterName || t.area || '-'}
                      </span>
                    </div>
                  </div>

                  {/* Inner Tinted Specs Box */}
                  <div className="p-3 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#7D7484] dark:text-[#A79BC0]">Kategori:</span>
                      <strong className="text-[#1F1638] dark:text-white text-right truncate">
                        {t.ticketCategory || '-'}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#7D7484] dark:text-[#A79BC0]">Jadwal / Slot:</span>
                      <strong className="text-[#1F1638] dark:text-white font-mono text-[11px] tabular-nums">
                        {formatAppointmentDateDisplay(t.appointmentDate)} · {t.slotTime || '-'}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E8DDFF] dark:border-[#35105E]">
                      <span className="text-[#7D7484] dark:text-[#A79BC0]">Teknisi Saat Ini:</span>
                      <div className="text-right">
                        <strong className="text-[#1F1638] dark:text-white block">
                          {t.installerName || 'Belum Ditugaskan'}
                        </strong>
                        {techInfo && (
                          <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-white dark:bg-[#261942] border border-[#E8DDFF] dark:border-[#4B386B] font-mono text-[10px] font-bold text-[#58149C] dark:text-[#DAB9FF] tabular-nums">
                            Beban {techInfo.assignedCount}/{techInfo.maxLimit} WO
                          </span>
                        )}
                      </div>
                    </div>

                    {t.remarksWOInstaller?.trim() && (
                      <div className="flex items-start gap-1.5 text-[11px] text-[#B45309] dark:text-amber-300 font-semibold pt-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{t.remarksWOInstaller}</span>
                      </div>
                    )}

                    {t.checkInAt && (
                      <div className="text-[10.5px] font-mono text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-between pt-0.5">
                        <span>Sesi Kerja: {workStat.status}</span>
                        <span>Check-in {formatJakartaTimeOnly(t.checkInAt)}</span>
                      </div>
                    )}
                  </div>

                  {/* Full-Width CTA */}
                  <div className="flex items-center gap-2">
                    {eligible ? (
                      <button
                        type="button"
                        disabled={!isLeaderRole}
                        onClick={() => onOpenReassignModal(t)}
                        className="btn-3d-primary flex-1 min-h-[44px] px-4 py-2.5 rounded-xl font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-2 disabled:opacity-45 cursor-pointer"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                        <span>Reassign WO</span>
                      </button>
                    ) : !t.installerName ? (
                      <button
                        type="button"
                        onClick={onJumpToAssignTab}
                        className="btn-3d-secondary flex-1 min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <UserCheck className="w-4 h-4 text-[#58149C]" />
                        <span>Tugaskan di Assign WO</span>
                      </button>
                    ) : (
                      <div className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-[#F3EAFF] dark:bg-[#261942] text-[11px] font-bold text-[#7D7484] dark:text-[#CEC0E8] flex items-center justify-center">
                        WO Selesai / Terkunci
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectTicket(t)}
                      aria-label={`Detail ${t.woNumber}`}
                      className="btn-3d-secondary min-w-[44px] min-h-[44px] px-3 rounded-xl flex items-center justify-center cursor-pointer"
                    >
                      <Eye className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] overflow-hidden">
            <PaginationBar
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={filteredTickets.length}
              pageSize={rowsPerPage}
              pageSizeOptions={[6, 12, 24]}
              onPageChange={setCurrentPage}
              onPageSizeChange={val => {
                setRowsPerPage(val === 'ALL' ? filteredTickets.length || 6 : val);
                setCurrentPage(1);
              }}
              itemLabel="Work Order"
            />
          </div>
        </div>
      ) : (
        /* ============================================================ */
        /* 3B. DESKTOP MODE: 7-COLUMN DENSE HIGH-EFFICIENCY TABLE       */
        /* ============================================================ */
        <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] shadow-[0_3px_14px_rgba(31,22,56,0.05)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#F8F1FF] dark:bg-[#160D29] border-b border-[#E8DDFF] dark:border-[#35105E] text-[10.5px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                <tr>
                  <th className="py-3 px-4 min-w-[140px]">WO Number</th>
                  <th className="py-3 px-4 min-w-[200px]">Customer Details</th>
                  <th className="py-3 px-4 min-w-[140px]">Category</th>
                  <th className="py-3 px-4 min-w-[155px]">Appointment &amp; Slot</th>
                  <th className="py-3 px-4 min-w-[190px]">Current Staff &amp; Load</th>
                  <th className="py-3 px-4 min-w-[130px]">Status</th>
                  <th className="py-3 px-4 text-right min-w-[150px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAFF] dark:divide-[#2E1859]">
                {paginatedTickets.map(t => {
                  const badge = getReassignBadge(t);
                  const eligible = isTicketEligibleForReassign(t);
                  const techInfo = t.installerName
                    ? techMap.get(t.installerName.toLowerCase().trim())
                    : undefined;
                  const workStat = getTicketWorkStatus(t);
                  const reassignCount = (t.assignmentHistory || []).filter(
                    h => h.sourceAction === 'reassign'
                  ).length;

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-[#F8F1FF]/60 dark:hover:bg-[#261942]/70 transition-colors"
                    >
                      {/* 1. WO NUMBER */}
                      <td className="py-3 px-4 align-top">
                        <button
                          type="button"
                          onClick={() => onSelectTicket(t)}
                          className="font-mono font-extrabold text-[#58149C] dark:text-[#DAB9FF] hover:underline text-left block cursor-pointer"
                        >
                          {t.woNumber}
                        </button>
                        <div className="text-[10.5px] font-mono text-[#7D7484] dark:text-[#A79BC0] mt-0.5">
                          {t.fatCode || t.fdtCode || t.idCustomer || '-'}
                        </div>
                        {reassignCount > 0 && (
                          <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] font-mono text-[9.5px] font-bold">
                            <History className="w-2.5 h-2.5" />
                            {reassignCount}x dialihkan
                          </span>
                        )}
                      </td>

                      {/* 2. CUSTOMER DETAILS */}
                      <td className="py-3 px-4 align-top">
                        <div className="font-bold text-[#1F1638] dark:text-white">
                          {t.customerName}
                        </div>
                        <div className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] line-clamp-1 mt-0.5">
                          {t.clusterName || t.streetName || t.area || '-'}
                        </div>
                        {t.customerPhone && (
                          <div className="inline-flex items-center gap-1 font-mono text-[10.5px] text-[#58149C] dark:text-[#DAB9FF] mt-0.5">
                            <Phone className="w-3 h-3" />
                            <span>{t.customerPhone}</span>
                          </div>
                        )}
                      </td>

                      {/* 3. CATEGORY */}
                      <td className="py-3 px-4 align-top">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F3EAFF] dark:bg-[#2C1A4E] text-[#58149C] dark:text-[#DAB9FF] font-bold text-[11px]">
                          <Wrench className="w-3 h-3 shrink-0" />
                          <span>{t.ticketCategory || '-'}</span>
                        </span>
                        {(t.ontModel || t.fdtCode) && (
                          <div className="text-[10.5px] text-[#7D7484] dark:text-[#A79BC0] mt-1 font-mono truncate max-w-[170px]">
                            {t.ontModel || `FDT ${t.fdtCode}`}
                          </div>
                        )}
                      </td>

                      {/* 4. APPOINTMENT & SLOT */}
                      <td className="py-3 px-4 align-top">
                        <div className="font-semibold text-[#1F1638] dark:text-white font-mono text-[11px] tabular-nums">
                          {formatAppointmentDateDisplay(t.appointmentDate)}
                        </div>
                        <div className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] font-mono tabular-nums mt-0.5">
                          {t.slotTime || '-'}
                        </div>
                        <div
                          className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${
                            t.checkInAt
                              ? 'text-[#15803D] dark:text-emerald-300'
                              : 'text-[#7D7484] dark:text-[#A79BC0]'
                          }`}
                        >
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>
                            {t.checkInAt
                              ? `Check-in ${formatJakartaTimeOnly(t.checkInAt)}`
                              : workStat.status}
                          </span>
                        </div>
                      </td>

                      {/* 5. CURRENT STAFF & LOAD */}
                      <td className="py-3 px-4 align-top">
                        {t.installerName ? (
                          <div className="flex items-start gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] font-display font-extrabold text-[11px] flex items-center justify-center shrink-0">
                              {getInitials(t.installerName)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-[#1F1638] dark:text-white truncate">
                                {t.installerName}
                              </div>
                              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                {techInfo && (
                                  <span
                                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold tabular-nums ${
                                      techInfo.isFull
                                        ? 'bg-[#FFDAD6] dark:bg-rose-950/60 text-[#93000A] dark:text-rose-300'
                                        : 'bg-[#F3EAFF] dark:bg-[#2C1A4E] text-[#58149C] dark:text-[#DAB9FF]'
                                    }`}
                                  >
                                    Beban {techInfo.assignedCount}/{techInfo.maxLimit} Tiket
                                  </span>
                                )}
                                {t.remarksWOInstaller?.trim() && (
                                  <span
                                    title={t.remarksWOInstaller}
                                    className="px-2 py-0.5 rounded-md bg-[#FEF3C7] dark:bg-amber-950/60 text-[#B45309] dark:text-amber-300 text-[10px] font-bold truncate max-w-[140px]"
                                  >
                                    {t.remarksWOInstaller}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FEF3C7] dark:bg-amber-950/60 text-[#B45309] dark:text-amber-300 font-bold text-[11px]">
                            Belum Ditugaskan
                          </span>
                        )}
                      </td>

                      {/* 6. STATUS */}
                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-extrabold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>

                      {/* 7. ACTION */}
                      <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectTicket(t)}
                            title="Lihat 17-Section Fullview"
                            className="btn-3d-secondary p-2 rounded-xl text-[#58149C] dark:text-[#DAB9FF] cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {eligible ? (
                            <button
                              type="button"
                              disabled={!isLeaderRole}
                              onClick={() => onOpenReassignModal(t)}
                              className="btn-3d-primary px-3.5 py-1.5 rounded-xl font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-45 cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              <span>Reassign</span>
                            </button>
                          ) : !t.installerName ? (
                            <button
                              type="button"
                              onClick={onJumpToAssignTab}
                              className="btn-3d-secondary px-3 py-1.5 rounded-xl font-bold text-xs cursor-pointer"
                            >
                              Assign WO
                            </button>
                          ) : (
                            <span className="text-[10.5px] font-semibold text-[#7D7484] dark:text-[#A79BC0] px-2">
                              Terkunci
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PaginationBar
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={filteredTickets.length}
            pageSize={rowsPerPage}
            pageSizeOptions={[10, 25, 50]}
            onPageChange={setCurrentPage}
            onPageSizeChange={val => {
              setRowsPerPage(val === 'ALL' ? filteredTickets.length || 10 : val);
              setCurrentPage(1);
            }}
            itemLabel="Work Order"
          />
        </div>
      )}
    </div>
  );
};
