import React, { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { Ticket } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { StatusAgentBadge, StatusInstallerBadge, StatusWhatsAppBadge, StatusApprovalBadge } from '../common/Badge';
import { TicketMobileCard } from './TicketMobileCard';
import {
  Search,
  SlidersHorizontal,
  Download,
  Eye,
  MessageSquare,
  Archive,
  RotateCcw,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Smartphone,
  Monitor,
  Trash2,
  ShieldAlert,
  Calendar,
  AlertTriangle,
  X,
  MessageCircle,
  MapPin,
  RefreshCw,
  Ticket as TicketIcon,
  Sparkles,
  Copy,
  Check,
  CheckCircle2,
  Zap,
  ShieldCheck,
  Image as ImageIcon,
  Wrench,
  FileText,
  Clock,
  ExternalLink,
  Lock,
  Camera
} from 'lucide-react';
import { useAnimation } from '../../context/AnimationContext';
import { useToast } from '../../context/ToastContext';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { ManagementDataDeleteModal } from '../portals/ManagementDataDeleteModal';
import {
  getJakartaDateString,
  getTicketAppointmentDate
} from '../../services/appointmentDateParser';
import {
  formatIndonesianWODate,
  executeSuperadminDispatchSearch
} from '../../services/woDateFilterEngine';
import { getNextSortDirection, sortDataArray, SortDirection } from '../../utils/tableSorting';

const getTicketColumnValue = (ticket: Ticket, key: string): any => {
  const latestReport = ticket.progressReports?.[0];
  switch (key) {
    case 'customerPhone':
      return ticket.customerPhone || (ticket as any).phoneNumber;
    case 'contactorName':
      return ticket.contactorName || ticket.contractorName;
    case 'streetName':
      return ticket.streetName || (ticket as any).customerAddress || (ticket as any).address;
    case 'rosetRedamanDbm':
      return (
        ticket.rosetRedamanDbm ??
        ticket.technicalReport?.opticalPowerRx ??
        ticket.technicalReport?.opticalPowerDbm
      );
    case 'dropcoreLength':
      return ticket.dropcoreLength ?? ticket.dropcoreLengthMeter;
    case 'stb1Sn':
      return ticket.stb1Sn || ticket.stbSerialNumber;
    case 'reportStatusLabel':
      return (
        ticket.reportStatusLabel ||
        latestReport?.reportStatusLabel ||
        latestReport?.reportStatus ||
        ticket.technicalReport?.workResult
      );
    case 'reasonReportLabel':
      return (
        ticket.reasonReportLabel ||
        latestReport?.reasonReportLabel ||
        latestReport?.reasonReport
      );
    case 'rootcauseLabel':
      return (
        ticket.rootcauseLabel ||
        latestReport?.rootcauseLabel ||
        latestReport?.rootCause
      );
    case 'rejectionReason':
      return ticket.rejectionReason || ticket.dispatchRejectionNotes;
    case 'reassignHistoryCount': {
      if (typeof ticket.reassignHistoryCount === 'number') return ticket.reassignHistoryCount;
      if (Array.isArray(ticket.assignmentHistory) && ticket.assignmentHistory.length > 1) {
        return ticket.assignmentHistory.length - 1;
      }
      return 0;
    }
    case 'photoEvidenceCount': {
      if (typeof ticket.photoEvidenceCount === 'number') return ticket.photoEvidenceCount;
      const count = Array.from(
        new Set(
          [
            ...(ticket.technicalReport?.photos || []),
            ticket.technicalReport?.photoBeforeUrl,
            ticket.technicalReport?.photoAfterUrl
          ].filter((u): u is string => Boolean(u && typeof u === 'string' && u.trim()))
        )
      ).length;
      return count > 0 ? count : undefined;
    }
    default:
      return (ticket as any)[key];
  }
};

const formatDateTimeDisplay = (val: any, dateOnly = false): string => {
  if (val === undefined || val === null || String(val).trim() === '') return '';
  if (dateOnly) {
    return formatIndonesianWODate(String(val)) || String(val);
  }
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta'
  });
};

const parseDbmNumeric = (val: any): number | null => {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/dbm/gi, '').replace(',', '.').trim();
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
};

interface TicketsTableProps {
  onSelectTicket: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
  onNavigate: (tab: string) => void;
}

