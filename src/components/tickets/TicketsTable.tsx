import React, { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { Ticket, DispatchApprovalWoAgentStatus } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { CANONICAL_COLUMN_GROUPS } from '../../constants/defaultConfig';
import {
  StatusAgentBadge,
  StatusInstallerBadge,
  StatusWhatsAppBadge,
  StatusApprovalBadge
} from '../common/Badge';
import {
  DISPATCH_APPROVAL_OPTIONS,
  getRecommendedDispatchWoAgentStatus,
  isTicketClosed,
  matchesKpiFilter,
  KPI_FILTER_LABELS
} from '../../services/woLifecycleService';
import { TicketMobileCard } from './TicketMobileCard';
import { WorkOrderFilterSheet } from './WorkOrderFilterSheet';
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
  Camera,
  UserX,
  UserCheck,
  Server,
  BadgeCheck,
  XCircle,
  Filter,
  Plus,
  Activity,
  CloudDownload,
  ArrowRight
} from 'lucide-react';
import { useAnimation } from '../../context/AnimationContext';
import { useToast } from '../../context/ToastContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { PaginationBar } from '../common/PaginationBar';
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

const formatTimeOnlyWIB = (val?: string | null): string => {
  if (!val) return '-';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return (
    d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta'
    }) + ' WIB'
  );
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

