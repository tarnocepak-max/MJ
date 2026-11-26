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
  Copy,
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
import { formatAppointmentDateDisplay, getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { getTicketWorkStatus, formatJakartaTimeOnly } from '../../services/workSessionService';
import {
  HeaderCategoryDropdown,
  HeaderDateSortFilterPopover,
  HeaderSearchPopover,
  TableResetFilterButton
} from '../common/InteractiveTableHeader';
import {
  SortState,
  getNextSortDirection,
  sortDataArray
} from '../../utils/tableSorting';
import { ActionDropdownMenu, DropdownActionItem } from '../common/ActionDropdownMenu';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';

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
      cls: 'bg-[#FFF2D9] dark:bg-amber-950/60 border border-[#F2CF95] dark:border-amber-700 text-[#9D661F] dark:text-amber-300'
    };
  }
  if (isTicketCompletedOrClosed(t)) {
    return {
      label: (t.statusWOInstaller || 'COMPLETED').toUpperCase(),
      tone: 'done',
      cls: 'bg-[#E4F5EC] dark:bg-emerald-950/60 border border-[#B7E4CC] dark:border-emerald-700 text-[#218A63] dark:text-emerald-300'
    };
  }
  if (t.statusWOInstaller === 'Pending Technical' || t.statusWOInstaller === 'Failed / Cancelled') {
    return {
      label: t.statusWOInstaller.toUpperCase(),
      tone: 'problem',
      cls: 'bg-[#FCE9EB] dark:bg-rose-950/60 border border-[#F3C5CA] dark:border-rose-800 text-[#9B2C37] dark:text-rose-300'
    };
  }
  if (t.statusWOInstaller === 'On Site' || t.statusWOInstaller === 'En Route' || t.statusWOAgent === 'In Progress') {
    return {
      label: (t.statusWOInstaller || 'IN PROGRESS').toUpperCase(),
      tone: 'active',
      cls: 'bg-[#DDF4F4] dark:bg-[#2E1B59] border border-[#BDE4E8] dark:border-[#5B35B1] text-[#2E7D8B] dark:text-[#DAB9FF]'
    };
  }
  return {
    label: (t.statusWOInstaller || 'ASSIGNED').toUpperCase(),
    tone: 'waiting',
    cls: 'bg-[#EAE8FF] dark:bg-[#2E1B59] border border-[#DCE3F2] dark:border-[#5B35B1] text-[#5145A6] dark:text-[#DAB9FF]'
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
  const [woSearch, setWoSearch] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<ReassignStatusFilter>('eligible');
  const [slotFilter, setSlotFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [installerFilter, setInstallerFilter] = useState<string>('ALL');
  const [exactDateFilter, setExactDateFilter] = useState<string>('');
  const [dateFromFilter, setDateFromFilter] = useState<string>('');
  const [dateToFilter, setDateToFilter] = useState<string>('');
  const [sortState, setSortState] = useState<SortState>({ column: null, direction: null });
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

  const assignedTodayTickets = useMemo(
    () => todayTickets.filter(t => Boolean(t.installerName && t.installerName.trim())),
    [todayTickets]
  );

  const reassignedTodayCount = useMemo(() => {
    const uniqueWo = new Set<string>();
    auditFeed.forEach(item => {
      const ts = String(item.timestamp || item.createdAt || '');
      if (!ts || ts.slice(0, 10) === todayWIB) {
        if (item.woNumber || item.ticketId) uniqueWo.add(item.woNumber || item.ticketId || '');
      }
    });
    assignedTodayTickets.forEach(t => {
      if (t.reassignedAt && t.reassignedAt.slice(0, 10) === todayWIB) {
        uniqueWo.add(t.woNumber || t.id);
      }
    });
    return uniqueWo.size;
  }, [auditFeed, assignedTodayTickets, todayWIB]);

  const eligibleCount = useMemo(
    () => assignedTodayTickets.filter(isTicketEligibleForReassign).length,
    [assignedTodayTickets]
  );

  const problemCount = useMemo(
    () => assignedTodayTickets.filter(t => isTicketEligibleForReassign(t) && isTicketProblematic(t)).length,
    [assignedTodayTickets]
  );

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assignedTodayTickets.filter(t => {
      // Status filter (strictly assigned WOs only)
      if (statusFilter === 'eligible' && !isTicketEligibleForReassign(t)) return false;
      if (statusFilter === 'problem' && (!isTicketEligibleForReassign(t) || !isTicketProblematic(t))) return false;
      if (
        statusFilter === 'in_progress' &&
        (t.statusWOInstaller !== 'On Site' &&
          t.statusWOInstaller !== 'En Route' &&
          t.statusWOAgent !== 'In Progress')
      ) {
        return false;
      }
      if (
        statusFilter === 'waiting' &&
        (isTicketCompletedOrClosed(t) ||
          t.statusWOInstaller === 'On Site' ||
          t.statusWOInstaller === 'En Route')
      ) {
        return false;
      }
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

      // Column header specific search & date filters
      if (woSearch.trim()) {
        const hay = `${t.woNumber || ''} ${t.fatCode || ''} ${t.fdtCode || ''} ${t.idCustomer || ''}`.toLowerCase();
        if (!hay.includes(woSearch.trim().toLowerCase())) return false;
      }
      if (customerSearch.trim()) {
        const hay = `${t.customerName || ''} ${t.customerPhone || ''} ${t.area || ''} ${t.clusterName || ''} ${t.streetName || ''}`.toLowerCase();
        if (!hay.includes(customerSearch.trim().toLowerCase())) return false;
      }
      if (exactDateFilter || dateFromFilter || dateToFilter) {
        const appt = getTicketAppointmentDate(t) || '';
        if (!appt) return false;
        if (exactDateFilter && appt !== exactDateFilter) return false;
        if (dateFromFilter && appt < dateFromFilter) return false;
        if (dateToFilter && appt > dateToFilter) return false;
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
  }, [
    assignedTodayTickets,
    statusFilter,
    slotFilter,
    categoryFilter,
    installerFilter,
    woSearch,
    customerSearch,
    exactDateFilter,
    dateFromFilter,
    dateToFilter,
    searchQuery
  ]);

  const handleSort = (columnKey: string) => {
    setSortState(prev => {
      const nextDir = getNextSortDirection(prev.column, prev.direction, columnKey);
      return {
        column: nextDir ? columnKey : null,
        direction: nextDir
      };
    });
    setCurrentPage(1);
  };

  const sortedTickets = useMemo(() => {
    if (!sortState.column || !sortState.direction) return filteredTickets;
    return sortDataArray(filteredTickets, sortState, (t: Ticket, col: string) => {
      switch (col) {
        case 'woNumber':
          return t.woNumber || '';
        case 'customerName':
          return t.customerName || '';
        case 'ticketCategory':
          return t.ticketCategory || '';
        case 'appointmentDate':
          return getTicketAppointmentDate(t) || t.appointmentDate || '';
        case 'installerName':
          return t.installerName || '';
        case 'status':
          return getReassignBadge(t).label;
        default:
          return (t as any)[col] || '';
      }
    });
  }, [filteredTickets, sortState]);

  const totalPages = Math.max(1, Math.ceil(sortedTickets.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTickets = useMemo(() => {
    const start = (safePage - 1) * rowsPerPage;
    return sortedTickets.slice(start, start + rowsPerPage);
  }, [sortedTickets, safePage, rowsPerPage]);

  const [previewTicketId, setPreviewTicketId] = useState<string>('');

  const selectedPreviewTicket = useMemo(() => {
    if (paginatedTickets.length === 0) return null;
    return (
      paginatedTickets.find(t => t.id === previewTicketId) ||
      paginatedTickets.find(isTicketEligibleForReassign) ||
      paginatedTickets[0]
    );
  }, [paginatedTickets, previewTicketId]);

  const basecampReserveTechs = useMemo(() => {
    return [...technicians]
      .filter(s => !s.isFull)
      .sort((a, b) => a.assignedCount - b.assignedCount)
      .slice(0, 5);
  }, [technicians]);

  const recommendedReplacementForPreview = useMemo(() => {
    if (!selectedPreviewTicket) return null;
    const orig = String(selectedPreviewTicket.installerName || '').trim().toLowerCase();
    return (
      basecampReserveTechs.find(s => s.installer.name.trim().toLowerCase() !== orig) ||
      basecampReserveTechs[0] ||
      null
    );
  }, [selectedPreviewTicket, basecampReserveTechs]);

  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (woSearch.trim() ? 1 : 0) +
    (customerSearch.trim() ? 1 : 0) +
    (statusFilter !== 'eligible' ? 1 : 0) +
    (slotFilter !== 'ALL' ? 1 : 0) +
    (categoryFilter !== 'ALL' ? 1 : 0) +
    (installerFilter !== 'ALL' ? 1 : 0) +
    (exactDateFilter ? 1 : 0) +
    (dateFromFilter || dateToFilter ? 1 : 0);
  const hasActiveCustomFilter = activeFilterCount > 0;

  const handleResetFilters = () => {
    setSearchQuery('');
    setWoSearch('');
    setCustomerSearch('');
    setStatusFilter('eligible');
    setSlotFilter('ALL');
    setCategoryFilter('ALL');
    setInstallerFilter('ALL');
    setExactDateFilter('');
    setDateFromFilter('');
    setDateToFilter('');
    setSortState({ column: null, direction: null });
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
      all: 'Semua WO Ditugaskan',
      eligible: 'Aktif / Siap Reassign',
      problem: 'Kendala / Pending',
      in_progress: 'Sedang Dikerjakan',
      waiting: 'Menunggu Pengerjaan',
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
              <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#2E7D8B] dark:text-[#DAB9FF]">
                <span>{displayContractor}</span>
                <span>·</span>
                <span>{displayArea}</span>
              </div>
              <h2
                className="text-xl font-extrabold text-[#26364A] dark:text-white tracking-tight mt-0.5"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Reassign WO
              </h2>
              <p className="text-[11.5px] text-[#8492A5] dark:text-[#CEC0E8]">
                Kelola &amp; redistribusi penugasan tim ({todayAppointmentDisplay})
              </p>
            </div>

            <button
              type="button"
              disabled={!isLeaderRole || eligibleCount === 0}
              onClick={onOpenBulkReassign}
              title="Bulk Reassign WO"
              className="w-11 h-11 rounded-2xl bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DCE3F2] dark:border-[#5B35B1] flex items-center justify-center shrink-0 disabled:opacity-45 cursor-pointer"
            >
              <ArrowRightLeft className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile Horizontal Metrics Strip */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            <div className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#3E246F] text-[11px] font-bold text-[#26364A] dark:text-white whitespace-nowrap shrink-0 tabular-nums">
              Total <span className="text-[#5145A6] dark:text-[#DAB9FF] ml-0.5">{summaryMetrics.total}</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#3E246F] text-[11px] font-bold text-[#26364A] dark:text-white whitespace-nowrap shrink-0 tabular-nums flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#6657C8]" />
              Assigned <span>{summaryMetrics.assigned}</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#3E246F] text-[11px] font-bold text-[#26364A] dark:text-white whitespace-nowrap shrink-0 tabular-nums flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#218A63] dark:bg-[#16A36A]" />
              Reassigned <span>{reassignedTodayCount}</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#3E246F] text-[11px] font-bold text-[#26364A] dark:text-white whitespace-nowrap shrink-0 tabular-nums flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#D97706]" />
              Kendala <span>{problemCount}</span>
            </div>
          </div>

          {/* Mobile Compact Header Trigger Popovers (Zero external input box) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <HeaderSearchPopover
              label="WO / Pelanggan"
              value={searchQuery}
              onChange={val => {
                setSearchQuery(val);
                setCurrentPage(1);
              }}
              placeholder="Cari WO, pelanggan, atau teknisi..."
              sortActive={sortState.column === 'woNumber'}
              sortDir={sortState.column === 'woNumber' ? sortState.direction : null}
              onCycleSort={() => handleSort('woNumber')}
            />
            <HeaderCategoryDropdown
              label="Teknisi"
              value={installerFilter}
              defaultValue="ALL"
              allLabel="Semua Teknisi"
              options={[
                { value: 'ALL', label: 'Semua Teknisi' },
                ...installers.map(inst => ({ value: inst.name, label: inst.name }))
              ]}
              onChange={val => {
                setInstallerFilter(val);
                setCurrentPage(1);
              }}
            />
            <HeaderCategoryDropdown
              label="Slot"
              value={slotFilter}
              defaultValue="ALL"
              allLabel="Semua Slot"
              options={[
                { value: 'ALL', label: 'Semua Slot Waktu' },
                { value: '09:00', label: 'Slot 1 (09:00 - 11:00)' },
                { value: '11:00', label: 'Slot 2 (11:00 - 13:00)' },
                { value: '13:00', label: 'Slot 3 (13:00 - 15:00)' },
                { value: '15:00', label: 'Slot 4 (15:00 - 17:00)' }
              ]}
              onChange={val => {
                setSlotFilter(val);
                setCurrentPage(1);
              }}
            />
            <TableResetFilterButton
              activeCount={activeFilterCount}
              onReset={handleResetFilters}
              label="Reset Search/Filter"
              testId="leader-reassign-mobile-reset"
            />
          </div>

          {/* Mobile Quick Filter Chips */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {[
              { id: 'eligible' as const, label: 'Siap Reassign', count: eligibleCount },
              { id: 'problem' as const, label: 'Kendala Lapangan', count: problemCount, dot: 'bg-[#D97706]' },
              { id: 'reassigned' as const, label: 'Sudah Dialihkan', count: reassignedTodayCount },
              { id: 'all' as const, label: 'Semua WO', count: assignedTodayTickets.length }
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
                  className={`px-3.5 py-2 rounded-full text-xs whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    active
                      ? 'mj-btn-leader-secondary mj-btn-xs'
                      : 'mj-btn-leader-neutral mj-btn-xs'
                  }`}
                >
                  {chip.dot && <span className={`w-2 h-2 rounded-full ${chip.dot}`} />}
                  <span>{chip.label}</span>
                  <span className={`font-mono text-[10.5px] ${active ? 'text-[#5145A6] dark:text-[#EEDBFF]' : 'text-[#8492A5] dark:text-[#7D7484]'}`}>
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
                <span className="px-2.5 py-0.5 rounded-md bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] text-[10.5px] font-extrabold uppercase tracking-wider">
                  CLUSTER DISPATCH CONTROL
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#218A63] dark:text-emerald-300">
                  <RefreshCw className={`w-3 h-3 ${syncStatus === 'SYNCING' ? 'animate-spin' : ''}`} />
                  <span>
                    {databaseStatus === 'connected' ? 'Live Sync Active' : 'Mode Offline'} · {todayAppointmentDisplay}
                  </span>
                </span>
              </div>

              <h2
                className="text-2xl font-extrabold text-[#26364A] dark:text-white tracking-tight"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Reassign WO
              </h2>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                Kelola dan alihkan penugasan Work Order untuk <strong className="text-[#26364A] dark:text-white">{displayContractor}</strong> ({displayArea}) tanpa menghilangkan riwayat kerja teknisi.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenAuditTrail}
                className="mj-btn-leader-neutral px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <History className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                <span>Riwayat Audit ({auditFeed.length})</span>
              </button>

              <button
                type="button"
                onClick={onExportExcel}
                className="mj-btn-leader-neutral px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                <span>Ekspor Data</span>
              </button>

              <button
                type="button"
                disabled={!isLeaderRole || eligibleCount === 0}
                onClick={onOpenBulkReassign}
                className="mj-btn-leader-primary px-4 py-2 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
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
              className="text-left bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(38,54,74,0.04)] hover:border-[#6657C8] dark:hover:border-[#58149C] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                  Total Work Orders
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#EAE8FF] dark:bg-[#2C1A4E] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center">
                  <ClipboardList className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-[#26364A] dark:text-white font-display tabular-nums">
                  {summaryMetrics.total}
                </span>
                <span className="text-xs font-semibold text-[#8492A5] dark:text-[#A79BC0]">Tiket</span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between text-[11px]">
                <span className="text-[#218A63] dark:text-emerald-300 font-semibold">
                  {eligibleCount} siap reassign
                </span>
                <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF]">Hari Ini</span>
              </div>
            </button>

            {/* KPI 2: Kendala / Pending Reassign */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter('problem');
                setCurrentPage(1);
              }}
              className="text-left bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(38,54,74,0.04)] hover:border-[#D97706] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                  Kendala / Pending
                </span>
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    problemCount > 0
                      ? 'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-300'
                      : 'bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#218A63] dark:text-emerald-300'
                  }`}
                >
                  {problemCount > 0 ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span
                  className={`text-2xl font-extrabold font-display tabular-nums ${
                    problemCount > 0
                      ? 'text-[#9D661F] dark:text-amber-300'
                      : 'text-[#218A63] dark:text-emerald-300'
                  }`}
                >
                  {problemCount}
                </span>
                <span className="text-xs font-semibold text-[#8492A5] dark:text-[#A79BC0]">
                  {problemCount > 0 ? 'Tiket' : 'Lancar'}
                </span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between text-[11px]">
                <span className="text-[#52647A] dark:text-[#CEC0E8] font-medium">
                  {problemCount > 0 ? 'Perlu evaluasi alih teknisi' : 'Tidak ada kendala lapangan'}
                </span>
                <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                  Filter
                </span>
              </div>
            </button>

            {/* KPI 3: WO In Field (Active) */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter('eligible');
                setCurrentPage(1);
              }}
              className="text-left bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(38,54,74,0.04)] hover:border-[#6657C8] dark:hover:border-[#6A46C1] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                  WO In Field (Active)
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#DDF4F4] dark:bg-[#35105E] text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-center">
                  <Users2 className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-[#5145A6] dark:text-[#DAB9FF] font-display tabular-nums">
                  {summaryMetrics.assigned}
                </span>
                <span className="text-xs font-semibold text-[#8492A5] dark:text-[#A79BC0]">
                  / {totalMaxSlots} Slot
                </span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between text-[11px]">
                <span className="text-[#52647A] dark:text-[#CEC0E8] font-medium">
                  {summaryMetrics.activeInstallers} Teknisi Aktif
                </span>
                <span className="font-bold font-mono text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
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
              className="text-left bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(38,54,74,0.04)] hover:border-[#6657C8] dark:hover:border-[#58149C] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                  WO Reassigned
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#EAE8FF] dark:bg-[#2C1A4E] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center">
                  <ArrowRightLeft className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-[#26364A] dark:text-white font-display tabular-nums">
                  {reassignedTodayCount}
                </span>
                <span className="text-xs font-semibold text-[#8492A5] dark:text-[#A79BC0]">Tiket Hari Ini</span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between text-[11px]">
                <span className="text-[#52647A] dark:text-[#CEC0E8] truncate">
                  {latestReassignEntry
                    ? `Terakhir: ${latestReassignEntry.woNumber || '-'}`
                    : 'Belum ada alihan hari ini'}
                </span>
                <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
                  Audit Log
                </span>
              </div>
            </button>
          </div>

          {/* COMPACT STATUS & RESET BAR (Filters embedded directly in Table Headers) */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[#52647A] dark:text-[#CEC0E8] tabular-nums font-semibold">
                {sortedTickets.length} dari {assignedTodayTickets.length} WO ({todayAppointmentDisplay})
              </span>
              {problemCount > 0 && statusFilter !== 'problem' && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('problem');
                    setCurrentPage(1);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-300 border border-[#F2CF95] dark:border-amber-800 font-bold cursor-pointer"
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Kendala / Catatan ({problemCount})</span>
                </button>
              )}
            </div>
            <TableResetFilterButton
              activeCount={activeFilterCount}
              onReset={handleResetFilters}
              label="Reset Search/Filter"
              testId="leader-reassign-reset-filters"
            />
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/* 2. MAIN CONTENT: EMPTY STATE OR TABLE (DESKTOP) / CARDS (MOBILE) */}
      {/* ============================================================ */}
      {filteredTickets.length === 0 ? (
        <div className="bg-white dark:bg-[#1E1238] rounded-3xl border border-[#DDE6F0] dark:border-[#3E246F] p-6 sm:p-10 shadow-[0_4px_18px_rgba(38,54,74,0.05)] space-y-6">
          <div className="max-w-xl mx-auto text-center space-y-4">
            <div className="relative inline-flex items-center justify-center">
              <div className="w-20 h-20 rounded-3xl bg-[#EAE8FF] dark:bg-[#2C1A4E] border border-[#DCE3F2] dark:border-[#4B386B] flex items-center justify-center text-[#5145A6] dark:text-[#DAB9FF] shadow-inner">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <span className="absolute -bottom-2 px-2.5 py-0.5 rounded-full bg-[#6657C8] dark:bg-[#58149C] text-white font-mono text-[10px] font-extrabold shadow-sm">
                0 ANTREAN
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              <h3
                className="text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {hasActiveCustomFilter
                  ? 'Tidak Ada Work Order yang Cocok'
                  : 'Tidak Ada Work Order yang Memerlukan Reassign'}
              </h3>
              <p className="text-xs sm:text-sm text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                {hasActiveCustomFilter
                  ? 'Tidak ditemukan Work Order dalam cakupan Anda yang sesuai dengan kombinasi filter atau kata kunci pencarian saat ini.'
                  : `Semua Work Order dalam tanggung jawab ${displayContractor} (${displayArea}) berjalan sesuai penjadwalan atau telah diselesaikan.`}
              </p>
            </div>

            {activeFilterTags.length > 0 && (
              <div className="inline-flex flex-wrap items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[11px]">
                <Info className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                <span className="font-semibold text-[#52647A] dark:text-[#CEC0E8]">Kriteria aktif:</span>
                {activeFilterTags.map(tag => (
                  <span
                    key={tag.key}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-[#261942] font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF]"
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
                  className="mj-btn-leader-primary px-5 py-2.5 text-xs font-extrabold flex items-center gap-2 cursor-pointer"
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Reset Semua Filter</span>
                </button>
              )}

              <button
                type="button"
                disabled={isRefreshing}
                onClick={handleTriggerRefresh}
                className={`mj-btn-leader-neutral px-5 py-2.5 text-xs flex items-center gap-2 cursor-pointer ${
                  isRefreshing ? 'mj-btn-loading' : ''
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>{isRefreshing ? 'Menyegarkan...' : 'Segarkan Data WO'}</span>
              </button>
            </div>
          </div>

          {/* 3 Real Quick-Glance Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
            <div className="p-3.5 rounded-2xl bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#261942] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0 shadow-xs">
                <Activity className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#A79BC0]">
                  Utilisasi Kuota Tim
                </div>
                <div className="font-bold text-xs text-[#26364A] dark:text-white font-mono tabular-nums mt-0.5">
                  {quotaUtilizationPct}% ({summaryMetrics.assigned}/{totalMaxSlots} Slot)
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#261942] text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-center shrink-0 shadow-xs">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#A79BC0]">
                  Distribusi Wilayah
                </div>
                <div className="font-bold text-xs text-[#26364A] dark:text-white truncate mt-0.5">
                  {clusterOptions.length || 1} Cluster · {displayArea}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#261942] text-[#218A63] dark:text-emerald-300 flex items-center justify-center shrink-0 shadow-xs">
                <UserCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#A79BC0]">
                  Status Tim Lapangan
                </div>
                <div className="font-bold text-xs text-[#218A63] dark:text-emerald-300 font-mono tabular-nums mt-0.5">
                  {summaryMetrics.activeInstallers} Aktif · {summaryMetrics.idleInstallers} Siaga
                </div>
              </div>
            </div>
          </div>

          {/* Leader Tips Banner */}
          <div className="p-3.5 rounded-2xl bg-[#EAE8FF] dark:bg-[#261942] border border-[#DCE3F2] dark:border-[#4B386B] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                <Lightbulb className="w-4 h-4" />
              </div>
              <p className="text-[11.5px] text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                <strong className="text-[#5145A6] dark:text-[#DAB9FF]">Tips Leader:</strong> Pantau tab{' '}
                <button
                  type="button"
                  onClick={onJumpToProgressTab}
                  className="font-bold underline text-[#5145A6] dark:text-[#DAB9FF] cursor-pointer"
                >
                  Progress Live
                </button>{' '}
                untuk melihat Check-in lapangan atau kendala teknis secara real-time sebelum memutuskan pengalihan tugas teknisi.
              </p>
            </div>
            <button
              type="button"
              onClick={onJumpToProgressTab}
              className="text-xs font-extrabold text-[#5145A6] dark:text-[#DAB9FF] flex items-center gap-1 whitespace-nowrap shrink-0 hover:underline cursor-pointer"
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
                  ? 'border-[#F2CF95] dark:border-amber-700'
                  : badge.tone === 'unassigned'
                  ? 'border-[#F3C5CA] dark:border-rose-800'
                  : 'border-[#DDE6F0] dark:border-[#3E246F]';

              return (
                <article
                  key={t.id}
                  className={`bg-white dark:bg-[#1E1238] rounded-2xl border p-4 shadow-[0_3px_12px_rgba(38,54,74,0.05)] space-y-3 ${accentClass}`}
                >
                  {/* Card Top Row */}
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectTicket(t)}
                      className="inline-flex items-center gap-1.5 font-mono text-xs font-extrabold text-[#5145A6] dark:text-[#DAB9FF] hover:underline cursor-pointer"
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
                    <h3 className="font-bold text-sm text-[#26364A] dark:text-white leading-snug">
                      {t.customerName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#8492A5] dark:text-[#A79BC0] mt-0.5">
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
                  <div className="p-3 rounded-xl bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#8492A5] dark:text-[#A79BC0]">Kategori:</span>
                      <strong className="text-[#26364A] dark:text-white text-right truncate">
                        {t.ticketCategory || '-'}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#8492A5] dark:text-[#A79BC0]">Jadwal / Slot:</span>
                      <strong className="text-[#26364A] dark:text-white font-mono text-[11px] tabular-nums">
                        {formatAppointmentDateDisplay(t.appointmentDate)} · {t.slotTime || '-'}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#DDE6F0] dark:border-[#35105E]">
                      <span className="text-[#8492A5] dark:text-[#A79BC0]">Teknisi Saat Ini:</span>
                      <div className="text-right">
                        <strong className="text-[#26364A] dark:text-white block">
                          {t.installerName || 'Belum Ditugaskan'}
                        </strong>
                        {techInfo && (
                          <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-white dark:bg-[#261942] border border-[#DCE3F2] dark:border-[#4B386B] font-mono text-[10px] font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                            Beban {techInfo.assignedCount}/{techInfo.maxLimit} WO
                          </span>
                        )}
                      </div>
                    </div>

                    {t.remarksWOInstaller?.trim() && (
                      <div className="flex items-start gap-1.5 text-[11px] text-[#9D661F] dark:text-amber-300 font-semibold pt-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{t.remarksWOInstaller}</span>
                      </div>
                    )}

                    {t.checkInAt && (
                      <div className="text-[10.5px] font-mono text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-between pt-0.5">
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
                        className="mj-btn-leader-primary flex-1 min-h-[44px] px-4 py-2.5 font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                        <span>Reassign WO</span>
                      </button>
                    ) : (
                      <div className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-[#EDF3F8] dark:bg-[#261942] text-[11px] font-bold text-[#8492A5] dark:text-[#CEC0E8] flex items-center justify-center">
                        WO Selesai / Terkunci
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectTicket(t)}
                      aria-label={`Detail ${t.woNumber}`}
                      className="mj-btn-icon-3d-leader min-w-[44px] min-h-[44px] px-3 flex items-center justify-center cursor-pointer"
                    >
                      <Eye className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] overflow-hidden">
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
        /* 3B. DESKTOP MODE: SPLIT TABLE (8 COL) + SNAPSHOT PANEL (4 COL)*/
        /* ============================================================ */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          <div className="xl:col-span-8 min-w-0 bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] shadow-[0_3px_14px_rgba(38,54,74,0.05)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse mj-zebra-table">
                <thead className="bg-[#EDF3F8] dark:bg-[#160D29] border-b border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#A79BC0]">
                  <tr>
                    <th className="py-3 px-4 min-w-[140px]">
                      <HeaderSearchPopover
                        label="WO Number"
                        value={woSearch}
                        onChange={val => {
                          setWoSearch(val);
                          setCurrentPage(1);
                        }}
                        placeholder="Cari WO / FAT / ID..."
                        sortActive={sortState.column === 'woNumber'}
                        sortDir={sortState.column === 'woNumber' ? sortState.direction : null}
                        onCycleSort={() => handleSort('woNumber')}
                      />
                    </th>
                    <th className="py-3 px-4 min-w-[185px]">
                      <HeaderSearchPopover
                        label="Customer Details"
                        value={customerSearch}
                        onChange={val => {
                          setCustomerSearch(val);
                          setCurrentPage(1);
                        }}
                        placeholder="Cari Pelanggan / Area / Alamat..."
                        sortActive={sortState.column === 'customerName'}
                        sortDir={sortState.column === 'customerName' ? sortState.direction : null}
                        onCycleSort={() => handleSort('customerName')}
                      />
                    </th>
                    <th className="py-3 px-4 min-w-[130px]">
                      <HeaderCategoryDropdown
                        label="Category"
                        value={categoryFilter}
                        defaultValue="ALL"
                        allLabel="Semua Kategori"
                        options={[
                          { value: 'ALL', label: 'Semua Kategori' },
                          ...categoryOptions.map(cat => ({ value: cat.name, label: `${cat.name} (${cat.count})` }))
                        ]}
                        onChange={val => {
                          setCategoryFilter(val);
                          setCurrentPage(1);
                        }}
                        sortActive={sortState.column === 'ticketCategory'}
                        sortDir={sortState.column === 'ticketCategory' ? sortState.direction : null}
                        onCycleSort={() => handleSort('ticketCategory')}
                      />
                    </th>
                    <th className="py-3 px-4 min-w-[165px]">
                      <div className="flex items-center gap-1">
                        <HeaderDateSortFilterPopover
                          label="Appointment"
                          sortActive={sortState.column === 'appointmentDate'}
                          sortDir={sortState.column === 'appointmentDate' ? sortState.direction : null}
                          onCycleSort={() => handleSort('appointmentDate')}
                          exactDate={exactDateFilter}
                          dateFrom={dateFromFilter}
                          dateTo={dateToFilter}
                          onChangeDates={({ exactDate, dateFrom, dateTo }) => {
                            setExactDateFilter(exactDate);
                            setDateFromFilter(dateFrom);
                            setDateToFilter(dateTo);
                            setCurrentPage(1);
                          }}
                        />
                        <HeaderCategoryDropdown
                          label="Slot"
                          value={slotFilter}
                          defaultValue="ALL"
                          allLabel="Semua Slot"
                          options={[
                            { value: 'ALL', label: 'Semua Slot' },
                            { value: '09:00', label: 'Slot 1 (09-11)' },
                            { value: '11:00', label: 'Slot 2 (11-13)' },
                            { value: '13:00', label: 'Slot 3 (13-15)' },
                            { value: '15:00', label: 'Slot 4 (15-17)' }
                          ]}
                          onChange={val => {
                            setSlotFilter(val);
                            setCurrentPage(1);
                          }}
                        />
                      </div>
                    </th>
                    <th className="py-3 px-4 min-w-[175px]">
                      <HeaderCategoryDropdown
                        label="Current Staff & Load"
                        value={installerFilter}
                        defaultValue="ALL"
                        allLabel="Semua Teknisi"
                        options={[
                          { value: 'ALL', label: 'Semua Teknisi' },
                          ...installers.map(inst => ({ value: inst.name, label: inst.name }))
                        ]}
                        onChange={val => {
                          setInstallerFilter(val);
                          setCurrentPage(1);
                        }}
                        sortActive={sortState.column === 'installerName'}
                        sortDir={sortState.column === 'installerName' ? sortState.direction : null}
                        onCycleSort={() => handleSort('installerName')}
                      />
                    </th>
                    <th className="py-3 px-4 min-w-[130px]">
                      <HeaderCategoryDropdown
                        label="Status"
                        value={statusFilter}
                        defaultValue="eligible"
                        allLabel={`Siap Reassign (${eligibleCount})`}
                        options={[
                          { value: 'eligible', label: `Siap Reassign (${eligibleCount})` },
                          { value: 'all', label: `Semua WO (${assignedTodayTickets.length})` },
                          { value: 'problem', label: `Kendala (${problemCount})` },
                          { value: 'in_progress', label: 'Sedang Dikerjakan' },
                          { value: 'waiting', label: 'Menunggu Pengerjaan' },
                          { value: 'reassigned', label: 'Pernah Direassign' }
                        ]}
                        onChange={val => {
                          setStatusFilter(val as ReassignStatusFilter);
                          setCurrentPage(1);
                        }}
                        sortActive={sortState.column === 'status'}
                        sortDir={sortState.column === 'status' ? sortState.direction : null}
                        onCycleSort={() => handleSort('status')}
                      />
                    </th>
                    <th className="py-3 px-4 text-right min-w-[90px]">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE6F0] dark:divide-[#2E1859]">
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
                    const isPreviewSelected = selectedPreviewTicket?.id === t.id;

                    return (
                      <tr
                        key={t.id}
                        onClick={() => setPreviewTicketId(t.id)}
                        className={`transition-colors cursor-pointer ${
                          isPreviewSelected
                            ? 'bg-[#EAE8FF]/70 dark:bg-[#2E1B59]/75'
                            : 'hover:bg-[#EDF3F8]/70 dark:hover:bg-[#261942]/70'
                        }`}
                      >
                      {/* 1. WO NUMBER */}
                      <td className="py-3 px-4 align-top">
                        <button
                          type="button"
                          onClick={() => onSelectTicket(t)}
                          className="font-mono font-extrabold text-[#5145A6] dark:text-[#DAB9FF] hover:underline text-left block cursor-pointer"
                        >
                          {t.woNumber}
                        </button>
                        <div className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#A79BC0] mt-0.5">
                          {t.fatCode || t.fdtCode || t.idCustomer || '-'}
                        </div>
                        {reassignCount > 0 && (
                          <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] font-mono text-[9.5px] font-bold">
                            <History className="w-2.5 h-2.5" />
                            {reassignCount}x dialihkan
                          </span>
                        )}
                      </td>

                      {/* 2. CUSTOMER DETAILS */}
                      <td className="py-3 px-4 align-top">
                        <div className="font-bold text-[#26364A] dark:text-white">
                          {t.customerName}
                        </div>
                        <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] line-clamp-1 mt-0.5">
                          {t.clusterName || t.streetName || t.area || '-'}
                        </div>
                        {t.customerPhone && (
                          <div className="inline-flex items-center gap-1 font-mono text-[10.5px] text-[#2E7D8B] dark:text-[#DAB9FF] mt-0.5">
                            <Phone className="w-3 h-3" />
                            <span>{t.customerPhone}</span>
                          </div>
                        )}
                      </td>

                      {/* 3. CATEGORY */}
                      <td className="py-3 px-4 align-top">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EAE8FF] dark:bg-[#2C1A4E] text-[#5145A6] dark:text-[#DAB9FF] font-bold text-[11px]">
                          <Wrench className="w-3 h-3 shrink-0" />
                          <span>{t.ticketCategory || '-'}</span>
                        </span>
                        {(t.ontModel || t.fdtCode) && (
                          <div className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] mt-1 font-mono truncate max-w-[170px]">
                            {t.ontModel || `FDT ${t.fdtCode}`}
                          </div>
                        )}
                      </td>

                      {/* 4. APPOINTMENT & SLOT */}
                      <td className="py-3 px-4 align-top">
                        <div className="font-semibold text-[#26364A] dark:text-white font-mono text-[11px] tabular-nums">
                          {formatAppointmentDateDisplay(t.appointmentDate)}
                        </div>
                        <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] font-mono tabular-nums mt-0.5">
                          {t.slotTime || '-'}
                        </div>
                        <div
                          className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${
                            t.checkInAt
                              ? 'text-[#218A63] dark:text-emerald-300'
                              : 'text-[#8492A5] dark:text-[#A79BC0]'
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
                            <div className="w-8 h-8 rounded-full bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] font-display font-extrabold text-[11px] flex items-center justify-center shrink-0">
                              {getInitials(t.installerName)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-[#26364A] dark:text-white truncate">
                                {t.installerName}
                              </div>
                              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                {techInfo && (
                                  <span
                                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold tabular-nums ${
                                      techInfo.isFull
                                        ? 'bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-300'
                                        : 'bg-[#EAE8FF] dark:bg-[#2C1A4E] text-[#5145A6] dark:text-[#DAB9FF]'
                                    }`}
                                  >
                                    Beban {techInfo.assignedCount}/{techInfo.maxLimit} Tiket
                                  </span>
                                )}
                                {t.remarksWOInstaller?.trim() && (
                                  <span
                                    title={t.remarksWOInstaller}
                                    className="px-2 py-0.5 rounded-md bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-300 text-[10px] font-bold truncate max-w-[140px]"
                                  >
                                    {t.remarksWOInstaller}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-300 font-bold text-[11px]">
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
                        {(() => {
                          const reassignActions: DropdownActionItem[] = [
                            {
                              id: 'detail_wo',
                              label: 'Lihat 17-Section Fullview',
                              icon: <Eye className="w-3.5 h-3.5" />,
                              tone: 'primary',
                              onClick: () => onSelectTicket(t)
                            },
                            {
                              id: 'preview_wo',
                              label: 'Preview & Riwayat',
                              icon: <History className="w-3.5 h-3.5" />,
                              onClick: () => setPreviewTicketId(t.id)
                            }
                          ];
                          if (eligible) {
                            reassignActions.push({
                              id: 'reassign_wo',
                              label: 'Reassign Teknisi',
                              icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
                              tone: 'warning',
                              disabled: !isLeaderRole,
                              onClick: () => onOpenReassignModal(t)
                            });
                          }
                          reassignActions.push({
                            id: 'maps',
                            label: 'Buka Google Maps',
                            icon: <MapPin className="w-3.5 h-3.5" />,
                            onClick: () => openCustomerAddressInGoogleMaps(t)
                          });
                          reassignActions.push({
                            id: 'copy_wo',
                            label: 'Salin No. WO',
                            icon: <Copy className="w-3.5 h-3.5" />,
                            dividerBefore: true,
                            onClick: () => navigator.clipboard?.writeText(t.woNumber)
                          });
                          return (
                            <div className="inline-flex items-center justify-end">
                              <ActionDropdownMenu
                                actions={reassignActions}
                                triggerLabel={`Aksi WO ${t.woNumber}`}
                                align="right"
                                size="sm"
                              />
                            </div>
                          );
                        })()}
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

          {/* STICKY RIGHT PANE: SNAPSHOT REASSIGN & CADANGAN BASECAMP */}
          <aside className="xl:col-span-4 space-y-4 xl:sticky xl:top-4">
            {selectedPreviewTicket && (
              <div className="card-3d-lavender rounded-2xl overflow-hidden">
                <div className="bg-gradient-to-br from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:from-[#1F1638] dark:to-[#35105E] border-b border-[#DDE6F0] dark:border-transparent text-[#26364A] dark:text-white p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-white/15 text-[#5145A6] dark:text-[#EEDBFF] text-[10px] font-extrabold uppercase tracking-wider">
                      Panel Snapshot Reassign
                    </span>
                    <span className="font-mono text-[11px] font-bold text-[#2E7D8B] dark:text-[#DAB9FF]">
                      {selectedPreviewTicket.slotTime || 'Standar'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectTicket(selectedPreviewTicket)}
                      className="font-mono text-base font-extrabold text-[#26364A] dark:text-white hover:underline cursor-pointer text-left"
                    >
                      {selectedPreviewTicket.woNumber}
                    </button>
                    <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-extrabold ${getReassignBadge(selectedPreviewTicket).cls}`}>
                      {getReassignBadge(selectedPreviewTicket).label}
                    </span>
                  </div>
                  <div className="text-xs text-[#26364A] dark:text-[#EEDBFF] font-semibold truncate">
                    {selectedPreviewTicket.customerName}
                  </div>
                  <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                    {selectedPreviewTicket.clusterName || selectedPreviewTicket.streetName || selectedPreviewTicket.area || '-'}
                  </div>
                </div>

                <div className="p-4 space-y-3 text-xs">
                  {(selectedPreviewTicket.rejectionReason || selectedPreviewTicket.remarksWOInstaller) && (
                    <div className="p-2.5 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/30 border border-[#F3C5CA] dark:border-rose-800/60 text-[11px] text-[#9B2C37] dark:text-rose-200 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="line-clamp-3">
                        {selectedPreviewTicket.rejectionReason || selectedPreviewTicket.remarksWOInstaller}
                      </span>
                    </div>
                  )}

                  {/* Perbandingan Beban Teknisi */}
                  <div className="space-y-1.5">
                    <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                      Perbandingan Beban Teknisi
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2.5 rounded-xl bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3E246F] min-w-0">
                        <span className="text-[9.5px] font-bold uppercase text-[#9B2C37] dark:text-rose-300 block">
                          Teknisi Asal
                        </span>
                        <strong className="text-[#26364A] dark:text-white truncate block mt-0.5">
                          {selectedPreviewTicket.installerName || 'Unassigned'}
                        </strong>
                        {selectedPreviewTicket.installerName &&
                          techMap.get(selectedPreviewTicket.installerName.toLowerCase().trim()) && (
                            <span className="font-mono text-[10.5px] text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                              {techMap.get(selectedPreviewTicket.installerName.toLowerCase().trim())!.assignedCount}/
                              {techMap.get(selectedPreviewTicket.installerName.toLowerCase().trim())!.maxLimit} WO
                            </span>
                          )}
                      </div>

                      <div className="p-2.5 rounded-xl bg-[#E4F5EC] dark:bg-emerald-950/30 border border-[#B7E4CC] dark:border-emerald-800/60 min-w-0">
                        <span className="text-[9.5px] font-bold uppercase text-[#218A63] dark:text-emerald-300 block">
                          Rekomendasi
                        </span>
                        <strong className="text-[#26364A] dark:text-white truncate block mt-0.5">
                          {recommendedReplacementForPreview
                            ? recommendedReplacementForPreview.installer.name
                            : 'Semua Penuh'}
                        </strong>
                        {recommendedReplacementForPreview && (
                          <span className="font-mono text-[10.5px] text-[#218A63] dark:text-emerald-300 tabular-nums">
                            {recommendedReplacementForPreview.assignedCount}/
                            {recommendedReplacementForPreview.maxLimit} WO
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isTicketEligibleForReassign(selectedPreviewTicket) ? (
                    <button
                      type="button"
                      disabled={!isLeaderRole}
                      onClick={() => onOpenReassignModal(selectedPreviewTicket)}
                      className="mj-btn-leader-primary w-full py-2.5 px-4 text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                      <span>Buka Form Reassign 2-Langkah</span>
                    </button>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-[#EDF3F8] dark:bg-[#261942] text-center text-[11px] font-semibold text-[#8492A5] dark:text-[#CEC0E8]">
                      WO berstatus selesai / terkunci.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Ketersediaan Cadangan Basecamp */}
            <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(38,54,74,0.04)] space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DDE6F0] dark:border-[#35105E]">
                <div>
                  <h3 className="text-xs font-extrabold text-[#26364A] dark:text-white">
                    Ketersediaan Cadangan Basecamp
                  </h3>
                  <p className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0]">
                    Teknisi sektor dengan sisa slot terbanyak
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-[#E4F5EC] dark:bg-emerald-950/70 text-[#218A63] dark:text-emerald-300 font-mono text-[10px] font-bold">
                  {basecampReserveTechs.length} Siap
                </span>
              </div>

              {basecampReserveTechs.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-[#8492A5] dark:text-[#A79BC0]">
                  Seluruh teknisi sektor sedang mencapai batas kuota harian.
                </div>
              ) : (
                <div className="space-y-2">
                  {basecampReserveTechs.map(cand => (
                    <div
                      key={cand.installer.id}
                      className="p-2.5 rounded-xl bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] font-extrabold text-[10px] flex items-center justify-center shrink-0">
                          {getInitials(cand.installer.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                            {cand.installer.name}
                          </div>
                          <div className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] truncate">
                            {cand.liveStatusLabel} • Sisa {cand.remainingSlots} slot
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-white dark:bg-[#261942] border border-[#DCE3F2] dark:border-[#4B386B] font-mono text-[10px] font-extrabold text-[#5145A6] dark:text-[#DAB9FF] shrink-0 tabular-nums">
                        {cand.assignedCount}/{cand.maxLimit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