export const TicketsTable: React.FC<TicketsTableProps> = ({ onSelectTicket, onOpenWhatsApp, onNavigate }) => {
  const {
    tickets,
    currentUser,
    archiveTicket,
    restoreTicket,
    assignTicketPersonnel,
    approveProgressReport,
    rejectProgressReport,
    installersList,
    getTicketUnreadCount,
    todayWIB,
    refreshActiveTickets
  } = useApp();
  const { config, setColumnVisibility, applyPreset, isMobileView } = useUIConfig();
  const { triggerRefresh } = useAnimation();
  const { toast } = useToast();

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Layout mode: 'cards' or 'table'
  const [layoutMode, setLayoutMode] = useState<'cards' | 'table' | 'auto'>('auto');

  const effectiveLayout: 'cards' | 'table' =
    layoutMode === 'auto'
      ? (isMobileView || config.device?.android?.layoutType === 'cards' ? 'cards' : 'table')
      : layoutMode;

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedArea, setSelectedArea] = useState('ALL');
  const [selectedAgentStatus, setSelectedAgentStatus] = useState('ALL');
  const [selectedInstallerStatus, setSelectedInstallerStatus] = useState('ALL');
  const [selectedWhatsAppStatus, setSelectedWhatsAppStatus] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedApprovalStatus, setSelectedApprovalStatus] = useState('ALL');
  const [showArchived, setShowArchived] = useState(false);

  // Inline Verification Drawer & Clipboard state
  const [expandedDrawerTicketId, setExpandedDrawerTicketId] = useState<string | null>(null);
  const [inlineNotes, setInlineNotes] = useState('');
  const [inlineRejectReason, setInlineRejectReason] = useState('');
  const [showInlineRejectBox, setShowInlineRejectBox] = useState(false);
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [copiedWoId, setCopiedWoId] = useState<string | null>(null);

  // Keyboard shortcuts: Ctrl+K / Cmd+K focus search, ESC clears when focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current && searchTerm) {
        setSearchTerm('');
        setCurrentPage(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchTerm]);

  // Role-scoped base tickets for todayWIB (for accurate KPI strip counts)
  const roleScopedTodayTickets = useMemo(() => {
    const todayStr = todayWIB || getJakartaDateString(0);
    return (tickets || []).filter(t => {
      if (!t || t.isDeleted || t.isArchived) return false;
      const appDate = getTicketAppointmentDate(t);
      if (!appDate || appDate !== todayStr) return false;

      if (currentUser?.role === 'leader') {
        const currentLeaderName = (currentUser.name || '').trim().toLowerCase();
        const currentLeaderArea = (currentUser.area || '').trim().toLowerCase();
        const currentLeaderContractor = (currentUser.contractor || '').trim().toLowerCase();

        const tLeader = (t.leaderName || '').trim().toLowerCase();
        if (tLeader && currentLeaderName && tLeader !== currentLeaderName) return false;

        if (currentLeaderArea) {
          const tArea = (t.area || '').trim().toLowerCase();
          if (tArea && tArea !== currentLeaderArea) return false;
        }

        if (currentLeaderContractor) {
          const tCont = (t.contactorName || t.contractorName || '').trim().toLowerCase();
          if (tCont && tCont !== currentLeaderContractor) return false;
        }
      } else if (currentUser?.role === 'installer') {
        const currentInstallerName = (currentUser.name || '').trim().toLowerCase();
        const currentInstallerPhone = (currentUser.phone || '').trim();
        const currentInstallerArea = (currentUser.area || '').trim().toLowerCase();

        const tInstaller = (t.installerName || '').trim().toLowerCase();
        const tContact = (t.installerContact || '').trim();
        const cleanMyName = currentInstallerName.replace(/\(.*?\)/g, '').trim();

        const isAssignedToMe =
          Boolean(
            tInstaller &&
              (tInstaller === currentInstallerName ||
                tInstaller === cleanMyName ||
                tInstaller.includes(cleanMyName) ||
                cleanMyName.includes(tInstaller))
          ) ||
          Boolean(
            tContact &&
              currentInstallerPhone &&
              tContact.replace(/\D/g, '') === currentInstallerPhone.replace(/\D/g, '')
          );

        if (!isAssignedToMe) return false;

        if (currentInstallerArea) {
          const tArea = (t.area || '').trim().toLowerCase();
          if (tArea && tArea !== currentInstallerArea) return false;
        }
      }

      return true;
    });
  }, [tickets, todayWIB, currentUser]);

  // Approval & operational counts across today's scoped tickets
  const approvalCounts = useMemo(() => {
    let butuhApproval = 0;
    let approved = 0;
    let rejected = 0;
    let closed = 0;
    let diLapangan = 0;
    const totalToday = roleScopedTodayTickets.length;

    roleScopedTodayTickets.forEach(t => {
      if (t.approvalStatus === 'BUTUH APPROVAL') butuhApproval++;
      if (t.approvalStatus === 'APPROVED') approved++;
      if (t.approvalStatus === 'REJECTED' || t.approvalStatus === 'REVISI') rejected++;
      if (t.statusWOAgent === 'Closed') closed++;
      if (
        ['En Route', 'On Site', 'In Progress', 'PROGRESS'].includes(String(t.statusWOInstaller)) ||
        ['In Progress', 'PROGRESS'].includes(String(t.statusWOAgent))
      ) {
        diLapangan++;
      }
    });
    return { butuhApproval, approved, rejected, closed, diLapangan, totalToday };
  }, [roleScopedTodayTickets]);

  // Cross-date search for Superadmin and Dispatch (strictly by woNumber or idCustomer)
  const isCrossDateSearchEligible = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  const crossDateSearchResults = useMemo(() => {
    if (isCrossDateSearchEligible && searchTerm.trim()) {
      return executeSuperadminDispatchSearch(searchTerm, tickets);
    }
    return { isSearchActive: false, results: [], resultTickets: [], crossDateCount: 0 };
  }, [isCrossDateSearchEligible, searchTerm, tickets]);

  const isCrossDateActive = crossDateSearchResults.isSearchActive;

  // 3-State Sorting state (asc -> desc -> null)
  const [sortField, setSortField] = useState<string>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkInstaller, setBulkInstaller] = useState('');
  const [ticketToDelete, setTicketToDelete] = useState<Ticket | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  // Column manager popover
  const [showColManager, setShowColManager] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | 'ALL'>(config.ticketsTable.rowsPerPage || 10);

  useEffect(() => {
    setPageSize(config.ticketsTable.rowsPerPage || 10);
  }, [config.ticketsTable.rowsPerPage]);

  // Visible canonical data columns sorted by order (selection & actions are pinned separately)
  const rawVisibleColumns = useMemo(() => {
    return [...config.ticketsTable.columns]
      .filter(col => col.visible && col.key !== 'selection' && col.key !== 'actions')
      .sort((a, b) => a.order - b.order);
  }, [config.ticketsTable.columns]);

  // Unique areas (scoped for Leader and Installer)
  const areas = useMemo(() => {
    if ((currentUser.role === 'leader' || currentUser.role === 'installer') && currentUser.area) {
      return [currentUser.area];
    }
    const set = new Set(tickets.map(t => t.area).filter(Boolean));
    return Array.from(set).sort();
  }, [tickets, currentUser.role, currentUser.area]);

  // Unique Ticket Categories
  const ticketCategories = useMemo(() => {
    const set = new Set(tickets.map(t => t.ticketCategory).filter(Boolean));
    return Array.from(set).sort();
  }, [tickets]);

  // Total unread chat count across tickets
  const totalUnreadAcrossTickets = useMemo(() => {
    return tickets.reduce((acc, t) => acc + (getTicketUnreadCount(t.id) > 0 ? 1 : 0), 0);
  }, [tickets, getTicketUnreadCount]);

  // Filtering based on strict Appointment Date === todayWIB rules uniformly across all roles
  const filteredTickets = useMemo(() => {
    const todayStr = todayWIB || getJakartaDateString(0);

    if (isCrossDateActive) {
      return crossDateSearchResults.resultTickets.filter(t => {
        if (!t || t.isDeleted) return false;
        if (showArchived ? !t.isArchived : t.isArchived) return false;
        if (selectedArea !== 'ALL' && t.area !== selectedArea) return false;
        if (selectedAgentStatus !== 'ALL' && t.statusWOAgent !== selectedAgentStatus) return false;
        if (selectedInstallerStatus !== 'ALL' && t.statusWOInstaller !== selectedInstallerStatus) return false;
        if (selectedWhatsAppStatus !== 'ALL' && t.statusWhatsApp !== selectedWhatsAppStatus) return false;
        if (selectedCategory !== 'ALL' && t.ticketCategory !== selectedCategory) return false;
        if (selectedApprovalStatus !== 'ALL') {
          if (selectedApprovalStatus === 'CLOSED') {
            if (t.statusWOAgent !== 'Closed') return false;
          } else if (selectedApprovalStatus === 'REJECTED') {
            if (t.approvalStatus !== 'REJECTED' && t.approvalStatus !== 'REVISI') return false;
          } else if (t.approvalStatus !== selectedApprovalStatus) {
            return false;
          }
        }
        return true;
      });
    }

    return (tickets || []).filter(t => {
      if (!t || t.isDeleted) return false;
      if (showArchived ? !t.isArchived : t.isArchived) return false;

      const woDate = getTicketAppointmentDate(t);
      if (!woDate || woDate !== todayStr) return false;

      if (currentUser?.role === 'leader') {
        const currentLeaderName = (currentUser.name || '').trim().toLowerCase();
        const currentLeaderArea = (currentUser.area || '').trim().toLowerCase();
        const currentLeaderContractor = (currentUser.contractor || '').trim().toLowerCase();

        const tLeader = (t.leaderName || '').trim().toLowerCase();
        if (tLeader && currentLeaderName && tLeader !== currentLeaderName) return false;

        if (currentLeaderArea) {
          const tArea = (t.area || '').trim().toLowerCase();
          if (tArea && tArea !== currentLeaderArea) return false;
        }

        if (currentLeaderContractor) {
          const tCont = (t.contactorName || t.contractorName || '').trim().toLowerCase();
          if (tCont && tCont !== currentLeaderContractor) return false;
        }
      } else if (currentUser?.role === 'installer') {
        const currentInstallerName = (currentUser.name || '').trim().toLowerCase();
        const currentInstallerPhone = (currentUser.phone || '').trim();
        const currentInstallerArea = (currentUser.area || '').trim().toLowerCase();

        const tInstaller = (t.installerName || '').trim().toLowerCase();
        const tContact = (t.installerContact || '').trim();
        const cleanMyName = currentInstallerName.replace(/\(.*?\)/g, '').trim();

        const isAssignedToMe =
          Boolean(
            tInstaller &&
              (tInstaller === currentInstallerName ||
                tInstaller === cleanMyName ||
                tInstaller.includes(cleanMyName) ||
                cleanMyName.includes(tInstaller))
          ) ||
          Boolean(
            tContact &&
              currentInstallerPhone &&
              tContact.replace(/\D/g, '') === currentInstallerPhone.replace(/\D/g, '')
          );

        if (!isAssignedToMe) return false;

        if (currentInstallerArea) {
          const tArea = (t.area || '').trim().toLowerCase();
          if (tArea && tArea !== currentInstallerArea) return false;
        }
      }

      if (selectedArea !== 'ALL' && t.area !== selectedArea) return false;
      if (selectedAgentStatus !== 'ALL' && t.statusWOAgent !== selectedAgentStatus) return false;
      if (selectedInstallerStatus !== 'ALL' && t.statusWOInstaller !== selectedInstallerStatus) return false;
      if (selectedWhatsAppStatus !== 'ALL' && t.statusWhatsApp !== selectedWhatsAppStatus) return false;
      if (selectedCategory !== 'ALL' && t.ticketCategory !== selectedCategory) return false;

      if (selectedApprovalStatus !== 'ALL') {
        if (selectedApprovalStatus === 'CLOSED') {
          if (t.statusWOAgent !== 'Closed') return false;
        } else if (selectedApprovalStatus === 'REJECTED') {
          if (t.approvalStatus !== 'REJECTED' && t.approvalStatus !== 'REVISI') return false;
        } else if (t.approvalStatus !== selectedApprovalStatus) {
          return false;
        }
      }

      if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const matchWo = (t.woNumber ? String(t.woNumber).toLowerCase() : '').includes(q);
        const matchCust = (t.customerName ? String(t.customerName).toLowerCase() : '').includes(q);
        const matchId = (t.idCustomer ? String(t.idCustomer).toLowerCase() : '').includes(q);
        const matchPhone = String(t.customerPhone || '').includes(q);
        const matchInstaller = (t.installerName ? String(t.installerName).toLowerCase() : '').includes(q);
        const matchCluster = (t.clusterName ? String(t.clusterName).toLowerCase() : '').includes(q);
        const matchCategory = (t.ticketCategory ? String(t.ticketCategory).toLowerCase() : '').includes(q);
        if (!matchWo && !matchCust && !matchId && !matchPhone && !matchInstaller && !matchCluster && !matchCategory) {
          return false;
        }
      }

      return true;
    });
  }, [
    tickets,
    showArchived,
    isCrossDateActive,
    crossDateSearchResults,
    todayWIB,
    currentUser,
    selectedArea,
    selectedAgentStatus,
    selectedInstallerStatus,
    selectedWhatsAppStatus,
    selectedCategory,
    selectedApprovalStatus,
    searchTerm
  ]);

  // Sorting
  const sortedTickets = useMemo(() => {
    if (!sortDirection) return filteredTickets;
    return sortDataArray(filteredTickets, { column: sortField, direction: sortDirection }, (item, col) => {
      if (col === 'woNumber') return item.woNumber;
      if (col === 'date' || col === 'appointmentDate') return item.appointmentDate || '';
      if (col === 'statusWOInstaller') return item.statusWOInstaller;
      if (col === 'statusWOAgent') return item.statusWOAgent;
      if (col === 'slotTime') return item.slotTime;
      return (item as any)[col];
    });
  }, [filteredTickets, sortField, sortDirection]);

  const effectiveRowsPerPage = pageSize === 'ALL' ? (sortedTickets.length || 10) : pageSize;

  // Paginated rows
  const paginatedTickets = useMemo(() => {
    if (pageSize === 'ALL') return sortedTickets;
    const startIndex = (currentPage - 1) * effectiveRowsPerPage;
    return sortedTickets.slice(startIndex, startIndex + effectiveRowsPerPage);
  }, [sortedTickets, currentPage, effectiveRowsPerPage, pageSize]);

  // Apply Smart Omit (Kosong) cleanly on optional columns outside Groups A & B
  const activeColumns = useMemo(() => {
    if (!config.ticketsTable.smartOmitEmpty || paginatedTickets.length === 0) {
      return rawVisibleColumns;
    }
    return rawVisibleColumns.filter(col => {
      if (col.mandatory || col.categoryGroup === 'A' || col.categoryGroup === 'B') return true;
      return paginatedTickets.some(t => {
        const val = getTicketColumnValue(t, col.key);
        if (val === undefined || val === null) return false;
        if (Array.isArray(val)) return val.length > 0;
        const str = String(val).trim();
        return str !== '' && str !== '-';
      });
    });
  }, [rawVisibleColumns, config.ticketsTable.smartOmitEmpty, paginatedTickets]);

  const omittedEmptyCount = rawVisibleColumns.length - activeColumns.length;

  const stickyColumnsEnabled = config.device?.pc?.stickyColumns !== false;
  const freezeColumnCount = Math.max(1, Math.min(4, config.ticketsTable.freezeColumnCount ?? 4));

  // Cumulative sticky-left pixel positions for frozen data columns (after 44px selection column)
  const stickyLeftMap = useMemo(() => {
    const map: Record<string, { left: number; isLastFrozen: boolean }> = {};
    if (!stickyColumnsEnabled) return map;
    const freezeDataColsCount = Math.min(Math.max(0, freezeColumnCount - 1), activeColumns.length);
    let accLeft = 44; // Selection column width
    for (let i = 0; i < freezeDataColsCount; i++) {
      const col = activeColumns[i];
      const w = col.width || 130;
      map[col.key] = {
        left: accLeft,
        isLastFrozen: i === freezeDataColsCount - 1
      };
      accLeft += w;
    }
    return map;
  }, [activeColumns, freezeColumnCount, stickyColumnsEnabled]);

  const totalPages = pageSize === 'ALL' ? 1 : (Math.ceil(sortedTickets.length / effectiveRowsPerPage) || 1);

  const handleSort = (fieldKey: string) => {
    const nextDir = getNextSortDirection(sortField, sortDirection, fieldKey);
    setSortField(nextDir ? fieldKey : 'updatedAt');
    setSortDirection(nextDir);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === paginatedTickets.length && paginatedTickets.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedTickets.map(t => t.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApplyBulkAssign = () => {
    if (currentUser.role !== 'leader') {
      toast.error('Akses Ditolak: Hanya Leader yang berwenang menugaskan WO ke teknisi.');
      return;
    }
    if (!bulkInstaller) {
      toast.error('Pilih teknisi terlebih dahulu.');
      return;
    }
    selectedIds.forEach(id => {
      assignTicketPersonnel(id, currentUser.name, bulkInstaller);
    });
    toast.success(`${selectedIds.size} WO berhasil ditugaskan ke ${bulkInstaller}.`);
    setSelectedIds(new Set());
  };

  const handleCopyWoNumber = async (e: React.MouseEvent, ticket: Ticket) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(ticket.woNumber);
      setCopiedWoId(ticket.id);
      toast.info(`Nomor WO ${ticket.woNumber} disalin.`);
      setTimeout(() => setCopiedWoId(prev => (prev === ticket.id ? null : prev)), 1600);
    } catch {
      toast.error('Gagal menyalin Nomor WO ke clipboard.');
    }
  };

  const toggleInlineDrawer = (ticketId: string) => {
    if (expandedDrawerTicketId === ticketId) {
      setExpandedDrawerTicketId(null);
      setShowInlineRejectBox(false);
      setInlineNotes('');
      setInlineRejectReason('');
    } else {
      setExpandedDrawerTicketId(ticketId);
      setShowInlineRejectBox(false);
      setInlineNotes('');
      setInlineRejectReason('');
    }
  };

  const handleInlineApprove = async (ticket: Ticket) => {
    setInlineSubmitting(true);
    const res = await approveProgressReport(ticket.id, inlineNotes.trim() || undefined);
    setInlineSubmitting(false);
    if (!res.success) {
      toast.error(res.error || 'Gagal menyetujui laporan.');
      return;
    }
    setExpandedDrawerTicketId(null);
    setInlineNotes('');
  };

  const handleInlineReject = async (ticket: Ticket) => {
    if (!inlineRejectReason.trim()) {
      toast.error('Alasan revisi laporan wajib diisi.');
      return;
    }
    setInlineSubmitting(true);
    const res = await rejectProgressReport(ticket.id, inlineRejectReason.trim());
    setInlineSubmitting(false);
    if (!res.success) {
      toast.error(res.error || 'Gagal mengirim permintaan revisi.');
      return;
    }
    toast.success(`WO ${ticket.woNumber} dikembalikan untuk revisi teknisi.`);
    setExpandedDrawerTicketId(null);
    setShowInlineRejectBox(false);
    setInlineRejectReason('');
  };

  const handleExportCSV = () => {
    const headers = activeColumns.map(c => `"${c.label}"`).join(',');
    const rows = sortedTickets.map(t => {
      return activeColumns
        .map(col => {
          const val = getTicketColumnValue(t, col.key) ?? '';
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(',');
    });
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Tickets_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const showHoverTooltips = config.ticketsTable.showHoverTooltips !== false;

  const cellFontSizeClass =
    config.ticketsTable.cellFontSize === 'small'
      ? 'text-[12px]'
      : config.ticketsTable.cellFontSize === 'large'
      ? 'text-[14px]'
      : 'text-[13px]';

  const densityClass = `${
    config.ticketsTable.density === 'compact'
      ? 'py-2 px-3'
      : config.ticketsTable.density === 'spacious'
      ? 'py-3.5 px-4'
      : 'py-2.5 px-3.5'
  } ${cellFontSizeClass}`;

  const approvedPct = approvalCounts.totalToday > 0 ? ((approvalCounts.approved / approvalCounts.totalToday) * 100).toFixed(1) : '0.0';
  const fieldPct = approvalCounts.totalToday > 0 ? ((approvalCounts.diLapangan / approvalCounts.totalToday) * 100).toFixed(1) : '0.0';
  const canApproveInline = currentUser.role === 'dispatch' || currentUser.role === 'super_admin';

  const hasActiveFilters =
    selectedArea !== 'ALL' ||
    selectedCategory !== 'ALL' ||
    selectedInstallerStatus !== 'ALL' ||
    selectedApprovalStatus !== 'ALL' ||
    selectedAgentStatus !== 'ALL' ||
    selectedWhatsAppStatus !== 'ALL' ||
    Boolean(searchTerm.trim());

  const resetAllFilters = () => {
    setSearchTerm('');
    setSelectedArea('ALL');
    setSelectedCategory('ALL');
    setSelectedInstallerStatus('ALL');
    setSelectedApprovalStatus('ALL');
    setSelectedAgentStatus('ALL');
    setSelectedWhatsAppStatus('ALL');
    setCurrentPage(1);
  };

  // Numeric pagination sequence helper
  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | 'ellipsis')[] = [1];
    if (currentPage > 3) pages.push('ellipsis');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }, [currentPage, totalPages]);

  return (
    <div className="space-y-4">
      {/* 1. 6-Card KPI & Operational Pulse Strip */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* Card 1: Total Hari Ini */}
        <button
          type="button"
          onClick={() => {
            setSelectedApprovalStatus('ALL');
            setCurrentPage(1);
          }}
          className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer bg-white dark:bg-[#1E1238] shadow-2xs ${
            selectedApprovalStatus === 'ALL'
              ? 'border-[#D8CCF3] dark:border-[#7135B5] ring-1 ring-[#7135B5]/20'
              : 'border-[#E9E5F0] dark:border-[#35105E] hover:border-[#D8CCF3]'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA]">
              Total Hari Ini
            </span>
            <span className="p-1.5 rounded-lg bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE]">
              <TicketIcon className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold tabular-nums text-[#211A2E] dark:text-white">
              {approvalCounts.totalToday}
            </span>
            <span className="text-[11px] font-semibold text-[#16A36A] tabular-nums">
              {filteredTickets.length} tampil
            </span>
          </div>
          <div className="mt-1 text-[10.5px] font-mono text-[#8B8495] dark:text-[#CEC0E8]/70 truncate">
            todayWIB: {todayWIB}
          </div>
        </button>

        {/* Card 2: Highlighted Butuh Approval */}
        <button
          type="button"
          onClick={() => {
            setSelectedApprovalStatus(prev => (prev === 'BUTUH APPROVAL' ? 'ALL' : 'BUTUH APPROVAL'));
            setCurrentPage(1);
          }}
          className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer shadow-2xs ${
            selectedApprovalStatus === 'BUTUH APPROVAL'
              ? 'bg-[#F0E3FF] dark:bg-[#35105E] border-[#7135B5] ring-2 ring-[#7135B5]/30'
              : 'bg-[#F5F1FF] dark:bg-[#251247] border-[#D8CCF3] dark:border-[#5B35B1] hover:bg-[#F0E3FF]'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#431599] dark:text-[#D8B4FE]">
              <span className="w-2 h-2 rounded-full bg-[#E59A27] shrink-0" />
              <span>Butuh Approval</span>
            </span>
            <span className="p-1.5 rounded-lg bg-white/80 dark:bg-[#160D29] text-[#E59A27]">
              <Clock className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-display text-2xl font-bold tabular-nums text-[#431599] dark:text-white">
              {approvalCounts.butuhApproval}
            </span>
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap ${
                approvalCounts.butuhApproval > 0
                  ? 'bg-[#E59A27] text-white'
                  : 'bg-[#ECFDF5] text-[#16A36A]'
              }`}
            >
              {approvalCounts.butuhApproval > 0 ? 'Action Required' : 'Clear'}
            </span>
          </div>
          <div className="mt-1 text-[10.5px] font-medium text-[#7135B5] dark:text-[#D8B4FE] truncate">
            Antrian Verifikasi Dispatch
          </div>
        </button>

        {/* Card 3: Disetujui */}
        <button
          type="button"
          onClick={() => {
            setSelectedApprovalStatus(prev => (prev === 'APPROVED' ? 'ALL' : 'APPROVED'));
            setCurrentPage(1);
          }}
          className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer bg-white dark:bg-[#1E1238] shadow-2xs ${
            selectedApprovalStatus === 'APPROVED'
              ? 'border-[#16A36A] ring-2 ring-[#16A36A]/20'
              : 'border-[#E9E5F0] dark:border-[#35105E] hover:border-[#A7F3D0]'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA]">
              Disetujui
            </span>
            <span className="p-1.5 rounded-lg bg-[#ECFDF5] dark:bg-emerald-950/60 text-[#16A36A]">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold tabular-nums text-[#16A36A]">
              {approvalCounts.approved}
            </span>
            <span className="text-[11px] font-mono font-semibold text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
              {approvedPct}%
            </span>
          </div>
          <div className="mt-1 text-[10.5px] text-[#8B8495] dark:text-[#CEC0E8]/70 truncate">
            Siap Berita Acara
          </div>
        </button>

        {/* Card 4: Perlu Revisi */}
        <button
          type="button"
          onClick={() => {
            setSelectedApprovalStatus(prev => (prev === 'REJECTED' ? 'ALL' : 'REJECTED'));
            setCurrentPage(1);
          }}
          className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer bg-white dark:bg-[#1E1238] shadow-2xs ${
            selectedApprovalStatus === 'REJECTED'
              ? 'border-[#DC4C5A] ring-2 ring-[#DC4C5A]/20'
              : 'border-[#E9E5F0] dark:border-[#35105E] hover:border-[#FECACA]'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA]">
              Perlu Revisi
            </span>
            <span className="p-1.5 rounded-lg bg-[#FEF2F2] dark:bg-rose-950/60 text-[#DC4C5A]">
              <AlertTriangle className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold tabular-nums text-[#DC4C5A]">
              {approvalCounts.rejected}
            </span>
            <span className="text-[10.5px] font-semibold text-[#DC4C5A] truncate">
              Revisi Teknisi
            </span>
          </div>
          <div className="mt-1 text-[10.5px] text-[#8B8495] dark:text-[#CEC0E8]/70 truncate">
            Dropcore / Foto / OPM
          </div>
        </button>

        {/* Card 5: Di Lapangan */}
        <div className="rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#1E1238] p-3.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA]">
              Di Lapangan
            </span>
            <span className="p-1.5 rounded-lg bg-[#EFF6FF] dark:bg-blue-950/60 text-[#3977C9]">
              <Wrench className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold tabular-nums text-[#3977C9] dark:text-sky-400">
              {approvalCounts.diLapangan}
            </span>
            <span className="text-[11px] font-mono font-semibold text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
              {fieldPct}%
            </span>
          </div>
          <div className="mt-1 text-[10.5px] text-[#8B8495] dark:text-[#CEC0E8]/70 truncate">
            On-site &amp; En-route
          </div>
        </div>

        {/* Card 6: Fast Lane CTA */}
        <div className="rounded-xl bg-gradient-to-br from-[#35105E] via-[#431599] to-[#7135B5] text-white p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#E9D5FF]">
              Fast Lane
            </span>
            <Zap className="w-3.5 h-3.5 text-[#D8B4FE]" />
          </div>
          {currentUser.role === 'dispatch' ? (
            <button
              type="button"
              onClick={() => onNavigate('form_sameday')}
              className="mt-2 w-full py-1.5 px-2.5 rounded-lg bg-white text-[#431599] hover:bg-[#F5F1FF] text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              + Form Sameday
            </button>
          ) : ['super_admin', 'management_data'].includes(currentUser.role) ? (
            <button
              type="button"
              onClick={() => onNavigate('import')}
              className="mt-2 w-full py-1.5 px-2.5 rounded-lg bg-white text-[#431599] hover:bg-[#F5F1FF] text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              + Import Data WO
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('contact_centre')}
              className="mt-2 w-full py-1.5 px-2.5 rounded-lg bg-white text-[#431599] hover:bg-[#F5F1FF] text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              Contact Centre
            </button>
          )}
          <div className="mt-1.5 text-[10.5px] text-[#E9D5FF]/90 truncate">
            {currentUser.role === 'dispatch'
              ? 'Prioritas Khusus Sameday'
              : ['super_admin', 'management_data'].includes(currentUser.role)
              ? 'Input Batch WO Baru'
              : 'Koordinasi Lapangan'}
          </div>
        </div>
      </section>

      {/* 2. Search, Filters & Action Utilities Toolbar */}
      <section className="bg-white dark:bg-[#1E1238] p-4 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] shadow-2xs space-y-3.5">
        {/* Row A: Search Input + Appointment Date Chip + Sync Button */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-[#8B8495] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={
                isCrossDateSearchEligible
                  ? 'Cari Nomor WO (e.g. WO2026...) atau ID Customer (Lintas Tanggal)...'
                  : 'Cari WO Hari Ini (Nomor WO, ID Customer, Nama, Teknisi)...'
              }
              value={searchTerm}
              onChange={e => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-24 py-2 text-xs bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-[#211A2E] dark:text-[#F5F1FF] placeholder:text-[#8B8495] focus:outline-none focus:ring-2 focus:ring-[#7135B5]/30 focus:border-[#7135B5] font-medium transition-all"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setCurrentPage(1);
                  }}
                  className="px-1.5 py-0.5 rounded bg-[#E9E5F0] dark:bg-[#35105E] text-[10px] font-mono font-bold text-[#494453] dark:text-[#E9D5FF] hover:bg-[#D8CCF3] cursor-pointer"
                >
                  ESC clear
                </button>
              ) : (
                <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] text-[10px] font-mono font-semibold text-[#8B8495]">
                  Ctrl+K
                </kbd>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F5F1FF] dark:bg-[#35105E]/70 border border-[#D8CCF3] dark:border-[#5B35B1] text-xs">
              <Calendar className="w-3.5 h-3.5 text-[#431599] dark:text-[#D8B4FE] shrink-0" />
              <span className="font-semibold text-[#431599] dark:text-[#E9D5FF] whitespace-nowrap">
                {isCrossDateActive
                  ? `Lintas Tanggal (${filteredTickets.length} WO)`
                  : `Appointment: ${formatIndonesianWODate(todayWIB)}`}
              </span>
            </div>

            <button
              type="button"
              onClick={async () => {
                await triggerRefresh(
                  () => refreshActiveTickets(),
                  'MEMPERBARUI WORK ORDER...',
                  'Menyelaraskan data tabel tiket dan jadwal appointment'
                );
                toast.sync('Tabel Work Order berhasil diperbarui.');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#16A36A] bg-[#ECFDF5] dark:bg-emerald-950/50 border border-[#A7F3D0] dark:border-emerald-800 hover:bg-[#D1FAE5] transition-colors cursor-pointer whitespace-nowrap"
              title="Refresh tabel tiket & sinkronkan data"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>Sync Data</span>
            </button>
          </div>
        </div>

        {/* Cross-Date Search Banner */}
        {isCrossDateActive && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-[#F4EAFF] dark:bg-[#2A174E] border border-[#D8CCF3] dark:border-[#5B35B1] text-[#431599] dark:text-[#E9D5FF] text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#7135B5] dark:text-[#D8B4FE] shrink-0" />
              <span>
                <strong>Mode Pencarian Lintas Tanggal Aktif:</strong> Ditemukan <strong>{filteredTickets.length}</strong> WO untuk kueri &ldquo;{searchTerm}&rdquo;.
                {crossDateSearchResults.crossDateCount > 0 && (
                  <span className="ml-1 opacity-85">
                    ({crossDateSearchResults.crossDateCount} WO di luar tanggal hari ini)
                  </span>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setCurrentPage(1);
              }}
              className="px-2.5 py-1 bg-white dark:bg-[#160D29] hover:bg-[#F7F6FA] text-[#431599] dark:text-[#E9D5FF] border border-[#D8CCF3] dark:border-[#5B35B1] rounded-lg text-xs font-bold flex items-center gap-1 transition-colors self-start sm:self-auto cursor-pointer whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset ke Hari Ini</span>
            </button>
          </div>
        )}

        {/* Row B: 6-Column Filter Matrix */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
          <div>
            <label className="block text-[10.5px] font-semibold text-[#766B83] dark:text-[#A78BFA] mb-1">
              Area Servis
            </label>
            <select
              value={selectedArea}
              onChange={e => {
                setSelectedArea(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-[#211A2E] dark:text-[#F5F1FF] font-medium focus:outline-none focus:border-[#7135B5]"
            >
              <option value="ALL">Semua Area ({areas.length})</option>
              {areas.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold text-[#766B83] dark:text-[#A78BFA] mb-1">
              Kategori Tiket
            </label>
            <select
              value={selectedCategory}
              onChange={e => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-[#211A2E] dark:text-[#F5F1FF] font-medium focus:outline-none focus:border-[#7135B5]"
            >
              <option value="ALL">Semua Kategori ({ticketCategories.length})</option>
              {ticketCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold text-[#766B83] dark:text-[#A78BFA] mb-1">
              Status Installer
            </label>
            <select
              value={selectedInstallerStatus}
              onChange={e => {
                setSelectedInstallerStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-[#211A2E] dark:text-[#F5F1FF] font-medium focus:outline-none focus:border-[#7135B5]"
            >
              <option value="ALL">statusWOInstaller (All)</option>
              <option value="Unassigned">Unassigned</option>
              <option value="Assigned">Assigned</option>
              <option value="En Route">En Route</option>
              <option value="On Site">On Site</option>
              <option value="Installed">Installed</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold text-[#766B83] dark:text-[#A78BFA] mb-1">
              Status WO Agent
            </label>
            <select
              value={selectedAgentStatus}
              onChange={e => {
                setSelectedAgentStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-[#211A2E] dark:text-[#F5F1FF] font-medium focus:outline-none focus:border-[#7135B5]"
            >
              <option value="ALL">statusWOAgent (All)</option>
              <option value="Pending">Pending</option>
              <option value="Assigned">Assigned</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold text-[#766B83] dark:text-[#A78BFA] mb-1">
              WhatsApp Handshake
            </label>
            <select
              value={selectedWhatsAppStatus}
              onChange={e => {
                setSelectedWhatsAppStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-[#211A2E] dark:text-[#F5F1FF] font-medium focus:outline-none focus:border-[#7135B5]"
            >
              <option value="ALL">statusWhatsApp (All)</option>
              <option value="not_prepared">Not Prepared</option>
              <option value="ready">Ready to Contact</option>
              <option value="opened_in_whatsapp">Opened in WA</option>
              <option value="awaiting_confirmation">Awaiting Confirmation</option>
              <option value="confirmed">Customer Confirmed</option>
              <option value="reschedule_requested">Reschedule Needed</option>
              <option value="unreachable">Unreachable</option>
              <option value="invalid_number">Invalid Phone</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold text-[#431599] dark:text-[#D8B4FE] mb-1">
              Approval Dispatch
            </label>
            <select
              value={selectedApprovalStatus}
              onChange={e => {
                setSelectedApprovalStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-[#F5F1FF] dark:bg-[#35105E]/50 border border-[#D8CCF3] dark:border-[#5B35B1] rounded-lg text-[#431599] dark:text-[#F5F1FF] font-semibold focus:outline-none focus:border-[#7135B5]"
            >
              <option value="ALL">approvalStatus (All)</option>
              <option value="BUTUH APPROVAL">Butuh Approval ({approvalCounts.butuhApproval})</option>
              <option value="APPROVED">Approved ({approvalCounts.approved})</option>
              <option value="REJECTED">Perlu Revisi ({approvalCounts.rejected})</option>
              <option value="CLOSED">Closed ({approvalCounts.closed})</option>
            </select>
          </div>
        </div>

        {/* Row C: Action Utilities Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29]/70 border border-[#E9E5F0] dark:border-[#35105E] text-xs">
          {/* Left Selection & Contextual Bulk Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleSelectAll}
              className="inline-flex items-center gap-2 px-2 py-1 rounded-md font-bold text-[#494453] dark:text-[#CEC0E8] hover:text-[#431599] dark:hover:text-white cursor-pointer whitespace-nowrap"
            >
              {selectedIds.size === paginatedTickets.length && paginatedTickets.length > 0 ? (
                <CheckSquare className="w-4 h-4 text-[#431599] dark:text-[#A78BFA]" />
              ) : (
                <Square className="w-4 h-4 text-[#8B8495]" />
              )}
              <span className="text-[11px] uppercase tracking-wider">Pilih Semua</span>
            </button>

            <div className="hidden sm:flex items-center gap-1.5 pl-2 border-l border-[#E9E5F0] dark:border-[#35105E]">
              <span className="text-[11px] text-[#766B83] dark:text-[#A78BFA] font-semibold">Preset:</span>
              <select
                value={config.ticketsTable.activePresetId || ''}
                onChange={e => applyPreset(e.target.value)}
                className="px-2 py-1 text-xs bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] rounded-md text-[#211A2E] dark:text-[#F5F1FF] font-medium cursor-pointer"
              >
                {config.ticketsTable.presets.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap pl-2 border-l border-[#E9E5F0] dark:border-[#35105E]">
                <span className="px-2 py-0.5 rounded-md bg-[#F0E3FF] dark:bg-[#35105E] text-[#431599] dark:text-[#E9D5FF] font-bold tabular-nums">
                  {selectedIds.size} dipilih
                </span>

                {currentUser.role === 'leader' ? (
                  <>
                    <select
                      value={bulkInstaller}
                      onChange={e => setBulkInstaller(e.target.value)}
                      className="px-2 py-1 text-xs bg-white dark:bg-[#1E1238] border border-[#D8CCF3] dark:border-[#5B35B1] rounded-md text-[#211A2E] dark:text-white"
                    >
                      <option value="">Pilih Teknisi...</option>
                      {installersList.map(inst => (
                        <option key={inst} value={inst}>{inst}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleApplyBulkAssign}
                      className="px-3 py-1 font-semibold text-white bg-[#431599] hover:bg-[#5B35B1] rounded-md cursor-pointer transition-colors whitespace-nowrap"
                    >
                      Assign Teknisi
                    </button>
                  </>
                ) : currentUser.role !== 'super_admin' && currentUser.role !== 'management_data' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#92400E] bg-[#FEF3C7] px-2 py-0.5 rounded-md">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>Assignment khusus Leader</span>
                  </span>
                ) : null}

                {currentUser.role === 'management_data' && (
                  <button
                    type="button"
                    onClick={() => setShowBulkDeleteModal(true)}
                    className="px-2.5 py-1 font-semibold text-white bg-[#DC4C5A] hover:bg-rose-700 rounded-md cursor-pointer inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus ({selectedIds.size})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="px-2 py-1 text-[#766B83] hover:text-[#211A2E] dark:text-[#CEC0E8] hover:bg-[#E9E5F0] dark:hover:bg-[#35105E] rounded-md cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-[#DC4C5A] hover:bg-[#FEF2F2] dark:hover:bg-rose-950/40 cursor-pointer whitespace-nowrap"
              >
                <X className="w-3 h-3" />
                <span>Reset Filter</span>
              </button>
            )}
          </div>

          {/* Right View, Columns & Export Controls */}
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            {/* Table vs Cards Toggle */}
            <div className="flex items-center rounded-lg border border-[#E9E5F0] dark:border-[#35105E] p-0.5 bg-white dark:bg-[#1E1238]">
              <button
                type="button"
                onClick={() => setLayoutMode('table')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  effectiveLayout === 'table'
                    ? 'bg-[#431599] text-white shadow-xs'
                    : 'text-[#766B83] dark:text-[#CEC0E8] hover:text-[#211A2E] dark:hover:text-white'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>Table</span>
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('cards')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  effectiveLayout === 'cards'
                    ? 'bg-[#431599] text-white shadow-xs'
                    : 'text-[#766B83] dark:text-[#CEC0E8] hover:text-[#211A2E] dark:hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Cards</span>
              </button>
            </div>

            {/* Archive Filter Toggle */}
            <button
              type="button"
              onClick={() => {
                setShowArchived(!showArchived);
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                showArchived
                  ? 'bg-[#FEF3C7] text-[#92400E] border-[#F59E0B]/50'
                  : 'bg-white dark:bg-[#1E1238] text-[#494453] dark:text-[#CEC0E8] border-[#E9E5F0] dark:border-[#35105E] hover:bg-[#F5F1FF]'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>{showArchived ? 'Archived' : 'Archive'}</span>
            </button>

            {/* Chat Unread Shortcut */}
            {['super_admin', 'dispatch', 'installer'].includes(currentUser.role) && (
              <button
                type="button"
                onClick={() => onNavigate('contact_centre')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border cursor-pointer whitespace-nowrap ${
                  totalUnreadAcrossTickets > 0
                    ? 'bg-[#FEF2F2] dark:bg-rose-950/40 text-[#DC4C5A] dark:text-rose-300 border-[#FECACA] dark:border-rose-900'
                    : 'bg-white dark:bg-[#1E1238] text-[#494453] dark:text-[#CEC0E8] border-[#E9E5F0] dark:border-[#35105E] hover:bg-[#F5F1FF]'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>Chat</span>
                {totalUnreadAcrossTickets > 0 && (
                  <span className="px-1.5 py-0.2 bg-[#DC4C5A] text-white text-[10px] rounded-full font-bold tabular-nums">
                    {totalUnreadAcrossTickets}
                  </span>
                )}
              </button>
            )}

            {/* Columns Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColManager(!showColManager)}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#431599] dark:text-[#E9D5FF] bg-white dark:bg-[#1E1238] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] rounded-lg border border-[#D8CCF3] dark:border-[#5B35B1] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                title={omittedEmptyCount > 0 ? `Smart Omit menyembunyikan ${omittedEmptyCount} kolom kosong pada halaman ini` : undefined}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="tabular-nums">
                  Columns ({activeColumns.length}
                  {omittedEmptyCount > 0 ? `/${rawVisibleColumns.length}` : ''})
                </span>
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>

              {showColManager && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColManager(false)} />
                  <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-[#1E1238] rounded-xl shadow-xl border border-[#E9E5F0] dark:border-[#35105E] p-3 z-50 text-xs">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E9E5F0] dark:border-[#35105E]">
                      <div>
                        <span className="font-bold text-[#211A2E] dark:text-white">Visibilitas 46 Kolom</span>
                        {omittedEmptyCount > 0 && (
                          <span className="block text-[10px] text-[#7135B5] dark:text-[#D8B4FE]">
                            Smart Omit: {omittedEmptyCount} kolom kosong disembunyikan otomatis
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowColManager(false)}
                        className="text-[#8B8495] hover:text-[#211A2E] dark:hover:text-white text-xs cursor-pointer"
                      >
                        Tutup
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                      {[...config.ticketsTable.columns]
                        .filter(col => col.key !== 'actions')
                        .sort((a, b) => a.order - b.order)
                        .map(col => (
                          <label
                            key={col.key}
                            className={`flex items-center justify-between gap-2 p-1.5 rounded-lg ${
                              col.mandatory
                                ? 'bg-[#F5F1FF]/70 dark:bg-[#251545]/70 cursor-not-allowed'
                                : 'hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]/60 cursor-pointer'
                            }`}
                          >
                            <div className="min-w-0 flex items-center gap-1.5">
                              {col.mandatory && (
                                <Lock className="w-3 h-3 text-[#7135B5] dark:text-[#D8B4FE] shrink-0" />
                              )}
                              <span className="text-[#211A2E] dark:text-[#F5F1FF] truncate">{col.label}</span>
                            </div>
                            <input
                              type="checkbox"
                              disabled={col.mandatory}
                              checked={col.mandatory ? true : col.visible}
                              onChange={e => !col.mandatory && setColumnVisibility(col.key, e.target.checked)}
                              className="rounded border-[#D8CCF3] text-[#431599] focus:ring-[#7135B5] disabled:opacity-60"
                            />
                          </label>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Export CSV */}
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 text-xs font-bold text-white bg-[#16A36A] hover:bg-[#15803D] rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Main Dynamic Table or Mobile Cards */}
      {effectiveLayout === 'cards' ? (
        <div className="space-y-3">
          {paginatedTickets.length === 0 ? (
            <div className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] py-12 text-center text-[#8B8495] text-xs">
              Tidak ada tiket Work Order yang cocok dengan filter pencarian.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginatedTickets.map(ticket => (
                <TicketMobileCard
                  key={ticket.id}
                  ticket={ticket}
                  isSelected={selectedIds.has(ticket.id)}
                  onToggleSelect={handleToggleSelect}
                  onSelectTicket={onSelectTicket}
                  onOpenWhatsApp={onOpenWhatsApp}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] overflow-hidden shadow-2xs">
          <div className="overflow-x-auto min-h-[280px]">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-[#F4EAFF] dark:bg-[#251545] border-b border-[#D8CCF3] dark:border-[#35105E] text-[11px] font-bold text-[#431599] dark:text-[#D8B4FE] uppercase tracking-wider">
                  <th
                    className={`py-3 px-3 w-11 min-w-[44px] max-w-[44px] text-center bg-[#F4EAFF] dark:bg-[#251545] border-r border-[#D8CCF3]/60 dark:border-[#35105E] ${
                      stickyColumnsEnabled ? 'sticky left-0 z-20' : ''
                    } ${
                      stickyColumnsEnabled && freezeColumnCount === 1
                        ? 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]'
                        : ''
                    }`}
                  >
                    <button type="button" onClick={handleSelectAll} className="text-[#431599] dark:text-[#D8B4FE] cursor-pointer">
                      {selectedIds.size === paginatedTickets.length && paginatedTickets.length > 0 ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4 opacity-60" />
                      )}
                    </button>
                  </th>

                  {activeColumns.map(col => {
                    const isSorted = sortField === col.key;
                    const stickyInfo = stickyLeftMap[col.key];
                    const widthPx = col.width || 130;

                    return (
                      <th
                        key={col.key}
                        style={{
                          width: `${widthPx}px`,
                          minWidth: `${widthPx}px`,
                          ...(stickyInfo ? { left: `${stickyInfo.left}px` } : {})
                        }}
                        className={`py-3 px-3.5 whitespace-nowrap ${
                          col.sortable ? 'cursor-pointer hover:bg-[#E9D5FF]/50 dark:hover:bg-[#35105E]' : ''
                        } ${
                          stickyInfo
                            ? `sticky bg-[#F4EAFF] dark:bg-[#251545] z-20 border-r border-[#D8CCF3]/60 dark:border-[#35105E] ${
                                stickyInfo.isLastFrozen ? 'shadow-[3px_0_6px_-2px_rgba(67,21,153,0.12)]' : ''
                              }`
                            : ''
                        }`}
                        onClick={() => col.sortable && handleSort(col.key)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{col.label}</span>
                          {col.sortable && (
                            isSorted && sortDirection === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5 shrink-0" />
                            ) : isSorted && sortDirection === 'desc' ? (
                              <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <ArrowUpDown className="w-3 h-3 opacity-50 shrink-0" />
                            )
                          )}
                        </div>
                      </th>
                    );
                  })}

                  {/* Always-pinned Right Actions Header */}
                  <th
                    className={`py-3 px-3.5 whitespace-nowrap text-center bg-[#F4EAFF] dark:bg-[#251545] ${
                      stickyColumnsEnabled
                        ? 'sticky right-0 z-20 border-l border-[#D8CCF3]/60 dark:border-[#35105E] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]'
                        : 'border-l border-[#D8CCF3]/60 dark:border-[#35105E]'
                    }`}
                  >
                    Aksi
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#E9E5F0] dark:divide-[#35105E]">
                {paginatedTickets.length === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length + 2} className="py-12 text-center text-[#8B8495] text-xs">
                      Tidak ada tiket Work Order yang cocok dengan filter.
                    </td>
                  </tr>
                ) : (
                  paginatedTickets.map(ticket => {
                    const isSelected = selectedIds.has(ticket.id);
                    const isExpanded = expandedDrawerTicketId === ticket.id;
                    const stickyCellBg = isExpanded
                      ? 'bg-[#F5F1FF] dark:bg-[#251247]'
                      : isSelected
                      ? 'bg-[#F5F1FF] dark:bg-[#2E1459]'
                      : 'bg-white dark:bg-[#1E1238] group-hover:bg-[#F7F6FA] dark:group-hover:bg-[#251545]';

                    const hasInlineEvidence =
                      ticket.approvalStatus === 'BUTUH APPROVAL' ||
                      Boolean(ticket.technicalReport) ||
                      Boolean(ticket.progressReports && ticket.progressReports.length > 0);

                    // Real photos deduplicated for drawer
                    const drawerPhotos = Array.from(
                      new Set(
                        [
                          ...(ticket.technicalReport?.photos || []),
                          ticket.technicalReport?.photoBeforeUrl,
                          ticket.technicalReport?.photoAfterUrl
                        ].filter((u): u is string => Boolean(u && typeof u === 'string' && u.trim()))
                      )
                    );

                    const latestReport = ticket.progressReports?.[0];
                    const unread = getTicketUnreadCount(ticket.id);

                    return (
                      <Fragment key={ticket.id}>
                        <tr
                          className={`group transition-colors ${
                            isExpanded
                              ? 'bg-[#F5F1FF]/70 dark:bg-[#251247]/70'
                              : isSelected
                              ? 'bg-[#F5F1FF]/50 dark:bg-[#2E1459]/40'
                              : 'hover:bg-[#F7F6FA] dark:hover:bg-[#251545]/60'
                          }`}
                        >
                          {/* Row Checkbox */}
                          <td
                            className={`py-2.5 px-3 w-11 min-w-[44px] max-w-[44px] text-center ${stickyCellBg} border-r border-[#E9E5F0] dark:border-[#35105E] transition-colors ${
                              stickyColumnsEnabled ? 'sticky left-0 z-10' : ''
                            } ${
                              stickyColumnsEnabled && freezeColumnCount === 1
                                ? 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]'
                                : ''
                            }`}
                          >
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                handleToggleSelect(ticket.id);
                              }}
                              className="text-[#8B8495] hover:text-[#431599] cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-[#431599] dark:text-[#A78BFA]" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </td>

                          {/* Render 46 Canonical Columns by Key */}
                          {activeColumns.map(col => {
                            const rawVal = getTicketColumnValue(ticket, col.key);
                            const stickyInfo = stickyLeftMap[col.key];
                            const widthPx = col.width || 130;
                            const stickyStyle = {
                              width: `${widthPx}px`,
                              minWidth: `${widthPx}px`,
                              ...(stickyInfo ? { left: `${stickyInfo.left}px` } : {})
                            };
                            const stickyClasses = stickyInfo
                              ? `sticky ${stickyCellBg} z-10 border-r border-[#E9E5F0] dark:border-[#35105E] ${
                                  stickyInfo.isLastFrozen ? 'shadow-[3px_0_6px_-2px_rgba(67,21,153,0.10)]' : ''
                                } transition-colors`
                              : '';

                            if (col.key === 'woNumber') {
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses}`}>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        onSelectTicket(ticket);
                                      }}
                                      className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE] hover:underline tabular-nums cursor-pointer text-left"
                                      title={showHoverTooltips ? ticket.woNumber : undefined}
                                    >
                                      {ticket.woNumber}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={e => handleCopyWoNumber(e, ticket)}
                                      className="p-1 rounded text-[#8B8495] hover:text-[#431599] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] cursor-pointer"
                                      title="Salin Nomor WO"
                                    >
                                      {copiedWoId === ticket.id ? (
                                        <Check className="w-3 h-3 text-[#16A36A]" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                </td>
                              );
                            }

                            if (col.key === 'idCustomer') {
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  title={showHoverTooltips ? String(ticket.idCustomer || '') : undefined}
                                  className={`${densityClass} ${stickyClasses} font-mono font-semibold text-[#211A2E] dark:text-white tabular-nums`}
                                >
                                  {ticket.idCustomer || '-'}
                                </td>
                              );
                            }

                            if (col.key === 'customerName') {
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  title={showHoverTooltips ? ticket.customerName : undefined}
                                  className={`${densityClass} ${stickyClasses} font-semibold text-[#211A2E] dark:text-white truncate max-w-[220px]`}
                                >
                                  {ticket.customerName || '-'}
                                </td>
                              );
                            }

                            if (col.key === 'customerPhone' || col.key === 'installerContact') {
                              const phoneStr = rawVal ? String(rawVal) : '';
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  title={showHoverTooltips && phoneStr ? phoneStr : undefined}
                                  className={`${densityClass} ${stickyClasses} font-mono text-[#494453] dark:text-[#CEC0E8] tabular-nums whitespace-nowrap`}
                                >
                                  {col.key === 'customerPhone' && phoneStr ? (
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        onOpenWhatsApp(ticket);
                                      }}
                                      className="inline-flex items-center gap-1.5 text-[#16A36A] hover:underline font-semibold cursor-pointer"
                                      title="Kirim pesan WhatsApp ke pelanggan"
                                    >
                                      <MessageSquare className="w-3 h-3 shrink-0" />
                                      <span>{phoneStr}</span>
                                    </button>
                                  ) : (
                                    phoneStr || '-'
                                  )}
                                </td>
                              );
                            }

                            if (col.key === 'statusWOAgent') {
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses}`}>
                                  <StatusAgentBadge status={ticket.statusWOAgent} />
                                </td>
                              );
                            }

                            if (col.key === 'statusWOInstaller') {
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses}`}>
                                  <StatusInstallerBadge status={ticket.statusWOInstaller} />
                                </td>
                              );
                            }

                            if (col.key === 'approvalStatus') {
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses}`}>
                                  <StatusApprovalBadge status={ticket.approvalStatus} />
                                </td>
                              );
                            }

                            if (col.key === 'statusWhatsApp') {
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses}`}>
                                  <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
                                </td>
                              );
                            }

                            if (col.key === 'appointmentDate') {
                              const formattedDate = formatDateTimeDisplay(rawVal, true);
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  title={showHoverTooltips && rawVal ? String(rawVal) : undefined}
                                  className={`${densityClass} ${stickyClasses} font-mono text-[#211A2E] dark:text-[#F5F1FF] whitespace-nowrap tabular-nums`}
                                >
                                  {formattedDate || '-'}
                                </td>
                              );
                            }

                            if (col.key === 'workStartedAt' || col.key === 'checkOutAt' || col.key === 'createdAt') {
                              const formattedTs = formatDateTimeDisplay(rawVal, false);
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  title={showHoverTooltips && rawVal ? String(rawVal) : undefined}
                                  className={`${densityClass} ${stickyClasses} font-mono text-[#494453] dark:text-[#CEC0E8] whitespace-nowrap tabular-nums`}
                                >
                                  {formattedTs || '-'}
                                </td>
                              );
                            }

                            if (col.key === 'workDurationMinutes') {
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  className={`${densityClass} ${stickyClasses} font-mono text-[#211A2E] dark:text-[#F5F1FF] whitespace-nowrap tabular-nums`}
                                >
                                  {rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
                                    ? `${rawVal} mnt`
                                    : '-'}
                                </td>
                              );
                            }

                            if (col.key === 'customerAddress' || col.key === 'streetName' || col.key === 'address') {
                              const addrStr = String(rawVal || '');
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  className={`${densityClass} ${stickyClasses} text-[#494453] dark:text-[#CEC0E8] max-w-xs`}
                                >
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      openCustomerAddressInGoogleMaps(ticket);
                                    }}
                                    className="group/map flex items-start gap-1.5 text-left hover:text-[#431599] dark:hover:text-[#D8B4FE] transition-colors cursor-pointer w-full"
                                    title={showHoverTooltips && addrStr ? addrStr : 'Klik untuk membuka lokasi pelanggan di Google Maps'}
                                  >
                                    <MapPin className="w-3.5 h-3.5 text-[#DC4C5A] shrink-0 mt-0.5 group-hover/map:scale-110 transition-transform" />
                                    <span className="truncate group-hover/map:underline">
                                      {addrStr || '-'}
                                    </span>
                                  </button>
                                </td>
                              );
                            }

                            if (col.key === 'rosetRedamanDbm' || col.key === 'fatRedamanDbm') {
                              const dbmNum = parseDbmNumeric(rawVal);
                              const isOutOfSpec = dbmNum !== null && (dbmNum < -24 || dbmNum > -8);
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses} whitespace-nowrap`}>
                                  {rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '' ? (
                                    <span
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-bold tabular-nums ${
                                        col.key === 'rosetRedamanDbm' && isOutOfSpec
                                          ? 'bg-[#FEF2F2] text-[#DC4C5A] border border-[#FECACA]'
                                          : 'bg-[#ECFDF5] text-[#16A36A] border border-[#A7F3D0]'
                                      }`}
                                    >
                                      {String(rawVal).toLowerCase().includes('dbm') ? String(rawVal) : `${rawVal} dBm`}
                                    </span>
                                  ) : (
                                    <span className="text-[#8B8495] italic font-normal">-</span>
                                  )}
                                </td>
                              );
                            }

                            if (col.key === 'dropcoreLength') {
                              const dcStr = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : '';
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  className={`${densityClass} ${stickyClasses} font-mono text-[#211A2E] dark:text-[#F5F1FF] whitespace-nowrap tabular-nums`}
                                >
                                  {dcStr ? (dcStr.toLowerCase().endsWith('m') ? dcStr : `${dcStr} m`) : '-'}
                                </td>
                              );
                            }

                            if (col.key === 'distanceKm') {
                              return (
                                <td
                                  key={col.key}
                                  style={stickyStyle}
                                  className={`${densityClass} ${stickyClasses} font-mono text-[#494453] dark:text-[#CEC0E8] whitespace-nowrap tabular-nums`}
                                >
                                  {rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
                                    ? `${rawVal} km`
                                    : '-'}
                                </td>
                              );
                            }

                            if (col.key === 'installerName') {
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses}`}>
                                  {ticket.installerName ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#5B35B1] whitespace-nowrap">
                                      {ticket.installerName}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#FEF3C7] dark:bg-amber-950/40 text-[#92400E] dark:text-amber-300 border border-[#F59E0B]/40 whitespace-nowrap">
                                      Belum Ditugaskan
                                    </span>
                                  )}
                                </td>
                              );
                            }

                            if (col.key === 'reassignHistoryCount') {
                              const count = Number(rawVal) || 0;
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses} whitespace-nowrap`}>
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[11px] font-bold tabular-nums ${
                                      count > 0
                                        ? 'bg-[#FEF3C7] text-[#92400E] border border-[#F59E0B]/40'
                                        : 'bg-[#F7F6FA] dark:bg-[#251545] text-[#766B83] dark:text-[#CEC0E8]'
                                    }`}
                                  >
                                    {count}x
                                  </span>
                                </td>
                              );
                            }

                            if (col.key === 'photoEvidenceCount') {
                              const count = Number(rawVal) || 0;
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses} whitespace-nowrap`}>
                                  {count > 0 ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] font-mono text-[11px] font-bold tabular-nums">
                                      <Camera className="w-3 h-3" />
                                      <span>{count}</span>
                                    </span>
                                  ) : (
                                    <span className="text-[#8B8495] italic font-normal">0</span>
                                  )}
                                </td>
                              );
                            }

                            if (col.key === 'dataQualityFlags') {
                              const flags: string[] = Array.isArray(rawVal)
                                ? rawVal
                                : typeof rawVal === 'string' && rawVal.trim()
                                ? rawVal.split(',').map(s => s.trim()).filter(Boolean)
                                : [];
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses}`}>
                                  {flags.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {flags.map(flag => (
                                        <span
                                          key={flag}
                                          className="px-1.5 py-0.5 rounded bg-[#FEF2F2] text-[#DC4C5A] border border-[#FECACA] font-mono text-[10px] font-bold"
                                        >
                                          {flag}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[#16A36A] text-[11px] font-semibold">Valid</span>
                                  )}
                                </td>
                              );
                            }

                            if (col.key === 'customerSignatureUrl') {
                              return (
                                <td key={col.key} style={stickyStyle} className={`${densityClass} ${stickyClasses} whitespace-nowrap`}>
                                  {rawVal ? (
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        onSelectTicket(ticket, 'report');
                                      }}
                                      className="inline-flex items-center gap-1 text-[#431599] dark:text-[#D8B4FE] hover:underline text-[11px] font-semibold cursor-pointer"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      <span>Lihat TTD</span>
                                    </button>
                                  ) : (
                                    <span className="text-[#8B8495] italic font-normal">-</span>
                                  )}
                                </td>
                              );
                            }

                            const displayValue =
                              rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
                                ? String(rawVal)
                                : '';

                            return (
                              <td
                                key={col.key}
                                style={stickyStyle}
                                title={showHoverTooltips && displayValue ? displayValue : undefined}
                                className={`${densityClass} ${stickyClasses} text-[#211A2E] dark:text-[#F5F1FF] ${
                                  col.format === 'code' ? 'font-mono tabular-nums' : ''
                                } ${
                                  col.wrapText ? 'break-words max-w-xs' : 'whitespace-nowrap truncate max-w-xs'
                                }`}
                              >
                                {displayValue || <span className="text-[#8B8495] italic font-normal">-</span>}
                              </td>
                            );
                          })}

                          {/* Unconditional Sticky-Right Actions Cell */}
                          <td
                            className={`${densityClass} text-center whitespace-nowrap ${stickyCellBg} border-l border-[#E9E5F0] dark:border-[#35105E] transition-colors ${
                              stickyColumnsEnabled
                                ? 'sticky right-0 z-10 shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]'
                                : ''
                            }`}
                          >
                            <div className="flex items-center justify-center gap-1">
                              {hasInlineEvidence && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    toggleInlineDrawer(ticket.id);
                                  }}
                                  className={`px-2 py-1 rounded-md text-[11px] font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                                    isExpanded
                                      ? 'bg-[#431599] text-white border-[#431599]'
                                      : 'bg-[#F5F1FF] dark:bg-[#35105E] text-[#431599] dark:text-[#E9D5FF] border-[#D8CCF3] dark:border-[#5B35B1] hover:bg-[#F0E3FF]'
                                  }`}
                                  title="Buka Drawer Verifikasi Teknis"
                                >
                                  {isExpanded ? 'Tutup' : 'Review'}
                                </button>
                              )}

                              {canApproveInline && ticket.approvalStatus === 'BUTUH APPROVAL' && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (!isExpanded) {
                                      toggleInlineDrawer(ticket.id);
                                    } else {
                                      handleInlineApprove(ticket);
                                    }
                                  }}
                                  className="px-2 py-1 rounded-md text-[11px] font-bold bg-[#16A36A] hover:bg-[#15803D] text-white transition-colors cursor-pointer whitespace-nowrap"
                                  title="Verifikasi & Approve Laporan"
                                >
                                  Approve
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  onSelectTicket(ticket);
                                }}
                                className="p-1.5 text-[#766B83] dark:text-[#CEC0E8] hover:text-[#431599] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] rounded-md cursor-pointer"
                                title="Buka Detail Lengkap WO"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {['super_admin', 'dispatch', 'installer'].includes(currentUser.role) && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    onSelectTicket(ticket, 'chat');
                                  }}
                                  className={`relative p-1.5 rounded-md transition-colors cursor-pointer ${
                                    unread > 0
                                      ? 'text-[#DC4C5A] bg-[#FEF2F2] dark:bg-rose-950/50'
                                      : 'text-[#431599] dark:text-[#A78BFA] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E]'
                                  }`}
                                  title={unread > 0 ? `${unread} Chat Belum Dibaca` : 'Buka Live Chat'}
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  {unread > 0 && (
                                    <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 bg-[#DC4C5A] text-white text-[9px] font-bold rounded-full flex items-center justify-center tabular-nums">
                                      {unread > 99 ? '99+' : unread}
                                    </span>
                                  )}
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  onOpenWhatsApp(ticket);
                                }}
                                className="p-1.5 text-[#16A36A] hover:bg-[#ECFDF5] dark:hover:bg-emerald-950/40 rounded-md cursor-pointer"
                                title="WhatsApp Confirmation"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  if (ticket.isArchived) restoreTicket(ticket.id);
                                  else archiveTicket(ticket.id);
                                }}
                                className="p-1.5 text-[#8B8495] hover:text-[#211A2E] dark:hover:text-white rounded-md cursor-pointer"
                                title={ticket.isArchived ? 'Restore' : 'Archive'}
                              >
                                {ticket.isArchived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                              </button>

                              {currentUser.role === 'management_data' && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setTicketToDelete(ticket);
                                  }}
                                  className="p-1.5 text-[#DC4C5A] hover:bg-[#FEF2F2] dark:hover:bg-rose-950/40 rounded-md cursor-pointer"
                                  title="Hapus Work Order (Management Data Only)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expandable Inline Verification Drawer */}
                        {isExpanded && (
                          <tr className="bg-[#F5F1FF]/70 dark:bg-[#251247]/80">
                            <td colSpan={activeColumns.length + 2} className="p-4 sm:p-5 border-y border-[#D8CCF3] dark:border-[#5B35B1]">
                              <div className="space-y-4">
                                {/* Drawer Header */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-[#FEF3C7] dark:bg-amber-950/60 border border-[#F59E0B]/40 flex items-center justify-center shrink-0">
                                      <ShieldCheck className="w-5 h-5 text-[#E59A27]" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="font-display text-sm font-bold text-[#211A2E] dark:text-white">
                                          Verifikasi Hasil Pekerjaan Teknisi
                                        </h4>
                                        <StatusApprovalBadge status={ticket.approvalStatus} />
                                      </div>
                                      <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] mt-0.5 font-mono tabular-nums">
                                        {ticket.woNumber} — Teknisi: {ticket.installerName || 'Belum Ditugaskan'} ({ticket.contactorName || ticket.contractorName || '-'})
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => onSelectTicket(ticket, 'report')}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#160D29] text-[#431599] dark:text-[#E9D5FF] border border-[#D8CCF3] dark:border-[#5B35B1] hover:bg-[#F4EAFF] cursor-pointer whitespace-nowrap"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      <span>Buka Detail Penuh</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => toggleInlineDrawer(ticket.id)}
                                      className="p-1.5 rounded-lg text-[#766B83] hover:text-[#211A2E] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E] cursor-pointer"
                                      title="Tutup Drawer"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>

                                {/* 3 Real Technical Telemetry Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div className="rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] p-3">
                                    <div className="text-[11px] font-semibold text-[#766B83] dark:text-[#A78BFA]">
                                      Redaman OPM (dBm)
                                    </div>
                                    <div className="mt-1 flex items-baseline gap-2">
                                      <span className="font-mono text-lg font-bold text-[#16A36A] tabular-nums">
                                        {ticket.technicalReport?.opticalPowerRx || ticket.technicalReport?.opticalPowerDbm || 'Belum diinput'}
                                      </span>
                                      {ticket.oltCode && (
                                        <span className="text-[10.5px] font-mono text-[#766B83] dark:text-[#CEC0E8]">
                                          OLT: {ticket.oltCode}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] p-3">
                                    <div className="text-[11px] font-semibold text-[#766B83] dark:text-[#A78BFA]">
                                      Nomor Seri ONT / Modem
                                    </div>
                                    <div className="mt-1 font-mono text-sm font-bold text-[#211A2E] dark:text-white tabular-nums truncate">
                                      {ticket.ontSerialNumber || ticket.technicalReport?.deviceSerialNumber || 'Belum diinput'}
                                    </div>
                                    <div className="mt-0.5 text-[10.5px] text-[#766B83] dark:text-[#CEC0E8] truncate">
                                      Material: {ticket.technicalReport?.usedMaterials || '-'}
                                    </div>
                                  </div>

                                  <div className="rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] p-3">
                                    <div className="text-[11px] font-semibold text-[#766B83] dark:text-[#A78BFA]">
                                      Dropcore &amp; FAT
                                    </div>
                                    <div className="mt-1 font-mono text-sm font-bold text-[#211A2E] dark:text-white tabular-nums">
                                      {ticket.dropcoreLength ? `${ticket.dropcoreLength}` : 'Belum diinput'}
                                    </div>
                                    <div className="mt-0.5 text-[10.5px] font-mono text-[#766B83] dark:text-[#CEC0E8] truncate">
                                      FAT: {ticket.fatCode || ticket.fat || '-'} | Port: {ticket.fatPort || '-'}
                                    </div>
                                  </div>
                                </div>

                                {/* Latest 3-Tier Progress Report + Evidence Photos */}
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                                  <div className="lg:col-span-5 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] p-3 space-y-2">
                                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#431599] dark:text-[#D8B4FE]">
                                      <FileText className="w-3.5 h-3.5" />
                                      <span>Ringkasan Laporan Teknisi</span>
                                    </div>
                                    {latestReport ? (
                                      <div className="space-y-1 text-xs">
                                        <div className="font-semibold text-[#211A2E] dark:text-white">
                                          {latestReport.reportStatusLabel || latestReport.reportStatus} &rarr;{' '}
                                          {latestReport.reasonReportLabel || latestReport.reasonReport}
                                        </div>
                                        <div className="text-[#766B83] dark:text-[#CEC0E8]">
                                          Rootcause: {latestReport.rootcauseLabel || latestReport.rootCause || '-'}
                                        </div>
                                        {latestReport.remarksReport && (
                                          <p className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] text-[#494453] dark:text-[#CEC0E8] text-[11.5px]">
                                            {latestReport.remarksReport}
                                          </p>
                                        )}
                                      </div>
                                    ) : ticket.technicalReport ? (
                                      <div className="space-y-1 text-xs">
                                        <div className="font-semibold text-[#211A2E] dark:text-white">
                                          {ticket.technicalReport.workResult} ({ticket.technicalReport.mainCategory})
                                        </div>
                                        <p className="text-[#494453] dark:text-[#CEC0E8]">
                                          {ticket.technicalReport.technicalDescription || '-'}
                                        </p>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-[#8B8495] italic">
                                        Belum ada laporan progress tersubmit dari teknisi.
                                      </div>
                                    )}
                                  </div>

                                  <div className="lg:col-span-7 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#431599] dark:text-[#D8B4FE]">
                                        <ImageIcon className="w-3.5 h-3.5" />
                                        <span>Bukti Dokumentasi Lapangan ({drawerPhotos.length})</span>
                                      </div>
                                    </div>
                                    {drawerPhotos.length > 0 ? (
                                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        {drawerPhotos.map((photoUrl, idx) => (
                                          <button
                                            key={photoUrl + idx}
                                            type="button"
                                            onClick={() => onSelectTicket(ticket, 'report')}
                                            className="group/img relative aspect-video rounded-lg overflow-hidden border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#160D29] cursor-pointer"
                                          >
                                            <img
                                              src={photoUrl}
                                              alt={`Dokumentasi ${idx + 1} - ${ticket.woNumber}`}
                                              referrerPolicy="no-referrer"
                                              className="w-full h-full object-cover group-hover/img:scale-105 transition-transform"
                                              onError={e => {
                                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                                              }}
                                            />
                                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/65 text-white text-[9.5px] font-mono">
                                              Foto #{idx + 1}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="py-4 text-center rounded-lg border border-dashed border-[#D8CCF3] dark:border-[#35105E] text-xs text-[#8B8495]">
                                        Belum ada foto bukti dokumentasi yang diunggah pada Technical Report.
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Inline Dispatch Approval / Rejection Controls (STRICTLY dispatch / super_admin when BUTUH APPROVAL) */}
                                {canApproveInline && ticket.approvalStatus === 'BUTUH APPROVAL' && (
                                  <div className="rounded-xl bg-white dark:bg-[#1E1238] border border-[#D8CCF3] dark:border-[#5B35B1] p-3 space-y-2.5">
                                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                                      <input
                                        type="text"
                                        value={inlineNotes}
                                        onChange={e => setInlineNotes(e.target.value)}
                                        placeholder="Tambahkan catatan dispatch internal untuk approval / berita acara..."
                                        className="flex-1 px-3 py-2 text-xs rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] text-[#211A2E] dark:text-white focus:outline-none focus:border-[#7135B5]"
                                      />
                                      <div className="flex items-center gap-2 shrink-0">
                                        <button
                                          type="button"
                                          disabled={inlineSubmitting}
                                          onClick={() => handleInlineApprove(ticket)}
                                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#16A36A] hover:bg-[#15803D] disabled:opacity-50 text-white shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          <span>{inlineSubmitting ? 'Memproses...' : 'Approve & Close WO'}</span>
                                        </button>
                                        <button
                                          type="button"
                                          disabled={inlineSubmitting}
                                          onClick={() => setShowInlineRejectBox(v => !v)}
                                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#DC4C5A] border border-[#FECACA] transition-colors cursor-pointer whitespace-nowrap"
                                        >
                                          <AlertTriangle className="w-3.5 h-3.5" />
                                          <span>Minta Revisi</span>
                                        </button>
                                      </div>
                                    </div>

                                    {showInlineRejectBox && (
                                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E]">
                                        <input
                                          type="text"
                                          value={inlineRejectReason}
                                          onChange={e => setInlineRejectReason(e.target.value)}
                                          placeholder="Wajib isi alasan penolakan / item yang harus direvisi teknisi..."
                                          className="flex-1 px-3 py-2 text-xs rounded-lg bg-[#FEF2F2]/60 dark:bg-rose-950/30 border border-[#FECACA] dark:border-rose-800 text-[#211A2E] dark:text-white focus:outline-none"
                                        />
                                        <button
                                          type="button"
                                          disabled={inlineSubmitting}
                                          onClick={() => handleInlineReject(ticket)}
                                          className="px-3.5 py-2 rounded-lg text-xs font-bold bg-[#DC4C5A] hover:bg-rose-700 disabled:opacity-50 text-white cursor-pointer whitespace-nowrap"
                                        >
                                          Kirim Revisi
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Footer Pagination & WIB Timezone Info */}
      <div className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] overflow-hidden shadow-2xs">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 text-xs text-[#766B83] dark:text-[#CEC0E8]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span>Baris per halaman:</span>
              <select
                value={pageSize === 'ALL' ? 'ALL' : String(pageSize)}
                onChange={e => {
                  const val = e.target.value;
                  setPageSize(val === 'ALL' ? 'ALL' : Number(val));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 text-xs font-semibold bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-md text-[#211A2E] dark:text-white cursor-pointer"
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="ALL">Semua ({sortedTickets.length})</option>
              </select>
            </div>

            <div className="tabular-nums">
              Menampilkan{' '}
              <span className="font-bold text-[#211A2E] dark:text-white">
                {sortedTickets.length === 0 ? 0 : (currentPage - 1) * effectiveRowsPerPage + 1}–{Math.min(currentPage * effectiveRowsPerPage, sortedTickets.length)}
              </span>{' '}
              dari <span className="font-bold text-[#211A2E] dark:text-white">{sortedTickets.length}</span> Work Orders
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1 || pageSize === 'ALL'}
              className="p-1.5 rounded-lg border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#160D29] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              aria-label="Halaman pertama"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1 || pageSize === 'ALL'}
              className="p-1.5 rounded-lg border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#160D29] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {pageSize !== 'ALL' &&
              pageNumbers.map((item, idx) =>
                item === 'ellipsis' ? (
                  <span key={`e-${idx}`} className="px-2 text-[#8B8495]">
                    ...
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCurrentPage(item)}
                    className={`min-w-[28px] h-7 px-2 rounded-lg text-xs font-bold tabular-nums transition-colors cursor-pointer ${
                      currentPage === item
                        ? 'bg-[#160D29] dark:bg-[#7135B5] text-white'
                        : 'text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E]'
                    }`}
                  >
                    {item}
                  </button>
                )
              )}

            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages || totalPages === 0 || pageSize === 'ALL'}
              className="p-1.5 rounded-lg border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#160D29] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              aria-label="Halaman berikutnya"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages || totalPages === 0 || pageSize === 'ALL'}
              className="p-1.5 rounded-lg border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#160D29] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              aria-label="Halaman terakhir"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="px-4 py-2 bg-[#F7F6FA] dark:bg-[#160D29]/60 border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center gap-2 text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
          <span className="w-2 h-2 rounded-full bg-[#16A36A] shrink-0" />
          <span>
            Menampilkan data sesuai zona waktu <strong>Asia/Jakarta (WIB)</strong>. Sinkronisasi dua arah via Express API &amp; Supabase aktif.
          </span>
        </div>
      </div>

      {/* Management Data Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && currentUser.role === 'management_data' && (
        <ManagementDataDeleteModal
          isOpen={showBulkDeleteModal}
          onClose={() => setShowBulkDeleteModal(false)}
          ticket={null}
          selectedTickets={paginatedTickets.filter(t => selectedIds.has(t.id))}
          onSuccess={() => {
            setSelectedIds(new Set());
            setShowBulkDeleteModal(false);
          }}
        />
      )}

      {/* Management Data Single Ticket Delete Confirmation Modal */}
      {ticketToDelete && currentUser.role === 'management_data' && (
        <ManagementDataDeleteModal
          isOpen={Boolean(ticketToDelete)}
          onClose={() => setTicketToDelete(null)}
          ticket={ticketToDelete}
          onSuccess={() => {
            setTicketToDelete(null);
          }}
        />
      )}
    </div>
  );
};
