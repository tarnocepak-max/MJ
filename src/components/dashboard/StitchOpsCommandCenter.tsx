import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudDownload,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  Filter,
  GitBranch,
  Hourglass,
  Layers,
  ListFilter,
  Lock,
  MapPin,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  Wrench,
  X,
  XCircle,
  Zap
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { Ticket, WOKpiFilterKey, WOKpiSummary } from '../../types/index.ts';
import {
  computeClientKpiSummary,
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus,
  isTicketAssigned,
  isTicketCheckedIn,
  isTicketClosed
} from '../../services/woLifecycleService';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { formatIndonesianWODate } from '../../services/woDateFilterEngine';
import { buildGoogleMapsSearchUrl, isValidCoordinatePair } from '../../services/mapsService';
import { StatusAgentBadge, StatusApprovalBadge, StatusInstallerBadge } from '../common/Badge';

interface StitchOpsCommandCenterProps {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onDrillDown: (filterKey: WOKpiFilterKey, filters?: { contractor?: string; area?: string }) => void;
}

const FEED_PAGE_SIZE = 6;

const ROLE_CENTER_TITLES: Record<string, string> = {
  super_admin: 'Superadmin KPI & Status Center',
  dispatch: 'Central Dispatch & Verification Center',
  leader: 'Leader Field Dispatch & Assignment Center',
  installer: 'Technician Operations Center'
};

