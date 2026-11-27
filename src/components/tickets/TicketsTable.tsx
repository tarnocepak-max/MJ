import React, { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { Ticket, DispatchApprovalWoAgentStatus } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
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
import { isContractorScopeMatchClient } from '../../services/assignmentClientHelpers';
import { WorkOrderFilterSheet } from './WorkOrderFilterSheet';
import {
  Download,
  Eye,
  MessageSquare,
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
  ArrowRight,
  FileSpreadsheet,
  Loader2
} from 'lucide-react';
import { useAnimation } from '../../context/AnimationContext';
import { useToast } from '../../context/ToastContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { PaginationBar } from '../common/PaginationBar';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import {
  getJakartaDateString,
  getTicketAppointmentDate
} from '../../services/appointmentDateParser';
import {
  formatIndonesianWODate,
  executeSuperadminDispatchSearch
} from '../../services/woDateFilterEngine';
import { getNextSortDirection, sortDataArray, SortDirection } from '../../utils/tableSorting';
import { LoadingSkeleton } from '../common/LoadingSkeleton';
import {
  HeaderCategoryDropdown,
  HeaderDateSortFilterPopover,
  HeaderSearchPopover,
  HeaderSortButton,
  TableResetFilterButton
} from '../common/InteractiveTableHeader';
import { TableSelectionToolbar } from '../common/TableSelectionToolbar';
import { ActionDropdownMenu, DropdownActionItem } from '../common/ActionDropdownMenu';

