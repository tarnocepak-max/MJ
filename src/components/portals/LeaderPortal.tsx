import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { Ticket, User, TicketStatusWOInstaller } from '../../types/index.ts';
import { StatusAgentBadge, StatusInstallerBadge, StatusWhatsAppBadge, StatusBadge } from '../common/Badge';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { DashboardKpiSummaryCards } from '../dashboard/DashboardKpiSummaryCards';
import { matchesKpiFilter, KPI_FILTER_LABELS } from '../../services/woLifecycleService';
import { renderWhatsAppMessage, buildWhatsAppClickToChatUrl, isValidPhoneNumber } from '../../services/whatsappService';
import {
  formatAppointmentDateDisplay,
  parseAppointmentDate,
  getJakartaDateString,
  getJakartaDateParts,
  getTicketAppointmentDate
} from '../../services/appointmentDateParser';
import {
  getTicketWorkStatus,
  formatJakartaTimestamp,
  formatJakartaTimeOnly,
  formatWorkDuration
} from '../../services/workSessionService';
import {
  Users2,
  CheckCircle2,
  UserCheck,
  MessageSquare,
  Clock,
  UserPlus,
  KeyRound,
  Shield,
  Building2,
  Phone,
  AlertCircle,
  Check,
  Lock,
  Search,
  Calendar,
  BarChart3,
  Plus,
  Sliders,
  Gauge,
  Send,
  XCircle,
  ExternalLink,
  Layers,
  Filter,
  X,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  FileSpreadsheet,
  Printer,
  Copy,
  Download,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Activity,
  ArrowRight,
  Smartphone,
  Table,
  FileUp,
  MapPin,
  ArrowRightLeft,
  History
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { SortableColumnHeader } from '../common/SortableColumnHeader';
import {
  SortState,
  getNextSortDirection,
  sortDataArray
} from '../../utils/tableSorting';
import {
  LeaderColumnSettingsModal,
  DEFAULT_LEADER_COLUMNS,
  ColumnConfig
} from './LeaderColumnSettingsModal';
import { InstallerDetailModal } from './InstallerDetailModal';
import { UploadAssignModal } from './UploadAssignModal';
import { LeaderProgressDashboardView } from './LeaderProgressDashboardView';
import { safeLocalStorageGet, safeLocalStorageSet, safeLocalStorageRemove } from '../../utils/safeStorage';
import { ContractorAreaRecapView } from '../reports/ContractorAreaRecapView';
import {
  DailyLimitSettingsModal,
  BulkReassignModal,
  AssignmentAuditTrailModal
} from './LeaderQuotaModals';
import { LeaderQuotaSidebar } from './LeaderQuotaSidebar';
import { LeaderAssignMatrixPanel } from './LeaderAssignMatrixPanel';
import { LeaderTechnicianManagementView } from './LeaderTechnicianManagementView';
import { LeaderReassignView } from './LeaderReassignView';
import { LeaderTwoStepReassignModal } from './LeaderTwoStepReassignModal';
import { StitchLeaderCommandHub } from './StitchLeaderCommandHub';
import {
  fetchLeaderQuotaConfig,
  saveLeaderQuotaConfig,
  fetchLeaderAssignmentFeed,
  executeBulkReassignApi,
  buildTechnicianCapacitySummaries,
  computeAutoBalancePlan,
  normalizeSlotIndex,
  normalizeQuotaKeySlug,
  DEFAULT_LEADER_QUOTA_CONFIG,
  LeaderQuotaConfig,
  AssignmentFeedEntry
} from '../../services/leaderQuotaService';
import { supabaseDb } from '../../services/supabaseDb';

export type LeaderPortalTab =
  | 'dashboard'
  | 'wo_assignment'
  | 'reassign_wo'
  | 'progress_dashboard'
  | 'installer_mgmt'
  | 'quota_settings'
  | 'contractor_recap';

interface LeaderPortalProps {
  onSelectTicket: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
  onNavigate?: (tab: string) => void;
  activeLeaderTab?: LeaderPortalTab;
  onLeaderTabChange?: (tab: LeaderPortalTab) => void;
}

type QuotaSettings = LeaderQuotaConfig;

const DEFAULT_QUOTA_SETTINGS: QuotaSettings = {
  ...DEFAULT_LEADER_QUOTA_CONFIG
};

export type LeaderStatusFilter =
  | 'all'
  | 'unassigned'
  | 'assigned'
  | 'waiting'
  | 'in_progress'
  | 'completed'
  | 'pending'
  | 'problem'
  | 'idle_installers';

export const LeaderPortal: React.FC<LeaderPortalProps> = ({
  onSelectTicket,
  onOpenWhatsApp,
  onNavigate,
  activeLeaderTab,
  onLeaderTabChange
}) => {
  const {
    tickets,
    assignTicketPersonnel,
    reassignTicketPersonnel,
    bulkAssignPersonnel,
    currentUser,
    users,
    todayWIB,
    registerInstallerAccount,
    templates,
    auditLogs,
    toast,
    contractorsList,
    areasList,
    databaseStatus,
    syncStatus,
    refreshActiveTickets,
    activeKpiDrilldown,
    setActiveKpiDrilldown,
    setIsChangePasswordModalOpen,
    markTicketEditing
  } = useApp();
  const { isCompactUI } = useResponsiveViewport();

  // Navigation tab in portal: Dedicated tabs for Dashboard Leader, Assign WO, Reassign WO, Pendaftaran Akun Teknisi, Dashboard Progress WO, Quota, and Rekap Area
  const [internalTab, setInternalTab] = useState<LeaderPortalTab>(
    activeLeaderTab || 'wo_assignment'
  );
  const activeTab = activeLeaderTab || internalTab;

  useEffect(() => {
    if (activeLeaderTab) {
      setInternalTab(activeLeaderTab);
    }
  }, [activeLeaderTab]);

  const setActiveTab = (tab: LeaderPortalTab) => {
    setInternalTab(tab);
    if (onLeaderTabChange) onLeaderTabChange(tab);
  };

  // Sub-view in Monitoring tab: 'installer_summary' (table of installers) vs 'wo_detail' (table of work orders)
  const [monitoringView, setMonitoringView] = useState<'installer_summary' | 'wo_detail'>('installer_summary');

  // Last refreshed timestamp
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(() => new Date().toISOString());

  // Date schedule for timetable matrix (reactively tracks todayWIB Asia/Jakarta)
  const [scheduleDate, setScheduleDate] = useState(() => todayWIB || getJakartaDateString(0));
  useEffect(() => {
    if (todayWIB) {
      setScheduleDate(todayWIB);
    }
  }, [todayWIB]);
  const [selectedSlotForAssign, setSelectedSlotForAssign] = useState<{ installer: string; slot: string } | null>(null);

  const STANDARD_SLOTS = [
    '09:00 - 11:00 WIB',
    '11:00 - 13:00 WIB',
    '13:00 - 15:00 WIB',
    '15:00 - 17:00 WIB'
  ];

  // Leader contractor & area + strict role authorization (App Flow 2 & 3)
  const isLeaderRole = currentUser.role === 'leader';
  const leaderContractor = currentUser.contractor || '';
  const leaderArea = currentUser.area || '';
  const displayContractor = leaderContractor || contractorsList?.[0] || 'Belum Terpetakan';
  const displayArea = leaderArea || areasList?.[0] || 'Belum Terpetakan';

  const isScopeTextMatch = (a?: string | null, b?: string | null): boolean => {
    const na = String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const nb = String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  };

  // Persistent Quota Settings (Backend Express + Supabase PostgreSQL `app_settings`)
  const QUOTA_STORAGE_KEY = `morajaws_leader_quota_${(leaderContractor || 'default').replace(/\s+/g, '_').toLowerCase()}`;
  const [quotaSettings, setQuotaSettings] = useState<QuotaSettings>(() => {
    try {
      const saved = safeLocalStorageGet(QUOTA_STORAGE_KEY);
      if (saved) return { ...DEFAULT_QUOTA_SETTINGS, ...JSON.parse(saved), contractorName: displayContractor };
    } catch {}
    return { ...DEFAULT_QUOTA_SETTINGS, contractorName: displayContractor };
  });
  const [isSavingQuota, setIsSavingQuota] = useState(false);
  const [quotaApiLatencyMs, setQuotaApiLatencyMs] = useState<number | null>(null);
  const [assignmentFeed, setAssignmentFeed] = useState<AssignmentFeedEntry[]>([]);

  // Load persisted quota configuration and recent reassign feed from backend
  useEffect(() => {
    let active = true;
    const contractorScope = leaderContractor || displayContractor;
    fetchLeaderQuotaConfig(contractorScope).then(res => {
      if (!active) return;
      if (typeof res.latencyMs === 'number') setQuotaApiLatencyMs(res.latencyMs);
      if (res.success && res.config) {
        setQuotaSettings(res.config);
        safeLocalStorageSet(QUOTA_STORAGE_KEY, JSON.stringify(res.config));
      }
    }).catch(() => {});

    fetchLeaderAssignmentFeed({ contractor: contractorScope, action: 'reassign', limit: 35 }).then(res => {
      if (!active) return;
      if (res.success) {
        setAssignmentFeed(res.feed);
      }
    }).catch(() => {});

    // Subscribe to realtime app_settings updates for this contractor's quota key
    const targetKey = normalizeQuotaKeySlug(contractorScope);
    const unsubQuota = supabaseDb.subscribeToChanges({
      table: 'app_settings',
      onPayload: (payload: any) => {
        if (!active || !payload) return;
        const evtKey = payload?.record?.key ?? payload?.key;
        const evtVal = payload?.record?.value ?? payload?.value;
        if (evtKey === targetKey && evtVal && typeof evtVal === 'object') {
          setQuotaSettings(prev => ({
            ...prev,
            ...evtVal,
            customInstallerLimits: { ...(evtVal.customInstallerLimits || {}) }
          }));
        }
      }
    });

    return () => {
      active = false;
      unsubQuota();
    };
  }, [leaderContractor, displayContractor, QUOTA_STORAGE_KEY]);

  const reloadAssignmentFeed = async () => {
    const contractorScope = leaderContractor || displayContractor;
    const res = await fetchLeaderAssignmentFeed({ contractor: contractorScope, action: 'reassign', limit: 35 }).catch(() => ({
      success: false,
      feed: []
    }));
    if (res.success) {
      setAssignmentFeed(res.feed);
    }
  };

  const saveQuotaSettings = async (updates: Partial<QuotaSettings>) => {
    if (!isLeaderRole) {
      toast.error('Akses Ditolak: Hanya akun Leader yang dapat mengubah batas kuota teknisi.', 'Otoritas Dibatasi');
      return;
    }
    const next: QuotaSettings = {
      ...quotaSettings,
      ...updates,
      contractorName: leaderContractor || displayContractor
    };
    const prevSnapshot = quotaSettings;
    setQuotaSettings(next);
    setIsSavingQuota(true);
    safeLocalStorageSet(QUOTA_STORAGE_KEY, JSON.stringify(next));

    const saveRes = await saveLeaderQuotaConfig(next);
    setIsSavingQuota(false);
    if (!saveRes.success) {
      setQuotaSettings(prevSnapshot);
      triggerNotice('error', saveRes.error || 'Gagal menyimpan pengaturan kuota ke database.');
      toast.error(saveRes.error || 'Gagal menyimpan pengaturan kuota ke database.', 'Gagal Menyimpan');
      return;
    }
    if (saveRes.config) {
      setQuotaSettings(saveRes.config);
    }
    triggerNotice('success', 'Pengaturan batas kuota teknisi berhasil disimpan ke database!');
    toast.success('Pengaturan batas kuota penugasan teknisi berhasil disimpan.', 'Kuota Diperbarui');
  };

  // Persistent Column Settings
  const COLUMN_STORAGE_KEY = `morajaws_leader_columns_${currentUser.id || 'default'}`;
  const [tableColumns, setTableColumns] = useState<ColumnConfig[]>(() => {
    try {
      const saved = safeLocalStorageGet(COLUMN_STORAGE_KEY);
      if (saved) {
        const parsed: ColumnConfig[] = JSON.parse(saved);
        const orderedCols: ColumnConfig[] = [];
        parsed.forEach(c => {
          const def = DEFAULT_LEADER_COLUMNS.find(d => d.id === c.id);
          if (def) {
            orderedCols.push({ ...def, visible: c.visible });
          }
        });
        DEFAULT_LEADER_COLUMNS.forEach(def => {
          if (!orderedCols.some(c => c.id === def.id)) {
            orderedCols.push(def);
          }
        });
        return orderedCols;
      }
    } catch (e) {}
    return DEFAULT_LEADER_COLUMNS;
  });

  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);

  const handleSaveColumns = (newCols: ColumnConfig[]) => {
    setTableColumns(newCols);
    safeLocalStorageSet(COLUMN_STORAGE_KEY, JSON.stringify(newCols));
  };

  const handleResetColumns = () => {
    setTableColumns(DEFAULT_LEADER_COLUMNS);
    safeLocalStorageRemove(COLUMN_STORAGE_KEY);
    toast.info('Pengaturan kolom dikembalikan ke default.', 'Kolom Direset');
  };

  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  // Table Filters & Search
  const [statusFilter, setStatusFilter] = useState<LeaderStatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInstallerFilter, setSelectedInstallerFilter] = useState<string>('ALL');
  const [slotFilter, setSlotFilter] = useState<string>('ALL');
  const [clusterFilter, setClusterFilter] = useState<string>('ALL');
  const [bulkQuickInstaller, setBulkQuickInstaller] = useState<string>('');

  // Date Filter for Assign WO (Strict Asia/Jakarta Appointment Date === todayWIB, auto-resets at 00:00 WIB)
  const [dateFilterType, setDateFilterTypeState] = useState<'today'>('today');
  const [customDateStart, setCustomDateStart] = useState<string>(todayWIB);
  const [customDateEnd, setCustomDateEnd] = useState<string>(todayWIB);
  const [appliedDateStart, setAppliedDateStart] = useState<string>(todayWIB);
  const [appliedDateEnd, setAppliedDateEnd] = useState<string>(todayWIB);

  useEffect(() => {
    if (todayWIB) {
      setDateFilterTypeState('today');
      setCustomDateStart(todayWIB);
      setCustomDateEnd(todayWIB);
      setAppliedDateStart(todayWIB);
      setAppliedDateEnd(todayWIB);
      setCurrentPage(1);
    }
  }, [todayWIB]);

  // Pagination & Rows per page (6 for mobile cards, 25 for desktop table)
  const [rowsPerPage, setRowsPerPage] = useState<number>(() => (isCompactUI ? 6 : 25));
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    if (isCompactUI && rowsPerPage === 25) {
      setRowsPerPage(6);
      setCurrentPage(1);
    } else if (!isCompactUI && rowsPerPage === 6) {
      setRowsPerPage(25);
      setCurrentPage(1);
    }
  }, [isCompactUI]);

  // Selected WOs for bulk operations
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);

  // Expanded rows map
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});

  // Modals state
  const [selectedInstallerForDetail, setSelectedInstallerForDetail] = useState<User | null>(null);
  const [isUploadAssignModalOpen, setIsUploadAssignModalOpen] = useState(false);
  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false);
  const [isDailyLimitModalOpen, setIsDailyLimitModalOpen] = useState(false);
  const [isBulkReassignModalOpen, setIsBulkReassignModalOpen] = useState(false);
  const [isSubmittingBulkReassign, setIsSubmittingBulkReassign] = useState(false);
  const [isAuditTrailModalOpen, setIsAuditTrailModalOpen] = useState(false);
  const [bulkTargetInstaller, setBulkTargetInstaller] = useState<string>('');
  const [bulkSlotTime, setBulkSlotTime] = useState<string>('');

  // Post-Assignment WhatsApp Notification Modal State
  const [assignmentNoticeModal, setAssignmentNoticeModal] = useState<{
    ticket: Ticket;
    installer: User;
    renderedMessage: string;
    targetPhone: string;
  } | null>(null);

  // Quota Warning Confirmation Modal State
  const [quotaWarningModal, setQuotaWarningModal] = useState<{
    ticket: Ticket;
    installerName: string;
    currentCount: number;
    maxLimit: number;
    slotTime?: string;
  } | null>(null);

  // Reassign WO Modal State (Full 2-Step Audit & Transactional Handoff)
  const [reassignModalState, setReassignModalState] = useState<{
    isOpen: boolean;
    ticket: Ticket | null;
    isSubmitting: boolean;
  }>({
    isOpen: false,
    ticket: null,
    isSubmitting: false
  });

  useEffect(() => {
    const protectedId =
      (reassignModalState.isOpen && reassignModalState.ticket?.id) ||
      (quotaWarningModal?.ticket?.id) ||
      null;
    if (!protectedId) return;
    markTicketEditing(protectedId, true);
    return () => {
      markTicketEditing(protectedId, false);
    };
  }, [reassignModalState.isOpen, reassignModalState.ticket?.id, quotaWarningModal?.ticket?.id]);

  const handleOpenReassignModal = (ticket: Ticket) => {
    if (!isLeaderRole) {
      toast.error('Hanya akun dengan peran Leader yang berwenang melakukan reassign teknisi.', 'Akses Ditolak');
      return;
    }
    if (!ticket.installerName) {
      toast.warning('Tiket ini belum memiliki teknisi. Silakan gunakan menu Assign WO untuk penugasan awal.', 'Belum Di-assign');
      return;
    }
    if (ticket.statusWOInstaller === 'Completed' || ticket.statusWOInstaller === 'Installed' || ticket.statusWOAgent === 'Closed') {
      toast.error('Tiket yang sudah berstatus Selesai (Completed) atau Ditutup (Closed) tidak dapat dialihkan / reassign.', 'Reassign Ditolak');
      return;
    }
    setReassignModalState({
      isOpen: true,
      ticket,
      isSubmitting: false
    });
  };

  const handleConfirmTwoStepReassign = async (payload: {
    ticket: Ticket;
    targetInstallerName: string;
    reason: string;
    prepareWhatsAppNotice: boolean;
  }) => {
    if (!isLeaderRole) {
      toast.error('Hanya akun dengan peran Leader yang berwenang melakukan reassign teknisi.', 'Akses Ditolak');
      return;
    }
    setReassignModalState(prev => ({ ...prev, isSubmitting: true }));
    const result = reassignTicketPersonnel(
      payload.ticket.id,
      payload.targetInstallerName,
      payload.reason.trim()
    );
    setReassignModalState(prev => ({ ...prev, isSubmitting: false }));

    if (result.success) {
      setReassignModalState({
        isOpen: false,
        ticket: null,
        isSubmitting: false
      });
      triggerNotice(
        'success',
        `WO ${payload.ticket.woNumber} berhasil dialihkan ke teknisi ${payload.targetInstallerName}.`
      );
      if (payload.prepareWhatsAppNotice) {
        const targetInst = myInstallers.find(
          u => u.name.toLowerCase().trim() === payload.targetInstallerName.toLowerCase().trim()
        );
        if (targetInst) {
          const updatedTicketPreview: Ticket = {
            ...payload.ticket,
            installerName: targetInst.name
          };
          setAssignmentNoticeModal({
            ticket: updatedTicketPreview,
            installer: targetInst,
            renderedMessage: buildInstallerAssignmentMessage(updatedTicketPreview, targetInst),
            targetPhone: targetInst.phone || ''
          });
        }
      }
      setTimeout(() => {
        reloadAssignmentFeed().catch(() => {});
      }, 450);
    }
  };

  // Scoped tickets for this Leader's contractor & area (plus direct leaderId/leaderName match)
  const contractorTickets = useMemo(() => {
    return currentUser.role === 'super_admin'
      ? tickets.filter(t => !t.isArchived && !t.isDeleted)
      : tickets.filter(t => {
          if (t.isArchived || t.isDeleted) return false;
          const cName = t.contactorName || t.contractorName || '';
          const contractorMatched = !leaderContractor || isScopeTextMatch(cName, leaderContractor);
          if (!contractorMatched) return false;
          if (leaderArea && t.area && !isScopeTextMatch(t.area, leaderArea)) {
            const directLeaderAssigned =
              (t.leaderId && t.leaderId === currentUser.id) ||
              (t.leaderName && isScopeTextMatch(t.leaderName, currentUser.name));
            if (!directLeaderAssigned) return false;
          }
          return true;
        });
  }, [tickets, currentUser.role, currentUser.id, currentUser.name, leaderContractor, leaderArea]);

  // Active installers belonging to this contractor & area scope
  const myInstallers = useMemo(() => {
    return users.filter(u => {
      if (u.role !== 'installer' || u.active === false || u.isArchived) return false;
      if (currentUser.role === 'super_admin') return true;
      if (leaderContractor && !isScopeTextMatch(u.contractor, leaderContractor)) return false;
      if (leaderArea && u.area && !isScopeTextMatch(u.area, leaderArea)) return false;
      return true;
    });
  }, [users, currentUser.role, leaderContractor, leaderArea]);

  const triggerNotice = (type: 'success' | 'error' | 'warning', text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4500);
  };

  // Refresh handler
  const handleRefresh = () => {
    setLastRefreshedAt(new Date().toISOString());
    toast.success('Data Portal Leader berhasil diperbarui dari database.', 'Data Diperbarui');
  };

  // Operational Status Classification Helper
  const classifyTicketOperational = (t: Ticket): {
    category: 'unassigned' | 'waiting' | 'in_progress' | 'completed' | 'pending' | 'problem';
    label: string;
    progressPercent: number;
    color: string;
  } => {
    // 1. Unassigned
    if (!t.installerName) {
      return { category: 'unassigned', label: 'Belum Di-assign', progressPercent: 0, color: 'text-slate-500' };
    }

    // 2. Problem / Cancelled
    if (
      t.statusWOInstaller === 'Failed / Cancelled' ||
      t.statusWOAgent === 'Cancelled' ||
      t.statusWhatsApp === 'cancelled'
    ) {
      return { category: 'problem', label: 'Bermasalah / Batal', progressPercent: 10, color: 'text-rose-600' };
    }

    // 3. Completed
    if (
      t.statusWOInstaller === 'Completed' ||
      t.statusWOInstaller === 'Installed' ||
      t.statusWOAgent === 'Resolved' ||
      t.statusWOAgent === 'Closed'
    ) {
      return { category: 'completed', label: 'Selesai', progressPercent: 100, color: 'text-emerald-600' };
    }

    // 4. Pending / Reschedule / On Hold
    if (
      t.statusWOInstaller === 'Pending Technical' ||
      t.statusWhatsApp === 'reschedule_requested' ||
      String(t.remarksWOInstaller ?? '').toLowerCase().includes('reschedule') ||
      String(t.remarksAgent ?? '').toLowerCase().includes('reschedule')
    ) {
      return { category: 'pending', label: 'Tertunda / Reschedule', progressPercent: 40, color: 'text-amber-600' };
    }

    // 5. In Progress (En Route, On Site)
    if (
      t.statusWOInstaller === 'En Route' ||
      t.statusWOInstaller === 'On Site' ||
      t.statusWOAgent === 'In Progress'
    ) {
      return { category: 'in_progress', label: 'Sedang Dikerjakan', progressPercent: 65, color: 'text-[#5145A6] dark:text-[#dab9ff]' };
    }

    // 6. Waiting / Belum Dimulai (Assigned but not yet departed)
    return { category: 'waiting', label: 'Menunggu Pengerjaan', progressPercent: 20, color: 'text-slate-600' };
  };

  // Get Installer Work Order Count for a specific target date
  const getInstallerWOCountForDate = (installerName: string, targetDate?: string): number => {
    return contractorTickets.filter(t => {
      if (t.installerName?.toLowerCase().trim() !== installerName.toLowerCase().trim()) return false;
      if (targetDate) {
        const rawDate = t.appointmentDate;
        const parsed = parseAppointmentDate(rawDate);
        const tDate = parsed.date || (rawDate ? String(rawDate).slice(0, 10) : '');
        return tDate === targetDate;
      }
      return t.statusWOInstaller !== 'Completed' && t.statusWOInstaller !== 'Failed / Cancelled';
    }).length;
  };

  // Maximum quota limit for technician
  const getMaxQuotaForInstaller = (installerName: string): number => {
    return quotaSettings.customInstallerLimits[installerName] || quotaSettings.defaultMaxDailyQuota;
  };

  // 10 ACCURATE SUMMARY METRICS (Requirement 1: Strictly counts WO with appointment date = today in Asia/Jakarta WIB)
  const summaryMetrics = useMemo(() => {
    let unassigned = 0;
    let assigned = 0;
    let waiting = 0;
    let inProgress = 0;
    let completed = 0;
    let pending = 0;
    let problem = 0;

    const todayContractorTickets = contractorTickets.filter(t => getTicketAppointmentDate(t) === todayWIB);

    todayContractorTickets.forEach(t => {
      const { category } = classifyTicketOperational(t);
      if (category === 'unassigned') {
        unassigned++;
      } else {
        assigned++;
        if (category === 'waiting') waiting++;
        else if (category === 'in_progress') inProgress++;
        else if (category === 'completed') completed++;
        else if (category === 'pending') pending++;
        else if (category === 'problem') problem++;
      }
    });

    const activeInstallers = myInstallers.filter(u => u.active).length;

    // Installers with 0 active tickets assigned for today
    const installerActiveTicketsMap = new Map<string, number>();
    todayContractorTickets.forEach(t => {
      if (t.installerName && t.statusWOInstaller !== 'Completed' && t.statusWOInstaller !== 'Failed / Cancelled') {
        const key = t.installerName.toLowerCase().trim();
        installerActiveTicketsMap.set(key, (installerActiveTicketsMap.get(key) || 0) + 1);
      }
    });

    const idleInstallers = myInstallers.filter(u => {
      const count = installerActiveTicketsMap.get(u.name.toLowerCase().trim()) || 0;
      return count === 0;
    }).length;

    return {
      total: todayContractorTickets.length,
      unassigned,
      assigned,
      waiting,
      inProgress,
      completed,
      pending,
      problem,
      activeInstallers,
      idleInstallers
    };
  }, [contractorTickets, myInstallers, todayWIB]);

  // INSTALLER PROGRESS MONITORING ROWS (Section 4 & 5 - strictly counts appointment date today)
  const installerProgressRows = useMemo(() => {
    const todayContractorTickets = contractorTickets.filter(t => getTicketAppointmentDate(t) === todayWIB);

    return myInstallers.map(inst => {
      const instTickets = todayContractorTickets.filter(
        t => t.installerName?.toLowerCase().trim() === inst.name.toLowerCase().trim()
      );

      let notStarted = 0;
      let inProgress = 0;
      let finished = 0;
      let pending = 0;

      instTickets.forEach(t => {
        const { category } = classifyTicketOperational(t);
        if (category === 'waiting') notStarted++;
        else if (category === 'in_progress') inProgress++;
        else if (category === 'completed') finished++;
        else if (category === 'pending' || category === 'problem') pending++;
      });

      const total = instTickets.length;
      const progressPercent = total > 0 ? Math.round((finished / total) * 100) : 0;
      const maxQuota = getMaxQuotaForInstaller(inst.name);

      return {
        installer: inst,
        totalWO: total,
        notStarted,
        inProgress,
        finished,
        pending,
        progressPercent,
        maxQuota
      };
    });
  }, [myInstallers, contractorTickets, quotaSettings, todayWIB]);

  const todayContractorTickets = useMemo(() => {
    return contractorTickets.filter(t => getTicketAppointmentDate(t) === todayWIB);
  }, [contractorTickets, todayWIB]);

  const clusterOptions = useMemo(() => {
    const set = new Set<string>();
    todayContractorTickets.forEach(t => {
      const c = String(t.clusterName || t.area || '').trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [todayContractorTickets]);

  const assignCategoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    todayContractorTickets
      .filter(t => !t.installerName)
      .forEach(t => {
        const cat = String(t.ticketCategory || '').trim();
        if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
      });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [todayContractorTickets]);

  const reassignCategoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    todayContractorTickets
      .filter(t => Boolean(t.installerName))
      .forEach(t => {
        const cat = String(t.ticketCategory || '').trim();
        if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
      });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [todayContractorTickets]);

  const technicianSummaries = useMemo(() => {
    return buildTechnicianCapacitySummaries({
      installers: myInstallers,
      todayTickets: todayContractorTickets,
      quotaConfig: quotaSettings,
      targetDate: todayWIB
    });
  }, [myInstallers, todayContractorTickets, quotaSettings, todayWIB]);

  const totalMaxSlots = useMemo(() => {
    if (technicianSummaries.length === 0) return 0;
    return technicianSummaries.reduce((acc, item) => acc + item.maxLimit, 0);
  }, [technicianSummaries]);

  const quotaUtilizationPct = useMemo(() => {
    if (totalMaxSlots <= 0) return 0;
    return Math.min(100, Math.round((summaryMetrics.assigned / totalMaxSlots) * 1000) / 10);
  }, [summaryMetrics.assigned, totalMaxSlots]);

  const assignedTechnicianCount = useMemo(() => {
    return technicianSummaries.filter(item => item.assignedCount > 0).length;
  }, [technicianSummaries]);

  const avgAssignSlaMinutes = useMemo(() => {
    const diffs: number[] = [];
    todayContractorTickets.forEach(t => {
      if (!t.installerName) return;
      const startIso = t.importedAt || t.createdAt;
      const endIso = t.reassignedAt || t.updatedAt;
      if (!startIso || !endIso) return;
      const startMs = new Date(startIso).getTime();
      const endMs = new Date(endIso).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return;
      const mins = Math.round((endMs - startMs) / 60000);
      if (mins >= 0 && mins <= 720) {
        diffs.push(mins);
      }
    });
    if (diffs.length === 0) return 0;
    return Math.max(1, Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length));
  }, [todayContractorTickets]);

  const mergedAuditFeed = useMemo(() => {
    const seen = new Set<string>();
    const list: AssignmentFeedEntry[] = [];
    const pushItem = (item: AssignmentFeedEntry) => {
      const key = `${item.woNumber}|${item.newInstallerName || item.installerName}|${item.timestamp || item.createdAt}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(item);
    };
    assignmentFeed.forEach(pushItem);
    contractorTickets.forEach(t => {
      (t.assignmentHistory || []).forEach(h => {
        if (h.sourceAction === 'reassign' || h.previousInstaller || h.previousInstallerName) {
          const targetInstaller = h.newInstallerName || h.assignedInstaller || '-';
          pushItem({
            id: h.id || `${t.id}_${h.timestamp}`,
            ticketId: t.id,
            woNumber: t.woNumber,
            previousInstallerName: h.previousInstallerName || h.previousInstaller || 'Teknisi Sebelumnya',
            newInstallerName: targetInstaller,
            installerName: targetInstaller,
            reason: h.reason,
            performedBy: h.performedBy || h.leaderName,
            performedByRole: h.performedByRole,
            timestamp: h.timestamp,
            sourceAction: 'reassign'
          });
        }
      });
    });
    return list.sort((a, b) => new Date(b.timestamp || b.createdAt || 0).getTime() - new Date(a.timestamp || a.createdAt || 0).getTime());
  }, [assignmentFeed, contractorTickets]);

  // FILTERED WORK ORDERS FOR ASSIGN WO TABLE (STRICTLY UNASSIGNED IN wo_assignment)
  const filteredTickets = useMemo(() => {
    return contractorTickets.filter(t => {
      const { category } = classifyTicketOperational(t);

      // Feature 6: Assign WO strictly displays only unassigned WOs (!t.installerName)
      if (activeTab === 'wo_assignment') {
        if (t.installerName) return false;
      } else {
        if (statusFilter === 'unassigned' && t.installerName) return false;
        if (statusFilter === 'assigned' && !t.installerName) return false;
        if (statusFilter === 'waiting' && category !== 'waiting') return false;
        if (statusFilter === 'in_progress' && category !== 'in_progress') return false;
        if (statusFilter === 'completed' && category !== 'completed') return false;
        if (statusFilter === 'pending' && category !== 'pending') return false;
        if (statusFilter === 'problem' && category !== 'problem') return false;
      }

      // Installer dropdown filter
      if (selectedInstallerFilter !== 'ALL') {
        if ((t.installerName || '').toLowerCase().trim() !== selectedInstallerFilter.toLowerCase().trim()) {
          return false;
        }
      }

      // Slot filter
      if (slotFilter !== 'ALL') {
        const idx = normalizeSlotIndex(t.slotTime);
        if (String(idx || '') !== slotFilter) return false;
      }

      // Sub-Cluster filter
      if (clusterFilter !== 'ALL') {
        const cName = String(t.clusterName || t.area || '').trim();
        if (cName.toLowerCase() !== clusterFilter.toLowerCase()) return false;
      }

      // Ticket Category filter
      if (categoryFilter !== 'ALL') {
        const tCat = String(t.ticketCategory || '').trim();
        if (tCat.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      }

      // Strict Asia/Jakarta Appointment Date === todayWIB (Auto-resets at 00:00 WIB)
      const ticketDate = getTicketAppointmentDate(t);
      if (!ticketDate || ticketDate !== todayWIB) return false;

      // Search query filter (WO Number, Customer ID, Customer Name, Phone, Installer, Cluster, Street)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchWo = String(t.woNumber ?? '').toLowerCase().includes(q);
        const matchCustId = String(t.idCustomer || '').toLowerCase().includes(q);
        const matchCustName = String(t.customerName || '').toLowerCase().includes(q);
        const matchPhone = String(t.customerPhone || '').toLowerCase().includes(q);
        const matchInst = String(t.installerName || '').toLowerCase().includes(q);
        const matchCluster = String(t.clusterName || '').toLowerCase().includes(q);
        const matchStreet = String(t.streetName || '').toLowerCase().includes(q);
        const matchArea = String(t.area || '').toLowerCase().includes(q);

        if (!matchWo && !matchCustId && !matchCustName && !matchPhone && !matchInst && !matchCluster && !matchStreet && !matchArea) {
          return false;
        }
      }

      // KPI Dashboard Drill-Down filter
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

      return true;
    });
  }, [
    contractorTickets,
    activeTab,
    statusFilter,
    categoryFilter,
    selectedInstallerFilter,
    slotFilter,
    clusterFilter,
    todayWIB,
    searchQuery,
    activeKpiDrilldown
  ]);

  // Sorting State for Leader Assign WO Table
  const [sortState, setSortState] = useState<SortState>({
    column: null,
    direction: null
  });

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

  // Sorted Work Orders
  const sortedTickets = useMemo(() => {
    if (!sortState.column || !sortState.direction) {
      return filteredTickets;
    }

    return sortDataArray(filteredTickets, sortState, (t: Ticket, col: string) => {
      switch (col) {
        case 'woNumber':
          return t.woNumber || '';
        case 'date':
          return t.date || '';
        case 'idCustomer':
          return t.idCustomer || t.customerId || '';
        case 'customerName':
          return t.customerName || '';
        case 'customerPhone':
          return t.customerPhone || '';
        case 'area':
          return t.area || '';
        case 'clusterName':
          return t.clusterName || '';
        case 'streetName':
          return t.streetName || t.clusterName || '';
        case 'appointmentDate':
          return getTicketAppointmentDate(t) || t.appointmentDate || '';
        case 'slotTime':
          return t.slotTime || '';
        case 'contractor':
          return t.contactorName || t.contractorName || '';
        case 'installer':
          return t.installerName || '';
        case 'status': {
          const { label } = classifyTicketOperational(t);
          return label || t.statusWOInstaller || '';
        }
        case 'workStatus': {
          const ws = getTicketWorkStatus(t);
          return ws.status;
        }
        case 'checkInAt':
          return t.checkInAt || '';
        case 'checkOutAt':
          return t.checkOutAt || '';
        case 'workDuration':
          return t.workDurationMinutes || 0;
        case 'progress': {
          const { progressPercent } = classifyTicketOperational(t);
          return progressPercent;
        }
        case 'lastUpdate':
          return t.updatedAt || t.dateUpload || t.createdAt || '';
        default:
          return (t as any)[col] || '';
      }
    });
  }, [filteredTickets, sortState]);

  // Paginated Rows
  const totalPages = rowsPerPage === -1 ? 1 : Math.max(1, Math.ceil(sortedTickets.length / rowsPerPage));
  const paginatedTickets = useMemo(() => {
    if (rowsPerPage === -1) return sortedTickets;
    const start = (currentPage - 1) * rowsPerPage;
    return sortedTickets.slice(start, start + rowsPerPage);
  }, [sortedTickets, currentPage, rowsPerPage]);

  // Checkbox selection helpers (Realtime "Selected Data: N")
  const isAllPageSelected =
    paginatedTickets.length > 0 &&
    paginatedTickets.every(t => selectedTicketIds.includes(t.id));

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageIds = paginatedTickets.map(t => t.id);
      setSelectedTicketIds(prev => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIdSet = new Set(paginatedTickets.map(t => t.id));
      setSelectedTicketIds(prev => prev.filter(id => !pageIdSet.has(id)));
    }
  };

  const handleToggleSelectTicket = (id: string) => {
    setSelectedTicketIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleRowExpansion = (id: string) => {
    setExpandedRowIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Format Helper for Dates
  const formatDisplayTime = (isoString?: string | null) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB';
    } catch {
      return isoString;
    }
  };

  // Build WhatsApp Message for Installer
  const buildInstallerAssignmentMessage = (ticket: Ticket, installer: User): string => {
    const template = templates.find(
      t => t.id === 'tpl_installer_assignment' || t.category === 'Penugasan Teknisi Lapangan'
    );

    const ticketDataWithExtras: any = {
      ...ticket,
      installerName: installer.name,
      installerContact: installer.phone || '',
      installerPhone: installer.phone || '',
      leaderName: currentUser.name,
      contractorName: leaderContractor,
      contactorName: leaderContractor,
      appointmentDate: ticket.appointmentDate || '',
      appointment_date: ticket.appointmentDate || '',
      street_alternatif: ticket.streetAlternatif || 'Tidak ada patokan khusus'
    };

    if (template) {
      const res = renderWhatsAppMessage(template.messageBody, ticketDataWithExtras);
      return res.renderedText;
    }

    return `Halo Rekan Teknisi ${installer.name},\n\nAda penugasan Work Order baru untuk Anda dari Korlap (${currentUser.name} - ${leaderContractor}):\n\n📌 Detail Work Order:\n- No. WO: ${ticket.woNumber}\n- Kategori: ${ticket.ticketCategory}\n- Tanggal Kunjungan: ${ticket.appointmentDate || 'Belum Ditentukan'}\n- Slot Waktu: ${ticket.slotTime}\n\n📍 Lokasi Pelanggan:\n- Nama: ${ticket.customerName}\n- No. Kontak: ${ticket.customerPhone}\n- Alamat: ${ticket.streetName || '-'}\n- Patokan: ${ticket.streetAlternatif || '-'}\n- Cluster: ${ticket.clusterName || '-'}\n- Area: ${ticket.area}\n\n🔧 Data Jaringan:\n- OLT/FDT: ${ticket.fdtCode || '-'}\n- FAT Code: ${ticket.fatCode || '-'}\n\nHarap segera konfirmasi penerimaan tugas melalui Portal Teknisi Lapangan.\nTerima kasih, selamat bertugas!`;
  };

  // Single Ticket Assignment (Leader Only)
  const handleAssignTicket = (ticket: Ticket, installerName: string, slotTime?: string, bypassWarning = false) => {
    if (!isLeaderRole) {
      toast.error('Hanya akun dengan peran Leader yang berwenang melakukan assign teknisi.', 'Akses Ditolak');
      return;
    }
    if (!installerName) return;

    const installerUser = myInstallers.find(
      u => u.name.toLowerCase().trim() === installerName.toLowerCase().trim()
    );

    const targetDate = ticket.appointmentDate || scheduleDate;
    const currentCount = getInstallerWOCountForDate(installerName, targetDate);
    const maxLimit = getMaxQuotaForInstaller(installerName);

    if (currentCount >= maxLimit && !bypassWarning) {
      if (quotaSettings.enforceStrictLimit) {
        const quotaErrMsg = `Batas Kuota Tercapai: Teknisi ${installerName} sudah memiliki ${currentCount} WO pada tanggal ${targetDate} (Batas Kuota: ${maxLimit} WO).`;
        triggerNotice('error', quotaErrMsg);
        toast.error(quotaErrMsg, 'Batas Kuota Tercapai');
        return;
      } else {
        toast.warning(`Teknisi ${installerName} melampaui kuota harian (${currentCount}/${maxLimit} WO).`, 'Peringatan Kuota');
        setQuotaWarningModal({
          ticket,
          installerName,
          currentCount,
          maxLimit,
          slotTime
        });
        return;
      }
    }

    assignTicketPersonnel(ticket.id, currentUser.name, installerName);

    triggerNotice(
      'success',
      `WO ${ticket.woNumber} berhasil ditugaskan ke teknisi ${installerName}!`
    );

    if (installerUser) {
      const msg = buildInstallerAssignmentMessage(ticket, installerUser);
      setAssignmentNoticeModal({
        ticket,
        installer: installerUser,
        renderedMessage: msg,
        targetPhone: installerUser.phone || ''
      });
    }
  };

  // Bulk Assign Confirmation Execution (Leader Only)
  const handleExecuteBulkAssignModal = () => {
    if (!isLeaderRole) {
      toast.error('Hanya akun dengan peran Leader yang berwenang melakukan bulk assign teknisi.', 'Akses Ditolak');
      return;
    }
    if (!bulkTargetInstaller) {
      toast.error('Pilih teknisi tujuan penugasan.', 'Validasi Gagal');
      return;
    }

    if (selectedTicketIds.length === 0) {
      toast.error('Tidak ada Work Order yang dipilih.', 'Validasi Gagal');
      return;
    }

    const res = bulkAssignPersonnel(selectedTicketIds, currentUser.name, bulkTargetInstaller, bulkSlotTime || undefined);
    if (res.success) {
      toast.success(`Berhasil menugaskan ${res.count} Work Order ke teknisi ${bulkTargetInstaller}.`, 'Penugasan Sukses');
      setSelectedTicketIds([]);
      setIsBulkAssignModalOpen(false);

      const targetInst = myInstallers.find(u => u.name === bulkTargetInstaller);
      if (targetInst && selectedTicketIds.length === 1) {
        const t = contractorTickets.find(item => item.id === selectedTicketIds[0]);
        if (t) {
          const msg = buildInstallerAssignmentMessage(t, targetInst);
          setAssignmentNoticeModal({
            ticket: t,
            installer: targetInst,
            renderedMessage: msg,
            targetPhone: targetInst.phone || ''
          });
        }
      }
    }
  };

  // Inline Matrix Bulk Quick Assign
  const handleExecuteBulkQuickAssign = () => {
    if (!isLeaderRole) {
      toast.error('Akses Ditolak: Hanya Leader yang berwenang menugaskan WO.', 'Akses Ditolak');
      return;
    }
    if (!bulkQuickInstaller) {
      toast.warning('Pilih teknisi tujuan dari dropdown terlebih dahulu.', 'Pilih Teknisi');
      return;
    }
    if (selectedTicketIds.length === 0) {
      toast.warning('Centang minimal 1 Work Order yang ingin ditugaskan.', 'Pilih Work Order');
      return;
    }

    const tech = technicianSummaries.find(s => s.installer.name === bulkQuickInstaller);
    if (tech && quotaSettings.enforceStrictLimit && tech.assignedCount + selectedTicketIds.length > tech.maxLimit) {
      toast.error(
        `Kuota Tidak Mencukupi: ${bulkQuickInstaller} hanya memiliki ${tech.remainingSlots} slot kosong (${tech.assignedCount}/${tech.maxLimit}).`,
        'Batas Kuota Ketat'
      );
      return;
    }

    const res = bulkAssignPersonnel(selectedTicketIds, currentUser.name, bulkQuickInstaller);
    if (res.success) {
      setSelectedTicketIds([]);
      setBulkQuickInstaller('');
      triggerNotice('success', `Berhasil menugaskan ${res.count} Work Order ke ${bulkQuickInstaller}.`);
    }
  };

  // Auto-Balance Slot Engine (Leader Only, Real Slot Matching + Quota Check)
  const handleExecuteAutoBalance = () => {
    if (!isLeaderRole) {
      toast.error('Akses Ditolak: Hanya Leader yang berwenang menjalankan Auto-Balance Slot.', 'Akses Ditolak');
      return;
    }
    const targetPool =
      selectedTicketIds.length > 0
        ? filteredTickets.filter(t => selectedTicketIds.includes(t.id) && !t.installerName)
        : filteredTickets.filter(t => !t.installerName);

    if (targetPool.length === 0) {
      toast.info('Tidak ada Work Order Unassigned pada antrean filter aktif untuk diseimbangkan.', 'Antrean Kosong');
      return;
    }

    const plan = computeAutoBalancePlan({
      targetTickets: targetPool,
      installers: myInstallers,
      existingTodayTickets: todayContractorTickets,
      quotaConfig: quotaSettings
    });

    if (plan.planned.length === 0) {
      toast.warning(
        plan.skipped[0]?.reason || 'Semua teknisi aktif dalam area sudah mencapai batas kuota harian.',
        'Auto-Balance Tidak Tersedia'
      );
      return;
    }

    // Group planned tickets by chosen technician and dispatch through real bulkAssignPersonnel API
    const grouped = new Map<string, string[]>();
    plan.planned.forEach(item => {
      const arr = grouped.get(item.installer.name) || [];
      arr.push(item.ticket.id);
      grouped.set(item.installer.name, arr);
    });

    let dispatched = 0;
    grouped.forEach((ids, instName) => {
      const r = bulkAssignPersonnel(ids, currentUser.name, instName);
      if (r.success) dispatched += r.count;
    });

    setSelectedTicketIds([]);
    const skippedNote = plan.skipped.length > 0 ? ` (${plan.skipped.length} WO dilewati karena kuota penuh)` : '';
    triggerNotice('success', `Auto-Balance Slot selesai: ${dispatched} WO didistribusikan merata ke teknisi siaga${skippedNote}.`);
    toast.success(`${dispatched} WO berhasil di-balance berdasarkan slot & sisa kuota${skippedNote}.`, 'Auto-Balance Slot');
  };

  // Direct Assign from Right Sidebar Technician Card
  const handleDirectAssignToTechnician = (installer: User) => {
    if (!isLeaderRole) return;
    if (selectedTicketIds.length > 0) {
      const res = bulkAssignPersonnel(selectedTicketIds, currentUser.name, installer.name);
      if (res.success) {
        setSelectedTicketIds([]);
        triggerNotice('success', `${res.count} WO terpilih berhasil ditugaskan langsung ke ${installer.name}.`);
      }
      return;
    }
    const firstUnassigned = filteredTickets.find(t => !t.installerName) || todayContractorTickets.find(t => !t.installerName);
    if (!firstUnassigned) {
      toast.info('Tidak ada WO Unassigned yang tersedia untuk ditugaskan saat ini.', 'Semua Terjadwal');
      return;
    }
    handleAssignTicket(firstUnassigned, installer.name, firstUnassigned.slotTime);
  };

  // Bulk Reassign Execution via POST /api/tickets/bulk-reassign
  const handleExecuteBulkReassignModal = async (payload: {
    ticketIds: string[];
    targetInstaller: User;
    reason: string;
  }) => {
    if (!isLeaderRole) return;
    setIsSubmittingBulkReassign(true);
    const res = await executeBulkReassignApi({
      ticketIds: payload.ticketIds,
      newInstallerName: payload.targetInstaller.name,
      newInstallerId: payload.targetInstaller.id,
      reason: payload.reason
    });
    setIsSubmittingBulkReassign(false);

    if (!res.success) {
      toast.error(res.error || 'Gagal menjalankan Bulk Reassign.', 'Bulk Reassign Gagal');
      return;
    }

    setIsBulkReassignModalOpen(false);
    setSelectedTicketIds([]);
    await Promise.all([refreshActiveTickets(), reloadAssignmentFeed()]);
    triggerNotice('success', res.message || `Berhasil mereassign ${res.count} WO ke ${payload.targetInstaller.name}.`);
    toast.success(res.message || `Berhasil mereassign ${res.count} WO ke ${payload.targetInstaller.name}.`, 'Bulk Reassign Sukses');
  };

  // Export handlers (Copy, CSV, Excel, Print)
  const handleExportCopy = () => {
    if (sortedTickets.length === 0) return;
    const headers = ['WO Number', 'Tanggal', 'Customer ID', 'Customer Name', 'Phone', 'Slot', 'Cluster', 'Street', 'Teknisi', 'Status'];
    const rows = sortedTickets.map(t => [
      t.woNumber,
      t.appointmentDate || '-',
      t.idCustomer,
      t.customerName,
      t.customerPhone,
      t.slotTime,
      t.clusterName || '-',
      t.streetName || '-',
      t.installerName || 'Unassigned',
      t.statusWOInstaller
    ]);
    const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(tsv);
    toast.success(`${sortedTickets.length} baris data berhasil disalin ke clipboard (TSV format).`, 'Data Disalin');
  };

  const handleExportCSV = () => {
    if (sortedTickets.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(
      sortedTickets.map(t => ({
        'WO Number': t.woNumber,
        'Tanggal WO': t.appointmentDate || '',
        'Appointment Date': t.appointmentDate || '',
        'Customer ID': t.idCustomer,
        'Customer Name': t.customerName,
        'Customer Phone': t.customerPhone,
        'Area': t.area,
        'Cluster Name': t.clusterName || '',
        'Street Name': t.streetName || '',
        'Slot Time': t.slotTime,
        'Ticket Category': t.ticketCategory,
        'Teknisi': t.installerName || 'Unassigned',
        'Status Installer': t.statusWOInstaller,
        'Status Agent': t.statusWOAgent
      }))
    );
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assign_data_wo_${leaderContractor.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Berkas CSV berhasil diunduh.', 'Ekspor CSV');
  };

  const handleExportExcel = () => {
    if (sortedTickets.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(
      sortedTickets.map(t => ({
        'WO Number': t.woNumber,
        'Tanggal WO': t.appointmentDate || '',
        'Appointment Date': t.appointmentDate || '',
        'Customer ID': t.idCustomer,
        'Customer Name': t.customerName,
        'Customer Phone': t.customerPhone,
        'Area': t.area,
        'Cluster Name': t.clusterName || '',
        'Street Name': t.streetName || '',
        'Slot Time': t.slotTime,
        'Ticket Category': t.ticketCategory,
        'Teknisi': t.installerName || 'Unassigned',
        'Status Installer': t.statusWOInstaller,
        'Status Agent': t.statusWOAgent,
        'Remarks': t.remarksWOInstaller || ''
      }))
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Assign WO Data');
    XLSX.writeFile(
      workbook,
      `Assign_Data_WO_${leaderContractor.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    toast.success('Berkas Excel (.xlsx) berhasil diunduh.', 'Ekspor Excel');
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = () => {
    window.print();
  };

  const handleApplyDateSearch = () => {
    setAppliedDateStart(customDateStart);
    setAppliedDateEnd(customDateEnd);
    setCurrentPage(1);
    toast.info(`Menampilkan Work Order tanggal ${customDateStart} s/d ${customDateEnd}.`, 'Filter Tanggal');
  };

  const handleResetDateToday = () => {
    setCustomDateStart(todayWIB);
    setCustomDateEnd(todayWIB);
    setAppliedDateStart(todayWIB);
    setAppliedDateEnd(todayWIB);
    setCurrentPage(1);
    toast.info(`Menampilkan Work Order hari ini (${todayWIB}).`, 'Filter Hari Ini');
  };

  // Check if column is visible and get ordered visible columns
  const isColVisible = (id: string) => {
    const col = tableColumns.find(c => c.id === id);
    return col ? col.visible : true;
  };
  const visibleColumns = useMemo(() => tableColumns.filter(c => c.visible), [tableColumns]);

  const renderHeaderCell = (col: ColumnConfig) => {
    switch (col.id) {
      case 'checkbox':
        return (
          <th key={col.id} className="py-2.5 px-3 text-center w-8">
            <input
              type="checkbox"
              checked={
                sortedTickets.length > 0 &&
                selectedTicketIds.length === sortedTickets.length
              }
              onChange={handleSelectAll}
              className="w-4 h-4 accent-[#5145A6] rounded border-[#CBD5E1] dark:border-[#4b386b] cursor-pointer"
            />
          </th>
        );
      case 'woNumber':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[130px]">
            <SortableColumnHeader
              label="WO Number"
              columnKey="woNumber"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="wo_number"
              onSort={handleSort}
            />
          </th>
        );
      case 'date':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[120px]">
            <SortableColumnHeader
              label="Tanggal WO"
              columnKey="date"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="date"
              onSort={handleSort}
            />
          </th>
        );
      case 'idCustomer':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[110px]">
            <SortableColumnHeader
              label="Customer ID"
              columnKey="idCustomer"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="number"
              onSort={handleSort}
            />
          </th>
        );
      case 'customerName':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[150px]">
            <SortableColumnHeader
              label="Nama Pelanggan"
              columnKey="customerName"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="text"
              onSort={handleSort}
            />
          </th>
        );
      case 'customerPhone':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[120px]">
            <SortableColumnHeader
              label="Kontak"
              columnKey="customerPhone"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="text"
              onSort={handleSort}
            />
          </th>
        );
      case 'area':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[100px]">
            <SortableColumnHeader
              label="Area"
              columnKey="area"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="text"
              onSort={handleSort}
            />
          </th>
        );
      case 'clusterName':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[130px]">
            <SortableColumnHeader
              label="Cluster"
              columnKey="clusterName"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="text"
              onSort={handleSort}
            />
          </th>
        );
      case 'streetName':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[180px]">
            <SortableColumnHeader
              label="Alamat / Street Name"
              columnKey="streetName"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="text"
              onSort={handleSort}
            />
          </th>
        );
      case 'appointmentDate':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[130px]">
            <SortableColumnHeader
              label="Appointment"
              columnKey="appointmentDate"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="date"
              onSort={handleSort}
            />
          </th>
        );
      case 'slotTime':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[120px] whitespace-nowrap">
            <SortableColumnHeader
              label="Slot Time"
              columnKey="slotTime"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="time_slot"
              onSort={handleSort}
            />
          </th>
        );
      case 'contractor':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[130px]">
            <SortableColumnHeader
              label="Kontraktor"
              columnKey="contractor"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="text"
              onSort={handleSort}
            />
          </th>
        );
      case 'installer':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[170px]">
            <SortableColumnHeader
              label="Teknisi / Installer"
              columnKey="installer"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="text"
              onSort={handleSort}
            />
          </th>
        );
      case 'status':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[130px]">
            <SortableColumnHeader
              label="Status WO"
              columnKey="status"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="status"
              onSort={handleSort}
            />
          </th>
        );
      case 'workStatus':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[120px] text-center">
            <SortableColumnHeader
              label="Status Kerja"
              columnKey="workStatus"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="text"
              onSort={handleSort}
            />
          </th>
        );
      case 'checkInAt':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[120px]">
            <SortableColumnHeader
              label="Check-in"
              columnKey="checkInAt"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="date"
              onSort={handleSort}
            />
          </th>
        );
      case 'checkOutAt':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[120px]">
            <SortableColumnHeader
              label="Check-out"
              columnKey="checkOutAt"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="date"
              onSort={handleSort}
            />
          </th>
        );
      case 'workDuration':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[110px]">
            <SortableColumnHeader
              label="Durasi Kerja"
              columnKey="workDuration"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="number"
              onSort={handleSort}
            />
          </th>
        );
      case 'progress':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[130px]">
            <SortableColumnHeader
              label="Progress"
              columnKey="progress"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="number"
              onSort={handleSort}
            />
          </th>
        );
      case 'lastUpdate':
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[120px]">
            <SortableColumnHeader
              label="Update"
              columnKey="lastUpdate"
              currentSortColumn={sortState.column}
              currentDirection={sortState.direction}
              dataType="date"
              onSort={handleSort}
            />
          </th>
        );
      case 'action':
        return (
          <th key={col.id} className="py-2.5 px-3 text-center min-w-[120px]">
            Action
          </th>
        );
      default:
        return (
          <th key={col.id} className="py-2.5 px-3 min-w-[100px]">
            {col.label}
          </th>
        );
    }
  };

  const renderBodyCell = (
    col: ColumnConfig,
    t: Ticket,
    isSelected: boolean,
    isExpanded: boolean,
    label: string,
    progressPercent: number
  ) => {
    switch (col.id) {
      case 'checkbox':
        return (
          <td key={col.id} className="py-2.5 px-3 text-center">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => handleToggleSelectTicket(t.id)}
              className="w-4 h-4 accent-[#5145A6] rounded border-[#CBD5E1] dark:border-[#4b386b] cursor-pointer"
            />
          </td>
        );
      case 'woNumber':
        return (
          <td key={col.id} className="py-2.5 px-3 font-mono font-semibold">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleRowExpansion(t.id)}
                className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
                title="Buka / Tutup Rincian Alamat & Teknis"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
              <span
                onClick={() => onSelectTicket(t)}
                className="text-[#5145A6] dark:text-[#dab9ff] hover:underline cursor-pointer"
              >
                {t.woNumber}
              </span>
            </div>
          </td>
        );
      case 'date':
        return (
          <td key={col.id} className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
            {t.date || '-'}
          </td>
        );
      case 'idCustomer':
        return (
          <td key={col.id} className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
            {t.idCustomer}
          </td>
        );
      case 'customerName':
        return (
          <td key={col.id} className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">
            {t.customerName}
          </td>
        );
      case 'customerPhone':
        return (
          <td key={col.id} className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
            {t.customerPhone}
          </td>
        );
      case 'area':
        return (
          <td key={col.id} className="py-2.5 px-3">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-semibold bg-[#DDF4F4] text-[#2E7D8B] dark:bg-purple-950 dark:text-purple-300 border border-[#BDE4E8] dark:border-purple-800">
              {t.area || '-'}
            </span>
          </td>
        );
      case 'clusterName':
        return (
          <td key={col.id} className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
            {t.clusterName || '-'}
          </td>
        );
      case 'streetName':
        return (
          <td key={col.id} className="py-2.5 px-3 text-slate-600 dark:text-slate-400 max-w-xs">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openCustomerAddressInGoogleMaps(t);
              }}
              className="flex items-center gap-1.5 text-left text-slate-700 dark:text-slate-200 hover:text-[#5145A6] dark:hover:text-purple-300 transition-colors group cursor-pointer max-w-full"
              title="Klik untuk membuka lokasi di Google Maps"
            >
              <MapPin className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-purple-400 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="truncate group-hover:underline">{t.streetName || t.clusterName || '-'}</span>
            </button>
          </td>
        );
      case 'appointmentDate':
        return (
          <td key={col.id} className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-700 dark:text-slate-300">
            {t.appointmentDate || '-'}
          </td>
        );
      case 'slotTime':
        return (
          <td key={col.id} className="py-2.5 px-3 font-medium whitespace-nowrap text-slate-800 dark:text-slate-200">
            {t.slotTime}
          </td>
        );
      case 'contractor':
        return (
          <td key={col.id} className="py-2.5 px-3 text-slate-500">
            {t.contactorName || t.contractorName || '-'}
          </td>
        );
      case 'installer':
        return (
          <td key={col.id} className="py-2.5 px-3">
            <select
              value={t.installerName || ''}
              disabled={!isLeaderRole}
              onChange={e => {
                if (isLeaderRole && e.target.value !== t.installerName) {
                  handleAssignTicket(t, e.target.value, t.slotTime);
                }
              }}
              title={isLeaderRole ? 'Pilih teknisi pelaksana' : 'Hanya Leader yang berwenang melakukan assign teknisi'}
              className={`w-full px-2 py-1 text-xs rounded-lg border font-medium ${
                !isLeaderRole ? 'opacity-70 cursor-not-allowed ' : ''
              }${
                t.installerName
                  ? 'bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white border-[#DDE6F0] dark:border-[#4b386b]'
                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800 font-bold'
              }`}
            >
              <option value="">{t.installerName ? 'Ganti Teknisi...' : 'Pilih Teknisi...'}</option>
              {myInstallers.map(inst => {
                const targetDate = t.appointmentDate || scheduleDate;
                const currentCount = getInstallerWOCountForDate(inst.name, targetDate);
                const maxLimit = getMaxQuotaForInstaller(inst.name);
                return (
                  <option key={inst.id} value={inst.name}>
                    {inst.name} ({currentCount}/{maxLimit} WO)
                  </option>
                );
              })}
            </select>
          </td>
        );
      case 'status':
        return (
          <td key={col.id} className="py-2.5 px-3 whitespace-nowrap">
            <StatusInstallerBadge status={t.statusWOInstaller} />
          </td>
        );
      case 'workStatus': {
        const ws = getTicketWorkStatus(t);
        return (
          <td key={col.id} className="py-2.5 px-3 text-center whitespace-nowrap">
            <StatusBadge
              status={
                ws.status === 'Selesai'
                  ? 'CHECK-OUT'
                  : ws.status === 'Sedang Dikerjakan'
                  ? 'PROGRESS'
                  : 'BELUM CHECK-IN'
              }
              variant="checkin"
            />
          </td>
        );
      }
      case 'checkInAt':
        return (
          <td key={col.id} className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
            {t.checkInAt ? formatJakartaTimeOnly(t.checkInAt) : '-'}
          </td>
        );
      case 'checkOutAt':
        return (
          <td key={col.id} className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
            {t.checkOutAt ? formatJakartaTimeOnly(t.checkOutAt) : '-'}
          </td>
        );
      case 'workDuration':
        return (
          <td key={col.id} className="py-2.5 px-3 text-[11px] font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
            {getTicketWorkStatus(t).durationFormatted}
          </td>
        );
      case 'progress':
        return (
          <td key={col.id} className="py-2.5 px-3 align-middle">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold text-slate-600 dark:text-slate-400">{label}</span>
                <span className="font-mono font-bold">{progressPercent}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    progressPercent === 100
                      ? 'bg-emerald-500'
                      : progressPercent > 50
                      ? 'bg-[#6657C8]'
                      : progressPercent > 0
                      ? 'bg-amber-500'
                      : 'bg-[#E4ECF5] dark:bg-[#35105E]'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </td>
        );
      case 'lastUpdate':
        return (
          <td key={col.id} className="py-2.5 px-3 font-mono text-[10.5px] text-slate-400 whitespace-nowrap">
            {t.updatedAt?.slice(5, 16).replace('T', ' ') || '-'}
          </td>
        );
      case 'action':
        return (
          <td key={col.id} className="py-2.5 px-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => onSelectTicket(t)}
                className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg text-xs cursor-pointer"
              >
                Detail
              </button>

              {onOpenWhatsApp && (
                <button
                  type="button"
                  onClick={() => onOpenWhatsApp(t)}
                  className="mj-btn-icon-3d-wa w-8 h-8 cursor-pointer"
                  title="Kirim pesan WhatsApp pelanggan"
                >
                  <Phone className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </td>
        );
      default:
        return (
          <td key={col.id} className="py-2.5 px-3">
            {String((t as any)[col.id] || '-')}
          </td>
        );
    }
  };

  const todayAppointmentDisplay = useMemo(() => {
    try {
      const [y, m, d] = String(todayWIB || '').split('-').map(Number);
      if (y && m && d) {
        return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          timeZone: 'UTC'
        });
      }
    } catch {}
    return todayWIB;
  }, [todayWIB]);

  const activeAssignedEligibleForReassign = useMemo(() => {
    return todayContractorTickets.filter(
      t =>
        Boolean(t.installerName) &&
        t.statusWOInstaller !== 'Completed' &&
        t.statusWOInstaller !== 'Installed' &&
        t.statusWOAgent !== 'Closed'
    );
  }, [todayContractorTickets]);

  const realtimeBadgeLabel =
    databaseStatus === 'connected' && syncStatus === 'SAVED'
      ? `Realtime SSE Aktif${quotaApiLatencyMs ? ` (${quotaApiLatencyMs}ms)` : ''}`
      : syncStatus === 'SYNCING' || syncStatus === 'LOADING'
      ? 'Sinkronisasi Database...'
      : databaseStatus === 'offline'
      ? 'Mode Offline'
      : 'Menghubungkan SSE...';

  const isStandaloneFocusedTab =
    activeTab === 'dashboard' ||
    activeTab === 'installer_mgmt' ||
    activeTab === 'progress_dashboard' ||
    activeTab === 'contractor_recap' ||
    activeTab === 'reassign_wo';

  return (
    <div className="space-y-4">
      {/* ============================================================ */}
      {/* 1. LEADER CONTEXT & OPERATIONAL HEADER (STITCH DESIGN)       */}
      {/* ============================================================ */}
      {!isStandaloneFocusedTab && (
        <>
          <div className={`flex flex-col justify-between gap-3.5 ${isCompactUI ? '' : 'lg:flex-row lg:items-end'}`}>
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#dab9ff]">
                  ANTREAN LAPANGAN
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    databaseStatus === 'connected'
                      ? 'bg-[#dcfce7] dark:bg-emerald-950/60 text-[#15803d] dark:text-emerald-300'
                      : 'bg-[#fef3c7] dark:bg-amber-950/60 text-[#b45309] dark:text-amber-300'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      databaseStatus === 'connected' ? 'bg-[#16A36A] animate-pulse' : 'bg-[#d97706]'
                    }`}
                  />
                  <span>{realtimeBadgeLabel}</span>
                </span>
              </div>

              <h1
                className="text-xl sm:text-2xl font-extrabold text-[#26364A] dark:text-white tracking-tight leading-tight"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {activeTab === 'quota_settings' ? 'Manajemen Kuota & Kolom' : 'Penugasan Perintah Kerja'}
              </h1>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                <span className="inline-flex items-center gap-1 font-semibold text-[#26364A] dark:text-white">
                  <Building2 className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                  {displayContractor}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-[#2E7D8B] dark:text-[#dab9ff]" />
                  {displayArea} ({clusterOptions.length || 1} Cluster)
                </span>
                <span>·</span>
                <span className="font-mono tabular-nums">WIB {todayAppointmentDisplay}</span>
              </div>
            </div>

            {/* Right Action Cluster: Primary Smart Dispatch + Secondary Tools */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isLeaderRole && activeTab === 'wo_assignment' && (
                <button
                  type="button"
                  onClick={handleExecuteAutoBalance}
                  className="mj-btn-leader-primary px-4 py-2 rounded-2xl text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  title="Smart Dispatch: Distribusikan otomatis WO Unassigned sesuai slot waktu & kuota terendah"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Smart Dispatch</span>
                </button>
              )}

              <button
                type="button"
                disabled={!isLeaderRole}
                onClick={() => setIsUploadAssignModalOpen(true)}
                className="mj-btn-leader-neutral px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <FileUp className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                <span className="hidden sm:inline">Upload Assign</span>
                <span className="sm:hidden">Upload</span>
              </button>

              {activeTab !== 'wo_assignment' && (
                <button
                  type="button"
                  disabled={!isLeaderRole}
                  onClick={() => setIsBulkReassignModalOpen(true)}
                  className="mj-btn-leader-neutral px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                  <span className="hidden sm:inline">Bulk Reassign</span>
                  <span className="sm:hidden">Reassign</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsDailyLimitModalOpen(true)}
                className="mj-btn-leader-neutral px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Sliders className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                <span className="hidden sm:inline">Limit Harian</span>
                <span className="sm:hidden">Limit</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                className="mj-btn-leader-neutral px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                <span>Export</span>
              </button>

              <button
                type="button"
                onClick={() => setIsChangePasswordModalOpen(true)}
                className="mj-btn-leader-neutral px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                title="Ganti Password Akun Leader"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                <span className="hidden sm:inline">Ganti Password</span>
                <span className="sm:hidden">Password</span>
              </button>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 2. RESPONSIVE KPI STRIP (3 Compact Mobile / 6 Desktop)       */}
          {/* ============================================================ */}
          <div className={`grid gap-2.5 sm:gap-3 ${isCompactUI ? 'grid-cols-3' : 'grid-cols-3 lg:grid-cols-6'}`}>
            {/* Mobile Compact 1 / Desktop 2: Unassigned */}
            <div
              onClick={() => {
                setStatusFilter('unassigned');
                setActiveTab('wo_assignment');
                setCurrentPage(1);
              }}
              className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.04)] flex flex-col justify-between cursor-pointer hover:border-[#6657C8] transition-all"
            >
              <div className="flex items-center justify-between gap-1 text-[#52647A] dark:text-[#CEC0E8]">
                <span className="text-[10.5px] font-bold truncate">Unassigned</span>
                <AlertCircle className="w-3.5 h-3.5 text-[#d97706] shrink-0" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span
                  className="text-xl sm:text-2xl font-extrabold text-[#26364A] dark:text-white tabular-nums"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {summaryMetrics.unassigned}
                </span>
                <span className="text-[10.5px] font-bold text-[#ba1a1a] dark:text-rose-400">WO</span>
              </div>
              <div className="mt-2 w-full h-1.5 bg-[#EAE8FF] dark:bg-[#2C1A4E] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#6657C8] rounded-full"
                  style={{ width: `${summaryMetrics.total > 0 ? Math.min(100, Math.round((summaryMetrics.unassigned / summaryMetrics.total) * 100)) : 0}%` }}
                />
              </div>
            </div>

            {/* Mobile Compact 2 / Desktop 4: Teknisi Ready */}
            <div
              onClick={() => setActiveTab('installer_mgmt')}
              className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.04)] flex flex-col justify-between cursor-pointer hover:border-[#16A36A] transition-all"
            >
              <div className="flex items-center justify-between gap-1 text-[#52647A] dark:text-[#CEC0E8]">
                <span className="text-[10.5px] font-bold truncate">Teknisi Ready</span>
                <Users2 className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span
                  className="text-xl sm:text-2xl font-extrabold text-[#26364A] dark:text-white tabular-nums"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {summaryMetrics.activeInstallers}
                </span>
                <span className="text-[11px] font-semibold text-[#8492A5] dark:text-[#A79BC0] tabular-nums">
                  / {myInstallers.length}
                </span>
              </div>
              <div className="mt-2 w-full h-1.5 bg-[#E4ECF5] dark:bg-[#2C1A4E] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#16A36A] rounded-full"
                  style={{ width: `${myInstallers.length > 0 ? Math.min(100, Math.round((summaryMetrics.activeInstallers / myInstallers.length) * 100)) : 0}%` }}
                />
              </div>
            </div>

            {/* Mobile Compact 3 / Desktop 6: Avg SLA */}
            <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.04)] flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1 text-[#52647A] dark:text-[#CEC0E8]">
                <span className="text-[10.5px] font-bold truncate">Avg SLA</span>
                <Clock className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#dab9ff] shrink-0" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span
                  className="text-xl sm:text-2xl font-extrabold text-[#26364A] dark:text-white tabular-nums"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {avgAssignSlaMinutes}
                </span>
                <span className="text-[11px] font-semibold text-[#8492A5] dark:text-[#A79BC0]">mnt</span>
              </div>
              <div className="mt-2 w-full h-1.5 bg-[#DDF4F4] dark:bg-[#2C1A4E] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${avgAssignSlaMinutes <= 30 ? 'bg-[#2E7D8B]' : 'bg-[#d97706]'}`}
                  style={{ width: `${avgAssignSlaMinutes > 0 ? Math.min(100, Math.round((avgAssignSlaMinutes / 60) * 100)) : 12}%` }}
                />
              </div>
            </div>

            {/* Desktop Extra KPIs (hidden in Mobile Mode for clean 3-card density) */}
            {!isCompactUI && (
              <>
                <div
                  onClick={() => {
                    setStatusFilter('all');
                    setActiveTab('wo_assignment');
                  }}
                  className="hidden lg:flex bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.04)] flex-col justify-between cursor-pointer hover:border-[#6657C8] transition-all"
                >
                  <div className="flex items-center justify-between gap-1 text-[#52647A] dark:text-[#CEC0E8]">
                    <span className="text-[10.5px] font-bold truncate">Total WO</span>
                    <Calendar className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff] shrink-0" />
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold text-[#26364A] dark:text-white tabular-nums">
                      {summaryMetrics.total}
                    </span>
                    <span className="text-[11px] font-semibold text-[#8492A5]">Hari Ini</span>
                  </div>
                  <div className="text-[10.5px] text-[#8492A5] mt-1 tabular-nums">{todayAppointmentDisplay}</div>
                </div>

                <div
                  onClick={() => {
                    setStatusFilter('all');
                    setActiveTab('reassign_wo');
                    setCurrentPage(1);
                  }}
                  className="hidden lg:flex bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.04)] flex-col justify-between cursor-pointer hover:border-[#6657C8] transition-all"
                >
                  <div className="flex items-center justify-between gap-1 text-[#52647A] dark:text-[#CEC0E8]">
                    <span className="text-[10.5px] font-bold truncate">Assigned</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff] shrink-0" />
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1.5">
                    <span className="text-2xl font-extrabold text-[#5145A6] dark:text-[#dab9ff] tabular-nums">
                      {summaryMetrics.assigned}
                    </span>
                    <span className="text-[11px] font-bold text-[#16A36A] tabular-nums">
                      {summaryMetrics.total > 0 ? Math.round((summaryMetrics.assigned / summaryMetrics.total) * 100) : 0}%
                    </span>
                  </div>
                  <div className="text-[10.5px] text-[#8492A5] mt-1 truncate">
                    Ke {assignedTechnicianCount} Teknisi
                  </div>
                </div>

                <div
                  onClick={() => setIsDailyLimitModalOpen(true)}
                  className="hidden lg:flex bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.04)] flex-col justify-between cursor-pointer hover:border-[#6657C8] transition-all"
                >
                  <div className="flex items-center justify-between gap-1 text-[#52647A] dark:text-[#CEC0E8]">
                    <span className="text-[10.5px] font-bold truncate">Utilisasi Kuota</span>
                    <Gauge className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#dab9ff] shrink-0" />
                  </div>
                  <div className="mt-1.5">
                    <span className="text-2xl font-extrabold text-[#26364A] dark:text-white tabular-nums">
                      {quotaUtilizationPct}%
                    </span>
                  </div>
                  <div className="mt-2 w-full h-1.5 bg-[#EAE8FF] dark:bg-[#2C1A4E] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        quotaUtilizationPct >= 95
                          ? 'bg-[#ba1a1a]'
                          : quotaUtilizationPct >= 80
                          ? 'bg-[#6657C8]'
                          : 'bg-[#16A36A]'
                      }`}
                      style={{ width: `${Math.min(100, quotaUtilizationPct)}%` }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/* 3. NAVIGATION SWITCHER (DESKTOP SEGMENTED + MOBILE SUB-TABS) */}
      {/* ============================================================ */}
      {!isCompactUI ? (
        <div className="hidden md:flex items-center gap-1.5 p-1 rounded-2xl bg-[#EDF3F8] dark:bg-[#1A0E2E] border border-[#DDE6F0] dark:border-[#35105E] overflow-x-auto scrollbar-none">
          {[
            { id: 'wo_assignment' as const, label: 'Assign WO', badge: summaryMetrics.unassigned, icon: Layers },
            { id: 'reassign_wo' as const, label: 'Reassign WO', badge: activeAssignedEligibleForReassign.length, icon: ArrowRightLeft },
            { id: 'progress_dashboard' as const, label: 'Progress Live', icon: Activity },
            { id: 'installer_mgmt' as const, label: 'Tim Teknisi', badge: myInstallers.length, icon: UserPlus },
            { id: 'contractor_recap' as const, label: 'Rekap Mitra', icon: FileText }
          ].map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 cursor-pointer transition-all ${
                  isActive
                    ? 'bg-white dark:bg-[#342b4e] text-[#5145A6] dark:text-[#dab9ff] shadow-[0_2px_6px_rgba(38,54,74,0.08)]'
                    : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#26364A] dark:hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-extrabold tabular-nums ${
                      item.id === 'wo_assignment' && item.badge > 0
                        ? 'bg-[#d97706] text-white'
                        : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (activeTab === 'wo_assignment' || activeTab === 'reassign_wo') ? (
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#EDF3F8] dark:bg-[#1A0E2E] border border-[#DDE6F0] dark:border-[#35105E]">
          <button
            type="button"
            onClick={() => setActiveTab('wo_assignment')}
            className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
              activeTab === 'wo_assignment'
                ? 'bg-white dark:bg-[#342b4e] text-[#5145A6] dark:text-[#dab9ff] shadow-xs'
                : 'text-[#52647A] dark:text-[#CEC0E8]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Assign WO</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-extrabold bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff] tabular-nums">
              {summaryMetrics.unassigned}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reassign_wo')}
            className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
              activeTab === 'reassign_wo'
                ? 'bg-white dark:bg-[#342b4e] text-[#5145A6] dark:text-[#dab9ff] shadow-xs'
                : 'text-[#52647A] dark:text-[#CEC0E8]'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Reassign WO</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-extrabold bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff] tabular-nums">
              {activeAssignedEligibleForReassign.length}
            </span>
          </button>
        </div>
      ) : null}

      {/* Notice Banner */}
      {notice && (
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs shadow-xs transition-all ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : notice.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          {notice.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {notice.type === 'warning' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {notice.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
          <span className="font-medium">{notice.text}</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* DASHBOARD LEADER VIEW (STITCH LEADER COMMAND HUB)            */}
      {/* ============================================================ */}
      {activeTab === 'dashboard' && (
        <StitchLeaderCommandHub
          onNavigate={tab => (onNavigate ? onNavigate(tab) : setActiveTab(tab as LeaderPortalTab))}
          onSelectTicket={onSelectTicket}
          onOpenWhatsApp={onOpenWhatsApp}
          onSwitchLeaderTab={(tab, preset) => {
            if (preset) setStatusFilter(preset);
            setActiveTab(tab);
            setCurrentPage(1);
          }}
        />
      )}

      {/* ============================================================ */}
      {/* TAB 1: ASSIGN WO & SLOT MATRIX (STITCH 2-PANEL WORKSPACE)    */}
      {/* ============================================================ */}
      {activeTab === 'wo_assignment' && (
        <div className="space-y-4">
          {activeKpiDrilldown && (
            <div className="rounded-xl bg-gradient-to-r from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:bg-[#160D29] dark:from-[#160D29] dark:via-[#160D29] dark:to-[#160D29] text-[#26364A] dark:text-white px-4 py-3 border border-[#BDE4E8] dark:border-[#3E246F] flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-[#6657C8] dark:bg-[#7135B5] text-white font-bold text-[10.5px]">
                  Filter KPI Dashboard
                </span>
                <span className="font-bold">
                  {KPI_FILTER_LABELS[activeKpiDrilldown.filterKey] || activeKpiDrilldown.filterKey}
                </span>
                {activeKpiDrilldown.contractor && activeKpiDrilldown.contractor !== 'ALL' && (
                  <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-white/10 text-[#5145A6] dark:text-purple-200 border border-[#DDE6F0] dark:border-transparent font-medium">
                    Vendor: {activeKpiDrilldown.contractor}
                  </span>
                )}
                {activeKpiDrilldown.area && activeKpiDrilldown.area !== 'ALL' && (
                  <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-white/10 text-[#2E7D8B] dark:text-purple-200 border border-[#BDE4E8] dark:border-transparent font-medium">
                    Area: {activeKpiDrilldown.area}
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
                className="mj-btn-leader-neutral mj-btn-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset Filter KPI</span>
              </button>
            </div>
          )}

          <div className={`grid gap-5 items-start ${isCompactUI ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-12'}`}>
            {/* LEFT 8 COLUMNS: FILTER, BULK ACTIONS, CARD MATRIX / TABLE */}
            <div className={isCompactUI ? 'min-w-0' : 'xl:col-span-8 min-w-0'}>
              <LeaderAssignMatrixPanel
                totalScopedCount={summaryMetrics.unassigned}
                slotTicketsSource={todayContractorTickets.filter(t => !t.installerName)}
                filteredTickets={filteredTickets}
                paginatedTickets={paginatedTickets}
                unassignedCount={summaryMetrics.unassigned}
                assignedCount={summaryMetrics.assigned}
                inProgressCount={summaryMetrics.inProgress}
                completedCount={summaryMetrics.completed}
                pendingCount={summaryMetrics.pending}
                problemCount={summaryMetrics.problem}
                clusterOptions={clusterOptions}
                categoryOptions={assignCategoryOptions}
                technicians={technicianSummaries}
                searchQuery={searchQuery}
                onSearchChange={q => {
                  setSearchQuery(q);
                  setCurrentPage(1);
                }}
                slotFilter={slotFilter}
                onSlotFilterChange={s => {
                  setSlotFilter(s);
                  setCurrentPage(1);
                }}
                statusFilter={statusFilter}
                onStatusFilterChange={s => {
                  setStatusFilter(s as LeaderStatusFilter);
                  setCurrentPage(1);
                }}
                categoryFilter={categoryFilter}
                onCategoryFilterChange={cat => {
                  setCategoryFilter(cat);
                  setCurrentPage(1);
                }}
                clusterFilter={clusterFilter}
                onClusterFilterChange={c => {
                  setClusterFilter(c);
                  setCurrentPage(1);
                }}
                installerFilter={selectedInstallerFilter}
                onInstallerFilterChange={inst => {
                  setSelectedInstallerFilter(inst);
                  setCurrentPage(1);
                }}
                onResetFilters={() => {
                  setSearchQuery('');
                  setSlotFilter('ALL');
                  setStatusFilter('all');
                  setCategoryFilter('ALL');
                  setClusterFilter('ALL');
                  setSelectedInstallerFilter('ALL');
                  setActiveKpiDrilldown(null);
                  setSortState({ column: null, direction: null });
                  setCurrentPage(1);
                }}
              selectedTicketIds={selectedTicketIds}
              onToggleSelectTicket={handleToggleSelectTicket}
              onSelectAllUnassigned={checked => {
                const unassignedIds = filteredTickets.filter(t => !t.installerName).map(t => t.id);
                if (checked) {
                  setSelectedTicketIds(prev => Array.from(new Set([...prev, ...unassignedIds])));
                } else {
                  const idSet = new Set(unassignedIds);
                  setSelectedTicketIds(prev => prev.filter(id => !idSet.has(id)));
                }
              }}
              onClearSelection={() => setSelectedTicketIds([])}
              bulkQuickInstaller={bulkQuickInstaller}
              onBulkQuickInstallerChange={setBulkQuickInstaller}
              onExecuteBulkQuickAssign={handleExecuteBulkQuickAssign}
              onExecuteAutoBalance={handleExecuteAutoBalance}
              isLeaderRole={isLeaderRole}
              onInlineAssign={(ticket, installerName) => {
                handleAssignTicket(ticket, installerName, ticket.slotTime);
              }}
              onOpenReassignModal={handleOpenReassignModal}
              onOpenWhatsAppModal={ticket => {
                const instUser = myInstallers.find(u => u.name === ticket.installerName);
                if (instUser) {
                  const msg = buildInstallerAssignmentMessage(ticket, instUser);
                  setAssignmentNoticeModal({
                    ticket,
                    installer: instUser,
                    renderedMessage: msg,
                    targetPhone: instUser.phone || ''
                  });
                } else if (onOpenWhatsApp) {
                  onOpenWhatsApp(ticket);
                } else {
                  onSelectTicket(ticket);
                }
              }}
              onSelectTicket={onSelectTicket}
              visibleColumns={visibleColumns}
              renderHeaderCell={renderHeaderCell}
              renderBodyCell={renderBodyCell}
              expandedRowIds={expandedRowIds}
              classifyTicketOperational={classifyTicketOperational}
              onOpenColumnSettings={() => setIsColumnModalOpen(true)}
              onExportCopy={handleExportCopy}
              onExportCSV={handleExportCSV}
              onExportExcel={handleExportExcel}
              onPrint={handlePrint}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={r => {
                setRowsPerPage(r);
                setCurrentPage(1);
              }}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>

          {/* RIGHT 4 COLUMNS: TECHNICIAN CAPACITY, 4-SLOT MATRIX & AUDIT TRAIL */}
          <div className={isCompactUI ? 'min-w-0' : 'xl:col-span-4 min-w-0'}>
            <LeaderQuotaSidebar
              quotaConfig={quotaSettings}
              technicians={technicianSummaries}
              auditFeed={mergedAuditFeed}
              isLeaderRole={isLeaderRole}
              isSavingQuota={isSavingQuota}
              selectedCount={selectedTicketIds.length}
              hasUnassignedTickets={summaryMetrics.unassigned > 0}
              onToggleStrictEnforcement={nextStrict => {
                saveQuotaSettings({ enforceStrictLimit: nextStrict });
              }}
              onDirectAssignToTechnician={handleDirectAssignToTechnician}
              onSelectTicket={onSelectTicket}
              onOpenAllAuditTrail={() => setIsAuditTrailModalOpen(true)}
              onSelectTechnicianFilter={instName => {
                setSelectedInstallerFilter(prev => (prev === instName ? 'ALL' : instName));
                setCurrentPage(1);
              }}
            />
          </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 1B: REASSIGN WO WORKSPACE (STITCH DESKTOP/MOBILE/EMPTY)  */}
      {/* ============================================================ */}
      {activeTab === 'reassign_wo' && (
        <LeaderReassignView
          todayTickets={todayContractorTickets.filter(t => Boolean(t.installerName))}
          todayWIB={todayWIB}
          todayAppointmentDisplay={todayAppointmentDisplay}
          displayContractor={displayContractor}
          displayArea={displayArea}
          clusterOptions={clusterOptions}
          categoryOptions={reassignCategoryOptions}
          technicians={technicianSummaries}
          installers={myInstallers}
          auditFeed={mergedAuditFeed}
          isLeaderRole={isLeaderRole}
          databaseStatus={databaseStatus}
          syncStatus={syncStatus}
          quotaUtilizationPct={quotaUtilizationPct}
          totalMaxSlots={totalMaxSlots}
          summaryMetrics={summaryMetrics}
          onOpenReassignModal={handleOpenReassignModal}
          onOpenBulkReassign={() => setIsBulkReassignModalOpen(true)}
          onExecuteAutoBalance={handleExecuteAutoBalance}
          onExportExcel={handleExportExcel}
          onOpenAuditTrail={() => setIsAuditTrailModalOpen(true)}
          onSelectTicket={onSelectTicket}
          onRefreshData={async () => {
            await Promise.all([refreshActiveTickets(), reloadAssignmentFeed()]);
            handleRefresh();
          }}
          onJumpToAssignTab={() => setActiveTab('wo_assignment')}
          onJumpToProgressTab={() => setActiveTab('progress_dashboard')}
        />
      )}

      {/* ============================================================ */}
      {/* TAB 2: DASHBOARD PROGRESS WO                                 */}
      {/* ============================================================ */}
      {activeTab === 'progress_dashboard' && (
        <LeaderProgressDashboardView
          onSelectTicket={onSelectTicket}
          onOpenWhatsApp={onOpenWhatsApp}
        />
      )}

      {/* ============================================================ */}
      {/* TAB 3: MANAJEMEN TEKNISI & PENDAFTARAN AKUN (STITCH)         */}
      {/* ============================================================ */}
      {activeTab === 'installer_mgmt' && (
        <LeaderTechnicianManagementView
          displayContractor={displayContractor}
          displayArea={displayArea}
          clusterOptions={clusterOptions}
          technicians={technicianSummaries}
          todayTickets={todayContractorTickets}
          allContractorTickets={contractorTickets}
          isLeaderRole={isLeaderRole}
          onRefresh={() => {
            refreshActiveTickets();
            handleRefresh();
          }}
          onSelectTechnicianDetail={inst => setSelectedInstallerForDetail(inst)}
          onAssignWorkOrderToTechnician={inst => {
            setBulkQuickInstaller(inst.name);
            setStatusFilter('all');
            setActiveTab('wo_assignment');
            setCurrentPage(1);
            toast.info(
              `Pilih WO pada antrean untuk langsung ditugaskan ke ${inst.name}.`,
              'Siap Tugaskan WO'
            );
          }}
          onSelectTicket={onSelectTicket}
          onRegisterInstaller={payload => {
            const res = registerInstallerAccount(payload);
            return { success: res.success, error: res.error };
          }}
        />
      )}

      {/* ============================================================ */}
      {/* TAB: REKAPITULASI AREA & KONTRAKTOR                          */}
      {/* ============================================================ */}
      {activeTab === 'contractor_recap' && (
        <ContractorAreaRecapView />
      )}

      {/* ============================================================ */}
      {/* TAB 4: PENGATURAN KUOTA & KOLOM VISIBILITAS (STITCH)         */}
      {/* ============================================================ */}
      {activeTab === 'quota_settings' && (
        <div className={`grid gap-4 text-xs ${isCompactUI ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-12 items-start'}`}>
          {/* Card 1: Pengaturan Kuota Harian & Limit Teknisi */}
          <div className="lg:col-span-7 bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-5 sm:p-6 shadow-[0_3px_0_#E2E8F0,0_6px_16px_rgba(38,54,74,0.05)] dark:shadow-[0_3px_0_#120826] space-y-5">
            <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-[#E2E8F0] dark:border-[#35105E]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-[#DDF4F4] dark:bg-[#35105E] text-[#2E7D8B] dark:text-[#dab9ff] rounded-xl flex items-center justify-center shrink-0">
                  <Sliders className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3
                    className="font-bold text-sm sm:text-base text-[#26364A] dark:text-white truncate"
                    style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                  >
                    Pengaturan Kuota Harian &amp; Limit Teknisi
                  </h3>
                  <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                    Kontrol distribusi beban kerja harian {displayContractor} · {displayArea}
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-[#EAE8FF] dark:bg-[#2E1B59] border border-[#C5BEEF] dark:border-[#58149C]/50 font-mono text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF] shrink-0 tabular-nums">
                AKTIF: {summaryMetrics.assigned}/{totalMaxSlots} WO
              </span>
            </div>

            {/* 2-Column Numeric Limit & Capacity Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                  <span>Limit Maksimal per Teknisi</span>
                  <Users2 className="w-3.5 h-3.5" />
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    disabled={!isLeaderRole || isSavingQuota}
                    value={quotaSettings.defaultMaxDailyQuota}
                    onChange={e => saveQuotaSettings({ defaultMaxDailyQuota: Number(e.target.value) })}
                    className="tactile-debossed-input w-20 px-3 py-2 bg-white dark:bg-[#1E1238] border border-[#CBD5E1] dark:border-[#4b386b] rounded-xl font-mono font-extrabold text-base text-[#26364A] dark:text-white focus:outline-hidden focus:border-[#6657C8] tabular-nums"
                  />
                  <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8]">
                    WO / TEKNISI
                  </span>
                </div>
                <p className="text-[10.5px] text-[#8492A5] dark:text-[#A493C2]">
                  Kapasitas standar per teknisi sebelum status menjadi penuh.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-[#2E7D8B] dark:text-[#DAB9FF]">
                  <span>Kapasitas Sektor Hari Ini</span>
                  <Gauge className="w-3.5 h-3.5" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-extrabold text-xl text-[#26364A] dark:text-white tabular-nums">
                    {totalMaxSlots}
                  </span>
                  <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8]">
                    SLOT ({technicianSummaries.length} TEKNISI)
                  </span>
                </div>
                <p className="text-[10.5px] text-[#8492A5] dark:text-[#A493C2]">
                  Total kapasitas aktif seluruh installer terdaftar hari ini.
                </p>
              </div>
            </div>

            {/* Utilisasi Kapasitas Tim Gauge */}
            <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-[#26364A] dark:text-white">
                  Utilisasi Kapasitas Tim ({technicianSummaries.length} Teknisi)
                </span>
                <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                  {summaryMetrics.assigned} WO / {totalMaxSlots} Slot Terpakai ({quotaUtilizationPct}%)
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-[#E4ECF5] dark:bg-[#2E1B59] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    quotaUtilizationPct >= 90 ? 'bg-[#BA1A1A]' : 'bg-gradient-to-r from-[#5145A6] to-[#2E7D8B] dark:from-[#58149C] dark:to-[#A380FE]'
                  }`}
                  style={{ width: `${Math.min(100, quotaUtilizationPct)}%` }}
                />
              </div>
            </div>

            {/* Strict Limit Enforcement Card (Crystal Mist Light Mode / Preserved Dark Purple-Maroon Night Mode) */}
            <div className="rounded-2xl bg-gradient-to-br from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:from-[#160D29] dark:via-[#2D115B] dark:to-[#480123] border border-[#BDE4E8] dark:border-[#58149C]/60 text-[#26364A] dark:text-white p-4 space-y-3 shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-white/10 border border-[#C5BEEF] dark:border-white/15 flex items-center justify-center text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="font-bold text-[13px] text-[#26364A] dark:text-white block truncate">
                      Strict Limit Enforcement
                    </span>
                    <span className="text-[11px] text-[#52647A] dark:text-[#E8DDFF]/80 block truncate">
                      Kunci penugasan otomatis jika teknisi mencapai kuota ({quotaSettings.defaultMaxDailyQuota}/{quotaSettings.defaultMaxDailyQuota})
                    </span>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    disabled={!isLeaderRole || isSavingQuota}
                    checked={quotaSettings.enforceStrictLimit}
                    onChange={e => saveQuotaSettings({ enforceStrictLimit: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#CBD5E1] dark:bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#16A36A]" />
                </label>
              </div>
              <div className="rounded-xl bg-white/80 dark:bg-white/8 border border-[#DDE6F0] dark:border-white/12 px-3 py-2 text-[11px] text-[#52647A] dark:text-[#E8DDFF] flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
                <span>
                  {quotaSettings.enforceStrictLimit
                    ? 'Aktif: Sistem memblokir Assign/Reassign ke teknisi berkuota penuh kecuali diberi pengecualian manual di bawah ini.'
                    : 'Nonaktif: Leader masih dapat menugaskan WO melebihi kuota dengan peringatan konfirmasi.'}
                </span>
              </div>
            </div>

            {/* Pengecualian & Custom Limit Per Teknisi */}
            <div className="space-y-2.5 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-xs text-[#26364A] dark:text-white">
                    Pengecualian &amp; Penyesuaian Kapasitas Teknisi
                  </h4>
                  <span className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                    {Object.keys(quotaSettings.customInstallerLimits || {}).length} override kuota khusus tersimpan
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDailyLimitModalOpen(true)}
                  className="mj-btn-leader-neutral mj-btn-compact px-3.5 py-2 text-[#5145A6] dark:text-[#dab9ff] text-xs cursor-pointer shrink-0"
                >
                  Kelola Custom Limit
                </button>
              </div>

              {Object.keys(quotaSettings.customInstallerLimits || {}).length > 0 && (
                <div className="rounded-xl border border-[#DDE6F0] dark:border-[#35105E] divide-y divide-[#E2E8F0] dark:divide-[#35105E] overflow-hidden">
                  {Object.entries(quotaSettings.customInstallerLimits || {}).slice(0, 4).map(([instName, limitVal]) => (
                    <div
                      key={instName}
                      className="px-3 py-2 bg-[#F4F7FB] dark:bg-[#160D29] flex items-center justify-between gap-2"
                    >
                      <span className="font-semibold text-[#26364A] dark:text-white truncate">{instName}</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#2E1B59] text-[#5145A6] dark:text-[#DAB9FF] font-mono font-bold text-[10.5px] shrink-0">
                        {limitVal} WO / Hari
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Visibilitas Kolom Tabel */}
          <div className="lg:col-span-5 bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] p-5 sm:p-6 shadow-[0_3px_0_#E2E8F0,0_6px_16px_rgba(38,54,74,0.05)] dark:shadow-[0_3px_0_#120826] space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-[#E2E8F0] dark:border-[#35105E]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff] rounded-xl flex items-center justify-center shrink-0">
                    <Table className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      className="font-bold text-sm sm:text-base text-[#26364A] dark:text-white truncate"
                      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    >
                      Visibilitas Kolom Tabel
                    </h3>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                      Kustomisasi kolom tabel Assign WO &amp; ekspor data
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-[#EAE8FF] dark:bg-[#2E1B59] border border-[#C5BEEF] dark:border-[#58149C]/50 font-mono text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
                  {tableColumns.filter(c => c.visible).length}/{tableColumns.length} AKTIF
                </span>
              </div>

              {/* Quick Inline Checklist of Key Columns */}
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {tableColumns.map(col => {
                  const locked = col.canHide === false;
                  return (
                    <label
                      key={col.id}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border transition-colors ${
                        col.visible
                          ? 'bg-[#F4F7FB] dark:bg-[#160D29] border-[#DDE6F0] dark:border-[#35105E]'
                          : 'bg-white dark:bg-[#1E1238]/60 border-[#E2E8F0] dark:border-[#2E1B59] opacity-70'
                      } ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span className="font-semibold text-[#26364A] dark:text-white truncate">{col.label}</span>
                      <input
                        type="checkbox"
                        checked={col.visible}
                        disabled={locked}
                        onChange={() => {
                          if (locked) return;
                          handleSaveColumns(
                            tableColumns.map(c => (c.id === col.id ? { ...c, visible: !c.visible } : c))
                          );
                        }}
                        className="w-4 h-4 accent-[#5145A6] rounded cursor-pointer shrink-0"
                      />
                    </label>
                  );
                })}
              </div>

              {/* Preview Urutan Kolom Aktif */}
              <div className="rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-3 space-y-2">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                  PREVIEW URUTAN KOLOM AKTIF
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tableColumns
                    .filter(c => c.visible)
                    .slice(0, 8)
                    .map((col, idx) => (
                      <span
                        key={col.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-[#27104A] border border-[#DCE3F2] dark:border-[#5B35B1] text-[10.5px] font-semibold text-[#26364A] dark:text-[#E8DDFF]"
                      >
                        <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF]">{idx + 1}.</span>
                        <span>{col.label}</span>
                      </span>
                    ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsColumnModalOpen(true)}
              className="mj-btn-leader-primary w-full py-2.5 px-4 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sliders className="w-4 h-4" />
              <span>Atur Urutan &amp; Kolom Lengkap</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 1: BULK / MANUAL ASSIGN WO MODAL                      */}
      {/* ============================================================ */}
      {(() => {
        const modalTargetTickets = contractorTickets.filter(t => selectedTicketIds.includes(t.id));
        const firstTicket = modalTargetTickets[0];
        const isSingle = modalTargetTickets.length === 1;

        return (
          <ResponsiveModal
            isOpen={isBulkAssignModalOpen}
            onClose={() => setIsBulkAssignModalOpen(false)}
            size="md"
            mobileVariant="sheet"
            zIndexClass="z-60"
            icon={<UserCheck className="w-5 h-5" />}
            title="Penugasan Work Order ke Teknisi"
            subtitle={`Otorisasi Khusus Leader / Korlap (${selectedTicketIds.length} WO Dipilih)`}
            footer={
              <div className="w-full flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsBulkAssignModalOpen(false)}
                  className="mj-btn-leader-neutral px-4 py-2 text-xs flex items-center justify-center cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={!bulkTargetInstaller}
                  onClick={handleExecuteBulkAssignModal}
                  className="mj-btn-leader-primary px-5 py-2 text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Konfirmasi Penugasan</span>
                </button>
              </div>
            }
          >
            <div className="space-y-4 text-xs">
              <div className="p-3.5 bg-[#F4F7FB] dark:bg-[#21113B] rounded-xl border border-[#DDE6F0] dark:border-purple-800 space-y-2 text-xs">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-purple-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  <span>Rincian Tiket Work Order</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-slate-700 dark:text-slate-300">
                  <div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">1. Nomor WO:</span>
                    <span className="font-mono font-bold text-[#5145A6] dark:text-purple-300 break-all">
                      {isSingle ? firstTicket?.woNumber : `${modalTargetTickets.length} Tiket (${modalTargetTickets.slice(0, 3).map(t => t.woNumber).join(', ')}${modalTargetTickets.length > 3 ? '...' : ''})`}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">2. Nama Pelanggan:</span>
                    <span className="font-semibold text-slate-900 dark:text-white truncate block">
                      {isSingle ? firstTicket?.customerName || '-' : `${modalTargetTickets.length} Pelanggan`}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">3. Appointment Date:</span>
                    <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                      {firstTicket?.appointmentDate || scheduleDate}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">4. Slot Time:</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {bulkSlotTime || firstTicket?.slotTime || 'Standar Operasional'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">5. Kontraktor:</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {firstTicket?.contactorName || firstTicket?.contractorName || leaderContractor}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">6. Area / Coverage:</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {firstTicket?.area || leaderArea}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                  7. Pilih Teknisi Tujuan Penugasan <span className="text-rose-500">*</span>:
                </label>
                <select
                  value={bulkTargetInstaller}
                  onChange={e => setBulkTargetInstaller(e.target.value)}
                  className="tactile-debossed-input w-full px-3 py-2.5 bg-[#F4F7FB] dark:bg-[#160D29] border-2 border-[#DDE6F0] dark:border-purple-800 rounded-xl font-medium text-xs text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] min-h-[44px]"
                >
                  <option value="">Pilih teknisi aktif...</option>
                  {myInstallers.map(inst => {
                    const currentCount = getInstallerWOCountForDate(inst.name, scheduleDate);
                    const maxLimit = getMaxQuotaForInstaller(inst.name);
                    const isFull = currentCount >= maxLimit;
                    return (
                      <option key={inst.id} value={inst.name}>
                        {inst.name} ({currentCount}/{maxLimit} WO){isFull ? ' - KUOTA PENUH' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ubah Slot Waktu Penugasan (Opsional):
                </label>
                <select
                  value={bulkSlotTime}
                  onChange={e => setBulkSlotTime(e.target.value)}
                  className="tactile-debossed-input w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#4b386b] rounded-xl text-xs text-[#26364A] dark:text-white min-h-[40px]"
                >
                  <option value="">Pertahankan slot waktu asli masing-masing tiket</option>
                  {STANDARD_SLOTS.map(slot => (
                    <option key={slot} value={slot}>{slot}</option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-[#EAE8FF]/70 dark:bg-purple-950/40 rounded-xl border border-[#C5BEEF] dark:border-purple-900 text-[11px] text-[#5145A6] dark:text-purple-200">
                Sistem MoraJaws memvalidasi batas beban kerja teknisi ({quotaSettings.defaultMaxDailyQuota} WO/hari). Penugasan hanya dapat dilakukan oleh Leader/Korlap terdaftar.
              </div>
            </div>
          </ResponsiveModal>
        );
      })()}

      {/* ============================================================ */}
      {/* MODAL 2: WHATSAPP ASSIGNMENT CONFIRMATION MODAL             */}
      {/* ============================================================ */}
      <ResponsiveModal
        isOpen={Boolean(assignmentNoticeModal)}
        onClose={() => setAssignmentNoticeModal(null)}
        size="md"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<Phone className="w-4 h-4 text-emerald-600" />}
        title="Konfirmasi WhatsApp Penugasan Teknisi"
        footer={
          assignmentNoticeModal ? (
            <div className="w-full flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setAssignmentNoticeModal(null)}
                className="mj-btn-leader-neutral px-4 py-2 text-xs cursor-pointer"
              >
                Lewati / Selesai
              </button>
              <a
                href={buildWhatsAppClickToChatUrl(
                  assignmentNoticeModal.targetPhone,
                  assignmentNoticeModal.renderedMessage
                ).url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  toast.success('Pesan WhatsApp dibuka di tab baru.', 'WhatsApp Terkirim');
                  setAssignmentNoticeModal(null);
                }}
                className="mj-btn-leader-success px-5 py-2 text-xs flex items-center justify-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Kirim via WhatsApp</span>
              </a>
            </div>
          ) : undefined
        }
      >
        {assignmentNoticeModal && (
          <div className="space-y-3 text-xs">
            <p className="text-slate-600 dark:text-slate-300 text-[11px]">
              Penugasan WO <strong className="font-mono text-[#5145A6] dark:text-[#dab9ff]">{assignmentNoticeModal.ticket.woNumber}</strong> berhasil disimpan di sistem. Kirimkan pesan rincian tugas langsung ke WhatsApp teknisi <strong>{assignmentNoticeModal.installer.name}</strong>:
            </p>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nomor Telepon Teknisi:
              </label>
              <input
                type="text"
                value={assignmentNoticeModal.targetPhone}
                onChange={e => setAssignmentNoticeModal({ ...assignmentNoticeModal, targetPhone: e.target.value })}
                className="tactile-debossed-input w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3E246F] rounded-lg font-mono text-xs text-[#26364A] dark:text-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Pratinjau Pesan Penugasan:
              </label>
              <textarea
                rows={6}
                value={assignmentNoticeModal.renderedMessage}
                onChange={e => setAssignmentNoticeModal({ ...assignmentNoticeModal, renderedMessage: e.target.value })}
                className="tactile-debossed-input w-full p-2.5 bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3E246F] rounded-xl font-mono text-[11px] text-[#26364A] dark:text-white"
              />
            </div>
          </div>
        )}
      </ResponsiveModal>

      {/* ============================================================ */}
      {/* MODAL 3: QUOTA WARNING MODAL                                */}
      {/* ============================================================ */}
      <ResponsiveModal
        isOpen={Boolean(quotaWarningModal)}
        onClose={() => setQuotaWarningModal(null)}
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
        title="Peringatan Batas Kuota Harian"
        subtitle={
          quotaWarningModal
            ? `Teknisi ${quotaWarningModal.installerName} telah mencapai batas beban kerja`
            : undefined
        }
        footer={
          quotaWarningModal ? (
            <div className="w-full flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setQuotaWarningModal(null)}
                className="mj-btn-leader-neutral px-4 py-2 text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const { ticket, installerName, slotTime } = quotaWarningModal;
                  setQuotaWarningModal(null);
                  handleAssignTicket(ticket, installerName, slotTime, true);
                }}
                className="mj-btn-leader-warning px-4 py-2 text-xs cursor-pointer"
              >
                Tetap Tugaskan
              </button>
            </div>
          ) : undefined
        }
      >
        {quotaWarningModal && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1">
            <div>Jumlah WO saat ini: <strong>{quotaWarningModal.currentCount} WO</strong></div>
            <div>Batas Kuota: <strong>{quotaWarningModal.maxLimit} WO / hari</strong></div>
            <div>Apakah Anda yakin ingin tetap menugaskan WO {quotaWarningModal.ticket.woNumber} kepada teknisi ini?</div>
          </div>
        )}
      </ResponsiveModal>

      {/* ============================================================ */}
      {/* MODAL 4: INSTALLER DETAIL 7 TAB MODAL                        */}
      {/* ============================================================ */}
      <InstallerDetailModal
        installer={selectedInstallerForDetail}
        isOpen={Boolean(selectedInstallerForDetail)}
        onClose={() => setSelectedInstallerForDetail(null)}
        contractorTickets={contractorTickets}
        onSelectTicket={onSelectTicket}
        maxDailyQuota={selectedInstallerForDetail ? getMaxQuotaForInstaller(selectedInstallerForDetail.name) : quotaSettings.defaultMaxDailyQuota}
        onQuickAssign={installerName => {
          setBulkTargetInstaller(installerName);
          setIsBulkAssignModalOpen(true);
        }}
      />

      {/* ============================================================ */}
      {/* MODAL 5: COLUMN SETTINGS MODAL                              */}
      {/* ============================================================ */}
      <LeaderColumnSettingsModal
        isOpen={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
        columns={tableColumns}
        onChangeColumns={handleSaveColumns}
        onReset={handleResetColumns}
      />

      {/* ============================================================ */}
      {/* MODAL 6: UPLOAD ASSIGN WO MODAL                             */}
      {/* ============================================================ */}
      <UploadAssignModal
        isOpen={isUploadAssignModalOpen}
        onClose={() => setIsUploadAssignModalOpen(false)}
        contractorTickets={contractorTickets}
        myInstallers={myInstallers}
        onExecuteBulkAssign={assignments => {
          if (!isLeaderRole) {
            toast.error('Hanya akun dengan peran Leader yang berwenang melakukan assign teknisi.', 'Akses Ditolak');
            return;
          }
          assignments.forEach(a => {
            assignTicketPersonnel(a.ticketId, currentUser.name, a.installerName);
          });
          toast.success(`Berhasil memproses penugasan untuk ${assignments.length} Work Order.`, 'Upload Assign Sukses');
        }}
      />

      {/* ============================================================ */}
      {/* MODAL 7: 2-STEP REASSIGN WO MODAL (LEADER ONLY)              */}
      {/* ============================================================ */}
      <LeaderTwoStepReassignModal
        isOpen={Boolean(reassignModalState.isOpen && reassignModalState.ticket)}
        onClose={() => setReassignModalState(prev => ({ ...prev, isOpen: false }))}
        ticket={reassignModalState.ticket}
        technicians={technicianSummaries}
        quotaConfig={quotaSettings}
        currentUser={currentUser}
        displayContractor={displayContractor}
        displayArea={displayArea}
        isLeaderRole={isLeaderRole}
        isSubmitting={reassignModalState.isSubmitting}
        onConfirmReassign={handleConfirmTwoStepReassign}
      />

      {/* ============================================================ */}
      {/* MODAL 8: DAILY LIMIT SETTINGS MODAL (ATUR LIMIT HARIAN)      */}
      {/* ============================================================ */}
      <DailyLimitSettingsModal
        isOpen={isDailyLimitModalOpen}
        onClose={() => setIsDailyLimitModalOpen(false)}
        quotaConfig={quotaSettings}
        technicians={technicianSummaries}
        contractorName={displayContractor}
        isLeaderRole={isLeaderRole}
        isSaving={isSavingQuota}
        onSave={async nextConfig => {
          await saveQuotaSettings(nextConfig);
          setIsDailyLimitModalOpen(false);
        }}
      />

      {/* ============================================================ */}
      {/* MODAL 9: BULK REASSIGN MODAL                                 */}
      {/* ============================================================ */}
      <BulkReassignModal
        isOpen={isBulkReassignModalOpen}
        onClose={() => setIsBulkReassignModalOpen(false)}
        eligibleTickets={activeAssignedEligibleForReassign}
        initialSelectedIds={selectedTicketIds}
        technicians={technicianSummaries}
        isLeaderRole={isLeaderRole}
        isSubmitting={isSubmittingBulkReassign}
        onExecute={handleExecuteBulkReassignModal}
      />

      {/* ============================================================ */}
      {/* MODAL 10: AUDIT TRAIL REASSIGN LENGKAP                       */}
      {/* ============================================================ */}
      <AssignmentAuditTrailModal
        isOpen={isAuditTrailModalOpen}
        onClose={() => setIsAuditTrailModalOpen(false)}
        entries={mergedAuditFeed}
        contractorName={displayContractor}
      />
    </div>
  );
};
