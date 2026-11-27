import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileWarning,
  Filter,
  History,
  Layers,
  Lock,
  MapPin,
  RefreshCw,
  RotateCcw,
  UserCheck,
  UserX,
  Users,
  XCircle,
  ChevronRight
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Ticket, WOKpiFilterKey, WOKpiSummary } from '../../types';
import { computeClientKpiSummary, getTicketCanonicalApprovalStatus } from '../../services/woLifecycleService';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { StatusApprovalBadge, StatusBadge, StatusInstallerBadge } from '../common/Badge';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { SortState, getNextSortDirection, sortDataArray } from '../../utils/tableSorting';

interface DashboardKpiSummaryCardsProps {
  onDrillDown: (
    filterKey: WOKpiFilterKey,
    filters?: { contractor?: string; area?: string; installerName?: string }
  ) => void;
  onOpenHistoryReport?: () => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenVerificationDesk?: () => void;
  compact?: boolean;
  defaultPerspective?: 'overview' | 'vendor' | 'area' | 'leader' | 'installer';
  sectionMode?: 'full' | 'operational_and_approval' | 'perspectives_only';
}

interface KpiCardDef {
  key: WOKpiFilterKey;
  label: string;
  sublabel: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accentBg: string;
  accentText: string;
  borderHover: string;
  pillColor?: string;
}