export const TicketsTable: React.FC<TicketsTableProps> = ({
  onSelectTicket,
  onOpenWhatsApp,
  onNavigate
}) => {
  const {
    tickets,
    currentUser,
    archiveTicket,
    restoreTicket,
    bulkAssignPersonnel,
    approveProgressReport,
    rejectProgressReport,
    updateTicket,
    installersList,
    contractorsList,
    getTicketUnreadCount,
    totalLiveChatUnreadCount,
    todayWIB,
    refreshActiveTickets,
    activeKpiDrilldown,
    setActiveKpiDrilldown,
    databaseStatus,
    syncStatus,
    auditLogs
  } = useApp();
  const { config, setColumnVisibility, applyPreset, isMobileView, canSwitchDisplayMode, setDisplayMode } = useUIConfig();
  const { isCompactUI } = useResponsiveViewport();
  const { triggerRefresh } = useAnimation();
  const { toast } = useToast();

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Table presentation mode: 'stitch' (rich 9-col grouped view) vs 'canonical' (46-col configurable view)
  const [tableStyleMode, setTableStyleMode] = useState<'stitch' | 'canonical'>('stitch');
  const [showFilterSheet, setShowFilterSheet] = useState(false);

  // Switch automatically to canonical mode when user picks a non-default preset
  useEffect(() => {
    if (config.ticketsTable.activePresetId && config.ticketsTable.activePresetId !== 'preset_default') {
      setTableStyleMode('canonical');
    }
  }, [config.ticketsTable.activePresetId]);

  // Synchronized strictly with global Display Mode (Desktop Mode = Table, Mobile Mode = Cards)
  const effectiveLayout: 'cards' | 'table' = isCompactUI ? 'cards' : 'table';

  const handleSelectLayoutMode = (nextLayout: 'table' | 'cards') => {
    if (canSwitchDisplayMode) {
      setDisplayMode(nextLayout === 'table' ? 'desktop' : 'mobile');
    }
  };

  // Search & 6-Column Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedArea, setSelectedArea] = useState('ALL');
  const [selectedContractor, setSelectedContractor] = useState('ALL');
  const [selectedAgentStatus, setSelectedAgentStatus] = useState('ALL');
  const [selectedInstallerStatus, setSelectedInstallerStatus] = useState('ALL');
  const [selectedWhatsAppStatus, setSelectedWhatsAppStatus] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedApprovalStatus, setSelectedApprovalStatus] = useState('ALL');
  const [showArchived, setShowArchived] = useState(false);

  // Inline Verification Drawer & Clipboard & Row Action Menu state
  const [expandedDrawerTicketId, setExpandedDrawerTicketId] = useState<string | null>(null);
  const [inlineNotes, setInlineNotes] = useState('');
  const [inlineRejectReason, setInlineRejectReason] = useState('');
  const [showInlineRejectBox, setShowInlineRejectBox] = useState(false);
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [inlineWoAgentStatus, setInlineWoAgentStatus] = useState<DispatchApprovalWoAgentStatus>('Done');
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [copiedWoId, setCopiedWoId] = useState<string | null>(null);

  // Bulk Approve confirmation state
  const [showBulkApproveConfirm, setShowBulkApproveConfirm] = useState(false);
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  // Pagination & Sorting state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | 'ALL'>(config.ticketsTable.rowsPerPage || 10);
  const [sortField, setSortField] = useState<string>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Multi-selection & modals state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkInstaller, setBulkInstaller] = useState('');
  const [ticketToDelete, setTicketToDelete] = useState<Ticket | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [showColManager, setShowColManager] = useState(false);

  useEffect(() => {
    setPageSize(config.ticketsTable.rowsPerPage || 10);
  }, [config.ticketsTable.rowsPerPage]);

  // Keyboard shortcuts: '/' focuses local table filter, ESC clears when focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (e.key === '/' && !isTyping) {
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

  // Role-scoped base tickets for todayWIB (accurate KPI strip counts)
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
      if (isTicketClosed(t)) closed++;
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
  const isCrossDateSearchEligible =
    currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  const crossDateSearchResults = useMemo(() => {
    if (isCrossDateSearchEligible && searchTerm.trim()) {
      return executeSuperadminDispatchSearch(searchTerm, tickets);
    }
    return { isSearchActive: false, results: [], resultTickets: [], crossDateCount: 0 };
  }, [isCrossDateSearchEligible, searchTerm, tickets]);

  const isCrossDateActive = crossDateSearchResults.isSearchActive;

  // Visible canonical data columns sorted by order (selection & actions are pinned separately)
  const rawVisibleColumns = useMemo(() => {
    return [...config.ticketsTable.columns]
      .filter(col => col.visible && col.key !== 'selection' && col.key !== 'actions')
      .sort((a, b) => a.order - b.order);
  }, [config.ticketsTable.columns]);

  // Unique areas (scoped for Leader and Installer) with counts for today
  const areaOptions = useMemo(() => {
    if ((currentUser.role === 'leader' || currentUser.role === 'installer') && currentUser.area) {
      const count = roleScopedTodayTickets.filter(t => t.area === currentUser.area).length;
      return [{ name: currentUser.area, count }];
    }
    const counts = new Map<string, number>();
    roleScopedTodayTickets.forEach(t => {
      if (t.area) counts.set(t.area, (counts.get(t.area) || 0) + 1);
    });
    tickets.forEach(t => {
      if (t.area && !counts.has(t.area)) counts.set(t.area, 0);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tickets, roleScopedTodayTickets, currentUser.role, currentUser.area]);

  // Unique contractors (scoped for Leader)
  const contractorOptions = useMemo(() => {
    if (currentUser.role === 'leader' && currentUser.contractor) {
      return [currentUser.contractor];
    }
    const set = new Set<string>(contractorsList || []);
    tickets.forEach(t => {
      const c = (t.contactorName || t.contractorName || '').trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [tickets, contractorsList, currentUser.role, currentUser.contractor]);

  // Unique Ticket Categories
  const ticketCategories = useMemo(() => {
    const set = new Set(tickets.map(t => t.ticketCategory).filter(Boolean));
    return Array.from(set).sort();
  }, [tickets]);

  const totalUnreadAcrossTickets = totalLiveChatUnreadCount;

  // Filtering based on strict Appointment Date === todayWIB rules uniformly across all roles
  const filteredTickets = useMemo(() => {
    const todayStr = todayWIB || getJakartaDateString(0);

    const matchesFilterDropdowns = (t: Ticket) => {
      if (selectedArea !== 'ALL' && t.area !== selectedArea) return false;
      if (selectedContractor !== 'ALL') {
        const tContr = (t.contactorName || t.contractorName || '').trim().toLowerCase();
        if (tContr !== selectedContractor.trim().toLowerCase()) return false;
      }
      if (selectedAgentStatus !== 'ALL' && t.statusWOAgent !== selectedAgentStatus) return false;
      if (selectedInstallerStatus !== 'ALL' && t.statusWOInstaller !== selectedInstallerStatus) {
        return false;
      }
      if (selectedWhatsAppStatus !== 'ALL' && t.statusWhatsApp !== selectedWhatsAppStatus) {
        return false;
      }
      if (selectedCategory !== 'ALL' && t.ticketCategory !== selectedCategory) return false;
      if (selectedApprovalStatus !== 'ALL') {
        if (selectedApprovalStatus === 'CLOSED') {
          if (!isTicketClosed(t)) return false;
        } else if (selectedApprovalStatus === 'REJECTED') {
          if (t.approvalStatus !== 'REJECTED' && t.approvalStatus !== 'REVISI') return false;
        } else if (t.approvalStatus !== selectedApprovalStatus) {
          return false;
        }
      }
      return true;
    };

    if (isCrossDateActive) {
      return crossDateSearchResults.resultTickets.filter(t => {
        if (!t || t.isDeleted) return false;
        if (showArchived ? !t.isArchived : t.isArchived) return false;
        return matchesFilterDropdowns(t);
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

      if (!matchesFilterDropdowns(t)) return false;

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

      if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const matchWo = (t.woNumber ? String(t.woNumber).toLowerCase() : '').includes(q);
        const matchCust = (t.customerName ? String(t.customerName).toLowerCase() : '').includes(q);
        const matchId = (t.idCustomer ? String(t.idCustomer).toLowerCase() : '').includes(q);
        const matchPhone = String(t.customerPhone || '').includes(q);
        const matchInstaller = (t.installerName ? String(t.installerName).toLowerCase() : '').includes(q);
        const matchCluster = (t.clusterName ? String(t.clusterName).toLowerCase() : '').includes(q);
        const matchCategory = (t.ticketCategory ? String(t.ticketCategory).toLowerCase() : '').includes(q);
        if (
          !matchWo &&
          !matchCust &&
          !matchId &&
          !matchPhone &&
          !matchInstaller &&
          !matchCluster &&
          !matchCategory
        ) {
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
    selectedContractor,
    selectedAgentStatus,
    selectedInstallerStatus,
    selectedWhatsAppStatus,
    selectedCategory,
    selectedApprovalStatus,
    activeKpiDrilldown,
    searchTerm
  ]);

  // Sorting
  const sortedTickets = useMemo(() => {
    if (!sortDirection) return filteredTickets;
    return sortDataArray(
      filteredTickets,
      { column: sortField, direction: sortDirection },
      (item, col) => {
        if (col === 'woNumber') return item.woNumber;
        if (col === 'idCustomer') return item.idCustomer;
        if (col === 'date' || col === 'appointmentDate') return item.appointmentDate || '';
        if (col === 'statusWOInstaller') return item.statusWOInstaller;
        if (col === 'statusWOAgent') return item.statusWOAgent;
        if (col === 'slotTime') return item.slotTime;
        return (item as any)[col];
      }
    );
  }, [filteredTickets, sortField, sortDirection]);

  const effectiveRowsPerPage = pageSize === 'ALL' ? sortedTickets.length || 10 : pageSize;

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
    let accLeft = 44;
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

  const totalPages =
    pageSize === 'ALL' ? 1 : Math.ceil(sortedTickets.length / effectiveRowsPerPage) || 1;

  const selectedButuhApprovalTickets = useMemo(() => {
    return sortedTickets.filter(
      t => selectedIds.has(t.id) && t.approvalStatus === 'BUTUH APPROVAL'
    );
  }, [sortedTickets, selectedIds]);

  const handleSort = (fieldKey: string) => {
    const nextDir = getNextSortDirection(sortField, sortDirection, fieldKey);
    setSortField(nextDir ? fieldKey : 'updatedAt');
    setSortDirection(nextDir);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === paginatedTickets.length && paginatedTickets.length > 0) {
      setSelectedIds(new Set());
      setShowBulkApproveConfirm(false);
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
    const res = bulkAssignPersonnel(Array.from(selectedIds), currentUser.name, bulkInstaller);
    if (res.success) {
      setSelectedIds(new Set());
      setBulkInstaller('');
    }
  };

  const handleTriggerBulkApprove = () => {
    if (!canApproveInline) {
      toast.error('Akses Ditolak: Hanya Dispatch atau Super Admin yang berwenang melakukan approval.');
      return;
    }
    if (selectedButuhApprovalTickets.length === 0) {
      // Auto-select all visible BUTUH APPROVAL rows on current page or filter
      const candidates = sortedTickets.filter(t => t.approvalStatus === 'BUTUH APPROVAL');
      if (candidates.length === 0) {
        toast.info('Tidak ada Work Order berstatus BUTUH APPROVAL pada filter saat ini.');
        return;
      }
      setSelectedIds(new Set(candidates.map(t => t.id)));
    }
    setShowBulkApproveConfirm(true);
  };

  const handleConfirmBulkApprove = async () => {
    if (!canApproveInline || isBulkApproving) return;
    const targets = selectedButuhApprovalTickets;
    if (targets.length === 0) {
      setShowBulkApproveConfirm(false);
      return;
    }
    setIsBulkApproving(true);
    let successCount = 0;
    let failCount = 0;
    for (const t of targets) {
      const outcome = getRecommendedDispatchWoAgentStatus(t);
      const res = await approveProgressReport(t.id, 'Bulk Approve via Dispatch Command', {
        woAgentStatus: outcome
      });
      if (res.success) successCount++;
      else failCount++;
    }
    setIsBulkApproving(false);
    setShowBulkApproveConfirm(false);
    setSelectedIds(new Set());
    if (successCount > 0) {
      toast.success(
        `${successCount} Work Order berhasil di-approve Dispatch dan status tiket otomatis Closed.${
          failCount > 0 ? ` (${failCount} gagal)` : ''
        }`,
        'Bulk Approval Selesai'
      );
    } else if (failCount > 0) {
      toast.error(`${failCount} Work Order gagal diproses approval.`);
    }
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

  const toggleInlineDrawer = (ticket: Ticket) => {
    if (expandedDrawerTicketId === ticket.id) {
      setExpandedDrawerTicketId(null);
      setShowInlineRejectBox(false);
      setInlineNotes('');
      setInlineRejectReason('');
    } else {
      setExpandedDrawerTicketId(ticket.id);
      setShowInlineRejectBox(false);
      setInlineNotes(ticket.approvalNotes || ticket.remarksAgent || '');
      setInlineWoAgentStatus(getRecommendedDispatchWoAgentStatus(ticket));
      setInlineRejectReason('');
    }
  };

  const handleInlineApprove = async (ticket: Ticket) => {
    setInlineSubmitting(true);
    const res = await approveProgressReport(ticket.id, inlineNotes.trim() || undefined, {
      woAgentStatus: inlineWoAgentStatus,
      remarksAgent: inlineNotes.trim() || undefined
    });
    setInlineSubmitting(false);
    if (!res.success) {
      toast.error(res.error || 'Gagal menyetujui laporan.');
      return;
    }
    setExpandedDrawerTicketId(null);
    setInlineNotes('');
  };

  const handleInlineReject = async (ticket: Ticket) => {
    if (!inlineRejectReason.trim() || inlineRejectReason.trim().length < 3) {
      toast.error('Alasan revisi laporan wajib diisi minimal 3 karakter.');
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

  const handleSaveInlineNote = (ticket: Ticket) => {
    if (!canApproveInline) {
      toast.error('Hanya Dispatch dan Super Admin yang berwenang menyimpan catatan internal dispatch.');
      return;
    }
    const cleanNote = inlineNotes.trim();
    setSavingNoteId(ticket.id);
    const res = updateTicket(
      ticket.id,
      { remarksAgent: cleanNote, approvalNotes: cleanNote },
      'Catatan internal dispatch dari inline drawer'
    );
    setSavingNoteId(null);
    if (!res.success) {
      toast.error(res.error || 'Gagal menyimpan catatan dispatch.');
      return;
    }
    toast.success(`Catatan internal WO ${ticket.woNumber} tersimpan.`);
  };

  const handleExportXLSX = () => {
    if (sortedTickets.length === 0) {
      toast.warning('Tidak ada data Work Order untuk diekspor.');
      return;
    }
    try {
      const exportColumns =
        tableStyleMode === 'stitch'
          ? config.ticketsTable.columns.filter(c => c.key !== 'selection' && c.key !== 'actions' && c.visible)
          : activeColumns;
      const colsToExport = exportColumns.length > 0 ? exportColumns : activeColumns;

      const rows = sortedTickets.map(t => {
        const record: Record<string, string | number> = {};
        colsToExport.forEach(col => {
          const val = getTicketColumnValue(t, col.key);
          record[col.label] =
            val !== undefined && val !== null && String(val).trim() !== '' ? String(val) : '-';
        });
        return record;
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Work Orders');
      const fileDate = todayWIB || getJakartaDateString(0);
      XLSX.writeFile(wb, `MoraJaws_WorkOrders_${fileDate}.xlsx`);
      toast.success(`Berhasil mengekspor ${rows.length} Work Orders ke XLSX.`);
    } catch (err: any) {
      toast.error('Gagal mengekspor XLSX: ' + (err?.message || err));
    }
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

  const approvedPct =
    approvalCounts.totalToday > 0
      ? ((approvalCounts.approved / approvalCounts.totalToday) * 100).toFixed(1)
      : '0.0';
  const fieldPct =
    approvalCounts.totalToday > 0
      ? ((approvalCounts.diLapangan / approvalCounts.totalToday) * 100).toFixed(1)
      : '0.0';
  const canApproveInline = currentUser.role === 'dispatch' || currentUser.role === 'super_admin';

  const hasActiveFilters =
    Boolean(activeKpiDrilldown) ||
    selectedArea !== 'ALL' ||
    selectedContractor !== 'ALL' ||
    selectedCategory !== 'ALL' ||
    selectedInstallerStatus !== 'ALL' ||
    selectedApprovalStatus !== 'ALL' ||
    selectedAgentStatus !== 'ALL' ||
    selectedWhatsAppStatus !== 'ALL' ||
    Boolean(searchTerm.trim());

  const resetAllFilters = () => {
    setActiveKpiDrilldown(null);
    setSearchTerm('');
    setSelectedArea('ALL');
    setSelectedContractor('ALL');
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

  const formattedAppointmentChip = formatIndonesianWODate(todayWIB || getJakartaDateString(0));
  const stitchColSpan = 9;
  const canonicalColSpan = activeColumns.length + 2;

  // Render Expanded Inline Verification Drawer (shared by Stitch & Canonical table modes)
  const renderExpandedDrawer = (ticket: Ticket, colSpan: number) => {
    const latestReport = ticket.progressReports?.[0];
    const drawerPhotos = Array.from(
      new Set(
        [
          ...(ticket.technicalReport?.photos || []),
          ticket.technicalReport?.photoBeforeUrl,
          ticket.technicalReport?.photoAfterUrl
        ].filter((u): u is string => Boolean(u && typeof u === 'string' && u.trim()))
      )
    );

    const rawOpDbm =
      ticket.rosetRedamanDbm ??
      ticket.technicalReport?.opticalPowerRx ??
      ticket.technicalReport?.opticalPowerDbm;
    const opDbmNum = parseDbmNumeric(rawOpDbm);
    const opInSpec = opDbmNum !== null && opDbmNum >= -24 && opDbmNum <= -8;

    const dropcoreVal = ticket.dropcoreLength ?? ticket.dropcoreLengthMeter;
    const ontSn = ticket.ontSerialNumber || ticket.technicalReport?.deviceSerialNumber;

    return (
      <tr className="bg-[#F5F1FF] dark:bg-[#251247]/80 border-b border-[#E9E5F0] dark:border-[#5B35B1]">
        <td colSpan={colSpan} className="p-3 sm:p-4 border-y border-[#D8CCF3] dark:border-[#5B35B1]">
          <div className="bg-white dark:bg-[#1E1238] rounded-xl p-4 shadow-md border border-[#D8CCF3] dark:border-[#5B35B1] space-y-3.5">
            {/* Drawer Header with 3D Tactile CTA Buttons */}
            <div className="flex flex-wrap items-center justify-between pb-3 gap-3 border-b border-[#E9E5F0] dark:border-[#35105E]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[#E59A27]/20 border border-[#E59A27]/40 text-[#E59A27] flex items-center justify-center shrink-0 shadow-2xs">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-display text-sm sm:text-base font-bold text-[#211A2E] dark:text-white">
                      Verifikasi Hasil Pekerjaan Teknisi
                    </h4>
                    <StatusApprovalBadge status={ticket.approvalStatus} />
                  </div>
                  <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] mt-0.5 truncate">
                    <span className="font-mono font-semibold text-[#431599] dark:text-[#D8B4FE]">
                      {ticket.woNumber}
                    </span>{' '}
                    — Teknisi: {ticket.installerName || 'Belum Ditugaskan'} (
                    {ticket.contactorName || ticket.contractorName || '-'})
                    {(ticket.checkOutAt || ticket.technicalReport?.submittedAt) &&
                      ` • Selesai Pukul ${formatTimeOnlyWIB(
                        ticket.checkOutAt || ticket.technicalReport?.submittedAt
                      )}`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {canApproveInline && ticket.approvalStatus === 'BUTUH APPROVAL' && (
                  <>
                    <select
                      aria-label="Final Status WO Agent"
                      value={inlineWoAgentStatus}
                      onChange={e => setInlineWoAgentStatus(e.target.value as DispatchApprovalWoAgentStatus)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#5B35B1] text-[11px] font-bold text-[#211A2E] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#7135B5]"
                    >
                      {DISPATCH_APPROVAL_OPTIONS.map(opt => (
                        <option key={opt.woAgentStatus} value={opt.woAgentStatus}>
                          {opt.dispatchApprovalLabel} (Ticket: Closed)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={inlineSubmitting}
                      onClick={() => setShowInlineRejectBox(v => !v)}
                      className="btn-3d-danger px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Tolak / Revisi</span>
                    </button>
                    <button
                      type="button"
                      disabled={inlineSubmitting}
                      onClick={() => handleInlineApprove(ticket)}
                      className="btn-3d-success px-3.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {inlineSubmitting ? 'Memproses...' : `Approve (${inlineWoAgentStatus})`}
                      </span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => onSelectTicket(ticket, 'report')}
                  className="btn-3d-ceramic inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-[#35105E] dark:text-[#E9D5FF] cursor-pointer whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
                  <span>Buka Detail Penuh</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleInlineDrawer(ticket)}
                  className="btn-3d-icon w-8 h-8 cursor-pointer"
                  title="Tutup Drawer"
                  aria-label="Tutup Drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Inline Reject Input Bar */}
            {showInlineRejectBox && canApproveInline && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-lg bg-[#FEF2F2] dark:bg-rose-950/30 border border-[#FECACA] dark:border-rose-800">
                <input
                  type="text"
                  value={inlineRejectReason}
                  onChange={e => setInlineRejectReason(e.target.value)}
                  placeholder="Wajib isi alasan penolakan / item yang harus direvisi teknisi (min. 3 karakter)..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#160D29] border border-[#FECACA] dark:border-rose-800 text-[#211A2E] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#DC4C5A]"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={inlineSubmitting}
                    onClick={() => handleInlineReject(ticket)}
                    className="btn-3d-danger px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    Kirim Revisi
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInlineRejectBox(false)}
                    className="btn-3d-ceramic px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}

            {/* 4-Card Telemetry & Optical Specifications Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg border border-[#E9E5F0] dark:border-[#35105E]">
                <span className="text-[11px] font-bold uppercase text-[#8B8495] block">
                  Redaman OPM (dBm)
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span
                    className={`font-display text-xl font-bold tabular-nums ${
                      opDbmNum === null
                        ? 'text-[#766B83] dark:text-[#CEC0E8]'
                        : opInSpec
                        ? 'text-[#16A36A]'
                        : 'text-[#DC4C5A]'
                    }`}
                  >
                    {rawOpDbm !== undefined && rawOpDbm !== null && String(rawOpDbm).trim() !== ''
                      ? String(rawOpDbm).toLowerCase().includes('dbm')
                        ? String(rawOpDbm)
                        : `${rawOpDbm} dBm`
                      : 'Belum diinput'}
                  </span>
                  {opDbmNum !== null && (
                    <span
                      className={`text-[10px] font-bold ${
                        opInSpec ? 'text-[#16A36A]' : 'text-[#DC4C5A]'
                      }`}
                    >
                      {opInSpec ? 'PASS (< -24 dBm)' : 'OUT OF SPEC'}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[#8B8495] mt-0.5 block">
                  Diukur pada port ONT {ticket.oltCode ? `• OLT ${ticket.oltCode}` : ''}
                </span>
              </div>

              <div className="p-3 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg border border-[#E9E5F0] dark:border-[#35105E]">
                <span className="text-[11px] font-bold uppercase text-[#8B8495] block">
                  Nomor Seri ONT / Modem
                </span>
                <span className="font-mono text-xs font-bold text-[#211A2E] dark:text-white block mt-1 truncate">
                  {ontSn || 'Belum diinput'}
                </span>
                <span className="text-[11px] text-[#16A36A] font-medium flex items-center gap-1 mt-1 truncate">
                  <Check className="w-3 h-3 shrink-0" />
                  <span>
                    {ticket.oltRegistrationStatus ||
                      (ticket.oltCode ? `OLT: ${ticket.oltCode}` : `Model: ${ticket.ontModel || '-'}`)}
                  </span>
                </span>
              </div>

              <div className="p-3 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg border border-[#E9E5F0] dark:border-[#35105E]">
                <span className="text-[11px] font-bold uppercase text-[#8B8495] block">
                  Panjang Dropcore Digunakan
                </span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="font-display text-lg font-bold text-[#211A2E] dark:text-white tabular-nums">
                    {dropcoreVal !== undefined && dropcoreVal !== null && String(dropcoreVal).trim() !== ''
                      ? String(dropcoreVal)
                      : '-'}
                  </span>
                  {dropcoreVal && (
                    <span className="text-xs text-[#766B83] dark:text-[#CEC0E8]">
                      {String(dropcoreVal).toLowerCase().includes('m') ? '' : 'Meter'}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[#8B8495] mt-0.5 block truncate font-mono">
                  FAT: {ticket.fatCode || ticket.fat || '-'} | Port: {ticket.fatPort || '-'}
                </span>
              </div>

              <div className="p-3 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg border border-[#E9E5F0] dark:border-[#35105E]">
                <span className="text-[11px] font-bold uppercase text-[#8B8495] block">
                  LiveChat Check-In Dispatch
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold shadow-2xs ${
                      ticket.checkInAt
                        ? 'bg-[#35105E] text-white'
                        : 'bg-[#E9E5F0] dark:bg-[#35105E]/50 text-[#766B83] dark:text-[#CEC0E8]'
                    }`}
                  >
                    {ticket.checkInAt ? 'PROGRESS' : 'BELUM CHECK-IN'}
                  </span>
                  <span className="font-mono text-xs font-bold text-[#211A2E] dark:text-white tabular-nums">
                    {ticket.checkInAt ? formatTimeOnlyWIB(ticket.checkInAt) : '-'}
                  </span>
                </div>
                <span className="text-[11px] text-[#8B8495] mt-0.5 block truncate">
                  {ticket.workDurationFormatted
                    ? `Durasi Kerja: ${ticket.workDurationFormatted}`
                    : ticket.workSessionStatus || 'Status Sesi Lapangan'}
                </span>
              </div>
            </div>

            {/* Bukti Dokumentasi Fisik & Ringkasan Laporan Teknisi */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1">
              <div className="lg:col-span-8 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#D8B4FE] flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-[#7135B5]" />
                    <span>Bukti Dokumentasi Fisik ({drawerPhotos.length} Foto)</span>
                  </span>
                </div>

                {drawerPhotos.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {drawerPhotos.map((photoUrl, idx) => (
                      <button
                        key={photoUrl + idx}
                        type="button"
                        onClick={() => onSelectTicket(ticket, 'report')}
                        className="rounded-lg overflow-hidden bg-[#F4EAFF] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#35105E] shadow-2xs text-left group cursor-pointer"
                      >
                        <div className="h-24 w-full bg-[#E9E5F0] dark:bg-[#22123F] relative flex items-center justify-center overflow-hidden">
                          <ImageIcon className="w-5 h-5 text-[#8B8495] opacity-50" />
                          <img
                            src={photoUrl}
                            alt={`Dokumentasi #${idx + 1} - ${ticket.woNumber}`}
                            referrerPolicy="no-referrer"
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
                            onError={e => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <div className="p-1.5 bg-white dark:bg-[#1E1238]">
                          <span className="text-[10.5px] font-bold text-[#211A2E] dark:text-white block truncate">
                            Foto Dokumentasi #{idx + 1}
                          </span>
                          <span className="font-mono text-[9.5px] text-[#16A36A] font-semibold block truncate">
                            Klik untuk perbesar
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-5 px-4 text-center rounded-lg border border-dashed border-[#D8CCF3] dark:border-[#35105E] bg-[#F7F6FA]/70 dark:bg-[#160D29]/50 text-xs text-[#8B8495]">
                    Belum ada foto bukti dokumentasi yang diunggah pada Technical Report.
                  </div>
                )}
              </div>

              <div className="lg:col-span-4 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#431599] dark:text-[#D8B4FE]">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Ringkasan Laporan 3-Tingkat</span>
                </div>
                {latestReport ? (
                  <div className="space-y-1 text-xs">
                    <div className="font-semibold text-[#211A2E] dark:text-white">
                      {latestReport.reportStatusLabel || latestReport.reportStatus} &rarr;{' '}
                      {latestReport.reasonReportLabel || latestReport.reasonReport}
                    </div>
                    <div className="text-[#766B83] dark:text-[#CEC0E8] text-[11px]">
                      Rootcause: {latestReport.rootcauseLabel || latestReport.rootCause || '-'}
                    </div>
                    {latestReport.remarksReport && (
                      <p className="p-2 rounded bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] text-[#494453] dark:text-[#CEC0E8] text-[11px]">
                        {latestReport.remarksReport}
                      </p>
                    )}
                  </div>
                ) : ticket.technicalReport ? (
                  <div className="space-y-1 text-xs">
                    <div className="font-semibold text-[#211A2E] dark:text-white">
                      {ticket.technicalReport.workResult} ({ticket.technicalReport.mainCategory})
                    </div>
                    <p className="text-[#494453] dark:text-[#CEC0E8] text-[11px]">
                      {ticket.technicalReport.technicalDescription || '-'}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[#8B8495] italic">
                    Belum ada laporan progress tersubmit dari teknisi.
                  </p>
                )}
              </div>
            </div>

            {/* Dispatch Operator Note Input with Tactile Save Button */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-2 border-t border-[#E9E5F0] dark:border-[#35105E]">
              <div className="flex items-center gap-2 flex-1">
                <MessageSquare className="w-4 h-4 text-[#8B8495] shrink-0" />
                <input
                  type="text"
                  value={inlineNotes}
                  onChange={e => setInlineNotes(e.target.value)}
                  disabled={!canApproveInline}
                  placeholder={
                    canApproveInline
                      ? 'Tambahkan catatan dispatch internal untuk mitra / arsip approval...'
                      : 'Catatan internal dispatch (hanya Dispatch / Super Admin yang dapat mengubah)'
                  }
                  className="flex-1 px-3 py-1.5 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg text-xs text-[#211A2E] dark:text-white placeholder:text-[#8B8495] border border-[#E9E5F0] dark:border-[#35105E] focus:outline-none focus:bg-white dark:focus:bg-[#22123F] focus:ring-1 focus:ring-[#A78BFA] disabled:opacity-70"
                />
              </div>
              {canApproveInline && (
                <button
                  type="button"
                  disabled={savingNoteId === ticket.id}
                  onClick={() => handleSaveInlineNote(ticket)}
                  className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-[#35105E] dark:text-[#E9D5FF] text-[11px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {savingNoteId === ticket.id ? 'Menyimpan...' : 'Simpan Catatan'}
                </button>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      {activeKpiDrilldown && (
        <div className="rounded-xl bg-[#160D29] text-white px-4 py-3 border border-[#3E246F] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-[#7135B5] text-white font-bold text-[10.5px]">
              Filter KPI Dashboard
            </span>
            <span className="font-bold">
              {KPI_FILTER_LABELS[activeKpiDrilldown.filterKey] || activeKpiDrilldown.filterKey}
            </span>
            {activeKpiDrilldown.contractor && activeKpiDrilldown.contractor !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-white/10 text-purple-200 font-medium">
                Vendor: {activeKpiDrilldown.contractor}
              </span>
            )}
            {activeKpiDrilldown.area && activeKpiDrilldown.area !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-white/10 text-purple-200 font-medium">
                Area: {activeKpiDrilldown.area}
              </span>
            )}
            <span className="font-mono font-bold text-[#E9D5FF] tabular-nums">
              ({filteredTickets.length} WO ditemukan)
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveKpiDrilldown(null);
              setCurrentPage(1);
            }}
            className="btn-3d-ceramic inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset Filter KPI</span>
          </button>
        </div>
      )}

      {/* 0. STITCH WORK ORDER DISPATCH & TRIAGE CONTROL HERO */}
      <section className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#3f186d] to-[#240c45] text-white flex items-center justify-center shrink-0 shadow-[0_3px_0_#120624]">
            <Sparkles className="w-5 h-5 text-[#DAB9FF]" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-lg sm:text-xl font-extrabold text-[#1F1638] dark:text-white tracking-tight">
                Work Order Dispatch &amp; Triage Control
              </h1>
              <span className="px-2 py-0.5 rounded bg-[#480123] text-white text-[10px] font-extrabold uppercase tracking-wider">
                {currentUser.role === 'super_admin'
                  ? 'SUPERADMIN ROOT'
                  : currentUser.role === 'dispatch'
                  ? 'DISPATCH OPS'
                  : currentUser.role.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8]">
              Fiber-To-The-Home (FTTH) Provisioning, Dispatch Verification &amp; Contractor Triage · WIB {todayWIB}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1459] border border-[#D8CCF3] dark:border-[#4B386B] text-[11px] font-bold text-[#58149C] dark:text-[#DAB9FF]">
            <span className="w-2 h-2 rounded-full bg-[#7135B5] animate-pulse shrink-0" />
            <span>
              SCOPE:{' '}
              {selectedArea !== 'ALL'
                ? `AREA ${selectedArea.toUpperCase()}`
                : selectedContractor !== 'ALL'
                ? selectedContractor.toUpperCase()
                : 'SEMUA AREA & VENDOR'}
            </span>
          </span>

          {['super_admin', 'management_data'].includes(currentUser.role) ? (
            <button
              type="button"
              onClick={() => onNavigate('import')}
              className="btn-3d-darkpurple px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <CloudDownload className="w-4 h-4 text-[#DAB9FF]" />
              <span>+ Import Data WO</span>
            </button>
          ) : currentUser.role === 'dispatch' ? (
            <button
              type="button"
              onClick={() => onNavigate('form_sameday')}
              className="btn-3d-darkpurple px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Zap className="w-4 h-4 text-amber-300" />
              <span>+ Form Sameday</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('contact_centre')}
              className="btn-3d-darkpurple px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <MessageCircle className="w-4 h-4 text-[#DAB9FF]" />
              <span>Contact Centre</span>
            </button>
          )}
        </div>
      </section>

      {/* 1. TOP KPI & OPERATIONAL PULSE STRIP (6 Cards matching Stitch AI) */}
      <section
        className={`grid gap-3 items-stretch ${
          isMobileView ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6'
        }`}
      >
        {/* KPI 1: Total Hari Ini */}
        <button
          type="button"
          onClick={() => {
            setSelectedApprovalStatus('ALL');
            setSelectedInstallerStatus('ALL');
            setCurrentPage(1);
          }}
          className={`bg-white dark:bg-[#1E1238] rounded-lg p-3 shadow-xs text-left flex flex-col justify-between border transition-colors cursor-pointer ${
            selectedApprovalStatus === 'ALL' && selectedInstallerStatus === 'ALL'
              ? 'border-[#A78BFA] ring-1 ring-[#A78BFA]/40'
              : 'border-[#E9E5F0] dark:border-[#35105E] hover:border-[#A78BFA]/60'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#766B83] dark:text-[#CEC0E8] uppercase tracking-wide">
              Total Hari Ini
            </span>
            <TicketIcon className="w-4 h-4 text-[#A78BFA] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#211A2E] dark:text-white tracking-tight tabular-nums">
              {approvalCounts.totalToday}
            </span>
            <span className="text-xs text-[#16A36A] font-semibold tabular-nums">
              {filteredTickets.length} tampil
            </span>
          </div>
          <div className="text-[10px] font-semibold text-[#8B8495] mt-1 truncate">
            todayWIB: {formattedAppointmentChip}
          </div>
        </button>

        {/* KPI 2: Butuh Approval (Urgent Highlight) */}
        <button
          type="button"
          onClick={() => {
            setSelectedApprovalStatus(prev => (prev === 'BUTUH APPROVAL' ? 'ALL' : 'BUTUH APPROVAL'));
            setCurrentPage(1);
          }}
          className={`bg-[#F0E3FF] dark:bg-[#2E1459] rounded-lg p-3 shadow-xs text-left flex flex-col justify-between relative overflow-hidden border transition-all cursor-pointer ${
            selectedApprovalStatus === 'BUTUH APPROVAL'
              ? 'border-[#7135B5] ring-2 ring-[#7135B5]/35'
              : 'border-[#E59A27]/35 hover:border-[#E59A27]'
          }`}
        >
          <div className="absolute -right-2 -top-2 w-12 h-12 bg-[#E59A27]/15 rounded-full pointer-events-none blur-sm" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#35105E] dark:text-[#E9D5FF] uppercase font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E59A27] animate-ping shrink-0" />
              <span className="truncate">Butuh Approval</span>
            </span>
            <Clock className="w-4 h-4 text-[#E59A27] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-extrabold text-[#35105E] dark:text-white tracking-tight tabular-nums">
              {approvalCounts.butuhApproval}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shadow-2xs whitespace-nowrap ${
                approvalCounts.butuhApproval > 0
                  ? 'bg-[#E59A27] text-white animate-pulse'
                  : 'bg-[#16A36A]/15 text-[#16A36A]'
              }`}
            >
              {approvalCounts.butuhApproval > 0 ? 'Action Required' : 'Clear'}
            </span>
          </div>
          <div className="text-[10px] text-[#7135B5] dark:text-[#D8B4FE] font-medium mt-1 truncate">
            SLO Dispatch: &lt; 15 mnt
          </div>
        </button>

        {/* KPI 3: Disetujui */}
        <button
          type="button"
          onClick={() => {
            setSelectedApprovalStatus(prev => (prev === 'APPROVED' ? 'ALL' : 'APPROVED'));
            setCurrentPage(1);
          }}
          className={`bg-white dark:bg-[#1E1238] rounded-lg p-3 shadow-xs text-left flex flex-col justify-between border transition-colors cursor-pointer ${
            selectedApprovalStatus === 'APPROVED'
              ? 'border-[#16A36A] ring-2 ring-[#16A36A]/30'
              : 'border-[#E9E5F0] dark:border-[#35105E] hover:border-[#16A36A]/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#766B83] dark:text-[#CEC0E8] uppercase tracking-wide">
              Disetujui
            </span>
            <BadgeCheck className="w-4 h-4 text-[#16A36A] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#16A36A] tracking-tight tabular-nums">
              {approvalCounts.approved}
            </span>
            <span className="font-mono text-xs font-semibold text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
              {approvedPct}%
            </span>
          </div>
          <div className="text-[10px] text-[#8B8495] mt-1 truncate">Siap Berita Acara</div>
        </button>

        {/* KPI 4: Perlu Revisi */}
        <button
          type="button"
          onClick={() => {
            setSelectedApprovalStatus(prev => (prev === 'REJECTED' ? 'ALL' : 'REJECTED'));
            setCurrentPage(1);
          }}
          className={`bg-white dark:bg-[#1E1238] rounded-lg p-3 shadow-xs text-left flex flex-col justify-between border transition-colors cursor-pointer ${
            selectedApprovalStatus === 'REJECTED'
              ? 'border-[#DC4C5A] ring-2 ring-[#DC4C5A]/30'
              : 'border-[#E9E5F0] dark:border-[#35105E] hover:border-[#DC4C5A]/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#766B83] dark:text-[#CEC0E8] uppercase tracking-wide">
              Perlu Revisi
            </span>
            <AlertTriangle className="w-4 h-4 text-[#DC4C5A] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#DC4C5A] tracking-tight tabular-nums">
              {approvalCounts.rejected}
            </span>
            <span className="font-mono text-[11px] text-[#DC4C5A] font-semibold truncate">
              Dropcore / Foto
            </span>
          </div>
          <div className="text-[10px] text-[#8B8495] mt-1 truncate">Menunggu Teknisi</div>
        </button>

        {/* KPI 5: Di Lapangan */}
        <button
          type="button"
          onClick={() => {
            setSelectedInstallerStatus(prev => (prev === 'On Site' ? 'ALL' : 'On Site'));
            setCurrentPage(1);
          }}
          className={`bg-white dark:bg-[#1E1238] rounded-lg p-3 shadow-xs text-left flex flex-col justify-between border transition-colors cursor-pointer ${
            selectedInstallerStatus === 'On Site'
              ? 'border-[#3977C9] ring-2 ring-[#3977C9]/30'
              : 'border-[#E9E5F0] dark:border-[#35105E] hover:border-[#3977C9]/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#766B83] dark:text-[#CEC0E8] uppercase tracking-wide">
              Di Lapangan
            </span>
            <Wrench className="w-4 h-4 text-[#3977C9] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#3977C9] tracking-tight tabular-nums">
              {approvalCounts.diLapangan}
            </span>
            <span className="font-mono text-xs font-semibold text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
              {fieldPct}%
            </span>
          </div>
          <div className="text-[10px] text-[#8B8495] mt-1 truncate">On-site &amp; En-route</div>
        </button>

        {/* KPI 6: Fast Lane CTA Card */}
        <div className="bg-gradient-to-br from-[#5B35B1] via-[#7135B5] to-[#35105E] rounded-lg p-3 shadow-md flex flex-col justify-between text-white border border-[#7135B5]/30">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[#D8B4FE] font-bold">
              Fast Lane
            </span>
            <Zap className="w-4 h-4 text-[#D8B4FE] shrink-0" />
          </div>
          <div className="my-1.5">
            {currentUser.role === 'dispatch' ? (
              <button
                type="button"
                onClick={() => onNavigate('form_sameday')}
                className="btn-3d-ceramic w-full py-1.5 px-2.5 text-xs rounded-lg font-extrabold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Zap className="w-3.5 h-3.5 text-[#7135B5]" />
                <span className="text-[#35105E]">+ Form Sameday</span>
              </button>
            ) : ['super_admin', 'management_data'].includes(currentUser.role) ? (
              <button
                type="button"
                onClick={() => onNavigate('import')}
                className="btn-3d-ceramic w-full py-1.5 px-2.5 text-xs rounded-lg font-extrabold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#7135B5]" />
                <span className="text-[#35105E]">+ Import Data WO</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('contact_centre')}
                className="btn-3d-ceramic w-full py-1.5 px-2.5 text-xs rounded-lg font-extrabold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <MessageCircle className="w-3.5 h-3.5 text-[#7135B5]" />
                <span className="text-[#35105E]">Contact Centre</span>
              </button>
            )}
          </div>
          <div className="text-[10px] text-[#D8B4FE] font-medium truncate">
            {currentUser.role === 'dispatch'
              ? 'Prioritas Khusus MyRepublic'
              : ['super_admin', 'management_data'].includes(currentUser.role)
              ? 'Input Batch WO Baru'
              : 'Koordinasi Lapangan'}
          </div>
        </div>
      </section>

      {/* 2. COMPREHENSIVE FILTER & OPERATIONAL TOOLBAR */}
      <section className="bg-white dark:bg-[#1E1238] rounded-xl p-3.5 shadow-xs space-y-3 border border-[#E9E5F0] dark:border-[#35105E]">
        {/* Search Row & Appointment Scope + Live SSE */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5 justify-between">
          <div className="flex items-center gap-2 flex-1 max-w-2xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#8B8495] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={
                  isCrossDateSearchEligible
                    ? 'Cari Nomor WO / ID Customer 7-digit...'
                    : 'Cari WO Hari Ini (Nomor WO, ID, Nama, Teknisi)...'
                }
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full min-h-[42px] sm:min-h-[36px] pl-9 pr-20 py-2 bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl text-xs text-[#211A2E] dark:text-white placeholder:text-[#8B8495] border border-[#E9E5F0] dark:border-[#35105E] focus:outline-none focus:bg-white dark:focus:bg-[#22123F] focus:border-[#A78BFA] focus:ring-2 focus:ring-[#A78BFA]/40 transition-all"
              />
              <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1">
                {searchTerm ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 rounded bg-[#F4EAFF] dark:bg-[#35105E] font-mono text-[10px] font-semibold text-[#766B83] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#5B35B1] shadow-2xs cursor-pointer hover:bg-[#E9D5FF]"
                  >
                    Clear
                  </button>
                ) : (
                  !isCompactUI && (
                    <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#35105E] border border-[#D8CCF3] dark:border-[#5B35B1] text-[10px] font-mono font-semibold text-[#766B83] dark:text-[#D8B4FE]">
                      /
                    </kbd>
                  )
                )}
              </div>
            </div>

            {isCompactUI && (
              <button
                type="button"
                onClick={() => setShowFilterSheet(true)}
                aria-label="Buka Filter Lanjutan"
                className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-all ${
                  selectedArea !== 'ALL' ||
                  selectedContractor !== 'ALL' ||
                  selectedAgentStatus !== 'ALL' ||
                  selectedInstallerStatus !== 'ALL' ||
                  selectedWhatsAppStatus !== 'ALL' ||
                  selectedApprovalStatus !== 'ALL' ||
                  selectedCategory !== 'ALL'
                    ? 'btn-3d-primary'
                    : 'btn-3d-lilac'
                }`}
              >
                <Filter className="w-4 h-4" />
                <span>Filter</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="btn-3d-ceramic flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg text-[#35105E] dark:text-[#E9D5FF]">
              <Calendar className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA] shrink-0" />
              <span className="text-[11px] font-bold whitespace-nowrap tabular-nums">
                {isCrossDateActive
                  ? `Lintas Tanggal (${filteredTickets.length} WO)`
                  : `Appointment: todayWIB (${formattedAppointmentChip})`}
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-[#F4EAFF] dark:bg-[#22123F] border border-[#D8CCF3] dark:border-[#35105E] text-[#766B83] shadow-2xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  databaseStatus === 'connected'
                    ? 'bg-[#16A36A] animate-ping'
                    : 'bg-[#E59A27]'
                }`}
              />
              <span className="text-[10px] font-bold text-[#16A36A] tracking-wide">
                {databaseStatus === 'connected' ? 'SSE LIVE' : 'LOCAL SYNC'}
              </span>
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
                className="btn-3d-icon w-7 h-7 sm:w-6 sm:h-6 ml-1 cursor-pointer"
                title="Refresh Data"
                aria-label="Refresh Data"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Cross-Date Search Banner */}
        {isCrossDateActive && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-[#F4EAFF] dark:bg-[#2A174E] border border-[#D8CCF3] dark:border-[#5B35B1] text-[#431599] dark:text-[#E9D5FF] text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#7135B5] dark:text-[#D8B4FE] shrink-0" />
              <span>
                <strong>Mode Pencarian Lintas Tanggal Aktif:</strong> Ditemukan{' '}
                <strong>{filteredTickets.length}</strong> WO untuk kueri &ldquo;{searchTerm}&rdquo;.
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
              className="btn-3d-ceramic px-2.5 py-1.5 min-h-[36px] sm:min-h-0 rounded-lg text-xs font-bold flex items-center gap-1 self-start sm:self-auto cursor-pointer whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset ke Hari Ini</span>
            </button>
          </div>
        )}

        {/* 6-Column Filter Matrix (Desktop; mobile uses WorkOrderFilterSheet) */}
        {!isCompactUI && (
          <div
            className={`grid gap-2 text-xs ${
              isCompactUI
                ? 'grid-cols-1 sm:grid-cols-2'
                : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'
            }`}
          >
            <div>
              <label className="block text-[10px] font-semibold text-[#8B8495] mb-0.5">
                Area Servis
              </label>
              <select
                value={selectedArea}
                onChange={e => {
                  setSelectedArea(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full min-h-[40px] sm:min-h-[34px] py-1.5 px-2.5 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg text-xs text-[#211A2E] dark:text-[#F5F1FF] font-medium border border-[#E9E5F0] dark:border-[#35105E] focus:outline-none focus:ring-1 focus:ring-[#A78BFA]"
              >
                <option value="ALL">Semua Area ({areaOptions.length})</option>
                {areaOptions.map(a => (
                  <option key={a.name} value={a.name}>
                    {a.name} ({a.count})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[#8B8495] mb-0.5">
                Mitra Kontraktor
              </label>
              <select
                value={selectedContractor}
                onChange={e => {
                  setSelectedContractor(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full min-h-[40px] sm:min-h-[34px] py-1.5 px-2.5 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg text-xs text-[#211A2E] dark:text-[#F5F1FF] font-medium border border-[#E9E5F0] dark:border-[#35105E] focus:outline-none focus:ring-1 focus:ring-[#A78BFA]"
              >
                <option value="ALL">Semua Kontraktor ({contractorOptions.length})</option>
                {contractorOptions.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[#8B8495] mb-0.5">
                Status WO Agent
              </label>
              <select
                value={selectedAgentStatus}
                onChange={e => {
                  setSelectedAgentStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full min-h-[40px] sm:min-h-[34px] py-1.5 px-2.5 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg text-xs text-[#211A2E] dark:text-[#F5F1FF] font-medium border border-[#E9E5F0] dark:border-[#35105E] focus:outline-none focus:ring-1 focus:ring-[#A78BFA]"
              >
                <option value="ALL">statusWOAgent (All)</option>
                <option value="Pending">Pending</option>
                <option value="Assigned">Assigned</option>
                <option value="In Progress">In Progress</option>
                <option value="Done">Done</option>
                <option value="Reschedule">Reschedule</option>
                <option value="Cancel">Cancel</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[#8B8495] mb-0.5">
                Status Lapangan (Tech)
              </label>
              <select
                value={selectedInstallerStatus}
                onChange={e => {
                  setSelectedInstallerStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full min-h-[40px] sm:min-h-[34px] py-1.5 px-2.5 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg text-xs text-[#211A2E] dark:text-[#F5F1FF] font-medium border border-[#E9E5F0] dark:border-[#35105E] focus:outline-none focus:ring-1 focus:ring-[#A78BFA]"
              >
                <option value="ALL">statusWOInstaller (All)</option>
                <option value="Unassigned">Unassigned</option>
                <option value="Assigned">Assigned</option>
                <option value="En Route">En Route</option>
                <option value="On Site">On Site</option>
                <option value="In Progress">In Progress</option>
                <option value="Pending Technical">Pending Technical</option>
                <option value="Completed">Completed</option>
                <option value="Installed">Installed</option>
                <option value="Failed / Cancelled">Failed / Cancelled</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[#8B8495] mb-0.5">
                WhatsApp Handshake
              </label>
              <select
                value={selectedWhatsAppStatus}
                onChange={e => {
                  setSelectedWhatsAppStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full min-h-[40px] sm:min-h-[34px] py-1.5 px-2.5 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg text-xs text-[#211A2E] dark:text-[#F5F1FF] font-medium border border-[#E9E5F0] dark:border-[#35105E] focus:outline-none focus:ring-1 focus:ring-[#A78BFA]"
              >
                <option value="ALL">statusWhatsApp (All)</option>
                <option value="not_prepared">Not Prepared</option>
                <option value="ready">Ready</option>
                <option value="opened_in_whatsapp">Opened in WhatsApp</option>
                <option value="awaiting_confirmation">Awaiting Confirmation</option>
                <option value="confirmed">Confirmed</option>
                <option value="reschedule_requested">Reschedule Requested</option>
                <option value="unreachable">Unreachable</option>
                <option value="invalid_number">Invalid Phone</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-[#35105E] dark:text-[#D8B4FE] mb-0.5">
                Approval Dispatch
              </label>
              <select
                value={selectedApprovalStatus}
                onChange={e => {
                  setSelectedApprovalStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full min-h-[40px] sm:min-h-[34px] py-1.5 px-2.5 bg-[#F7F6FA] dark:bg-[#35105E]/50 rounded-lg text-xs text-[#35105E] dark:text-[#F5F1FF] font-semibold border border-[#D8CCF3] dark:border-[#5B35B1] focus:outline-none focus:ring-1 focus:ring-[#A78BFA]"
              >
                <option value="ALL">approvalStatus (All)</option>
                <option value="BUTUH APPROVAL">BUTUH APPROVAL ({approvalCounts.butuhApproval})</option>
                <option value="APPROVED">APPROVED ({approvalCounts.approved})</option>
                <option value="REJECTED">REJECTED / REVISI ({approvalCounts.rejected})</option>
                <option value="CLOSED">CLOSED ({approvalCounts.closed})</option>
              </select>
            </div>

            {isCompactUI && ticketCategories.length > 0 && (
              <div>
                <label className="block text-[10px] font-semibold text-[#8B8495] mb-0.5">
                  Kategori Tiket
                </label>
                <select
                  value={selectedCategory}
                  onChange={e => {
                    setSelectedCategory(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Filter Kategori Tiket Mobile"
                  className="w-full min-h-[40px] py-1.5 px-2.5 bg-[#F7F6FA] dark:bg-[#160D29] rounded-lg text-xs text-[#211A2E] dark:text-[#F5F1FF] font-medium border border-[#E9E5F0] dark:border-[#35105E]"
                >
                  <option value="ALL">Kategori (All)</option>
                  {ticketCategories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Action Utilities Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 bg-[#F7F6FA] dark:bg-[#160D29]/80 p-2.5 rounded-lg border border-[#E9E5F0] dark:border-[#35105E]">
          {/* Left: PILIH SEMUA + Contextual Bulk Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleSelectAll}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-bold text-[#766B83] dark:text-[#CEC0E8] hover:text-[#431599] dark:hover:text-white cursor-pointer select-none whitespace-nowrap"
            >
              {selectedIds.size === paginatedTickets.length && paginatedTickets.length > 0 ? (
                <CheckSquare className="w-4 h-4 text-[#7135B5] dark:text-[#A78BFA]" />
              ) : (
                <Square className="w-4 h-4 text-[#8B8495]" />
              )}
              <span className="uppercase tracking-wide">Pilih Semua</span>
            </button>

            {canApproveInline && (selectedButuhApprovalTickets.length > 0 || approvalCounts.butuhApproval > 0) && (
              <button
                type="button"
                onClick={handleTriggerBulkApprove}
                className="btn-3d-success px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  Bulk Approve (
                  {selectedButuhApprovalTickets.length > 0
                    ? selectedButuhApprovalTickets.length
                    : approvalCounts.butuhApproval}
                  )
                </span>
              </button>
            )}

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap pl-2 border-l border-[#E9E5F0] dark:border-[#35105E]">
                <span className="px-2 py-0.5 rounded-md bg-[#F0E3FF] dark:bg-[#35105E] text-[#431599] dark:text-[#E9D5FF] text-[11px] font-bold tabular-nums">
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
                        <option key={inst} value={inst}>
                          {inst}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleApplyBulkAssign}
                      className="btn-3d-primary px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap flex items-center gap-1"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Assign Teknisi</span>
                    </button>
                  </>
                ) : currentUser.role !== 'super_admin' && currentUser.role !== 'management_data' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#92400E] bg-[#FEF3C7] px-2 py-0.5 rounded-md">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>Assign/Reassign khusus Leader</span>
                  </span>
                ) : null}

                {currentUser.role === 'management_data' && (
                  <button
                    type="button"
                    onClick={() => setShowBulkDeleteModal(true)}
                    className="btn-3d-danger px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus ({selectedIds.size})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setShowBulkApproveConfirm(false);
                  }}
                  className="px-2 py-1 text-[11px] font-semibold text-[#766B83] hover:text-[#211A2E] dark:text-[#CEC0E8] hover:bg-[#E9E5F0] dark:hover:bg-[#35105E] rounded-md cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Category Quick Filter & Reset Filter */}
            {ticketCategories.length > 0 && (
              <select
                value={selectedCategory}
                onChange={e => {
                  setSelectedCategory(e.target.value);
                  setCurrentPage(1);
                }}
                aria-label="Filter Kategori Tiket"
                className="hidden sm:block py-1 px-2 bg-white dark:bg-[#1E1238] border border-[#D8CCF3] dark:border-[#35105E] rounded-lg text-[11px] font-semibold text-[#494453] dark:text-[#CEC0E8]"
              >
                <option value="ALL">Kategori (All)</option>
                {ticketCategories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
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

          {/* Right: Table/Cards Toggle, 46 Kolom Kanonik, Export XLSX, Archive, Chat */}
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            {/* Layout Toggle (Synchronized with Topbar Display Mode Switch) */}
            {canSwitchDisplayMode && (
              <div
                role="group"
                aria-label="Table & Cards Layout Switch"
                className="inline-flex items-center p-1 rounded-xl bg-slate-100/90 dark:bg-[#1E1238] border border-slate-200/90 dark:border-[#35105E] shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] shrink-0 gap-0.5"
              >
                <button
                  type="button"
                  onClick={() => handleSelectLayoutMode('table')}
                  aria-pressed={effectiveLayout === 'table'}
                  title="Tampilan Table (Terintegrasi dengan Desktop Mode)"
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[28px] rounded-lg text-[11.5px] leading-none font-semibold tracking-tight transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                    effectiveLayout === 'table'
                      ? 'bg-white text-[#7C3AED] shadow-[0_1px_3px_rgba(15,23,42,0.10),0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80 dark:bg-[#7C3AED] dark:text-white dark:ring-[#A78BFA]/40'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-white/5'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5 shrink-0" />
                  <span>Table</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectLayoutMode('cards')}
                  aria-pressed={effectiveLayout === 'cards'}
                  title="Tampilan Cards (Terintegrasi dengan Mobile Mode)"
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[28px] rounded-lg text-[11.5px] leading-none font-semibold tracking-tight transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                    effectiveLayout === 'cards'
                      ? 'bg-white text-[#7C3AED] shadow-[0_1px_3px_rgba(15,23,42,0.10),0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80 dark:bg-[#7C3AED] dark:text-white dark:ring-[#A78BFA]/40'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-white/5'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span>Cards</span>
                </button>
              </div>
            )}

            {/* Archive Filter Toggle */}
            <button
              type="button"
              onClick={() => {
                setShowArchived(!showArchived);
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1.5 text-[11px] font-bold rounded-lg border transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                showArchived
                  ? 'bg-[#FEF3C7] text-[#92400E] border-[#F59E0B]/50'
                  : 'btn-3d-ceramic'
              }`}
              title="Tampilkan Work Order Arsip"
            >
              <Archive className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
              <span>{showArchived ? 'Archived' : 'Archive'}</span>
            </button>

            {/* Chat Unread Shortcut */}
            {['super_admin', 'dispatch', 'installer'].includes(currentUser.role) && (
              <button
                type="button"
                onClick={() => onNavigate('contact_centre')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  totalUnreadAcrossTickets > 0
                    ? 'bg-[#FEF2F2] dark:bg-rose-950/40 text-[#DC4C5A] dark:text-rose-300 border border-[#FECACA] dark:border-rose-900'
                    : 'btn-3d-ceramic'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
                <span>Chat</span>
                {totalUnreadAcrossTickets > 0 && (
                  <span className="px-1.5 py-0.2 bg-[#DC4C5A] text-white text-[10px] rounded-full font-bold tabular-nums">
                    {totalUnreadAcrossTickets}
                  </span>
                )}
              </button>
            )}

            {/* 46 Kolom Kanonik + Presets Selector Modal Trigger */}
            <button
              type="button"
              onClick={() => setShowColManager(true)}
              className="btn-3d-ceramic px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              title={
                omittedEmptyCount > 0
                  ? `Smart Omit menyembunyikan ${omittedEmptyCount} kolom kosong pada halaman ini`
                  : 'Atur tampilan & 46 Kolom Kanonik'
              }
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
              <span>
                46 Kolom Kanonik
                {tableStyleMode === 'canonical' ? ` (${activeColumns.length})` : ''}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[#8B8495]" />
            </button>

            <ResponsiveModal
              isOpen={showColManager}
              onClose={() => setShowColManager(false)}
              title="Mode Tabel & 46 Kolom Kanonik"
              subtitle={
                omittedEmptyCount > 0 && tableStyleMode === 'canonical'
                  ? `Smart Omit: ${omittedEmptyCount} kolom kosong disembunyikan otomatis`
                  : 'Sesuaikan preset tampilan atau kolom kanonik yang ditampilkan'
              }
              icon={<SlidersHorizontal className="w-4 h-4" />}
              size="md"
              footer={
                <button
                  type="button"
                  onClick={() => setShowColManager(false)}
                  className="btn-3d-primary px-4 py-2 min-h-[40px] sm:min-h-0 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Selesai
                </button>
              }
            >
              <div className="space-y-4 text-xs">
                {/* Table Presentation Switcher */}
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#F4EAFF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E]">
                  <button
                    type="button"
                    onClick={() => {
                      setTableStyleMode('stitch');
                      applyPreset('preset_default');
                    }}
                    className={`min-h-[40px] sm:min-h-0 py-2 px-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      tableStyleMode === 'stitch'
                        ? 'btn-3d-primary'
                        : 'text-[#63597B] dark:text-[#CEC0E8]'
                    }`}
                  >
                    Ringkas (9 Kolom)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTableStyleMode('canonical')}
                    className={`min-h-[40px] sm:min-h-0 py-2 px-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      tableStyleMode === 'canonical'
                        ? 'btn-3d-primary'
                        : 'text-[#63597B] dark:text-[#CEC0E8]'
                    }`}
                  >
                    Kanonik ({activeColumns.length} Kolom)
                  </button>
                </div>

                {/* Quick Preset Selector */}
                <div>
                  <label className="block text-[10.5px] font-bold text-[#766B83] dark:text-[#A78BFA] uppercase mb-1">
                    Preset Kolom
                  </label>
                  <select
                    value={config.ticketsTable.activePresetId || ''}
                    onChange={e => {
                      const val = e.target.value;
                      applyPreset(val);
                      setTableStyleMode(val === 'preset_default' ? 'stitch' : 'canonical');
                    }}
                    className="w-full min-h-[40px] sm:min-h-[34px] px-2.5 py-1.5 text-xs bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-[#211A2E] dark:text-[#F5F1FF] font-semibold cursor-pointer"
                  >
                    {config.ticketsTable.presets.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Grouped 46 Canonical Columns Checklist */}
                <div className="space-y-3">
                  {CANONICAL_COLUMN_GROUPS.map(group => {
                    const groupCols = [...config.ticketsTable.columns]
                      .filter(c => c.categoryGroup === group.id && c.key !== 'actions' && c.key !== 'selection')
                      .sort((a, b) => a.order - b.order);
                    if (groupCols.length === 0) return null;
                    return (
                      <div key={group.id} className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#7135B5] dark:text-[#D8B4FE] px-1">
                          {group.title}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                          {groupCols.map(col => (
                            <label
                              key={col.key}
                              className={`flex items-center justify-between gap-2 p-2 rounded-lg border border-transparent ${
                                col.mandatory
                                  ? 'bg-[#F5F1FF]/70 dark:bg-[#251545]/70 cursor-not-allowed'
                                  : 'hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]/60 border-[#E8DDFF]/50 dark:border-[#35105E] cursor-pointer'
                              }`}
                            >
                              <div className="min-w-0 flex items-center gap-1.5">
                                {col.mandatory && (
                                  <Lock className="w-3 h-3 text-[#7135B5] dark:text-[#D8B4FE] shrink-0" />
                                )}
                                <span className="text-[#211A2E] dark:text-[#F5F1FF] truncate">
                                  {col.label}
                                </span>
                              </div>
                              <input
                                type="checkbox"
                                disabled={col.mandatory}
                                checked={col.mandatory ? true : col.visible}
                                onChange={e => {
                                  if (!col.mandatory) {
                                    setTableStyleMode('canonical');
                                    setColumnVisibility(col.key, e.target.checked);
                                  }
                                }}
                                className="w-4 h-4 rounded border-[#D8CCF3] text-[#431599] focus:ring-[#7135B5] disabled:opacity-60"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ResponsiveModal>

            {/* Export XLSX */}
            <button
              type="button"
              onClick={handleExportXLSX}
              className="btn-3d-success px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export XLSX</span>
            </button>
          </div>
        </div>

        {/* Inline Bulk Approval Confirmation Banner */}
        {showBulkApproveConfirm && canApproveInline && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-lg bg-[#ECFDF5] dark:bg-emerald-950/40 border border-[#86EFAC] dark:border-emerald-800 text-xs">
            <div className="flex items-center gap-2 text-[#15803D] dark:text-emerald-200 font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Konfirmasi Bulk Approve: <strong>{selectedButuhApprovalTickets.length}</strong> Work Order
                berstatus <strong>BUTUH APPROVAL</strong> akan diverifikasi dengan status WO Agent sesuai laporan aktual dan Ticket Result <strong>Closed</strong>.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isBulkApproving}
                onClick={handleConfirmBulkApprove}
                className="btn-3d-success px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {isBulkApproving
                  ? 'Memproses Approval...'
                  : `Ya, Approve (${selectedButuhApprovalTickets.length})`}
              </button>
              <button
                type="button"
                disabled={isBulkApproving}
                onClick={() => setShowBulkApproveConfirm(false)}
                className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 3. DYNAMIC WORK ORDER TABLE OR MOBILE CARDS */}
      {effectiveLayout === 'cards' ? (
        <div className="space-y-3">
          {/* Stitch Screen 1 Mobile/Cards Operational Header + Segmented Chips + Sort */}
          <div className="card-3d-lavender rounded-2xl p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display font-bold text-[17px] text-[#1F1638] dark:text-white tracking-tight">
                  Daftar Work Order
                </h2>
                <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
                  Monitoring real-time &amp; penugasan lapangan
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ffdad6]/85 dark:bg-rose-950/60 text-[#93000a] dark:text-rose-200 text-[11px] font-bold shrink-0 tabular-nums">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ba1a1a] animate-pulse" />
                <span>
                  {filteredTickets.length} WO • {approvalCounts.butuhApproval + approvalCounts.rejected} Perlu Aksi
                </span>
              </div>
            </div>

            {/* Horizontal Segmented Quick Filter Chips */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {[
                {
                  id: 'ALL',
                  label: 'Semua',
                  count: approvalCounts.totalToday,
                  active: selectedApprovalStatus === 'ALL' && selectedInstallerStatus === 'ALL',
                  onClick: () => {
                    setSelectedApprovalStatus('ALL');
                    setSelectedInstallerStatus('ALL');
                    setCurrentPage(1);
                  }
                },
                {
                  id: 'BUTUH_APPROVAL',
                  label: 'Butuh Approval',
                  count: approvalCounts.butuhApproval,
                  tone: 'warn',
                  active: selectedApprovalStatus === 'BUTUH APPROVAL',
                  onClick: () => {
                    setSelectedApprovalStatus(prev => (prev === 'BUTUH APPROVAL' ? 'ALL' : 'BUTUH APPROVAL'));
                    setCurrentPage(1);
                  }
                },
                {
                  id: 'ON_FIELD',
                  label: 'Dalam Pengerjaan',
                  count: approvalCounts.diLapangan,
                  active: selectedInstallerStatus === 'In Progress',
                  onClick: () => {
                    setSelectedInstallerStatus(prev => (prev === 'In Progress' ? 'ALL' : 'In Progress'));
                    setCurrentPage(1);
                  }
                },
                {
                  id: 'REJECTED',
                  label: 'Perlu Revisi',
                  count: approvalCounts.rejected,
                  tone: 'danger',
                  active: selectedApprovalStatus === 'REJECTED',
                  onClick: () => {
                    setSelectedApprovalStatus(prev => (prev === 'REJECTED' ? 'ALL' : 'REJECTED'));
                    setCurrentPage(1);
                  }
                },
                {
                  id: 'APPROVED',
                  label: 'Disetujui',
                  count: approvalCounts.approved,
                  active: selectedApprovalStatus === 'APPROVED',
                  onClick: () => {
                    setSelectedApprovalStatus(prev => (prev === 'APPROVED' ? 'ALL' : 'APPROVED'));
                    setCurrentPage(1);
                  }
                }
              ].map(chip => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={chip.onClick}
                  className={`min-h-[38px] px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-all ${
                    chip.active
                      ? chip.tone === 'danger'
                        ? 'btn-3d-crimson'
                        : 'tactile-chip-active'
                      : chip.tone === 'danger' && chip.count > 0
                      ? 'bg-[#ffdad6] dark:bg-rose-950/60 text-[#93000a] dark:text-rose-200 border border-rose-200 dark:border-rose-800/60'
                      : chip.tone === 'warn' && chip.count > 0
                      ? 'bg-[#ffddb8] dark:bg-amber-950/60 text-[#633c00] dark:text-amber-200 border border-amber-200 dark:border-amber-800/60'
                      : 'tactile-chip text-[#1F1638] dark:text-[#E8DDFF]'
                  }`}
                >
                  <span>{chip.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
                      chip.active ? 'bg-white/20 text-white' : 'bg-white/80 dark:bg-black/25 text-[#1F1638] dark:text-[#E8DDFF]'
                    }`}
                  >
                    {chip.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Compact Sort Bar */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E8DDFF] dark:border-[#35105E]">
              <span className="text-[11px] font-semibold text-[#4B4452] dark:text-[#CEC0E8] truncate">
                Menampilkan {paginatedTickets.length} dari {sortedTickets.length} WO
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <ArrowUpDown className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                <select
                  aria-label="Urutkan Work Order"
                  value={`${sortField}:${sortDirection || 'desc'}`}
                  onChange={e => {
                    const [field, dir] = e.target.value.split(':');
                    setSortField(field);
                    setSortDirection((dir as SortDirection) || 'desc');
                    setCurrentPage(1);
                  }}
                  className="tactile-debossed-input bg-[#FAF5FF] dark:bg-[#160D29] text-[#1F1638] dark:text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg focus:outline-none cursor-pointer"
                >
                  <option value="updatedAt:desc">Terbaru Diperbarui</option>
                  <option value="slotTime:asc">Slot Waktu Terdekat</option>
                  <option value="statusWOInstaller:asc">Status Lapangan</option>
                  <option value="woNumber:asc">Nomor WO (A-Z)</option>
                </select>
              </div>
            </div>
          </div>

          {paginatedTickets.length === 0 ? (
            <div className="card-3d-lavender rounded-2xl py-12 px-4 text-center text-[#4B4452] dark:text-[#CEC0E8] text-xs space-y-2">
              <p className="font-semibold">Tidak ada tiket Work Order yang cocok dengan filter pencarian.</p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="btn-3d-lilac min-h-[40px] px-4 py-2 rounded-xl font-bold cursor-pointer"
                >
                  Reset Semua Filter
                </button>
              )}
            </div>
          ) : (
            <div
              className={`grid gap-3 ${
                isCompactUI ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              }`}
            >
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
        <section className="bg-white dark:bg-[#1E1238] rounded-lg shadow-xs overflow-hidden border border-[#E9E5F0] dark:border-[#35105E]">
          <div className="overflow-x-auto min-h-[280px] relative">
            {tableStyleMode === 'stitch' ? (
              /* STITCH AI RICH COMPOSITE 9-COLUMN TABLE */
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F4EAFF] dark:bg-[#251545] text-[11px] font-bold text-[#766B83] dark:text-[#D8B4FE] uppercase tracking-wide select-none border-b border-[#E9E5F0] dark:border-[#35105E]">
                    <th className="py-2.5 px-3 w-10 text-center">
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        className="text-[#7135B5] dark:text-[#D8B4FE] cursor-pointer"
                        aria-label="Pilih semua baris pada halaman ini"
                      >
                        {selectedIds.size === paginatedTickets.length && paginatedTickets.length > 0 ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 opacity-65" />
                        )}
                      </button>
                    </th>
                    <th
                      onClick={() => handleSort('woNumber')}
                      className="py-2.5 px-3 cursor-pointer hover:text-[#211A2E] dark:hover:text-white whitespace-nowrap"
                    >
                      <div className="flex items-center gap-1">
                        <span>WO Number</span>
                        {sortField === 'woNumber' && sortDirection === 'asc' ? (
                          <ArrowUp className="w-3.5 h-3.5 text-[#7135B5]" />
                        ) : sortField === 'woNumber' && sortDirection === 'desc' ? (
                          <ArrowDown className="w-3.5 h-3.5 text-[#7135B5]" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-50" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('idCustomer')}
                      className="py-2.5 px-3 cursor-pointer hover:text-[#211A2E] dark:hover:text-white whitespace-nowrap"
                    >
                      <div className="flex items-center gap-1">
                        <span>ID Cust</span>
                        {sortField === 'idCustomer' && sortDirection === 'asc' ? (
                          <ArrowUp className="w-3.5 h-3.5 text-[#7135B5]" />
                        ) : sortField === 'idCustomer' && sortDirection === 'desc' ? (
                          <ArrowDown className="w-3.5 h-3.5 text-[#7135B5]" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-50" />
                        )}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 min-w-[205px]">Pelanggan &amp; Kontak</th>
                    <th className="py-2.5 px-3 min-w-[160px]">Area / Cluster</th>
                    <th
                      onClick={() => handleSort('slotTime')}
                      className="py-2.5 px-3 cursor-pointer hover:text-[#211A2E] dark:hover:text-white whitespace-nowrap"
                    >
                      <div className="flex items-center gap-1">
                        <span>Slot Waktu</span>
                        {sortField === 'slotTime' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 text-[#7135B5]" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-[#7135B5]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 min-w-[175px]">Kontraktor &amp; Tim</th>
                    <th className="py-2.5 px-3 min-w-[225px]">4 Dimensi Status</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 z-20 bg-[#F4EAFF] dark:bg-[#251545] shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.04)]">
                      Aksi Operasional
                    </th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#E9E5F0] dark:divide-[#35105E]">
                  {paginatedTickets.length === 0 ? (
                    <tr>
                      <td colSpan={stitchColSpan} className="py-12 text-center text-[#8B8495] text-xs">
                        Tidak ada tiket Work Order yang cocok dengan filter.
                      </td>
                    </tr>
                  ) : (
                    paginatedTickets.map(ticket => {
                      const isSelected = selectedIds.has(ticket.id);
                      const isExpanded = expandedDrawerTicketId === ticket.id;
                      const isRejectedRow =
                        ticket.approvalStatus === 'REJECTED' || ticket.approvalStatus === 'REVISI';
                      const isUrgentRow = ticket.approvalStatus === 'BUTUH APPROVAL';
                      const hasInlineEvidence =
                        isUrgentRow ||
                        isRejectedRow ||
                        Boolean(ticket.technicalReport) ||
                        Boolean(ticket.progressReports && ticket.progressReports.length > 0);
                      const phoneStr = ticket.customerPhone || (ticket as any).phoneNumber || '';
                      const addressStr =
                        ticket.streetName ||
                        (ticket as any).customerAddress ||
                        (ticket as any).address ||
                        '';
                      const contractorStr = ticket.contactorName || ticket.contractorName || '-';
                      const fatLabel = ticket.fatCode || ticket.fat;
                      const packageOrCat = ticket.plan || ticket.ticketCategory || '';
                      const isSameday =
                        (ticket.ticketCategory || '').toLowerCase().includes('sameday') ||
                        (ticket.appointmentType || '').toLowerCase().includes('sameday');

                      const stickyBg = isExpanded
                        ? 'bg-[#F5F1FF] dark:bg-[#251247]'
                        : isRejectedRow
                        ? 'bg-[#FEF2F2] dark:bg-rose-950/25'
                        : isUrgentRow
                        ? 'bg-[#F9F4FF] dark:bg-[#2A174E]'
                        : 'bg-white dark:bg-[#1E1238] group-hover:bg-[#F7F6FA] dark:group-hover:bg-[#251545]';

                      return (
                        <Fragment key={ticket.id}>
                          <tr
                            className={`group transition-colors ${
                              isExpanded
                                ? 'bg-[#F0E3FF]/50 dark:bg-[#251247]/80'
                                : isRejectedRow
                                ? 'bg-[#ffdad6]/20 dark:bg-rose-950/20 hover:bg-[#ffdad6]/30'
                                : isUrgentRow
                                ? 'bg-[#F0E3FF]/35 dark:bg-[#2A174E]/60 hover:bg-[#F5F1FF] dark:hover:bg-[#2A174E]'
                                : 'hover:bg-[#F7F6FA] dark:hover:bg-[#251545]/60'
                            }`}
                          >
                            {/* 1. Checkbox */}
                            <td className="py-3 px-3 text-center align-top">
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  handleToggleSelect(ticket.id);
                                }}
                                className="text-[#8B8495] hover:text-[#431599] cursor-pointer"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-[#7135B5] dark:text-[#A78BFA]" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            </td>

                            {/* 2. WO Number + Copy + Category */}
                            <td className="py-3 px-3 align-top whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (hasInlineEvidence && isUrgentRow) {
                                      toggleInlineDrawer(ticket);
                                    } else {
                                      onSelectTicket(ticket);
                                    }
                                  }}
                                  className="font-mono text-xs font-bold text-[#431599] dark:text-[#D8B4FE] hover:underline cursor-pointer tabular-nums"
                                >
                                  {ticket.woNumber}
                                </button>
                                <button
                                  type="button"
                                  onClick={e => handleCopyWoNumber(e, ticket)}
                                  className="btn-3d-icon w-6 h-6 p-0 text-[#8B8495] hover:text-[#7135B5] cursor-pointer"
                                  title="Copy WO Number"
                                >
                                  {copiedWoId === ticket.id ? (
                                    <Check className="w-3 h-3 text-[#16A36A]" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {isSameday ? (
                                  <span className="px-1.5 py-0.5 rounded bg-[#35105E] text-white text-[9.5px] font-bold shadow-2xs">
                                    SAMEDAY
                                  </span>
                                ) : ticket.ticketCategory ? (
                                  <span className="px-1.5 py-0.5 rounded bg-[#7135B5]/15 dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] text-[9.5px] font-bold">
                                    {ticket.ticketCategory}
                                  </span>
                                ) : null}
                                {packageOrCat && packageOrCat !== ticket.ticketCategory && (
                                  <span className="text-[10px] text-[#8B8495] truncate max-w-[110px]">
                                    {packageOrCat}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 3. ID Cust */}
                            <td className="py-3 px-3 align-top whitespace-nowrap font-mono text-xs font-bold text-[#211A2E] dark:text-white tabular-nums">
                              {ticket.idCustomer || '-'}
                            </td>

                            {/* 4. Pelanggan & Kontak */}
                            <td className="py-3 px-3 align-top">
                              <div className="font-bold text-[#211A2E] dark:text-white truncate max-w-[210px]">
                                {ticket.customerName || '-'}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="font-mono text-[11.5px] text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
                                  {phoneStr || '-'}
                                </span>
                                {phoneStr && (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      onOpenWhatsApp(ticket);
                                    }}
                                    className="w-5 h-5 rounded-full bg-[#16A36A] text-white flex items-center justify-center hover:opacity-90 transition-opacity shadow-2xs cursor-pointer shrink-0"
                                    title="Buka WhatsApp Pelanggan"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              {addressStr && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    openCustomerAddressInGoogleMaps(ticket);
                                  }}
                                  className="flex items-center gap-1 text-[#8B8495] hover:text-[#431599] dark:hover:text-[#D8B4FE] mt-1 text-[11px] truncate max-w-[215px] cursor-pointer text-left"
                                  title={showHoverTooltips ? addressStr : 'Buka lokasi di Google Maps'}
                                >
                                  <MapPin className="w-3.5 h-3.5 text-[#DC4C5A] shrink-0" />
                                  <span className="truncate hover:underline">{addressStr}</span>
                                </button>
                              )}
                            </td>

                            {/* 5. Area / Cluster */}
                            <td className="py-3 px-3 align-top">
                              <div className="font-semibold text-[#211A2E] dark:text-white">
                                {ticket.area || '-'}
                              </div>
                              <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] truncate max-w-[165px]">
                                {ticket.clusterName || '-'}
                              </div>
                              {fatLabel && (
                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#22123F] text-[10px] font-mono font-semibold text-[#766B83] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#35105E]">
                                  {fatLabel}
                                </span>
                              )}
                            </td>

                            {/* 6. Slot Waktu */}
                            <td className="py-3 px-3 align-top whitespace-nowrap">
                              <div className="flex items-center gap-1 text-[#211A2E] dark:text-white font-semibold">
                                <Clock className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA] shrink-0" />
                                <span className="tabular-nums">{ticket.slotTime || '-'}</span>
                              </div>
                              <span className="text-[11px] text-[#8B8495] block mt-0.5 tabular-nums">
                                WIB · {formatIndonesianWODate(getTicketAppointmentDate(ticket) || todayWIB)}
                              </span>
                            </td>

                            {/* 7. Kontraktor & Tim */}
                            <td className="py-3 px-3 align-top">
                              <div className="font-medium text-[#211A2E] dark:text-white truncate max-w-[170px]">
                                {contractorStr}
                              </div>
                              {ticket.installerName ? (
                                <div className="flex items-center gap-1 text-[11px] text-[#35105E] dark:text-[#D8B4FE] font-semibold mt-0.5">
                                  <UserCheck className="w-3 h-3 shrink-0" />
                                  <span className="truncate max-w-[145px]">{ticket.installerName}</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-[11px] text-[#DC4C5A] font-semibold mt-0.5">
                                  <UserX className="w-3 h-3 shrink-0" />
                                  <span>Belum Ada Teknisi</span>
                                </div>
                              )}
                              <div className="text-[11px] text-[#8B8495] truncate max-w-[165px]">
                                Korlap: {ticket.leaderName || '-'}
                              </div>
                            </td>

                            {/* 8. 4 Dimensi Status */}
                            <td className="py-3 px-3 align-top">
                              <div className="flex flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  <StatusAgentBadge status={ticket.statusWOAgent} />
                                  <StatusInstallerBadge status={ticket.statusWOInstaller} />
                                </div>
                                <div className="flex flex-wrap items-center gap-1">
                                  <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
                                </div>
                                <div className="flex flex-wrap items-center gap-1">
                                  {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' ? (
                                    <StatusApprovalBadge status={ticket.approvalStatus} />
                                  ) : (
                                    <span className="text-[11px] text-[#8B8495]">-</span>
                                  )}
                                  {isTicketClosed(ticket) && ticket.statusWOAgent !== 'Closed' && (
                                    <span className="px-1.5 py-0.5 rounded bg-[#27104A] dark:bg-[#E8DDFF] text-white dark:text-[#1F1638] text-[9.5px] font-bold uppercase tracking-wide">
                                      Closed
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* 9. Sticky-Right Aksi Operasional (3D Dispatch Review + Detail Ticket) */}
                            <td
                              className={`py-3 px-3 align-top text-right whitespace-nowrap sticky right-0 z-10 ${stickyBg} shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.03)] transition-colors`}
                            >
                              <div className="flex items-center justify-end gap-1.5">
                                {canApproveInline && (isUrgentRow || hasInlineEvidence) && (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      toggleInlineDrawer(ticket);
                                    }}
                                    className="btn-3d-amber px-2.5 py-1 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    title="Buka Quick Dispatch Review & Approval"
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    <span>{isExpanded ? 'Tutup Review' : 'Dispatch Review'}</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    onSelectTicket(ticket);
                                  }}
                                  className="btn-3d-ceramic px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                  title="Buka Detail Ticket"
                                >
                                  <Eye className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
                                  <span>Detail</span>
                                </button>
                              </div>
                            </td>
                          </tr>

                          {isExpanded && renderExpandedDrawer(ticket, stitchColSpan)}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              /* CANONICAL 46-COLUMN CONFIGURABLE TABLE */
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-[#F4EAFF] dark:bg-[#251545] border-b border-[#D8CCF3] dark:border-[#35105E] text-[11px] font-bold text-[#58149c] dark:text-[#dab9ff] uppercase tracking-wider">
                    <th
                      className={`py-3 px-3 w-11 min-w-[44px] max-w-[44px] text-center bg-[#F4EAFF] dark:bg-[#251545] border-r border-[#D8CCF3]/60 dark:border-[#35105E] ${
                        stickyColumnsEnabled ? 'sticky left-0 z-20' : ''
                      } ${
                        stickyColumnsEnabled && freezeColumnCount === 1
                          ? 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]'
                          : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        className="text-[#431599] dark:text-[#D8B4FE] cursor-pointer"
                      >
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
                            {col.sortable &&
                              (isSorted && sortDirection === 'asc' ? (
                                <ArrowUp className="w-3.5 h-3.5 shrink-0" />
                              ) : isSorted && sortDirection === 'desc' ? (
                                <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-50 shrink-0" />
                              ))}
                          </div>
                        </th>
                      );
                    })}

                    <th
                      className={`py-3 px-3.5 whitespace-nowrap text-center bg-[#F4EAFF] dark:bg-[#251545] ${
                        stickyColumnsEnabled
                          ? 'sticky right-0 z-20 border-l border-[#D8CCF3]/60 dark:border-[#35105E] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]'
                          : 'border-l border-[#D8CCF3]/60 dark:border-[#35105E]'
                      }`}
                    >
                      Aksi Operasional
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#E9E5F0] dark:divide-[#35105E]">
                  {paginatedTickets.length === 0 ? (
                    <tr>
                      <td colSpan={canonicalColSpan} className="py-12 text-center text-[#8B8495] text-xs">
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
                        ticket.approvalStatus === 'REJECTED' ||
                        ticket.approvalStatus === 'REVISI' ||
                        Boolean(ticket.technicalReport) ||
                        Boolean(ticket.progressReports && ticket.progressReports.length > 0);
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
                                        className="btn-3d-icon w-6 h-6 p-0 text-[#8B8495] hover:text-[#431599] cursor-pointer"
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
                                    <div className="inline-flex items-center gap-1 flex-wrap">
                                      <StatusAgentBadge status={ticket.statusWOAgent} />
                                      {isTicketClosed(ticket) && ticket.statusWOAgent !== 'Closed' && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#27104A] dark:bg-[#E8DDFF] text-white dark:text-[#1F1638] text-[9.5px] font-bold uppercase">
                                          Closed
                                        </span>
                                      )}
                                    </div>
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

                              if (
                                col.key === 'workStartedAt' ||
                                col.key === 'checkOutAt' ||
                                col.key === 'createdAt' ||
                                col.key === 'updatedAt' ||
                                col.key === 'checkInAt'
                              ) {
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
                                      title={
                                        showHoverTooltips && addrStr
                                          ? addrStr
                                          : 'Klik untuk membuka lokasi pelanggan di Google Maps'
                                      }
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
                                        {String(rawVal).toLowerCase().includes('dbm')
                                          ? String(rawVal)
                                          : `${rawVal} dBm`}
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

                            {/* Sticky-Right Actions Cell */}
                            <td
                              className={`${densityClass} text-center whitespace-nowrap ${stickyCellBg} border-l border-[#E9E5F0] dark:border-[#35105E] transition-colors ${
                                stickyColumnsEnabled
                                  ? 'sticky right-0 z-10 shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]'
                                  : ''
                              }`}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                {hasInlineEvidence && (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      toggleInlineDrawer(ticket);
                                    }}
                                    className={`px-2 py-1 rounded text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                                      isExpanded ? 'btn-3d-primary' : 'btn-3d-ceramic'
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
                                        toggleInlineDrawer(ticket);
                                      } else {
                                        handleInlineApprove(ticket);
                                      }
                                    }}
                                    className="btn-3d-success px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer whitespace-nowrap"
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
                                  className="btn-3d-icon w-7 h-7 cursor-pointer"
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
                                    className={`relative btn-3d-icon w-7 h-7 cursor-pointer ${
                                      unread > 0 ? 'text-[#DC4C5A] border-[#FECACA]' : ''
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
                                  className="btn-3d-icon w-7 h-7 text-[#16A36A] cursor-pointer"
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
                                  className="btn-3d-icon w-7 h-7 cursor-pointer"
                                  title={ticket.isArchived ? 'Restore' : 'Archive'}
                                >
                                  {ticket.isArchived ? (
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  ) : (
                                    <Archive className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                {currentUser.role === 'management_data' && (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      setTicketToDelete(ticket);
                                    }}
                                    className="btn-3d-icon w-7 h-7 text-[#DC4C5A] cursor-pointer"
                                    title="Hapus Work Order (Management Data Only)"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {isExpanded && renderExpandedDrawer(ticket, canonicalColSpan)}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* 4. PAGINATION & SYSTEM STATUS FOOTER */}
          <PaginationBar
            currentPage={currentPage}
            totalPages={Math.max(1, totalPages)}
            totalItems={sortedTickets.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={val => {
              setPageSize(val);
              setCurrentPage(1);
            }}
            itemLabel="Work Orders"
          />

          {/* Live Dispatch Log & Audit Telemetry (Real auditLogs) */}
          <div className="px-4 py-3.5 bg-[#FAF5FF] dark:bg-[#160D29]/85 border-t border-[#E8DDFF] dark:border-[#35105E] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-[#1F1638] dark:text-white">
                <Activity className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF] shrink-0" />
                <span>Live Dispatch Log &amp; Operational Audit</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold">
                  WIB · {databaseStatus === 'connected' ? 'SSE ACTIVE' : databaseStatus.toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  onNavigate(
                    currentUser.role === 'super_admin' || currentUser.role === 'it_support'
                      ? 'audit_logs'
                      : currentUser.role === 'dispatch'
                      ? 'verification_desk'
                      : 'history_progress'
                  )
                }
                className="text-xs font-bold text-[#58149C] dark:text-[#DAB9FF] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <span>
                  {currentUser.role === 'super_admin' || currentUser.role === 'it_support'
                    ? 'Buka Audit Log Lengkap'
                    : currentUser.role === 'dispatch'
                    ? 'Buka Antrean Verifikasi'
                    : 'Buka Riwayat Progress'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {auditLogs && auditLogs.length > 0 ? (
              <div className="space-y-1.5">
                {auditLogs.slice(0, 3).map(log => {
                  const actLower = String(log.action || '').toLowerCase();
                  const badgeCls =
                    actLower.includes('reject') || actLower.includes('delete')
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200'
                      : actLower.includes('approve') || actLower.includes('closed')
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200'
                      : 'bg-[#F3EAFF] text-[#58149C] dark:bg-[#2E1459] dark:text-[#DAB9FF]';
                  return (
                    <div
                      key={log.id}
                      className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#35105E] text-[11px]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] text-[#7D7484] dark:text-[#CEC0E8] shrink-0 tabular-nums">
                          {formatTimeOnlyWIB(log.timestamp)}
                        </span>
                        <span className="font-bold text-[#58149C] dark:text-[#DAB9FF] shrink-0">
                          {log.performedBy}
                        </span>
                        <span className="text-[#211A2E] dark:text-white truncate">{log.details}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase shrink-0 ${badgeCls}`}>
                        {log.action}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-[#7D7484] dark:text-[#CEC0E8]">
                <span>
                  Data ditampilkan sesuai zona waktu <strong>Asia/Jakarta (WIB)</strong> · Sync: {syncStatus}
                </span>
                <span className="font-mono text-[10px]">
                  DB: {databaseStatus === 'connected' ? 'ONLINE' : databaseStatus.toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Cards Mode Pagination Footer (only when Cards layout active) */}
      {effectiveLayout === 'cards' && sortedTickets.length > 0 && (
        <div className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] overflow-hidden">
          <PaginationBar
            currentPage={currentPage}
            totalPages={Math.max(1, totalPages)}
            totalItems={sortedTickets.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={val => {
              setPageSize(val);
              setCurrentPage(1);
            }}
            itemLabel="Work Orders"
          />
        </div>
      )}

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

      {/* Stitch Mobile Filter Bottom Sheet */}
      <WorkOrderFilterSheet
        isOpen={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        totalMatchedCount={sortedTickets.length}
        selectedArea={selectedArea}
        onAreaChange={val => {
          setSelectedArea(val);
          setCurrentPage(1);
        }}
        areaOptions={areaOptions}
        selectedContractor={selectedContractor}
        onContractorChange={val => {
          setSelectedContractor(val);
          setCurrentPage(1);
        }}
        contractorOptions={contractorOptions}
        selectedAgentStatus={selectedAgentStatus}
        onAgentStatusChange={val => {
          setSelectedAgentStatus(val);
          setCurrentPage(1);
        }}
        selectedInstallerStatus={selectedInstallerStatus}
        onInstallerStatusChange={val => {
          setSelectedInstallerStatus(val);
          setCurrentPage(1);
        }}
        selectedWhatsAppStatus={selectedWhatsAppStatus}
        onWhatsAppStatusChange={val => {
          setSelectedWhatsAppStatus(val);
          setCurrentPage(1);
        }}
        selectedApprovalStatus={selectedApprovalStatus}
        onApprovalStatusChange={val => {
          setSelectedApprovalStatus(val);
          setCurrentPage(1);
        }}
        approvalCounts={approvalCounts}
        selectedCategory={selectedCategory}
        onCategoryChange={val => {
          setSelectedCategory(val);
          setCurrentPage(1);
        }}
        ticketCategories={ticketCategories}
        onResetAll={resetAllFilters}
      />

      {/* Dispatch-Exclusive Mobile Floating Action Button (+ Form Sameday) */}
      {isCompactUI && currentUser.role === 'dispatch' && (
        <button
          type="button"
          onClick={() => onNavigate('form_sameday')}
          className="btn-3d-primary fixed bottom-20 right-4 z-30 h-12 px-4 rounded-2xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Form Sameday</span>
        </button>
      )}
    </div>
  );
};
