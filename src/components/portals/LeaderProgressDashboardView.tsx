import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
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
  Search,
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
  LayoutGrid,
  Table2,
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
import { matchesKpiFilter, KPI_FILTER_LABELS } from '../../services/woLifecycleService';

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
  const { isMobileView } = useUIConfig();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<StatCategoryFilter>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [showLifecycleKpi, setShowLifecycleKpi] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [sortField, setSortField] = useState<string>('woNumber');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
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
  const leaderContractor = currentUser?.contractor || (contractorsList?.[0] || 'PT Mitra Jaringan Solusi');
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

  // Filtered & Sorted Tickets
  const displayTickets = useMemo(() => {
    return baseLeaderTickets
      .filter(t => {
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
      })
      .sort((a, b) => {
        let valA: any = '';
        let valB: any = '';
        if (sortField === 'installerName') {
          valA = a.installerName || '';
          valB = b.installerName || '';
        } else if (sortField === 'idCustomer') {
          valA = a.idCustomer || '';
          valB = b.idCustomer || '';
        } else if (sortField === 'woNumber') {
          valA = a.woNumber || '';
          valB = b.woNumber || '';
        } else if (sortField === 'area') {
          valA = a.area || '';
          valB = b.area || '';
        } else if (sortField === 'contractor') {
          valA = a.contactorName || a.contractorName || '';
          valB = b.contactorName || b.contractorName || '';
        } else if (sortField === 'checkInAt') {
          valA = a.checkInAt || '';
          valB = b.checkInAt || '';
        } else if (sortField === 'checkOutAt') {
          valA = a.checkOutAt || '';
          valB = b.checkOutAt || '';
        } else if (sortField === 'workDuration') {
          valA = a.workDurationMinutes || 0;
          valB = b.workDurationMinutes || 0;
        } else if (sortField === 'workStatus') {
          valA = getTicketWorkStatus(a).status;
          valB = getTicketWorkStatus(b).status;
        } else {
          valA = String((a as any)[sortField] || '').toLowerCase();
          valB = String((b as any)[sortField] || '').toLowerCase();
        }

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortOrder === 'asc' ? valA - valB : valB - valA;
        }
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [baseLeaderTickets, activeKpiDrilldown, selectedCategory, searchQuery, sortField, sortOrder]);

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

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
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
      return { percent: 100, barColor: 'bg-emerald-500', label: 'Pekerjaan Selesai / Terverifikasi Lapangan', badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200', badgeText: 'Selesai' };
    }
    if (cat === 'uncomplete') {
      return { percent: 45, barColor: 'bg-amber-500', label: t.statusWOInstaller || 'Kendala Teknis / Pending', badgeCls: 'bg-amber-50 text-amber-700 border-amber-200', badgeText: 'Kendala' };
    }
    if (cat === 'cancel') {
      return { percent: 15, barColor: 'bg-rose-500', label: 'Dibatalkan / Gagal', badgeCls: 'bg-rose-50 text-rose-700 border-rose-200', badgeText: 'Batal' };
    }
    if (cat === 'assign') {
      const ws = getTicketWorkStatus(t);
      const isOnSite = t.statusWOInstaller === 'On Site' || t.statusWOInstaller === 'In Progress' || t.statusWOInstaller === 'PROGRESS' || Boolean(t.checkInAt);
      return {
        percent: isOnSite ? 75 : 50,
        barColor: 'bg-[#7C3AED]',
        label: ws.status === 'Sedang Dikerjakan' ? 'Sedang Dikerjakan (Checked-In)' : t.statusWOInstaller || 'Dalam Perjalanan / Proses',
        badgeCls: 'bg-[#f3eaff] text-[#58149c] border-[#e8ddff]',
        badgeText: isOnSite ? 'On Site' : 'Sedang Jalan'
      };
    }
    if (cat === 'untouch') {
      return { percent: 25, barColor: 'bg-indigo-500', label: 'Ditugaskan — Menunggu Check-in Teknisi', badgeCls: 'bg-indigo-50 text-indigo-700 border-indigo-200', badgeText: 'Menunggu' };
    }
    return { percent: 0, barColor: 'bg-slate-300', label: 'Belum Di-assign ke Teknisi', badgeCls: 'bg-slate-100 text-slate-600 border-slate-200', badgeText: 'Unassign' };
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
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7C3AED]">
            PEMANTAUAN LAPANGAN
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#1f1638] dark:text-white leading-tight font-['Plus_Jakarta_Sans',sans-serif]">
            Status Pengerjaan WO
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#4b4452] dark:text-slate-300">
            <span className="font-semibold text-[#58149c] dark:text-[#d0bcff]">{leaderContractor}</span>
            {leaderArea && <span>• {leaderArea}</span>}
            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
              <Calendar className="w-3.5 h-3.5 text-[#7C3AED]" />
              {formatAppointmentDateDisplay(todayJakarta)} ({todayJakarta})
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#f3eaff] hover:bg-[#e8ddff] dark:bg-[#251545] dark:hover:bg-[#311c5a] border border-[#e8ddff] dark:border-purple-800/60 text-xs font-bold text-[#1f1638] dark:text-purple-100 transition-all cursor-pointer disabled:opacity-60"
            title="Sinkronkan progres lapangan terbaru dari server"
          >
            <span className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`} />
            <RefreshCw className={`w-3.5 h-3.5 text-[#58149c] dark:text-[#d0bcff] ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Sinkron...' : 'Auto-Sync'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowLifecycleKpi(prev => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
              showLifecycleKpi
                ? 'bg-[#58149c] text-white border-[#58149c]'
                : 'bg-white dark:bg-[#1A0E2E] text-[#4b4452] dark:text-slate-200 border-[#e8ddff] dark:border-purple-900/60 hover:bg-[#f8f1ff]'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">KPI Lifecycle</span>
          </button>

          <div className="inline-flex items-center p-1 rounded-xl bg-[#f3eaff] dark:bg-[#251545] border border-[#e8ddff] dark:border-purple-900/60">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-[#1A0E2E] text-[#58149c] dark:text-white shadow-xs'
                  : 'text-[#4b4452] dark:text-slate-300'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Kartu Live</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-[#1A0E2E] text-[#58149c] dark:text-white shadow-xs'
                  : 'text-[#4b4452] dark:text-slate-300'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Tabel</span>
            </button>
          </div>
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
        <div className="rounded-xl bg-[#1f1638] text-white px-4 py-3 border border-[#3E246F] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-[#7135B5] text-white font-bold text-[10.5px]">
              Filter KPI Dashboard
            </span>
            <span className="font-bold">
              {KPI_FILTER_LABELS[activeKpiDrilldown.filterKey] || activeKpiDrilldown.filterKey}
            </span>
            <span className="font-mono font-bold text-[#E9D5FF] tabular-nums">
              ({displayTickets.length} WO ditemukan)
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveKpiDrilldown(null);
              setCurrentPage(1);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-[#1f1638] hover:bg-[#f8f1ff] text-xs font-bold cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset Filter KPI</span>
          </button>
        </div>
      )}

      {/* 3 Primary Stitch KPI Tiles (In Progress, Selesai, Kendala) */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5">
        <button
          type="button"
          onClick={() => {
            setSelectedCategory(selectedCategory === 'assign' ? 'all' : 'assign');
            setCurrentPage(1);
          }}
          className={`p-3 sm:p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
            selectedCategory === 'assign'
              ? 'bg-[#f3eaff] dark:bg-[#2a174a] border-[#7C3AED] ring-2 ring-[#7C3AED]/30 shadow-sm'
              : 'bg-white dark:bg-[#1A0E2E] border-[#e8ddff] dark:border-purple-900/60 hover:border-[#7C3AED]/50'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] sm:text-xs font-semibold text-[#4b4452] dark:text-slate-300 truncate">
              In Progress
            </span>
            <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#7C3AED] shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-[#1f1638] dark:text-white tabular-nums">
              {statCounts.assign}
            </span>
            <span className="text-[10px] font-bold uppercase text-[#7C3AED]">WO</span>
          </div>
          <div className="mt-2 h-1 w-full rounded-full bg-[#e8ddff] dark:bg-purple-950 overflow-hidden">
            <div
              className="h-full bg-[#7C3AED] rounded-full transition-all"
              style={{ width: `${statCounts.total > 0 ? Math.min(100, Math.round((statCounts.assign / statCounts.total) * 100)) : 0}%` }}
            />
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setSelectedCategory(selectedCategory === 'complete' ? 'all' : 'complete');
            setCurrentPage(1);
          }}
          className={`p-3 sm:p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
            selectedCategory === 'complete'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/25 shadow-sm'
              : 'bg-white dark:bg-[#1A0E2E] border-[#e8ddff] dark:border-purple-900/60 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] sm:text-xs font-semibold text-[#4b4452] dark:text-slate-300 truncate">
              Selesai
            </span>
            <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-[#1f1638] dark:text-white tabular-nums">
              {statCounts.complete}
            </span>
            <span className="text-[10px] font-bold uppercase text-emerald-600">WO</span>
          </div>
          <div className="mt-2 h-1 w-full rounded-full bg-emerald-100 dark:bg-emerald-950 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${statCounts.total > 0 ? Math.min(100, Math.round((statCounts.complete / statCounts.total) * 100)) : 0}%` }}
            />
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setSelectedCategory(selectedCategory === 'uncomplete' ? 'all' : 'uncomplete');
            setCurrentPage(1);
          }}
          className={`p-3 sm:p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
            selectedCategory === 'uncomplete'
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/25 shadow-sm'
              : 'bg-white dark:bg-[#1A0E2E] border-[#e8ddff] dark:border-purple-900/60 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] sm:text-xs font-semibold text-[#4b4452] dark:text-slate-300 truncate">
              Kendala
            </span>
            <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-[#1f1638] dark:text-white tabular-nums">
              {statCounts.uncomplete}
            </span>
            <span className="text-[10px] font-bold uppercase text-amber-600">WO</span>
          </div>
          <div className="mt-2 h-1 w-full rounded-full bg-amber-100 dark:bg-amber-950 overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${statCounts.total > 0 ? Math.min(100, Math.round((statCounts.uncomplete / statCounts.total) * 100)) : 0}%` }}
            />
          </div>
        </button>
      </div>

      {/* Search Bar & Horizontal Filter Pills */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[#7d7484] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari teknisi, No. WO, ID Customer, cluster, atau ODP/FAT..."
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-10 pr-9 py-2.5 bg-white dark:bg-[#1A0E2E] border border-[#e8ddff] dark:border-purple-900/60 rounded-2xl text-xs sm:text-sm text-[#1f1638] dark:text-white placeholder-[#7d7484] focus:outline-none focus:ring-2 focus:ring-[#7C3AED] shadow-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              title="Hapus pencarian"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
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
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  active
                    ? 'bg-[#58149c] text-white border-[#58149c] shadow-xs'
                    : 'bg-white dark:bg-[#1A0E2E] text-[#4b4452] dark:text-slate-300 border-[#e8ddff] dark:border-purple-900/60 hover:bg-[#f8f1ff]'
                }`}
              >
                {chip.label} ({chip.count})
              </button>
            );
          })}
        </div>
      </div>

      {/* VIEW MODE 1: STITCH LIVE PROGRESS CARDS */}
      {viewMode === 'cards' ? (
        <div className="space-y-4">
          {paginatedTickets.length === 0 ? (
            <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#f3eaff] dark:bg-purple-950/60 text-[#58149c] flex items-center justify-center mx-auto">
                <Inbox className="w-6 h-6" />
              </div>
              <div className="text-sm font-bold text-[#1f1638] dark:text-white">
                Tidak Ada WO Pada Filter Ini
              </div>
              <p className="text-xs text-[#4b4452] dark:text-slate-400 max-w-md mx-auto">
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
                  className="px-4 py-2 rounded-xl bg-[#58149c] text-white text-xs font-bold cursor-pointer"
                >
                  Tampilkan Semua WO ({statCounts.total})
                </button>
              )}
            </div>
          ) : (
            <div className={isMobileView ? 'grid grid-cols-1 gap-3.5' : 'grid grid-cols-1 lg:grid-cols-2 gap-4'}>
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
                    ? { text: 'Redaman Tinggi', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/30' }
                    : { text: 'Rx Optimal', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' }
                  : { text: 'Terukur', cls: 'bg-purple-500/20 text-purple-200 border-purple-400/30' };

                const issueReason =
                  (cat === 'uncomplete' || cat === 'cancel')
                    ? (t.remarksWOInstaller || (t as any).reasonWOInstaller || t.technicalReport?.rootCause || t.remarks || `Status laporan: ${t.statusWOInstaller}`)
                    : '';

                const photos = collectEvidencePhotos(t);
                const targetPhone = t.installerContact || installerUser?.phone || '';
                const canDirectWa = Boolean(onOpenWhatsApp || (targetPhone && isValidPhoneNumber(targetPhone)));

                return (
                  <div
                    key={t.id}
                    className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between gap-3.5"
                  >
                    <div className="space-y-3">
                      {/* Card Header: Technician, Category & WO Status */}
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative shrink-0">
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs border ${
                                cat === 'uncomplete' || cat === 'cancel'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-[#f3eaff] text-[#58149c] border-[#e8ddff]'
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
                                    : 'bg-[#7C3AED]'
                                }`}
                              />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-bold text-[#1f1638] dark:text-white truncate">
                                {t.installerName || 'Belum Di-assign'}
                              </span>
                              {installerUser?.username && (
                                <span className="px-1.5 py-0.5 rounded bg-[#f8f1ff] dark:bg-purple-950 border border-[#e8ddff] dark:border-purple-800 text-[10px] font-mono font-bold text-[#58149c] dark:text-purple-200 uppercase">
                                  @{installerUser.username}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#4b4452] dark:text-slate-300 truncate mt-0.5">
                              {t.ticketCategory || 'Work Order'} • {t.customerName}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 space-y-1">
                          <div className="font-mono font-bold text-xs text-[#1f1638] dark:text-purple-200">
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
                        className="w-full text-left p-2.5 rounded-xl bg-[#f8f1ff] dark:bg-[#251545]/80 border border-[#e8ddff] dark:border-purple-900/50 hover:border-[#7C3AED]/50 transition-colors flex items-start justify-between gap-2 cursor-pointer"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <MapPin className="w-4 h-4 text-[#58149c] dark:text-[#d0bcff] shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#1f1638] dark:text-white line-clamp-1">
                              {t.streetName || t.address || t.clusterName || 'Alamat pelanggan'}
                            </div>
                            <div className="text-[11px] text-[#4b4452] dark:text-slate-300 truncate mt-0.5">
                              {[t.fdtCode || t.fatCode, t.fatPort ? `Port ${t.fatPort}` : '', t.clusterName]
                                .filter(Boolean)
                                .join(' • ') || `Area: ${t.area || '-'}`}
                            </div>
                          </div>
                        </div>
                        {t.slotTime && (
                          <span className="shrink-0 px-2 py-0.5 rounded-lg bg-white dark:bg-[#1A0E2E] border border-[#e8ddff] dark:border-purple-800 text-[10px] font-mono font-semibold text-[#4b4452] dark:text-purple-200">
                            {t.slotTime}
                          </span>
                        )}
                      </button>

                      {/* Work Progress Bar & Check-in/out Timestamps */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5 font-semibold text-[#1f1638] dark:text-slate-200 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${meta.barColor}`} />
                            <span className="truncate">{meta.label}</span>
                          </div>
                          <span className="font-mono font-bold text-[#58149c] dark:text-[#d0bcff] shrink-0">
                            {meta.percent}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[#f3eaff] dark:bg-purple-950 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${meta.barColor}`}
                            style={{ width: `${meta.percent}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[#4b4452] dark:text-slate-400 pt-0.5">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-emerald-600" />
                            Check-in: <strong className="font-mono text-[#1f1638] dark:text-slate-200">{t.checkInAt ? formatJakartaTimeOnly(t.checkInAt) : '-'}</strong>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-blue-600" />
                            Check-out: <strong className="font-mono text-[#1f1638] dark:text-slate-200">{t.checkOutAt ? formatJakartaTimeOnly(t.checkOutAt) : '-'}</strong>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Timer className="w-3 h-3 text-[#7C3AED]" />
                            Durasi: <strong className="font-mono text-[#1f1638] dark:text-slate-200">{workStatus.durationFormatted}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Real OPM Telemetry Box (Shown ONLY if real DB reading exists) */}
                      {realOpm && (
                        <div className="rounded-xl bg-[#1f1638] text-white p-3 flex items-center justify-between gap-3 border border-[#342b4e]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-[#342b4e] flex items-center justify-center text-[#d0bcff] shrink-0">
                              <Radio className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] text-[#d0bcff] uppercase tracking-wider font-semibold">
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
                        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3 space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                            <span>HAMBATAN LAPANGAN</span>
                            <span>{t.statusWOInstaller}</span>
                          </div>
                          <p className="text-xs text-amber-950 dark:text-amber-100 leading-relaxed line-clamp-3">
                            {issueReason}
                          </p>
                        </div>
                      )}

                      {/* Real Field Photo Evidence Strip */}
                      {photos.length > 0 && (
                        <div className="rounded-xl bg-[#f8f1ff] dark:bg-[#251545]/70 border border-[#e8ddff] dark:border-purple-900/50 p-2.5 flex items-center justify-between gap-2.5">
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
                              className="w-11 h-11 rounded-lg overflow-hidden border border-[#cec3d4] bg-white shrink-0 relative group cursor-pointer"
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
                              <div className="text-xs font-bold text-[#1f1638] dark:text-white flex items-center gap-1">
                                <ImageIcon className="w-3.5 h-3.5 text-[#58149c]" />
                                <span>Bukti Lapangan ({photos.length} Foto)</span>
                              </div>
                              <div className="text-[11px] text-[#4b4452] dark:text-slate-300 truncate">
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
                            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1A0E2E] border border-[#e8ddff] text-[11px] font-bold text-[#58149c] dark:text-[#d0bcff] hover:bg-[#f3eaff] cursor-pointer"
                          >
                            Lihat Foto
                          </button>
                        </div>
                      )}
                    </div>

                    {/* RBAC-Safe Action Row (NO Dispatch Approval or Closing Buttons for Leader!) */}
                    <div className="pt-2 border-t border-[#f3eaff] dark:border-purple-900/40 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openCustomerAddressInGoogleMaps(t)}
                        className="flex-1 min-w-[110px] py-2 px-3 rounded-xl bg-white dark:bg-[#251545] hover:bg-[#f8f1ff] border border-[#e8ddff] dark:border-purple-800 text-xs font-bold text-[#1f1638] dark:text-white inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Navigation className="w-3.5 h-3.5 text-[#58149c] dark:text-[#d0bcff]" />
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
                            className="flex-1 min-w-[120px] py-2 px-3 rounded-xl bg-[#f3eaff] hover:bg-[#e8ddff] dark:bg-purple-950/80 border border-[#e8ddff] dark:border-purple-800 text-xs font-bold text-[#58149c] dark:text-[#d0bcff] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Hubungi Teknisi</span>
                          </a>
                        ) : onOpenWhatsApp ? (
                          <button
                            type="button"
                            onClick={() => onOpenWhatsApp(t)}
                            className="flex-1 min-w-[120px] py-2 px-3 rounded-xl bg-[#f3eaff] hover:bg-[#e8ddff] dark:bg-purple-950/80 border border-[#e8ddff] dark:border-purple-800 text-xs font-bold text-[#58149c] dark:text-[#d0bcff] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Hubungi WA</span>
                          </button>
                        ) : null
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectTicket(t)}
                        className="flex-1 min-w-[120px] py-2 px-3 rounded-xl bg-[#58149c] hover:bg-[#6a46c1] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
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
            <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
              <div className="text-[#4b4452] dark:text-slate-300">
                Menampilkan <strong className="text-[#1f1638] dark:text-white">{paginatedTickets.length}</strong> dari{' '}
                <strong className="text-[#1f1638] dark:text-white">{displayTickets.length}</strong> Work Order hari ini
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 bg-[#f8f1ff] dark:bg-slate-800 border border-[#e8ddff] rounded-lg font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    Sebelumnya
                  </button>
                  <span className="px-3 py-1 font-mono font-bold text-[#58149c] dark:text-[#d0bcff]">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 bg-[#f8f1ff] dark:bg-slate-800 border border-[#e8ddff] rounded-lg font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    Selanjutnya
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* VIEW MODE 2: PRESERVED 11-COLUMN FULL TABLE WITH EXPORT & EXPAND */
        <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-[#e8ddff] dark:border-purple-900/40 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="text-xs font-bold text-[#1f1638] dark:text-white">
              Tabel Monitoring Lengkap ({displayTickets.length} WO)
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 bg-[#f8f1ff] dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-[#e8ddff] dark:border-purple-900/60">
                <span className="text-[#4b4452] dark:text-slate-400">Tampil:</span>
                <select
                  value={rowsPerPage}
                  onChange={e => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-transparent font-bold text-[#1f1638] dark:text-slate-200 focus:outline-none"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={-1}>Semua ({displayTickets.length})</option>
                </select>
              </div>

              <div className="flex items-center gap-1 bg-[#f8f1ff] dark:bg-slate-800 p-1 rounded-xl border border-[#e8ddff] dark:border-purple-900/60">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2 py-1 text-[#1f1638] dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg flex items-center gap-1 font-semibold transition-all cursor-pointer"
                  title="Salin Data ke Clipboard"
                >
                  <Copy className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{copySuccess ? 'Disalin!' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-2 py-1 text-[#1f1638] dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg flex items-center gap-1 font-semibold transition-all cursor-pointer"
                  title="Export CSV"
                >
                  <Download className="w-3.5 h-3.5 text-blue-500" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="px-2 py-1 text-[#1f1638] dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg flex items-center gap-1 font-semibold transition-all cursor-pointer"
                  title="Export Excel (.xlsx)"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-2 py-1 text-[#1f1638] dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg flex items-center gap-1 font-semibold transition-all cursor-pointer"
                  title="Cetak Tabel"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-600" />
                  <span>Print</span>
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-[#f3eaff] dark:bg-[#251545] text-[#58149c] dark:text-purple-200 uppercase font-bold text-[10.5px] tracking-wider border-b border-[#e8ddff] dark:border-purple-900/60">
                <tr>
                  <th className="py-3 px-2 w-8 text-center">#</th>
                  <th
                    onClick={() => handleSort('installerName')}
                    className="py-3 px-3 font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[130px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Nama Installer</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('woNumber')}
                    className="py-3 px-3 font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[120px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>WO Number</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('idCustomer')}
                    className="py-3 px-3 font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[110px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Customer ID</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('area')}
                    className="py-3 px-3 font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[90px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Area</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('contractor')}
                    className="py-3 px-3 font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[130px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Contractor</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('checkInAt')}
                    className="py-3 px-3 font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[120px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Waktu Check-in</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('checkOutAt')}
                    className="py-3 px-3 font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[120px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Waktu Check-out</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('workDuration')}
                    className="py-3 px-3 font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[110px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Durasi Kerja</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('workStatus')}
                    className="py-3 px-3 text-center font-bold cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 select-none min-w-[120px]"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Status Pekerjaan</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right font-bold min-w-[80px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-purple-900/30">
                {paginatedTickets.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-400 text-xs">
                      Tidak ada Work Order yang sesuai dengan filter atau pencarian aktif.
                    </td>
                  </tr>
                ) : (
                  paginatedTickets.map(t => {
                    const isExpanded = !!expandedRowIds[t.id];
                    const workStatus = getTicketWorkStatus(t);
                    const contractorName = t.contractorName || t.contactorName || leaderContractor || '-';

                    return (
                      <React.Fragment key={t.id}>
                        <tr
                          className={`hover:bg-purple-50/50 dark:hover:bg-purple-950/30 transition-colors ${
                            isExpanded ? 'bg-purple-50/70 dark:bg-[#251545]/50 font-medium' : ''
                          }`}
                        >
                          <td className="py-3 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => toggleRowExpand(t.id)}
                              className="p-1 rounded-lg text-slate-400 hover:text-[#58149c] hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
                              title={isExpanded ? 'Tutup Rincian' : 'Buka Rincian'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-[#58149c]" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5 font-bold text-[#1f1638] dark:text-slate-200">
                              <UserCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span className="truncate max-w-[130px]">{t.installerName || 'Belum Di-assign'}</span>
                            </div>
                            {t.installerContact && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                {t.installerContact}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-mono font-bold text-[#58149c] dark:text-purple-300">
                              {t.woNumber}
                            </div>
                            <div className="text-[10.5px] text-slate-500 truncate max-w-[150px]">
                              {t.customerName}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-[#1f1638] dark:text-slate-200">
                            {t.idCustomer || '-'}
                          </td>
                          <td className="py-3 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              {t.area || '-'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                            <div className="truncate max-w-[130px]" title={contractorName}>
                              {contractorName}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {t.checkInAt ? (
                              <div className="flex items-center gap-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                <Clock className="w-3 h-3 text-emerald-500 shrink-0" />
                                <span>{formatJakartaTimeOnly(t.checkInAt)}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {t.checkOutAt ? (
                              <div className="flex items-center gap-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                <CheckCircle2 className="w-3 h-3 text-blue-500 shrink-0" />
                                <span>{formatJakartaTimeOnly(t.checkOutAt)}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1 font-medium text-[11px] text-slate-700 dark:text-slate-300">
                              <Timer className="w-3 h-3 text-purple-500 shrink-0" />
                              <span>{workStatus.durationFormatted}</span>
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
                          <td className="py-3 px-3 text-right space-x-1 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onSelectTicket(t)}
                              className="px-2.5 py-1 bg-[#58149c] hover:bg-[#3B1D78] text-white font-bold rounded-lg text-xs shadow-xs transition-all cursor-pointer inline-flex items-center gap-1"
                              title="Buka Lembar Kerja WO"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Detail</span>
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-[#f8f1ff] dark:bg-[#1E1238] border-b border-purple-200 dark:border-purple-900/60">
                            <td colSpan={11} className="p-4 sm:p-5">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                                <div className="p-3 bg-white dark:bg-[#150A26] rounded-xl border border-purple-100 dark:border-purple-900/50 space-y-1">
                                  <div className="text-[10px] uppercase font-bold text-slate-400">Installer</div>
                                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                    <UserCheck className="w-3.5 h-3.5 text-indigo-500" />
                                    <span>{t.installerName || 'Belum Di-assign'}</span>
                                  </div>
                                  {t.installerContact && (
                                    <div className="text-[11px] text-slate-500 font-mono">
                                      Telp: {t.installerContact}
                                    </div>
                                  )}
                                </div>

                                <div className="p-3 bg-white dark:bg-[#150A26] rounded-xl border border-purple-100 dark:border-purple-900/50 space-y-1">
                                  <div className="text-[10px] uppercase font-bold text-slate-400">Slot Time</div>
                                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                                    <span>{t.slotTime || (t as any).timeSlot || '-'}</span>
                                  </div>
                                  <div className="text-[11px] text-slate-500">Area: {t.area || '-'}</div>
                                </div>

                                <div className="p-3 bg-white dark:bg-[#150A26] rounded-xl border border-purple-100 dark:border-purple-900/50 space-y-1">
                                  <div className="text-[10px] uppercase font-bold text-slate-400">WO Agent & Reason</div>
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Status: <strong className="text-[#58149c] dark:text-purple-300">{t.statusWOAgent || '-'}</strong>
                                  </div>
                                  <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                                    Reason: {(t as any).reasonWOAgent || '-'}
                                  </div>
                                </div>

                                <div className="p-3 bg-white dark:bg-[#150A26] rounded-xl border border-purple-100 dark:border-purple-900/50 space-y-1">
                                  <div className="text-[10px] uppercase font-bold text-slate-400">WO Installer & Remarks</div>
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Status: <strong className="text-emerald-600">{t.statusWOInstaller || '-'}</strong>
                                  </div>
                                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                                    Reason: {(t as any).reasonWOInstaller || '-'}
                                  </div>
                                  <div className="text-[11px] text-slate-600 dark:text-slate-400 italic">
                                    Remarks: {t.remarksWOInstaller || '-'}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 pt-3 border-t border-purple-100 dark:border-purple-900/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-1.5 flex-1">
                                  <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                                  <span className="line-clamp-2">{t.address || 'Alamat tidak tersedia'}</span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => openCustomerAddressInGoogleMaps(t)}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                                  >
                                    <ExternalLink className="w-3 h-3 text-rose-500" />
                                    <span>Google Maps</span>
                                  </button>

                                  {onOpenWhatsApp && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenWhatsApp(t)}
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg flex items-center gap-1 shadow-xs cursor-pointer"
                                    >
                                      <MessageSquare className="w-3 h-3" />
                                      <span>Kirim WA</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => onSelectTicket(t)}
                                    className="px-3 py-1 bg-[#58149c] hover:bg-[#3B1D78] text-white font-bold rounded-lg shadow-xs cursor-pointer"
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

          <div className="p-4 border-t border-[#e8ddff] dark:border-purple-900/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="text-slate-500">
              Menampilkan <strong className="font-bold text-slate-800 dark:text-slate-200">{paginatedTickets.length}</strong> dari{' '}
              <strong className="font-bold text-slate-800 dark:text-slate-200">{displayTickets.length}</strong> Work Order
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 bg-slate-50 dark:bg-slate-800 border rounded-lg font-semibold disabled:opacity-40 cursor-pointer"
                >
                  Sebelumnya
                </button>
                <span className="px-3 py-1 font-mono font-bold text-[#58149c]">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 bg-slate-50 dark:bg-slate-800 border rounded-lg font-semibold disabled:opacity-40 cursor-pointer"
                >
                  Selanjutnya
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stitch Bottom Coordination Strip: Broadcast Panduan Lapangan */}
      <div className="bg-[#f3eaff] dark:bg-[#251545] rounded-2xl border border-[#e8ddff] dark:border-purple-800/60 p-3.5 sm:p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#58149c] text-white flex items-center justify-center shrink-0 shadow-xs">
            <Send className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-bold text-[#1f1638] dark:text-white truncate">
              Broadcast Panduan Lapangan
            </div>
            <div className="text-[11px] text-[#4b4452] dark:text-purple-200/80 truncate">
              Kirim instruksi SOP / peringatan cuaca ke {scopedInstallers.length} teknisi aktif
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsBroadcastModalOpen(true)}
          className="shrink-0 px-4 py-2 rounded-xl bg-white dark:bg-[#1A0E2E] hover:bg-[#58149c] hover:text-white text-[#58149c] dark:text-[#d0bcff] border border-[#e8ddff] dark:border-purple-700 text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          Kirim
        </button>
      </div>

      {/* Evidence Lightbox Modal */}
      {lightboxData && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxData(null)}
        >
          <div
            className="bg-white dark:bg-[#1A0E2E] rounded-2xl max-w-2xl w-full overflow-hidden border border-[#e8ddff] dark:border-purple-800 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[#e8ddff] dark:border-purple-900/50 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-[#1f1638] dark:text-white">
                  Bukti Lapangan • #{lightboxData.woNumber}
                </div>
                <div className="text-[11px] text-[#4b4452] dark:text-slate-300">
                  {lightboxData.installerName} — {lightboxData.photos[lightboxData.activeIndex]?.label}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLightboxData(null)}
                className="p-1.5 rounded-lg hover:bg-[#f3eaff] text-[#4b4452] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-[#1f1638] flex items-center justify-center max-h-[65vh] overflow-hidden p-2">
              <img
                src={lightboxData.photos[lightboxData.activeIndex]?.url}
                alt={lightboxData.photos[lightboxData.activeIndex]?.label}
                className="max-h-[60vh] w-auto object-contain rounded-lg"
              />
            </div>
            {lightboxData.photos.length > 1 && (
              <div className="p-3 flex items-center gap-2 overflow-x-auto bg-[#f8f1ff] dark:bg-[#251545]">
                {lightboxData.photos.map((photo, idx) => (
                  <button
                    key={photo.url}
                    type="button"
                    onClick={() =>
                      setLightboxData(prev => (prev ? { ...prev, activeIndex: idx } : null))
                    }
                    className={`w-14 h-14 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer ${
                      idx === lightboxData.activeIndex ? 'border-[#58149c]' : 'border-transparent opacity-65'
                    }`}
                  >
                    <img src={photo.url} alt={photo.label} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Broadcast Panduan Lapangan Modal */}
      {isBroadcastModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setIsBroadcastModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#1A0E2E] rounded-2xl max-w-lg w-full border border-[#e8ddff] dark:border-purple-800 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#e8ddff] dark:border-purple-900/50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#1f1638] dark:text-white">
                  Broadcast Panduan Lapangan
                </h3>
                <p className="text-[11px] text-[#4b4452] dark:text-slate-300">
                  Koordinasi cepat untuk teknisi {leaderContractor}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBroadcastModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[#f3eaff] text-[#4b4452] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#1f1638] dark:text-slate-200 mb-1.5">
                  Pesan Instruksi Lapangan
                </label>
                <textarea
                  rows={3}
                  value={broadcastMessage}
                  onChange={e => setBroadcastMessage(e.target.value)}
                  className="w-full rounded-xl border border-[#e8ddff] dark:border-purple-800 bg-[#f8f1ff] dark:bg-[#251545] p-3 text-xs text-[#1f1638] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1f1638] dark:text-slate-200">
                  Kirim ke Teknisi ({scopedInstallers.length})
                </span>
                <button
                  type="button"
                  onClick={handleCopyBroadcast}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f3eaff] hover:bg-[#e8ddff] text-[11px] font-bold text-[#58149c] cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>{broadcastCopied ? 'Tersalin!' : 'Salin Teks'}</span>
                </button>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                {scopedInstallers.length === 0 ? (
                  <div className="text-xs text-slate-500 py-4 text-center">
                    Belum ada teknisi aktif terdaftar pada scope mitra ini.
                  </div>
                ) : (
                  scopedInstallers.map(inst => {
                    const validPhone = inst.phone && isValidPhoneNumber(inst.phone);
                    return (
                      <div
                        key={inst.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#f8f1ff] dark:bg-[#251545] border border-[#e8ddff] dark:border-purple-900/50"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#1f1638] dark:text-white truncate">
                            {inst.name}
                          </div>
                          <div className="text-[10.5px] font-mono text-[#4b4452] dark:text-slate-300">
                            {inst.phone || 'Nomor WA belum diisi'}
                          </div>
                        </div>
                        {validPhone ? (
                          <a
                            href={buildWhatsAppClickToChatUrl(inst.phone!, broadcastMessage).url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Kirim WA</span>
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-400">No WA N/A</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