export const DashboardKpiSummaryCards: React.FC<DashboardKpiSummaryCardsProps> = ({
  onDrillDown,
  onOpenHistoryReport,
  onSelectTicket,
  onOpenVerificationDesk,
  compact = false,
  defaultPerspective = 'overview',
  sectionMode = 'full'
}) => {
  const {
    currentUser,
    tickets,
    scopedTickets,
    todayWIB,
    kpiSummary,
    isKpiLoading,
    kpiError,
    kpiContractorFilter,
    kpiAreaFilter,
    setKpiContractorFilter,
    setKpiAreaFilter,
    refreshKpiSummary,
    contractorsList,
    areasList,
    realtimeConnectionState,
    lastKpiUpdatedAt
  } = useApp();

  const lastKpiWibLabel = useMemo(() => {
    if (!lastKpiUpdatedAt) return '';
    const d = new Date(lastKpiUpdatedAt);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta'
    });
  }, [lastKpiUpdatedAt]);

  const initialPerspective =
    sectionMode === 'perspectives_only' && defaultPerspective === 'overview'
      ? 'vendor'
      : defaultPerspective;

  const [perspective, setPerspective] = useState<'overview' | 'vendor' | 'area' | 'leader' | 'installer'>(
    initialPerspective
  );

  // Interactive table header search/filter/sort state for breakdown tables
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorSort, setVendorSort] = useState<SortState>({ column: null, direction: null });
  const [areaSearch, setAreaSearch] = useState('');
  const [areaSort, setAreaSort] = useState<SortState>({ column: null, direction: null });
  const [leaderSearch, setLeaderSearch] = useState('');
  const [leaderVendorFilter, setLeaderVendorFilter] = useState('ALL');
  const [leaderSort, setLeaderSort] = useState<SortState>({ column: null, direction: null });
  const [installerSearch, setInstallerSearch] = useState('');
  const [installerVendorFilter, setInstallerVendorFilter] = useState('ALL');
  const [installerAreaFilter, setInstallerAreaFilter] = useState('ALL');
  const [installerSort, setInstallerSort] = useState<SortState>({ column: null, direction: null });

  const isGlobalRole =
    currentUser.role === 'super_admin' ||
    currentUser.role === 'dispatch';

  const isInstaller = currentUser.role === 'installer';

  // Authoritative backend KPI summary when filters match; instant client mirror otherwise
  const effectiveSummary: WOKpiSummary = useMemo(() => {
    const clientFallback = computeClientKpiSummary(tickets, currentUser, {
      dateWIB: todayWIB,
      contractorFilter: kpiContractorFilter,
      areaFilter: kpiAreaFilter
    });

    if (
      kpiSummary &&
      kpiSummary.dateWIB === todayWIB &&
      kpiSummary.contractorFilter === kpiContractorFilter &&
      kpiSummary.areaFilter === kpiAreaFilter
    ) {
      return kpiSummary;
    }

    return clientFallback;
  }, [kpiSummary, tickets, currentUser, todayWIB, kpiContractorFilter, kpiAreaFilter]);

  const c = effectiveSummary.counts;

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    const list = (effectiveSummary.byVendor || []).filter(v =>
      !q || v.contractorName.toLowerCase().includes(q)
    );
    return sortDataArray(list, vendorSort.column, vendorSort.direction, (row, key) => (row as any)[key]);
  }, [effectiveSummary.byVendor, vendorSearch, vendorSort]);

  const filteredAreas = useMemo(() => {
    const q = areaSearch.trim().toLowerCase();
    const list = (effectiveSummary.byArea || []).filter(a =>
      !q || a.area.toLowerCase().includes(q)
    );
    return sortDataArray(list, areaSort.column, areaSort.direction, (row, key) => {
      if (key === 'progress') return row.checkedInProgress;
      return (row as any)[key];
    });
  }, [effectiveSummary.byArea, areaSearch, areaSort]);

  const leaderVendorOptions = useMemo(
    () =>
      Array.from(new Set((effectiveSummary.byLeader || []).map(l => l.contractorName).filter(Boolean)))
        .sort()
        .map(v => ({ value: v, label: v })),
    [effectiveSummary.byLeader]
  );

  const filteredLeaders = useMemo(() => {
    const q = leaderSearch.trim().toLowerCase();
    const list = (effectiveSummary.byLeader || []).filter(l => {
      if (q && !l.leaderName.toLowerCase().includes(q)) return false;
      if (leaderVendorFilter !== 'ALL' && l.contractorName !== leaderVendorFilter) return false;
      return true;
    });
    return sortDataArray(list, leaderSort.column, leaderSort.direction, (row, key) => (row as any)[key]);
  }, [effectiveSummary.byLeader, leaderSearch, leaderVendorFilter, leaderSort]);

  const installerVendorOptions = useMemo(
    () =>
      Array.from(new Set((effectiveSummary.byInstaller || []).map(i => i.contractorName).filter(Boolean)))
        .sort()
        .map(v => ({ value: v, label: v })),
    [effectiveSummary.byInstaller]
  );

  const installerAreaOptions = useMemo(
    () =>
      Array.from(new Set((effectiveSummary.byInstaller || []).map(i => i.area).filter(Boolean)))
        .sort()
        .map(a => ({ value: a, label: a })),
    [effectiveSummary.byInstaller]
  );

  const filteredInstallers = useMemo(() => {
    const q = installerSearch.trim().toLowerCase();
    const list = (effectiveSummary.byInstaller || []).filter(i => {
      if (q && !i.installerName.toLowerCase().includes(q)) return false;
      if (installerVendorFilter !== 'ALL' && i.contractorName !== installerVendorFilter) return false;
      if (installerAreaFilter !== 'ALL' && i.area !== installerAreaFilter) return false;
      return true;
    });
    return sortDataArray(list, installerSort.column, installerSort.direction, (row, key) => {
      if (key === 'progress') return row.checkedInProgress;
      return (row as any)[key];
    });
  }, [effectiveSummary.byInstaller, installerSearch, installerVendorFilter, installerAreaFilter, installerSort]);

  const allCards: KpiCardDef[] = useMemo(
    () => [
      {
        key: 'total_today',
        label: isInstaller ? 'Total WO Saya Hari Ini' : 'Total WO Hari Ini',
        sublabel: `Appointment ${todayWIB} (WIB)`,
        value: c.totalToday,
        icon: Layers,
        accentBg: 'bg-[#EAE8FF] dark:bg-[#2E1459]',
        accentText: 'text-[#5145A6] dark:text-[#DAB9FF]',
        borderHover: 'hover:border-[#65B8C4] dark:hover:border-[#7135B5]/60'
      },
      {
        key: 'unassigned',
        label: 'Belum Assign',
        sublabel: 'Menunggu Leader pilih teknisi',
        value: c.unassigned,
        icon: UserX,
        accentBg: 'bg-[#F4F7FB] dark:bg-[#241145]',
        accentText: 'text-[#52647A] dark:text-[#C5B3DF]',
        borderHover: 'hover:border-[#65B8C4] dark:hover:border-[#A380FE]/60'
      },
      {
        key: 'assigned',
        label: 'Sudah Assign',
        sublabel: 'Teknisi sudah ditugaskan',
        value: c.assigned,
        icon: UserCheck,
        accentBg: 'bg-[#EAE8FF] dark:bg-[#2E1459]',
        accentText: 'text-[#5145A6] dark:text-[#D8B4FE]',
        borderHover: 'hover:border-[#65B8C4] dark:hover:border-[#7135B5]/60'
      },
      {
        key: 'not_checked_in',
        label: 'Belum Check-in',
        sublabel: 'Belum kirim chat PROGRESS',
        value: c.notCheckedIn,
        icon: Clock,
        accentBg: 'bg-[#F4F7FB] dark:bg-[#241145]',
        accentText: 'text-[#52647A] dark:text-[#C5B3DF]',
        borderHover: 'hover:border-[#65B8C4] dark:hover:border-[#A380FE]/60'
      },
      {
        key: 'checked_in_progress',
        label: 'Sudah Check-in / Progress',
        sublabel: 'Sedang dikerjakan di lapangan',
        value: c.checkedInProgress,
        icon: Activity,
        accentBg: 'bg-[#DDF4F4] dark:bg-[#35105E]',
        accentText: 'text-[#2E7D8B] dark:text-[#D8B4FE]',
        borderHover: 'hover:border-[#65B8C4] dark:hover:border-[#7135B5]/60'
      },
      {
        key: 'report_pending',
        label: 'Report Pending',
        sublabel: 'Status Pembaruan: PENDING',
        value: c.reportPending,
        icon: FileWarning,
        accentBg: 'bg-[#FFF2D9] dark:bg-amber-950/60',
        accentText: 'text-[#9D661F] dark:text-amber-300',
        borderHover: 'hover:border-[#F2CF95] dark:hover:border-amber-400'
      },
      {
        key: 'report_complete',
        label: 'Report Complete',
        sublabel: 'Status Pembaruan: COMPLETE',
        value: c.reportComplete,
        icon: CheckCircle2,
        accentBg: 'bg-[#E4F5EC] dark:bg-emerald-950/60',
        accentText: 'text-[#218A63] dark:text-emerald-300',
        borderHover: 'hover:border-[#B7E4CC] dark:hover:border-emerald-400'
      },
      {
        key: 'report_reschedule',
        label: 'Report Reschedule',
        sublabel: 'Status Pembaruan: RESCHEDULE',
        value: c.reportReschedule,
        icon: CalendarClock,
        accentBg: 'bg-[#E7F1FB] dark:bg-sky-950/60',
        accentText: 'text-[#3E81C6] dark:text-[#38BDF8]',
        borderHover: 'hover:border-[#C6DDF6] dark:hover:border-sky-400'
      },
      {
        key: 'report_cancel',
        label: 'Report Cancel',
        sublabel: 'Status Pembaruan: CANCEL',
        value: c.reportCancel,
        icon: XCircle,
        accentBg: 'bg-[#FCE9EB] dark:bg-rose-950/60',
        accentText: 'text-[#9B2C37] dark:text-rose-300',
        borderHover: 'hover:border-[#F3C5CA] dark:hover:border-rose-400'
      },
      {
        key: 'butuh_approval',
        label: 'Butuh Approval',
        sublabel: 'Antrean review Dispatch',
        value: c.butuhApproval,
        icon: ClipboardCheck,
        accentBg: 'bg-[#FFF2D9] dark:bg-orange-950/60',
        accentText: 'text-[#C88735] dark:text-orange-300',
        borderHover: 'hover:border-[#F2CF95] dark:hover:border-orange-400'
      },
      {
        key: 'approved',
        label: 'Approved',
        sublabel: `Approval Rate: ${c.approvalRatePct}%`,
        value: c.approved,
        icon: CheckCircle2,
        accentBg: 'bg-[#E4F5EC] dark:bg-emerald-950/60',
        accentText: 'text-[#218A63] dark:text-emerald-300',
        borderHover: 'hover:border-[#B7E4CC] dark:hover:border-emerald-400'
      },
      {
        key: 'approved_done',
        label: 'Dispatch: Done',
        sublabel: `Completion Rate: ${c.completionRatePct}% · Closed`,
        value: c.approvedDone,
        icon: CheckCircle2,
        accentBg: 'bg-[#E4F5EC] dark:bg-emerald-950/60',
        accentText: 'text-[#218A63] dark:text-emerald-300',
        borderHover: 'hover:border-[#B7E4CC] dark:hover:border-emerald-500'
      },
      {
        key: 'approved_pending',
        label: 'Dispatch: Pending',
        sublabel: 'Approved - Pending · Closed',
        value: c.approvedPending,
        icon: Clock,
        accentBg: 'bg-[#FFF2D9] dark:bg-amber-950/60',
        accentText: 'text-[#9D661F] dark:text-amber-300',
        borderHover: 'hover:border-[#F2CF95] dark:hover:border-amber-400'
      },
      {
        key: 'approved_reschedule',
        label: 'Dispatch: Reschedule',
        sublabel: 'Approved - Reschedule · Closed',
        value: c.approvedReschedule,
        icon: CalendarClock,
        accentBg: 'bg-[#E7F1FB] dark:bg-sky-950/60',
        accentText: 'text-[#3E81C6] dark:text-[#38BDF8]',
        borderHover: 'hover:border-[#C6DDF6] dark:hover:border-sky-400'
      },
      {
        key: 'approved_cancel',
        label: 'Dispatch: Cancel',
        sublabel: 'Approved - Cancel · Closed',
        value: c.approvedCancel,
        icon: XCircle,
        accentBg: 'bg-[#FCE9EB] dark:bg-rose-950/60',
        accentText: 'text-[#9B2C37] dark:text-rose-300',
        borderHover: 'hover:border-[#F3C5CA] dark:hover:border-rose-400'
      },
      {
        key: 'revision_rejected',
        label: 'Revisi / Rejected',
        sublabel: 'Dikembalikan ke teknisi',
        value: c.revisionRejected,
        icon: RotateCcw,
        accentBg: 'bg-[#FCE9EB] dark:bg-rose-950/60',
        accentText: 'text-[#9B2C37] dark:text-rose-300',
        borderHover: 'hover:border-[#F3C5CA] dark:hover:border-rose-400'
      },
      {
        key: 'closed',
        label: 'Ticket Closed',
        sublabel: 'Finalisasi verifikasi Dispatch',
        value: c.closed,
        icon: Lock,
        accentBg: 'bg-[#EAE8FF] dark:bg-[#35105E]',
        accentText: 'text-[#5145A6] dark:text-white',
        borderHover: 'hover:border-[#6657C8] dark:hover:border-[#58149C]'
      }
    ],
    [c, isInstaller, todayWIB]
  );

  const visibleCards = useMemo(() => {
    if (isInstaller) {
      // Installer does not assign WOs, focus on operational & report lifecycle
      return allCards.filter(card => card.key !== 'unassigned' && card.key !== 'assigned');
    }
    return allCards;
  }, [allCards, isInstaller]);

  const APPROVAL_CARD_KEYS = useMemo(
    () =>
      new Set<WOKpiFilterKey>([
        'butuh_approval',
        'approved',
        'approved_done',
        'approved_pending',
        'approved_reschedule',
        'approved_cancel',
        'revision_rejected',
        'closed'
      ]),
    []
  );

  const operationalCards = useMemo(
    () => visibleCards.filter(card => !APPROVAL_CARD_KEYS.has(card.key)),
    [visibleCards, APPROVAL_CARD_KEYS]
  );

  const approvalCards = useMemo(
    () => visibleCards.filter(card => APPROVAL_CARD_KEYS.has(card.key)),
    [visibleCards, APPROVAL_CARD_KEYS]
  );

  const approvalPreviewQueue = useMemo(() => {
    const source = scopedTickets || tickets || [];
    return source
      .filter(t => {
        if (!t || t.isArchived || t.isDeleted) return false;
        if (getTicketAppointmentDate(t) !== todayWIB) return false;
        if (kpiContractorFilter !== 'ALL') {
          const v = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
          if (v !== kpiContractorFilter.trim().toLowerCase()) return false;
        }
        if (kpiAreaFilter !== 'ALL') {
          const a = String(t.area || '').trim().toLowerCase();
          if (a !== kpiAreaFilter.trim().toLowerCase()) return false;
        }
        return getTicketCanonicalApprovalStatus(t) === 'BUTUH APPROVAL';
      })
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime()
      )
      .slice(0, 5);
  }, [scopedTickets, tickets, todayWIB, kpiContractorFilter, kpiAreaFilter]);

  const handleCardClick = (filterKey: WOKpiFilterKey) => {
    onDrillDown(filterKey, {
      contractor: kpiContractorFilter !== 'ALL' ? kpiContractorFilter : undefined,
      area: kpiAreaFilter !== 'ALL' ? kpiAreaFilter : undefined
    });
  };

  const renderKpiCardButton = (card: KpiCardDef) => {
    const Icon = card.icon;
    return (
      <button
        key={card.key}
        type="button"
        onClick={() => handleCardClick(card.key)}
        className={`card-3d-lavender group text-left rounded-xl p-3.5 transition-all hover:-translate-y-0.5 active:translate-y-0.5 cursor-pointer ${card.borderHover} focus:outline-none focus:ring-2 focus:ring-[#6657C8] min-h-[96px] flex flex-col justify-between`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] leading-snug">
            {card.label}
          </span>
          <span
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${card.accentBg} ${card.accentText}`}
          >
            <Icon className="w-3.5 h-3.5" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-2xl font-extrabold tracking-tight text-[#26364A] dark:text-white font-mono tabular-nums">
            {card.value}
          </span>
          <span className="text-[10px] font-bold text-[#5145A6] dark:text-[#D8B4FE] opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center">
            Detail <ChevronRight className="w-3 h-3" />
          </span>
        </div>
        <p className="mt-1 text-[10px] text-[#8492A5] dark:text-[#A79BC0] truncate">
          {card.sublabel}
        </p>
      </button>
    );
  };

  const perspectiveTabs = [
    ...(sectionMode === 'full'
      ? [{ id: 'overview', label: `${visibleCards.length} KPI Summary Cards`, icon: Layers }]
      : []),
    { id: 'vendor', label: `Perspektif Vendor / Kontraktor (${effectiveSummary.byVendor.length})`, icon: Building2 },
    { id: 'area', label: `Per Area (${effectiveSummary.byArea.length})`, icon: MapPin },
    { id: 'leader', label: `Per Leader (${effectiveSummary.byLeader.length})`, icon: Users },
    { id: 'installer', label: `Per Teknisi (${effectiveSummary.byInstaller.length})`, icon: UserCheck }
  ] as const;

  return (
    <section aria-label="WO Lifecycle KPI Summary" className="space-y-4">
      {sectionMode !== 'perspectives_only' && (
        <>
          {/* Position 1: Monitoring Status Operasional */}
          <div data-testid="dashboard-monitoring-operational" className="space-y-3.5">
            {/* Unified Aqua-Violet Glass Command Banner (Light) / Deep Purple Command Banner (Night) */}
            <div className="rounded-2xl bg-gradient-to-br from-white/95 via-[#F4F7FB]/92 to-[#EAE8FF]/88 dark:from-[#240C45] dark:via-[#35105E] dark:to-[#1A0933] text-[#26364A] dark:text-white p-4 sm:p-5 border border-[#CFDCE8] dark:border-[#7135B5]/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_4px_0_#DDE6F0,0_14px_28px_-10px_rgba(38,54,74,0.10)] dark:shadow-[0_6px_0_#130626,0_14px_28px_-8px_rgba(36,12,69,0.45)]">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10.5px] font-bold bg-[#EAE8FF] dark:bg-[#7135B5] text-[#5145A6] dark:text-white border border-[#DCE3F2] dark:border-white/15">
                      <Activity className="w-3.5 h-3.5" />
                      <span>WO Lifecycle Live KPI</span>
                    </span>
                    <span className="text-xs font-mono font-semibold tabular-nums text-[#2E7D8B] dark:text-[#D8B4FE]">
                      WIB: {todayWIB}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#E4F5EC] dark:bg-emerald-500/20 text-[#218A63] dark:text-emerald-300 border border-[#B7E4CC] dark:border-transparent font-mono text-[10.5px] font-bold tabular-nums">
                      Approval: {c.approvalRatePct}% · Done: {c.completionRatePct}%
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-mono font-bold tabular-nums ${
                        realtimeConnectionState === 'connected'
                          ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-500/15 dark:text-emerald-300'
                          : realtimeConnectionState === 'reconnecting' || realtimeConnectionState === 'connecting'
                          ? 'bg-[#FFF2D9] text-[#9D661F] dark:bg-amber-500/15 dark:text-amber-300'
                          : 'bg-[#FCE9EB] text-[#9B2C37] dark:bg-rose-500/15 dark:text-rose-300'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          realtimeConnectionState === 'connected'
                            ? 'bg-[#218A63] dark:bg-emerald-400 animate-pulse'
                            : realtimeConnectionState === 'reconnecting' || realtimeConnectionState === 'connecting'
                            ? 'bg-[#C88735] animate-pulse'
                            : 'bg-[#D45B66]'
                        }`}
                      />
                      <span>
                        {realtimeConnectionState === 'connected'
                          ? 'Live SSE'
                          : realtimeConnectionState === 'reconnecting'
                          ? 'Reconnecting'
                          : realtimeConnectionState === 'connecting'
                          ? 'Connecting'
                          : 'Terputus'}
                        {lastKpiWibLabel ? ` · Update ${lastKpiWibLabel} WIB` : ''}
                      </span>
                    </span>
                  </div>
                  <h2 className="font-display text-base sm:text-lg font-extrabold tracking-tight text-[#26364A] dark:text-white">
                    Monitoring Status Operasional
                  </h2>
                  <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                    Ringkasan progres operasional hari ini. Klik kartu untuk drill-down ke daftar Work Order.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Vendor & Area Filters */}
                  {isGlobalRole ? (
                    <>
                      <div className="relative w-full sm:w-auto">
                        <Building2 className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select
                          aria-label="Filter Vendor Kontraktor"
                          value={kpiContractorFilter}
                          onChange={(e) => setKpiContractorFilter(e.target.value)}
                          className="w-full sm:w-auto pl-8 pr-7 py-2 min-h-[42px] sm:min-h-[38px] rounded-xl bg-[#F8FAFD] dark:bg-[#160D29]/90 border border-[#DDE6F0] dark:border-[#5B35B1] text-xs font-medium text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#65B8C4]/40 dark:focus:ring-[#D8B4FE]/50"
                        >
                          <option value="ALL">Semua Vendor / Kontraktor</option>
                          {contractorsList.map(vendor => (
                            <option key={vendor} value={vendor}>
                              {vendor}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="relative w-full sm:w-auto">
                        <MapPin className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#D8B4FE] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select
                          aria-label="Filter Area"
                          value={kpiAreaFilter}
                          onChange={(e) => setKpiAreaFilter(e.target.value)}
                          className="w-full sm:w-auto pl-8 pr-7 py-2 min-h-[42px] sm:min-h-[38px] rounded-xl bg-[#F8FAFD] dark:bg-[#160D29]/90 border border-[#DDE6F0] dark:border-[#5B35B1] text-xs font-medium text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#65B8C4]/40 dark:focus:ring-[#D8B4FE]/50"
                        >
                          <option value="ALL">Semua Area</option>
                          {areasList.map(area => (
                            <option key={area} value={area}>
                              {area}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 min-h-[38px] rounded-xl bg-[#F8FAFD] dark:bg-[#160D29]/90 border border-[#DDE6F0] dark:border-[#5B35B1] text-xs text-[#52647A] dark:text-[#E9D5FF]">
                      <Filter className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE]" />
                      <span>
                        Scope:{' '}
                        <strong className="text-[#26364A] dark:text-white">
                          {currentUser.contractor || 'Semua Vendor'} {currentUser.area ? `· ${currentUser.area}` : ''}
                        </strong>
                      </span>
                    </div>
                  )}

                  {onOpenHistoryReport && (
                    <button
                      type="button"
                      onClick={onOpenHistoryReport}
                      className="btn-3d-primary inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[38px] rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>History Progress</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => refreshKpiSummary()}
                    disabled={isKpiLoading}
                    className="btn-3d-lilac inline-flex items-center gap-1.5 px-3 py-2 min-h-[42px] sm:min-h-[38px] rounded-xl text-xs font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isKpiLoading && !kpiSummary ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Perspective Tabs (only shown inline in full mode) */}
              {sectionMode === 'full' && !isInstaller && !compact && (
                <div className="mt-4 pt-3 border-t border-[#DDE6F0] dark:border-white/10 flex flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {perspectiveTabs.map(tab => {
                    const Icon = tab.icon;
                    const active = perspective === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPerspective(tab.id as any)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                          active
                            ? 'btn-3d-primary text-white'
                            : 'bg-white/85 dark:bg-white/10 text-[#52647A] dark:text-[#E9D5FF] hover:bg-[#F0EDFF] dark:hover:bg-white/18 hover:text-[#5145A6] dark:hover:text-white border border-[#DDE6F0] dark:border-white/10'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Error State Banner */}
            {kpiError && (
              <div className="rounded-xl bg-[#FCE9EB] dark:bg-rose-950/40 border border-[#F3C5CA] dark:border-rose-800 px-4 py-3 flex items-center justify-between gap-3 text-xs text-[#9B2C37] dark:text-rose-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Sinkronisasi KPI backend tertunda ({kpiError}). Menampilkan perhitungan sinkron lokal.</span>
                </div>
                <button
                  type="button"
                  onClick={() => refreshKpiSummary()}
                  className="btn-3d-secondary px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Coba Lagi
                </button>
              </div>
            )}

            {/* Unmapped Distribution Alert Banner (Dispatch & Super Admin) */}
            {isGlobalRole && c.unmappedDistribution > 0 && (
              <button
                type="button"
                onClick={() => handleCardClick('unmapped_distribution')}
                className="w-full text-left rounded-xl bg-[#FFF2D9] dark:bg-orange-950/40 border border-[#F2CF95] dark:border-orange-800 px-4 py-3 flex items-center justify-between gap-3 hover:brightness-[0.98] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#C88735]/15 text-[#9D661F] dark:text-orange-300 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#9D661F] dark:text-orange-200">
                      {c.unmappedDistribution} Work Order Belum Terdistribusi ke Leader
                    </p>
                    <p className="text-[11px] text-[#9D661F]/90 dark:text-orange-300">
                      Mapping Vendor + Area belum menemukan Leader aktif. Klik untuk meninjau &amp; mendistribusikan manual.
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-[#9D661F] dark:text-orange-300 shrink-0">
                  Lihat Antrean <ChevronRight className="w-4 h-4" />
                </span>
              </button>
            )}

            {/* Operational Status KPI Cards Grid (when operational_and_approval mode) */}
            {sectionMode === 'operational_and_approval' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-9 gap-3">
                {operationalCards.map(renderKpiCardButton)}
              </div>
            )}
          </div>

          {/* Position 2: Approval Work Order */}
          {sectionMode === 'operational_and_approval' && (
            <div
              data-testid="dashboard-approval-work-order"
              className="card-3d-lavender rounded-2xl p-4 sm:p-5 space-y-4 border border-[#DCE3F2] dark:border-[#5B35B1]"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#FFF2D9] dark:bg-orange-950/60 border border-[#F2CF95] dark:border-orange-800 text-[#C88735] dark:text-orange-300 flex items-center justify-center shrink-0">
                    <ClipboardCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base sm:text-lg font-extrabold tracking-tight text-[#26364A] dark:text-white">
                        Approval Work Order
                      </h2>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono font-bold tabular-nums ${
                          c.butuhApproval > 0
                            ? 'bg-[#FFF2D9] text-[#9D661F] border border-[#F2CF95] dark:bg-orange-950/70 dark:text-orange-200 dark:border-orange-800'
                            : 'bg-[#E4F5EC] text-[#218A63] border border-[#B7E4CC] dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                        }`}
                      >
                        {c.butuhApproval} Menunggu Approval
                      </span>
                    </div>
                    <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
                      Verifikasi laporan teknisi, approval Dispatch, revisi, dan penutupan Work Order.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCardClick('butuh_approval')}
                    className="btn-3d-lilac px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <span>Lihat Semua Antrean</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  {onOpenVerificationDesk && (
                    <button
                      type="button"
                      onClick={onOpenVerificationDesk}
                      className="btn-3d-primary px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>Buka Antrean Verifikasi QC</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                {approvalCards.map(renderKpiCardButton)}
              </div>

              {approvalPreviewQueue.length > 0 && (
                <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wider">
                    <span>Antrean Terbaru Butuh Approval ({approvalPreviewQueue.length} dari {c.butuhApproval})</span>
                    <span className="font-mono text-[#5145A6] dark:text-[#D8B4FE]">WIB {todayWIB}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {approvalPreviewQueue.map(ticket => (
                      <div
                        key={ticket.id}
                        className="p-3 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-bold text-[#5145A6] dark:text-[#D8B4FE]">
                              {ticket.woNumber}
                            </span>
                            <StatusApprovalBadge status={ticket.approvalStatus} />
                          </div>
                          <div className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                            {ticket.customerName}
                          </div>
                          <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                            {ticket.installerName || '-'} · {ticket.contactorName || ticket.contractorName || '-'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onSelectTicket
                              ? onSelectTicket(ticket, 'report')
                              : handleCardClick('butuh_approval')
                          }
                          className="btn-3d-success px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 cursor-pointer whitespace-nowrap"
                        >
                          Review
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Perspective Switcher Bar (perspectives_only mode) */}
      {sectionMode === 'perspectives_only' && !isInstaller && !compact && (
        <div className="card-3d-lavender rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-bold text-[#26364A] dark:text-white">
            Breakdown Operasional Berdasarkan Dimensi
          </div>
          <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {perspectiveTabs.map(tab => {
              const Icon = tab.icon;
              const active = perspective === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPerspective(tab.id as any)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'btn-3d-primary text-white'
                      : 'bg-white/85 dark:bg-white/10 text-[#52647A] dark:text-[#E9D5FF] hover:bg-[#F0EDFF] dark:hover:bg-white/18 hover:text-[#5145A6] dark:hover:text-white border border-[#DDE6F0] dark:border-white/10'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Perspective: 17 KPI Summary Cards (full mode) */}
      {sectionMode === 'full' && perspective === 'overview' && (
        <div
          className={`grid gap-3 ${
            isInstaller
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
              : compact
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7'
              : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7'
          }`}
        >
          {visibleCards.map(renderKpiCardButton)}
        </div>
      )}

      {/* Perspective: Vendor / Kontraktor Breakdown */}
      {perspective === 'vendor' && (
        <div className="space-y-2.5">
          <div className="card-3d-lavender rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-white">
                Ringkasan Operasional Per Vendor / Kontraktor
              </h3>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                Klik nama Vendor atau angka untuk filter &amp; drill-down daftar WO Vendor tersebut.
              </p>
            </div>
          </div>

          <ResponsiveDataTable
            data={filteredVendors}
            getRowKey={row => row.contractorName}
            sortKey={vendorSort.column}
            sortDirection={vendorSort.direction}
            onSort={key =>
              setVendorSort(prev => ({
                column: key,
                direction: prev.column === key ? getNextSortDirection(prev.direction) : 'asc'
              }))
            }
            activeFilterCount={(vendorSearch.trim() ? 1 : 0) + (vendorSort.direction ? 1 : 0)}
            onResetFilters={() => {
              setVendorSearch('');
              setVendorSort({ column: null, direction: null });
            }}
            mobileTitle={row => row.contractorName}
            mobileSubtitle={row => `${row.total} Total WO • ${row.closed} Closed`}
            mobileStatus={row =>
              row.unmapped > 0 ? (
                <span className="px-2 py-0.5 rounded bg-[#FFF2D9] dark:bg-orange-950/60 text-[#9D661F] dark:text-orange-300 text-[10px] font-bold">
                  {row.unmapped} Unmapped
                </span>
              ) : null
            }
            getRowActions={row => [
              {
                id: 'all',
                label: `Lihat Semua (${row.total} WO)`,
                tone: 'primary',
                onClick: () => onDrillDown('total_today', { contractor: row.contractorName })
              },
              {
                id: 'unassigned',
                label: `Belum Assign (${row.unassigned})`,
                onClick: () => onDrillDown('unassigned', { contractor: row.contractorName })
              },
              {
                id: 'approval',
                label: `Butuh Approval (${row.butuhApproval})`,
                tone: 'warning',
                onClick: () => onDrillDown('butuh_approval', { contractor: row.contractorName })
              },
              {
                id: 'closed',
                label: `Sudah Closed (${row.closed})`,
                tone: 'success',
                onClick: () => onDrillDown('closed', { contractor: row.contractorName })
              }
            ]}
            emptyState={{
              title: 'Belum ada data Work Order',
              description: `Belum ada data Work Order yang cocok untuk tanggal operasional ${todayWIB}.`
            }}
            columns={
              [
                {
                  key: 'contractorName',
                  label: 'Vendor / Kontraktor',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'search',
                    value: vendorSearch,
                    onChange: setVendorSearch,
                    placeholder: 'Cari nama vendor...'
                  },
                  tdClassName: 'font-semibold text-[#26364A] dark:text-white',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('total_today', { contractor: row.contractorName })}
                      className="text-left hover:text-[#5145A6] dark:hover:text-[#D8B4FE] hover:underline flex items-center gap-2 cursor-pointer"
                    >
                      <span>{row.contractorName}</span>
                      {row.unmapped > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-[#FFF2D9] dark:bg-orange-950/60 text-[#9D661F] dark:text-orange-300 text-[10px] font-bold">
                          {row.unmapped} Unmapped
                        </span>
                      )}
                    </button>
                  )
                },
                {
                  key: 'total',
                  label: 'Total',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('total_today', { contractor: row.contractorName })}
                      className="font-bold hover:underline cursor-pointer"
                    >
                      {row.total}
                    </button>
                  )
                },
                {
                  key: 'unassigned',
                  label: 'Belum Assign',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('unassigned', { contractor: row.contractorName })}
                      className="hover:underline cursor-pointer"
                    >
                      {row.unassigned}
                    </button>
                  )
                },
                {
                  key: 'checkedInProgress',
                  label: 'Progress',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('checked_in_progress', { contractor: row.contractorName })}
                      className="text-[#5145A6] dark:text-[#D8B4FE] font-semibold hover:underline cursor-pointer"
                    >
                      {row.checkedInProgress}
                    </button>
                  )
                },
                {
                  key: 'reportPending',
                  label: 'Pending',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('report_pending', { contractor: row.contractorName })}
                      className="text-[#9D661F] dark:text-amber-300 font-semibold hover:underline cursor-pointer"
                    >
                      {row.reportPending}
                    </button>
                  )
                },
                {
                  key: 'reportComplete',
                  label: 'Complete',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('report_complete', { contractor: row.contractorName })}
                      className="text-[#218A63] dark:text-emerald-300 font-semibold hover:underline cursor-pointer"
                    >
                      {row.reportComplete}
                    </button>
                  )
                },
                {
                  key: 'reportReschedule',
                  label: 'Reschedule',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('report_reschedule', { contractor: row.contractorName })}
                      className="text-[#3E81C6] dark:text-[#38BDF8] font-semibold hover:underline cursor-pointer"
                    >
                      {row.reportReschedule}
                    </button>
                  )
                },
                {
                  key: 'reportCancel',
                  label: 'Cancel',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('report_cancel', { contractor: row.contractorName })}
                      className="text-[#9B2C37] dark:text-rose-300 font-semibold hover:underline cursor-pointer"
                    >
                      {row.reportCancel}
                    </button>
                  )
                },
                {
                  key: 'butuhApproval',
                  label: 'Butuh Approval',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('butuh_approval', { contractor: row.contractorName })}
                      className="text-[#C88735] dark:text-orange-300 font-bold hover:underline cursor-pointer"
                    >
                      {row.butuhApproval}
                    </button>
                  )
                },
                {
                  key: 'approved',
                  label: 'Approved',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('approved', { contractor: row.contractorName })}
                      className="text-[#218A63] dark:text-emerald-300 font-semibold hover:underline cursor-pointer"
                    >
                      {row.approved}
                    </button>
                  )
                },
                {
                  key: 'revisionRejected',
                  label: 'Revisi',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('revision_rejected', { contractor: row.contractorName })}
                      className="text-[#9B2C37] dark:text-rose-300 font-semibold hover:underline cursor-pointer"
                    >
                      {row.revisionRejected}
                    </button>
                  )
                },
                {
                  key: 'closed',
                  label: 'Closed',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('closed', { contractor: row.contractorName })}
                      className="font-bold hover:underline cursor-pointer"
                    >
                      {row.closed}
                    </button>
                  )
                }
              ] as ResponsiveColumn<(typeof effectiveSummary.byVendor)[number]>[]
            }
          />
        </div>
      )}

      {/* Perspective: Area Breakdown */}
      {perspective === 'area' && (
        <div className="space-y-2.5">
          <div className="card-3d-lavender rounded-xl px-4 py-3">
            <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-white">
              Ringkasan Per Area / Wilayah
            </h3>
          </div>
          <ResponsiveDataTable
            data={filteredAreas}
            getRowKey={a => a.area}
            sortKey={areaSort.column}
            sortDirection={areaSort.direction}
            onSort={key =>
              setAreaSort(prev => ({
                column: key,
                direction: prev.column === key ? getNextSortDirection(prev.direction) : 'asc'
              }))
            }
            activeFilterCount={(areaSearch.trim() ? 1 : 0) + (areaSort.direction ? 1 : 0)}
            onResetFilters={() => {
              setAreaSearch('');
              setAreaSort({ column: null, direction: null });
            }}
            mobileTitle={a => a.area}
            mobileSubtitle={a => `${a.total} Total WO • ${a.closed} Closed`}
            onRowClick={a => onDrillDown('total_today', { area: a.area })}
            emptyState={{
              title: 'Belum ada data area',
              description: `Belum ada data area untuk ${todayWIB}.`
            }}
            columns={
              [
                {
                  key: 'area',
                  label: 'Area',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'search',
                    value: areaSearch,
                    onChange: setAreaSearch,
                    placeholder: 'Cari nama area...'
                  },
                  render: a => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('total_today', { area: a.area })}
                      className="font-semibold text-[#26364A] dark:text-white hover:text-[#5145A6] dark:hover:text-[#D8B4FE] hover:underline cursor-pointer"
                    >
                      {a.area}
                    </button>
                  )
                },
                {
                  key: 'total',
                  label: 'Total',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: a => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('total_today', { area: a.area });
                      }}
                      className="font-bold hover:underline cursor-pointer"
                    >
                      {a.total}
                    </button>
                  )
                },
                {
                  key: 'unassigned',
                  label: 'Belum Assign',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: a => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('unassigned', { area: a.area });
                      }}
                      className="hover:underline cursor-pointer"
                    >
                      {a.unassigned}
                    </button>
                  )
                },
                {
                  key: 'progress',
                  label: 'Progress',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: a => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('checked_in_progress', { area: a.area });
                      }}
                      className="text-[#5145A6] dark:text-[#D8B4FE] font-semibold hover:underline cursor-pointer"
                    >
                      {a.checkedInProgress}
                    </button>
                  )
                },
                {
                  key: 'butuhApproval',
                  label: 'Butuh Approval',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: a => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('butuh_approval', { area: a.area });
                      }}
                      className="text-[#C88735] dark:text-orange-300 font-bold hover:underline cursor-pointer"
                    >
                      {a.butuhApproval}
                    </button>
                  )
                },
                {
                  key: 'approved',
                  label: 'Approved',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: a => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('approved', { area: a.area });
                      }}
                      className="text-[#218A63] dark:text-emerald-300 font-semibold hover:underline cursor-pointer"
                    >
                      {a.approved}
                    </button>
                  )
                },
                {
                  key: 'closed',
                  label: 'Closed',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: a => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('closed', { area: a.area });
                      }}
                      className="font-bold hover:underline cursor-pointer"
                    >
                      {a.closed}
                    </button>
                  )
                }
              ] as ResponsiveColumn<(typeof effectiveSummary.byArea)[number]>[]
            }
          />
        </div>
      )}

      {/* Perspective: Leader Breakdown */}
      {perspective === 'leader' && (
        <div className="space-y-2.5">
          <div className="card-3d-lavender rounded-xl px-4 py-3">
            <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-white">
              Distribusi &amp; Beban Kerja Leader
            </h3>
          </div>
          <ResponsiveDataTable
            data={filteredLeaders}
            getRowKey={(l, idx) => `${l.leaderName}_${idx}`}
            sortKey={leaderSort.column}
            sortDirection={leaderSort.direction}
            onSort={key =>
              setLeaderSort(prev => ({
                column: key,
                direction: prev.column === key ? getNextSortDirection(prev.direction) : 'asc'
              }))
            }
            activeFilterCount={(leaderSearch.trim() ? 1 : 0) + (leaderVendorFilter !== 'ALL' ? 1 : 0) + (leaderSort.direction ? 1 : 0)}
            onResetFilters={() => {
              setLeaderSearch('');
              setLeaderVendorFilter('ALL');
              setLeaderSort({ column: null, direction: null });
            }}
            mobileTitle={l => l.leaderName}
            mobileSubtitle={l => l.contractorName}
            onRowClick={l =>
              onDrillDown(
                'total_today',
                l.contractorName && l.contractorName !== 'Tanpa Vendor' ? { contractor: l.contractorName } : undefined
              )
            }
            emptyState={{
              title: 'Belum ada data Leader',
              description: `Belum ada data Leader untuk ${todayWIB}.`
            }}
            columns={
              [
                {
                  key: 'leaderName',
                  label: 'Leader',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'search',
                    value: leaderSearch,
                    onChange: setLeaderSearch,
                    placeholder: 'Cari nama leader...'
                  },
                  tdClassName: 'font-semibold text-[#26364A] dark:text-white',
                  render: l => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown(
                          'total_today',
                          l.contractorName && l.contractorName !== 'Tanpa Vendor' ? { contractor: l.contractorName } : undefined
                        );
                      }}
                      className="font-semibold text-[#26364A] dark:text-white hover:text-[#5145A6] dark:hover:text-[#D8B4FE] hover:underline cursor-pointer"
                    >
                      {l.leaderName}
                    </button>
                  )
                },
                {
                  key: 'contractorName',
                  label: 'Vendor',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'select',
                    value: leaderVendorFilter,
                    defaultValue: 'ALL',
                    allLabel: 'Semua Vendor',
                    options: leaderVendorOptions,
                    onChange: setLeaderVendorFilter
                  },
                  tdClassName: 'text-[#52647A] dark:text-[#CEC0E8]',
                  render: l => l.contractorName
                },
                {
                  key: 'total',
                  label: 'Total',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: l => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown(
                          'total_today',
                          l.contractorName && l.contractorName !== 'Tanpa Vendor' ? { contractor: l.contractorName } : undefined
                        );
                      }}
                      className="font-bold hover:underline cursor-pointer"
                    >
                      {l.total}
                    </button>
                  )
                },
                {
                  key: 'unassigned',
                  label: 'Belum Assign',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: l => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown(
                          'unassigned',
                          l.contractorName && l.contractorName !== 'Tanpa Vendor' ? { contractor: l.contractorName } : undefined
                        );
                      }}
                      className="hover:underline cursor-pointer"
                    >
                      {l.unassigned}
                    </button>
                  )
                },
                {
                  key: 'assigned',
                  label: 'Assigned',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: l => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown(
                          'assigned',
                          l.contractorName && l.contractorName !== 'Tanpa Vendor' ? { contractor: l.contractorName } : undefined
                        );
                      }}
                      className="text-[#5145A6] dark:text-[#D8B4FE] hover:underline cursor-pointer"
                    >
                      {l.assigned}
                    </button>
                  )
                },
                {
                  key: 'checkedInProgress',
                  label: 'Progress',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: l => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown(
                          'checked_in_progress',
                          l.contractorName && l.contractorName !== 'Tanpa Vendor' ? { contractor: l.contractorName } : undefined
                        );
                      }}
                      className="text-[#5145A6] dark:text-[#D8B4FE] font-semibold hover:underline cursor-pointer"
                    >
                      {l.checkedInProgress}
                    </button>
                  )
                },
                {
                  key: 'butuhApproval',
                  label: 'Butuh Approval',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: l => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown(
                          'butuh_approval',
                          l.contractorName && l.contractorName !== 'Tanpa Vendor' ? { contractor: l.contractorName } : undefined
                        );
                      }}
                      className="text-[#C88735] dark:text-orange-300 font-bold hover:underline cursor-pointer"
                    >
                      {l.butuhApproval}
                    </button>
                  )
                },
                {
                  key: 'closed',
                  label: 'Closed',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: l => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown(
                          'closed',
                          l.contractorName && l.contractorName !== 'Tanpa Vendor' ? { contractor: l.contractorName } : undefined
                        );
                      }}
                      className="font-bold hover:underline cursor-pointer"
                    >
                      {l.closed}
                    </button>
                  )
                }
              ] as ResponsiveColumn<(typeof effectiveSummary.byLeader)[number]>[]
            }
          />
        </div>
      )}

      {/* Perspective: Installer Breakdown */}
      {perspective === 'installer' && (
        <div className="space-y-2.5">
          <div className="card-3d-lavender rounded-xl px-4 py-3">
            <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-white">
              Produktivitas &amp; Status Pekerjaan Teknisi
            </h3>
          </div>
          <ResponsiveDataTable
            data={filteredInstallers}
            getRowKey={(inst, idx) => `${inst.installerName}_${idx}`}
            sortKey={installerSort.column}
            sortDirection={installerSort.direction}
            onSort={key =>
              setInstallerSort(prev => ({
                column: key,
                direction: prev.column === key ? getNextSortDirection(prev.direction) : 'asc'
              }))
            }
            activeFilterCount={
              (installerSearch.trim() ? 1 : 0) +
              (installerVendorFilter !== 'ALL' ? 1 : 0) +
              (installerAreaFilter !== 'ALL' ? 1 : 0) +
              (installerSort.direction ? 1 : 0)
            }
            onResetFilters={() => {
              setInstallerSearch('');
              setInstallerVendorFilter('ALL');
              setInstallerAreaFilter('ALL');
              setInstallerSort({ column: null, direction: null });
            }}
            mobileTitle={inst => inst.installerName}
            mobileSubtitle={inst => `${inst.contractorName} • ${inst.area}`}
            mobileStatus={inst => <StatusBadge status={inst.closed > 0 ? 'CLOSED' : 'PROGRESS'} size="xs" />}
            onRowClick={inst =>
              onDrillDown('assigned', {
                contractor: inst.contractorName && inst.contractorName !== 'Tanpa Vendor' ? inst.contractorName : undefined,
                area: inst.area && inst.area !== 'Tanpa Area' ? inst.area : undefined,
                installerName: inst.installerName
              })
            }
            emptyState={{
              title: 'Belum ada teknisi yang di-assign',
              description: `Belum ada teknisi yang di-assign untuk ${todayWIB}.`
            }}
            columns={
              [
                {
                  key: 'installerName',
                  label: 'Teknisi / Installer',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'search',
                    value: installerSearch,
                    onChange: setInstallerSearch,
                    placeholder: 'Cari nama teknisi...'
                  },
                  tdClassName: 'font-semibold text-[#26364A] dark:text-white',
                  render: inst => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('assigned', {
                          contractor: inst.contractorName && inst.contractorName !== 'Tanpa Vendor' ? inst.contractorName : undefined,
                          area: inst.area && inst.area !== 'Tanpa Area' ? inst.area : undefined,
                          installerName: inst.installerName
                        });
                      }}
                      className="font-semibold text-[#26364A] dark:text-white hover:text-[#5145A6] dark:hover:text-[#D8B4FE] hover:underline cursor-pointer"
                    >
                      {inst.installerName}
                    </button>
                  )
                },
                {
                  key: 'contractorName',
                  label: 'Vendor',
                  priority: 'secondary',
                  sortable: true,
                  headerControl: {
                    kind: 'select',
                    value: installerVendorFilter,
                    defaultValue: 'ALL',
                    allLabel: 'Semua Vendor',
                    options: installerVendorOptions,
                    onChange: setInstallerVendorFilter
                  },
                  tdClassName: 'text-[#52647A] dark:text-[#CEC0E8]',
                  render: inst => inst.contractorName
                },
                {
                  key: 'area',
                  label: 'Area',
                  priority: 'secondary',
                  sortable: true,
                  headerControl: {
                    kind: 'select',
                    value: installerAreaFilter,
                    defaultValue: 'ALL',
                    allLabel: 'Semua Area',
                    options: installerAreaOptions,
                    onChange: setInstallerAreaFilter
                  },
                  tdClassName: 'text-[#52647A] dark:text-[#CEC0E8]',
                  render: inst => inst.area
                },
                {
                  key: 'total',
                  label: 'Total WO',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: inst => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('assigned', {
                          contractor: inst.contractorName && inst.contractorName !== 'Tanpa Vendor' ? inst.contractorName : undefined,
                          area: inst.area && inst.area !== 'Tanpa Area' ? inst.area : undefined,
                          installerName: inst.installerName
                        });
                      }}
                      className="font-bold hover:underline cursor-pointer"
                    >
                      {inst.total}
                    </button>
                  )
                },
                {
                  key: 'progress',
                  label: 'Progress',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: inst => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('checked_in_progress', {
                          contractor: inst.contractorName && inst.contractorName !== 'Tanpa Vendor' ? inst.contractorName : undefined,
                          area: inst.area && inst.area !== 'Tanpa Area' ? inst.area : undefined,
                          installerName: inst.installerName
                        });
                      }}
                      className="text-[#5145A6] dark:text-[#D8B4FE] font-semibold hover:underline cursor-pointer"
                    >
                      {inst.checkedInProgress}
                    </button>
                  )
                },
                {
                  key: 'butuhApproval',
                  label: 'Butuh Approval',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: inst => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('butuh_approval', {
                          contractor: inst.contractorName && inst.contractorName !== 'Tanpa Vendor' ? inst.contractorName : undefined,
                          area: inst.area && inst.area !== 'Tanpa Area' ? inst.area : undefined,
                          installerName: inst.installerName
                        });
                      }}
                      className="text-[#C88735] dark:text-orange-300 font-bold hover:underline cursor-pointer"
                    >
                      {inst.butuhApproval}
                    </button>
                  )
                },
                {
                  key: 'approved',
                  label: 'Approved',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: inst => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('approved', {
                          contractor: inst.contractorName && inst.contractorName !== 'Tanpa Vendor' ? inst.contractorName : undefined,
                          area: inst.area && inst.area !== 'Tanpa Area' ? inst.area : undefined,
                          installerName: inst.installerName
                        });
                      }}
                      className="text-[#218A63] dark:text-emerald-300 font-semibold hover:underline cursor-pointer"
                    >
                      {inst.approved}
                    </button>
                  )
                },
                {
                  key: 'revisionRejected',
                  label: 'Revisi',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'secondary',
                  render: inst => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('revision_rejected', {
                          contractor: inst.contractorName && inst.contractorName !== 'Tanpa Vendor' ? inst.contractorName : undefined,
                          area: inst.area && inst.area !== 'Tanpa Area' ? inst.area : undefined,
                          installerName: inst.installerName
                        });
                      }}
                      className="text-[#9B2C37] dark:text-rose-300 font-semibold hover:underline cursor-pointer"
                    >
                      {inst.revisionRejected}
                    </button>
                  )
                },
                {
                  key: 'closed',
                  label: 'Closed',
                  align: 'right',
                  numeric: true,
                  sortable: true,
                  priority: 'primary',
                  render: inst => (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDrillDown('closed', {
                          contractor: inst.contractorName && inst.contractorName !== 'Tanpa Vendor' ? inst.contractorName : undefined,
                          area: inst.area && inst.area !== 'Tanpa Area' ? inst.area : undefined,
                          installerName: inst.installerName
                        });
                      }}
                      className="inline-flex items-center gap-1.5 hover:underline cursor-pointer"
                    >
                      <StatusBadge status={inst.closed > 0 ? 'CLOSED' : 'PROGRESS'} size="xs" />
                      <strong>{inst.closed}</strong>
                    </button>
                  )
                }
              ] as ResponsiveColumn<(typeof effectiveSummary.byInstaller)[number]>[]
            }
          />
        </div>
      )}
    </section>
  );
};
