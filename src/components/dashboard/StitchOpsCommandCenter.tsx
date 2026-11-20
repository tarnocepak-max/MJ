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
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  Wrench,
  X,
  XCircle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
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
  management_data: 'Data Governance & Operations Center',
  it_support: 'System & Audit Operations Center',
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

  const [searchQuery, setSearchQuery] = useState('');
  const [leaderFilter, setLeaderFilter] = useState('ALL');
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [feedPage, setFeedPage] = useState(1);
  const [isSyncing, setIsSyncing] = useState(false);

  const isGlobalRole =
    currentUser.role === 'super_admin' ||
    currentUser.role === 'dispatch' ||
    currentUser.role === 'management_data' ||
    currentUser.role === 'it_support';

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
      { key: 'checkin', label: 'Check-In / Progress', count: c.checkedInProgress, color: '#0ea5e9' },
      { key: 'complete', label: 'Approved - Done', count: c.approvedDone, color: '#10b981' },
      { key: 'approval', label: 'Butuh Approval', count: c.butuhApproval, color: '#58149c' },
      { key: 'revision', label: 'Revisi / Rejected', count: c.revisionRejected, color: '#f59e0b' },
      { key: 'reschedule', label: 'Reschedule', count: c.approvedReschedule || c.reportReschedule, color: '#6a46c1' },
      { key: 'pending', label: 'Pending', count: c.approvedPending || c.reportPending, color: '#eab308' },
      { key: 'cancel', label: 'Cancel', count: c.approvedCancel || c.reportCancel, color: '#f43f5e' }
    ];

    const sumBuckets = items.reduce((acc, i) => acc + i.count, 0);
    const remaining = Math.max(0, total - sumBuckets);
    if (remaining > 0) {
      items.push({ key: 'idle', label: 'Belum Check-in / Open', count: remaining, color: '#cbd5e1' });
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

    const list = priorityOnly
      ? filteredTodayTickets.filter(t => priorityRank(t) <= 3)
      : filteredTodayTickets;

    return list.slice().sort((a, b) => {
      const diff = priorityRank(a) - priorityRank(b);
      if (diff !== 0) return diff;
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });
  }, [filteredTodayTickets, priorityOnly]);

  const totalFeedPages = Math.max(1, Math.ceil(feedTickets.length / FEED_PAGE_SIZE));
  const safeFeedPage = Math.min(feedPage, totalFeedPages);
  const pagedFeedTickets = useMemo(() => {
    const start = (safeFeedPage - 1) * FEED_PAGE_SIZE;
    return feedTickets.slice(start, start + FEED_PAGE_SIZE);
  }, [feedTickets, safeFeedPage]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    kpiContractorFilter !== 'ALL' ||
    kpiAreaFilter !== 'ALL' ||
    leaderFilter !== 'ALL';

  const handleResetFilters = () => {
    setSearchQuery('');
    setKpiContractorFilter('ALL');
    setKpiAreaFilter('ALL');
    setLeaderFilter('ALL');
    setPriorityOnly(false);
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
      {/* 1. Command Header & Telemetry Filter Deck */}
      <div className="relative bg-white dark:bg-[#1e1238] rounded-xl p-5 sm:p-6 shadow-[0_4px_20px_rgba(53,16,94,0.06),inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] overflow-hidden">
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-gradient-to-br from-[#7135b5]/10 via-[#a380fe]/5 to-transparent blur-3xl pointer-events-none" />

        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div className="flex flex-col space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#f3eaff] dark:bg-[#2e1459] text-[#58149c] dark:text-[#dab9ff] text-[11px] font-bold tracking-wider uppercase shadow-[inset_0_1px_1px_rgba(33,24,58,0.08)]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    databaseStatus === 'connected' ? 'bg-[#58149c] dark:bg-[#dab9ff] animate-pulse' : 'bg-amber-500'
                  }`}
                />
                <span>FTTH Core Live · {c.totalToday} WO Hari Ini</span>
              </div>
              <span className="text-[#7d7484] text-xs hidden sm:inline">•</span>
              <span className="text-[#4b4452] dark:text-[#cabde8] text-[11px] font-semibold font-mono tabular-nums">
                WIB: {todayWIB} · Sync: {syncStatus}
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-[28px] leading-tight text-[#1f1638] dark:text-white tracking-tight font-extrabold">
              Global Operations Command <span className="text-[#58149c] dark:text-[#dab9ff] font-light">—</span>{' '}
              {roleSubtitle}
            </h1>
            <p className="text-xs sm:text-sm text-[#4b4452] dark:text-[#cabde8] max-w-3xl leading-relaxed">
              Pemantauan operasional Work Order FTTH real-time, check-in PROGRESS &amp; validasi Foto Rumah geotag,
              serta distribusi vendor untuk{' '}
              <span className="font-semibold text-[#58149c] dark:text-[#dab9ff]">{currentUser.name}</span>.
            </p>
          </div>

          {/* Action Cluster */}
          <div className="flex flex-wrap items-center gap-2.5 self-start xl:self-center shrink-0">
            <button
              type="button"
              onClick={handleExportMatrix}
              className="px-4 py-2.5 rounded-lg bg-[#f3eaff] dark:bg-[#2a194b] text-[#1f1638] dark:text-white hover:bg-[#eee4ff] dark:hover:bg-[#342b4e] transition-all shadow-[0_1px_3px_rgba(33,24,58,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-none border border-[#e8ddff] dark:border-[#4b386b] flex items-center gap-2 text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-[#58149c] dark:text-[#dab9ff]" />
              <span>Export Matrix</span>
            </button>
            <button
              type="button"
              onClick={handleForceResync}
              disabled={isSyncing || isKpiLoading}
              className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#7135b5] to-[#6a46c1] text-white shadow-[0_4px_14px_rgba(88,20,156,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 active:translate-y-0.5 transition-all flex items-center gap-2 text-xs font-bold cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing || isKpiLoading ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Menyinkronkan...' : 'Force Resync'}</span>
            </button>
          </div>
        </div>

        {/* 5-Column Micro Filter Toolbar */}
        <div className="mt-5 pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-[#f8f1ff] dark:bg-[#160d29] p-3 rounded-lg border border-[#e8ddff]/70 dark:border-[#35105E] shadow-[inset_0_1px_2px_rgba(33,24,58,0.04)]">
          {/* 1. Search WO / OLT / Cluster */}
          <div className="relative col-span-1 sm:col-span-2 lg:col-span-1">
            <Search className="w-4 h-4 text-[#7d7484] dark:text-[#A78BFA] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setFeedPage(1);
              }}
              placeholder="Cari WO, OLT, Cluster, Teknisi..."
              aria-label="Cari Work Order di Operations Command"
              className="w-full pl-9 pr-7 py-2 bg-white dark:bg-[#1e1238] rounded-md text-xs text-[#1f1638] dark:text-white border border-[#e8ddff] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(33,24,58,0.05)] focus:outline-none focus:ring-2 focus:ring-[#58149c]/25 placeholder:text-[#7d7484]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFeedPage(1);
                }}
                aria-label="Bersihkan pencarian"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#7d7484] hover:text-[#58149c] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 2. Vendor Selector */}
          <div className="relative">
            <select
              aria-label="Filter Vendor"
              disabled={!isGlobalRole && Boolean(currentUser.contractor)}
              value={!isGlobalRole && currentUser.contractor ? currentUser.contractor : kpiContractorFilter}
              onChange={e => {
                setKpiContractorFilter(e.target.value);
                setFeedPage(1);
              }}
              className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1e1238] rounded-md text-xs font-semibold text-[#1f1638] dark:text-white border border-[#e8ddff] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(33,24,58,0.05)] focus:outline-none focus:ring-2 focus:ring-[#58149c]/25 appearance-none cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
            >
              <option value="ALL">Semua Vendor (Global)</option>
              {vendorOptions.map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-[#7d7484] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 3. Area Selector */}
          <div className="relative">
            <select
              aria-label="Filter Area"
              value={kpiAreaFilter}
              onChange={e => {
                setKpiAreaFilter(e.target.value);
                setFeedPage(1);
              }}
              className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1e1238] rounded-md text-xs font-semibold text-[#1f1638] dark:text-white border border-[#e8ddff] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(33,24,58,0.05)] focus:outline-none focus:ring-2 focus:ring-[#58149c]/25 appearance-none cursor-pointer"
            >
              <option value="ALL">Semua Area Kerja</option>
              {areaOptions.map(a => (
                <option key={a} value={a}>
                  Area: {a}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-[#7d7484] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 4. Leader Filter */}
          <div className="relative">
            <select
              aria-label="Filter Leader"
              value={leaderFilter}
              onChange={e => {
                setLeaderFilter(e.target.value);
                setFeedPage(1);
              }}
              className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1e1238] rounded-md text-xs font-semibold text-[#1f1638] dark:text-white border border-[#e8ddff] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(33,24,58,0.05)] focus:outline-none focus:ring-2 focus:ring-[#58149c]/25 appearance-none cursor-pointer"
            >
              <option value="ALL">Semua Leader / Korlap</option>
              {leaderOptions.map(l => (
                <option key={l} value={l}>
                  Lead: {l}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-[#7d7484] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 5. Active Operational Date & Filter Reset */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onNavigate(roleActionTarget)}
              title="Buka daftar lengkap Work Orders hari ini"
              className="flex-1 px-3 py-2 bg-white dark:bg-[#1e1238] rounded-md text-left text-xs font-semibold text-[#1f1638] dark:text-white border border-[#e8ddff] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(33,24,58,0.05)] flex items-center justify-between gap-2 hover:border-[#7135b5] transition-colors cursor-pointer min-w-0"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Calendar className="w-3.5 h-3.5 text-[#58149c] dark:text-[#dab9ff] shrink-0" />
                <span className="truncate tabular-nums">{formatIndonesianWODate(todayWIB) || todayWIB}</span>
              </span>
              <ExternalLink className="w-3 h-3 text-[#7d7484] shrink-0" />
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                title="Reset semua filter"
                className="px-2.5 py-2 rounded-md bg-[#eee4ff] dark:bg-[#2e1459] text-[#58149c] dark:text-[#dab9ff] hover:bg-[#e1d4ff] text-xs font-bold cursor-pointer shrink-0"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Primary 6-Card 3D KPI Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Card 1: Total WO Ingest */}
        <button
          type="button"
          onClick={() => onDrillDown('total_today')}
          className="relative group text-left bg-white dark:bg-[#1e1238] rounded-xl p-4 shadow-[0_4px_16px_rgba(53,16,94,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(53,16,94,0.12)] transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                TOTAL WO INGEST
              </span>
              <Layers className="w-4 h-4 text-[#58149c] dark:text-[#dab9ff] shrink-0" />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-extrabold text-[#1f1638] dark:text-white tabular-nums">
                {c.totalToday}
              </span>
              <span className="text-[11px] font-bold text-[#58149c] dark:text-[#dab9ff] px-1.5 py-0.5 rounded bg-[#f3eaff] dark:bg-[#2e1459] tabular-nums">
                {telemetry.assignedPct}% Assign
              </span>
            </div>
            <div className="mt-3 h-8 w-full flex items-end gap-1" aria-hidden="true">
              {telemetry.sparkHeights.map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-t transition-all ${
                    i < 2
                      ? 'bg-[#e8ddff] dark:bg-[#2e1459]'
                      : i < 4
                      ? 'bg-[#dab9ff] dark:bg-[#4c2488]'
                      : i === 4
                      ? 'bg-[#58149c]/50 dark:bg-[#7135b5]/60'
                      : i === 5
                      ? 'bg-[#58149c]/75 dark:bg-[#7135b5]/80'
                      : 'bg-[#58149c] dark:bg-[#a380fe]'
                  }`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
          <div className="mt-2.5 text-[11.5px] text-[#4b4452] dark:text-[#cabde8] flex items-center justify-between tabular-nums">
            <span>Mapped: {telemetry.mappedCount}</span>
            <span className="font-semibold text-[#58149c] dark:text-[#dab9ff]">
              Unmapped: {c.unmappedDistribution}
            </span>
          </div>
        </button>

        {/* Card 2: Assigned to Leader / Tech */}
        <button
          type="button"
          onClick={() => onDrillDown('assigned')}
          className="relative group text-left bg-white dark:bg-[#1e1238] rounded-xl p-4 shadow-[0_4px_16px_rgba(53,16,94,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(53,16,94,0.12)] transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                ASSIGNED TO TECH
              </span>
              <Users className="w-4 h-4 text-[#6a46c1] dark:text-[#a380fe] shrink-0" />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-extrabold text-[#1f1638] dark:text-white tabular-nums">
                {c.assigned}
              </span>
              <span className="text-[11px] font-bold text-[#6a46c1] dark:text-[#dab9ff] px-1.5 py-0.5 rounded bg-[#f8f1ff] dark:bg-[#2e1459] tabular-nums">
                {telemetry.assignedPct}%
              </span>
            </div>
            <div className="mt-4 w-full bg-[#f3eaff] dark:bg-[#160d29] h-2 rounded-full overflow-hidden">
              <div
                className="bg-[#6a46c1] dark:bg-[#a380fe] h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, telemetry.assignedPct)}%` }}
              />
            </div>
          </div>
          <div className="mt-3 text-[11.5px] text-[#4b4452] dark:text-[#cabde8] flex items-center justify-between">
            <span className="truncate">Leads: {effectiveSummary.byLeader.length} Aktif</span>
            <span className="text-[#6a46c1] dark:text-[#dab9ff] font-semibold shrink-0">
              {telemetry.assignedPct >= 80 ? 'Optimal' : 'Proses'}
            </span>
          </div>
        </button>

        {/* Card 3: Unassigned Buffer */}
        <button
          type="button"
          onClick={() => onDrillDown('unassigned')}
          className="relative group text-left bg-white dark:bg-[#1e1238] rounded-xl p-4 shadow-[0_4px_16px_rgba(53,16,94,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(53,16,94,0.12)] transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                UNASSIGNED BUFFER
              </span>
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  c.unassigned > 0
                    ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]'
                    : 'bg-emerald-500'
                }`}
              />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span
                className={`font-display text-3xl font-extrabold tabular-nums ${
                  c.unassigned > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {c.unassigned}
              </span>
              <span
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                  c.unassigned > 0
                    ? 'text-amber-800 bg-amber-100 dark:bg-amber-950/70 dark:text-amber-200'
                    : 'text-emerald-800 bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-200'
                }`}
              >
                {c.unassigned > 0 ? 'Action Req' : 'Clear'}
              </span>
            </div>
            <div
              className={`mt-3 py-1.5 px-2 rounded text-[11px] flex items-center gap-1.5 ${
                c.unassigned > 0
                  ? 'bg-amber-50/80 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200'
                  : 'bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {c.unassigned > 0 ? `Belum Check-in: ${c.notCheckedIn} WO` : 'Seluruh WO sudah di-assign'}
              </span>
            </div>
          </div>
          <div className="mt-2 text-[11.5px] text-[#4b4452] dark:text-[#cabde8] truncate">
            {telemetry.topUnassigned
              ? `${telemetry.topUnassigned[0]}: ${telemetry.topUnassigned[1]} WO`
              : 'Distribusi teknisi terisi'}
          </div>
        </button>

        {/* Card 4: Check-in / Progress & Foto Rumah */}
        <button
          type="button"
          onClick={() => onDrillDown('checked_in_progress')}
          className="relative group text-left bg-white dark:bg-[#1e1238] rounded-xl p-4 shadow-[0_4px_16px_rgba(53,16,94,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(53,16,94,0.12)] transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                CHECK-IN / PROGRESS
              </span>
              <MapPin className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-extrabold text-sky-700 dark:text-sky-300 tabular-nums">
                {c.checkedInProgress}
              </span>
              <span className="text-[11px] font-bold text-sky-800 bg-sky-100 dark:bg-sky-950/70 dark:text-sky-200 px-1.5 py-0.5 rounded tabular-nums">
                Geotag {telemetry.geotagPct}%
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-sky-100 dark:bg-sky-950/70 flex items-center justify-center text-sky-700 dark:text-sky-300 shrink-0">
                <Camera className="w-4 h-4" />
              </div>
              <div className="text-[11.5px] text-[#4b4452] dark:text-[#cabde8] leading-tight">
                <span className="font-semibold text-[#1f1638] dark:text-white tabular-nums">
                  {telemetry.geotagVerifiedCount} Foto Rumah
                </span>{' '}
                terverifikasi GPS
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10.5px] font-semibold text-[#7d7484] dark:text-[#cabde8]/80 truncate">
            PROGRESS Check-in &amp; Geotag
          </div>
        </button>

        {/* Card 5: Approved Done & Completion Rate */}
        <button
          type="button"
          onClick={() => onDrillDown('approved_done')}
          className="relative group text-left bg-white dark:bg-[#1e1238] rounded-xl p-4 shadow-[0_4px_16px_rgba(53,16,94,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(53,16,94,0.12)] transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                DONE (APPROVED)
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                {c.approvedDone}
              </span>
              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-200 px-1.5 py-0.5 rounded tabular-nums">
                Done {telemetry.completionPct}%
              </span>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                Approved: {c.approved} ({telemetry.approvalPct}%) · Closed: {c.closed}
              </span>
            </div>
          </div>
          <div className="mt-2 text-[11.5px] text-[#4b4452] dark:text-[#cabde8] tabular-nums">
            Avg. Durasi: {formatDurationMinutesLabel(telemetry.avgDurationMinutes)}
          </div>
        </button>

        {/* Card 6: Verification Queue Spotlight */}
        <div className="relative group bg-gradient-to-br from-[#e8ddff]/85 via-[#f8f1ff] to-white dark:from-[#35105e] dark:via-[#261447] dark:to-[#1e1238] rounded-xl p-4 shadow-[0_6px_20px_rgba(113,53,181,0.15),inset_0_1px_0_rgba(255,255,255,0.95)] dark:shadow-[0_6px_20px_rgba(0,0,0,0.45)] border border-[#d8b4fe]/70 dark:border-[#7135b5]/60 hover:-translate-y-1 hover:shadow-[0_14px_28px_rgba(88,20,156,0.22)] transition-all flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#58149c] dark:text-[#dab9ff]">
                VERIFICATION QUEUE
              </span>
              {c.butuhApproval > 0 && (
                <span className="w-2.5 h-2.5 rounded-full bg-[#a380fe] animate-ping shrink-0" />
              )}
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-extrabold text-[#58149c] dark:text-white tabular-nums">
                {c.butuhApproval}
              </span>
              <span className="text-[10.5px] font-bold text-white bg-[#58149c] px-2 py-0.5 rounded-full shadow-xs">
                {c.butuhApproval > 0 ? 'Hot Desk' : 'Synced'}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-[#1f1638] dark:text-[#f5eeff] text-xs">
              <span>Aging Avg:</span>
              <span className="font-bold text-[#6a46c1] dark:text-[#dab9ff] tabular-nums">
                {telemetry.avgApprovalWaitMin !== null ? `${telemetry.avgApprovalWaitMin} min` : '—'}
              </span>
            </div>
          </div>
          <div className="mt-2.5">
            <button
              type="button"
              onClick={() => {
                if (currentUser.role === 'super_admin' || currentUser.role === 'dispatch') {
                  onNavigate('verification_desk');
                } else {
                  onDrillDown('butuh_approval');
                }
              }}
              className="w-full py-1.5 px-2 text-center bg-[#58149c] hover:bg-[#7135b5] text-white rounded-md text-[11px] font-bold shadow-xs transition-all cursor-pointer inline-flex items-center justify-center gap-1"
            >
              <span>Open Audit Flow</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Secondary Tactical KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 p-3 bg-white dark:bg-[#1e1238] rounded-xl border border-[#e8ddff]/80 dark:border-[#3b1d78] shadow-[0_2px_8px_rgba(53,16,94,0.04),inset_0_1px_0_rgba(255,255,255,0.85)]">
        <button
          type="button"
          onClick={() => onDrillDown('approved')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f8f1ff] dark:bg-[#160d29] hover:bg-[#eee4ff] dark:hover:bg-[#2a194b] transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-[#58149c]/15 flex items-center justify-center text-[#58149c] dark:text-[#dab9ff] shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#7d7484] dark:text-[#cabde8] uppercase truncate">
              APPROVAL RATE
            </div>
            <div className="font-display text-base font-extrabold text-[#58149c] dark:text-[#dab9ff] tabular-nums">
              {telemetry.approvalPct}%{' '}
              <span className="text-[11px] font-normal text-[#7d7484]">({c.approved})</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('approved_reschedule')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f8f1ff] dark:bg-[#160d29] hover:bg-[#eee4ff] dark:hover:bg-[#2a194b] transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-[#6a46c1]/15 flex items-center justify-center text-[#6a46c1] dark:text-[#dab9ff] shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#7d7484] dark:text-[#cabde8] uppercase truncate">
              RESCHEDULE
            </div>
            <div className="font-display text-base font-extrabold text-[#6a46c1] dark:text-[#dab9ff] tabular-nums">
              {c.approvedReschedule} <span className="text-xs font-normal text-[#7d7484]">WO</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('approved_pending')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f8f1ff] dark:bg-[#160d29] hover:bg-[#eee4ff] dark:hover:bg-[#2a194b] transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-300 shrink-0">
            <Hourglass className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#7d7484] dark:text-[#cabde8] uppercase truncate">
              PENDING
            </div>
            <div className="font-display text-base font-extrabold text-amber-900 dark:text-amber-200 tabular-nums">
              {c.approvedPending} <span className="text-xs font-normal text-[#7d7484]">WO</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('approved_cancel')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f8f1ff] dark:bg-[#160d29] hover:bg-[#eee4ff] dark:hover:bg-[#2a194b] transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-rose-500/15 flex items-center justify-center text-rose-700 dark:text-rose-300 shrink-0">
            <XCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#7d7484] dark:text-[#cabde8] uppercase truncate">
              CANCEL
            </div>
            <div className="font-display text-base font-extrabold text-rose-800 dark:text-rose-300 tabular-nums">
              {c.approvedCancel} <span className="text-xs font-normal text-[#7d7484]">WO</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('revision_rejected')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f8f1ff] dark:bg-[#160d29] hover:bg-[#eee4ff] dark:hover:bg-[#2a194b] transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-700 dark:text-amber-300 shrink-0">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#7d7484] dark:text-[#cabde8] uppercase truncate">
              PERLU REVISI
            </div>
            <div className="font-display text-base font-extrabold text-amber-800 dark:text-amber-300 tabular-nums">
              {c.revisionRejected} <span className="text-xs font-normal text-[#7d7484]">WO</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onDrillDown('approved_done')}
          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f8f1ff] dark:bg-[#160d29] hover:bg-[#eee4ff] dark:hover:bg-[#2a194b] transition-colors text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-[#7d7484] dark:text-[#cabde8] uppercase truncate">
              COMPLETION RATE
            </div>
            <div className="font-display text-base font-extrabold text-emerald-800 dark:text-emerald-300 tabular-nums">
              {telemetry.completionPct}%
            </div>
          </div>
        </button>
      </div>

      {/* 4. Standard WO Lifecycle Pipeline (7-Stage Interactive Stepper) */}
      <div className="relative bg-white dark:bg-[#1e1238] rounded-xl p-5 sm:p-6 shadow-[0_4px_20px_rgba(53,16,94,0.06),inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-5 gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-extrabold text-[#1f1638] dark:text-white">
                Standard WO Lifecycle Pipeline
              </span>
              <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-[#58149c] text-white uppercase tracking-wider">
                AppFlow Live
              </span>
            </div>
            <p className="text-xs text-[#4b4452] dark:text-[#cabde8] mt-0.5">
              Alur operasional terintegrasi: Import WO → Distribusi Leader → Assign Teknisi → Check-in PROGRESS &amp;
              Foto Rumah Geotag → Report → Approval → Closed.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#7d7484] dark:text-[#cabde8] shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Auto-sync Supabase aktif</span>
          </div>
        </div>

        <div className="relative py-3 px-2 overflow-x-auto">
          <div className="min-w-[840px] relative">
            {/* Background Connecting Track */}
            <div className="absolute top-7 left-12 right-12 h-1 bg-[#e8ddff] dark:bg-[#35105e] rounded-full z-0" />
            {/* Active Progress Track */}
            <div
              className="absolute top-7 left-12 h-1 bg-gradient-to-r from-emerald-500 via-sky-500 to-[#7135b5] rounded-full z-0 transition-all duration-500"
              style={{ width: `calc(${pipelineFillPct}% - 6rem)` }}
            />

            <div className="grid grid-cols-7 gap-2 relative z-10">
              {/* Stage 1: Import WO */}
              <button
                type="button"
                onClick={() => onDrillDown('total_today')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform group-hover:scale-105">
                  <CloudDownload className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#1f1638] dark:text-white uppercase tracking-wider">
                  1. Import WO
                </span>
                <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold tabular-nums">
                  {c.totalToday} Ingested
                </span>
                <span className="text-[10.5px] text-[#7d7484] mt-0.5">{todayWIB}</span>
              </button>

              {/* Stage 2: Distribusi Leader */}
              <button
                type="button"
                onClick={() => onDrillDown('unmapped_distribution')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform group-hover:scale-105">
                  <Users className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#1f1638] dark:text-white uppercase tracking-wider">
                  2. Auto Leader
                </span>
                <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold tabular-nums">
                  {telemetry.mappedCount} Mapped
                </span>
                <span className="text-[10.5px] text-[#7d7484] mt-0.5">
                  {c.unmappedDistribution > 0 ? `${c.unmappedDistribution} Unmapped` : 'Vendor Routing'}
                </span>
              </button>

              {/* Stage 3: Tech Assignment */}
              <button
                type="button"
                onClick={() => onDrillDown('assigned')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] transition-transform group-hover:scale-105">
                  <UserCheck className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#1f1638] dark:text-white uppercase tracking-wider">
                  3. Assignment
                </span>
                <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold tabular-nums">
                  {c.assigned} Assigned
                </span>
                <span className="text-[10.5px] text-[#7d7484] mt-0.5">
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
                  className={`relative w-14 h-14 rounded-xl bg-gradient-to-tr from-sky-600 to-sky-400 text-white flex items-center justify-center shadow-[0_0_20px_rgba(2,132,199,0.5),inset_0_1px_0_rgba(255,255,255,0.6)] transition-transform group-hover:scale-105 ${
                    c.checkedInProgress > 0 ? 'animate-pulse' : ''
                  }`}
                >
                  <Camera className="w-6 h-6" />
                  {c.checkedInProgress > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-[#1f1638] text-white text-[9px] font-bold rounded-full">
                      LIVE
                    </span>
                  )}
                </div>
                <span className="mt-3 text-[11px] font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wider">
                  4. Check-in &amp; Geo
                </span>
                <span className="text-xs text-sky-800 dark:text-sky-200 font-bold tabular-nums">
                  {c.checkedInProgress} On-Site
                </span>
                <span className="text-[10.5px] text-sky-600 dark:text-sky-400 font-semibold mt-0.5">
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
                      ? 'bg-[#6a46c1] text-white shadow-[0_4px_12px_rgba(106,70,193,0.35)]'
                      : 'bg-[#eee4ff] dark:bg-[#2a194b] text-[#4b4452] dark:text-[#cabde8]'
                  }`}
                >
                  <FileCheck2 className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#1f1638] dark:text-white uppercase tracking-wider">
                  5. Tech Report
                </span>
                <span className="text-xs text-[#6a46c1] dark:text-[#dab9ff] font-bold tabular-nums">
                  {telemetry.totalReported} Submitted
                </span>
                <span className="text-[10.5px] text-[#7d7484] mt-0.5">
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
                      ? 'bg-[#7135b5] text-white shadow-[0_4px_12px_rgba(113,53,181,0.35)]'
                      : 'bg-[#eee4ff] dark:bg-[#2a194b] text-[#4b4452] dark:text-[#cabde8]'
                  }`}
                >
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#1f1638] dark:text-white uppercase tracking-wider">
                  6. Verification
                </span>
                <span className="text-xs text-[#58149c] dark:text-[#dab9ff] font-bold tabular-nums">
                  {c.butuhApproval} Pending QA
                </span>
                <span className="text-[10.5px] text-[#7d7484] mt-0.5">Dispatch Review</span>
              </button>

              {/* Stage 7: Terminal State */}
              <button
                type="button"
                onClick={() => onDrillDown('closed')}
                className="flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-xl bg-[#f3eaff] dark:bg-[#2e1459] text-[#58149c] dark:text-[#dab9ff] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-transform group-hover:scale-105">
                  <GitBranch className="w-6 h-6" />
                </div>
                <span className="mt-3 text-[11px] font-bold text-[#1f1638] dark:text-white uppercase tracking-wider">
                  7. Terminal State
                </span>
                <span className="text-xs text-[#58149c] dark:text-[#dab9ff] font-bold tabular-nums">
                  {c.approvedDone} Done
                </span>
                <span className="text-[10.5px] text-[#7d7484] mt-0.5">Closed: {c.closed}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Status Distribution Analytics (4 Cols) & Recent Critical WO Operational Feed (8 Cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 4 Cols: WO Distribution Mix + Live FTTH Node / Vendor Telemetry */}
        <div className="xl:col-span-4 bg-white dark:bg-[#1e1238] rounded-xl p-5 sm:p-6 shadow-[0_4px_20px_rgba(53,16,94,0.06),inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-extrabold text-[#1f1638] dark:text-white">
                WO Distribution Mix
              </h2>
              <p className="text-xs text-[#4b4452] dark:text-[#cabde8] tabular-nums">
                Distribusi live dari {c.totalToday} total Work Order
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(roleActionTarget)}
              title="Buka semua Work Order"
              className="w-8 h-8 rounded-lg bg-[#f8f1ff] dark:bg-[#2a194b] flex items-center justify-center text-[#58149c] dark:text-[#dab9ff] hover:bg-[#eee4ff] transition-colors cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>

          {/* Dynamic SVG Donut Chart */}
          <div className="flex flex-col items-center justify-center py-1 relative">
            <svg className="w-48 h-48 transform -rotate-90" viewBox="0 0 120 120" aria-label="WO Distribution Donut Chart">
              <circle cx="60" cy="60" fill="transparent" r="46" className="stroke-[#f3eaff] dark:stroke-[#2e1459]" strokeWidth="14" />
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
              <span className="font-display text-3xl font-extrabold text-[#1f1638] dark:text-white leading-none tabular-nums">
                {c.totalToday}
              </span>
              <span className="text-[10.5px] font-bold text-[#7d7484] dark:text-[#cabde8] uppercase tracking-wider mt-1">
                Total WO
              </span>
              <span className="text-[10.5px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full mt-1 tabular-nums">
                {telemetry.completionPct}% Done
              </span>
            </div>
          </div>

          {/* Segmented Progress Bars */}
          <div className="space-y-3 pt-1">
            {[
              {
                label: 'Check-In / Progress',
                count: c.checkedInProgress,
                dotClass: 'bg-sky-500',
                barClass: 'bg-sky-500',
                textClass: 'text-sky-700 dark:text-sky-300',
                filter: 'checked_in_progress' as WOKpiFilterKey
              },
              {
                label: 'Approved - Done',
                count: c.approvedDone,
                dotClass: 'bg-emerald-500',
                barClass: 'bg-emerald-500',
                textClass: 'text-emerald-700 dark:text-emerald-300',
                filter: 'approved_done' as WOKpiFilterKey
              },
              {
                label: 'Butuh Approval',
                count: c.butuhApproval,
                dotClass: 'bg-[#58149c]',
                barClass: 'bg-[#58149c] dark:bg-[#a380fe]',
                textClass: 'text-[#58149c] dark:text-[#dab9ff]',
                filter: 'butuh_approval' as WOKpiFilterKey
              }
            ].map(item => {
              const pct = c.totalToday > 0 ? Math.round((item.count / c.totalToday) * 1000) / 10 : 0;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onDrillDown(item.filter)}
                  className="w-full text-left group cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1.5 text-[#1f1638] dark:text-white font-semibold group-hover:text-[#58149c] dark:group-hover:text-[#dab9ff]">
                      <span className={`w-2.5 h-2.5 rounded-full ${item.dotClass}`} />
                      <span>{item.label}</span>
                    </span>
                    <span className={`${item.textClass} font-bold tabular-nums`}>
                      {item.count} Tiket ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-[#f3eaff] dark:bg-[#160d29] h-2 rounded-full overflow-hidden">
                    <div
                      className={`${item.barClass} h-full rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </button>
              );
            })}

            <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#7d7484] dark:text-[#cabde8] border-t border-[#f3eaff] dark:border-[#35105e]">
              <span>Status Lain:</span>
              <div className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                <span className="text-amber-700 dark:text-amber-300">Rev: {c.revisionRejected}</span>
                <span>•</span>
                <span className="text-[#6a46c1] dark:text-[#dab9ff]">Res: {c.reportReschedule}</span>
                <span>•</span>
                <span className="text-amber-800 dark:text-amber-200">Pnd: {c.reportPending}</span>
                <span>•</span>
                <span className="text-rose-700 dark:text-rose-300">Can: {c.reportCancel}</span>
              </div>
            </div>
          </div>

          {/* Dark Sub-panel: Live Infrastructure & Vendor Capacity */}
          <div className="bg-[#160D29] p-4 rounded-xl text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] space-y-2">
            <div className="flex items-center justify-between text-[#e1d4ff] text-[10.5px] font-bold uppercase tracking-wider">
              <span>FTTH Node &amp; Vendor Load</span>
              <span className="text-emerald-400 font-mono">
                {telemetry.oltCount} OLT · {telemetry.fatCount} FAT
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-base font-extrabold text-white truncate">
                {topVendorLoad ? topVendorLoad.contractorName : 'Belum ada beban vendor'}
              </span>
              <span className="text-xs font-bold text-[#dab9ff] tabular-nums shrink-0">
                {topVendorLoad && c.totalToday > 0
                  ? `${topVendorLoad.total} / ${c.totalToday} WO`
                  : `${c.totalToday} WO`}
              </span>
            </div>
            <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#6a46c1] to-[#a380fe] h-full rounded-full transition-all duration-500"
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
        </div>

        {/* Right 8 Cols: Recent Critical WO Operational Feed Table */}
        <div className="xl:col-span-8 bg-white dark:bg-[#1e1238] rounded-xl p-5 sm:p-6 shadow-[0_4px_20px_rgba(53,16,94,0.06),inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-extrabold text-[#1f1638] dark:text-white">
                  Recent Critical WO Operational Feed
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10.5px] font-bold">
                  Live Ticker
                </span>
              </div>
              <p className="text-xs text-[#4b4452] dark:text-[#cabde8]">
                Stream Work Order aktif hari ini dengan alamat pelanggan, status approval, dan validasi Foto Rumah geotag.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setPriorityOnly(prev => !prev);
                  setFeedPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                  priorityOnly
                    ? 'bg-[#58149c] text-white border-[#58149c]'
                    : 'bg-[#f8f1ff] dark:bg-[#2a194b] text-[#4b4452] dark:text-[#cabde8] border-[#e8ddff] dark:border-[#4b386b] hover:bg-[#eee4ff]'
                }`}
              >
                <ListFilter className="w-3.5 h-3.5" />
                <span>{priorityOnly ? 'Prioritas Aktif' : 'Filter Priority'}</span>
              </button>
              <button
                type="button"
                onClick={handleForceResync}
                disabled={isSyncing}
                className="px-3 py-1.5 rounded-lg bg-[#f8f1ff] dark:bg-[#2a194b] text-[#4b4452] dark:text-[#cabde8] border border-[#e8ddff] dark:border-[#4b386b] hover:bg-[#eee4ff] text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Sync</span>
              </button>
            </div>
          </div>

          {/* Operational Feed Table */}
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f8f1ff] dark:bg-[#160d29] text-[#7d7484] dark:text-[#cabde8] text-[10.5px] font-bold uppercase tracking-wider">
                  <th className="py-3 px-3 rounded-l-lg">WO ID &amp; Node</th>
                  <th className="py-3 px-3">Pelanggan &amp; Alamat</th>
                  <th className="py-3 px-3">Teknisi</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Foto Rumah &amp; Optical</th>
                  <th className="py-3 px-3 text-right rounded-r-lg">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eee4ff]/60 dark:divide-[#35105e] text-xs">
                {pagedFeedTickets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-[#7d7484] dark:text-[#cabde8]">
                      <div className="font-semibold text-sm text-[#1f1638] dark:text-white">
                        Tidak ada Work Order yang cocok dengan filter aktif
                      </div>
                      <p className="text-xs mt-1">
                        Sesuaikan filter Vendor, Area, Leader, atau matikan Filter Priority untuk melihat seluruh tiket.
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
                        className="hover:bg-[#f8f1ff]/70 dark:hover:bg-[#2a194b]/50 transition-colors"
                      >
                        <td className="py-3.5 px-3 align-top">
                          <button
                            type="button"
                            onClick={() => (onSelectTicket ? onSelectTicket(ticket, 'overview') : onNavigate('tickets'))}
                            className="font-mono font-bold text-[#58149c] dark:text-[#dab9ff] hover:underline text-left cursor-pointer whitespace-nowrap"
                          >
                            {ticket.woNumber}
                          </button>
                          <div className="text-[11px] text-[#7d7484] dark:text-[#cabde8] mt-0.5 truncate max-w-[175px]">
                            {nodeLabel || ticket.area || '-'}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 align-top min-w-[210px] max-w-[260px]">
                          <div className="font-bold text-[#1f1638] dark:text-white truncate">
                            {ticket.customerName}
                          </div>
                          <div className="text-[11px] text-[#4b4452] dark:text-[#cabde8] leading-snug mt-0.5">
                            {fullAddress}
                          </div>
                          {mapsInfo.url && (
                            <a
                              href={mapsInfo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#6a46c1] dark:text-[#a380fe] hover:underline mt-0.5"
                            >
                              <MapPin className="w-3 h-3" />
                              <span>Buka Maps</span>
                            </a>
                          )}
                        </td>

                        <td className="py-3.5 px-3 align-top">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                                ticket.installerName
                                  ? 'bg-[#7135b5] text-white'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200'
                              }`}
                            >
                              {getInitials(ticket.installerName || 'UA')}
                            </div>
                            <div className="min-w-0">
                              <div
                                className={`font-semibold truncate max-w-[130px] ${
                                  ticket.installerName
                                    ? 'text-[#1f1638] dark:text-white'
                                    : 'italic text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {ticket.installerName || 'Belum Assign'}
                              </div>
                              <div className="text-[10.5px] text-[#7d7484] dark:text-[#cabde8] truncate max-w-[130px]">
                                {ticket.contactorName || ticket.contractorName || '-'}
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
                                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-white text-[9.5px] font-bold uppercase">
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
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : geotag.tone === 'amber'
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-[#4b4452] dark:text-[#cabde8]'
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
                          <div className="text-[10.5px] text-[#7d7484] dark:text-[#cabde8] mt-0.5 tabular-nums">
                            {geotag.sublabel}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 align-top text-right">
                          {showVerifyAction ? (
                            <button
                              type="button"
                              onClick={() => (onSelectTicket ? onSelectTicket(ticket, 'report') : onNavigate('tickets'))}
                              className="px-2.5 py-1.5 rounded-md bg-gradient-to-r from-[#7135b5] to-[#6a46c1] text-white hover:brightness-105 transition-all text-[11px] font-bold shadow-xs cursor-pointer whitespace-nowrap"
                            >
                              Verify Now
                            </button>
                          ) : showAssignAction ? (
                            <button
                              type="button"
                              onClick={() => onNavigate('wo_assignment')}
                              className="px-2.5 py-1.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 hover:bg-amber-200 transition-all text-[11px] font-bold cursor-pointer whitespace-nowrap"
                            >
                              Assign
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => (onSelectTicket ? onSelectTicket(ticket, 'overview') : onNavigate('tickets'))}
                              className="px-2.5 py-1.5 rounded-md bg-[#f8f1ff] dark:bg-[#2a194b] text-[#58149c] dark:text-[#dab9ff] hover:bg-[#eee4ff] transition-all text-[11px] font-bold border border-[#e8ddff] dark:border-[#4b386b] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Inspect</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="pt-3 border-t border-[#f3eaff] dark:border-[#35105e] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#4b4452] dark:text-[#cabde8] tabular-nums">
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
                className="px-2.5 py-1.5 rounded-lg bg-[#f8f1ff] dark:bg-[#160d29] text-[#4b4452] dark:text-[#cabde8] hover:bg-[#eee4ff] disabled:opacity-45 font-semibold inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Sebelumnya</span>
              </button>
              <span className="px-3 py-1 bg-[#58149c] text-white rounded-md font-bold">
                {safeFeedPage} / {totalFeedPages}
              </span>
              <button
                type="button"
                disabled={safeFeedPage >= totalFeedPages}
                onClick={() => setFeedPage(p => Math.min(totalFeedPages, p + 1))}
                className="px-2.5 py-1.5 rounded-lg bg-[#f8f1ff] dark:bg-[#160d29] text-[#1f1638] dark:text-white hover:bg-[#eee4ff] disabled:opacity-45 font-semibold inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <span>Selanjutnya</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Interactive Canonical Status Token Matrix */}
      <div className="bg-white dark:bg-[#1e1238] rounded-xl p-5 sm:p-6 shadow-[0_4px_20px_rgba(53,16,94,0.06),inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.4)] border border-[#e8ddff]/80 dark:border-[#3b1d78] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-extrabold text-[#1f1638] dark:text-white">
                Standardized Operational Status Token Matrix
              </span>
              <span className="px-2 py-0.5 rounded bg-[#eee4ff] dark:bg-[#2e1459] text-[#58149c] dark:text-[#dab9ff] text-[10.5px] font-bold uppercase">
                Canonical Tokens
              </span>
            </div>
            <p className="text-xs text-[#4b4452] dark:text-[#cabde8] mt-0.5">
              Klik baris status di bawah untuk drill-down langsung ke daftar Work Order terkait.
            </p>
          </div>
          <span className="text-[11px] font-bold text-[#58149c] dark:text-[#dab9ff] px-2.5 py-1 bg-[#f3eaff] dark:bg-[#2a194b] rounded self-start lg:self-auto">
            Live Counter Synced
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f8f1ff] dark:bg-[#160d29] text-[#7d7484] dark:text-[#cabde8] text-[10.5px] font-bold uppercase tracking-wider">
                <th className="py-3 px-4 rounded-l-lg">Core Status Token</th>
                <th className="py-3 px-4">Aturan &amp; Makna Operasional</th>
                <th className="py-3 px-4">Kode</th>
                <th className="py-3 px-4">Canonical Badge</th>
                <th className="py-3 px-4 text-right rounded-r-lg">Jumlah Hari Ini</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eee4ff]/60 dark:divide-[#35105e] text-xs">
              {[
                {
                  token: 'CHECK-IN · PROGRESS',
                  dot: 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.8)]',
                  textTone: 'text-sky-800 dark:text-sky-300',
                  code: 'CHK',
                  codeTone: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-200',
                  meaning: 'Teknisi check-in via LiveChat PROGRESS dan/atau validasi koordinat Foto Rumah geotag.',
                  badge: <StatusInstallerBadge status="PROGRESS" />,
                  count: c.checkedInProgress,
                  filter: 'checked_in_progress' as WOKpiFilterKey
                },
                {
                  token: 'COMPLETE / APPROVED',
                  dot: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]',
                  textTone: 'text-emerald-800 dark:text-emerald-300',
                  code: 'CMP',
                  codeTone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200',
                  meaning: 'Laporan teknis & foto bukti telah diverifikasi dan disetujui oleh Dispatch NOC.',
                  badge: <StatusApprovalBadge status="APPROVED" />,
                  count: telemetry.completedCount,
                  filter: 'approved' as WOKpiFilterKey
                },
                {
                  token: 'REVISION / REJECTED',
                  dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]',
                  textTone: 'text-amber-800 dark:text-amber-300',
                  code: 'REV',
                  codeTone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200',
                  meaning: 'Perbaikan / unggah ulang bukti foto atau data redaman diminta oleh Dispatch.',
                  badge: <StatusApprovalBadge status="REVISI" />,
                  count: c.revisionRejected,
                  filter: 'revision_rejected' as WOKpiFilterKey
                },
                {
                  token: 'RESCHEDULE',
                  dot: 'bg-[#a380fe] shadow-[0_0_8px_rgba(163,128,254,0.8)]',
                  textTone: 'text-[#6a46c1] dark:text-[#dab9ff]',
                  code: 'RSC',
                  codeTone: 'bg-[#f3eaff] text-[#6a46c1] dark:bg-[#2e1459] dark:text-[#dab9ff]',
                  meaning: 'Jadwal kunjungan disesuaikan ulang atas permintaan pelanggan atau kendala akses.',
                  badge: <StatusInstallerBadge status="RESCHEDULE" />,
                  count: c.reportReschedule,
                  filter: 'report_reschedule' as WOKpiFilterKey
                },
                {
                  token: 'PENDING',
                  dot: 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.8)]',
                  textTone: 'text-yellow-800 dark:text-yellow-300',
                  code: 'PND',
                  codeTone: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/70 dark:text-yellow-200',
                  meaning: 'Pekerjaan tertunda sementara karena kendala teknis FAT/ODP atau perizinan.',
                  badge: <StatusInstallerBadge status="PENDING" />,
                  count: c.reportPending,
                  filter: 'report_pending' as WOKpiFilterKey
                },
                {
                  token: 'CANCEL',
                  dot: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]',
                  textTone: 'text-rose-800 dark:text-rose-300',
                  code: 'CAN',
                  codeTone: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200',
                  meaning: 'Work Order dibatalkan dengan dokumentasi alasan dan verifikasi Dispatch.',
                  badge: <StatusInstallerBadge status="CANCEL" />,
                  count: c.reportCancel,
                  filter: 'report_cancel' as WOKpiFilterKey
                }
              ].map(row => (
                <tr
                  key={row.token}
                  onClick={() => onDrillDown(row.filter)}
                  className="hover:bg-[#f8f1ff]/70 dark:hover:bg-[#2a194b]/50 transition-colors cursor-pointer"
                >
                  <td className={`py-3 px-4 font-bold whitespace-nowrap ${row.textTone}`}>
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${row.dot}`} />
                      <span>{row.token}</span>
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[#4b4452] dark:text-[#cabde8]">{row.meaning}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded font-mono font-bold text-[11px] ${row.codeTone}`}>
                      {row.code}
                    </span>
                  </td>
                  <td className="py-3 px-4">{row.badge}</td>
                  <td className="py-3 px-4 text-right font-display font-extrabold text-[#1f1638] dark:text-white tabular-nums">
                    {row.count} WO
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. Operational Guardrails & Policy Banner */}
      <div className="p-4 sm:p-5 rounded-xl bg-[#f8f1ff] dark:bg-[#1a0f30] border border-[#e8ddff] dark:border-[#3b1d78] shadow-[inset_0_1px_2px_rgba(33,24,58,0.04)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#7135b5] text-white flex items-center justify-center shadow-xs shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display text-sm font-extrabold text-[#1f1638] dark:text-white">
              FTTH Protocol &amp; RBAC Governance Active
            </h3>
            <p className="text-xs text-[#4b4452] dark:text-[#cabde8]">
              Laporan teknis 3-tingkat &amp; bukti foto geotag diverifikasi sebelum penutupan WO untuk tanggal{' '}
              <span className="font-mono font-semibold">{todayWIB}</span>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 self-stretch sm:self-auto justify-end shrink-0">
          <span className="text-[11px] font-mono text-[#7d7484] dark:text-[#cabde8]">
            DB: {databaseStatus.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() =>
              onNavigate(
                currentUser.role === 'super_admin' || currentUser.role === 'it_support'
                  ? 'audit_logs'
                  : roleActionTarget
              )
            }
            className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#261942] text-[#58149c] dark:text-[#dab9ff] border border-[#e8ddff] dark:border-[#4b386b] text-xs font-bold shadow-[0_1px_3px_rgba(33,24,58,0.06)] hover:bg-[#f3eaff] dark:hover:bg-[#342b4e] transition-all cursor-pointer whitespace-nowrap"
          >
            {currentUser.role === 'super_admin' || currentUser.role === 'it_support'
              ? 'Buka Audit Trail'
              : 'Buka Daftar WO'}
          </button>
        </div>
      </div>
    </div>
  );
};