const PRIORITY_1_CANONICAL_KEYS = new Set([
  'woNumber',
  'idCustomer',
  'customerName',
  'appointmentDate',
  'contactorName',
  'contractorName',
  'statusWOAgent',
  'statusWOInstaller',
  'statusWhatsApp',
  'approvalStatus',
  'slotTime'
]);

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
      return undefined;
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
    users,
    bulkAssignPersonnel,
    approveProgressReport,
    rejectProgressReport,
    updateTicket,
    contractorsList,
    getTicketUnreadCount,
    totalLiveChatUnreadCount,
    todayWIB,
    refreshActiveTickets,
    activeKpiDrilldown,
    setActiveKpiDrilldown,
    activeImportBatchFilter,
    setActiveImportBatchFilter,
    importBatchTickets,
    isLoadingImportBatchTickets,
    clearAllWoDrilldowns,
    databaseStatus,
    syncStatus,
    isDataLoading,
    isProgressiveHydrating,
    auditLogs
  } = useApp();
  const { config, isMobileView } = useUIConfig();
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

  // Column Search & Filter state (embedded in table headers)
  const [searchTerm, setSearchTerm] = useState('');
  const [woSearch, setWoSearch] = useState('');
  const [idCustSearch, setIdCustSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [installerSearch, setInstallerSearch] = useState('');
  const [exactAppointmentDate, setExactAppointmentDate] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedArea, setSelectedArea] = useState('ALL');
  const [selectedContractor, setSelectedContractor] = useState('ALL');
  const [selectedAgentStatus, setSelectedAgentStatus] = useState('ALL');
  const [selectedInstallerStatus, setSelectedInstallerStatus] = useState('ALL');
  const [selectedWhatsAppStatus, setSelectedWhatsAppStatus] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedApprovalStatus, setSelectedApprovalStatus] = useState('ALL');

  // Clear conflicting local filters whenever Dashboard KPI drilldown or Import Batch filter activates
  useEffect(() => {
    if (!activeKpiDrilldown && !activeImportBatchFilter) return;
    setSearchTerm('');
    setWoSearch('');
    setIdCustSearch('');
    setCustomerSearch('');
    setInstallerSearch('');
    setExactAppointmentDate('');
    setDateFrom('');
    setDateTo('');
    setSelectedAgentStatus('ALL');
    setSelectedInstallerStatus('ALL');
    setSelectedWhatsAppStatus('ALL');
    setSelectedCategory('ALL');
    setSelectedApprovalStatus('ALL');
    setSelectedArea(
      activeKpiDrilldown?.area && activeKpiDrilldown.area !== 'ALL' ? activeKpiDrilldown.area : 'ALL'
    );
    setSelectedContractor(
      activeKpiDrilldown?.contractor && activeKpiDrilldown.contractor !== 'ALL'
        ? activeKpiDrilldown.contractor
        : 'ALL'
    );
    setCurrentPage(1);
  }, [activeKpiDrilldown, activeImportBatchFilter]);

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
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);

  const scopedInstallers = useMemo(() => {
    const activeInstallers = (users || []).filter(
      u =>
        String(u.role || '').trim().toLowerCase() === 'installer' &&
        u.active !== false &&
        !u.isDeleted &&
        !u.isArchived
    );
    if (currentUser.role !== 'leader') return activeInstallers;
    if (!currentUser.contractorId && !currentUser.contractor) return activeInstallers;
    return activeInstallers.filter(u =>
      isContractorScopeMatchClient(
        currentUser.contractorId,
        currentUser.contractor,
        u.contractorId,
        u.contractor
      )
    );
  }, [users, currentUser.role, currentUser.contractorId, currentUser.contractor]);

  useEffect(() => {
    setPageSize(config.ticketsTable.rowsPerPage || 10);
  }, [config.ticketsTable.rowsPerPage]);

  // Progressive secondary column hydration for 46-column canonical mode (Priority 1 renders first, rest on next frame)
  const [hydrateSecondaryColumns, setHydrateSecondaryColumns] = useState(false);
  useEffect(() => {
    if (tableStyleMode !== 'canonical') {
      setHydrateSecondaryColumns(false);
      return;
    }
    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      if (!cancelled) setHydrateSecondaryColumns(true);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [tableStyleMode]);

  // Native-<table>-compatible Row Virtualization (> 25 rows / ALL)
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(620);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientHeight > 0) setTableViewportHeight(el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [effectiveLayout, tableStyleMode]);

  useEffect(() => {
    setTableScrollTop(0);
    if (tableScrollRef.current) {
      tableScrollRef.current.scrollTop = 0;
    }
  }, [currentPage, pageSize, tableStyleMode]);

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

  const effectiveCrossDateQuery = searchTerm.trim() || woSearch.trim() || idCustSearch.trim();

  const crossDateSearchResults = useMemo(() => {
    if (isCrossDateSearchEligible && effectiveCrossDateQuery) {
      return executeSuperadminDispatchSearch(effectiveCrossDateQuery, tickets);
    }
    return { isSearchActive: false, results: [], resultTickets: [], crossDateCount: 0 };
  }, [isCrossDateSearchEligible, effectiveCrossDateQuery, tickets]);

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
      if (woSearch.trim()) {
        if (!String(t.woNumber || '').toLowerCase().includes(woSearch.trim().toLowerCase())) {
          return false;
        }
      }
      if (idCustSearch.trim()) {
        const cid = String(t.idCustomer || t.customerId || '').toLowerCase();
        if (!cid.includes(idCustSearch.trim().toLowerCase())) return false;
      }
      if (customerSearch.trim()) {
        const qC = customerSearch.trim().toLowerCase();
        const cName = String(t.customerName || '').toLowerCase();
        const cPhone = String(t.customerPhone || (t as any).phoneNumber || '').toLowerCase();
        const cAddr = String(t.streetName || (t as any).customerAddress || '').toLowerCase();
        if (!cName.includes(qC) && !cPhone.includes(qC) && !cAddr.includes(qC)) return false;
      }
      if (installerSearch.trim()) {
        const qI = installerSearch.trim().toLowerCase();
        const iName = String(t.installerName || '').toLowerCase();
        const lName = String(t.leaderName || '').toLowerCase();
        if (!iName.includes(qI) && !lName.includes(qI)) return false;
      }
      if (exactAppointmentDate || dateFrom || dateTo) {
        const woDateNorm = getTicketAppointmentDate(t) || '';
        if (!woDateNorm) return false;
        if (exactAppointmentDate && woDateNorm !== exactAppointmentDate) return false;
        if (dateFrom && woDateNorm < dateFrom) return false;
        if (dateTo && woDateNorm > dateTo) return false;
      }
      return true;
    };

    const matchesQuickSearch = (t: Ticket) => {
      if (!(searchTerm && typeof searchTerm === 'string' && searchTerm.trim())) return true;
      const q = searchTerm.trim().toLowerCase();
      const matchWo = (t.woNumber ? String(t.woNumber).toLowerCase() : '').includes(q);
      const matchCust = (t.customerName ? String(t.customerName).toLowerCase() : '').includes(q);
      const matchId = (t.idCustomer ? String(t.idCustomer).toLowerCase() : '').includes(q);
      const matchPhone = String(t.customerPhone || '').includes(q);
      const matchInstaller = (t.installerName ? String(t.installerName).toLowerCase() : '').includes(q);
      const matchCluster = (t.clusterName ? String(t.clusterName).toLowerCase() : '').includes(q);
      const matchCategory = (t.ticketCategory ? String(t.ticketCategory).toLowerCase() : '').includes(q);
      return (
        matchWo ||
        matchCust ||
        matchId ||
        matchPhone ||
        matchInstaller ||
        matchCluster ||
        matchCategory
      );
    };

    if (activeImportBatchFilter) {
      return (importBatchTickets || []).filter(t => {
        if (!t || t.isDeleted || t.isArchived) return false;
        if (!matchesFilterDropdowns(t)) return false;
        return matchesQuickSearch(t);
      });
    }

    if (isCrossDateActive) {
      return crossDateSearchResults.resultTickets.filter(t => {
        if (!t || t.isDeleted || t.isArchived) return false;
        return matchesFilterDropdowns(t);
      });
    }

    return (tickets || []).filter(t => {
      if (!t || t.isDeleted || t.isArchived) return false;

      const woDate = getTicketAppointmentDate(t);
      if (!(exactAppointmentDate || dateFrom || dateTo)) {
        if (!woDate || woDate !== todayStr) return false;
      } else if (!woDate) {
        return false;
      }

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
        if (activeKpiDrilldown.installerName && activeKpiDrilldown.installerName !== 'ALL') {
          const tInst = String(t.installerName || '').trim().toLowerCase();
          const targetInst = activeKpiDrilldown.installerName.trim().toLowerCase();
          if (!tInst || (!tInst.includes(targetInst) && !targetInst.includes(tInst))) return false;
        }
        if (!matchesKpiFilter(t, activeKpiDrilldown.filterKey)) return false;
      }

      return matchesQuickSearch(t);
    });
  }, [
    tickets,
    importBatchTickets,
    activeImportBatchFilter,
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
    woSearch,
    idCustSearch,
    customerSearch,
    installerSearch,
    exactAppointmentDate,
    dateFrom,
    dateTo,
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
        if (col === 'date' || col === 'appointmentDate') return getTicketAppointmentDate(item) || item.appointmentDate || '';
        if (col === 'statusWOInstaller') return item.statusWOInstaller;
        if (col === 'statusWOAgent') return item.statusWOAgent;
        if (col === 'slotTime') return item.slotTime;
        return getTicketColumnValue(item, col);
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

  const renderedCanonicalColumns = useMemo(() => {
    if (tableStyleMode !== 'canonical' || hydrateSecondaryColumns) {
      return activeColumns;
    }
    const prioritySubset = activeColumns.filter(col => PRIORITY_1_CANONICAL_KEYS.has(col.key));
    return prioritySubset.length >= 3 ? prioritySubset : activeColumns;
  }, [activeColumns, hydrateSecondaryColumns, tableStyleMode]);

  const omittedEmptyCount = rawVisibleColumns.length - activeColumns.length;

  const stickyColumnsEnabled = config.device?.pc?.stickyColumns !== false;
  const freezeColumnCount = Math.max(1, Math.min(4, config.ticketsTable.freezeColumnCount ?? 4));

  // Cumulative sticky-left pixel positions for frozen data columns (after 44px bulk checkbox + 40px expand column)
  const stickyLeftMap = useMemo(() => {
    const map: Record<string, { left: number; isLastFrozen: boolean }> = {};
    if (!stickyColumnsEnabled) return map;
    const freezeDataColsCount = Math.min(Math.max(0, freezeColumnCount - 1), renderedCanonicalColumns.length);
    let accLeft = 84;
    for (let i = 0; i < freezeDataColsCount; i++) {
      const col = renderedCanonicalColumns[i];
      const w = col.width || 130;
      map[col.key] = {
        left: accLeft,
        isLastFrozen: i === freezeDataColsCount - 1
      };
      accLeft += w;
    }
    return map;
  }, [renderedCanonicalColumns, freezeColumnCount, stickyColumnsEnabled]);

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

  const handleApplyBulkAssign = async () => {
    if (isBulkAssigning) return;
    if (currentUser.role !== 'leader') {
      toast.error('Akses Ditolak: Hanya Leader yang berwenang menugaskan WO ke teknisi.');
      return;
    }
    if (!bulkInstaller) {
      toast.error('Pilih teknisi terlebih dahulu.');
      return;
    }
    const targetInst = scopedInstallers.find(
      u => u.id === bulkInstaller || u.name === bulkInstaller
    );
    if (!targetInst || !targetInst.id) {
      toast.error('Akun teknisi aktif tidak ditemukan atau tidak memiliki ID akun valid.');
      return;
    }
    setIsBulkAssigning(true);
    try {
      const res = await bulkAssignPersonnel(
        Array.from(selectedIds),
        currentUser.name,
        targetInst.name,
        undefined,
        undefined,
        targetInst.id
      );
      if (res.success) {
        setSelectedIds(new Set());
        setBulkInstaller('');
      }
    } finally {
      setIsBulkAssigning(false);
    }
  };

  const handleTriggerBulkApprove = () => {
    if (!canApproveInline) {
      toast.error('Akses Ditolak: Hanya Dispatch atau Super Admin yang berwenang melakukan approval.');
      return;
    }
    if (selectedButuhApprovalTickets.length === 0) {
      // Only select matching candidates on the current active page (never across other pages)
      const candidates = paginatedTickets.filter(t => t.approvalStatus === 'BUTUH APPROVAL');
      if (candidates.length === 0) {
        toast.info('Tidak ada Work Order berstatus BUTUH APPROVAL pada halaman aktif.');
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

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (activeKpiDrilldown) count++;
    if (selectedArea !== 'ALL') count++;
    if (selectedContractor !== 'ALL') count++;
    if (selectedCategory !== 'ALL') count++;
    if (selectedInstallerStatus !== 'ALL') count++;
    if (selectedApprovalStatus !== 'ALL') count++;
    if (selectedAgentStatus !== 'ALL') count++;
    if (selectedWhatsAppStatus !== 'ALL') count++;
    if (searchTerm.trim()) count++;
    if (woSearch.trim()) count++;
    if (idCustSearch.trim()) count++;
    if (customerSearch.trim()) count++;
    if (installerSearch.trim()) count++;
    if (exactAppointmentDate || dateFrom || dateTo) count++;
    return count;
  }, [
    activeKpiDrilldown,
    selectedArea,
    selectedContractor,
    selectedCategory,
    selectedInstallerStatus,
    selectedApprovalStatus,
    selectedAgentStatus,
    selectedWhatsAppStatus,
    searchTerm,
    woSearch,
    idCustSearch,
    customerSearch,
    installerSearch,
    exactAppointmentDate,
    dateFrom,
    dateTo
  ]);

  const hasActiveFilters = activeFilterCount > 0;

  const resetAllFilters = () => {
    setActiveKpiDrilldown(null);
    setSearchTerm('');
    setWoSearch('');
    setIdCustSearch('');
    setCustomerSearch('');
    setInstallerSearch('');
    setExactAppointmentDate('');
    setDateFrom('');
    setDateTo('');
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
  const stitchColSpan = 10;
  const canonicalColSpan = renderedCanonicalColumns.length + 3;

  const shouldVirtualizeRows =
    effectiveLayout === 'table' && paginatedTickets.length > 25 && !expandedDrawerTicketId;
  const estimatedRowHeight = tableStyleMode === 'stitch' ? 76 : 48;
  const virtualRange = useMemo(() => {
    if (!shouldVirtualizeRows) {
      return {
        startIndex: 0,
        endIndex: paginatedTickets.length,
        topSpacerPx: 0,
        bottomSpacerPx: 0
      };
    }
    const overscan = 8;
    const rawStart = Math.floor(tableScrollTop / estimatedRowHeight);
    const visibleCount = Math.max(8, Math.ceil(tableViewportHeight / estimatedRowHeight));
    const startIndex = Math.max(0, rawStart - overscan);
    const endIndex = Math.min(paginatedTickets.length, rawStart + visibleCount + overscan);
    return {
      startIndex,
      endIndex,
      topSpacerPx: startIndex * estimatedRowHeight,
      bottomSpacerPx: Math.max(0, (paginatedTickets.length - endIndex) * estimatedRowHeight)
    };
  }, [shouldVirtualizeRows, paginatedTickets.length, tableScrollTop, tableViewportHeight, estimatedRowHeight]);

  const virtualizedTickets = useMemo(() => {
    if (!shouldVirtualizeRows) return paginatedTickets;
    return paginatedTickets.slice(virtualRange.startIndex, virtualRange.endIndex);
  }, [shouldVirtualizeRows, paginatedTickets, virtualRange.startIndex, virtualRange.endIndex]);

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

    const fullAddr =
      ticket.streetName || (ticket as any).customerAddress || (ticket as any).address || '-';
    const phoneStr = ticket.customerPhone || (ticket as any).phoneNumber || '';
    const apptDateDisplay = formatIndonesianWODate(getTicketAppointmentDate(ticket) || todayWIB);
    const isVerificationMode =
      ticket.approvalStatus === 'BUTUH APPROVAL' ||
      Boolean(ticket.technicalReport) ||
      Boolean(ticket.progressReports && ticket.progressReports.length > 0);

    return (
      <tr className="bg-[#EDF3F8] dark:bg-[#251247]/80 border-b border-[#DDE6F0] dark:border-[#5B35B1]">
        <td colSpan={colSpan} className="p-3 sm:p-4 border-y border-[#DCE3F2] dark:border-[#5B35B1]">
          <div className="animate-in fade-in slide-in-from-top-1 duration-200 card-3d-lavender rounded-xl p-4 shadow-md border border-[#DCE3F2] dark:border-[#5B35B1] space-y-3.5">
            {/* Drawer Header with 3D Tactile CTA Buttons */}
            <div className="flex flex-wrap items-center justify-between pb-3 gap-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[#FFF2D9] dark:bg-[#E59A27]/20 border border-[#F2CF95] dark:border-[#E59A27]/40 text-[#9D661F] dark:text-[#E59A27] flex items-center justify-center shrink-0 shadow-2xs">
                  {isVerificationMode ? <ShieldCheck className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-display text-sm sm:text-base font-bold text-[#26364A] dark:text-white">
                      {ticket.approvalStatus === 'BUTUH APPROVAL'
                        ? 'Verifikasi Hasil Pekerjaan Teknisi'
                        : `Detail Lengkap Work Order — ${ticket.customerName || ticket.woNumber}`}
                    </h4>
                    <StatusApprovalBadge status={ticket.approvalStatus} />
                  </div>
                  <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5 truncate">
                    <span className="font-mono font-semibold text-[#5145A6] dark:text-[#D8B4FE]">
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
                      className="px-2.5 py-1.5 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#5B35B1] text-[11px] font-bold text-[#26364A] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
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
                  onClick={() => onSelectTicket(ticket, isVerificationMode ? 'report' : 'overview')}
                  className="btn-3d-ceramic inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-[#26364A] dark:text-[#E9D5FF] cursor-pointer whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE]" />
                  <span>Buka Detail Penuh</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleInlineDrawer(ticket)}
                  className="btn-3d-icon w-8 h-8 cursor-pointer"
                  title="Collapse Detail"
                  aria-label="Collapse Detail"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Inline Reject Input Bar */}
            {showInlineRejectBox && canApproveInline && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-lg bg-[#FCE9EB] dark:bg-rose-950/30 border border-[#F3C5CA] dark:border-rose-800">
                <input
                  type="text"
                  value={inlineRejectReason}
                  onChange={e => setInlineRejectReason(e.target.value)}
                  placeholder="Wajib isi alasan penolakan / item yang harus direvisi teknisi (min. 3 karakter)..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#160D29] border border-[#F3C5CA] dark:border-rose-800 text-[#26364A] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#D45B66] dark:focus:ring-[#DC4C5A]"
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

            {/* Complete Customer, Schedule, Address & Assignment Overview Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg border border-[#DDE6F0] dark:border-[#35105E] space-y-1">
                <span className="text-[10.5px] font-bold uppercase text-[#8492A5] dark:text-[#8B8495] block">
                  Pelanggan &amp; Kontak
                </span>
                <div className="font-bold text-[#26364A] dark:text-white truncate">
                  {ticket.customerName || '-'}
                </div>
                <div className="font-mono text-[11px] text-[#5145A6] dark:text-[#D8B4FE]">
                  ID Cust: {ticket.idCustomer || '-'}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#52647A] dark:text-[#CEC0E8] font-mono">
                  <span>{phoneStr || 'Tanpa nomor HP'}</span>
                  {phoneStr && (
                    <button
                      type="button"
                      onClick={() => onOpenWhatsApp(ticket)}
                      className="text-[#218A63] dark:text-emerald-300 font-sans font-bold hover:underline cursor-pointer"
                    >
                      WhatsApp
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg border border-[#DDE6F0] dark:border-[#35105E] space-y-1">
                <span className="text-[10.5px] font-bold uppercase text-[#8492A5] dark:text-[#8B8495] block">
                  Lokasi &amp; Node FTTH
                </span>
                <div className="font-semibold text-[#26364A] dark:text-white">
                  {ticket.area || '-'} {ticket.clusterName ? `· ${ticket.clusterName}` : ''}
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] line-clamp-2">
                  {fullAddr}
                </div>
                <button
                  type="button"
                  onClick={() => openCustomerAddressInGoogleMaps(ticket)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#5145A6] dark:text-[#D8B4FE] hover:underline cursor-pointer"
                >
                  <MapPin className="w-3 h-3" />
                  <span>Buka Google Maps</span>
                </button>
              </div>

              <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg border border-[#DDE6F0] dark:border-[#35105E] space-y-1">
                <span className="text-[10.5px] font-bold uppercase text-[#8492A5] dark:text-[#8B8495] block">
                  Jadwal &amp; Tim Operasional
                </span>
                <div className="font-semibold text-[#26364A] dark:text-white tabular-nums">
                  {apptDateDisplay} · {ticket.slotTime || '-'}
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                  Kontraktor: {ticket.contactorName || ticket.contractorName || '-'}
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                  Leader: {ticket.leaderName || ticket.corlapName || '-'} · Tech: {ticket.installerName || 'Unassigned'}
                </div>
              </div>

              <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg border border-[#DDE6F0] dark:border-[#35105E] space-y-1.5">
                <span className="text-[10.5px] font-bold uppercase text-[#8492A5] dark:text-[#8B8495] block">
                  Status Workflow &amp; Kategori
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <StatusAgentBadge status={ticket.statusWOAgent} />
                  <StatusInstallerBadge status={ticket.statusWOInstaller} />
                  <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                  {ticket.ticketCategory || ticket.appointmentType || 'FTTH'} {ticket.plan ? `· ${ticket.plan}` : ''}
                </div>
              </div>
            </div>

            {/* 4-Card Telemetry & Optical Specifications Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg border border-[#DDE6F0] dark:border-[#35105E]">
                <span className="text-[11px] font-bold uppercase text-[#8492A5] dark:text-[#8B8495] block">
                  Redaman OPM (dBm)
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span
                    className={`font-display text-xl font-bold tabular-nums ${
                      opDbmNum === null
                        ? 'text-[#52647A] dark:text-[#CEC0E8]'
                        : opInSpec
                        ? 'text-[#218A63] dark:text-[#16A36A]'
                        : 'text-[#D45B66] dark:text-[#DC4C5A]'
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
                        opInSpec ? 'text-[#218A63] dark:text-[#16A36A]' : 'text-[#D45B66] dark:text-[#DC4C5A]'
                      }`}
                    >
                      {opInSpec ? 'PASS (< -24 dBm)' : 'OUT OF SPEC'}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[#8492A5] dark:text-[#8B8495] mt-0.5 block">
                  Diukur pada port ONT {ticket.oltCode ? `• OLT ${ticket.oltCode}` : ''}
                </span>
              </div>

              <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg border border-[#DDE6F0] dark:border-[#35105E]">
                <span className="text-[11px] font-bold uppercase text-[#8492A5] dark:text-[#8B8495] block">
                  Nomor Seri ONT / Modem
                </span>
                <span className="font-mono text-xs font-bold text-[#26364A] dark:text-white block mt-1 truncate">
                  {ontSn || 'Belum diinput'}
                </span>
                <span className="text-[11px] text-[#218A63] dark:text-[#16A36A] font-medium flex items-center gap-1 mt-1 truncate">
                  <Check className="w-3 h-3 shrink-0" />
                  <span>
                    {ticket.oltRegistrationStatus ||
                      (ticket.oltCode ? `OLT: ${ticket.oltCode}` : `Model: ${ticket.ontModel || '-'}`)}
                  </span>
                </span>
              </div>

              <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg border border-[#DDE6F0] dark:border-[#35105E]">
                <span className="text-[11px] font-bold uppercase text-[#8492A5] dark:text-[#8B8495] block">
                  Panjang Dropcore Digunakan
                </span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="font-display text-lg font-bold text-[#26364A] dark:text-white tabular-nums">
                    {dropcoreVal !== undefined && dropcoreVal !== null && String(dropcoreVal).trim() !== ''
                      ? String(dropcoreVal)
                      : '-'}
                  </span>
                  {dropcoreVal && (
                    <span className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                      {String(dropcoreVal).toLowerCase().includes('m') ? '' : 'Meter'}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[#8492A5] dark:text-[#8B8495] mt-0.5 block truncate font-mono">
                  FAT: {ticket.fatCode || ticket.fat || '-'} | Port: {ticket.fatPort || '-'}
                </span>
              </div>

              <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg border border-[#DDE6F0] dark:border-[#35105E]">
                <span className="text-[11px] font-bold uppercase text-[#8492A5] dark:text-[#8B8495] block">
                  Status Check-In Teknisi
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold shadow-2xs ${
                      ticket.checkInAt
                        ? 'bg-[#5145A6] dark:bg-[#35105E] text-white'
                        : 'bg-[#EDF3F8] dark:bg-[#35105E]/50 text-[#52647A] dark:text-[#CEC0E8]'
                    }`}
                  >
                    {ticket.checkInAt ? 'SUDAH CHECK-IN' : 'BELUM CHECK-IN'}
                  </span>
                  <span className="font-mono text-xs font-bold text-[#26364A] dark:text-white tabular-nums">
                    {ticket.checkInAt ? formatTimeOnlyWIB(ticket.checkInAt) : '-'}
                  </span>
                </div>
                <span className="text-[11px] text-[#8492A5] dark:text-[#8B8495] mt-0.5 block truncate">
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
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#D8B4FE] flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#7135B5]" />
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
                        className="rounded-lg overflow-hidden bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] shadow-2xs text-left group cursor-pointer"
                      >
                        <div className="h-24 w-full bg-[#EDF3F8] dark:bg-[#22123F] relative flex items-center justify-center overflow-hidden">
                          <ImageIcon className="w-5 h-5 text-[#8492A5] dark:text-[#8B8495] opacity-50" />
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
                          <span className="text-[10.5px] font-bold text-[#26364A] dark:text-white block truncate">
                            Foto Dokumentasi #{idx + 1}
                          </span>
                          <span className="font-mono text-[9.5px] text-[#218A63] dark:text-[#16A36A] font-semibold block truncate">
                            Klik untuk perbesar
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-5 px-4 text-center rounded-lg border border-dashed border-[#DCE3F2] dark:border-[#35105E] bg-[#F8FAFD] dark:bg-[#160D29]/50 text-xs text-[#8492A5] dark:text-[#8B8495]">
                    Belum ada foto bukti dokumentasi yang diunggah pada Technical Report.
                  </div>
                )}
              </div>

              <div className="lg:col-span-4 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Ringkasan Laporan Lapangan</span>
                </div>
                {latestReport ? (
                  <div className="space-y-1 text-xs">
                    <div className="font-semibold text-[#26364A] dark:text-white">
                      {latestReport.reportStatusLabel || latestReport.reportStatus} &rarr;{' '}
                      {latestReport.reasonReportLabel || latestReport.reasonReport}
                    </div>
                    {latestReport.remarksReport && (
                      <p className="p-2 rounded bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#CEC0E8] text-[11px]">
                        {latestReport.remarksReport}
                      </p>
                    )}
                  </div>
                ) : ticket.technicalReport ? (
                  <div className="space-y-1 text-xs">
                    <div className="font-semibold text-[#26364A] dark:text-white">
                      {ticket.technicalReport.workResult}
                    </div>
                    <p className="text-[#52647A] dark:text-[#CEC0E8] text-[11px]">
                      {ticket.technicalReport.technicalDescription || '-'}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[#8492A5] dark:text-[#8B8495] italic">
                    Belum ada laporan progress tersubmit dari teknisi.
                  </p>
                )}
              </div>
            </div>

            {/* Dispatch Operator Note Input with Tactile Save Button */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
              <div className="flex items-center gap-2 flex-1">
                <MessageSquare className="w-4 h-4 text-[#8492A5] dark:text-[#8B8495] shrink-0" />
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
                  className="flex-1 px-3 py-1.5 bg-[#F8FAFD] dark:bg-[#160D29] rounded-lg text-xs text-[#26364A] dark:text-white placeholder:text-[#8492A5] dark:placeholder:text-[#8B8495] border border-[#DDE6F0] dark:border-[#35105E] focus:outline-none focus:bg-white dark:focus:bg-[#22123F] focus:ring-1 focus:ring-[#6657C8] dark:focus:ring-[#A78BFA] disabled:opacity-70"
                />
              </div>
              {canApproveInline && (
                <button
                  type="button"
                  disabled={savingNoteId === ticket.id}
                  onClick={() => handleSaveInlineNote(ticket)}
                  className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-[#26364A] dark:text-[#E9D5FF] text-[11px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
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
      {activeImportBatchFilter && (
        <div
          data-testid="import-batch-context-banner"
          className="rounded-xl bg-gradient-to-r from-emerald-50/95 via-white/95 to-[#DDF4F4]/95 dark:bg-none dark:bg-[#160D29] text-[#26364A] dark:text-white px-4 py-3 border border-emerald-300 dark:border-emerald-700/60 shadow-sm flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-600 dark:bg-emerald-700 text-white font-bold text-[10.5px]">
              <FileSpreadsheet className="w-3 h-3" />
              <span>Hasil Batch Import Excel</span>
            </span>
            <span className="font-bold truncate max-w-[260px]" title={activeImportBatchFilter.sourceFile}>
              {activeImportBatchFilter.sourceFile}
            </span>
            <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-white/10 text-[#5145A6] dark:text-purple-200 font-mono text-[10.5px] font-bold">
              {activeImportBatchFilter.jobId}
            </span>
            {isLoadingImportBatchTickets ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[#5145A6] dark:text-[#DAB9FF] font-semibold">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Memuat WO batch dari database...</span>
              </span>
            ) : (
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                ({filteredTickets.length} dari {importBatchTickets.length} WO tampil · lintas tanggal)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              clearAllWoDrilldowns();
              setCurrentPage(1);
            }}
            className="btn-3d-ceramic inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Kembali ke Database WO</span>
          </button>
        </div>
      )}

      {activeKpiDrilldown && (
        <div
          data-testid="kpi-drilldown-banner"
          className="rounded-xl bg-gradient-to-r from-[#DDF4F4]/95 via-white/95 to-[#EAE8FF]/95 dark:bg-none dark:bg-[#160D29] text-[#26364A] dark:text-white px-4 py-3 border border-[#BDE4E8] dark:border-[#3E246F] shadow-sm flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-[#6657C8] dark:bg-[#7135B5] text-white font-bold text-[10.5px]">
              Filter KPI Dashboard
            </span>
            <span className="font-bold">
              {KPI_FILTER_LABELS[activeKpiDrilldown.filterKey] || activeKpiDrilldown.filterKey}
            </span>
            {activeKpiDrilldown.contractor && activeKpiDrilldown.contractor !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-white/10 text-[#5145A6] dark:text-purple-200 font-medium">
                Vendor: {activeKpiDrilldown.contractor}
              </span>
            )}
            {activeKpiDrilldown.area && activeKpiDrilldown.area !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-white/10 text-[#5145A6] dark:text-purple-200 font-medium">
                Area: {activeKpiDrilldown.area}
              </span>
            )}
            {activeKpiDrilldown.installerName && activeKpiDrilldown.installerName !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-white/10 text-[#5145A6] dark:text-purple-200 font-medium">
                Teknisi: {activeKpiDrilldown.installerName}
              </span>
            )}
            <span className="font-mono font-bold text-[#5145A6] dark:text-[#E9D5FF] tabular-nums">
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

      {/* 0. COMPACT WORK ORDER DISPATCH & TRIAGE BAR */}
      <section className="card-3d-lavender rounded-2xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base sm:text-lg font-extrabold text-[#26364A] dark:text-white tracking-tight">
            Work Order Dispatch &amp; Triage Control
          </h2>
          <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
            FTTH Provisioning, Verifikasi Dispatch &amp; Penugasan Mitra · WIB {todayWIB}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {currentUser.role === 'super_admin' ? (
            <button
              type="button"
              onClick={() => onNavigate('import')}
              className="btn-3d-darkpurple px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <CloudDownload className="w-4 h-4 text-[#DDF4F4] dark:text-[#DAB9FF]" />
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
              <MessageCircle className="w-4 h-4 text-[#DDF4F4] dark:text-[#DAB9FF]" />
              <span>Contact Centre</span>
            </button>
          )}
        </div>
      </section>

      {/* 1. TOP KPI & OPERATIONAL PULSE STRIP (5 Filter KPI Cards) */}
      <section
        className={`grid gap-3 items-stretch ${
          isMobileView ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'
        }`}
      >
        {/* KPI 1: Total Hari Ini */}
        <button
          type="button"
          onClick={() => {
            clearAllWoDrilldowns();
            setSelectedApprovalStatus('ALL');
            setSelectedInstallerStatus('ALL');
            setCurrentPage(1);
          }}
          className={`bg-white/95 dark:bg-[#1E1238] rounded-xl p-3 shadow-xs text-left flex flex-col justify-between border transition-colors cursor-pointer ${
            selectedApprovalStatus === 'ALL' && selectedInstallerStatus === 'ALL'
              ? 'border-[#6657C8] dark:border-[#A78BFA] ring-1 ring-[#6657C8]/30 dark:ring-[#A78BFA]/40'
              : 'border-[#DDE6F0] dark:border-[#35105E] hover:border-[#6657C8]/50 dark:hover:border-[#A78BFA]/60'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wide">
              Total Hari Ini
            </span>
            <TicketIcon className="w-4 h-4 text-[#6657C8] dark:text-[#A78BFA] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#26364A] dark:text-white tracking-tight tabular-nums">
              {approvalCounts.totalToday}
            </span>
            <span className="text-xs text-[#218A63] dark:text-[#16A36A] font-semibold tabular-nums">
              {filteredTickets.length} tampil
            </span>
          </div>
          <div className="text-[10px] font-semibold text-[#8492A5] dark:text-[#8B8495] mt-1 truncate">
            todayWIB: {formattedAppointmentChip}
          </div>
        </button>

        {/* KPI 2: Butuh Approval (Urgent Highlight) */}
        <button
          type="button"
          onClick={() => {
            clearAllWoDrilldowns();
            setSelectedInstallerStatus('ALL');
            setSelectedApprovalStatus(prev => (prev === 'BUTUH APPROVAL' ? 'ALL' : 'BUTUH APPROVAL'));
            setCurrentPage(1);
          }}
          className={`bg-gradient-to-br from-[#EAE8FF]/95 to-[#F8FAFD]/95 dark:bg-none dark:bg-[#2E1459] rounded-xl p-3 shadow-xs text-left flex flex-col justify-between relative overflow-hidden border transition-all cursor-pointer ${
            selectedApprovalStatus === 'BUTUH APPROVAL'
              ? 'border-[#6657C8] dark:border-[#7135B5] ring-2 ring-[#6657C8]/30 dark:ring-[#7135B5]/35'
              : 'border-[#F2CF95] dark:border-[#E59A27]/35 hover:border-[#C88735] dark:hover:border-[#E59A27]'
          }`}
        >
          <div className="absolute -right-2 -top-2 w-12 h-12 bg-[#C88735]/15 dark:bg-[#E59A27]/15 rounded-full pointer-events-none blur-sm" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#5145A6] dark:text-[#E9D5FF] uppercase font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C88735] dark:bg-[#E59A27] animate-ping shrink-0" />
              <span className="truncate">Butuh Approval</span>
            </span>
            <Clock className="w-4 h-4 text-[#C88735] dark:text-[#E59A27] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-extrabold text-[#26364A] dark:text-white tracking-tight tabular-nums">
              {approvalCounts.butuhApproval}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shadow-2xs whitespace-nowrap ${
                approvalCounts.butuhApproval > 0
                  ? 'bg-[#C88735] dark:bg-[#E59A27] text-white animate-pulse'
                  : 'bg-[#E4F5EC] dark:bg-[#16A36A]/15 text-[#218A63] dark:text-[#16A36A]'
              }`}
            >
              {approvalCounts.butuhApproval > 0 ? 'Action Required' : 'Clear'}
            </span>
          </div>
          <div className="text-[10px] text-[#5145A6] dark:text-[#D8B4FE] font-medium mt-1 truncate">
            SLO Dispatch: &lt; 15 mnt
          </div>
        </button>

        {/* KPI 3: Disetujui */}
        <button
          type="button"
          onClick={() => {
            clearAllWoDrilldowns();
            setSelectedInstallerStatus('ALL');
            setSelectedApprovalStatus(prev => (prev === 'APPROVED' ? 'ALL' : 'APPROVED'));
            setCurrentPage(1);
          }}
          className={`bg-white/95 dark:bg-[#1E1238] rounded-xl p-3 shadow-xs text-left flex flex-col justify-between border transition-colors cursor-pointer ${
            selectedApprovalStatus === 'APPROVED'
              ? 'border-[#218A63] dark:border-[#16A36A] ring-2 ring-[#218A63]/25 dark:ring-[#16A36A]/30'
              : 'border-[#DDE6F0] dark:border-[#35105E] hover:border-[#218A63]/50 dark:hover:border-[#16A36A]/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wide">
              Disetujui
            </span>
            <BadgeCheck className="w-4 h-4 text-[#218A63] dark:text-[#16A36A] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#218A63] dark:text-[#16A36A] tracking-tight tabular-nums">
              {approvalCounts.approved}
            </span>
            <span className="font-mono text-xs font-semibold text-[#52647A] dark:text-[#CEC0E8] tabular-nums">
              {approvedPct}%
            </span>
          </div>
          <div className="text-[10px] text-[#8492A5] dark:text-[#8B8495] mt-1 truncate">Siap Berita Acara</div>
        </button>

        {/* KPI 4: Perlu Revisi */}
        <button
          type="button"
          onClick={() => {
            clearAllWoDrilldowns();
            setSelectedInstallerStatus('ALL');
            setSelectedApprovalStatus(prev => (prev === 'REJECTED' ? 'ALL' : 'REJECTED'));
            setCurrentPage(1);
          }}
          className={`bg-white/95 dark:bg-[#1E1238] rounded-xl p-3 shadow-xs text-left flex flex-col justify-between border transition-colors cursor-pointer ${
            selectedApprovalStatus === 'REJECTED'
              ? 'border-[#D45B66] dark:border-[#DC4C5A] ring-2 ring-[#D45B66]/25 dark:ring-[#DC4C5A]/30'
              : 'border-[#DDE6F0] dark:border-[#35105E] hover:border-[#D45B66]/50 dark:hover:border-[#DC4C5A]/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wide">
              Perlu Revisi
            </span>
            <AlertTriangle className="w-4 h-4 text-[#D45B66] dark:text-[#DC4C5A] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#D45B66] dark:text-[#DC4C5A] tracking-tight tabular-nums">
              {approvalCounts.rejected}
            </span>
            <span className="font-mono text-[11px] text-[#D45B66] dark:text-[#DC4C5A] font-semibold truncate">
              Dropcore / Foto
            </span>
          </div>
          <div className="text-[10px] text-[#8492A5] dark:text-[#8B8495] mt-1 truncate">Menunggu Teknisi</div>
        </button>

        {/* KPI 5: Di Lapangan */}
        <button
          type="button"
          onClick={() => {
            clearAllWoDrilldowns();
            setSelectedApprovalStatus('ALL');
            setSelectedInstallerStatus(prev => (prev === 'On Site' ? 'ALL' : 'On Site'));
            setCurrentPage(1);
          }}
          className={`bg-white/95 dark:bg-[#1E1238] rounded-xl p-3 shadow-xs text-left flex flex-col justify-between border transition-colors cursor-pointer ${
            selectedInstallerStatus === 'On Site'
              ? 'border-[#3E81C6] dark:border-[#3977C9] ring-2 ring-[#3E81C6]/25 dark:ring-[#3977C9]/30'
              : 'border-[#DDE6F0] dark:border-[#35105E] hover:border-[#3E81C6]/50 dark:hover:border-[#3977C9]/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wide">
              Di Lapangan
            </span>
            <Wrench className="w-4 h-4 text-[#3E81C6] dark:text-[#3977C9] shrink-0" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#3E81C6] dark:text-[#3977C9] tracking-tight tabular-nums">
              {approvalCounts.diLapangan}
            </span>
            <span className="font-mono text-xs font-semibold text-[#52647A] dark:text-[#CEC0E8] tabular-nums">
              {fieldPct}%
            </span>
          </div>
          <div className="text-[10px] text-[#8492A5] dark:text-[#8B8495] mt-1 truncate">On-site &amp; En-route</div>
        </button>

      </section>

      {/* 2. SLIM OPERATIONAL UTILITY HEADER (Header-embedded filters live inside <thead>) */}
      <section className="bg-white/90 dark:bg-[#1E1238] backdrop-blur-md rounded-xl p-3.5 shadow-xs space-y-2.5 border border-[#DDE6F0] dark:border-[#35105E]">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {isCompactUI && (
              <button
                type="button"
                onClick={() => setShowFilterSheet(true)}
                aria-label="Buka Filter Lanjutan"
                className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-all ${
                  hasActiveFilters ? 'btn-3d-primary' : 'btn-3d-lilac'
                }`}
              >
                <Filter className="w-4 h-4" />
                <span>Filter</span>
                {activeFilterCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-mono tabular-nums">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            )}

            <div className="btn-3d-ceramic flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg text-[#26364A] dark:text-[#E9D5FF]">
              <Calendar className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#A78BFA] shrink-0" />
              <span className="text-[11px] font-bold whitespace-nowrap tabular-nums">
                {isCrossDateActive
                  ? `Lintas Tanggal (${filteredTickets.length} WO)`
                  : `Appointment: todayWIB (${formattedAppointmentChip})`}
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-[#DDF4F4]/70 dark:bg-[#22123F] border border-[#BDE4E8] dark:border-[#35105E] text-[#2E7D8B] dark:text-[#766B83] shadow-2xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  databaseStatus === 'connected'
                    ? 'bg-[#218A63] dark:bg-[#16A36A] animate-ping'
                    : 'bg-[#C88735] dark:bg-[#E59A27]'
                }`}
              />
              <span className="text-[10px] font-bold text-[#218A63] dark:text-[#16A36A] tracking-wide">
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

            <TableResetFilterButton
              activeCount={activeFilterCount}
              onReset={resetAllFilters}
              label="Reset Search/Filter"
              testId="tickets-reset-filters"
            />
          </div>

          {/* Right: Chat & Export XLSX */}
          <div className="flex items-center gap-2 flex-wrap lg:ml-auto">
            {/* Chat Unread Shortcut */}
            {['super_admin', 'dispatch', 'installer'].includes(currentUser.role) && (
              <button
                type="button"
                onClick={() => onNavigate('contact_centre')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  totalUnreadAcrossTickets > 0
                    ? 'bg-[#FCE9EB] dark:bg-rose-950/40 text-[#9B2C37] dark:text-rose-300 border border-[#F3C5CA] dark:border-rose-900'
                    : 'btn-3d-ceramic'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE]" />
                <span>Chat</span>
                {totalUnreadAcrossTickets > 0 && (
                  <span className="px-1.5 py-0.2 bg-[#D45B66] dark:bg-[#DC4C5A] text-white text-[10px] rounded-full font-bold tabular-nums">
                    {totalUnreadAcrossTickets}
                  </span>
                )}
              </button>
            )}

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

        {/* Cross-Date Search Banner */}
        {isCrossDateActive && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-[#EAE8FF]/80 dark:bg-[#2A174E] border border-[#DCE3F2] dark:border-[#5B35B1] text-[#5145A6] dark:text-[#E9D5FF] text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#6657C8] dark:text-[#D8B4FE] shrink-0" />
              <span>
                <strong>Mode Pencarian Lintas Tanggal Aktif:</strong> Ditemukan{' '}
                <strong>{filteredTickets.length}</strong> WO untuk kueri &ldquo;{effectiveCrossDateQuery}&rdquo;.
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
                setWoSearch('');
                setIdCustSearch('');
                setCurrentPage(1);
              }}
              className="btn-3d-ceramic px-2.5 py-1.5 min-h-[34px] sm:min-h-0 rounded-lg text-xs font-bold flex items-center gap-1 self-start sm:self-auto cursor-pointer whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset ke Hari Ini</span>
            </button>
          </div>
        )}

        {/* Contextual Bulk Selection Toolbar (visible ONLY when rows are selected) */}
        <TableSelectionToolbar
          selectedCount={selectedIds.size}
          onClearSelection={() => {
            setSelectedIds(new Set());
            setShowBulkApproveConfirm(false);
          }}
          label="Work Order terpilih di halaman aktif"
          testId="tickets-selection-toolbar"
        >
          {canApproveInline && selectedButuhApprovalTickets.length > 0 && (
            <button
              type="button"
              onClick={handleTriggerBulkApprove}
              className="btn-3d-success px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Bulk Approve ({selectedButuhApprovalTickets.length})</span>
            </button>
          )}

          {currentUser.role === 'leader' ? (
            <>
              <select
                value={bulkInstaller}
                disabled={isBulkAssigning}
                onChange={e => setBulkInstaller(e.target.value)}
                className="px-2 py-1.5 text-xs bg-white dark:bg-[#1E1238] border border-[#DCE3F2] dark:border-[#5B35B1] rounded-lg text-[#26364A] dark:text-white disabled:opacity-50"
              >
                <option value="">Pilih Teknisi...</option>
                {scopedInstallers.map(inst => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isBulkAssigning || !bulkInstaller}
                onClick={handleApplyBulkAssign}
                className="btn-3d-primary px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap flex items-center gap-1 disabled:opacity-50"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>{isBulkAssigning ? 'Menyimpan...' : 'Assign Teknisi'}</span>
              </button>
            </>
          ) : currentUser.role !== 'super_admin' ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#9D661F] bg-[#FFF2D9] px-2 py-1 rounded-lg border border-[#F2CF95]">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>Assign/Reassign khusus Leader</span>
            </span>
          ) : null}
        </TableSelectionToolbar>

        {/* Inline Bulk Approval Confirmation Banner */}
        {showBulkApproveConfirm && canApproveInline && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-lg bg-[#E4F5EC] dark:bg-emerald-950/40 border border-[#B7E4CC] dark:border-emerald-800 text-xs">
            <div className="flex items-center gap-2 text-[#218A63] dark:text-emerald-200 font-semibold">
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
                <h2 className="font-display font-bold text-[17px] text-[#26364A] dark:text-white tracking-tight">
                  Daftar Work Order
                </h2>
                <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                  Monitoring real-time &amp; penugasan lapangan
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-200 border border-[#F3C5CA] dark:border-rose-800/40 text-[11px] font-bold shrink-0 tabular-nums">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D45B66] animate-pulse" />
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
                      ? 'bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-200 border border-[#F3C5CA] dark:border-rose-800/60'
                      : chip.tone === 'warn' && chip.count > 0
                      ? 'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-200 border border-[#F2CF95] dark:border-amber-800/60'
                      : 'tactile-chip text-[#26364A] dark:text-[#E8DDFF]'
                  }`}
                >
                  <span>{chip.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
                      chip.active ? 'bg-white/20 text-white' : 'bg-white/80 dark:bg-black/25 text-[#26364A] dark:text-[#E8DDFF]'
                    }`}
                  >
                    {chip.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Compact Sort Bar */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
              <span className="text-[11px] font-semibold text-[#52647A] dark:text-[#CEC0E8] truncate">
                Menampilkan {paginatedTickets.length} dari {sortedTickets.length} WO
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <TableResetFilterButton
                  activeCount={activeFilterCount}
                  onReset={resetAllFilters}
                  label="Reset"
                />
                <ArrowUpDown className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                <select
                  aria-label="Urutkan Work Order"
                  value={`${sortField}:${sortDirection || 'desc'}`}
                  onChange={e => {
                    const [field, dir] = e.target.value.split(':');
                    setSortField(field);
                    setSortDirection((dir as SortDirection) || 'desc');
                    setCurrentPage(1);
                  }}
                  className="tactile-debossed-input bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg focus:outline-none cursor-pointer"
                >
                  <option value="updatedAt:desc">Terbaru Diperbarui</option>
                  <option value="slotTime:asc">Slot Waktu Terdekat</option>
                  <option value="statusWOInstaller:asc">Status Lapangan</option>
                  <option value="woNumber:asc">Nomor WO (A-Z)</option>
                </select>
              </div>
            </div>
          </div>

          {isDataLoading && tickets.length === 0 ? (
            <LoadingSkeleton variant="cards" rows={6} />
          ) : paginatedTickets.length === 0 ? (
            <div className="card-3d-lavender rounded-2xl py-12 px-4 text-center text-[#52647A] dark:text-[#CEC0E8] text-xs space-y-2">
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
      ) : isDataLoading && tickets.length === 0 ? (
        <LoadingSkeleton variant="table" rows={8} />
      ) : (
        <section className="bg-white/95 dark:bg-[#1E1238] rounded-xl shadow-xs overflow-hidden border border-[#DDE6F0] dark:border-[#35105E]">
          {isProgressiveHydrating && (
            <div className="px-4 py-1.5 bg-[#DDF4F4]/70 dark:bg-[#251545] border-b border-[#BDE4E8] dark:border-[#35105E] text-[11px] font-semibold text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-between gap-2">
              <span>Menampilkan data prioritas · Memuat kolom &amp; detail teknis lanjutan di latar belakang...</span>
              <span className="inline-block w-2 h-2 rounded-full bg-[#2E7D8B] dark:bg-[#7135B5] animate-pulse" />
            </div>
          )}
          <div
            ref={tableScrollRef}
            onScroll={e => {
              if (shouldVirtualizeRows) {
                setTableScrollTop(e.currentTarget.scrollTop);
              }
            }}
            className={`overflow-x-auto min-h-[280px] relative ${
              shouldVirtualizeRows ? 'max-h-[72vh] overflow-y-auto' : ''
            }`}
          >
            {tableStyleMode === 'stitch' ? (
              /* STITCH AI RICH COMPOSITE 9-COLUMN TABLE */
              <table className="w-full text-left border-collapse mj-zebra-table">
                <thead>
                  <tr className="bg-[#EDF3F8] dark:bg-[#251545] text-[11px] font-bold text-[#52647A] dark:text-[#D8B4FE] uppercase tracking-wide select-none border-b border-[#DDE6F0] dark:border-[#35105E]">
                    <th className="py-2.5 px-3 w-10 text-center">
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        className="text-[#6657C8] dark:text-[#D8B4FE] cursor-pointer"
                        aria-label="Pilih semua baris pada halaman ini"
                      >
                        {selectedIds.size === paginatedTickets.length && paginatedTickets.length > 0 ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 opacity-65" />
                        )}
                      </button>
                    </th>
                    <th className="py-2.5 px-2 w-10 min-w-[40px] max-w-[40px] text-center whitespace-nowrap">
                      DETAIL
                    </th>
                    <th className="py-2.5 px-3 whitespace-nowrap">
                      <HeaderSearchPopover
                        label="WO Number"
                        value={woSearch}
                        onChange={val => {
                          setWoSearch(val);
                          setCurrentPage(1);
                        }}
                        placeholder={isCrossDateSearchEligible ? 'Cari WO (Lintas Tanggal)...' : 'Cari WO Number...'}
                        sortActive={sortField === 'woNumber'}
                        sortDir={sortField === 'woNumber' ? sortDirection : null}
                        onCycleSort={() => handleSort('woNumber')}
                        testId="tickets-hdr-wo"
                      />
                    </th>
                    <th className="py-2.5 px-3 whitespace-nowrap">
                      <HeaderSearchPopover
                        label="ID Cust"
                        value={idCustSearch}
                        onChange={val => {
                          setIdCustSearch(val);
                          setCurrentPage(1);
                        }}
                        placeholder="Cari 7-digit ID Cust..."
                        sortActive={sortField === 'idCustomer'}
                        sortDir={sortField === 'idCustomer' ? sortDirection : null}
                        onCycleSort={() => handleSort('idCustomer')}
                        testId="tickets-hdr-idcust"
                      />
                    </th>
                    <th className="py-2.5 px-3 min-w-[205px]">
                      <HeaderSearchPopover
                        label="Pelanggan & Kontak"
                        value={customerSearch}
                        onChange={val => {
                          setCustomerSearch(val);
                          setCurrentPage(1);
                        }}
                        placeholder="Cari Nama, HP, Alamat..."
                        sortActive={sortField === 'customerName'}
                        sortDir={sortField === 'customerName' ? sortDirection : null}
                        onCycleSort={() => handleSort('customerName')}
                        testId="tickets-hdr-customer"
                      />
                    </th>
                    <th className="py-2.5 px-3 min-w-[160px]">
                      <HeaderCategoryDropdown
                        label="Area / Cluster"
                        value={selectedArea}
                        defaultValue="ALL"
                        allLabel="Semua Area"
                        options={[
                          { value: 'ALL', label: `Semua Area (${areaOptions.length})` },
                          ...areaOptions.map(a => ({ value: a.name, label: `${a.name} (${a.count})` }))
                        ]}
                        onChange={val => {
                          setSelectedArea(val);
                          setCurrentPage(1);
                        }}
                        sortActive={sortField === 'area'}
                        sortDir={sortField === 'area' ? sortDirection : null}
                        onCycleSort={() => handleSort('area')}
                        testId="tickets-hdr-area"
                      />
                    </th>
                    <th className="py-2.5 px-3 whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <HeaderSortButton
                          label="Slot Waktu"
                          sortActive={sortField === 'slotTime'}
                          sortDir={sortField === 'slotTime' ? sortDirection : null}
                          onCycleSort={() => handleSort('slotTime')}
                          testId="tickets-hdr-slot"
                        />
                        <HeaderDateSortFilterPopover
                          label="Tgl"
                          sortActive={sortField === 'appointmentDate'}
                          sortDir={sortField === 'appointmentDate' ? sortDirection : null}
                          onCycleSort={() => handleSort('appointmentDate')}
                          exactDate={exactAppointmentDate}
                          dateFrom={dateFrom}
                          dateTo={dateTo}
                          onChangeDates={({ exactDate, dateFrom: df, dateTo: dt }) => {
                            setExactAppointmentDate(exactDate);
                            setDateFrom(df);
                            setDateTo(dt);
                            setCurrentPage(1);
                          }}
                          testId="tickets-hdr-date"
                        />
                      </div>
                    </th>
                    <th className="py-2.5 px-3 min-w-[185px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <HeaderCategoryDropdown
                          label="Kontraktor"
                          value={selectedContractor}
                          defaultValue="ALL"
                          allLabel="Semua Kontraktor"
                          options={[
                            { value: 'ALL', label: `Semua Kontraktor (${contractorOptions.length})` },
                            ...contractorOptions.map(c => ({ value: c, label: c }))
                          ]}
                          onChange={val => {
                            setSelectedContractor(val);
                            setCurrentPage(1);
                          }}
                          testId="tickets-hdr-contractor"
                        />
                        <HeaderSearchPopover
                          label="Tim"
                          value={installerSearch}
                          onChange={val => {
                            setInstallerSearch(val);
                            setCurrentPage(1);
                          }}
                          placeholder="Cari Teknisi / Leader..."
                          testId="tickets-hdr-installer"
                        />
                      </div>
                    </th>
                    <th className="py-2.5 px-3 min-w-[235px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <HeaderCategoryDropdown
                          label="Agent"
                          value={selectedAgentStatus}
                          defaultValue="ALL"
                          allLabel="Semua Agent"
                          options={[
                            { value: 'ALL', label: 'Agent (All)' },
                            { value: 'Pending', label: 'Pending' },
                            { value: 'Assigned', label: 'Assigned' },
                            { value: 'In Progress', label: 'In Progress' },
                            { value: 'Done', label: 'Done' },
                            { value: 'Reschedule', label: 'Reschedule' },
                            { value: 'Cancel', label: 'Cancel' },
                            { value: 'Resolved', label: 'Resolved' },
                            { value: 'Closed', label: 'Closed' },
                            { value: 'Cancelled', label: 'Cancelled' }
                          ]}
                          onChange={val => {
                            setSelectedAgentStatus(val);
                            setCurrentPage(1);
                          }}
                          testId="tickets-hdr-agent"
                        />
                        <HeaderCategoryDropdown
                          label="Tech"
                          value={selectedInstallerStatus}
                          defaultValue="ALL"
                          allLabel="Semua Tech"
                          options={[
                            { value: 'ALL', label: 'Tech (All)' },
                            { value: 'Unassigned', label: 'Unassigned' },
                            { value: 'Assigned', label: 'Assigned' },
                            { value: 'En Route', label: 'En Route' },
                            { value: 'On Site', label: 'On Site' },
                            { value: 'In Progress', label: 'In Progress' },
                            { value: 'Pending Technical', label: 'Pending Technical' },
                            { value: 'Completed', label: 'Completed' },
                            { value: 'Installed', label: 'Installed' },
                            { value: 'Failed / Cancelled', label: 'Failed / Cancelled' }
                          ]}
                          onChange={val => {
                            setSelectedInstallerStatus(val);
                            setCurrentPage(1);
                          }}
                          testId="tickets-hdr-tech"
                        />
                        <HeaderCategoryDropdown
                          label="WA"
                          value={selectedWhatsAppStatus}
                          defaultValue="ALL"
                          allLabel="Semua WA"
                          options={[
                            { value: 'ALL', label: 'WA (All)' },
                            { value: 'not_prepared', label: 'Not Prepared' },
                            { value: 'ready', label: 'Ready' },
                            { value: 'opened_in_whatsapp', label: 'Opened in WhatsApp' },
                            { value: 'awaiting_confirmation', label: 'Awaiting Confirmation' },
                            { value: 'confirmed', label: 'Confirmed' },
                            { value: 'reschedule_requested', label: 'Reschedule Requested' },
                            { value: 'unreachable', label: 'Unreachable' },
                            { value: 'invalid_number', label: 'Invalid Phone' },
                            { value: 'cancelled', label: 'Cancelled' }
                          ]}
                          onChange={val => {
                            setSelectedWhatsAppStatus(val);
                            setCurrentPage(1);
                          }}
                          testId="tickets-hdr-wa"
                        />
                        <HeaderCategoryDropdown
                          label="Approval"
                          value={selectedApprovalStatus}
                          defaultValue="ALL"
                          allLabel="Semua Approval"
                          options={[
                            { value: 'ALL', label: 'Approval (All)' },
                            { value: 'BUTUH APPROVAL', label: `BUTUH APPROVAL (${approvalCounts.butuhApproval})` },
                            { value: 'APPROVED', label: `APPROVED (${approvalCounts.approved})` },
                            { value: 'REJECTED', label: `REJECTED / REVISI (${approvalCounts.rejected})` },
                            { value: 'CLOSED', label: `CLOSED (${approvalCounts.closed})` }
                          ]}
                          onChange={val => {
                            setSelectedApprovalStatus(val);
                            setCurrentPage(1);
                          }}
                          testId="tickets-hdr-approval"
                        />
                        {ticketCategories.length > 0 && (
                          <HeaderCategoryDropdown
                            label="Kat"
                            value={selectedCategory}
                            defaultValue="ALL"
                            allLabel="Semua Kategori"
                            options={[
                              { value: 'ALL', label: 'Kategori (All)' },
                              ...ticketCategories.map(cat => ({ value: cat, label: cat }))
                            ]}
                            onChange={val => {
                              setSelectedCategory(val);
                              setCurrentPage(1);
                            }}
                            testId="tickets-hdr-category"
                          />
                        )}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 z-20 bg-[#EDF3F8] dark:bg-[#251545] shadow-[-4px_0_6px_-2px_rgba(38,54,74,0.06)]">
                      ACTION
                    </th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[#DDE6F0] dark:divide-[#35105E]">
                  {paginatedTickets.length === 0 ? (
                    <tr>
                      <td colSpan={stitchColSpan} className="py-12 text-center text-[#8492A5] dark:text-[#8B8495] text-xs">
                        Tidak ada tiket Work Order yang cocok dengan filter.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {shouldVirtualizeRows && virtualRange.topSpacerPx > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={stitchColSpan} style={{ height: `${virtualRange.topSpacerPx}px`, padding: 0, border: 0 }} />
                        </tr>
                      )}
                      {virtualizedTickets.map((ticket, rowIdx) => {
                      const isSelected = selectedIds.has(ticket.id);
                      const unread = getTicketUnreadCount(ticket.id);
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
                        ? 'bg-[#EAE8FF] dark:bg-[#251247]'
                        : isRejectedRow
                        ? 'bg-[#FCE9EB] dark:bg-rose-950/25'
                        : isUrgentRow
                        ? 'bg-[#EAE8FF] dark:bg-[#2A174E]'
                        : rowIdx % 2 === 1
                        ? 'bg-[#F8FAFD] dark:bg-[#1E1238] group-hover:bg-[#F0EDFF] dark:group-hover:bg-[#251545]'
                        : 'bg-white dark:bg-[#1E1238] group-hover:bg-[#F0EDFF] dark:group-hover:bg-[#251545]';

                      return (
                        <Fragment key={ticket.id}>
                          <tr
                            className={`group transition-colors ${
                              isExpanded
                                ? 'bg-[#EAE8FF]/70 dark:bg-[#251247]/80'
                                : isRejectedRow
                                ? 'bg-[#FCE9EB]/55 dark:bg-rose-950/20 hover:bg-[#FCE9EB]/80 dark:hover:bg-[#ffdad6]/30'
                                : isUrgentRow
                                ? 'bg-[#EAE8FF]/45 dark:bg-[#2A174E]/60 hover:bg-[#EAE8FF]/75 dark:hover:bg-[#2A174E]'
                                : 'hover:bg-[#F0EDFF]/65 dark:hover:bg-[#251545]/60'
                            }`}
                          >
                            {/* 1. Checkbox (Bulk Selection Only) */}
                            <td className="py-3 px-3 text-center align-top">
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  handleToggleSelect(ticket.id);
                                }}
                                aria-label={`Pilih ${ticket.woNumber} untuk aksi massal`}
                                className="text-[#8492A5] hover:text-[#5145A6] dark:text-[#8B8495] dark:hover:text-[#D8B4FE] cursor-pointer"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-[#6657C8] dark:text-[#A78BFA]" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            </td>

                            {/* 1b. Dedicated Expand / Collapse Row Detail Button */}
                            <td className="py-3 px-2 w-10 min-w-[40px] max-w-[40px] text-center align-top">
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  toggleInlineDrawer(ticket);
                                }}
                                aria-expanded={isExpanded}
                                aria-label={isExpanded ? `Collapse detail ${ticket.woNumber}` : `Expand detail ${ticket.woNumber}`}
                                title={isExpanded ? 'Sembunyikan detail baris' : 'Tampilkan detail baris'}
                                data-testid={`ticket-expand-${ticket.woNumber}`}
                                className={`w-7 h-7 rounded-lg inline-flex items-center justify-center border transition-all cursor-pointer ${
                                  isExpanded
                                    ? 'bg-[#6657C8] dark:bg-[#7135B5] text-white border-[#5145A6] dark:border-[#9333EA] shadow-xs'
                                    : 'bg-[#F8FAFD] dark:bg-[#160D29] text-[#52647A] dark:text-[#CEC0E8] border-[#DDE6F0] dark:border-[#4B386B] hover:text-[#5145A6] dark:hover:text-[#DAB9FF] hover:border-[#6657C8]/50'
                                }`}
                              >
                                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            </td>

                            {/* 2. WO Number + Copy + Category */}
                            <td className="py-3 px-3 align-top whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    onSelectTicket(ticket);
                                  }}
                                  className="font-mono text-xs font-bold text-[#5145A6] dark:text-[#D8B4FE] hover:underline cursor-pointer tabular-nums"
                                >
                                  {ticket.woNumber}
                                </button>
                                <button
                                  type="button"
                                  onClick={e => handleCopyWoNumber(e, ticket)}
                                  className="btn-3d-icon w-6 h-6 p-0 text-[#8492A5] hover:text-[#6657C8] dark:text-[#8B8495] dark:hover:text-[#D8B4FE] cursor-pointer"
                                  title="Copy WO Number"
                                >
                                  {copiedWoId === ticket.id ? (
                                    <Check className="w-3 h-3 text-[#218A63] dark:text-[#16A36A]" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {isSameday ? (
                                  <span className="px-1.5 py-0.5 rounded bg-[#5145A6] dark:bg-[#35105E] text-white text-[9.5px] font-bold shadow-2xs">
                                    SAMEDAY
                                  </span>
                                ) : ticket.ticketCategory ? (
                                  <span className="px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] text-[9.5px] font-bold">
                                    {ticket.ticketCategory}
                                  </span>
                                ) : null}
                                {packageOrCat && packageOrCat !== ticket.ticketCategory && (
                                  <span className="text-[10px] text-[#8492A5] dark:text-[#8B8495] truncate max-w-[110px]">
                                    {packageOrCat}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 3. ID Cust */}
                            <td className="py-3 px-3 align-top whitespace-nowrap font-mono text-xs font-bold text-[#26364A] dark:text-white tabular-nums">
                              {ticket.idCustomer || '-'}
                            </td>

                            {/* 4. Pelanggan & Kontak */}
                            <td className="py-3 px-3 align-top">
                              <div className="font-bold text-[#26364A] dark:text-white truncate max-w-[210px]">
                                {ticket.customerName || '-'}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="font-mono text-[11.5px] text-[#52647A] dark:text-[#CEC0E8] tabular-nums">
                                  {phoneStr || '-'}
                                </span>
                                {phoneStr && (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      onOpenWhatsApp(ticket);
                                    }}
                                    className="w-5 h-5 rounded-full bg-[#218A63] dark:bg-[#16A36A] text-white flex items-center justify-center hover:opacity-90 transition-opacity shadow-2xs cursor-pointer shrink-0"
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
                                  className="flex items-center gap-1 text-[#8492A5] hover:text-[#5145A6] dark:text-[#8B8495] dark:hover:text-[#D8B4FE] mt-1 text-[11px] truncate max-w-[215px] cursor-pointer text-left"
                                  title={showHoverTooltips ? addressStr : 'Buka lokasi di Google Maps'}
                                >
                                  <MapPin className="w-3.5 h-3.5 text-[#D45B66] dark:text-[#DC4C5A] shrink-0" />
                                  <span className="truncate hover:underline">{addressStr}</span>
                                </button>
                              )}
                            </td>

                            {/* 5. Area / Cluster */}
                            <td className="py-3 px-3 align-top">
                              <div className="font-semibold text-[#26364A] dark:text-white">
                                {ticket.area || '-'}
                              </div>
                              <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate max-w-[165px]">
                                {ticket.clusterName || '-'}
                              </div>
                              {fatLabel && (
                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#22123F] text-[10px] font-mono font-semibold text-[#5145A6] dark:text-[#D8B4FE] border border-[#DCE3F2] dark:border-[#35105E]">
                                  {fatLabel}
                                </span>
                              )}
                            </td>

                            {/* 6. Slot Waktu */}
                            <td className="py-3 px-3 align-top whitespace-nowrap">
                              <div className="flex items-center gap-1 text-[#26364A] dark:text-white font-semibold">
                                <Clock className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#A78BFA] shrink-0" />
                                <span className="tabular-nums">{ticket.slotTime || '-'}</span>
                              </div>
                              <span className="text-[11px] text-[#8492A5] dark:text-[#8B8495] block mt-0.5 tabular-nums">
                                WIB · {formatIndonesianWODate(getTicketAppointmentDate(ticket) || todayWIB)}
                              </span>
                            </td>

                            {/* 7. Kontraktor & Tim */}
                            <td className="py-3 px-3 align-top">
                              <div className="font-medium text-[#26364A] dark:text-white truncate max-w-[170px]">
                                {contractorStr}
                              </div>
                              {ticket.installerName ? (
                                <div className="flex items-center gap-1 text-[11px] text-[#5145A6] dark:text-[#D8B4FE] font-semibold mt-0.5">
                                  <UserCheck className="w-3 h-3 shrink-0" />
                                  <span className="truncate max-w-[145px]">{ticket.installerName}</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-[11px] text-[#D45B66] dark:text-[#DC4C5A] font-semibold mt-0.5">
                                  <UserX className="w-3 h-3 shrink-0" />
                                  <span>Belum Ada Teknisi</span>
                                </div>
                              )}
                              <div className="text-[11px] text-[#8492A5] dark:text-[#8B8495] truncate max-w-[165px]">
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
                                    <span className="text-[11px] text-[#8492A5] dark:text-[#8B8495]">-</span>
                                  )}
                                  {String(ticket.ticketResult || '').trim().toLowerCase() === 'closed' && ticket.statusWOAgent !== 'Closed' && (
                                    <span className="px-1.5 py-0.5 rounded bg-[#26364A] dark:bg-[#E8DDFF] text-white dark:text-[#1F1638] text-[9.5px] font-bold uppercase tracking-wide">
                                      Closed
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* 9. Sticky-Right ACTION (Kebab Menu) */}
                            <td
                              className={`py-3 px-3 align-top text-right whitespace-nowrap sticky right-0 z-10 ${stickyBg} shadow-[-4px_0_6px_-2px_rgba(38,54,74,0.05)] transition-colors`}
                            >
                              {(() => {
                                const actionItems: DropdownActionItem[] = [];
                                if (canApproveInline && (isUrgentRow || hasInlineEvidence)) {
                                  actionItems.push({
                                    id: 'dispatch_review',
                                    label: isExpanded ? 'Tutup Dispatch Review' : 'Dispatch Review',
                                    icon: <ShieldCheck className="w-3.5 h-3.5" />,
                                    tone: 'warning',
                                    onClick: () => toggleInlineDrawer(ticket)
                                  });
                                }
                                if (canApproveInline && ticket.approvalStatus === 'BUTUH APPROVAL') {
                                  actionItems.push({
                                    id: 'quick_approve',
                                    label: 'Approve Laporan',
                                    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                                    tone: 'success',
                                    onClick: () => {
                                      if (!isExpanded) {
                                        toggleInlineDrawer(ticket);
                                      } else {
                                        handleInlineApprove(ticket);
                                      }
                                    }
                                  });
                                }
                                actionItems.push({
                                  id: 'detail_wo',
                                  label: 'Buka Detail WO',
                                  icon: <Eye className="w-3.5 h-3.5" />,
                                  tone: 'primary',
                                  onClick: () => onSelectTicket(ticket)
                                });
                                if (['super_admin', 'dispatch', 'installer'].includes(currentUser.role)) {
                                  actionItems.push({
                                    id: 'livechat',
                                    label: unread > 0 ? `LiveChat (${unread} baru)` : 'Buka LiveChat',
                                    icon: <MessageCircle className="w-3.5 h-3.5" />,
                                    tone: unread > 0 ? 'danger' : 'default',
                                    onClick: () => onSelectTicket(ticket, 'chat')
                                  });
                                }
                                if (phoneStr) {
                                  actionItems.push({
                                    id: 'whatsapp',
                                    label: 'WhatsApp Pelanggan',
                                    icon: <MessageSquare className="w-3.5 h-3.5" />,
                                    tone: 'success',
                                    onClick: () => onOpenWhatsApp(ticket)
                                  });
                                }
                                if (addressStr) {
                                  actionItems.push({
                                    id: 'maps',
                                    label: 'Buka Google Maps',
                                    icon: <MapPin className="w-3.5 h-3.5" />,
                                    onClick: () => openCustomerAddressInGoogleMaps(ticket)
                                  });
                                }
                                actionItems.push({
                                  id: 'copy_wo',
                                  label: 'Salin No. WO',
                                  icon: <Copy className="w-3.5 h-3.5" />,
                                  dividerBefore: true,
                                  onClick: () => {
                                    navigator.clipboard?.writeText(ticket.woNumber);
                                    toast.info(`Nomor WO ${ticket.woNumber} disalin.`);
                                  }
                                });
                                return (
                                  <div className="flex items-center justify-end">
                                    <ActionDropdownMenu
                                      actions={actionItems}
                                      triggerLabel={`Aksi WO ${ticket.woNumber}`}
                                      align="right"
                                      size="sm"
                                    />
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>

                          {isExpanded && renderExpandedDrawer(ticket, stitchColSpan)}
                        </Fragment>
                      );
                    })}
                      {shouldVirtualizeRows && virtualRange.bottomSpacerPx > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={stitchColSpan} style={{ height: `${virtualRange.bottomSpacerPx}px`, padding: 0, border: 0 }} />
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            ) : (
              /* CANONICAL 46-COLUMN CONFIGURABLE TABLE */
              <table className="w-full border-collapse text-left mj-zebra-table">
                <thead>
                  <tr className="bg-[#EDF3F8] dark:bg-[#251545] border-b border-[#DDE6F0] dark:border-[#35105E] text-[11px] font-bold text-[#52647A] dark:text-[#dab9ff] uppercase tracking-wider">
                    <th
                      className={`py-3 px-3 w-11 min-w-[44px] max-w-[44px] text-center bg-[#EDF3F8] dark:bg-[#251545] border-r border-[#DDE6F0] dark:border-[#35105E] ${
                        stickyColumnsEnabled ? 'sticky left-0 z-20' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        aria-label="Pilih semua baris pada halaman ini"
                        className="text-[#5145A6] dark:text-[#D8B4FE] cursor-pointer"
                      >
                        {selectedIds.size === paginatedTickets.length && paginatedTickets.length > 0 ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 opacity-60" />
                        )}
                      </button>
                    </th>
                    <th
                      className={`py-3 px-2 w-10 min-w-[40px] max-w-[40px] text-center bg-[#EDF3F8] dark:bg-[#251545] border-r border-[#DDE6F0] dark:border-[#35105E] ${
                        stickyColumnsEnabled ? 'sticky left-[44px] z-20' : ''
                      } ${
                        stickyColumnsEnabled && freezeColumnCount === 1
                          ? 'shadow-[2px_0_4px_-2px_rgba(38,54,74,0.08)]'
                          : ''
                      }`}
                    >
                      DETAIL
                    </th>

                    {renderedCanonicalColumns.map(col => {
                      const isSorted = sortField === col.key;
                      const activeDir = isSorted ? sortDirection : null;
                      const stickyInfo = stickyLeftMap[col.key];
                      const widthPx = col.width || 130;
                      const cycleSort = col.sortable ? () => handleSort(col.key) : undefined;

                      const renderCanonicalHeader = () => {
                        if (col.key === 'woNumber') {
                          return (
                            <HeaderSearchPopover
                              label={col.label}
                              value={woSearch}
                              onChange={v => {
                                setWoSearch(v);
                                setCurrentPage(1);
                              }}
                              placeholder="Cari WO Number..."
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'idCustomer') {
                          return (
                            <HeaderSearchPopover
                              label={col.label}
                              value={idCustSearch}
                              onChange={v => {
                                setIdCustSearch(v);
                                setCurrentPage(1);
                              }}
                              placeholder="Cari 7-digit ID..."
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'customerName') {
                          return (
                            <HeaderSearchPopover
                              label={col.label}
                              value={customerSearch}
                              onChange={v => {
                                setCustomerSearch(v);
                                setCurrentPage(1);
                              }}
                              placeholder="Cari Pelanggan..."
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'installerName') {
                          return (
                            <HeaderSearchPopover
                              label={col.label}
                              value={installerSearch}
                              onChange={v => {
                                setInstallerSearch(v);
                                setCurrentPage(1);
                              }}
                              placeholder="Cari Teknisi..."
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'area') {
                          return (
                            <HeaderCategoryDropdown
                              label={col.label}
                              value={selectedArea}
                              defaultValue="ALL"
                              allLabel="Semua Area"
                              options={[
                                { value: 'ALL', label: `Semua Area (${areaOptions.length})` },
                                ...areaOptions.map(a => ({ value: a.name, label: `${a.name} (${a.count})` }))
                              ]}
                              onChange={v => {
                                setSelectedArea(v);
                                setCurrentPage(1);
                              }}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'contactorName' || col.key === 'contractorName') {
                          return (
                            <HeaderCategoryDropdown
                              label={col.label}
                              value={selectedContractor}
                              defaultValue="ALL"
                              allLabel="Semua Kontraktor"
                              options={[
                                { value: 'ALL', label: `Semua Kontraktor (${contractorOptions.length})` },
                                ...contractorOptions.map(c => ({ value: c, label: c }))
                              ]}
                              onChange={v => {
                                setSelectedContractor(v);
                                setCurrentPage(1);
                              }}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'ticketCategory') {
                          return (
                            <HeaderCategoryDropdown
                              label={col.label}
                              value={selectedCategory}
                              defaultValue="ALL"
                              allLabel="Semua Kategori"
                              options={[
                                { value: 'ALL', label: 'Semua Kategori' },
                                ...ticketCategories.map(c => ({ value: c, label: c }))
                              ]}
                              onChange={v => {
                                setSelectedCategory(v);
                                setCurrentPage(1);
                              }}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'statusWOAgent') {
                          return (
                            <HeaderCategoryDropdown
                              label={col.label}
                              value={selectedAgentStatus}
                              defaultValue="ALL"
                              allLabel="Semua Agent"
                              options={[
                                { value: 'ALL', label: 'Agent (All)' },
                                { value: 'Pending', label: 'Pending' },
                                { value: 'Assigned', label: 'Assigned' },
                                { value: 'In Progress', label: 'In Progress' },
                                { value: 'Done', label: 'Done' },
                                { value: 'Reschedule', label: 'Reschedule' },
                                { value: 'Cancel', label: 'Cancel' },
                                { value: 'Resolved', label: 'Resolved' },
                                { value: 'Closed', label: 'Closed' },
                                { value: 'Cancelled', label: 'Cancelled' }
                              ]}
                              onChange={v => {
                                setSelectedAgentStatus(v);
                                setCurrentPage(1);
                              }}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'statusWOInstaller') {
                          return (
                            <HeaderCategoryDropdown
                              label={col.label}
                              value={selectedInstallerStatus}
                              defaultValue="ALL"
                              allLabel="Semua Tech"
                              options={[
                                { value: 'ALL', label: 'Tech (All)' },
                                { value: 'Unassigned', label: 'Unassigned' },
                                { value: 'Assigned', label: 'Assigned' },
                                { value: 'En Route', label: 'En Route' },
                                { value: 'On Site', label: 'On Site' },
                                { value: 'In Progress', label: 'In Progress' },
                                { value: 'Pending Technical', label: 'Pending Technical' },
                                { value: 'Completed', label: 'Completed' },
                                { value: 'Installed', label: 'Installed' },
                                { value: 'Failed / Cancelled', label: 'Failed / Cancelled' }
                              ]}
                              onChange={v => {
                                setSelectedInstallerStatus(v);
                                setCurrentPage(1);
                              }}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'statusWhatsApp') {
                          return (
                            <HeaderCategoryDropdown
                              label={col.label}
                              value={selectedWhatsAppStatus}
                              defaultValue="ALL"
                              allLabel="Semua WA"
                              options={[
                                { value: 'ALL', label: 'WA (All)' },
                                { value: 'not_prepared', label: 'Not Prepared' },
                                { value: 'ready', label: 'Ready' },
                                { value: 'opened_in_whatsapp', label: 'Opened in WhatsApp' },
                                { value: 'awaiting_confirmation', label: 'Awaiting Confirmation' },
                                { value: 'confirmed', label: 'Confirmed' },
                                { value: 'reschedule_requested', label: 'Reschedule Requested' },
                                { value: 'unreachable', label: 'Unreachable' },
                                { value: 'invalid_number', label: 'Invalid Phone' },
                                { value: 'cancelled', label: 'Cancelled' }
                              ]}
                              onChange={v => {
                                setSelectedWhatsAppStatus(v);
                                setCurrentPage(1);
                              }}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'approvalStatus') {
                          return (
                            <HeaderCategoryDropdown
                              label={col.label}
                              value={selectedApprovalStatus}
                              defaultValue="ALL"
                              allLabel="Semua Approval"
                              options={[
                                { value: 'ALL', label: 'Approval (All)' },
                                { value: 'BUTUH APPROVAL', label: `BUTUH APPROVAL (${approvalCounts.butuhApproval})` },
                                { value: 'APPROVED', label: `APPROVED (${approvalCounts.approved})` },
                                { value: 'REJECTED', label: `REJECTED / REVISI (${approvalCounts.rejected})` },
                                { value: 'CLOSED', label: `CLOSED (${approvalCounts.closed})` }
                              ]}
                              onChange={v => {
                                setSelectedApprovalStatus(v);
                                setCurrentPage(1);
                              }}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        if (col.key === 'appointmentDate') {
                          return (
                            <HeaderDateSortFilterPopover
                              label={col.label}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort || (() => handleSort('appointmentDate'))}
                              exactDate={exactAppointmentDate}
                              dateFrom={dateFrom}
                              dateTo={dateTo}
                              onChangeDates={({ exactDate, dateFrom: df, dateTo: dt }) => {
                                setExactAppointmentDate(exactDate);
                                setDateFrom(df);
                                setDateTo(dt);
                                setCurrentPage(1);
                              }}
                            />
                          );
                        }
                        if (cycleSort) {
                          return (
                            <HeaderSortButton
                              label={col.label}
                              sortActive={isSorted}
                              sortDir={activeDir}
                              onCycleSort={cycleSort}
                            />
                          );
                        }
                        return <span>{col.label}</span>;
                      };

                      return (
                        <th
                          key={col.key}
                          style={{
                            width: `${widthPx}px`,
                            minWidth: `${widthPx}px`,
                            ...(stickyInfo ? { left: `${stickyInfo.left}px` } : {})
                          }}
                          className={`py-3 px-3.5 whitespace-nowrap ${
                            stickyInfo
                              ? `sticky bg-[#EDF3F8] dark:bg-[#251545] z-20 border-r border-[#DDE6F0] dark:border-[#35105E] ${
                                  stickyInfo.isLastFrozen ? 'shadow-[3px_0_6px_-2px_rgba(38,54,74,0.10)]' : ''
                                }`
                              : ''
                          }`}
                        >
                          {renderCanonicalHeader()}
                        </th>
                      );
                    })}

                    <th
                      className={`py-3 px-3.5 whitespace-nowrap text-center bg-[#EDF3F8] dark:bg-[#251545] ${
                        stickyColumnsEnabled
                          ? 'sticky right-0 z-20 border-l border-[#DDE6F0] dark:border-[#35105E] shadow-[-2px_0_4px_-2px_rgba(38,54,74,0.06)]'
                          : 'border-l border-[#DDE6F0] dark:border-[#35105E]'
                      }`}
                    >
                      ACTION
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#DDE6F0] dark:divide-[#35105E]">
                  {paginatedTickets.length === 0 ? (
                    <tr>
                      <td colSpan={canonicalColSpan} className="py-12 text-center text-[#8492A5] dark:text-[#8B8495] text-xs">
                        Tidak ada tiket Work Order yang cocok dengan filter.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {shouldVirtualizeRows && virtualRange.topSpacerPx > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={canonicalColSpan} style={{ height: `${virtualRange.topSpacerPx}px`, padding: 0, border: 0 }} />
                        </tr>
                      )}
                      {virtualizedTickets.map((ticket, rowIdx) => {
                      const isSelected = selectedIds.has(ticket.id);
                      const isExpanded = expandedDrawerTicketId === ticket.id;
                      const stickyCellBg = isExpanded
                        ? 'bg-[#EAE8FF] dark:bg-[#251247]'
                        : isSelected
                        ? 'bg-[#EAE8FF] dark:bg-[#2E1459]'
                        : rowIdx % 2 === 1
                        ? 'bg-[#F8FAFD] dark:bg-[#1E1238] group-hover:bg-[#F0EDFF] dark:group-hover:bg-[#251545]'
                        : 'bg-white dark:bg-[#1E1238] group-hover:bg-[#F0EDFF] dark:group-hover:bg-[#251545]';

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
                                ? 'bg-[#EAE8FF]/70 dark:bg-[#251247]/70'
                                : isSelected
                                ? 'bg-[#EAE8FF]/50 dark:bg-[#2E1459]/40'
                                : 'hover:bg-[#F0EDFF]/65 dark:hover:bg-[#251545]/60'
                            }`}
                          >
                            <td
                              className={`py-2.5 px-3 w-11 min-w-[44px] max-w-[44px] text-center ${stickyCellBg} border-r border-[#DDE6F0] dark:border-[#35105E] transition-colors ${
                                stickyColumnsEnabled ? 'sticky left-0 z-10' : ''
                              }`}
                            >
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  handleToggleSelect(ticket.id);
                                }}
                                aria-label={`Pilih ${ticket.woNumber} untuk aksi massal`}
                                className="text-[#8492A5] hover:text-[#5145A6] dark:text-[#8B8495] dark:hover:text-[#D8B4FE] cursor-pointer"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-[#6657C8] dark:text-[#A78BFA]" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            </td>
                            <td
                              className={`py-2.5 px-2 w-10 min-w-[40px] max-w-[40px] text-center ${stickyCellBg} border-r border-[#DDE6F0] dark:border-[#35105E] transition-colors ${
                                stickyColumnsEnabled ? 'sticky left-[44px] z-10' : ''
                              } ${
                                stickyColumnsEnabled && freezeColumnCount === 1
                                  ? 'shadow-[2px_0_4px_-2px_rgba(38,54,74,0.06)]'
                                  : ''
                              }`}
                            >
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  toggleInlineDrawer(ticket);
                                }}
                                aria-expanded={isExpanded}
                                aria-label={isExpanded ? `Collapse detail ${ticket.woNumber}` : `Expand detail ${ticket.woNumber}`}
                                title={isExpanded ? 'Sembunyikan detail baris' : 'Tampilkan detail baris'}
                                data-testid={`ticket-expand-canonical-${ticket.woNumber}`}
                                className={`w-7 h-7 rounded-lg inline-flex items-center justify-center border transition-all cursor-pointer ${
                                  isExpanded
                                    ? 'bg-[#6657C8] dark:bg-[#7135B5] text-white border-[#5145A6] dark:border-[#9333EA] shadow-xs'
                                    : 'bg-[#F8FAFD] dark:bg-[#160D29] text-[#52647A] dark:text-[#CEC0E8] border-[#DDE6F0] dark:border-[#4B386B] hover:text-[#5145A6] dark:hover:text-[#DAB9FF] hover:border-[#6657C8]/50'
                                }`}
                              >
                                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            </td>

                            {renderedCanonicalColumns.map(col => {
                              const rawVal = getTicketColumnValue(ticket, col.key);
                              const stickyInfo = stickyLeftMap[col.key];
                              const widthPx = col.width || 130;
                              const stickyStyle = {
                                width: `${widthPx}px`,
                                minWidth: `${widthPx}px`,
                                ...(stickyInfo ? { left: `${stickyInfo.left}px` } : {})
                              };
                              const stickyClasses = stickyInfo
                                ? `sticky ${stickyCellBg} z-10 border-r border-[#DDE6F0] dark:border-[#35105E] ${
                                    stickyInfo.isLastFrozen ? 'shadow-[3px_0_6px_-2px_rgba(38,54,74,0.08)]' : ''
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
                                        className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] hover:underline tabular-nums cursor-pointer text-left"
                                        title={showHoverTooltips ? ticket.woNumber : undefined}
                                      >
                                        {ticket.woNumber}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={e => handleCopyWoNumber(e, ticket)}
                                        className="btn-3d-icon w-6 h-6 p-0 text-[#8492A5] hover:text-[#5145A6] dark:text-[#8B8495] dark:hover:text-[#D8B4FE] cursor-pointer"
                                        title="Salin Nomor WO"
                                      >
                                        {copiedWoId === ticket.id ? (
                                          <Check className="w-3 h-3 text-[#218A63] dark:text-[#16A36A]" />
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
                                    className={`${densityClass} ${stickyClasses} font-mono font-semibold text-[#26364A] dark:text-white tabular-nums`}
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
                                    className={`${densityClass} ${stickyClasses} font-semibold text-[#26364A] dark:text-white truncate max-w-[220px]`}
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
                                    className={`${densityClass} ${stickyClasses} font-mono text-[#52647A] dark:text-[#CEC0E8] tabular-nums whitespace-nowrap`}
                                  >
                                    {col.key === 'customerPhone' && phoneStr ? (
                                      <button
                                        type="button"
                                        onClick={e => {
                                          e.stopPropagation();
                                          onOpenWhatsApp(ticket);
                                        }}
                                        className="inline-flex items-center gap-1.5 text-[#218A63] dark:text-[#16A36A] hover:underline font-semibold cursor-pointer"
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
                                      {String(ticket.ticketResult || '').trim().toLowerCase() === 'closed' && ticket.statusWOAgent !== 'Closed' && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#26364A] dark:bg-[#E8DDFF] text-white dark:text-[#1F1638] text-[9.5px] font-bold uppercase">
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
                                    className={`${densityClass} ${stickyClasses} font-mono text-[#26364A] dark:text-[#F5F1FF] whitespace-nowrap tabular-nums`}
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
                                    className={`${densityClass} ${stickyClasses} font-mono text-[#52647A] dark:text-[#CEC0E8] whitespace-nowrap tabular-nums`}
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
                                    className={`${densityClass} ${stickyClasses} font-mono text-[#26364A] dark:text-[#F5F1FF] whitespace-nowrap tabular-nums`}
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
                                    className={`${densityClass} ${stickyClasses} text-[#52647A] dark:text-[#CEC0E8] max-w-xs`}
                                  >
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        openCustomerAddressInGoogleMaps(ticket);
                                      }}
                                      className="group/map flex items-start gap-1.5 text-left hover:text-[#5145A6] dark:hover:text-[#D8B4FE] transition-colors cursor-pointer w-full"
                                      title={
                                        showHoverTooltips && addrStr
                                          ? addrStr
                                          : 'Klik untuk membuka lokasi pelanggan di Google Maps'
                                      }
                                    >
                                      <MapPin className="w-3.5 h-3.5 text-[#D45B66] dark:text-[#DC4C5A] shrink-0 mt-0.5 group-hover/map:scale-110 transition-transform" />
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
                                            ? 'bg-[#FCE9EB] text-[#9B2C37] border border-[#F3C5CA]'
                                            : 'bg-[#E4F5EC] text-[#218A63] border border-[#B7E4CC]'
                                        }`}
                                      >
                                        {String(rawVal).toLowerCase().includes('dbm')
                                          ? String(rawVal)
                                          : `${rawVal} dBm`}
                                      </span>
                                    ) : (
                                      <span className="text-[#8492A5] dark:text-[#8B8495] italic font-normal">-</span>
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
                                    className={`${densityClass} ${stickyClasses} font-mono text-[#26364A] dark:text-[#F5F1FF] whitespace-nowrap tabular-nums`}
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
                                    className={`${densityClass} ${stickyClasses} font-mono text-[#52647A] dark:text-[#CEC0E8] whitespace-nowrap tabular-nums`}
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
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] border border-[#DCE3F2] dark:border-[#5B35B1] whitespace-nowrap">
                                        {ticket.installerName}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#FFF2D9] dark:bg-amber-950/40 text-[#9D661F] dark:text-amber-300 border border-[#F2CF95] whitespace-nowrap">
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
                                          ? 'bg-[#FFF2D9] text-[#9D661F] border border-[#F2CF95]'
                                          : 'bg-[#EDF3F8] dark:bg-[#251545] text-[#52647A] dark:text-[#CEC0E8]'
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
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] font-mono text-[11px] font-bold tabular-nums">
                                        <Camera className="w-3 h-3" />
                                        <span>{count}</span>
                                      </span>
                                    ) : (
                                      <span className="text-[#8492A5] dark:text-[#8B8495] italic font-normal">0</span>
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
                                            className="px-1.5 py-0.5 rounded bg-[#FCE9EB] text-[#9B2C37] border border-[#F3C5CA] font-mono text-[10px] font-bold"
                                          >
                                            {flag}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-[#218A63] dark:text-[#16A36A] text-[11px] font-semibold">Valid</span>
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
                                        className="inline-flex items-center gap-1 text-[#5145A6] dark:text-[#D8B4FE] hover:underline text-[11px] font-semibold cursor-pointer"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        <span>Lihat TTD</span>
                                      </button>
                                    ) : (
                                      <span className="text-[#8492A5] dark:text-[#8B8495] italic font-normal">-</span>
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
                                  className={`${densityClass} ${stickyClasses} text-[#26364A] dark:text-[#F5F1FF] ${
                                    col.format === 'code' ? 'font-mono tabular-nums' : ''
                                  } ${
                                    col.wrapText ? 'break-words max-w-xs' : 'whitespace-nowrap truncate max-w-xs'
                                  }`}
                                >
                                  {displayValue || <span className="text-[#8492A5] dark:text-[#8B8495] italic font-normal">-</span>}
                                </td>
                              );
                            })}

                            {/* Sticky-Right ACTION (Kebab Menu) */}
                            <td
                              className={`${densityClass} text-center whitespace-nowrap ${stickyCellBg} border-l border-[#DDE6F0] dark:border-[#35105E] transition-colors ${
                                stickyColumnsEnabled
                                  ? 'sticky right-0 z-10 shadow-[-2px_0_4px_-2px_rgba(38,54,74,0.06)]'
                                  : ''
                              }`}
                            >
                              {(() => {
                                const canonicalItems: DropdownActionItem[] = [];
                                if (hasInlineEvidence) {
                                  canonicalItems.push({
                                    id: 'review_drawer',
                                    label: isExpanded ? 'Tutup Drawer Review' : 'Review Verifikasi',
                                    icon: <ShieldCheck className="w-3.5 h-3.5" />,
                                    tone: 'warning',
                                    onClick: () => toggleInlineDrawer(ticket)
                                  });
                                }
                                if (canApproveInline && ticket.approvalStatus === 'BUTUH APPROVAL') {
                                  canonicalItems.push({
                                    id: 'approve_report',
                                    label: 'Approve Laporan',
                                    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                                    tone: 'success',
                                    onClick: () => {
                                      if (!isExpanded) {
                                        toggleInlineDrawer(ticket);
                                      } else {
                                        handleInlineApprove(ticket);
                                      }
                                    }
                                  });
                                }
                                canonicalItems.push({
                                  id: 'detail_wo',
                                  label: 'Buka Detail Lengkap WO',
                                  icon: <Eye className="w-3.5 h-3.5" />,
                                  tone: 'primary',
                                  onClick: () => onSelectTicket(ticket)
                                });
                                if (['super_admin', 'dispatch', 'installer'].includes(currentUser.role)) {
                                  canonicalItems.push({
                                    id: 'livechat',
                                    label: unread > 0 ? `LiveChat (${unread} baru)` : 'Buka LiveChat',
                                    icon: <MessageCircle className="w-3.5 h-3.5" />,
                                    tone: unread > 0 ? 'danger' : 'default',
                                    onClick: () => onSelectTicket(ticket, 'chat')
                                  });
                                }
                                canonicalItems.push({
                                  id: 'whatsapp',
                                  label: 'WhatsApp Pelanggan',
                                  icon: <MessageSquare className="w-3.5 h-3.5" />,
                                  tone: 'success',
                                  onClick: () => onOpenWhatsApp(ticket)
                                });
                                canonicalItems.push({
                                  id: 'maps',
                                  label: 'Buka Google Maps',
                                  icon: <MapPin className="w-3.5 h-3.5" />,
                                  onClick: () => openCustomerAddressInGoogleMaps(ticket)
                                });
                                canonicalItems.push({
                                  id: 'copy_wo',
                                  label: 'Salin No. WO',
                                  icon: <Copy className="w-3.5 h-3.5" />,
                                  dividerBefore: true,
                                  onClick: () => {
                                    navigator.clipboard?.writeText(ticket.woNumber);
                                    toast.info(`Nomor WO ${ticket.woNumber} disalin.`);
                                  }
                                });
                                return (
                                  <div className="flex items-center justify-center">
                                    <ActionDropdownMenu
                                      actions={canonicalItems}
                                      triggerLabel={`Aksi WO ${ticket.woNumber}`}
                                      align="right"
                                      size="sm"
                                    />
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>

                          {isExpanded && renderExpandedDrawer(ticket, canonicalColSpan)}
                        </Fragment>
                      );
                    })}
                      {shouldVirtualizeRows && virtualRange.bottomSpacerPx > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={canonicalColSpan} style={{ height: `${virtualRange.bottomSpacerPx}px`, padding: 0, border: 0 }} />
                        </tr>
                      )}
                    </>
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
          <div className="px-4 py-3.5 bg-[#F8FAFD] dark:bg-[#160D29]/85 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-[#26364A] dark:text-white">
                <Activity className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF] shrink-0" />
                <span>Live Dispatch Log &amp; Operational Audit</span>
                <span className="px-2 py-0.5 rounded-full bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#218A63] dark:text-emerald-300 text-[10px] font-bold">
                  WIB · {databaseStatus === 'connected' ? 'SSE ACTIVE' : databaseStatus.toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  onNavigate(
                    currentUser.role === 'super_admin'
                      ? 'audit_logs'
                      : currentUser.role === 'dispatch'
                      ? 'verification_desk'
                      : 'history_progress'
                  )
                }
                className="text-xs font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <span>
                  {currentUser.role === 'super_admin'
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
                      ? 'bg-[#FCE9EB] text-[#9B2C37] dark:bg-rose-950/70 dark:text-rose-200'
                      : actLower.includes('approve') || actLower.includes('closed')
                      ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-950/70 dark:text-emerald-200'
                      : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF]';
                  return (
                    <div
                      key={log.id}
                      className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-[11px]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#CEC0E8] shrink-0 tabular-nums">
                          {formatTimeOnlyWIB(log.timestamp)}
                        </span>
                        <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
                          {log.performedBy}
                        </span>
                        <span className="text-[#26364A] dark:text-white truncate">{log.details}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase shrink-0 ${badgeCls}`}>
                        {log.action}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-[#52647A] dark:text-[#CEC0E8]">
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
        <div className="bg-white/95 dark:bg-[#1E1238] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] overflow-hidden">
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
