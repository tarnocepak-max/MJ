import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { Ticket, User } from '../../types';
import {
  formatAppointmentDateDisplay,
  getTicketAppointmentDate,
  getJakartaDateString
} from '../../services/appointmentDateParser';
import {
  formatJakartaTimeOnly,
  getTicketWorkStatus
} from '../../services/workSessionService';
import { buildWhatsAppClickToChatUrl, isValidPhoneNumber } from '../../services/whatsappService';
import {
  Inbox,
  UserCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Eye,
  MessageSquare,
  FileSpreadsheet,
  Printer,
  Copy,
  Download,
  Calendar,
  ArrowUpDown,
  ExternalLink,
  MapPin,
  Timer,
  X,
  RefreshCw,
  Radio,
  Image as ImageIcon,
  ZoomIn,
  Navigation,
  Phone,
  Send,
  SlidersHorizontal
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { DashboardKpiSummaryCards } from '../dashboard/DashboardKpiSummaryCards';
import { StatusBadge } from '../common/Badge';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { PaginationBar } from '../common/PaginationBar';
import { matchesKpiFilter, KPI_FILTER_LABELS } from '../../services/woLifecycleService';
import {
  HeaderCategoryDropdown,
  HeaderSearchPopover,
  HeaderSortButton,
  TableResetFilterButton
} from '../common/InteractiveTableHeader';
import {
  SortState,
  getNextSortDirection,
  sortDataArray
} from '../../utils/tableSorting';
import { ActionDropdownMenu, DropdownActionItem } from '../common/ActionDropdownMenu';

interface LeaderProgressDashboardViewProps {
  onSelectTicket: (ticket: Ticket) => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

type StatCategoryFilter = 'all' | 'unassign' | 'assign' | 'untouch' | 'complete' | 'uncomplete' | 'cancel';

interface EvidencePhotoItem {
  url: string;
  label: string;
}

const isScopeTextMatch = (a?: string | null, b?: string | null): boolean => {
  const na = String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const nb = String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
};

export const LeaderProgressDashboardView: React.FC<LeaderProgressDashboardViewProps> = ({
  onSelectTicket,
  onOpenWhatsApp
}) => {
  const {
    tickets,
    users,
    currentUser,
    contractorsList,
    todayWIB,
    activeKpiDrilldown,
    setActiveKpiDrilldown,
    refreshDatabaseData
  } = useApp();
  const { isCompactUI } = useResponsiveViewport();

  const [searchQuery, setSearchQuery] = useState('');
  const [woSearch, setWoSearch] = useState('');
  const [installerFilter, setInstallerFilter] = useState<string>('ALL');
  const [areaFilter, setAreaFilter] = useState<string>('ALL');
  const [workStatusFilter, setWorkStatusFilter] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<StatCategoryFilter>('all');
  const effectiveViewMode: 'cards' | 'table' = isCompactUI ? 'cards' : 'table';
  const [showLifecycleKpi, setShowLifecycleKpi] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [sortState, setSortState] = useState<SortState>({ column: 'woNumber', direction: 'asc' });
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [copySuccess, setCopySuccess] = useState(false);

  // Lightbox modal state for real field evidence photos
  const [lightboxData, setLightboxData] = useState<{
    woNumber: string;
    installerName: string;
    photos: EvidencePhotoItem[];
    activeIndex: number;
  } | null>(null);

  // Broadcast guidance modal state
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState(
    'Halo Tim Lapangan, mohon pastikan cek redaman OPM sebelum & sesudah aktivasi ODP/FAT serta unggah bukti foto sesuai SOP MoraJaws. Terima kasih.'
  );
  const [broadcastCopied, setBroadcastCopied] = useState(false);

  const todayJakarta = todayWIB || getJakartaDateString(0);
  const leaderContractor = currentUser?.contractor || contractorsList?.[0] || '';
  const leaderArea = currentUser?.area || '';

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await refreshDatabaseData();
    } finally {
      setIsSyncing(false);
    }
  };

  // Scope active installers for WhatsApp fallback & Broadcast modal
  const scopedInstallers = useMemo(() => {
    return users.filter(u => {
      if (u.role !== 'installer' || u.active === false || u.isArchived) return false;
      if (currentUser.role === 'leader') {
        if (leaderContractor && !isScopeTextMatch(u.contractor, leaderContractor)) return false;
        if (leaderArea && u.area && !isScopeTextMatch(u.area, leaderArea)) return false;
      }
      return true;
    });
  }, [users, currentUser.role, leaderContractor, leaderArea]);

  const findInstallerUser = (t: Ticket): User | undefined => {
    if (t.installerId) {
      const byId = users.find(u => u.id === t.installerId);
      if (byId) return byId;
    }
    if (t.installerName) {
      const nameNorm = t.installerName.trim().toLowerCase();
      return users.find(u => u.name.trim().toLowerCase() === nameNorm);
    }
    return undefined;
  };

  // Filter contractor tickets & strict Appointment Date === todayJakarta
  const baseLeaderTickets = useMemo(() => {
    return tickets.filter(t => {
      if (t.isArchived || t.isDeleted) return false;

      if (currentUser.role === 'leader') {
        const ticketContr = (t.contactorName || t.contractorName || '').trim();
        if (leaderContractor && !isScopeTextMatch(ticketContr, leaderContractor)) {
          return false;
        }
        if (leaderArea && t.area && !isScopeTextMatch(t.area, leaderArea)) {
          const directLeader =
            (t.leaderId && t.leaderId === currentUser.id) ||
            (t.leaderName && isScopeTextMatch(t.leaderName, currentUser.name));
          if (!directLeader) return false;
        }
      }

      const appDate = getTicketAppointmentDate(t);
      return Boolean(appDate && appDate === todayJakarta);
    });
  }, [tickets, currentUser.role, currentUser.id, currentUser.name, leaderContractor, leaderArea, todayJakarta]);

  const getTicketCategory = (t: Ticket): 'unassign' | 'assign' | 'untouch' | 'complete' | 'uncomplete' | 'cancel' => {
    const installerStatus = (t.statusWOInstaller || '').toLowerCase();
    const agentStatus = (t.statusWOAgent || '').toLowerCase();
    const hasInstaller = Boolean(t.installerName && t.installerName.trim());

    if (installerStatus.includes('cancel') || agentStatus.includes('cancel')) {
      return 'cancel';
    }
    if (
      installerStatus.includes('complete') ||
      installerStatus.includes('selesai') ||
      installerStatus === 'installed' ||
      agentStatus.includes('complete') ||
      agentStatus === 'resolved' ||
      agentStatus === 'closed'
    ) {
      return 'complete';
    }
    if (
      installerStatus.includes('uncomplete') ||
      installerStatus.includes('pending') ||
      installerStatus.includes('kendala') ||
      agentStatus.includes('uncomplete')
    ) {
      return 'uncomplete';
    }
    if (!hasInstaller || installerStatus.includes('unassign') || installerStatus === 'draft') {
      return 'unassign';
    }
    if (installerStatus.includes('untouch') || installerStatus === 'assigned') {
      return 'untouch';
    }
    return 'assign';
  };

  // 6 Live Stat Counts calculated strictly from today's scoped tickets
  const statCounts = useMemo(() => {
    let unassign = 0;
    let assign = 0;
    let untouch = 0;
    let complete = 0;
    let uncomplete = 0;
    let cancel = 0;

    baseLeaderTickets.forEach(t => {
      const cat = getTicketCategory(t);
      if (cat === 'unassign') unassign++;
      else if (cat === 'assign') assign++;
      else if (cat === 'untouch') untouch++;
      else if (cat === 'complete') complete++;
      else if (cat === 'uncomplete') uncomplete++;
      else if (cat === 'cancel') cancel++;
    });

    return {
      unassign,
      assign,
      untouch,
      complete,
      uncomplete,
      cancel,
      total: baseLeaderTickets.length
    };
  }, [baseLeaderTickets]);

  const scopedInstallerOptions = useMemo(() => {
    const set = new Set<string>();
    baseLeaderTickets.forEach(t => {
      const name = String(t.installerName || '').trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseLeaderTickets]);

  const scopedAreaOptions = useMemo(() => {
    const set = new Set<string>();
    baseLeaderTickets.forEach(t => {
      const a = String(t.area || '').trim();
      if (a) set.add(a);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseLeaderTickets]);

  const workStatusOptions = useMemo(() => {
    const set = new Set<string>();
    baseLeaderTickets.forEach(t => {
      const ws = getTicketWorkStatus(t).status;
      if (ws) set.add(ws);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseLeaderTickets]);

  // Filtered & Sorted Tickets (with strict NULLS LAST via sortDataArray)
  const filteredTickets = useMemo(() => {
    return baseLeaderTickets.filter(t => {
      if (activeKpiDrilldown) {
        if (activeKpiDrilldown.contractor && activeKpiDrilldown.contractor !== 'ALL') {
          const tCont = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
          if (tCont !== activeKpiDrilldown.contractor.trim().toLowerCase()) return false;
        }
        if (activeKpiDrilldown.area && activeKpiDrilldown.area !== 'ALL') {
          const tArea = String(t.area || '').trim().toLowerCase();
          if (tArea !== activeKpiDrilldown.area.trim().toLowerCase()) return false;
        }
        if (!matchesKpiFilter(t, activeKpiDrilldown.filterKey)) return false;
      }

      if (selectedCategory !== 'all') {
        const cat = getTicketCategory(t);
        if (cat !== selectedCategory) return false;
      }

      if (installerFilter !== 'ALL') {
        if (String(t.installerName || '').trim().toLowerCase() !== installerFilter.trim().toLowerCase()) {
          return false;
        }
      }

      if (areaFilter !== 'ALL') {
        if (String(t.area || '').trim().toLowerCase() !== areaFilter.trim().toLowerCase()) {
          return false;
        }
      }

      if (workStatusFilter !== 'ALL') {
        if (getTicketWorkStatus(t).status !== workStatusFilter) return false;
      }

      if (woSearch.trim()) {
        const q = woSearch.trim().toLowerCase();
        const hay = `${t.woNumber || ''} ${t.idCustomer || ''} ${t.customerName || ''} ${t.clusterName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const wo = (t.woNumber || '').toLowerCase();
        const cid = (t.idCustomer || '').toLowerCase();
        const cname = (t.customerName || '').toLowerCase();
        const inst = (t.installerName || '').toLowerCase();
        const addr = (t.address || t.streetName || '').toLowerCase();
        const cluster = (t.clusterName || (t as any).cluster || '').toLowerCase();
        const fdt = `${t.fdtCode || ''} ${t.fatCode || ''}`.toLowerCase();
        return (
          wo.includes(q) ||
          cid.includes(q) ||
          cname.includes(q) ||
          inst.includes(q) ||
          addr.includes(q) ||
          cluster.includes(q) ||
          fdt.includes(q)
        );
      }

      return true;
    });
  }, [
    baseLeaderTickets,
    activeKpiDrilldown,
    selectedCategory,
    installerFilter,
    areaFilter,
    workStatusFilter,
    woSearch,
    searchQuery
  ]);

  const handleSort = (field: string) => {
    setSortState(prev => {
      const nextDir = getNextSortDirection(prev.column, prev.direction, field);
      return {
        column: nextDir ? field : null,
        direction: nextDir
      };
    });
    setCurrentPage(1);
  };

  const displayTickets = useMemo(() => {
    if (!sortState.column || !sortState.direction) return filteredTickets;
    return sortDataArray(filteredTickets, sortState, (t: Ticket, col: string) => {
      switch (col) {
        case 'installerName':
          return t.installerName || '';
        case 'idCustomer':
          return t.idCustomer || '';
        case 'woNumber':
          return t.woNumber || '';
        case 'area':
          return t.area || '';
        case 'contractor':
          return t.contactorName || t.contractorName || '';
        case 'checkInAt':
          return t.checkInAt || '';
        case 'checkOutAt':
          return t.checkOutAt || '';
        case 'workDuration':
          return t.workDurationMinutes ?? null;
        case 'workStatus':
          return getTicketWorkStatus(t).status;
        default:
          return (t as any)[col] ?? '';
      }
    });
  }, [filteredTickets, sortState]);

  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (woSearch.trim() ? 1 : 0) +
    (installerFilter !== 'ALL' ? 1 : 0) +
    (areaFilter !== 'ALL' ? 1 : 0) +
    (workStatusFilter !== 'ALL' ? 1 : 0) +
    (selectedCategory !== 'all' ? 1 : 0) +
    (activeKpiDrilldown ? 1 : 0);

  const handleResetFilters = () => {
    setSearchQuery('');
    setWoSearch('');
    setInstallerFilter('ALL');
    setAreaFilter('ALL');
    setWorkStatusFilter('ALL');
    setSelectedCategory('all');
    if (activeKpiDrilldown) setActiveKpiDrilldown(null);
    setSortState({ column: 'woNumber', direction: 'asc' });
    setCurrentPage(1);
  };

  // Pagination
  const totalPages = rowsPerPage === -1 ? 1 : Math.max(1, Math.ceil(displayTickets.length / rowsPerPage));
  const paginatedTickets = useMemo(() => {
    if (rowsPerPage === -1) return displayTickets;
    const start = (currentPage - 1) * rowsPerPage;
    return displayTickets.slice(start, start + rowsPerPage);
  }, [displayTickets, currentPage, rowsPerPage]);

  const toggleRowExpand = (id: string) => {
    setExpandedRowIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Export functions
  const handleCopy = () => {
    const textRows = displayTickets.map(t =>
      `${t.idCustomer || '-'}\t${t.woNumber}\t${t.appointmentDate || '-'}\t${t.installerName || '-'}\t${t.statusWOInstaller || '-'}`
    );
    const header = 'ID Customer\tWO Number\tDate WO\tInstaller\tStatus Installer';
    navigator.clipboard.writeText([header, ...textRows].join('\n')).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const handleExportCSV = () => {
    const csvRows = [
      ['ID Customer', 'WO Number', 'Date WO', 'Installer', 'Slot Time', 'WO Agent', 'WO Reason Agent', 'WO Installer', 'WO Reason Installer', 'WO Remarks Installer']
    ];
    displayTickets.forEach(t => {
      csvRows.push([
        t.idCustomer || '',
        t.woNumber || '',
        t.appointmentDate || '',
        t.installerName || '',
        t.slotTime || '',
        t.statusWOAgent || '',
        (t as any).reasonWOAgent || '',
        t.statusWOInstaller || '',
        (t as any).reasonWOInstaller || '',
        t.remarksWOInstaller || ''
      ]);
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map(e => e.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Leader_Progress_WO_${todayJakarta}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    const data = displayTickets.map(t => ({
      'ID Customer': t.idCustomer || '-',
      'WO Number': t.woNumber,
      'Date WO': t.appointmentDate || '-',
      'Installer': t.installerName || 'Unassigned',
      'Slot Time': t.slotTime || '-',
      'WO Agent': t.statusWOAgent || '-',
      'WO Reason Agent': (t as any).reasonWOAgent || '-',
      'WO Installer': t.statusWOInstaller || '-',
      'WO Reason Installer': (t as any).reasonWOInstaller || '-',
      'WO Remarks Installer': t.remarksWOInstaller || '-'
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Progress WO');
    XLSX.writeFile(workbook, `Leader_Progress_WO_${todayJakarta}.xlsx`);
  };

  const handlePrint = () => {
    window.print();
  };

  const collectEvidencePhotos = (t: Ticket): EvidencePhotoItem[] => {
    const items: EvidencePhotoItem[] = [];
    const seen = new Set<string>();
    (t.technicalReport?.photoSlots || []).forEach(slot => {
      if (slot.url && !seen.has(slot.url)) {
        seen.add(slot.url);
        items.push({
          url: slot.url,
          label: slot.fileName || slot.title || slot.slotKey
        });
      }
    });
    (t.technicalReport?.photos || []).forEach((url, idx) => {
      if (url && !seen.has(url)) {
        seen.add(url);
        items.push({
          url,
          label: `Foto Lapangan ${idx + 1}`
        });
      }
    });
    return items;
  };

  const getCardProgressMeta = (t: Ticket, cat: ReturnType<typeof getTicketCategory>) => {
    if (cat === 'complete') {
      return { percent: 100, barColor: 'bg-[#218A63] dark:bg-emerald-500', label: 'Pekerjaan Selesai / Terverifikasi Lapangan', badgeCls: 'bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-800', badgeText: 'Selesai' };
    }
    if (cat === 'uncomplete') {
      return { percent: 45, barColor: 'bg-amber-500', label: t.statusWOInstaller || 'Kendala Teknis / Pending', badgeCls: 'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-300 border-[#F2CF95] dark:border-amber-800', badgeText: 'Kendala' };
    }
    if (cat === 'cancel') {
      return { percent: 15, barColor: 'bg-[#D45B66] dark:bg-rose-500', label: 'Dibatalkan / Gagal', badgeCls: 'bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-300 border-[#F3C5CA] dark:border-rose-800', badgeText: 'Batal' };
    }
    if (cat === 'assign') {
      const ws = getTicketWorkStatus(t);
      const isOnSite = t.statusWOInstaller === 'On Site' || t.statusWOInstaller === 'In Progress' || t.statusWOInstaller === 'PROGRESS' || Boolean(t.checkInAt);
      return {
        percent: isOnSite ? 75 : 50,
        barColor: 'bg-[#2E7D8B] dark:bg-[#7C3AED]',
        label: ws.status === 'Sedang Dikerjakan' ? 'Sedang Dikerjakan (Checked-In)' : t.statusWOInstaller || 'Dalam Perjalanan / Proses',
        badgeCls: 'bg-[#DDF4F4] dark:bg-[#2E1B59] text-[#2E7D8B] dark:text-[#DAB9FF] border-[#BDE4E8] dark:border-[#5B35B1]',
        badgeText: isOnSite ? 'On Site' : 'Sedang Jalan'
      };
    }
    if (cat === 'untouch') {
      return { percent: 25, barColor: 'bg-[#6657C8] dark:bg-[#7135B5]', label: 'Ditugaskan — Menunggu Check-in Teknisi', badgeCls: 'bg-[#EAE8FF] dark:bg-[#2E1B59] text-[#5145A6] dark:text-[#DAB9FF] border-[#DCE3F2] dark:border-[#5B35B1]', badgeText: 'Menunggu' };
    }
    return { percent: 0, barColor: 'bg-slate-300 dark:bg-slate-600', label: 'Belum Di-assign ke Teknisi', badgeCls: 'bg-[#EDF3F8] dark:bg-[#261942] text-[#52647A] dark:text-[#CEC0E8] border-[#DDE6F0] dark:border-[#3E246F]', badgeText: 'Unassign' };
  };

  const filterChips: { id: StatCategoryFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Semua Status', count: statCounts.total },
    { id: 'assign', label: 'Sedang Jalan', count: statCounts.assign },
    { id: 'uncomplete', label: 'Kendala', count: statCounts.uncomplete },
    { id: 'untouch', label: 'Menunggu', count: statCounts.untouch },
    { id: 'complete', label: 'Selesai', count: statCounts.complete },
    { id: 'unassign', label: 'Belum Assign', count: statCounts.unassign },
    { id: 'cancel', label: 'Batal', count: statCounts.cancel }
  ];

  const handleCopyBroadcast = () => {
    if (!broadcastMessage.trim()) return;
    navigator.clipboard.writeText(broadcastMessage.trim()).then(() => {
      setBroadcastCopied(true);
      setTimeout(() => setBroadcastCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Stitch Operational Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#2E7D8B] dark:text-[#7C3AED]">
            PEMANTAUAN LAPANGAN
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#26364A] dark:text-white leading-tight font-['Plus_Jakarta_Sans',sans-serif]">
            Status Pengerjaan WO
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#52647A] dark:text-slate-300">
            <span className="font-semibold text-[#5145A6] dark:text-[#d0bcff]">{leaderContractor}</span>
            {leaderArea && <span>• {leaderArea}</span>}
            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
              <Calendar className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#7C3AED]" />
              {formatAppointmentDateDisplay(todayJakarta)} ({todayJakarta})
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className={`mj-btn-leader-neutral inline-flex items-center gap-1.5 px-3 py-2 text-xs text-[#26364A] dark:text-purple-100 cursor-pointer ${
              isSyncing ? 'mj-btn-loading' : ''
            }`}
            title="Sinkronkan progres lapangan terbaru dari server"
          >
            <span className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`} />
            <RefreshCw className={`w-3.5 h-3.5 text-[#5145A6] dark:text-[#d0bcff] ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Sinkron...' : 'Auto-Sync'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowLifecycleKpi(prev => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer ${
              showLifecycleKpi
                ? 'mj-btn-leader-primary'
                : 'mj-btn-leader-neutral text-[#52647A] dark:text-slate-200'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">KPI Lifecycle</span>
          </button>
        </div>
      </div>

      {/* Collapsible Live WO Lifecycle KPI Summary Cards */}
      {showLifecycleKpi && (
        <DashboardKpiSummaryCards
          compact={true}
          onDrillDown={(filterKey, filters) => {
            setActiveKpiDrilldown({
              filterKey,
              dateWIB: todayJakarta,
              contractor: filters?.contractor,
              area: filters?.area
            });
            setSelectedCategory('all');
            setCurrentPage(1);
          }}
        />
      )}

      {/* Active KPI Filter Banner */}
      {activeKpiDrilldown && (
        <div className="rounded-xl bg-gradient-to-r from-[#EAE8FF] to-[#DDF4F4] dark:bg-none dark:bg-[#1f1638] text-[#26364A] dark:text-white px-4 py-3 border border-[#BDE4E8] dark:border-[#3E246F] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-[#6657C8] dark:bg-[#7135B5] text-white font-bold text-[10.5px]">
              Filter KPI Dashboard
            </span>
            <span className="font-bold">
              {KPI_FILTER_LABELS[activeKpiDrilldown.filterKey] || activeKpiDrilldown.filterKey}
            </span>
            <span className="font-mono font-bold text-[#5145A6] dark:text-[#E9D5FF] tabular-nums">
              ({displayTickets.length} WO ditemukan)
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveKpiDrilldown(null);
              setCurrentPage(1);
            }}
            className="mj-btn-leader-neutral mj-btn-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[#26364A] dark:text-white text-xs cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset Filter KPI</span>
          </button>
        </div>
      )}

      {/* 6-Card Stitch Status KPI Grid (Unassign, Menunggu/Untouch, Check-in/Progress, Complete, Pending/Kendala, Cancel) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
        {[
          {
            key: 'unassign' as const,
            label: 'UNASSIGN',
            count: statCounts.unassign,
            icon: Inbox,
            barColor: 'bg-[#8492A5] dark:bg-[#7D7484]',
            badgeColor: 'text-[#52647A] dark:text-[#CEC0E8]',
            activeCls: 'bg-[#EDF3F8] dark:bg-[#2a174a] border-[#6657C8] dark:border-[#7135B5] ring-2 ring-[#6657C8]/25 dark:ring-[#7135B5]/30'
          },
          {
            key: 'untouch' as const,
            label: 'MENUNGGU',
            count: statCounts.untouch,
            icon: Clock,
            barColor: 'bg-[#6657C8] dark:bg-[#58149C]',
            badgeColor: 'text-[#5145A6] dark:text-[#D8B4FE]',
            activeCls: 'bg-[#EAE8FF] dark:bg-[#2a174a] border-[#6657C8] dark:border-[#58149C] ring-2 ring-[#6657C8]/25 dark:ring-[#58149C]/30'
          },
          {
            key: 'assign' as const,
            label: 'CHECK-IN',
            count: statCounts.assign,
            icon: RefreshCw,
            barColor: 'bg-[#2E7D8B] dark:bg-[#7C3AED]',
            badgeColor: 'text-[#2E7D8B] dark:text-[#D8B4FE]',
            activeCls: 'bg-[#DDF4F4] dark:bg-[#2a174a] border-[#2E7D8B] dark:border-[#7C3AED] ring-2 ring-[#2E7D8B]/25 dark:ring-[#7C3AED]/30'
          },
          {
            key: 'complete' as const,
            label: 'COMPLETE',
            count: statCounts.complete,
            icon: CheckCircle2,
            barColor: 'bg-[#218A63] dark:bg-emerald-500',
            badgeColor: 'text-[#218A63] dark:text-emerald-400',
            activeCls: 'bg-[#E4F5EC] dark:bg-emerald-950/40 border-[#218A63] dark:border-emerald-500 ring-2 ring-emerald-500/25'
          },
          {
            key: 'uncomplete' as const,
            label: 'PENDING',
            count: statCounts.uncomplete,
            icon: AlertTriangle,
            barColor: 'bg-amber-500',
            badgeColor: 'text-[#9D661F] dark:text-amber-400',
            activeCls: 'bg-[#FFF2D9] dark:bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/25'
          },
          {
            key: 'cancel' as const,
            label: 'CANCEL',
            count: statCounts.cancel,
            icon: XCircle,
            barColor: 'bg-[#D45B66] dark:bg-[#881337]',
            badgeColor: 'text-[#9B2C37] dark:text-rose-400',
            activeCls: 'bg-[#FCE9EB] dark:bg-rose-950/40 border-[#D45B66] dark:border-[#881337] ring-2 ring-[#D45B66]/25 dark:ring-[#881337]/25'
          }
        ].map(tile => {
          const IconComp = tile.icon;
          const pct = statCounts.total > 0 ? Math.min(100, Math.round((tile.count / statCounts.total) * 100)) : 0;
          const isActive = selectedCategory === tile.key;
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => {
                setSelectedCategory(isActive ? 'all' : tile.key);
                setCurrentPage(1);
              }}
              className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                isActive
                  ? `${tile.activeCls} shadow-sm`
                  : 'bg-white dark:bg-[#1A0E2E] border-[#DDE6F0] dark:border-purple-900/60 hover:border-[#6657C8]/50 dark:hover:border-[#7135B5]/50'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-extrabold tracking-wider uppercase text-[#52647A] dark:text-slate-300 truncate">
                  {tile.label}
                </span>
                <IconComp className={`w-3.5 h-3.5 shrink-0 ${tile.badgeColor}`} />
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-1">
                <span className="text-xl sm:text-2xl font-bold font-mono text-[#26364A] dark:text-white tabular-nums">
                  {tile.count}
                </span>
                <span className={`text-[10px] font-mono font-bold ${tile.badgeColor}`}>
                  {pct}%
                </span>
              </div>
              <div className="mt-2 h-1 w-full rounded-full bg-[#EDF3F8] dark:bg-purple-950 overflow-hidden">
                <div
                  className={`h-full ${tile.barColor} rounded-full transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Horizontal Filter Chips + Compact Reset / Mobile Header Popovers */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar flex-1 min-w-0">
            {filterChips.map(chip => {
              const active = selectedCategory === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(chip.id);
                    setCurrentPage(1);
                  }}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs cursor-pointer ${
                    active
                      ? 'mj-btn-leader-secondary mj-btn-xs'
                      : 'mj-btn-leader-neutral mj-btn-xs'
                  }`}
                >
                  {chip.label} ({chip.count})
                </button>
              );
            })}
          </div>

          <TableResetFilterButton
            activeCount={activeFilterCount}
            onReset={handleResetFilters}
            label="Reset Search/Filter"
            testId="leader-progress-reset-filters"
          />
        </div>

        {isCompactUI && (
          <div className="flex flex-wrap items-center gap-1.5">
            <HeaderSearchPopover
              label="WO / Pelanggan"
              value={woSearch}
              onChange={val => {
                setWoSearch(val);
                setCurrentPage(1);
              }}
              placeholder="Cari WO, ID, atau cluster..."
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
                ...scopedInstallerOptions.map(name => ({ value: name, label: name }))
              ]}
              onChange={val => {
                setInstallerFilter(val);
                setCurrentPage(1);
              }}
              sortActive={sortState.column === 'installerName'}
              sortDir={sortState.column === 'installerName' ? sortState.direction : null}
              onCycleSort={() => handleSort('installerName')}
            />
            <HeaderCategoryDropdown
              label="Status"
              value={workStatusFilter}
              defaultValue="ALL"
              allLabel="Semua Status"
              options={[
                { value: 'ALL', label: 'Semua Status' },
                ...workStatusOptions.map(s => ({ value: s, label: s }))
              ]}
              onChange={val => {
                setWorkStatusFilter(val);
                setCurrentPage(1);
              }}
            />
          </div>
        )}
      </div>

      {/* VIEW MODE 1: STITCH LIVE PROGRESS CARDS */}
      {effectiveViewMode === 'cards' ? (
        <div className="space-y-4">
          {paginatedTickets.length === 0 ? (
            <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#DDE6F0] dark:border-purple-900/60 p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#EAE8FF] dark:bg-purple-950/60 text-[#5145A6] dark:text-[#dab9ff] flex items-center justify-center mx-auto">
                <Inbox className="w-6 h-6" />
              </div>
              <div className="text-sm font-bold text-[#26364A] dark:text-white">
                Tidak Ada WO Pada Filter Ini
              </div>
              <p className="text-xs text-[#52647A] dark:text-slate-400 max-w-md mx-auto">
                Tidak ditemukan Work Order hari ini ({todayJakarta} WIB) yang cocok dengan filter status atau kata kunci pencarian Anda.
              </p>
              {(selectedCategory !== 'all' || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('all');
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  className="mj-btn-leader-primary px-4 py-2 text-xs cursor-pointer"
                >
                  Tampilkan Semua WO ({statCounts.total})
                </button>
              )}
            </div>
          ) : (
            <div className={isCompactUI ? 'grid grid-cols-1 gap-3.5' : 'grid grid-cols-1 lg:grid-cols-2 gap-4'}>
              {paginatedTickets.map(t => {
                const cat = getTicketCategory(t);
                const meta = getCardProgressMeta(t, cat);
                const workStatus = getTicketWorkStatus(t);
                const installerUser = findInstallerUser(t);
                const installerInitials = (t.installerName || 'UA')
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map(s => s[0]?.toUpperCase() || '')
                  .join('');

                const realOpm =
                  t.technicalReport?.opticalPowerDbm ||
                  t.technicalReport?.opticalPowerRx ||
                  (t.fatRedamanDbm !== undefined && t.fatRedamanDbm !== null && String(t.fatRedamanDbm).trim() !== ''
                    ? String(t.fatRedamanDbm)
                    : '');
                const parsedOpm = realOpm ? parseFloat(String(realOpm).replace(/[^0-9.-]/g, '')) : NaN;
                const opmStatus = Number.isFinite(parsedOpm)
                  ? parsedOpm < -25
                    ? { text: 'Redaman Tinggi', cls: 'bg-[#FCE9EB] dark:bg-rose-500/20 text-[#9B2C37] dark:text-rose-300 border-[#F3C5CA] dark:border-rose-500/30' }
                    : { text: 'Rx Optimal', cls: 'bg-[#E4F5EC] dark:bg-emerald-500/20 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-500/30' }
                  : { text: 'Terukur', cls: 'bg-[#EAE8FF] dark:bg-purple-500/20 text-[#5145A6] dark:text-purple-200 border-[#DCE3F2] dark:border-purple-400/30' };

                const issueReason =
                  (cat === 'uncomplete' || cat === 'cancel')
                    ? (t.remarksWOInstaller || (t as any).reasonWOInstaller || t.technicalReport?.technicalDescription || t.remarks || `Status laporan: ${t.statusWOInstaller}`)
                    : '';

                const photos = collectEvidencePhotos(t);
                const targetPhone = t.installerContact || installerUser?.phone || '';
                const canDirectWa = Boolean(onOpenWhatsApp || (targetPhone && isValidPhoneNumber(targetPhone)));

                return (
                  <div
                    key={t.id}
                    className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#DDE6F0] dark:border-purple-900/60 p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between gap-3.5"
                  >
                    <div className="space-y-3">
                      {/* Card Header: Technician, Category & WO Status */}
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative shrink-0">
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs border ${
                                cat === 'uncomplete' || cat === 'cancel'
                                  ? 'bg-[#FFF2D9] dark:bg-amber-950/50 text-[#9D661F] dark:text-amber-300 border-[#F2CF95] dark:border-amber-800'
                                  : 'bg-[#EAE8FF] dark:bg-[#2E1B59] text-[#5145A6] dark:text-[#DAB9FF] border-[#DCE3F2] dark:border-[#4B386B]'
                              }`}
                            >
                              {cat === 'uncomplete' ? <AlertTriangle className="w-5 h-5" /> : installerInitials}
                            </div>
                            {t.installerName && (
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#1A0E2E] ${
                                  cat === 'complete'
                                    ? 'bg-emerald-500'
                                    : cat === 'uncomplete'
                                    ? 'bg-amber-500'
                                    : 'bg-[#6657C8] dark:bg-[#7C3AED]'
                                }`}
                              />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-bold text-[#26364A] dark:text-white truncate">
                                {t.installerName || 'Belum Di-assign'}
                              </span>
                              {installerUser?.username && (
                                <span className="px-1.5 py-0.5 rounded bg-[#EDF3F8] dark:bg-purple-950 border border-[#DDE6F0] dark:border-purple-800 text-[10px] font-mono font-bold text-[#5145A6] dark:text-purple-200 uppercase">
                                  @{installerUser.username}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#52647A] dark:text-slate-300 truncate mt-0.5">
                              {t.ticketCategory || 'Work Order'} • {t.customerName}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 space-y-1">
                          <div className="font-mono font-bold text-xs text-[#26364A] dark:text-purple-200">
                            #{t.woNumber}
                          </div>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.badgeCls}`}>
                            {meta.badgeText}
                          </span>
                        </div>
                      </div>

                      {/* Address & ODP/FAT Strip */}
                      <button
                        type="button"
                        onClick={() => openCustomerAddressInGoogleMaps(t)}
                        className="w-full text-left p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#251545]/80 border border-[#DDE6F0] dark:border-purple-900/50 hover:border-[#6657C8]/50 dark:hover:border-[#7C3AED]/50 transition-colors flex items-start justify-between gap-2 cursor-pointer"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <MapPin className="w-4 h-4 text-[#5145A6] dark:text-[#d0bcff] shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#26364A] dark:text-white line-clamp-1">
                              {t.streetName || t.address || t.clusterName || 'Alamat pelanggan'}
                            </div>
                            <div className="text-[11px] text-[#52647A] dark:text-slate-300 truncate mt-0.5">
                              {[t.fdtCode || t.fatCode, t.fatPort ? `Port ${t.fatPort}` : '', t.clusterName]
                                .filter(Boolean)
                                .join(' • ') || `Area: ${t.area || '-'}`}
                            </div>
                          </div>
                        </div>
                        {t.slotTime && (
                          <span className="shrink-0 px-2 py-0.5 rounded-lg bg-white dark:bg-[#1A0E2E] border border-[#DDE6F0] dark:border-purple-800 text-[10px] font-mono font-semibold text-[#52647A] dark:text-purple-200">
                            {t.slotTime}
                          </span>
                        )}
                      </button>

                      {/* Work Progress Bar & Check-in/out Timestamps */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5 font-semibold text-[#26364A] dark:text-slate-200 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${meta.barColor}`} />
                            <span className="truncate">{meta.label}</span>
                          </div>
                          <span className="font-mono font-bold text-[#5145A6] dark:text-[#d0bcff] shrink-0">
                            {meta.percent}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[#EDF3F8] dark:bg-purple-950 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${meta.barColor}`}
                            style={{ width: `${meta.percent}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[#52647A] dark:text-slate-400 pt-0.5">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-emerald-600" />
                            Check-in: <strong className="font-mono text-[#26364A] dark:text-slate-200">{t.checkInAt ? formatJakartaTimeOnly(t.checkInAt) : '-'}</strong>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-[#2E7D8B] dark:text-[#DAB9FF]" />
                            Check-out: <strong className="font-mono text-[#26364A] dark:text-slate-200">{t.checkOutAt ? formatJakartaTimeOnly(t.checkOutAt) : '-'}</strong>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Timer className="w-3 h-3 text-[#5145A6] dark:text-[#7C3AED]" />
                            Durasi: <strong className="font-mono text-[#26364A] dark:text-slate-200">{workStatus.durationFormatted}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Real OPM Telemetry Box (Shown ONLY if real DB reading exists) */}
                      {realOpm && (
                        <div className="rounded-xl bg-gradient-to-br from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:bg-none dark:bg-[#1f1638] text-[#26364A] dark:text-white p-3 flex items-center justify-between gap-3 border border-[#BDE4E8] dark:border-[#342b4e]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-white/80 dark:bg-[#342b4e] border border-[#DCE3F2] dark:border-transparent flex items-center justify-center text-[#5145A6] dark:text-[#d0bcff] shrink-0">
                              <Radio className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] text-[#2E7D8B] dark:text-[#d0bcff] uppercase tracking-wider font-semibold">
                                Optical Power (OPM)
                              </div>
                              <div className="text-base font-bold font-mono leading-tight">
                                {String(realOpm).toLowerCase().includes('dbm') ? realOpm : `${realOpm} dBm`}
                              </div>
                            </div>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full text-[10.5px] font-bold border shrink-0 ${opmStatus.cls}`}>
                            • {opmStatus.text}
                          </span>
                        </div>
                      )}

                      {/* Real Field Obstacle Callout */}
                      {issueReason && (
                        <div className="rounded-xl bg-[#FFF2D9] dark:bg-amber-950/30 border border-[#F2CF95] dark:border-amber-800/60 p-3 space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#9D661F] dark:text-amber-300">
                            <span>HAMBATAN LAPANGAN</span>
                            <span>{t.statusWOInstaller}</span>
                          </div>
                          <p className="text-xs text-[#26364A] dark:text-amber-100 leading-relaxed line-clamp-3">
                            {issueReason}
                          </p>
                        </div>
                      )}

                      {/* Real Field Photo Evidence Strip */}
                      {photos.length > 0 && (
                        <div className="rounded-xl bg-[#F4F7FB] dark:bg-[#251545]/70 border border-[#DDE6F0] dark:border-purple-900/50 p-2.5 flex items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <button
                              type="button"
                              onClick={() =>
                                setLightboxData({
                                  woNumber: t.woNumber,
                                  installerName: t.installerName || 'Teknisi',
                                  photos,
                                  activeIndex: 0
                                })
                              }
                              className="w-11 h-11 rounded-lg overflow-hidden border border-[#DCE3F2] dark:border-[#5B35B1] bg-white shrink-0 relative group cursor-pointer"
                            >
                              <img
                                src={photos[0].url}
                                alt={photos[0].label}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <ZoomIn className="w-4 h-4 text-white" />
                              </div>
                            </button>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-[#26364A] dark:text-white flex items-center gap-1">
                                <ImageIcon className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                                <span>Bukti Lapangan ({photos.length} Foto)</span>
                              </div>
                              <div className="text-[11px] text-[#52647A] dark:text-slate-300 truncate">
                                {photos[0].label}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setLightboxData({
                                woNumber: t.woNumber,
                                installerName: t.installerName || 'Teknisi',
                                photos,
                                activeIndex: 0
                              })
                            }
                            className="mj-btn-leader-neutral mj-btn-xs shrink-0 px-2.5 py-1 rounded-lg text-[11px] text-[#5145A6] dark:text-[#d0bcff] cursor-pointer"
                          >
                            Lihat Foto
                          </button>
                        </div>
                      )}
                    </div>

                    {/* RBAC-Safe Action Row (NO Dispatch Approval or Closing Buttons for Leader!) */}
                    <div className="pt-2 border-t border-[#DDE6F0] dark:border-purple-900/40 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openCustomerAddressInGoogleMaps(t)}
                        className="mj-btn-leader-neutral mj-btn-compact flex-1 min-w-[110px] py-2 px-3 text-xs text-[#26364A] dark:text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Navigation className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#d0bcff]" />
                        <span>Cek Lokasi</span>
                      </button>

                      {canDirectWa && (
                        targetPhone && isValidPhoneNumber(targetPhone) ? (
                          <a
                            href={
                              buildWhatsAppClickToChatUrl(
                                targetPhone,
                                `Halo ${t.installerName || 'Teknisi'}, mohon update progres lapangan untuk WO #${t.woNumber} (${t.customerName}).`
                              ).url
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mj-btn-leader-neutral mj-btn-compact flex-1 min-w-[120px] py-2 px-3 text-xs text-[#5145A6] dark:text-[#d0bcff] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Hubungi Teknisi</span>
                          </a>
                        ) : onOpenWhatsApp ? (
                          <button
                            type="button"
                            onClick={() => onOpenWhatsApp(t)}
                            className="mj-btn-leader-neutral mj-btn-compact flex-1 min-w-[120px] py-2 px-3 text-xs text-[#5145A6] dark:text-[#d0bcff] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Hubungi WA</span>
                          </button>
                        ) : null
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectTicket(t)}
                        className="mj-btn-leader-primary mj-btn-compact flex-1 min-w-[120px] py-2 px-3 text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Detail WO</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Cards Pagination */}
          {displayTickets.length > 0 && (
            <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#DDE6F0] dark:border-purple-900/60 overflow-hidden">
              <PaginationBar
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={displayTickets.length}
                pageSize={rowsPerPage === -1 ? 'ALL' : rowsPerPage}
                pageSizeOptions={[10, 25, 50, 100, 'ALL']}
                onPageChange={setCurrentPage}
                onPageSizeChange={size => {
                  setRowsPerPage(size === 'ALL' ? -1 : size);
                  setCurrentPage(1);
                }}
                itemLabel="Work Order"
                className="border-t-0"
              />
            </div>
          )}
        </div>
      ) : (
        /* VIEW MODE 2: PRESERVED 11-COLUMN FULL TABLE WITH EXPORT & EXPAND */
        <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#DDE6F0] dark:border-purple-900/60 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-[#DDE6F0] dark:border-purple-900/40 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="text-xs font-bold text-[#26364A] dark:text-white">
              Tabel Monitoring Lengkap ({displayTickets.length} WO)
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 bg-[#EDF3F8] dark:bg-[#160D29] px-2.5 py-1.5 rounded-xl border border-[#DDE6F0] dark:border-purple-900/60">
                <span className="text-[#52647A] dark:text-slate-400">Tampil:</span>
                <select
                  value={rowsPerPage}
                  onChange={e => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-transparent font-bold text-[#26364A] dark:text-slate-200 focus:outline-none"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={-1}>Semua ({displayTickets.length})</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Salin Data ke Clipboard"
                >
                  <Copy className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                  <span>{copySuccess ? 'Disalin!' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Export CSV"
                >
                  <Download className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#A380FE]" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="mj-btn-leader-success mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Export Excel (.xlsx)"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Cetak Tabel"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
              </div>
            </div>
          </div>

          <div className="px-4 py-2.5 bg-[#F4F7FB] dark:bg-[#160D29] border-b border-[#DDE6F0] dark:border-purple-900/40 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-2 font-bold text-[#26364A] dark:text-white">
              <Radio className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
              <span>Monitoring Progress Live Installer</span>
              <span className="px-2 py-0.5 rounded-full bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] font-mono text-[10px]">
                {statCounts.assign} Aktif
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10.5px] font-semibold">
              <span className="inline-flex items-center gap-1.5 text-[#5145A6] dark:text-[#D8B4FE]">
                <span className="w-2 h-2 rounded-full bg-[#6657C8] dark:bg-[#D8B4FE]" />
                SLA Target &le; 90 mnt
              </span>
              <span className="inline-flex items-center gap-1.5 text-[#9B2C37] dark:text-rose-400">
                <span className="w-2 h-2 rounded-full bg-[#D45B66] dark:bg-rose-400" />
                Overdue &gt; 90 mnt
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse mj-zebra-table">
              <thead className="bg-[#EDF3F8] dark:bg-[#251545] text-[#52647A] dark:text-purple-200 uppercase font-bold text-[10.5px] tracking-wider border-b border-[#DDE6F0] dark:border-purple-900/60">
                <tr>
                  <th className="py-3 px-2 w-8 text-center">#</th>
                  <th className="py-3 px-3 min-w-[165px]">
                    <HeaderCategoryDropdown
                      label="Teknisi & ID"
                      value={installerFilter}
                      defaultValue="ALL"
                      allLabel="Semua Teknisi"
                      options={[
                        { value: 'ALL', label: 'Semua Teknisi' },
                        ...scopedInstallerOptions.map(name => ({ value: name, label: name }))
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
                  <th className="py-3 px-3 min-w-[180px]">
                    <HeaderSearchPopover
                      label="No. WO & Pelanggan"
                      value={woSearch}
                      onChange={val => {
                        setWoSearch(val);
                        setCurrentPage(1);
                      }}
                      placeholder="Cari WO / ID / Pelanggan..."
                      sortActive={sortState.column === 'woNumber'}
                      sortDir={sortState.column === 'woNumber' ? sortState.direction : null}
                      onCycleSort={() => handleSort('woNumber')}
                    />
                  </th>
                  <th className="py-3 px-3 min-w-[130px]">
                    <HeaderCategoryDropdown
                      label="Area & Mitra"
                      value={areaFilter}
                      defaultValue="ALL"
                      allLabel="Semua Area"
                      options={[
                        { value: 'ALL', label: 'Semua Area' },
                        ...scopedAreaOptions.map(a => ({ value: a, label: a }))
                      ]}
                      onChange={val => {
                        setAreaFilter(val);
                        setCurrentPage(1);
                      }}
                      sortActive={sortState.column === 'area'}
                      sortDir={sortState.column === 'area' ? sortState.direction : null}
                      onCycleSort={() => handleSort('area')}
                    />
                  </th>
                  <th className="py-3 px-3 text-center min-w-[130px]">
                    <HeaderCategoryDropdown
                      label="Status Saat Ini"
                      value={workStatusFilter}
                      defaultValue="ALL"
                      allLabel="Semua Status"
                      options={[
                        { value: 'ALL', label: 'Semua Status' },
                        ...workStatusOptions.map(s => ({ value: s, label: s }))
                      ]}
                      onChange={val => {
                        setWorkStatusFilter(val);
                        setCurrentPage(1);
                      }}
                      sortActive={sortState.column === 'workStatus'}
                      sortDir={sortState.column === 'workStatus' ? sortState.direction : null}
                      onCycleSort={() => handleSort('workStatus')}
                    />
                  </th>
                  <th className="py-3 px-3 min-w-[125px]">
                    <HeaderSortButton
                      label="Check-in & Out"
                      active={sortState.column === 'checkInAt'}
                      direction={sortState.column === 'checkInAt' ? sortState.direction : null}
                      onClick={() => handleSort('checkInAt')}
                    />
                  </th>
                  <th className="py-3 px-3 min-w-[105px]">
                    <HeaderSortButton
                      label="Durasi Kerja"
                      active={sortState.column === 'workDuration'}
                      direction={sortState.column === 'workDuration' ? sortState.direction : null}
                      onClick={() => handleSort('workDuration')}
                    />
                  </th>
                  <th className="py-3 px-3 text-center font-bold min-w-[85px]">Bukti Foto</th>
                  <th className="py-3 px-3 text-right font-bold min-w-[85px]">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDE6F0] dark:divide-purple-900/30">
                {paginatedTickets.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[#8492A5] dark:text-slate-400 text-xs">
                      Tidak ada Work Order yang sesuai dengan filter atau pencarian aktif.
                    </td>
                  </tr>
                ) : (
                  paginatedTickets.map(t => {
                    const isExpanded = !!expandedRowIds[t.id];
                    const workStatus = getTicketWorkStatus(t);
                    const contractorName = t.contractorName || t.contactorName || leaderContractor || '-';
                    const installerInitials = (t.installerName || 'UA')
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map(s => s[0]?.toUpperCase() || '')
                      .join('');
                    const photos = collectEvidencePhotos(t);
                    const isSlaOverdue =
                      typeof workStatus.durationMinutes === 'number' &&
                      workStatus.durationMinutes > 90 &&
                      workStatus.status !== 'Selesai';

                    return (
                      <React.Fragment key={t.id}>
                        <tr
                          className={`hover:bg-[#EDF3F8]/70 dark:hover:bg-purple-950/30 transition-colors ${
                            isExpanded ? 'bg-[#EAE8FF]/60 dark:bg-[#251545]/50 font-medium' : ''
                          }`}
                        >
                          <td className="py-3 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => toggleRowExpand(t.id)}
                              className="p-1 rounded-lg text-[#8492A5] hover:text-[#5145A6] hover:bg-[#EAE8FF] dark:text-slate-400 dark:hover:text-[#DAB9FF] dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
                              title={isExpanded ? 'Tutup Rincian' : 'Buka Rincian'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-[#8492A5] dark:text-slate-400" />
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0 ${
                                  t.installerName
                                    ? 'bg-[#6657C8] text-white dark:bg-[#58149C]'
                                    : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF]'
                                }`}
                              >
                                {installerInitials}
                              </div>
                              <div className="min-w-0">
                                <div className="font-bold text-[#26364A] dark:text-slate-100 truncate max-w-[130px]">
                                  {t.installerName || 'Belum Di-assign'}
                                </div>
                                <div className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] font-mono truncate">
                                  {t.installerContact || t.installerId || '-'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-[#5145A6] dark:text-purple-300">
                                {t.woNumber}
                              </span>
                              {t.idCustomer && (
                                <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#A79BC0]">
                                  · {t.idCustomer}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-medium text-[#26364A] dark:text-slate-200 truncate max-w-[190px]">
                              {t.customerName}
                            </div>
                            {(t.streetName || t.clusterName) && (
                              <div className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] truncate max-w-[190px]">
                                {t.streetName || t.clusterName}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-[#DDF4F4] text-[#2E7D8B] dark:bg-purple-950 dark:text-purple-300 border border-[#BDE4E8] dark:border-purple-800">
                              {t.area || '-'}
                            </span>
                            <div className="text-[10.5px] text-[#52647A] dark:text-slate-300 truncate max-w-[135px] mt-0.5" title={contractorName}>
                              {contractorName}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <StatusBadge
                              status={
                                workStatus.status === 'Selesai'
                                  ? 'CHECK-OUT'
                                  : workStatus.status === 'Sedang Dikerjakan'
                                  ? 'PROGRESS'
                                  : 'BELUM CHECK-IN'
                              }
                              variant="checkin"
                            />
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap font-mono text-[10.5px] space-y-0.5">
                            <div className="text-[#26364A] dark:text-slate-200 font-semibold">
                              <span className="text-[#8492A5] dark:text-[#A79BC0]">IN: </span>
                              {t.checkInAt ? formatJakartaTimeOnly(t.checkInAt) : '--:--'}
                            </div>
                            <div className="text-[#5145A6] dark:text-[#D8B4FE]">
                              <span className="text-[#8492A5] dark:text-[#A79BC0]">OUT: </span>
                              {t.checkOutAt ? formatJakartaTimeOnly(t.checkOutAt) : '--:--'}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-mono text-[11px] font-bold border ${
                                isSlaOverdue
                                  ? 'bg-[#FCE9EB] text-[#9B2C37] border-[#F3C5CA] dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                                  : workStatus.status === 'Belum Check-in'
                                  ? 'bg-[#EDF3F8] text-[#8492A5] border-[#DDE6F0] dark:bg-[#160D29] dark:text-[#A79BC0] dark:border-[#3B1D78]'
                                  : 'bg-[#EAE8FF] text-[#5145A6] border-[#DCE3F2] dark:bg-[#2E1459] dark:text-[#DAB9FF] dark:border-[#5B35B1]'
                              }`}
                            >
                              {isSlaOverdue ? (
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                              ) : (
                                <Timer className="w-3 h-3 shrink-0" />
                              )}
                              <span>{workStatus.status === 'Belum Check-in' ? 'Menunggu' : workStatus.durationFormatted}</span>
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            {photos.length > 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setLightboxData({
                                    woNumber: t.woNumber,
                                    installerName: t.installerName || 'Teknisi',
                                    photos,
                                    activeIndex: 0
                                  })
                                }
                                className="relative inline-flex w-11 h-8 rounded-lg overflow-hidden border border-[#DCE3F2] dark:border-[#5B35B1] shadow-2xs hover:scale-105 transition-transform cursor-pointer group"
                                title={`Lihat ${photos.length} Bukti Foto`}
                              >
                                <img src={photos[0].url} alt={photos[0].label} className="w-full h-full object-cover" />
                                <span className="absolute bottom-0 right-0 px-1 bg-[#26364A]/85 dark:bg-[#160D29]/80 text-white text-[9px] font-mono font-bold">
                                  {photos.length}
                                </span>
                              </button>
                            ) : (
                              <span
                                className="inline-flex w-11 h-8 rounded-lg border border-dashed border-[#DCE3F2] dark:border-[#3B1D78] bg-[#F4F7FB] dark:bg-[#160D29] items-center justify-center text-[#8492A5] dark:text-[#A493C2]"
                                title="Belum ada bukti foto"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            {(() => {
                              const progressActions: DropdownActionItem[] = [
                                {
                                  id: 'detail_wo',
                                  label: 'Detail Pekerjaan',
                                  icon: <Eye className="w-3.5 h-3.5" />,
                                  tone: 'primary',
                                  onClick: () => onSelectTicket(t)
                                },
                                {
                                  id: 'toggle_expand',
                                  label: isExpanded ? 'Tutup Rincian' : 'Buka Rincian',
                                  icon: isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />,
                                  onClick: () => toggleRowExpand(t.id)
                                }
                              ];
                              if (onOpenWhatsApp) {
                                progressActions.push({
                                  id: 'whatsapp',
                                  label: 'WhatsApp Pelanggan',
                                  icon: <MessageSquare className="w-3.5 h-3.5" />,
                                  tone: 'success',
                                  onClick: () => onOpenWhatsApp(t)
                                });
                              }
                              progressActions.push({
                                id: 'maps',
                                label: 'Buka Google Maps',
                                icon: <MapPin className="w-3.5 h-3.5" />,
                                onClick: () => openCustomerAddressInGoogleMaps(t)
                              });
                              progressActions.push({
                                id: 'copy_wo',
                                label: 'Salin No. WO',
                                icon: <Copy className="w-3.5 h-3.5" />,
                                dividerBefore: true,
                                onClick: () => navigator.clipboard?.writeText(t.woNumber)
                              });
                              return (
                                <div className="inline-flex items-center justify-end">
                                  <ActionDropdownMenu
                                    actions={progressActions}
                                    triggerLabel={`Aksi WO ${t.woNumber}`}
                                    align="right"
                                    size="sm"
                                  />
                                </div>
                              );
                            })()}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-[#F4F7FB] dark:bg-[#1E1238] border-b border-[#DDE6F0] dark:border-purple-900/60">
                            <td colSpan={9} className="p-4 sm:p-5">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                                <div className="p-3 bg-white dark:bg-[#150A26] rounded-xl border border-[#DDE6F0] dark:border-purple-900/50 space-y-1">
                                  <div className="text-[10px] uppercase font-bold text-[#8492A5] dark:text-slate-400">Installer</div>
                                  <div className="font-bold text-[#26364A] dark:text-slate-100 flex items-center gap-1.5">
                                    <UserCheck className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                                    <span>{t.installerName || 'Belum Di-assign'}</span>
                                  </div>
                                  {t.installerContact && (
                                    <div className="text-[11px] text-[#52647A] dark:text-slate-400 font-mono">
                                      Telp: {t.installerContact}
                                    </div>
                                  )}
                                </div>

                                <div className="p-3 bg-white dark:bg-[#150A26] rounded-xl border border-[#DDE6F0] dark:border-purple-900/50 space-y-1">
                                  <div className="text-[10px] uppercase font-bold text-[#8492A5] dark:text-slate-400">Slot Time</div>
                                  <div className="font-bold text-[#26364A] dark:text-slate-100 flex items-center gap-1.5">
                                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                                    <span>{t.slotTime || (t as any).timeSlot || '-'}</span>
                                  </div>
                                  <div className="text-[11px] text-[#52647A] dark:text-slate-400">Area: {t.area || '-'}</div>
                                </div>

                                <div className="p-3 bg-white dark:bg-[#150A26] rounded-xl border border-[#DDE6F0] dark:border-purple-900/50 space-y-1">
                                  <div className="text-[10px] uppercase font-bold text-[#8492A5] dark:text-slate-400">WO Agent & Reason</div>
                                  <div className="font-semibold text-[#26364A] dark:text-slate-200">
                                    Status: <strong className="text-[#5145A6] dark:text-purple-300">{t.statusWOAgent || '-'}</strong>
                                  </div>
                                  <div className="text-[11px] text-[#52647A] dark:text-slate-400 truncate">
                                    Reason: {(t as any).reasonWOAgent || '-'}
                                  </div>
                                </div>

                                <div className="p-3 bg-white dark:bg-[#150A26] rounded-xl border border-[#DDE6F0] dark:border-purple-900/50 space-y-1">
                                  <div className="text-[10px] uppercase font-bold text-[#8492A5] dark:text-slate-400">WO Installer & Remarks</div>
                                  <div className="font-semibold text-[#26364A] dark:text-slate-200">
                                    Status: <strong className="text-[#218A63] dark:text-emerald-400">{t.statusWOInstaller || '-'}</strong>
                                  </div>
                                  <div className="text-[11px] text-[#52647A] dark:text-slate-400">
                                    Reason: {(t as any).reasonWOInstaller || '-'}
                                  </div>
                                  <div className="text-[11px] text-[#52647A] dark:text-slate-400 italic">
                                    Remarks: {t.remarksWOInstaller || '-'}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 pt-3 border-t border-[#DDE6F0] dark:border-purple-900/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                <div className="text-[11px] text-[#52647A] dark:text-slate-300 flex items-start gap-1.5 flex-1">
                                  <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                                  <span className="line-clamp-2">{t.address || 'Alamat tidak tersedia'}</span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => openCustomerAddressInGoogleMaps(t)}
                                    className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                                  >
                                    <ExternalLink className="w-3 h-3 text-rose-500" />
                                    <span>Google Maps</span>
                                  </button>

                                  {onOpenWhatsApp && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenWhatsApp(t)}
                                      className="mj-btn-leader-success mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                                    >
                                      <MessageSquare className="w-3 h-3" />
                                      <span>Kirim WA</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => onSelectTicket(t)}
                                    className="mj-btn-leader-primary mj-btn-xs px-3 py-1 rounded-lg cursor-pointer"
                                  >
                                    Detail Lengkap
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={displayTickets.length}
            pageSize={rowsPerPage === -1 ? 'ALL' : rowsPerPage}
            pageSizeOptions={[10, 25, 50, 100, 'ALL']}
            onPageChange={setCurrentPage}
            onPageSizeChange={size => {
              setRowsPerPage(size === 'ALL' ? -1 : size);
              setCurrentPage(1);
            }}
            itemLabel="Work Order"
          />
        </div>
      )}

      {/* Stitch Bottom Coordination Strip: Broadcast Panduan Lapangan */}
      <div className="bg-[#EAE8FF] dark:bg-[#251545] rounded-2xl border border-[#DCE3F2] dark:border-purple-800/60 p-3.5 sm:p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#6657C8] dark:bg-[#58149c] text-white flex items-center justify-center shrink-0 shadow-xs">
            <Send className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-bold text-[#26364A] dark:text-white truncate">
              Broadcast Panduan Lapangan
            </div>
            <div className="text-[11px] text-[#52647A] dark:text-purple-200/80 truncate">
              Kirim instruksi SOP / peringatan cuaca ke {scopedInstallers.length} teknisi aktif
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsBroadcastModalOpen(true)}
          className="mj-btn-leader-neutral mj-btn-compact shrink-0 px-4 py-2 text-[#5145A6] dark:text-[#d0bcff] text-xs cursor-pointer"
        >
          Kirim
        </button>
      </div>

      {/* Evidence Lightbox Modal */}
      <ResponsiveModal
        isOpen={Boolean(lightboxData)}
        onClose={() => setLightboxData(null)}
        size="lg"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<ImageIcon className="w-4 h-4" />}
        title={lightboxData ? `Bukti Lapangan • #${lightboxData.woNumber}` : 'Bukti Lapangan'}
        subtitle={
          lightboxData
            ? `${lightboxData.installerName} — ${lightboxData.photos[lightboxData.activeIndex]?.label || ''}`
            : undefined
        }
      >
        {lightboxData && (
          <div className="space-y-3">
            <div className="bg-[#F4F7FB] dark:bg-[#1f1638] border border-[#DDE6F0] dark:border-transparent rounded-xl flex items-center justify-center max-h-[60vh] overflow-hidden p-2">
              <img
                src={lightboxData.photos[lightboxData.activeIndex]?.url}
                alt={lightboxData.photos[lightboxData.activeIndex]?.label}
                className="max-h-[55vh] w-auto object-contain rounded-lg"
              />
            </div>
            {lightboxData.photos.length > 1 && (
              <div className="p-2.5 rounded-xl flex items-center gap-2 overflow-x-auto bg-[#EDF3F8] dark:bg-[#251545]">
                {lightboxData.photos.map((photo, idx) => (
                  <button
                    key={photo.url}
                    type="button"
                    onClick={() =>
                      setLightboxData(prev => (prev ? { ...prev, activeIndex: idx } : null))
                    }
                    className={`w-14 h-14 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer ${
                      idx === lightboxData.activeIndex ? 'border-[#6657C8] dark:border-[#58149c]' : 'border-transparent opacity-65'
                    }`}
                  >
                    <img src={photo.url} alt={photo.label} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </ResponsiveModal>

      {/* Broadcast Panduan Lapangan Modal */}
      <ResponsiveModal
        isOpen={isBroadcastModalOpen}
        onClose={() => setIsBroadcastModalOpen(false)}
        size="md"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<Send className="w-4 h-4" />}
        title="Broadcast Panduan Lapangan"
        subtitle={`Koordinasi cepat untuk teknisi ${leaderContractor}`}
        footer={
          <button
            type="button"
            onClick={() => setIsBroadcastModalOpen(false)}
            className="mj-btn-leader-neutral px-4 py-2 text-xs cursor-pointer"
          >
            Tutup
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#26364A] dark:text-slate-200 mb-1.5">
              Pesan Instruksi Lapangan
            </label>
            <textarea
              rows={3}
              value={broadcastMessage}
              onChange={e => setBroadcastMessage(e.target.value)}
              className="tactile-debossed-input w-full rounded-xl border border-[#DCE3F2] dark:border-purple-800 bg-[#F4F7FB] dark:bg-[#251545] p-3 text-xs text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7C3AED]"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#26364A] dark:text-slate-200">
              Kirim ke Teknisi ({scopedInstallers.length})
            </span>
            <button
              type="button"
              onClick={handleCopyBroadcast}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EAE8FF] hover:bg-[#DCE3F2] dark:bg-[#251545] dark:hover:bg-[#35105E] text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              <span>{broadcastCopied ? 'Tersalin!' : 'Salin Teks'}</span>
            </button>
          </div>

          <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
            {scopedInstallers.length === 0 ? (
              <div className="text-xs text-[#8492A5] dark:text-slate-500 py-4 text-center">
                Belum ada teknisi aktif terdaftar pada scope mitra ini.
              </div>
            ) : (
              scopedInstallers.map(inst => {
                const validPhone = inst.phone && isValidPhoneNumber(inst.phone);
                return (
                  <div
                    key={inst.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#251545] border border-[#DDE6F0] dark:border-purple-900/50"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                        {inst.name}
                      </div>
                      <div className="text-[10.5px] font-mono text-[#52647A] dark:text-slate-300">
                        {inst.phone || 'Nomor WA belum diisi'}
                      </div>
                    </div>
                    {validPhone ? (
                      <a
                        href={buildWhatsAppClickToChatUrl(inst.phone!, broadcastMessage).url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mj-btn-leader-success mj-btn-compact shrink-0 px-3 py-1.5 rounded-lg text-[11px] inline-flex items-center gap-1"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>Kirim WA</span>
                      </a>
                    ) : (
                      <span className="text-[10px] text-[#8492A5] dark:text-slate-400">No WA N/A</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </ResponsiveModal>
    </div>
  );
};
