import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar,
  Clock,
  Download,
  Eye,
  Filter,
  History,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Database,
  Wrench,
  CheckCircle2
} from 'lucide-react';
import { OverdueDurationBucket, Ticket } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { supabaseDb } from '../../services/supabaseDb';
import {
  getOverdueBucketLabel,
  getOverdueDurationLabel
} from '../../services/woClassificationService';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { isTicketClosed } from '../../services/woLifecycleService';
import {
  buildTechnicianCapacitySummaries,
  DEFAULT_LEADER_QUOTA_CONFIG,
  fetchLeaderQuotaConfig,
  LeaderQuotaConfig
} from '../../services/leaderQuotaService';
import { StatusAgentBadge, StatusApprovalBadge, StatusInstallerBadge } from '../common/Badge';
import { PaginationBar } from '../common/PaginationBar';
import { LeaderTwoStepReassignModal } from '../portals/LeaderTwoStepReassignModal';
import { navigateToDataDeletion } from '../../services/deletionManagementService';
import {
  HeaderCategoryDropdown,
  HeaderDateSortFilterPopover,
  HeaderSearchPopover,
  HeaderSortButton,
  TableResetFilterButton
} from '../common/InteractiveTableHeader';
import { TableSelectionToolbar } from '../common/TableSelectionToolbar';
import { getNextSortDirection, sortDataArray, SortDirection } from '../../utils/tableSorting';

interface OverdueWorkOrdersViewProps {
  onSelectTicket: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
  onNavigate?: (tab: string) => void;
}

const DURATION_BUCKET_CARDS: Array<{
  key: 'ALL' | OverdueDurationBucket;
  label: string;
  hint: string;
  countKey: 'totalOverdue' | 'overdue1Day' | 'overdue2To3Days' | 'overdue4To7Days' | 'criticalOverdueGt7Days';
  toneClass: string;
  activeRing: string;
}> = [
  {
    key: 'ALL',
    label: 'Total Overdue WO',
    hint: 'Semua WO melewati jadwal',
    countKey: 'totalOverdue',
    toneClass: 'text-[#5145A6] dark:text-[#DAB9FF]',
    activeRing: 'border-[#6657C8] ring-2 ring-[#6657C8]/20 bg-[#EAE8FF] dark:border-[#58149C] dark:ring-[#58149C]/20 dark:bg-[#261942]'
  },
  {
    key: '1_day',
    label: 'Overdue 1 Day',
    hint: 'Terlambat 1 hari WIB',
    countKey: 'overdue1Day',
    toneClass: 'text-[#3E81C6] dark:text-sky-300',
    activeRing: 'border-[#3E81C6] ring-2 ring-[#3E81C6]/20 bg-[#E7F1FB] dark:border-[#1D4ED8] dark:ring-[#1D4ED8]/20 dark:bg-sky-950/30'
  },
  {
    key: '2_3_days',
    label: 'Overdue 2–3 Days',
    hint: 'Terlambat 2–3 hari WIB',
    countKey: 'overdue2To3Days',
    toneClass: 'text-[#9D661F] dark:text-amber-300',
    activeRing: 'border-[#C88735] ring-2 ring-[#C88735]/20 bg-[#FFF2D9] dark:border-[#D97706] dark:ring-[#D97706]/20 dark:bg-amber-950/30'
  },
  {
    key: '4_7_days',
    label: 'Overdue 4–7 Days',
    hint: 'Prioritas eskalasi 4–7 hari',
    countKey: 'overdue4To7Days',
    toneClass: 'text-[#C88735] dark:text-orange-300',
    activeRing: 'border-[#C88735] ring-2 ring-[#C88735]/20 bg-[#FFF2D9]/80 dark:border-[#EA580C] dark:ring-[#EA580C]/20 dark:bg-orange-950/30'
  },
  {
    key: 'gt_7_days',
    label: 'Critical Overdue (>7 Days)',
    hint: 'Kritis melebihi 7 hari',
    countKey: 'criticalOverdueGt7Days',
    toneClass: 'text-[#9B2C37] dark:text-rose-300',
    activeRing: 'border-[#D45B66] ring-2 ring-[#D45B66]/20 bg-[#FCE9EB] dark:border-[#DC2626] dark:ring-[#DC2626]/20 dark:bg-rose-950/30'
  }
];

function formatLastUpdatedJakarta(raw?: string): string {
  if (!raw) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(raw));
  } catch {
    return String(raw).slice(0, 16);
  }
}

function getDurationTextBadgeClass(bucket?: OverdueDurationBucket | null): string {
  if (bucket === 'gt_7_days') {
    return 'bg-[#FCE9EB] text-[#9B2C37] border-[#F3C5CA] dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800';
  }
  if (bucket === '4_7_days') {
    return 'bg-[#FFF2D9] text-[#9D661F] border-[#F2CF95] dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800';
  }
  if (bucket === '2_3_days') {
    return 'bg-[#FFF2D9] text-[#9D661F] border-[#F2CF95] dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800';
  }
  return 'bg-[#E7F1FB] text-[#3E81C6] border-[#C6DDF6] dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800';
}