function getInitials(name?: string): string {
  if (!name) return '--';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatDurationMinutesLabel(avgMinutes: number | null): string {
  if (avgMinutes === null || !Number.isFinite(avgMinutes) || avgMinutes <= 0) return 'Belum ada data';
  const rounded = Math.round(avgMinutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}j ${mins}m`;
}

function getTicketHouseGeotagInfo(ticket: Ticket): {
  verified: boolean;
  label: string;
  sublabel: string;
  tone: 'emerald' | 'amber' | 'neutral';
} {
  const houseSlot = ticket.technicalReport?.photoSlots?.find(s => s.slotKey === 'customer_house');
  const hl = ticket.houseLocation;
  const rx = ticket.rosetRedamanDbm ?? ticket.technicalReport?.opticalPowerRx ?? ticket.technicalReport?.opticalPowerDbm;
  const rxLabel = rx !== undefined && rx !== null && String(rx).trim() !== '' ? `Rx: ${rx} dBm` : '';

  const hasValidGeo =
    hl?.geotagStatus === 'valid' ||
    houseSlot?.geotagStatus === 'valid' ||
    (isValidCoordinatePair(hl?.latitude, hl?.longitude)) ||
    (isValidCoordinatePair(houseSlot?.latitude, houseSlot?.longitude));

  const accuracy = hl?.accuracyMeters ?? houseSlot?.gpsAccuracyMeters;
  const accuracyLabel =
    typeof accuracy === 'number' && Number.isFinite(accuracy) ? `±${Math.round(accuracy)}m` : '';

  const photoCount = Array.isArray(ticket.technicalReport?.photoSlots)
    ? ticket.technicalReport!.photoSlots.length
    : Array.isArray(ticket.technicalReport?.photos)
    ? ticket.technicalReport!.photos.length
    : ticket.photoEvidenceCount || 0;

  if (hasValidGeo) {
    return {
      verified: true,
      label: photoCount > 0 ? `Geotag Valid (${photoCount} Foto)` : 'Geotag Valid',
      sublabel: [rxLabel, accuracyLabel].filter(Boolean).join(' · ') || 'Koordinat terverifikasi',
      tone: 'emerald'
    };
  }

  if (hl?.geotagStatus === 'weak' || hl?.geotagStatus === 'gallery_unverified' || houseSlot?.geotagStatus === 'weak') {
    return {
      verified: false,
      label: 'Geotag Perlu Cek',
      sublabel: [rxLabel, accuracyLabel || 'Akurasi GPS rendah'].filter(Boolean).join(' · '),
      tone: 'amber'
    };
  }

  if (rxLabel || photoCount > 0) {
    return {
      verified: false,
      label: photoCount > 0 ? `${photoCount} Foto Terlampir` : 'Optical Tercatat',
      sublabel: rxLabel || 'Menunggu validasi GPS rumah',
      tone: 'neutral'
    };
  }

  return {
    verified: false,
    label: 'Belum Geotag',
    sublabel: ticket.slotTime ? `Slot: ${ticket.slotTime}` : 'Menunggu Check-in lapangan',
    tone: 'neutral'
  };
}

export const StitchOpsCommandCenter: React.FC<StitchOpsCommandCenterProps> = ({
  onNavigate,
  onSelectTicket,
  onDrillDown
}) => {
  const {
    currentUser,
    users,
    scopedTickets,
    kpiSummary,
    overdueSummary,
    auditLogs,
    isKpiLoading,
    todayWIB,
    kpiContractorFilter,
    kpiAreaFilter,
    setKpiContractorFilter,
    setKpiAreaFilter,
    refreshKpiSummary,
    refreshDatabaseData,
    contractorsList,
    areasList,
    databaseStatus,
    syncStatus,
    toast
  } = useApp();
  const { pendingCount } = useOfflineSync();

  const [searchQuery, setSearchQuery] = useState('');
  const [leaderFilter, setLeaderFilter] = useState('ALL');
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [feedPage, setFeedPage] = useState(1);
  const [isSyncing, setIsSyncing] = useState(false);

  const isGlobalRole =
    currentUser.role === 'super_admin' ||
    currentUser.role === 'dispatch';

  const canVerifyReports = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';
  const canAssignTech = currentUser.role === 'super_admin' || currentUser.role === 'leader';

  const roleActionTarget = useMemo(() => {
    if (currentUser.role === 'leader') return 'wo_assignment';
    if (currentUser.role === 'installer') return 'installer_tasks';
    return 'tickets';
  }, [currentUser.role]);

  // All non-deleted, non-archived tickets for todayWIB within user's RBAC scope
  const baseTodayTickets = useMemo(() => {
    return (scopedTickets || []).filter(t => {
      if (!t || t.isDeleted || t.isArchived) return false;
      return getTicketAppointmentDate(t) === todayWIB;
    });
  }, [scopedTickets, todayWIB]);

  // Available filter options from real state & tickets
  const vendorOptions = useMemo(() => {
    const set = new Set<string>(contractorsList || []);
    baseTodayTickets.forEach(t => {
      const v = String(t.contactorName || t.contractorName || '').trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contractorsList, baseTodayTickets]);

  const areaOptions = useMemo(() => {
    const set = new Set<string>(areasList || []);
    baseTodayTickets.forEach(t => {
      const a = String(t.area || '').trim();
      if (a) set.add(a);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [areasList, baseTodayTickets]);

  const leaderOptions = useMemo(() => {
    const set = new Set<string>();
    (users || []).forEach(u => {
      if (u.role === 'leader' && u.active !== false && u.name) {
        set.add(u.name.trim());
      }
    });
    baseTodayTickets.forEach(t => {
      const l = String(t.leaderName || '').trim();
      if (l) set.add(l);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [users, baseTodayTickets]);

  // Filtered today tickets (respects Vendor, Area, Leader, Search)
  const filteredTodayTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return baseTodayTickets.filter(t => {
      if (kpiContractorFilter !== 'ALL') {
        const v = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
        if (v !== kpiContractorFilter.trim().toLowerCase()) return false;
      }
      if (kpiAreaFilter !== 'ALL') {
        const a = String(t.area || '').trim().toLowerCase();
        if (a !== kpiAreaFilter.trim().toLowerCase()) return false;
      }
      if (leaderFilter !== 'ALL') {
        const l = String(t.leaderName || '').trim().toLowerCase();
        if (l !== leaderFilter.trim().toLowerCase()) return false;
      }
      if (q) {
        const haystack = [
          t.woNumber,
          t.idCustomer,
          t.customerName,
          t.oltCode,
          t.fatCode,
          t.fdtCode,
          t.clusterName,
          t.area,
          t.installerName,
          t.streetName,
          t.address
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [baseTodayTickets, kpiContractorFilter, kpiAreaFilter, leaderFilter, searchQuery]);

  // Authoritative summary when no local-only filters (search/leaderFilter) override it; otherwise live filtered computation
  const effectiveSummary: WOKpiSummary = useMemo(() => {
    const hasLocalOnlyFilter = searchQuery.trim() !== '' || leaderFilter !== 'ALL';
    if (!hasLocalOnlyFilter) {
      if (
        kpiSummary &&
        kpiSummary.dateWIB === todayWIB &&
        kpiSummary.contractorFilter === kpiContractorFilter &&
        kpiSummary.areaFilter === kpiAreaFilter
      ) {
        return kpiSummary;
      }
      return computeClientKpiSummary(scopedTickets, currentUser, {
        dateWIB: todayWIB,
        contractorFilter: kpiContractorFilter,
        areaFilter: kpiAreaFilter
      });
    }
    return computeClientKpiSummary(filteredTodayTickets, currentUser, {
      dateWIB: todayWIB,
      contractorFilter: 'ALL',
      areaFilter: 'ALL'
    });
  }, [
    searchQuery,
    leaderFilter,
    kpiSummary,
    todayWIB,
    kpiContractorFilter,
    kpiAreaFilter,
    scopedTickets,
    currentUser,
    filteredTodayTickets
  ]);

  const c = effectiveSummary.counts;

  // Derived real metrics from filteredTodayTickets & users
  const telemetry = useMemo(() => {
    const total = c.totalToday;
    const assignedPct = total > 0 ? Math.round((c.assigned / total) * 1000) / 10 : 0;
    const completedCount = c.approvedDone ?? 0;
    const approvalPct = total > 0 ? Math.round((c.approved / total) * 1000) / 10 : c.approvalRatePct || 0;
    const completionPct = total > 0 ? Math.round((completedCount / total) * 1000) / 10 : c.completionRatePct || 0;

    // Geotag verified count among checked-in or reported tickets
    const checkedInTickets = filteredTodayTickets.filter(t => isTicketCheckedIn(t));
    const geotagVerifiedCount = filteredTodayTickets.filter(t => getTicketHouseGeotagInfo(t).verified).length;
    const geotagPct =
      checkedInTickets.length > 0
        ? Math.min(100, Math.round((geotagVerifiedCount / checkedInTickets.length) * 100))
        : total > 0 && geotagVerifiedCount > 0
        ? Math.min(100, Math.round((geotagVerifiedCount / total) * 100))
        : 0;

    // Top unassigned area/cluster
    const unassignedAreaCounts = new Map<string, number>();
    filteredTodayTickets.forEach(t => {
      if (!isTicketAssigned(t)) {
        const key = String(t.clusterName || t.area || 'Area Umum').trim();
        unassignedAreaCounts.set(key, (unassignedAreaCounts.get(key) || 0) + 1);
      }
    });
    const topUnassigned = Array.from(unassignedAreaCounts.entries()).sort((a, b) => b[1] - a[1])[0];

    // Average workDurationMinutes from tickets that actually have duration
    const durations = filteredTodayTickets
      .map(t => Number(t.workDurationMinutes))
      .filter(n => Number.isFinite(n) && n > 0);
    const avgDurationMinutes =
      durations.length > 0 ? durations.reduce((acc, v) => acc + v, 0) / durations.length : null;

    // Average waiting time (minutes) for BUTUH APPROVAL queue
    const nowMs = Date.now();
    const approvalWaits = filteredTodayTickets
      .filter(t => getTicketCanonicalApprovalStatus(t) === 'BUTUH APPROVAL')
      .map(t => {
        const ts = t.progressReports?.[0]?.timestamp || t.technicalReport?.submittedAt || t.updatedAt;
        const parsed = ts ? new Date(ts).getTime() : NaN;
        if (Number.isNaN(parsed)) return null;
        return Math.max(0, Math.round((nowMs - parsed) / 60000));
      })
      .filter((v): v is number => v !== null);
    const avgApprovalWaitMin =
      approvalWaits.length > 0
        ? Math.round(approvalWaits.reduce((acc, v) => acc + v, 0) / approvalWaits.length)
        : null;

    // Active technicians today vs total active installer accounts
    const totalInstallers = (users || []).filter(u => u.role === 'installer' && u.active !== false).length;
    const activeTechSet = new Set(
      filteredTodayTickets
        .map(t => String(t.installerName || t.installerId || '').trim().toLowerCase())
        .filter(Boolean)
    );

    // Distinct OLT & FAT infrastructure counts in today's filtered tickets
    const oltSet = new Set<string>();
    const fatSet = new Set<string>();
    filteredTodayTickets.forEach(t => {
      if (t.oltCode && String(t.oltCode).trim()) oltSet.add(String(t.oltCode).trim());
      const fat = t.fatCode || t.fat;
      if (fat && String(fat).trim()) fatSet.add(String(fat).trim());
    });

    const totalReported = c.reportComplete + c.reportPending + c.reportReschedule + c.reportCancel;
    const mappedCount = Math.max(0, c.totalToday - c.unmappedDistribution);

    // 7-bar sparkline relative heights
    const sparkStages = [
      c.totalToday,
      c.assigned,
      c.checkedInProgress,
      totalReported,
      c.butuhApproval,
      c.approved,
      c.closed
    ];
    const maxSpark = Math.max(1, ...sparkStages);
    const sparkHeights = sparkStages.map(v => Math.max(14, Math.round((v / maxSpark) * 100)));

    return {
      assignedPct,
      completedCount,
      approvalPct,
      completionPct,
      geotagVerifiedCount,
      geotagPct,
      topUnassigned,
      avgDurationMinutes,
      avgApprovalWaitMin,
      totalInstallers,
      activeInstallers: activeTechSet.size,
      oltCount: oltSet.size,
      fatCount: fatSet.size,
      totalReported,
      mappedCount,
      sparkHeights
    };
  }, [c, filteredTodayTickets, users]);

  // SVG Donut segments computed strictly from real counts
  const donutSegments = useMemo(() => {
    const circumference = 2 * Math.PI * 46; // 289.026
    const total = c.totalToday;
    const items = [
      { key: 'checkin', label: 'Check-In / Progress', count: c.checkedInProgress, color: '#3E81C6' },
      { key: 'complete', label: 'Approved - Done', count: c.approvedDone, color: '#218A63' },
      { key: 'approval', label: 'Butuh Approval', count: c.butuhApproval, color: '#6657C8' },
      { key: 'revision', label: 'Revisi / Rejected', count: c.revisionRejected, color: '#C88735' },
      { key: 'reschedule', label: 'Reschedule', count: c.approvedReschedule || c.reportReschedule, color: '#65B8C4' },
      { key: 'pending', label: 'Pending', count: c.approvedPending || c.reportPending, color: '#E0A84B' },
      { key: 'cancel', label: 'Cancel', count: c.approvedCancel || c.reportCancel, color: '#D45B66' }
    ];

    const sumBuckets = items.reduce((acc, i) => acc + i.count, 0);
    const remaining = Math.max(0, total - sumBuckets);
    if (remaining > 0) {
      items.push({ key: 'idle', label: 'Belum Check-in / Open', count: remaining, color: '#DCE3F2' });
    }

    const denominator = Math.max(total, sumBuckets, 1);
    let offset = 0;

    return items.map(item => {
      const pct = total > 0 ? Math.round((item.count / total) * 1000) / 10 : 0;
      const len = total > 0 ? (item.count / denominator) * circumference : 0;
      const seg = {
        ...item,
        pct,
        dashArray: `${len.toFixed(2)} ${circumference.toFixed(2)}`,
        dashOffset: -offset
      };
      offset += len;
      return seg;
    });
  }, [c, telemetry.completedCount]);

  // Critical WO Feed sorting & priority filtering
  const feedTickets = useMemo(() => {
    const priorityRank = (t: Ticket): number => {
      const app = getTicketCanonicalApprovalStatus(t);
      if (app === 'BUTUH APPROVAL') return 0;
      if (app === 'REVISION') return 1;
      if (!isTicketAssigned(t)) return 2;
      if (isTicketCheckedIn(t) && !isTicketClosed(t)) return 3;
      const rep = getTicketCanonicalReportStatus(t);
      if (rep === 'PENDING' || rep === 'RESCHEDULE') return 4;
      return 5;
    };

    let list = filteredTodayTickets;
    if (showUnassignedOnly) {
      list = list.filter(t => !isTicketAssigned(t));
    }
    if (priorityOnly) {
      list = list.filter(t => priorityRank(t) <= 3);
    }

    return list.slice().sort((a, b) => {
      const diff = priorityRank(a) - priorityRank(b);
      if (diff !== 0) return diff;
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });
  }, [filteredTodayTickets, priorityOnly, showUnassignedOnly]);

  const totalFeedPages = Math.max(1, Math.ceil(feedTickets.length / FEED_PAGE_SIZE));
  const safeFeedPage = Math.min(feedPage, totalFeedPages);
  const pagedFeedTickets = useMemo(() => {
    const start = (safeFeedPage - 1) * FEED_PAGE_SIZE;
    return feedTickets.slice(start, start + FEED_PAGE_SIZE);
  }, [feedTickets, safeFeedPage]);

  const todayAuditCount = useMemo(() => {
    if (!Array.isArray(auditLogs)) return 0;
    const todayMatches = auditLogs.filter(log => String(log.timestamp || '').startsWith(todayWIB)).length;
    return todayMatches > 0 ? todayMatches : auditLogs.length;
  }, [auditLogs, todayWIB]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    kpiContractorFilter !== 'ALL' ||
    kpiAreaFilter !== 'ALL' ||
    leaderFilter !== 'ALL' ||
    showUnassignedOnly ||
    priorityOnly;

  const handleResetFilters = () => {
    setSearchQuery('');
    setKpiContractorFilter('ALL');
    setKpiAreaFilter('ALL');
    setLeaderFilter('ALL');
    setPriorityOnly(false);
    setShowUnassignedOnly(false);
    setFeedPage(1);
  };

  const handleForceResync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await Promise.all([refreshDatabaseData(), refreshKpiSummary()]);
      toast.success(`Data operasional ${todayWIB} berhasil disinkronkan.`);
    } catch {
      toast.error('Gagal menyinkronkan data operasional.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportMatrix = () => {
    try {
      const kpiRows = [
        { Metric: 'Operational Date (WIB)', Value: todayWIB },
        { Metric: 'Vendor Filter', Value: kpiContractorFilter },
        { Metric: 'Area Filter', Value: kpiAreaFilter },
        { Metric: 'Leader Filter', Value: leaderFilter },
        { Metric: 'Total WO Today', Value: c.totalToday },
        { Metric: 'Assigned to Tech', Value: c.assigned },
        { Metric: 'Unassigned Buffer', Value: c.unassigned },
        { Metric: 'Checked-In / Progress', Value: c.checkedInProgress },
        { Metric: 'Butuh Approval', Value: c.butuhApproval },
        { Metric: 'Approved (Total)', Value: c.approved },
        { Metric: 'Approved - Done', Value: c.approvedDone },
        { Metric: 'Approved - Pending', Value: c.approvedPending },
        { Metric: 'Approved - Reschedule', Value: c.approvedReschedule },
        { Metric: 'Approved - Cancel', Value: c.approvedCancel },
        { Metric: 'Approval Rate (%)', Value: telemetry.approvalPct },
        { Metric: 'Completion Rate (%)', Value: telemetry.completionPct },
        { Metric: 'Closed', Value: c.closed },
        { Metric: 'Perlu Revisi', Value: c.revisionRejected },
        { Metric: 'Report Pending', Value: c.reportPending },
        { Metric: 'Report Reschedule', Value: c.reportReschedule },
        { Metric: 'Report Cancel', Value: c.reportCancel }
      ];

      const woRows = filteredTodayTickets.map(t => ({
        WO_Number: t.woNumber,
        Customer_ID: t.idCustomer,
        Customer_Name: t.customerName,
        Vendor: t.contactorName || t.contractorName || '-',
        Area: t.area || '-',
        Cluster: t.clusterName || '-',
        Leader: t.leaderName || '-',
        Installer: t.installerName || 'Unassigned',
        OLT_Code: t.oltCode || '-',
        FAT_Code: t.fatCode || t.fat || '-',
        Status_Agent: t.statusWOAgent,
        Status_Installer: t.statusWOInstaller,
        Approval_Status: t.approvalStatus || 'NONE',
        Geotag_Status: getTicketHouseGeotagInfo(t).label,
        Roset_dBm: t.rosetRedamanDbm ?? '-',
        Appointment_Date: getTicketAppointmentDate(t) || todayWIB,
        Slot_Time: t.slotTime || '-'
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'KPI_Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(woRows), 'Work_Orders');
      XLSX.writeFile(wb, `MoraJaws_Ops_Matrix_${todayWIB}.xlsx`);
      toast.success(`Export Matrix (${woRows.length} WO) berhasil diunduh.`);
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Gagal mengekspor matriks WO.');
    }
  };

  // Lifecycle pipeline progression percentage (based on active downstream volume)
  const pipelineFillPct = useMemo(() => {
    if (c.totalToday === 0) return 0;
    if (c.closed > 0 || c.approved > 0) return 100;
    if (c.butuhApproval > 0) return 83;
    if (telemetry.totalReported > 0) return 67;
    if (c.checkedInProgress > 0) return 52;
    if (c.assigned > 0) return 35;
    if (telemetry.mappedCount > 0) return 18;
    return 8;
  }, [c, telemetry]);

  const topVendorLoad = effectiveSummary.byVendor[0];
  const roleSubtitle = ROLE_CENTER_TITLES[currentUser.role] || 'Operations Command Center';

  return (
    <div className="space-y-6">
      {/* 1. Superadmin Maroon Master Console OR Standard Command Header */}
      {currentUser.role === 'super_admin' ? (
        <div className="space-y-3">
          <div className="banner-maroon-superadmin rounded-2xl p-5 sm:p-6 text-[#26364A] dark:text-white relative overflow-hidden">
            <div className="absolute -right-14 -top-14 w-72 h-72 rounded-full bg-[#65B8C4]/12 dark:bg-white/5 blur-3xl pointer-events-none" />
            <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-5">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-[#EAE8FF] dark:bg-white/10 border border-[#DCE3F2] dark:border-white/15 flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                  <Lock className="w-6 h-6 text-[#5145A6] dark:text-[#FFD8E4]" />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-white/15 border border-[#DCE3F2] dark:border-white/20 text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-white">
                      MASTER CONSOLE
                    </span>
                    <span className="text-[11px] font-mono text-[#52647A] dark:text-white/75 tabular-nums">
                      WIB: {todayWIB} · {c.totalToday} WO Aktif
                    </span>
                  </div>
                  <h1 className="font-display text-xl sm:text-2xl font-extrabold text-[#26364A] dark:text-white tracking-tight leading-snug">
                    Active Role: SUPERADMIN — Unrestricted System &amp; Operational Control
                  </h1>
                  <p className="text-xs text-[#52647A] dark:text-white/80 leading-relaxed">
                    Operator: <span className="font-semibold text-[#26364A] dark:text-white">{currentUser.name}</span> · Canonical 46-Column Schema · Dispatch Override Authority Enabled
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigate('import')}
                  className="btn-3d-maroon px-4 py-2.5 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <CloudDownload className="w-4 h-4 text-white dark:text-[#FFD8E4]" />
                  <span>+ Import Data WO</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('system_health')}
                  className="btn-3d-maroon px-4 py-2.5 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Database className="w-4 h-4 text-white dark:text-[#FFD8E4]" />
                  <span>Database Sync Health</span>
                </button>
                <button
                  type="button"
                  onClick={handleForceResync}
                  disabled={isSyncing || isKpiLoading}
                  title="Klik untuk sinkronisasi manual Supabase & KPI hari ini"
                  className="px-3.5 py-2 rounded-xl bg-white/85 hover:bg-white dark:bg-white/10 dark:hover:bg-white/20 border border-[#DDE6F0] dark:border-white/20 text-[#26364A] dark:text-white text-[11px] font-bold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      databaseStatus === 'connected' ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse' : 'bg-amber-500 dark:bg-amber-400'
                    }`}
                  />
                  <span>
                    Auto-Rollover:{' '}
                    {isSyncing ? 'SYNCING' : databaseStatus === 'connected' ? 'ONLINE' : syncStatus.toUpperCase()}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* 5-Column Micro Filter Toolbar */}
          <div className="card-3d-lavender rounded-xl p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-center">
            <div className="relative sm:col-span-2 lg:col-span-2">
              <Search className="w-4 h-4 text-[#8492A5] dark:text-[#A78BFA] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setFeedPage(1);
                }}
                placeholder="Cari WO, OLT, Cluster, Teknisi..."
                aria-label="Cari Work Order di Operations Command"
                className="w-full pl-9 pr-7 py-2 bg-[#F8FAFD] dark:bg-[#160d29] rounded-lg text-xs text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 placeholder:text-[#8492A5]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFeedPage(1);
                  }}
                  aria-label="Bersihkan pencarian"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8492A5] hover:text-[#6657C8] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="relative">
              <select
                aria-label="Filter Vendor"
                value={kpiContractorFilter}
                onChange={e => {
                  setKpiContractorFilter(e.target.value);
                  setFeedPage(1);
                }}
                className="w-full pl-3 pr-8 py-2 bg-[#F8FAFD] dark:bg-[#160d29] rounded-lg text-xs font-semibold text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 appearance-none cursor-pointer"
              >
                <option value="ALL">Semua Vendor (Global)</option>
                {vendorOptions.map(v => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#8492A5] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="relative">
              <select
                aria-label="Filter Area"
                value={kpiAreaFilter}
                onChange={e => {
                  setKpiAreaFilter(e.target.value);
                  setFeedPage(1);
                }}
                className="w-full pl-3 pr-8 py-2 bg-[#F8FAFD] dark:bg-[#160d29] rounded-lg text-xs font-semibold text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 appearance-none cursor-pointer"
              >
                <option value="ALL">Semua Area Kerja</option>
                {areaOptions.map(a => (
                  <option key={a} value={a}>
                    Area: {a}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#8492A5] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="relative">
              <select
                aria-label="Filter Leader"
                value={leaderFilter}
                onChange={e => {
                  setLeaderFilter(e.target.value);
                  setFeedPage(1);
                }}
                className="w-full pl-3 pr-8 py-2 bg-[#F8FAFD] dark:bg-[#160d29] rounded-lg text-xs font-semibold text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 appearance-none cursor-pointer"
              >
                <option value="ALL">Semua Leader / Korlap</option>
                {leaderOptions.map(l => (
                  <option key={l} value={l}>
                    Lead: {l}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#8492A5] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="flex items-center gap-1.5 justify-end">
              <button
                type="button"
                onClick={handleExportMatrix}
                className="btn-3d-lilac px-3 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap flex-1 justify-center"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Matrix</span>
              </button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  title="Reset semua filter"
                  className="btn-3d-lilac px-2.5 py-2 rounded-lg text-xs font-bold cursor-pointer shrink-0"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card-3d-lavender relative rounded-xl p-5 sm:p-6 overflow-hidden">
          <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-gradient-to-br from-[#65B8C4]/12 via-[#6657C8]/5 to-transparent blur-3xl pointer-events-none" />

          <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-5">
            <div className="flex flex-col space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#DDF4F4] dark:bg-[#2e1459] text-[#2E7D8B] dark:text-[#dab9ff] border border-[#BDE4E8] dark:border-transparent text-[11px] font-bold tracking-wider uppercase">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      databaseStatus === 'connected' ? 'bg-[#2E7D8B] dark:bg-[#dab9ff] animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  <span>FTTH Core Live · {c.totalToday} WO Hari Ini</span>
                </div>
                <span className="text-[#8492A5] text-xs hidden sm:inline">•</span>
                <span className="text-[#52647A] dark:text-[#cabde8] text-[11px] font-semibold font-mono tabular-nums">
                  WIB: {todayWIB} · Sync: {syncStatus}
                </span>
              </div>

              <h1 className="font-display text-2xl sm:text-[28px] leading-tight text-[#26364A] dark:text-white tracking-tight font-extrabold">
                Global Operations Command <span className="text-[#6657C8] dark:text-[#dab9ff] font-light">—</span>{' '}
                {roleSubtitle}
              </h1>
              <p className="text-xs sm:text-sm text-[#52647A] dark:text-[#cabde8] max-w-3xl leading-relaxed">
                Pemantauan operasional Work Order FTTH real-time, check-in PROGRESS &amp; validasi Foto Rumah geotag,
                serta distribusi vendor untuk{' '}
                <span className="font-semibold text-[#5145A6] dark:text-[#dab9ff]">{currentUser.name}</span>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 self-start xl:self-center shrink-0">
              <button
                type="button"
                onClick={handleExportMatrix}
                className="btn-3d-lilac px-4 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>Export Matrix</span>
              </button>
              <button
                type="button"
                onClick={handleForceResync}
                disabled={isSyncing || isKpiLoading}
                className="btn-3d-primary px-4 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing || isKpiLoading ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Menyinkronkan...' : 'Force Resync'}</span>
              </button>
            </div>
          </div>

          {/* 5-Column Micro Filter Toolbar */}
          <div className="mt-5 pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-[#EDF3F8] dark:bg-[#160d29] p-3 rounded-lg border border-[#DDE6F0] dark:border-[#35105E] shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)]">
            <div className="relative col-span-1 sm:col-span-2 lg:col-span-1">
              <Search className="w-4 h-4 text-[#8492A5] dark:text-[#A78BFA] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setFeedPage(1);
                }}
                placeholder="Cari WO, OLT, Cluster, Teknisi..."
                aria-label="Cari Work Order di Operations Command"
                className="w-full pl-9 pr-7 py-2 bg-white dark:bg-[#1e1238] rounded-md text-xs text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 placeholder:text-[#8492A5]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFeedPage(1);
                  }}
                  aria-label="Bersihkan pencarian"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8492A5] hover:text-[#6657C8] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="relative">
              <select
                aria-label="Filter Vendor"
                disabled={!isGlobalRole && Boolean(currentUser.contractor)}
                value={!isGlobalRole && currentUser.contractor ? currentUser.contractor : kpiContractorFilter}
                onChange={e => {
                  setKpiContractorFilter(e.target.value);
                  setFeedPage(1);
                }}
                className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1e1238] rounded-md text-xs font-semibold text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 appearance-none cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
              >
                <option value="ALL">Semua Vendor (Global)</option>
                {vendorOptions.map(v => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#8492A5] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="relative">
              <select
                aria-label="Filter Area"
                value={kpiAreaFilter}
                onChange={e => {
                  setKpiAreaFilter(e.target.value);
                  setFeedPage(1);
                }}
                className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1e1238] rounded-md text-xs font-semibold text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 appearance-none cursor-pointer"
              >
                <option value="ALL">Semua Area Kerja</option>
                {areaOptions.map(a => (
                  <option key={a} value={a}>
                    Area: {a}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#8492A5] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="relative">
              <select
                aria-label="Filter Leader"
                value={leaderFilter}
                onChange={e => {
                  setLeaderFilter(e.target.value);
                  setFeedPage(1);
                }}
                className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1e1238] rounded-md text-xs font-semibold text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 appearance-none cursor-pointer"
              >
                <option value="ALL">Semua Leader / Korlap</option>
                {leaderOptions.map(l => (
                  <option key={l} value={l}>
                    Lead: {l}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#8492A5] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onNavigate(roleActionTarget)}
                title="Buka daftar lengkap Work Orders hari ini"
                className="flex-1 px-3 py-2 bg-white dark:bg-[#1e1238] rounded-md text-left text-xs font-semibold text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)] flex items-center justify-between gap-2 hover:border-[#65B8C4] transition-colors cursor-pointer min-w-0"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Calendar className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#dab9ff] shrink-0" />
                  <span className="truncate tabular-nums">{formatIndonesianWODate(todayWIB) || todayWIB}</span>
                </span>
                <ExternalLink className="w-3 h-3 text-[#8492A5] shrink-0" />
              </button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  title="Reset semua filter"
                  className="btn-3d-lilac px-2.5 py-2 rounded-md text-xs font-bold cursor-pointer shrink-0"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Primary 5-Card 3D KPI Bento Grid (Matching Stitch Superadmin Console) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* Card 1: Total WO Today */}
        <button
          type="button"
          onClick={() => onDrillDown('total_today')}
          className="card-3d-lavender relative group text-left rounded-xl p-4 hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#cabde8]">
                TOTAL WO TODAY
              </span>
              <span className="w-7 h-7 rounded-lg bg-[#EAE8FF] dark:bg-[#2e1459] flex items-center justify-center text-[#5145A6] dark:text-[#dab9ff] shrink-0">
                <Layers className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-extrabold text-[#26364A] dark:text-white tabular-nums">
                {c.totalToday}
              </span>
              <span className="text-xs font-bold text-[#52647A] dark:text-[#cabde8]">Aktif</span>
            </div>
            <div className="mt-3 h-7 w-full flex items-end gap-1" aria-hidden="true">
              {telemetry.sparkHeights.map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-t transition-all ${
                    i < 2
                      ? 'bg-[#DDE6F0] dark:bg-[#2e1459]'
                      : i < 4
                      ? 'bg-[#BDE4E8] dark:bg-[#4c2488]'
                      : i === 4
                      ? 'bg-[#65B8C4]/75 dark:bg-[#7135b5]/60'
                      : i === 5
                      ? 'bg-[#6657C8]/75 dark:bg-[#7135b5]/80'
                      : 'bg-[#6657C8] dark:bg-[#a380fe]'
                  }`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#DDE6F0] dark:border-[#35105e] text-[11px] text-[#52647A] dark:text-[#cabde8] flex items-center justify-between gap-1 tabular-nums">
            <span>{c.unassigned} Unassigned</span>
            <span className="px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2e1459] font-bold text-[#5145A6] dark:text-[#dab9ff]">
              {telemetry.mappedCount} Mapped
            </span>
          </div>
        </button>

        {/* Card 2: Check-in / Progress */}
        <button
          type="button"
          onClick={() => onDrillDown('checked_in_progress')}
          className="card-3d-lavender relative group text-left rounded-xl p-4 hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#cabde8]">
                CHECK-IN / PROGRESS
              </span>
              <span className="w-7 h-7 rounded-lg bg-[#E7F1FB] dark:bg-sky-950/60 flex items-center justify-center text-[#3E81C6] dark:text-sky-400 shrink-0">
                <MapPin className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-extrabold text-[#3E81C6] dark:text-sky-300 tabular-nums">
                {c.checkedInProgress}
              </span>
              <span className="text-xs font-bold text-[#3E81C6]/85 dark:text-sky-300/80">On-Site</span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-[#E7F1FB] dark:bg-sky-950/70 flex items-center justify-center text-[#3E81C6] dark:text-sky-300 shrink-0">
                <Camera className="w-4 h-4" />
              </div>
              <div className="text-[11.5px] text-[#52647A] dark:text-[#cabde8] leading-tight">
                <span className="font-bold text-[#26364A] dark:text-white tabular-nums">
                  {telemetry.geotagVerifiedCount} Foto Rumah
                </span>{' '}
                valid GPS
              </div>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#DDE6F0] dark:border-[#35105e] flex items-center justify-between text-[11px] text-[#52647A] dark:text-[#cabde8] tabular-nums">
            <span>Geotag {telemetry.geotagPct}%</span>
            <span className="font-bold text-[#5145A6] dark:text-[#dab9ff]">
              {telemetry.oltCount} OLT · {telemetry.fatCount} FAT
            </span>
          </div>
        </button>

        {/* Card 3: Approved - Done */}
        <button
          type="button"
          onClick={() => onDrillDown('approved_done')}
          className="card-3d-lavender relative group text-left rounded-xl p-4 hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#cabde8]">
                APPROVED - DONE
              </span>
              <span className="w-7 h-7 rounded-lg bg-[#E4F5EC] dark:bg-emerald-950/60 flex items-center justify-center text-[#218A63] dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-extrabold text-[#218A63] dark:text-emerald-300 tabular-nums">
                {c.approvedDone}
              </span>
              <span className="text-xs font-bold text-[#218A63]/85 dark:text-emerald-300/80">Completed</span>
            </div>
            <div className="mt-3 w-full bg-[#EDF3F8] dark:bg-[#160d29] h-2 rounded-full overflow-hidden">
              <div
                className="bg-[#218A63] dark:bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, telemetry.completionPct)}%` }}
              />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#DDE6F0] dark:border-[#35105e] flex items-center justify-between text-[11px] text-[#52647A] dark:text-[#cabde8] tabular-nums">
            <span>Closed: {c.closed}</span>
            <span className="font-bold text-[#218A63] dark:text-emerald-300">{telemetry.completionPct}%</span>
          </div>
        </button>

        {/* Card 4: Butuh Approval QA */}
        <div className="card-3d-lavender relative group rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#dab9ff]">
                BUTUH APPROVAL QA
              </span>
              <span className="w-7 h-7 rounded-lg bg-[#EAE8FF] dark:bg-[#2e1459] flex items-center justify-center text-[#5145A6] dark:text-[#dab9ff] shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-extrabold text-[#5145A6] dark:text-white tabular-nums">
                  {c.butuhApproval}
                </span>
                <span className="text-xs font-bold text-[#52647A] dark:text-[#cabde8]">Tiket</span>
              </div>
              <span
                className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                  c.butuhApproval > 0
                    ? 'bg-[#6657C8] dark:bg-[#58149c] text-white'
                    : 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-950/70 dark:text-emerald-200'
                }`}
              >
                {c.butuhApproval > 0 ? 'Hot Desk' : 'Synced'}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#DDE6F0] dark:border-[#35105e] flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#52647A] dark:text-[#cabde8] tabular-nums">
              Wait: {telemetry.avgApprovalWaitMin !== null ? `${telemetry.avgApprovalWaitMin}m` : '—'}
            </span>
            <button
              type="button"
              onClick={() => {
                if (currentUser.role === 'super_admin' || currentUser.role === 'dispatch') {
                  onNavigate('verification_desk');
                } else {
                  onDrillDown('butuh_approval');
                }
              }}
              className="btn-3d-primary px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Audit QA</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Card 5: Overdue WO Alert */}
        <div className="rounded-xl p-4 bg-[#FCE9EB] dark:bg-rose-950/35 border border-[#F3C5CA] dark:border-rose-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_3px_0_#F3C5CA] dark:shadow-[0_3px_0_#4c0519] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#9B2C37] dark:text-rose-300 flex items-center gap-1.5">
                {overdueSummary.totalOverdue > 0 && (
                  <span className="w-2 h-2 rounded-full bg-[#D45B66] animate-ping shrink-0" />
                )}
                <span>OVERDUE WO ALERT</span>
              </span>
              <span className="w-7 h-7 rounded-lg bg-[#F9D7DB] dark:bg-rose-900/60 flex items-center justify-center text-[#9B2C37] dark:text-rose-300 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-extrabold text-[#9B2C37] dark:text-rose-300 tabular-nums">
                {overdueSummary.totalOverdue}
              </span>
              <span className="text-xs font-bold text-[#9B2C37] dark:text-rose-200">WO Overdue</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#F3C5CA] dark:border-rose-800/60 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#9B2C37] dark:text-rose-300 tabular-nums">
              Critical &gt;7h: {overdueSummary.criticalOverdueGt7Days}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('overdue_wo')}
              className="btn-3d-crimson px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap"
            >
              Filter Overdue
            </button>
          </div>
        </div>
      </div>

      {/* 3. Secondary Tactical KPI Strip */}
      <div className="card-3d-lavender grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 p-3 rounded-xl">
        <button
          type="button"
          onClick={() => onDrillDown('approved')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] hover:bg-[#F0EDFF] dark:hover:bg-[#2a194b] border border-[#DDE6F0]/70 dark:border-transparent transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-[#EAE8FF] dark:bg-[#58149c]/15 flex items-center justify-center text-[#5145A6] dark:text-[#dab9ff] shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#cabde8] uppercase truncate">
              APPROVAL RATE
            </div>
            <div className="font-display text-base font-extrabold text-[#5145A6] dark:text-[#dab9ff] tabular-nums">
              {telemetry.approvalPct}%{' '}
              <span className="text-[11px] font-normal text-[#8492A5]">({c.approved})</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('approved_reschedule')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] hover:bg-[#F0EDFF] dark:hover:bg-[#2a194b] border border-[#DDE6F0]/70 dark:border-transparent transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-[#DDF4F4] dark:bg-[#6a46c1]/15 flex items-center justify-center text-[#2E7D8B] dark:text-[#dab9ff] shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#cabde8] uppercase truncate">
              RESCHEDULE
            </div>
            <div className="font-display text-base font-extrabold text-[#2E7D8B] dark:text-[#dab9ff] tabular-nums">
              {c.approvedReschedule} <span className="text-xs font-normal text-[#8492A5]">WO</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('approved_pending')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] hover:bg-[#F0EDFF] dark:hover:bg-[#2a194b] border border-[#DDE6F0]/70 dark:border-transparent transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-[#FFF2D9] dark:bg-amber-500/15 flex items-center justify-center text-[#9D661F] dark:text-amber-300 shrink-0">
            <Hourglass className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#cabde8] uppercase truncate">
              PENDING
            </div>
            <div className="font-display text-base font-extrabold text-[#9D661F] dark:text-amber-200 tabular-nums">
              {c.approvedPending} <span className="text-xs font-normal text-[#8492A5]">WO</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('approved_cancel')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] hover:bg-[#F0EDFF] dark:hover:bg-[#2a194b] border border-[#DDE6F0]/70 dark:border-transparent transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-[#FCE9EB] dark:bg-rose-500/15 flex items-center justify-center text-[#9B2C37] dark:text-rose-300 shrink-0">
            <XCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#cabde8] uppercase truncate">
              CANCEL
            </div>
            <div className="font-display text-base font-extrabold text-[#9B2C37] dark:text-rose-300 tabular-nums">
              {c.approvedCancel} <span className="text-xs font-normal text-[#8492A5]">WO</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('revision_rejected')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] hover:bg-[#F0EDFF] dark:hover:bg-[#2a194b] border border-[#DDE6F0]/70 dark:border-transparent transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-[#FFF2D9] dark:bg-amber-500/15 flex items-center justify-center text-[#9D661F] dark:text-amber-300 shrink-0">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#cabde8] uppercase truncate">
              PERLU REVISI
            </div>
            <div className="font-display text-base font-extrabold text-[#9D661F] dark:text-amber-300 tabular-nums">
              {c.revisionRejected} <span className="text-xs font-normal text-[#8492A5]">WO</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('approved_done')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] hover:bg-[#F0EDFF] dark:hover:bg-[#2a194b] border border-[#DDE6F0]/70 dark:border-transparent transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-[#E4F5EC] dark:bg-emerald-500/15 flex items-center justify-center text-[#218A63] dark:text-emerald-300 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#8492A5] dark:text-[#cabde8] uppercase truncate">
              COMPLETION RATE
            </div>
            <div className="font-display text-base font-extrabold text-[#218A63] dark:text-emerald-300 tabular-nums">
              {telemetry.completionPct}%
            </div>
          </div>
        </button>
      </div>

      {/* 4. Standard WO Lifecycle Pipeline (7-Stage Interactive Stepper) */}
      <div className="card-3d-lavender relative rounded-xl p-5 sm:p-6 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-5 gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-extrabold text-[#26364A] dark:text-white">
                Standard WO Lifecycle Pipeline
              </span>
              <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-[#EAE8FF] dark:bg-[#58149c] text-[#5145A6] dark:text-white uppercase tracking-wider">
                AppFlow Live
              </span>
            </div>
            <p className="text-xs text-[#52647A] dark:text-[#cabde8] mt-0.5">
              Alur operasional terintegrasi: Import WO → Distribusi Leader → Assign Teknisi → Check-in PROGRESS &amp;
              Foto Rumah Geotag → Report → Approval → Closed.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#8492A5] dark:text-[#cabde8] shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#218A63] dark:bg-emerald-500" />
            <span>Auto-sync Supabase aktif</span>
          </div>
        </div>

        <div className="relative py-3 px-2 overflow-x-auto">
          <div className="min-w-[840px] relative">
            {/* Background Connecting Track */}
            <div className="absolute top-7 left-12 right-12 h-1 bg-[#DDE6F0] dark:bg-[#35105e] rounded-full z-0" />
            {/* Active Progress Track */}
            <div
              className="absolute top-7 left-12 h-1 bg-gradient-to-r from-[#218A63] via-[#65B8C4] to-[#6657C8] dark:from-emerald-500 dark:via-sky-500 dark:to-[#7135b5] rounded-full z-0 transition-all duration-500"
              style={{ width: `calc(${pipelineFillPct}% - 6rem)` }}
            />

            <div className="grid grid-cols-7 gap-2 relative z-10">
              {/* Stage 1: Import WO */}
              <button
                type="button"
                onClick={() => onDrillDown('total_today')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-xl bg-[#218A63] dark:bg-emerald-500 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(33,138,99,0.28),inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-[0_4px_12px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform group-hover:scale-105">
                  <CloudDownload className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#26364A] dark:text-white uppercase tracking-wider">
                  1. Import WO
                </span>
                <span className="text-xs text-[#218A63] dark:text-emerald-300 font-bold tabular-nums">
                  {c.totalToday} Ingested
                </span>
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8]/80 mt-0.5">{todayWIB}</span>
              </button>

              {/* Stage 2: Distribusi Leader */}
              <button
                type="button"
                onClick={() => onDrillDown('unmapped_distribution')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-xl bg-[#218A63] dark:bg-emerald-500 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(33,138,99,0.28),inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-[0_4px_12px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform group-hover:scale-105">
                  <Users className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#26364A] dark:text-white uppercase tracking-wider">
                  2. Auto Leader
                </span>
                <span className="text-xs text-[#218A63] dark:text-emerald-300 font-bold tabular-nums">
                  {telemetry.mappedCount} Mapped
                </span>
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8]/80 mt-0.5">
                  {c.unmappedDistribution > 0 ? `${c.unmappedDistribution} Unmapped` : 'Vendor Routing'}
                </span>
              </button>

              {/* Stage 3: Tech Assignment */}
              <button
                type="button"
                onClick={() => onDrillDown('assigned')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-xl bg-[#218A63] dark:bg-emerald-500 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(33,138,99,0.28),inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-[0_4px_12px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform group-hover:scale-105">
                  <UserCheck className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#26364A] dark:text-white uppercase tracking-wider">
                  3. Assignment
                </span>
                <span className="text-xs text-[#218A63] dark:text-emerald-300 font-bold tabular-nums">
                  {c.assigned} Assigned
                </span>
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8]/80 mt-0.5">
                  {c.unassigned > 0 ? `${c.unassigned} Buffer` : 'Penuh'}
                </span>
              </button>

              {/* Stage 4: Check-in & Foto Rumah */}
              <button
                type="button"
                onClick={() => onDrillDown('checked_in_progress')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div
                  className={`relative w-14 h-14 rounded-xl bg-gradient-to-tr from-[#3E81C6] to-[#65B8C4] dark:from-sky-600 dark:to-sky-400 text-white flex items-center justify-center shadow-[0_6px_18px_rgba(62,129,198,0.32),inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[0_0_20px_rgba(2,132,199,0.5),inset_0_1px_0_rgba(255,255,255,0.6)] transition-transform group-hover:scale-105 ${
                    c.checkedInProgress > 0 ? 'animate-pulse' : ''
                  }`}
                >
                  <Camera className="w-6 h-6" />
                  {c.checkedInProgress > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-[#26364A] dark:bg-[#1f1638] text-white text-[9px] font-bold rounded-full">
                      LIVE
                    </span>
                  )}
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#2E7D8B] dark:text-sky-300 uppercase tracking-wider">
                  4. Check-in &amp; Geo
                </span>
                <span className="text-xs text-[#26364A] dark:text-sky-200 font-bold tabular-nums">
                  {c.checkedInProgress} On-Site
                </span>
                <span className="text-[10.5px] text-[#3E81C6] dark:text-sky-400 font-semibold mt-0.5">
                  {telemetry.geotagVerifiedCount} Foto Rumah
                </span>
              </button>

              {/* Stage 5: Tech Report */}
              <button
                type="button"
                onClick={() => onDrillDown('report_complete')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div
                  className={`w-14 h-14 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 ${
                    telemetry.totalReported > 0
                      ? 'bg-[#6657C8] dark:bg-[#6a46c1] text-white shadow-[0_4px_12px_rgba(102,87,200,0.3)] dark:shadow-[0_4px_12px_rgba(106,70,193,0.35)]'
                      : 'bg-[#EDF3F8] dark:bg-[#2a194b] text-[#52647A] dark:text-[#cabde8] border border-[#DDE6F0] dark:border-transparent'
                  }`}
                >
                  <FileCheck2 className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#26364A] dark:text-white uppercase tracking-wider">
                  5. Tech Report
                </span>
                <span className="text-xs text-[#6657C8] dark:text-[#dab9ff] font-bold tabular-nums">
                  {telemetry.totalReported} Submitted
                </span>
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8]/80 mt-0.5">
                  Complete: {c.reportComplete}
                </span>
              </button>

              {/* Stage 6: Dispatch Verification */}
              <button
                type="button"
                onClick={() => onDrillDown('butuh_approval')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div
                  className={`w-14 h-14 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 ${
                    c.butuhApproval > 0
                      ? 'bg-[#5145A6] dark:bg-[#7135b5] text-white shadow-[0_4px_12px_rgba(81,69,166,0.3)] dark:shadow-[0_4px_12px_rgba(113,53,181,0.35)]'
                      : 'bg-[#EDF3F8] dark:bg-[#2a194b] text-[#52647A] dark:text-[#cabde8] border border-[#DDE6F0] dark:border-transparent'
                  }`}
                >
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#26364A] dark:text-white uppercase tracking-wider">
                  6. Verification
                </span>
                <span className="text-xs text-[#5145A6] dark:text-[#dab9ff] font-bold tabular-nums">
                  {c.butuhApproval} Pending QA
                </span>
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8]/80 mt-0.5">Dispatch Review</span>
              </button>

              {/* Stage 7: Terminal State */}
              <button
                type="button"
                onClick={() => onDrillDown('closed')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-xl bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] border border-[#DCE3F2] dark:border-transparent flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-transform group-hover:scale-105">
                  <GitBranch className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#26364A] dark:text-white uppercase tracking-wider">
                  7. Terminal State
                </span>
                <span className="text-xs text-[#5145A6] dark:text-[#dab9ff] font-bold tabular-nums">
                  {c.approvedDone} Done
                </span>
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8]/80 mt-0.5">Closed: {c.closed}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. 3-Column Bento Analytics Row (WO Distribution Mix + FTTH Node & Vendor Load + Telemetry Engine) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        {/* Col 1: WO Distribution Mix */}
        <div className="card-3d-lavender rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
                WO Distribution Mix
              </h2>
              <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] tabular-nums">
                Proporsi live dari {c.totalToday} Work Order
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[#DDF4F4] dark:bg-[#2e1459] text-[#2E7D8B] dark:text-[#dab9ff] text-[10px] font-bold border border-[#BDE4E8] dark:border-transparent">
              Today
            </span>
          </div>

          <div className="flex flex-col items-center justify-center relative py-1">
            <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 120 120" aria-label="WO Distribution Donut Chart">
              <circle cx="60" cy="60" fill="transparent" r="46" className="stroke-[#EDF3F8] dark:stroke-[#2e1459]" strokeWidth="14" />
              {c.totalToday > 0 &&
                donutSegments.map(seg =>
                  seg.count > 0 ? (
                    <circle
                      key={seg.key}
                      cx="60"
                      cy="60"
                      fill="transparent"
                      r="46"
                      stroke={seg.color}
                      strokeDasharray={seg.dashArray}
                      strokeDashoffset={seg.dashOffset}
                      strokeWidth="14"
                    />
                  ) : null
                )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <span className="font-display text-2xl font-extrabold text-[#26364A] dark:text-white leading-none tabular-nums">
                {c.totalToday}
              </span>
              <span className="text-[9.5px] font-bold text-[#8492A5] dark:text-[#cabde8] uppercase tracking-wider mt-1">
                TOTAL WO
              </span>
              <span className="text-[10px] font-bold text-[#218A63] dark:text-emerald-300 mt-0.5 tabular-nums">
                {telemetry.completionPct}% Done
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              {
                label: 'Checked-In',
                count: c.checkedInProgress,
                dot: 'bg-[#65B8C4] dark:bg-sky-500',
                filter: 'checked_in_progress' as WOKpiFilterKey
              },
              {
                label: 'Approved Done',
                count: c.approvedDone,
                dot: 'bg-[#218A63] dark:bg-emerald-500',
                filter: 'approved_done' as WOKpiFilterKey
              },
              {
                label: 'Butuh Approval',
                count: c.butuhApproval,
                dot: 'bg-[#6657C8] dark:bg-[#58149c]',
                filter: 'butuh_approval' as WOKpiFilterKey
              },
              {
                label: 'Revisi / Unassigned',
                count: c.revisionRejected + c.unassigned,
                dot: 'bg-[#C88735] dark:bg-amber-500',
                filter: 'unassigned' as WOKpiFilterKey
              }
            ].map(item => (
              <button
                key={item.label}
                type="button"
                onClick={() => onDrillDown(item.filter)}
                className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0]/70 dark:border-transparent hover:bg-[#EAE8FF] dark:hover:bg-[#2a194b] transition-colors text-left cursor-pointer"
              >
                <span className="flex items-center gap-1.5 truncate text-[#52647A] dark:text-[#cabde8] font-semibold">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${item.dot}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="font-bold text-[#26364A] dark:text-white tabular-nums">{item.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Col 2: FTTH Node & Vendor Load */}
        <div className="card-3d-lavender rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
                FTTH Node &amp; Vendor Load
              </h2>
              <p className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                Kapasitas node FAT/OLT &amp; beban mitra
              </p>
            </div>
            <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] text-[10px] font-bold">
              {effectiveSummary.byVendor.length} Mitra
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-sm font-extrabold text-[#26364A] dark:text-white truncate">
                {topVendorLoad ? topVendorLoad.contractorName : 'Belum ada beban vendor'}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-[#6657C8] dark:bg-[#58149c] text-white text-[10px] font-bold shrink-0">
                Primary Vendor
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#52647A] dark:text-[#cabde8] tabular-nums">
              <span>
                Quota: {topVendorLoad && c.totalToday > 0 ? `${topVendorLoad.total} / ${c.totalToday} WO` : `${c.totalToday} WO`}
              </span>
              <span>{telemetry.fatCount} FAT Mapped</span>
            </div>
            <div className="w-full bg-[#EDF3F8] dark:bg-[#2a194b] h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#6657C8] to-[#65B8C4] dark:from-[#58149c] dark:to-[#7135b5] h-full rounded-full transition-all duration-500"
                style={{
                  width: `${
                    topVendorLoad && c.totalToday > 0
                      ? Math.min(100, Math.round((topVendorLoad.total / c.totalToday) * 100))
                      : 0
                  }%`
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-center">
            <div className="p-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e]">
              <div className="text-[10px] font-bold uppercase text-[#8492A5] dark:text-[#cabde8]">ACTIVE FATS</div>
              <div className="font-display text-xl font-extrabold text-[#26364A] dark:text-white mt-0.5 tabular-nums">
                {telemetry.fatCount}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e]">
              <div className="text-[10px] font-bold uppercase text-[#8492A5] dark:text-[#cabde8]">OLT ACTIVE</div>
              <div className="font-display text-xl font-extrabold text-[#5145A6] dark:text-[#dab9ff] mt-0.5 tabular-nums">
                {telemetry.oltCount}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/35 border border-[#F3C5CA] dark:border-rose-900/50">
              <div className="text-[10px] font-bold uppercase text-[#9B2C37] dark:text-rose-300">OVERDUE SLA</div>
              <div className="font-display text-xl font-extrabold text-[#9B2C37] dark:text-rose-300 mt-0.5 tabular-nums">
                {overdueSummary.totalOverdue}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105e] flex items-center justify-between text-[11px]">
            <span className="text-[#52647A] dark:text-[#cabde8] truncate">
              Tech Aktif: {telemetry.activeInstallers}/{telemetry.totalInstallers || telemetry.activeInstallers}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('sla_monitoring')}
              className="font-bold text-[#5145A6] dark:text-[#dab9ff] hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <span>Rebalance Load</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Col 3: Telemetry Engine */}
        <div className="card-3d-lavender rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#DDF4F4] dark:bg-[#2e1459] text-[#2E7D8B] dark:text-[#dab9ff] flex items-center justify-center border border-[#BDE4E8] dark:border-transparent">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
                  Telemetry Engine
                </h2>
                <p className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                  Live sync, IndexedDB &amp; audit trail
                </p>
              </div>
            </div>
            <Radio className={`w-4 h-4 ${databaseStatus === 'connected' ? 'text-[#218A63] dark:text-emerald-500 animate-pulse' : 'text-[#C88735] dark:text-amber-500'}`} />
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] text-xs">
              <span className="font-semibold text-[#52647A] dark:text-[#cabde8]">Realtime SSE</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-[#26364A] dark:text-white">
                <span className={`w-2 h-2 rounded-full ${databaseStatus === 'connected' ? 'bg-[#218A63] dark:bg-emerald-500' : 'bg-[#C88735] dark:bg-amber-500'}`} />
                <span>{databaseStatus === 'connected' ? 'Connected' : databaseStatus.toUpperCase()}</span>
              </span>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] text-xs">
              <span className="font-semibold text-[#52647A] dark:text-[#cabde8]">Offline Sync</span>
              <span className="font-bold text-[#26364A] dark:text-white tabular-nums">
                {pendingCount === 0 ? 'Ready (IndexedDB)' : `${pendingCount} Pending`}
              </span>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] text-xs">
              <span className="font-semibold text-[#52647A] dark:text-[#cabde8]">Audit Trail</span>
              <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#160D29] text-[#5145A6] dark:text-white border border-[#DCE3F2] dark:border-transparent font-mono text-[11px] font-bold tabular-nums">
                {todayAuditCount} events today
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105e] flex items-center justify-between text-[11px]">
            <span className="font-mono text-[#8492A5] dark:text-[#cabde8]">Sync: {syncStatus}</span>
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  currentUser.role === 'super_admin'
                    ? 'audit_logs'
                    : 'history_progress'
                )
              }
              className="font-bold text-[#5145A6] dark:text-[#dab9ff] hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Full Log</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 6. Full-Width Recent Critical WO Operational Feed */}
      <div className="card-3d-lavender rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-extrabold text-[#26364A] dark:text-white">
                Recent Critical WO Operational Feed
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#218A63] dark:text-emerald-300 border border-[#B7E4CC] dark:border-transparent text-[10.5px] font-bold">
                Live Ticker
              </span>
            </div>
            <p className="text-xs text-[#52647A] dark:text-[#cabde8]">
              Stream Work Order aktif hari ini ({todayWIB}) dengan alamat pelanggan, status approval, dan validasi Foto Rumah geotag.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowUnassignedOnly(prev => !prev);
                setFeedPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer tabular-nums ${
                showUnassignedOnly ? 'btn-3d-amber' : 'btn-3d-lilac'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Unassigned ({c.unassigned})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPriorityOnly(prev => !prev);
                setFeedPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                priorityOnly ? 'btn-3d-primary' : 'btn-3d-lilac'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>Priority Queue</span>
            </button>
            <button
              type="button"
              onClick={handleForceResync}
              disabled={isSyncing}
              className="btn-3d-darkpurple px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Force Sync</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-left border-collapse mj-zebra-table">
            <thead>
              <tr className="bg-[#EDF3F8] dark:bg-[#160d29] text-[#52647A] dark:text-[#cabde8] text-[10.5px] font-bold uppercase tracking-wider border-y border-[#DDE6F0] dark:border-transparent">
                <th className="py-3 px-3 rounded-l-lg">WO ID &amp; Node</th>
                <th className="py-3 px-3">Pelanggan &amp; Alamat</th>
                <th className="py-3 px-3">Teknisi / Leader</th>
                <th className="py-3 px-3">Status WO</th>
                <th className="py-3 px-3">Foto Rumah &amp; Optical</th>
                <th className="py-3 px-3 text-right rounded-r-lg">Aksi Command</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE6F0] dark:divide-[#35105e] text-xs">
              {pagedFeedTickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 px-4 text-center text-[#8492A5] dark:text-[#cabde8]">
                    <div className="font-semibold text-sm text-[#26364A] dark:text-white">
                      Tidak ada Work Order yang cocok dengan filter aktif
                    </div>
                    <p className="text-xs mt-1">
                      Sesuaikan filter Vendor, Area, Leader, atau matikan filter Unassigned/Priority untuk melihat seluruh tiket.
                    </p>
                  </td>
                </tr>
              ) : (
                pagedFeedTickets.map(ticket => {
                  const approval = getTicketCanonicalApprovalStatus(ticket);
                  const geotag = getTicketHouseGeotagInfo(ticket);
                  const mapsInfo = buildGoogleMapsSearchUrl(ticket);
                  const nodeLabel = [ticket.oltCode, ticket.fatCode || ticket.fat, ticket.clusterName]
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(' • ');
                  const fullAddress =
                    ticket.streetName || ticket.address || ticket.clusterName || ticket.area || '-';

                  const showVerifyAction = approval === 'BUTUH APPROVAL' && canVerifyReports;
                  const showAssignAction = !isTicketAssigned(ticket) && canAssignTech;

                  return (
                    <tr
                      key={ticket.id}
                      className="hover:bg-[#F0EDFF]/65 dark:hover:bg-[#2a194b]/50 transition-colors"
                    >
                      <td className="py-3.5 px-3 align-top">
                        <button
                          type="button"
                          onClick={() => (onSelectTicket ? onSelectTicket(ticket, 'overview') : onNavigate('tickets'))}
                          className="font-mono font-bold text-[#5145A6] dark:text-[#dab9ff] hover:underline text-left cursor-pointer whitespace-nowrap"
                        >
                          {ticket.woNumber}
                        </button>
                        <div className="text-[11px] text-[#8492A5] dark:text-[#cabde8] mt-0.5 truncate max-w-[185px]">
                          {nodeLabel || ticket.area || '-'}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-top min-w-[210px] max-w-[280px]">
                        <div className="font-bold text-[#26364A] dark:text-white truncate">
                          {ticket.customerName}
                        </div>
                        <div className="text-[11px] text-[#52647A] dark:text-[#cabde8] leading-snug mt-0.5">
                          {fullAddress}
                        </div>
                        {mapsInfo.url && (
                          <a
                            href={mapsInfo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#6657C8] dark:text-[#a380fe] hover:underline mt-0.5"
                          >
                            <MapPin className="w-3 h-3" />
                            <span>View Google Maps Pin</span>
                          </a>
                        )}
                      </td>

                      <td className="py-3.5 px-3 align-top">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                              ticket.installerName
                                ? 'bg-[#6657C8] dark:bg-[#7135b5] text-white'
                                : 'bg-[#FFF2D9] text-[#9D661F] dark:bg-amber-950/70 dark:text-amber-200'
                            }`}
                          >
                            {getInitials(ticket.installerName || 'UA')}
                          </div>
                          <div className="min-w-0">
                            <div
                              className={`font-semibold truncate max-w-[140px] ${
                                ticket.installerName
                                  ? 'text-[#26364A] dark:text-white'
                                  : 'italic text-[#9D661F] dark:text-amber-300'
                              }`}
                            >
                              {ticket.installerName || 'BELUM ASSIGN'}
                            </div>
                            <div className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8] truncate max-w-[140px]">
                              {ticket.leaderName ? `Lead: ${ticket.leaderName}` : ticket.contactorName || ticket.contractorName || '-'}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-top">
                        <div className="flex flex-col items-start gap-1">
                          {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' ? (
                            <StatusApprovalBadge status={ticket.approvalStatus} />
                          ) : (
                            <StatusInstallerBadge status={ticket.statusWOInstaller} />
                          )}
                          {isTicketClosed(ticket) && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <StatusAgentBadge status={ticket.statusWOAgent} />
                              {ticket.statusWOAgent !== 'Closed' && (
                                <span className="px-1.5 py-0.5 rounded bg-[#26364A] dark:bg-slate-800 text-white text-[9.5px] font-bold uppercase">
                                  Closed
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-top">
                        <div
                          className={`flex items-center gap-1 text-[11px] font-bold ${
                            geotag.tone === 'emerald'
                              ? 'text-[#218A63] dark:text-emerald-300'
                              : geotag.tone === 'amber'
                              ? 'text-[#9D661F] dark:text-amber-300'
                              : 'text-[#52647A] dark:text-[#cabde8]'
                          }`}
                        >
                          {geotag.tone === 'emerald' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          ) : geotag.tone === 'amber' ? (
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="whitespace-nowrap">{geotag.label}</span>
                        </div>
                        <div className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8] mt-0.5 tabular-nums">
                          {geotag.sublabel}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-top text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {showVerifyAction ? (
                            <button
                              type="button"
                              onClick={() => (onSelectTicket ? onSelectTicket(ticket, 'report') : onNavigate('tickets'))}
                              className="btn-3d-primary px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap"
                            >
                              Verify Now
                            </button>
                          ) : showAssignAction ? (
                            <button
                              type="button"
                              onClick={() => onNavigate('wo_assignment')}
                              className="btn-3d-amber px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap"
                            >
                              Assign
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => (onSelectTicket ? onSelectTicket(ticket, 'overview') : onNavigate('tickets'))}
                            className="btn-3d-lilac px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Detail</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="pt-3 border-t border-[#DDE6F0] dark:border-[#35105e] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#52647A] dark:text-[#cabde8] tabular-nums">
          <span>
            Menampilkan{' '}
            {feedTickets.length === 0
              ? '0'
              : `${(safeFeedPage - 1) * FEED_PAGE_SIZE + 1}–${Math.min(
                  safeFeedPage * FEED_PAGE_SIZE,
                  feedTickets.length
                )}`}{' '}
            dari {feedTickets.length} Work Orders
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safeFeedPage <= 1}
              onClick={() => setFeedPage(p => Math.max(1, p - 1))}
              className="btn-3d-lilac px-2.5 py-1.5 rounded-lg disabled:opacity-45 font-semibold inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Sebelumnya</span>
            </button>
            <span className="px-3 py-1 bg-[#6657C8] dark:bg-[#58149c] text-white rounded-md font-bold">
              {safeFeedPage} / {totalFeedPages}
            </span>
            <button
              type="button"
              disabled={safeFeedPage >= totalFeedPages}
              onClick={() => setFeedPage(p => Math.min(totalFeedPages, p + 1))}
              className="btn-3d-lilac px-2.5 py-1.5 rounded-lg disabled:opacity-45 font-semibold inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
            >
              <span>Selanjutnya</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 6. Interactive Canonical Status Token Matrix */}
      <div className="card-3d-lavender rounded-xl p-5 sm:p-6 dark:bg-[#1e1238] dark:shadow-[0_6px_24px_rgba(0,0,0,0.4)] dark:border-[#3b1d78] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-extrabold text-[#26364A] dark:text-white">
                Standardized Operational Status Token Matrix
              </span>
              <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] text-[10.5px] font-bold uppercase">
                Canonical Tokens
              </span>
            </div>
            <p className="text-xs text-[#52647A] dark:text-[#cabde8] mt-0.5">
              Klik baris status di bawah untuk drill-down langsung ke daftar Work Order terkait.
            </p>
          </div>
          <span className="text-[11px] font-bold text-[#2E7D8B] dark:text-[#dab9ff] px-2.5 py-1 bg-[#DDF4F4] dark:bg-[#2a194b] rounded border border-[#BDE4E8] dark:border-transparent self-start lg:self-auto">
            Live Counter Synced
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse mj-zebra-table">
            <thead>
              <tr className="bg-[#EDF3F8] dark:bg-[#160d29] text-[#52647A] dark:text-[#cabde8] text-[10.5px] font-bold uppercase tracking-wider border-y border-[#DDE6F0] dark:border-transparent">
                <th className="py-3 px-4 rounded-l-lg">Core Status Token</th>
                <th className="py-3 px-4">Aturan &amp; Makna Operasional</th>
                <th className="py-3 px-4">Kode</th>
                <th className="py-3 px-4">Canonical Badge</th>
                <th className="py-3 px-4 text-right rounded-r-lg">Jumlah Hari Ini</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE6F0] dark:divide-[#35105e] text-xs">
              {[
                {
                  token: 'CHECK-IN · PROGRESS',
                  dot: 'bg-[#65B8C4] dark:bg-sky-500 shadow-[0_0_8px_rgba(101,184,196,0.75)] dark:shadow-[0_0_8px_rgba(14,165,233,0.8)]',
                  textTone: 'text-[#2E7D8B] dark:text-sky-300',
                  code: 'CHK',
                  codeTone: 'bg-[#E7F1FB] text-[#3E81C6] dark:bg-sky-950/70 dark:text-sky-200',
                  meaning: 'Teknisi check-in via LiveChat PROGRESS dan/atau validasi koordinat Foto Rumah geotag.',
                  badge: <StatusInstallerBadge status="PROGRESS" />,
                  count: c.checkedInProgress,
                  filter: 'checked_in_progress' as WOKpiFilterKey
                },
                {
                  token: 'COMPLETE / APPROVED',
                  dot: 'bg-[#218A63] dark:bg-emerald-500 shadow-[0_0_8px_rgba(33,138,99,0.75)] dark:shadow-[0_0_8px_rgba(16,185,129,0.8)]',
                  textTone: 'text-[#218A63] dark:text-emerald-300',
                  code: 'CMP',
                  codeTone: 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-950/70 dark:text-emerald-200',
                  meaning: 'Laporan teknis & foto bukti telah diverifikasi dan disetujui oleh Dispatch NOC.',
                  badge: <StatusApprovalBadge status="APPROVED" />,
                  count: telemetry.completedCount,
                  filter: 'approved' as WOKpiFilterKey
                },
                {
                  token: 'REVISION / REJECTED',
                  dot: 'bg-[#C88735] dark:bg-amber-500 shadow-[0_0_8px_rgba(200,135,53,0.75)] dark:shadow-[0_0_8px_rgba(245,158,11,0.8)]',
                  textTone: 'text-[#9D661F] dark:text-amber-300',
                  code: 'REV',
                  codeTone: 'bg-[#FFF2D9] text-[#9D661F] dark:bg-amber-950/70 dark:text-amber-200',
                  meaning: 'Perbaikan / unggah ulang bukti foto atau data redaman diminta oleh Dispatch.',
                  badge: <StatusApprovalBadge status="REVISI" />,
                  count: c.revisionRejected,
                  filter: 'revision_rejected' as WOKpiFilterKey
                },
                {
                  token: 'RESCHEDULE',
                  dot: 'bg-[#6657C8] dark:bg-[#a380fe] shadow-[0_0_8px_rgba(102,87,200,0.7)] dark:shadow-[0_0_8px_rgba(163,128,254,0.8)]',
                  textTone: 'text-[#5145A6] dark:text-[#dab9ff]',
                  code: 'RSC',
                  codeTone: 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2e1459] dark:text-[#dab9ff]',
                  meaning: 'Jadwal kunjungan disesuaikan ulang atas permintaan pelanggan atau kendala akses.',
                  badge: <StatusInstallerBadge status="RESCHEDULE" />,
                  count: c.reportReschedule,
                  filter: 'report_reschedule' as WOKpiFilterKey
                },
                {
                  token: 'PENDING',
                  dot: 'bg-[#C88735] dark:bg-yellow-500 shadow-[0_0_8px_rgba(200,135,53,0.75)] dark:shadow-[0_0_8px_rgba(234,179,8,0.8)]',
                  textTone: 'text-[#9D661F] dark:text-yellow-300',
                  code: 'PND',
                  codeTone: 'bg-[#FFF2D9] text-[#9D661F] dark:bg-yellow-950/70 dark:text-yellow-200',
                  meaning: 'Pekerjaan tertunda sementara karena kendala teknis FAT/ODP atau perizinan.',
                  badge: <StatusInstallerBadge status="PENDING" />,
                  count: c.reportPending,
                  filter: 'report_pending' as WOKpiFilterKey
                },
                {
                  token: 'CANCEL',
                  dot: 'bg-[#D45B66] dark:bg-rose-500 shadow-[0_0_8px_rgba(212,91,102,0.75)] dark:shadow-[0_0_8px_rgba(244,63,94,0.8)]',
                  textTone: 'text-[#9B2C37] dark:text-rose-300',
                  code: 'CAN',
                  codeTone: 'bg-[#FCE9EB] text-[#9B2C37] dark:bg-rose-950/70 dark:text-rose-200',
                  meaning: 'Work Order dibatalkan dengan dokumentasi alasan dan verifikasi Dispatch.',
                  badge: <StatusInstallerBadge status="CANCEL" />,
                  count: c.reportCancel,
                  filter: 'report_cancel' as WOKpiFilterKey
                }
              ].map(row => (
                <tr
                  key={row.token}
                  onClick={() => onDrillDown(row.filter)}
                  className="hover:bg-[#F0EDFF]/65 dark:hover:bg-[#2a194b]/50 transition-colors cursor-pointer"
                >
                  <td className={`py-3 px-4 font-bold whitespace-nowrap ${row.textTone}`}>
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${row.dot}`} />
                      <span>{row.token}</span>
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[#52647A] dark:text-[#cabde8]">{row.meaning}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded font-mono font-bold text-[11px] ${row.codeTone}`}>
                      {row.code}
                    </span>
                  </td>
                  <td className="py-3 px-4">{row.badge}</td>
                  <td className="py-3 px-4 text-right font-display font-extrabold text-[#26364A] dark:text-white tabular-nums">
                    {row.count} WO
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. Operational Guardrails & Policy Banner */}
      <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-r from-[#F8FAFD] via-white to-[#EAE8FF]/70 dark:bg-none dark:bg-[#1a0f30] border border-[#DDE6F0] dark:border-[#3b1d78] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[inset_0_1px_2px_rgba(33,24,58,0.04)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6657C8] to-[#5145A6] dark:from-[#7135b5] dark:to-[#7135b5] text-white flex items-center justify-center shadow-xs shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
              FTTH Protocol &amp; RBAC Governance Active
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#cabde8]">
              Laporan teknis 3-tingkat &amp; bukti foto geotag diverifikasi sebelum penutupan WO untuk tanggal{' '}
              <span className="font-mono font-semibold">{todayWIB}</span>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 self-stretch sm:self-auto justify-end shrink-0">
          <span className="text-[11px] font-mono text-[#8492A5] dark:text-[#cabde8]">
            DB: {databaseStatus.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() =>
              onNavigate(
                currentUser.role === 'super_admin'
                  ? 'audit_logs'
                  : roleActionTarget
              )
            }
            className="btn-3d-lilac px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
          >
            {currentUser.role === 'super_admin'
              ? 'Buka Audit Trail'
              : 'Buka Daftar WO'}
          </button>
        </div>
      </div>
    </div>
  );
};