export const OverdueWorkOrdersView: React.FC<OverdueWorkOrdersViewProps> = ({
  onSelectTicket,
  onOpenWhatsApp
}) => {
  const {
    currentUser,
    tickets,
    users,
    todayWIB,
    overdueTickets,
    exceptionTickets,
    overdueSummary,
    refreshOverdueTickets,
    reassignTicketPersonnel,
    contractorsList,
    areasList,
    hasPermission
  } = useApp();
  const { toast } = useToast();
  const { isCompactUI } = useResponsiveViewport();

  const canViewExceptions = currentUser.role === 'super_admin';
  const canOpenDataDeletion =
    currentUser.role === 'super_admin' ||
    (currentUser.role === 'dispatch' && hasPermission('delete_wo_data'));
  const isLeaderRole = currentUser.role === 'leader';

  const [viewMode, setViewMode] = useState<'overdue' | 'exception'>('overdue');
  const [woSearch, setWoSearch] = useState('');
  const [customerIdSearch, setCustomerIdSearch] = useState('');
  const [customerNameSearch, setCustomerNameSearch] = useState('');
  const [contractorFilter, setContractorFilter] = useState('ALL');
  const [areaFilter, setAreaFilter] = useState('ALL');
  const [installerFilter, setInstallerFilter] = useState('ALL');
  const [durationFilter, setDurationFilter] = useState<'ALL' | OverdueDurationBucket>('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [exactAppointmentDate, setExactAppointmentDate] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortColumn, setSortColumn] = useState<string>('appointmentDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | 'ALL'>(25);

  const [isSyncing, setIsSyncing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Leader two-step reassign modal state
  const [reassignTicket, setReassignTicket] = useState<Ticket | null>(null);
  const [isReassignSubmitting, setIsReassignSubmitting] = useState(false);
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  const [quotaConfig, setQuotaConfig] = useState<LeaderQuotaConfig>(() => ({
    ...DEFAULT_LEADER_QUOTA_CONFIG,
    contractorName: currentUser.contractor || contractorsList?.[0] || ''
  }));

  useEffect(() => {
    let active = true;
    const verifyServerOverdue = async () => {
      setServerError(null);
      try {
        const res = await supabaseDb.fetchOverdueWorkOrders();
        if (!active) return;
        if (!res.success && res.error) {
          setServerError(res.error.message);
        }
      } catch (err: any) {
        if (active) setServerError(err?.message || 'Gagal sinkronisasi daftar Overdue WO');
      }
    };
    void verifyServerOverdue();
    return () => {
      active = false;
    };
  }, [todayWIB]);

  useEffect(() => {
    if (!isLeaderRole) return;
    let active = true;
    const contractorScope = currentUser.contractor || contractorsList?.[0] || '';
    fetchLeaderQuotaConfig(contractorScope)
      .then(res => {
        if (active && res.success && res.config) {
          setQuotaConfig(res.config);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isLeaderRole, currentUser.contractor, contractorsList]);

  const activePool = useMemo(() => {
    if (viewMode === 'exception' && canViewExceptions) {
      return exceptionTickets;
    }
    return overdueTickets;
  }, [viewMode, canViewExceptions, exceptionTickets, overdueTickets]);

  const filterOptions = useMemo(() => {
    const contractors = new Set<string>();
    const areas = new Set<string>();
    const leaders = new Set<string>();
    const installers = new Set<string>();
    const statuses = new Set<string>();

    activePool.forEach(t => {
      const c = String(t.contactorName || t.contractorName || '').trim();
      if (c) contractors.add(c);
      const a = String(t.area || '').trim();
      if (a) areas.add(a);
      const l = String(t.leaderName || t.corlapName || '').trim();
      if (l) leaders.add(l);
      const i = String(t.installerName || '').trim();
      if (i) installers.add(i);
      const sa = String(t.statusWOAgent || '').trim();
      if (sa) statuses.add(sa);
      const si = String(t.statusWOInstaller || '').trim();
      if (si) statuses.add(si);
    });

    if (contractors.size === 0 && !isLeaderRole) {
      (contractorsList || []).forEach(c => c && contractors.add(c));
    }
    if (areas.size === 0 && !isLeaderRole) {
      (areasList || []).forEach(a => a && areas.add(a));
    }

    return {
      contractors: Array.from(contractors).sort((a, b) => a.localeCompare(b)),
      areas: Array.from(areas).sort((a, b) => a.localeCompare(b)),
      leaders: Array.from(leaders).sort((a, b) => a.localeCompare(b)),
      installers: Array.from(installers).sort((a, b) => a.localeCompare(b)),
      statuses: Array.from(statuses).sort((a, b) => a.localeCompare(b))
    };
  }, [activePool, contractorsList, areasList, isLeaderRole]);

  const handleCycleSort = (colKey: string) => {
    const nextDir = getNextSortDirection(sortColumn, sortDirection, colKey);
    setSortColumn(nextDir ? colKey : 'appointmentDate');
    setSortDirection(nextDir);
  };

  const filteredTickets = useMemo(() => {
    const qWo = woSearch.trim().toLowerCase();
    const qCid = customerIdSearch.trim().toLowerCase();
    const qCname = customerNameSearch.trim().toLowerCase();

    const list = activePool.filter(t => {
      if (qWo && !String(t.woNumber || '').toLowerCase().includes(qWo)) return false;
      if (qCid && !String(t.idCustomer || t.customerId || '').toLowerCase().includes(qCid)) return false;
      if (qCname && !String(t.customerName || '').toLowerCase().includes(qCname)) return false;

      if (contractorFilter !== 'ALL') {
        const c = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
        if (c !== contractorFilter.trim().toLowerCase()) return false;
      }

      if (areaFilter !== 'ALL') {
        const a = String(t.area || '').trim().toLowerCase();
        if (a !== areaFilter.trim().toLowerCase()) return false;
      }

      if (installerFilter !== 'ALL') {
        const i = String(t.installerName || '').trim().toLowerCase();
        if (i !== installerFilter.trim().toLowerCase()) return false;
      }

      if (viewMode === 'overdue' && durationFilter !== 'ALL') {
        if (t.overdueDurationBucket !== durationFilter) return false;
      }

      if (statusFilter !== 'ALL') {
        const sa = String(t.statusWOAgent || '').trim().toLowerCase();
        const si = String(t.statusWOInstaller || '').trim().toLowerCase();
        const target = statusFilter.trim().toLowerCase();
        if (sa !== target && si !== target) return false;
      }

      if (exactAppointmentDate || dateFrom || dateTo) {
        const normalizedDate = getTicketAppointmentDate(t) || '';
        if (!normalizedDate) return false;
        if (exactAppointmentDate && normalizedDate !== exactAppointmentDate) return false;
        if (dateFrom && normalizedDate < dateFrom) return false;
        if (dateTo && normalizedDate > dateTo) return false;
      }

      return true;
    });

    if (!sortDirection) return list;

    return sortDataArray(
      list,
      sortColumn,
      sortDirection,
      (item, col) => {
        if (col === 'woNumber') return item.woNumber || '';
        if (col === 'idCustomer') return item.idCustomer || item.customerId || '';
        if (col === 'customerName') return item.customerName || '';
        if (col === 'contractor') return item.contactorName || item.contractorName || '';
        if (col === 'area') return item.area || '';
        if (col === 'appointmentDate') return getTicketAppointmentDate(item) || item.appointmentDate || '';
        if (col === 'installerName') return item.installerName || '';
        if (col === 'status') return item.statusWOInstaller || item.statusWOAgent || '';
        if (col === 'overdueDays') return item.overdueDays ?? null;
        if (col === 'updatedAt') return item.updatedAt || item.createdAt || '';
        return (item as any)[col];
      }
    ).sort((a, b) => {
      if (sortColumn !== 'appointmentDate') return 0;
      const da = getTicketAppointmentDate(a) || a.appointmentDate || '';
      const db = getTicketAppointmentDate(b) || b.appointmentDate || '';
      if (da !== db) return 0;
      return String(a.woNumber || '').localeCompare(String(b.woNumber || ''));
    });
  }, [
    activePool,
    woSearch,
    customerIdSearch,
    customerNameSearch,
    contractorFilter,
    areaFilter,
    installerFilter,
    viewMode,
    durationFilter,
    statusFilter,
    exactAppointmentDate,
    dateFrom,
    dateTo,
    sortColumn,
    sortDirection
  ]);

  // Reset pagination whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    viewMode,
    woSearch,
    customerIdSearch,
    customerNameSearch,
    contractorFilter,
    areaFilter,
    installerFilter,
    durationFilter,
    statusFilter,
    exactAppointmentDate,
    dateFrom,
    dateTo,
    sortColumn,
    sortDirection
  ]);

  const totalPages = useMemo(() => {
    if (pageSize === 'ALL') return 1;
    return Math.max(1, Math.ceil(filteredTickets.length / pageSize));
  }, [filteredTickets.length, pageSize]);

  const paginatedTickets = useMemo(() => {
    if (pageSize === 'ALL') return filteredTickets;
    const start = (currentPage - 1) * pageSize;
    return filteredTickets.slice(start, start + pageSize);
  }, [filteredTickets, currentPage, pageSize]);

  // Clear selection when switching overdue/exception view modes and prune stale IDs
  useEffect(() => {
    setSelectedTicketIds([]);
  }, [viewMode]);

  useEffect(() => {
    const validIds = new Set(filteredTickets.map(t => t.id));
    setSelectedTicketIds(prev => {
      const next = prev.filter(id => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredTickets]);

  const selectedIdSet = useMemo(() => new Set(selectedTicketIds), [selectedTicketIds]);

  const selectedTicketsList = useMemo(
    () => filteredTickets.filter(t => selectedIdSet.has(t.id)),
    [filteredTickets, selectedIdSet]
  );

  const visibleTicketIds = useMemo(() => paginatedTickets.map(t => t.id), [paginatedTickets]);
  const allVisibleSelected =
    visibleTicketIds.length > 0 && visibleTicketIds.every(id => selectedIdSet.has(id));
  const someVisibleSelected =
    visibleTicketIds.some(id => selectedIdSet.has(id)) && !allVisibleSelected;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const toggleSelectOne = (ticketId: string) => {
    setSelectedTicketIds(prev =>
      prev.includes(ticketId) ? prev.filter(id => id !== ticketId) : [...prev, ticketId]
    );
  };

  const toggleSelectAllVisible = () => {
    if (visibleTicketIds.length === 0) return;
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleTicketIds);
      setSelectedTicketIds(prev => prev.filter(id => !visibleSet.has(id)));
    } else {
      setSelectedTicketIds(prev => Array.from(new Set([...prev, ...visibleTicketIds])));
    }
  };

  const leaderInstallers = useMemo(() => {
    if (!isLeaderRole) return [];
    const leaderContractor = String(currentUser.contractor || '').trim().toLowerCase();
    const leaderArea = String(currentUser.area || '').trim().toLowerCase();
    return (users || []).filter(u => {
      if (u.role !== 'installer' || u.active === false || u.isDeleted || u.isArchived) return false;
      if (leaderContractor) {
        const uc = String(u.contractor || '').trim().toLowerCase();
        if (!uc || (!uc.includes(leaderContractor) && !leaderContractor.includes(uc))) return false;
      }
      if (leaderArea && u.area) {
        const ua = String(u.area || '').trim().toLowerCase();
        if (!ua.includes(leaderArea) && !leaderArea.includes(ua)) return false;
      }
      return true;
    });
  }, [isLeaderRole, users, currentUser.contractor, currentUser.area]);

  const technicianCapacitySummaries = useMemo(() => {
    if (!isLeaderRole) return [];
    const todayContractorTickets = (tickets || []).filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      const leaderContractor = String(currentUser.contractor || '').trim().toLowerCase();
      if (!leaderContractor) return true;
      const tc = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
      return Boolean(tc && (tc.includes(leaderContractor) || leaderContractor.includes(tc)));
    });
    return buildTechnicianCapacitySummaries({
      installers: leaderInstallers,
      todayTickets: todayContractorTickets,
      quotaConfig,
      targetDate: todayWIB
    });
  }, [isLeaderRole, leaderInstallers, tickets, currentUser.contractor, quotaConfig, todayWIB]);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (woSearch.trim()) c++;
    if (customerIdSearch.trim()) c++;
    if (customerNameSearch.trim()) c++;
    if (contractorFilter !== 'ALL') c++;
    if (areaFilter !== 'ALL') c++;
    if (installerFilter !== 'ALL') c++;
    if (durationFilter !== 'ALL') c++;
    if (statusFilter !== 'ALL') c++;
    if (exactAppointmentDate || dateFrom || dateTo) c++;
    return c;
  }, [
    woSearch,
    customerIdSearch,
    customerNameSearch,
    contractorFilter,
    areaFilter,
    installerFilter,
    durationFilter,
    statusFilter,
    exactAppointmentDate,
    dateFrom,
    dateTo
  ]);

  const hasActiveFilters = activeFilterCount > 0;

  const resetFilters = () => {
    setWoSearch('');
    setCustomerIdSearch('');
    setCustomerNameSearch('');
    setContractorFilter('ALL');
    setAreaFilter('ALL');
    setInstallerFilter('ALL');
    setDurationFilter('ALL');
    setStatusFilter('ALL');
    setExactAppointmentDate('');
    setDateFrom('');
    setDateTo('');
    setSortColumn('appointmentDate');
    setSortDirection('asc');
  };

  const handleManualRefresh = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setServerError(null);
    try {
      await refreshOverdueTickets();
      const res = await supabaseDb.fetchOverdueWorkOrders();
      if (!res.success && res.error) {
        setServerError(res.error.message);
      } else {
        toast.success('Daftar Overdue WO diperbarui dari server.', 'Sinkronisasi Selesai');
      }
    } catch (err: any) {
      setServerError(err?.message || 'Gagal memperbarui Overdue WO');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportExcel = () => {
    if (filteredTickets.length === 0) {
      toast.warning('Tidak ada data untuk diekspor.', 'Export Kosong');
      return;
    }
    const rows = filteredTickets.map(t => ({
      'WO Number': t.woNumber,
      'Customer ID': t.idCustomer || t.customerId || '-',
      'Customer Name': t.customerName,
      'Contractor/Vendor': t.contactorName || t.contractorName || '-',
      Area: t.area || '-',
      'Appointment Date': t.appointmentDate || '-',
      Leader: t.leaderName || t.corlapName || '-',
      'Installer/Technician': t.installerName || 'Unassigned',
      'Status WO Agent': t.statusWOAgent || '-',
      'Status WO Installer': t.statusWOInstaller || '-',
      'Approval Status': t.approvalStatus || 'NONE',
      'Overdue Duration':
        viewMode === 'exception' ? 'Exception (Tanggal Invalid)' : getOverdueDurationLabel(t.overdueDays || 0),
      'Last Updated': formatLastUpdatedJakarta(t.updatedAt || t.createdAt)
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, viewMode === 'exception' ? 'Exception WO' : 'Overdue WO');
    XLSX.writeFile(wb, `MoraJaws_${viewMode === 'exception' ? 'Exception' : 'Overdue'}_WO_${todayWIB}.xlsx`);
    toast.success(`${rows.length} baris berhasil diekspor ke Excel.`, 'Export Berhasil');
  };

  const handleOpenReassign = (ticket: Ticket) => {
    if (!isLeaderRole) return;
    if (!ticket.installerName) {
      toast.warning('Tiket ini belum memiliki teknisi awal.', 'Belum Di-assign');
      return;
    }
    if (isTicketClosed(ticket)) {
      toast.error('WO yang sudah selesai atau ditutup tidak dapat di-reassign.', 'Reassign Ditolak');
      return;
    }
    setReassignTicket(ticket);
  };

  const handleConfirmReassign = async (payload: {
    ticket: Ticket;
    targetInstallerId: string;
    targetInstallerName: string;
    reason: string;
    prepareWhatsAppNotice: boolean;
  }) => {
    if (isReassignSubmitting) return;
    setIsReassignSubmitting(true);
    try {
      const result = await reassignTicketPersonnel(
        payload.ticket.id,
        payload.targetInstallerName,
        payload.reason,
        payload.targetInstallerId
      );
      if (result.success) {
        setReassignTicket(null);
        await refreshOverdueTickets().catch(() => {});
      }
    } finally {
      setIsReassignSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white/95 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-2xl p-4 sm:p-5 shadow-xs dark:shadow-none">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/60 border border-[#F3C5CA] dark:border-rose-800 text-[#9B2C37] dark:text-rose-300 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h1 className="font-display text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white leading-tight">
                OVERDUE WO
              </h1>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                Work Order belum selesai yang melewati Appointment Date · Acuan tanggal{' '}
                <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                  {formatAppointmentDateDisplay(todayWIB) || todayWIB} (WIB)
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canViewExceptions && (
            <div
              role="tablist"
              aria-label="Mode Klasifikasi WO"
              className="inline-flex items-center p-1 rounded-xl bg-[#EDF3F8] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'overdue'}
                onClick={() => setViewMode('overdue')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === 'overdue'
                    ? 'bg-[#6657C8] dark:bg-[#58149C] text-white'
                    : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#26364A] dark:hover:text-white'
                }`}
              >
                Overdue WO ({overdueSummary.totalOverdue})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'exception'}
                onClick={() => setViewMode('exception')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === 'exception'
                    ? 'bg-[#6657C8] dark:bg-[#58149C] text-white'
                    : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#26364A] dark:hover:text-white'
                }`}
              >
                Exception Tanggal ({exceptionTickets.length})
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isSyncing}
            className="btn-3d-secondary px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filteredTickets.length === 0}
            className="btn-3d-primary px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {serverError && (
        <div className="rounded-xl bg-[#FFF2D9] dark:bg-amber-950/50 border border-[#F2CF95] dark:border-amber-800 px-4 py-2.5 flex items-center justify-between gap-2 text-xs text-[#9D661F] dark:text-amber-200">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="truncate font-semibold">Sinkronisasi server tertunda: {serverError}</span>
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#261942] border border-[#F2CF95] dark:border-[#FCD34D] text-[11px] font-bold shrink-0 cursor-pointer"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* 5 Overdue Summary Metrics */}
      {viewMode === 'overdue' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {DURATION_BUCKET_CARDS.map(card => {
            const count = overdueSummary[card.countKey];
            const isSelected = durationFilter === card.key;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => setDurationFilter(card.key)}
                className={`text-left rounded-2xl p-3.5 border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                  isSelected
                    ? card.activeRing
                    : 'bg-white/95 dark:bg-[#160D29] border-[#DDE6F0] dark:border-[#35105E] hover:border-[#6657C8]/50 dark:hover:border-[#A78BFA]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] truncate">
                    {card.label}
                  </span>
                  <Clock className={`w-3.5 h-3.5 shrink-0 ${card.toneClass}`} />
                </div>
                <div className={`font-display text-2xl font-extrabold tabular-nums leading-none ${card.toneClass}`}>
                  {count}
                </div>
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] truncate">
                  {card.hint}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl bg-[#FFF2D9] dark:bg-orange-950/30 border border-[#F2CF95] dark:border-orange-800 p-4 flex items-start gap-3 text-xs">
          <ShieldAlert className="w-5 h-5 text-[#C88735] dark:text-orange-300 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-[#9D661F] dark:text-orange-200">
              Exception WO — Appointment Date Kosong atau Tidak Valid ({exceptionTickets.length} WO)
            </div>
            <p className="text-[#9D661F]/90 dark:text-orange-200/80">
              WO pada tab ini tidak memiliki tanggal appointment yang valid dan tidak dihitung sebagai Overdue ataupun Hari Ini sampai tanggal diperbaiki pada detail WO.
            </p>
          </div>
        </div>
      )}

      {/* Compact Reset Filter Strip (no separate filter bar above table) */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TableResetFilterButton
            activeCount={activeFilterCount}
            onReset={resetFilters}
            label="Reset Search/Filter"
            testId="overdue-reset-filters"
          />
        </div>
      )}

      {/* Contextual Bulk Selection Toolbar */}
      <TableSelectionToolbar
        selectedCount={selectedTicketIds.length}
        onClearSelection={() => setSelectedTicketIds([])}
        label="WO Overdue terpilih pada halaman aktif"
        testId="overdue-selection-toolbar"
      >
        {canOpenDataDeletion && (
          <button
            type="button"
            onClick={() =>
              navigateToDataDeletion({
                category: 'work_orders',
                mode: 'soft_delete',
                search: selectedTicketsList.length === 1 ? selectedTicketsList[0].woNumber : ''
              })
            }
            className="btn-3d-secondary px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Database className="w-3.5 h-3.5" />
            <span>Kelola Penghapusan di Data Deletion</span>
          </button>
        )}
      </TableSelectionToolbar>

      {/* Results Area */}
      {filteredTickets.length === 0 ? (
        <div className="bg-white/95 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#E4F5EC] dark:bg-emerald-950/60 border border-[#B7E4CC] dark:border-emerald-800 text-[#218A63] dark:text-emerald-300 flex items-center justify-center mx-auto">
            {hasActiveFilters ? <Filter className="w-5 h-5" /> : <CheckCircle2 className="w-6 h-6" />}
          </div>
          <h3 className="font-display text-base font-bold text-[#26364A] dark:text-white">
            {hasActiveFilters
              ? 'Tidak Ada Work Order Sesuai Filter'
              : viewMode === 'exception'
              ? 'Tidak Ada Exception Tanggal Appointment'
              : 'Tidak Ada Work Order Overdue'}
          </h3>
          <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] max-w-md mx-auto">
            {hasActiveFilters
              ? 'Coba ubah kata kunci atau reset filter untuk melihat seluruh Work Order dalam cakupan Anda.'
              : viewMode === 'exception'
              ? 'Seluruh Work Order aktif memiliki format Appointment Date yang valid.'
              : 'Seluruh Work Order dengan jadwal sebelum hari ini telah diselesaikan atau ditutup.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="btn-3d-secondary px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Semua Filter</span>
            </button>
          )}
        </div>
      ) : isCompactUI ? (
        <div className="space-y-3">
          {/* Compact Mobile Header Filter & Sort Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <div className="shrink-0 inline-flex items-center px-2 py-1 rounded-xl bg-white/95 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-bold text-[#52647A] dark:text-[#CEC0E8]">
              <HeaderSearchPopover
                label="WO"
                value={woSearch}
                onChange={setWoSearch}
                placeholder="Cari WO Number..."
                sortActive={sortColumn === 'woNumber'}
                sortDir={sortColumn === 'woNumber' ? sortDirection : null}
                onCycleSort={() => handleCycleSort('woNumber')}
              />
            </div>
            <div className="shrink-0 inline-flex items-center px-2 py-1 rounded-xl bg-white/95 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-bold text-[#52647A] dark:text-[#CEC0E8]">
              <HeaderDateSortFilterPopover
                label="Appointment"
                sortActive={sortColumn === 'appointmentDate'}
                sortDir={sortColumn === 'appointmentDate' ? sortDirection : null}
                onCycleSort={() => handleCycleSort('appointmentDate')}
                exactDate={exactAppointmentDate}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onChangeDates={({ exactDate, dateFrom: df, dateTo: dt }) => {
                  setExactAppointmentDate(exactDate);
                  setDateFrom(df);
                  setDateTo(dt);
                }}
              />
            </div>
            <div className="shrink-0 inline-flex items-center px-2 py-1 rounded-xl bg-white/95 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-bold text-[#52647A] dark:text-[#CEC0E8]">
              <HeaderCategoryDropdown
                label="Contractor"
                value={contractorFilter}
                defaultValue="ALL"
                allLabel="Semua Contractor"
                options={[
                  { value: 'ALL', label: 'Semua Contractor' },
                  ...filterOptions.contractors.map(c => ({ value: c, label: c }))
                ]}
                onChange={setContractorFilter}
              />
            </div>
            <div className="shrink-0 inline-flex items-center px-2 py-1 rounded-xl bg-white/95 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-bold text-[#52647A] dark:text-[#CEC0E8]">
              <HeaderCategoryDropdown
                label="Area"
                value={areaFilter}
                defaultValue="ALL"
                allLabel="Semua Area"
                options={[
                  { value: 'ALL', label: 'Semua Area' },
                  ...filterOptions.areas.map(a => ({ value: a, label: a }))
                ]}
                onChange={setAreaFilter}
              />
            </div>
            <div className="shrink-0 inline-flex items-center px-2 py-1 rounded-xl bg-white/95 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-bold text-[#52647A] dark:text-[#CEC0E8]">
              <HeaderCategoryDropdown
                label="Status"
                value={statusFilter}
                defaultValue="ALL"
                allLabel="Semua Status"
                options={[
                  { value: 'ALL', label: 'Semua Status' },
                  ...filterOptions.statuses.map(st => ({ value: st, label: st }))
                ]}
                onChange={setStatusFilter}
              />
            </div>
          </div>

          <div className="flex items-center justify-between px-1 text-xs">
            <label className="inline-flex items-center gap-2 font-bold text-[#52647A] dark:text-[#CEC0E8] cursor-pointer">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                aria-label="Pilih semua WO overdue pada halaman ini"
                className="w-4 h-4 rounded border-[#CFDCE8] dark:border-[#B7A9CE] accent-[#6657C8] dark:accent-[#58149C] cursor-pointer"
              />
              <span>Pilih Semua di Halaman ({visibleTicketIds.length})</span>
            </label>
            {selectedTicketIds.length > 0 && (
              <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                {selectedTicketIds.length} dipilih
              </span>
            )}
          </div>
          {paginatedTickets.map(ticket => {
            const canReassign =
              isLeaderRole &&
              viewMode === 'overdue' &&
              Boolean(ticket.installerName) &&
              !isTicketClosed(ticket);
            const contractor = ticket.contactorName || ticket.contractorName || '-';
            const isSelected = selectedIdSet.has(ticket.id);
            return (
              <article
                key={ticket.id}
                className={`rounded-2xl p-4 space-y-3 border transition-colors ${
                  isSelected
                    ? 'bg-[#EAE8FF]/85 dark:bg-[#2C1A4E] border-[#6657C8] dark:border-[#7135B5] ring-2 ring-[#6657C8]/25 dark:ring-[#7135B5]/25'
                    : 'bg-white/95 dark:bg-[#160D29] border-[#DDE6F0] dark:border-[#35105E]'
                }`}
              >
                <div className="flex items-start justify-between gap-2 pb-2 border-b border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectOne(ticket.id)}
                      aria-label={`Pilih ${ticket.woNumber}`}
                      className="mt-0.5 w-4 h-4 rounded border-[#CFDCE8] dark:border-[#B7A9CE] accent-[#6657C8] dark:accent-[#58149C] cursor-pointer shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onSelectTicket(ticket, 'overview')}
                          className="font-mono text-xs font-extrabold text-[#5145A6] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                        >
                          {ticket.woNumber}
                        </button>
                        <span className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#A79BC0]">
                          ID: {ticket.idCustomer || ticket.customerId || '-'}
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-[#26364A] dark:text-white truncate mt-0.5">
                        {ticket.customerName}
                      </h3>
                    </div>
                  </div>

                  {viewMode === 'overdue' ? (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border whitespace-nowrap shrink-0 tabular-nums ${getDurationTextBadgeClass(
                        ticket.overdueDurationBucket
                      )}`}
                    >
                      {getOverdueDurationLabel(ticket.overdueDays || 0)}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-[#FFF2D9] text-[#9D661F] border-[#F2CF95] dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800">
                      EXCEPTION
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[#8492A5] dark:text-[#A79BC0] block">Contractor &amp; Area</span>
                    <strong className="text-[#26364A] dark:text-white block truncate">{contractor}</strong>
                    <span className="text-[#52647A] dark:text-[#CEC0E8] truncate block">{ticket.area || '-'}</span>
                  </div>
                  <div>
                    <span className="text-[#8492A5] dark:text-[#A79BC0] block">Appointment &amp; Teknisi</span>
                    <strong className="font-mono text-[#26364A] dark:text-white block tabular-nums">
                      {ticket.appointmentDate || 'Tidak Valid'}
                    </strong>
                    <span className="text-[#52647A] dark:text-[#CEC0E8] truncate block">
                      {ticket.installerName || 'Unassigned'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusAgentBadge status={ticket.statusWOAgent || 'Pending'} />
                  <StatusInstallerBadge status={ticket.statusWOInstaller || 'Assigned'} />
                  {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' && (
                    <StatusApprovalBadge status={ticket.approvalStatus} />
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
                  <span className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#A79BC0] tabular-nums">
                    Update: {formatLastUpdatedJakarta(ticket.updatedAt || ticket.createdAt)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectTicket(ticket, 'overview')}
                      className="btn-3d-secondary px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Detail</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectTicket(ticket, 'history')}
                      className="btn-3d-secondary px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      title="Riwayat Aktivitas"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectTicket(ticket, 'chat')}
                      className="btn-3d-secondary px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      title="LiveChat Komunikasi"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                    {canReassign && (
                      <button
                        type="button"
                        onClick={() => handleOpenReassign(ticket)}
                        className="btn-3d-primary px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>Reassign</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="bg-white/95 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-2xl overflow-hidden shadow-xs dark:shadow-none">
          <div className="overflow-x-auto">
            <table className="mj-zebra-table w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EDF3F8] dark:bg-[#22123F] border-b border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                  <th className="pl-3.5 pr-2 py-3 w-10 text-center">
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Pilih semua WO overdue pada tabel ini"
                      className="w-4 h-4 rounded border-[#CFDCE8] dark:border-[#B7A9CE] accent-[#6657C8] dark:accent-[#58149C] cursor-pointer align-middle"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderSearchPopover
                      label="WO Number"
                      value={woSearch}
                      onChange={setWoSearch}
                      placeholder="Cari WO Number..."
                      sortActive={sortColumn === 'woNumber'}
                      sortDir={sortColumn === 'woNumber' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('woNumber')}
                      testId="overdue-hdr-wo"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderSearchPopover
                      label="Customer ID"
                      value={customerIdSearch}
                      onChange={setCustomerIdSearch}
                      placeholder="Cari ID Customer..."
                      sortActive={sortColumn === 'idCustomer'}
                      sortDir={sortColumn === 'idCustomer' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('idCustomer')}
                      testId="overdue-hdr-cid"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderSearchPopover
                      label="Customer Name"
                      value={customerNameSearch}
                      onChange={setCustomerNameSearch}
                      placeholder="Cari Nama Pelanggan..."
                      sortActive={sortColumn === 'customerName'}
                      sortDir={sortColumn === 'customerName' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('customerName')}
                      testId="overdue-hdr-cname"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderCategoryDropdown
                      label="Contractor"
                      value={contractorFilter}
                      defaultValue="ALL"
                      allLabel="Semua Contractor"
                      options={[
                        { value: 'ALL', label: 'Semua Contractor' },
                        ...filterOptions.contractors.map(c => ({ value: c, label: c }))
                      ]}
                      onChange={setContractorFilter}
                      sortActive={sortColumn === 'contractor'}
                      sortDir={sortColumn === 'contractor' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('contractor')}
                      testId="overdue-hdr-contractor"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderCategoryDropdown
                      label="Area"
                      value={areaFilter}
                      defaultValue="ALL"
                      allLabel="Semua Area"
                      options={[
                        { value: 'ALL', label: 'Semua Area' },
                        ...filterOptions.areas.map(a => ({ value: a, label: a }))
                      ]}
                      onChange={setAreaFilter}
                      sortActive={sortColumn === 'area'}
                      sortDir={sortColumn === 'area' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('area')}
                      testId="overdue-hdr-area"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderDateSortFilterPopover
                      label="Appointment Date"
                      sortActive={sortColumn === 'appointmentDate'}
                      sortDir={sortColumn === 'appointmentDate' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('appointmentDate')}
                      exactDate={exactAppointmentDate}
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      onChangeDates={({ exactDate, dateFrom: df, dateTo: dt }) => {
                        setExactAppointmentDate(exactDate);
                        setDateFrom(df);
                        setDateTo(dt);
                      }}
                      testId="overdue-hdr-date"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderCategoryDropdown
                      label="Installer"
                      value={installerFilter}
                      defaultValue="ALL"
                      allLabel="Semua Installer"
                      options={[
                        { value: 'ALL', label: 'Semua Installer' },
                        ...filterOptions.installers.map(inst => ({ value: inst, label: inst }))
                      ]}
                      onChange={setInstallerFilter}
                      sortActive={sortColumn === 'installerName'}
                      sortDir={sortColumn === 'installerName' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('installerName')}
                      testId="overdue-hdr-installer"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderCategoryDropdown
                      label="Current Progress"
                      value={statusFilter}
                      defaultValue="ALL"
                      allLabel="Semua Status"
                      options={[
                        { value: 'ALL', label: 'Semua Status' },
                        ...filterOptions.statuses.map(st => ({ value: st, label: st }))
                      ]}
                      onChange={setStatusFilter}
                      sortActive={sortColumn === 'status'}
                      sortDir={sortColumn === 'status' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('status')}
                      testId="overdue-hdr-status"
                    />
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    {viewMode === 'exception' ? (
                      'Exception Reason'
                    ) : (
                      <HeaderCategoryDropdown
                        label="Overdue Duration"
                        value={durationFilter}
                        defaultValue="ALL"
                        allLabel="Semua Durasi"
                        options={[
                          { value: 'ALL', label: 'Semua Durasi' },
                          { value: '1_day', label: '1 Hari' },
                          { value: '2_3_days', label: '2–3 Hari' },
                          { value: '4_7_days', label: '4–7 Hari' },
                          { value: 'gt_7_days', label: 'Critical (>7 Hari)' }
                        ]}
                        onChange={v => setDurationFilter(v as 'ALL' | OverdueDurationBucket)}
                        sortActive={sortColumn === 'overdueDays'}
                        sortDir={sortColumn === 'overdueDays' ? sortDirection : null}
                        onCycleSort={() => handleCycleSort('overdueDays')}
                        testId="overdue-hdr-duration"
                      />
                    )}
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap">
                    <HeaderSortButton
                      label="Last Updated"
                      sortActive={sortColumn === 'updatedAt'}
                      sortDir={sortColumn === 'updatedAt' ? sortDirection : null}
                      onCycleSort={() => handleCycleSort('updatedAt')}
                      testId="overdue-hdr-updated"
                    />
                  </th>
                  <th className="px-3.5 py-3 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDE6F0] dark:divide-[#35105E]">
                {paginatedTickets.map(ticket => {
                  const contractor = ticket.contactorName || ticket.contractorName || '-';
                  const leaderLabel = ticket.leaderName || ticket.corlapName;
                  const canReassign =
                    isLeaderRole &&
                    viewMode === 'overdue' &&
                    Boolean(ticket.installerName) &&
                    !isTicketClosed(ticket);
                  const isSelected = selectedIdSet.has(ticket.id);

                  return (
                    <tr
                      key={ticket.id}
                      className={`transition-colors ${
                        isSelected
                          ? 'bg-[#EAE8FF]/85 dark:bg-[#2C1A4E]'
                          : 'hover:bg-[#F0EDFF]/65 dark:hover:bg-[#1E1238]/70'
                      }`}
                    >
                      <td className="pl-3.5 pr-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(ticket.id)}
                          aria-label={`Pilih ${ticket.woNumber}`}
                          className="w-4 h-4 rounded border-[#CFDCE8] dark:border-[#B7A9CE] accent-[#6657C8] dark:accent-[#58149C] cursor-pointer align-middle"
                        />
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectTicket(ticket, 'overview')}
                          className="font-mono font-extrabold text-[#5145A6] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                        >
                          {ticket.woNumber}
                        </button>
                      </td>
                      <td className="px-3.5 py-3 font-mono text-[#52647A] dark:text-[#CEC0E8] whitespace-nowrap tabular-nums">
                        {ticket.idCustomer || ticket.customerId || '-'}
                      </td>
                      <td className="px-3.5 py-3 max-w-[200px]">
                        <div className="font-bold text-[#26364A] dark:text-white truncate">
                          {ticket.customerName}
                        </div>
                        {ticket.clusterName && (
                          <div className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] truncate">
                            {ticket.clusterName}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-3 max-w-[170px] truncate font-medium text-[#26364A] dark:text-slate-200">
                        {contractor}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap text-[#52647A] dark:text-[#CEC0E8]">
                        {ticket.area || '-'}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 font-mono font-semibold text-[#26364A] dark:text-white tabular-nums">
                          <Calendar className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#DAB9FF]" />
                          <span>{ticket.appointmentDate || 'Kosong / Invalid'}</span>
                        </div>
                        {ticket.slotTime && (
                          <div className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] font-mono">
                            {ticket.slotTime}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-3 max-w-[180px]">
                        <div className="font-semibold text-[#26364A] dark:text-white truncate flex items-center gap-1">
                          <Wrench className="w-3 h-3 text-[#2E7D8B] dark:text-[#DAB9FF] shrink-0" />
                          <span className="truncate">{ticket.installerName || 'Unassigned'}</span>
                        </div>
                        {leaderLabel && (
                          <div className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] truncate">
                            Leader: {leaderLabel}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusAgentBadge status={ticket.statusWOAgent || 'Pending'} />
                          <StatusInstallerBadge status={ticket.statusWOInstaller || 'Assigned'} />
                          {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' && (
                            <StatusApprovalBadge status={ticket.approvalStatus} />
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        {viewMode === 'exception' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border bg-[#FFF2D9] text-[#9D661F] border-[#F2CF95] dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800">
                            Tanggal Invalid / Kosong
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10.5px] font-mono font-bold border tabular-nums ${getDurationTextBadgeClass(
                                ticket.overdueDurationBucket
                              )}`}
                            >
                              {getOverdueDurationLabel(ticket.overdueDays || 0)}
                            </span>
                            <div className="text-[10px] font-semibold text-[#8492A5] dark:text-[#A79BC0]">
                              {getOverdueBucketLabel(ticket.overdueDurationBucket)}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono text-[11px] text-[#52647A] dark:text-[#CEC0E8] tabular-nums">
                        {formatLastUpdatedJakarta(ticket.updatedAt || ticket.createdAt)}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onSelectTicket(ticket, 'overview')}
                            title="Buka Detail & Laporan Teknisi"
                            className="p-1.5 rounded-lg border border-[#DDE6F0] dark:border-[#4B386B] text-[#5145A6] dark:text-[#DAB9FF] hover:bg-[#EAE8FF] dark:hover:bg-[#261942] cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectTicket(ticket, 'history')}
                            title="Lihat Activity History"
                            className="p-1.5 rounded-lg border border-[#DDE6F0] dark:border-[#4B386B] text-[#52647A] dark:text-[#CEC0E8] hover:bg-[#EAE8FF] dark:hover:bg-[#261942] cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectTicket(ticket, 'chat')}
                            title="Buka LiveChat Komunikasi"
                            className="p-1.5 rounded-lg border border-[#DDE6F0] dark:border-[#4B386B] text-[#52647A] dark:text-[#CEC0E8] hover:bg-[#EAE8FF] dark:hover:bg-[#261942] cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                          {onOpenWhatsApp && ticket.customerPhone && (
                            <button
                              type="button"
                              onClick={() => onOpenWhatsApp(ticket)}
                              title="Kirim WhatsApp Pelanggan"
                              className="p-1.5 rounded-lg border border-[#B7E4CC] dark:border-emerald-800 text-[#218A63] dark:text-emerald-300 hover:bg-[#E4F5EC] dark:hover:bg-emerald-950/50 cursor-pointer"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canReassign && (
                            <button
                              type="button"
                              onClick={() => handleOpenReassign(ticket)}
                              title="Reassign Teknisi (Tetap Pertahankan Riwayat & Appointment)"
                              className="btn-3d-primary px-2.5 py-1 rounded-lg text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                              <span>Reassign</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredTickets.length > 0 && (
        <PaginationBar
          totalItems={filteredTickets.length}
          totalPages={totalPages}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={size => {
            setPageSize(size);
            setCurrentPage(1);
          }}
          itemLabel={viewMode === 'exception' ? 'Exception WO' : 'Overdue WO'}
        />
      )}

      {/* Reuse Existing Leader Two-Step Reassign Modal */}
      {isLeaderRole && (
        <LeaderTwoStepReassignModal
          isOpen={Boolean(reassignTicket)}
          onClose={() => {
            if (!isReassignSubmitting) setReassignTicket(null);
          }}
          ticket={reassignTicket}
          technicians={technicianCapacitySummaries}
          quotaConfig={quotaConfig}
          currentUser={currentUser}
          displayContractor={currentUser.contractor || contractorsList?.[0] || 'Mitra Kontraktor'}
          displayArea={currentUser.area || areasList?.[0] || 'Area Operasional'}
          isLeaderRole={isLeaderRole}
          isSubmitting={isReassignSubmitting}
          onConfirmReassign={handleConfirmReassign}
        />
      )}
    </div>
  );
};
