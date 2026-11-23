import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Cloud,
  Database,
  Eye,
  FileSpreadsheet,
  Filter,
  Layers,
  LayoutGrid,
  MessageSquare,
  Printer,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  TrendingUp,
  UserPlus,
  Wrench
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Ticket, WOKpiFilterKey, WOKpiSummary } from '../../types/index.ts';
import { computeClientKpiSummary } from '../../services/woLifecycleService';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { StatusApprovalBadge, StatusInstallerBadge } from '../common/Badge';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { DropdownActionItem } from '../common/ActionDropdownMenu';
import { StitchOpsCommandCenter } from './StitchOpsCommandCenter';
import { StitchDispatchWorkspace } from './StitchDispatchWorkspace';
import { DispatchVerificationDesk } from './DispatchVerificationDesk';

export type OpsCommandViewTab = 'overview' | 'verification' | 'queue' | 'matrix';

interface OpsCommandHeroProps {
  activeView: OpsCommandViewTab;
  onChangeView: (view: OpsCommandViewTab) => void;
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
  onDrillDown?: (filterKey: WOKpiFilterKey, filters?: { contractor?: string; area?: string }) => void;
}

interface TactileLogEntry {
  id: string;
  tag: string;
  message: string;
  time: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

export const OpsCommandHero: React.FC<OpsCommandHeroProps> = ({
  activeView,
  onChangeView,
  onNavigate,
  onSelectTicket,
  onOpenWhatsApp,
  onDrillDown
}) => {
  const {
    currentUser,
    scopedTickets,
    kpiSummary,
    todayWIB,
    auditLogs,
    syncStatus,
    databaseStatus,
    refreshDatabaseData,
    kpiContractorFilter,
    kpiAreaFilter,
    setActiveKpiDrilldown,
    setKpiContractorFilter,
    setKpiAreaFilter
  } = useApp();

  const [interactionLogs, setInteractionLogs] = useState<TactileLogEntry[]>([]);
  const [isSyncingNow, setIsSyncingNow] = useState(false);

  const effectiveSummary: WOKpiSummary = useMemo(() => {
    const fallback = computeClientKpiSummary(scopedTickets, currentUser, {
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

    return fallback;
  }, [kpiSummary, scopedTickets, currentUser, todayWIB, kpiContractorFilter, kpiAreaFilter]);

  const counts = effectiveSummary.counts;
  const completedCount = counts.approvedDone ?? 0;
  const approvalPct =
    counts.totalToday > 0 ? Math.min(100, Math.round((counts.approved / counts.totalToday) * 100)) : counts.approvalRatePct || 0;
  const completionPct =
    counts.totalToday > 0 ? Math.min(100, Math.round((completedCount / counts.totalToday) * 100)) : counts.completionRatePct || 0;

  // Build real 7-point hourly/status distribution curve from scopedTickets (zero fabricated metrics)
  const sparklineData = useMemo(() => {
    const stages = [
      counts.totalToday,
      counts.assigned,
      counts.checkedInProgress,
      counts.butuhApproval,
      counts.approved,
      counts.closed,
      counts.revisionRejected
    ];
    const maxVal = Math.max(1, ...stages);
    const width = 200;
    const height = 42;
    const stepX = width / (stages.length - 1);

    const pts = stages.map((val, idx) => {
      const x = Math.round(idx * stepX);
      const y = Math.round(height - 6 - ((val / maxVal) * (height - 12)));
      return { x, y, val };
    });

    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
    return { pts, linePath, areaPath };
  }, [counts]);

  // Active priority Work Orders from scopedTickets (strictly Today WIB — overdue WOs live in OVERDUE WO menu)
  const priorityQueueTickets = useMemo(() => {
    return scopedTickets
      .filter(t => !t.isArchived && !t.isDeleted && getTicketAppointmentDate(t) === todayWIB)
      .slice()
      .sort((a, b) => {
        const aNeed = a.approvalStatus === 'BUTUH APPROVAL' ? 0 : 1;
        const bNeed = b.approvalStatus === 'BUTUH APPROVAL' ? 0 : 1;
        if (aNeed !== bNeed) return aNeed - bNeed;
        return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
      })
      .slice(0, 6);
  }, [scopedTickets, todayWIB]);

  // Real combined telemetry feed: recent local click feedback + live auditLogs from AppContext
  const consoleFeed = useMemo<TactileLogEntry[]>(() => {
    const auditEntries: TactileLogEntry[] = (auditLogs || []).slice(0, 5).map(log => {
      let time = 'WIB';
      try {
        time = new Date(log.timestamp).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch {
        time = 'LIVE';
      }
      return {
        id: log.id,
        tag: (log.entity || 'AUDIT').toUpperCase(),
        message: `${log.action} · ${log.details}`,
        time,
        tone: log.action.toLowerCase().includes('delete') || log.action.toLowerCase().includes('reject')
          ? 'danger'
          : log.action.toLowerCase().includes('approve') || log.action.toLowerCase().includes('sync')
          ? 'success'
          : 'info'
      };
    });

    return [...interactionLogs, ...auditEntries].slice(0, 6);
  }, [interactionLogs, auditLogs]);

  const recordTactileAction = (
    tag: string,
    message: string,
    tone: TactileLogEntry['tone'] = 'info'
  ) => {
    const nowTime = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    setInteractionLogs(prev => [
      {
        id: `tactile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tag,
        message,
        time: nowTime,
        tone
      },
      ...prev.slice(0, 5)
    ]);
  };

  const handleCloudSyncClick = async () => {
    setIsSyncingNow(true);
    recordTactileAction('CLOUD_SYNC', 'Memulai sinkronisasi manual Express API & Supabase...', 'info');
    try {
      await refreshDatabaseData();
      recordTactileAction('CLOUD_OK', `Sinkronisasi selesai (${scopedTickets.length} WO aktif).`, 'success');
    } catch {
      recordTactileAction('CLOUD_ERR', 'Sinkronisasi gagal atau tertunda.', 'danger');
    } finally {
      setIsSyncingNow(false);
    }
  };

  const roleActionTarget = useMemo(() => {
    if (currentUser.role === 'leader') return 'wo_assignment';
    if (currentUser.role === 'installer') return 'installer_tasks';
    return 'tickets';
  }, [currentUser.role]);

  const resolvedDrillDown = (
    filterKey: WOKpiFilterKey,
    filters?: { contractor?: string; area?: string }
  ) => {
    if (onDrillDown) {
      onDrillDown(filterKey, filters);
      return;
    }
    if (filters?.contractor) {
      setKpiContractorFilter(filters.contractor);
    }
    if (filters?.area) {
      setKpiAreaFilter(filters.area);
    }
    setActiveKpiDrilldown({
      filterKey,
      dateWIB: todayWIB,
      contractor: filters?.contractor,
      area: filters?.area
    });
    onNavigate(roleActionTarget);
  };

  const hasDedicatedStitchHeader = activeView === 'overview' || activeView === 'verification';

  return (
    <section aria-label="MoraJaws Ops Command Center" className="space-y-5">
      {/* Top Hero Header & 3D Tab Switcher (compact switcher bar when Stitch Overview or Verification Desk is active to avoid duplicate H1 headers) */}
      <div className={`flex flex-col xl:flex-row ${hasDedicatedStitchHeader ? 'xl:items-center justify-end' : 'xl:items-end justify-between'} gap-4`}>
        {!hasDedicatedStitchHeader && (
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="px-2.5 py-0.5 bg-[#EAE8FF] dark:bg-[#7135b5] text-[#5145A6] dark:text-white border border-[#DCE3F2] dark:border-transparent text-[10px] font-extrabold font-mono uppercase tracking-wider rounded-md shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_2px_0_#CFDCE8] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_0_#35105e] whitespace-nowrap">
                OPS COMMAND · V4.2
              </span>
              <span className="text-[11px] font-mono font-semibold text-[#52647A] dark:text-[#cabde8]">
                Canonical 46-Column Architecture
              </span>
              <span className="hidden sm:inline text-[#CFDCE8] dark:text-[#5b35b1]">|</span>
              <span className="text-[11px] font-mono font-semibold text-[#2E7D8B] dark:text-[#dab9ff] tabular-nums">
                todayWIB: {todayWIB} · Auto-Rollover Active
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#26364A] dark:text-white tracking-tight leading-tight">
              MoraJaws Ops Command &amp; Live Telemetry
            </h1>
            <p className="text-xs sm:text-sm text-[#52647A] dark:text-[#cabde8] max-w-2xl leading-relaxed">
              Pusat kendali operasional Work Order FTTH real-time untuk{' '}
              <span className="font-semibold text-[#5145A6] dark:text-[#dab9ff]">
                {currentUser.name}
              </span>
              .
            </p>
          </div>
        )}

        {/* Debossed Tactile View Switcher */}
        <div
          role="tablist"
          aria-label="Ops Command View Switcher"
          className="mj-tactile-tab-bar p-1.5 flex flex-wrap sm:flex-nowrap items-center gap-1.5 max-w-full overflow-x-auto shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'overview'}
            onClick={() => onChangeView('overview')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeView === 'overview'
                ? 'mj-tactile-tab-active'
                : 'text-[#52647A] dark:text-[#cabde8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/5'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#dab9ff]" />
            <span>Operations Overview</span>
          </button>

          {(currentUser.role === 'super_admin' || currentUser.role === 'dispatch') && (
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'verification'}
              onClick={() => onChangeView('verification')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                activeView === 'verification'
                  ? 'mj-tactile-tab-active'
                  : 'text-[#52647A] dark:text-[#cabde8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/5'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#dab9ff]" />
              <span>Antrean Verifikasi QC</span>
              {counts.butuhApproval > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-[#D45B66] dark:bg-[#DC4C5A] text-white font-mono text-[10px] tabular-nums">
                  {counts.butuhApproval}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'queue'}
            onClick={() => onChangeView('queue')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeView === 'queue'
                ? 'mj-tactile-tab-active'
                : 'text-[#52647A] dark:text-[#cabde8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/5'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#dab9ff]" />
            <span>Live Queue &amp; Dispatch</span>
            <span className="px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105e] text-[#5145A6] dark:text-[#dab9ff] font-mono text-[10px] tabular-nums">
              {counts.totalToday}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'matrix'}
            onClick={() => onChangeView('matrix')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
              activeView === 'matrix'
                ? 'mj-tactile-tab-active'
                : 'text-[#52647A] dark:text-[#cabde8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#dab9ff]" />
            <span>Tactile Ops Matrix</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ROLE-ADAPTIVE STITCH COMMAND CENTER (Dispatch Workspace vs Superadmin Master Console) */}
      {activeView === 'overview' &&
        (currentUser.role === 'dispatch' ? (
          <StitchDispatchWorkspace
            onNavigate={onNavigate}
            onSelectTicket={onSelectTicket}
            onOpenWhatsApp={onOpenWhatsApp}
            onDrillDown={resolvedDrillDown}
          />
        ) : (
          <StitchOpsCommandCenter
            onNavigate={onNavigate}
            onSelectTicket={onSelectTicket}
            onDrillDown={resolvedDrillDown}
          />
        ))}

      {/* TAB 1B: STITCH AI DISPATCH VERIFICATION & QC DESK */}
      {activeView === 'verification' && (
        <DispatchVerificationDesk
          onNavigate={onNavigate}
          onSelectTicket={onSelectTicket}
          onOpenWhatsApp={onOpenWhatsApp}
        />
      )}

      {/* TAB 2: LIVE QUEUE & DISPATCH TELEMETRY */}
      {activeView === 'queue' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* 3-Card Telemetry Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Telemetry Card 1: Total Operational Today + SVG Sparkline */}
            <div className="mj-tactile-card p-5 border border-[#DDE6F0] dark:border-[#3b1d78] space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#dab9ff]">
                    TODAY OPERATIONAL VOLUME
                  </span>
                  <h2 className="font-display text-2xl font-extrabold text-[#26364A] dark:text-white font-mono tabular-nums mt-0.5">
                    {counts.totalToday} WO
                  </h2>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#218A63] dark:text-emerald-300 font-mono text-[10px] font-bold tabular-nums">
                  {completionPct}% Done
                </span>
              </div>

              <svg viewBox="0 0 200 42" className="w-full h-11 overflow-visible" aria-label="Pipeline WO Sparkline">
                <defs>
                  <linearGradient id="mj-ops-spark" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#6657C8" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#65B8C4" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={sparklineData.areaPath} fill="url(#mj-ops-spark)" />
                <path d={sparklineData.linePath} fill="none" stroke="#6657C8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                {sparklineData.pts.map((pt, idx) => (
                  <circle key={idx} cx={pt.x} cy={pt.y} r="2.5" className="fill-[#5145A6] dark:fill-[#dab9ff]" />
                ))}
              </svg>

              <div className="flex items-center justify-between text-[11px] font-mono text-[#52647A] dark:text-[#cabde8] tabular-nums pt-1 border-t border-[#DDE6F0] dark:border-[#35105e]">
                <span>Assigned: {counts.assigned}</span>
                <span>Belum Assign: {counts.unassigned}</span>
              </div>
            </div>

            {/* Telemetry Card 2: Dispatch Review & Approval Funnel */}
            <div className="mj-tactile-card p-5 border border-[#DDE6F0] dark:border-[#3b1d78] space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#6657C8] dark:text-[#dab9ff]">
                    DISPATCH APPROVAL FUNNEL
                  </span>
                  <h2 className="font-display text-2xl font-extrabold text-[#26364A] dark:text-white font-mono tabular-nums mt-0.5">
                    {counts.butuhApproval} Antrean
                  </h2>
                </div>
                <span className="p-2 rounded-xl bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff]">
                  <ClipboardCheck className="w-4 h-4" />
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold">
                  <span className="text-[#52647A] dark:text-[#cabde8]">Done / Closed Dispatch</span>
                  <span className="font-mono font-bold text-[#5145A6] dark:text-[#dab9ff] tabular-nums">
                    {completedCount} Done · {counts.closed} Closed / {counts.totalToday}
                  </span>
                </div>
                <div className="mj-tactile-well h-2.5 w-full overflow-hidden p-0.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#6657C8] to-[#218A63] dark:from-[#7135b5] dark:to-[#16a36a] transition-all duration-500"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-[#52647A] dark:text-[#cabde8] tabular-nums pt-1 border-t border-[#DDE6F0] dark:border-[#35105e]">
                <span className="text-[#218A63] dark:text-emerald-300">
                  Approved: {counts.approved} ({approvalPct}%)
                </span>
                <span className="text-[#9B2C37] dark:text-rose-300">Revisi: {counts.revisionRejected}</span>
              </div>
            </div>

            {/* Telemetry Card 3: Field Check-in & Sync Status */}
            <div className="mj-tactile-card p-5 border border-[#DDE6F0] dark:border-[#3b1d78] space-y-3 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2E7D8B] dark:text-teal-300">
                    FIELD EXECUTION &amp; SYNC
                  </span>
                  <h2 className="font-display text-2xl font-extrabold text-[#26364A] dark:text-white font-mono tabular-nums mt-0.5">
                    {counts.checkedInProgress} On-Site
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#DDF4F4] dark:bg-[#2e1459] text-[#2E7D8B] dark:text-[#dab9ff] font-mono text-[10px] font-bold">
                  <Database className="w-3 h-3" />
                  <span>{databaseStatus === 'connected' ? 'LIVE' : databaseStatus.toUpperCase()}</span>
                </span>
              </div>

              <div className="mj-tactile-well p-2.5 flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span className="text-[#52647A] dark:text-[#cabde8]">Belum Check-in:</span>
                <span className="font-bold text-[#9D661F] dark:text-amber-300">{counts.notCheckedIn} WO</span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate(roleActionTarget)}
                  className="mj-tactile-btn-primary flex-1 px-3 py-2 rounded-lg text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <span>Buka Workspace WO</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCloudSyncClick}
                  disabled={isSyncingNow}
                  aria-label="Sinkronisasi data"
                  className="mj-tactile-btn-secondary px-3 py-2 rounded-lg text-xs inline-flex items-center justify-center cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingNow ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Live Work Order Queue Table / Mobile Priority Cards */}
          <div className="space-y-3">
            <div className="mj-tactile-card border border-[#DDE6F0] dark:border-[#3b1d78] px-4 sm:px-5 py-3.5 bg-[#F8FAFD] dark:bg-[#1a0f30] flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-white">
                  Antrean Prioritas Work Order Aktif ({priorityQueueTickets.length} Teratas)
                </h3>
                <p className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                  Menampilkan tiket aktif sesuai scope peran {currentUser.role.replace('_', ' ')}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(roleActionTarget)}
                className="mj-tactile-btn-secondary px-3.5 py-2 min-h-[38px] rounded-lg text-xs inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <span>Lihat Semua WO</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <ResponsiveDataTable<Ticket>
              data={priorityQueueTickets}
              getRowKey={t => t.id}
              stickyHeader={false}
              mobileTitle={t => <span className="font-mono text-[#5145A6] dark:text-[#DAB9FF]">{t.woNumber}</span>}
              mobileSubtitle={t => `${t.customerName} • ${t.slotTime || t.appointmentDate || todayWIB}`}
              mobileStatus={t => (
                <>
                  <StatusApprovalBadge status={t.approvalStatus} />
                  <StatusInstallerBadge status={t.statusWOInstaller} />
                </>
              )}
              onRowClick={onSelectTicket ? t => onSelectTicket(t, 'overview') : undefined}
              getRowActions={t => {
                if (!onSelectTicket) return [];
                const items: DropdownActionItem[] = [
                  {
                    id: 'detail',
                    label: 'Buka Detail WO (17 Section)',
                    icon: <Eye className="w-3.5 h-3.5" />,
                    tone: 'primary',
                    onClick: () => onSelectTicket(t, 'overview')
                  },
                  {
                    id: 'chat',
                    label: 'Buka LiveChat WO',
                    icon: <MessageSquare className="w-3.5 h-3.5" />,
                    onClick: () => onSelectTicket(t, 'chat')
                  }
                ];
                return items;
              }}
              renderDesktopActions={
                onSelectTicket
                  ? ticket => (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectTicket(ticket, 'chat')}
                          className="mj-tactile-btn-secondary px-2.5 py-1.5 rounded-lg text-[11px] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          title="Buka LiveChat WO"
                        >
                          <MessageSquare className="w-3 h-3 text-[#6657C8] dark:text-[#dab9ff]" />
                          <span>LiveChat</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectTicket(ticket, 'overview')}
                          className="mj-tactile-btn-primary px-2.5 py-1.5 rounded-lg text-[11px] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          title="Buka 17-Section Ticket Fullview"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Detail WO</span>
                        </button>
                      </div>
                    )
                  : undefined
              }
              desktopActionHeader="Aksi Cepat"
              emptyState={{
                title: 'Belum ada Work Order aktif',
                description: 'Belum ada Work Order aktif dalam scope Anda saat ini.'
              }}
              columns={
                [
                  {
                    key: 'woNumber',
                    label: 'WO Number',
                    priority: 'hidden_mobile',
                    tdClassName: 'font-mono font-bold text-[#5145A6] dark:text-[#dab9ff] whitespace-nowrap',
                    render: t => t.woNumber
                  },
                  {
                    key: 'customerName',
                    label: 'Pelanggan',
                    priority: 'hidden_mobile',
                    render: t => (
                      <div>
                        <div className="font-semibold text-[#26364A] dark:text-white truncate max-w-[180px]">
                          {t.customerName}
                        </div>
                        <div className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#cabde8]">
                          {t.slotTime || t.appointmentDate || todayWIB}
                        </div>
                      </div>
                    )
                  },
                  {
                    key: 'vendorArea',
                    label: 'Vendor & Area',
                    priority: 'primary',
                    render: t => (
                      <div className="text-[#52647A] dark:text-[#cabde8]">
                        <div className="font-medium truncate max-w-[170px]">{t.contactorName || '-'}</div>
                        <div className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8]/80">{t.area || '-'}</div>
                      </div>
                    )
                  },
                  {
                    key: 'installerName',
                    label: 'Teknisi',
                    priority: 'primary',
                    render: t =>
                      t.installerName ? (
                        <span className="font-semibold text-[#26364A] dark:text-white">{t.installerName}</span>
                      ) : (
                        <span className="italic text-[#C88735] dark:text-amber-300 font-semibold">Belum Assign</span>
                      )
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    priority: 'hidden_mobile',
                    render: t => (
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusApprovalBadge status={t.approvalStatus} />
                        <StatusInstallerBadge status={t.statusWOInstaller} />
                      </div>
                    )
                  },
                  {
                    key: 'address',
                    label: 'Alamat',
                    priority: 'secondary',
                    tdClassName: 'hidden',
                    thClassName: 'hidden',
                    render: t => t.address || '-'
                  }
                ] as ResponsiveColumn<Ticket>[]
              }
            />
          </div>
        </div>
      )}

      {/* TAB 3: TACTILE OPS MATRIX (5-TIER CONTROL MATRIX + MICRO KEYS + FAB + LIVE STREAM) */}
      {activeView === 'matrix' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Unified Aqua-Violet Glass Banner (Light) / Dark Physics Telemetry Banner (Night) */}
          <div className="rounded-xl bg-gradient-to-br from-white/95 via-[#F4F7FB]/92 to-[#DDF4F4]/80 dark:from-[#160D29] dark:via-[#160D29] dark:to-[#160D29] text-[#26364A] dark:text-white p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_4px_0_#DDE6F0,0_12px_24px_-8px_rgba(38,54,74,0.10)] dark:shadow-[0_4px_0_#1f1638,0_12px_24px_-6px_rgba(31,22,56,0.28)] border border-[#CFDCE8] dark:border-[#3b1d78]">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#7135b5] text-[#5145A6] dark:text-white border border-[#DCE3F2] dark:border-transparent font-mono text-[10px] font-extrabold uppercase tracking-wider shadow-[0_2px_0_#CFDCE8] dark:shadow-[0_2px_0_#35105e]">
                    TACTILE OPS KERNEL
                  </span>
                  <span className="font-mono text-[11px] text-[#2E7D8B] dark:text-[#dab9ff]">
                    Crystal Water Glass · Unified 3D Action Matrix
                  </span>
                </div>
                <h2 className="font-display text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white tracking-tight">
                  Matriks Kendali Cepat &amp; Haptic Ops Feedback
                </h2>
                <p className="text-xs text-[#52647A] dark:text-[#f5eeff]/80 leading-relaxed">
                  Setiap tombol terhubung ke modul operasional MoraJaws sesuai izin peran{' '}
                  <strong className="text-[#5145A6] dark:text-white">{currentUser.role}</strong>.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 shrink-0">
                <div className="rounded-lg bg-[#F8FAFD] dark:bg-[#1f1638]/70 border border-[#DDE6F0] dark:border-white/10 px-3 py-2 text-center">
                  <div className="font-mono text-[9.5px] uppercase text-[#52647A] dark:text-[#dab9ff]">WO HARI INI</div>
                  <div className="font-mono text-base font-extrabold text-[#26364A] dark:text-white tabular-nums">{counts.totalToday}</div>
                </div>
                <div className="rounded-lg bg-[#F8FAFD] dark:bg-[#1f1638]/70 border border-[#DDE6F0] dark:border-white/10 px-3 py-2 text-center">
                  <div className="font-mono text-[9.5px] uppercase text-[#52647A] dark:text-[#dab9ff]">APPROVAL</div>
                  <div className="font-mono text-base font-extrabold text-[#C88735] dark:text-amber-300 tabular-nums">{counts.butuhApproval}</div>
                </div>
                <div className="rounded-lg bg-[#F8FAFD] dark:bg-[#1f1638]/70 border border-[#DDE6F0] dark:border-white/10 px-3 py-2 text-center">
                  <div className="font-mono text-[9.5px] uppercase text-[#52647A] dark:text-[#dab9ff]">SYNC STATE</div>
                  <div className="font-mono text-xs font-extrabold text-[#218A63] dark:text-emerald-300 mt-1">{syncStatus}</div>
                </div>
              </div>
            </div>
          </div>

          {/* 5-Tier Tactile Action Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* Tier 01: Primary */}
            <div className="mj-tactile-card p-4 border border-[#DDE6F0] dark:border-[#3b1d78] flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#dab9ff]">
                    TIER 01 // PRIMARY
                  </span>
                  <span className="w-2 h-2 rounded-full bg-[#6657C8] dark:bg-[#7135b5]" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
                    Crystal Violet
                  </h3>
                  <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] mt-1 leading-snug">
                    Penugasan WO atau eksekusi daftar tiket hari ini.
                  </p>
                </div>
                <div className="mj-tactile-well p-2 text-[10.5px] text-[#52647A] dark:text-[#cabde8]">
                  <span className="font-mono font-bold block text-[#5145A6] dark:text-[#dab9ff]">ACTION ROUTE</span>
                  <span>
                    {currentUser.role === 'leader' ? 'Assign WO Lapangan' : 'Daftar Work Orders'}
                  </span>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    recordTactileAction('NAV_PRIMARY', `Membuka modul ${roleActionTarget}`, 'info');
                    onNavigate(roleActionTarget);
                  }}
                  className="mj-tactile-btn-primary w-full py-2.5 px-3 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>{currentUser.role === 'leader' ? 'Assign WO' : 'Buka Tickets'}</span>
                </button>
                <div className="text-center font-mono text-[10px] text-[#8492A5] mt-2">Bevel: #5145A6</div>
              </div>
            </div>

            {/* Tier 02: Secondary */}
            <div className="mj-tactile-card p-4 border border-[#DDE6F0] dark:border-[#3b1d78] flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#cabde8]">
                    TIER 02 // SECONDARY
                  </span>
                  <span className="w-2 h-2 rounded-full bg-[#65B8C4] dark:bg-[#cec3d4]" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
                    Aqua Frosted
                  </h3>
                  <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] mt-1 leading-snug">
                    Inspeksi laporan progres, filter lanjutan, dan riwayat historis.
                  </p>
                </div>
                <div className="mj-tactile-well p-2 text-[10.5px] text-[#52647A] dark:text-[#cabde8]">
                  <span className="font-mono font-bold block text-[#52647A] dark:text-[#dab9ff]">ACTION ROUTE</span>
                  <span>History Progress &amp; Rekap</span>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    recordTactileAction('NAV_REPORT', 'Membuka History Progress Report', 'info');
                    onNavigate('history_progress');
                  }}
                  className="mj-tactile-btn-secondary w-full py-2.5 px-3 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap border border-[#DDE6F0] dark:border-[#4b386b]"
                >
                  <Filter className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                  <span>History Progress</span>
                </button>
                <div className="text-center font-mono text-[10px] text-[#8492A5] mt-2">Bevel: #CFDCE8</div>
              </div>
            </div>

            {/* Tier 03: Success */}
            <div className="mj-tactile-card p-4 border border-[#DDE6F0] dark:border-[#3b1d78] flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#218A63] dark:text-emerald-300">
                    TIER 03 // SUCCESS
                  </span>
                  <span className="w-2 h-2 rounded-full bg-[#218A63] dark:bg-[#16a36a]" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
                    Emerald Glass
                  </h3>
                  <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] mt-1 leading-snug">
                    Verifikasi approval Dispatch, ringkasan report, dan penyelesaian BAST.
                  </p>
                </div>
                <div className="mj-tactile-well p-2 text-[10.5px] text-[#52647A] dark:text-[#cabde8]">
                  <span className="font-mono font-bold block text-[#218A63] dark:text-emerald-300">QUEUE COUNT</span>
                  <span className="tabular-nums">{counts.butuhApproval} Menunggu Approval</span>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    const target = currentUser.role === 'installer' ? 'installer_tasks' : 'reports';
                    recordTactileAction('NAV_APPROVAL', `Membuka ${target} (${counts.butuhApproval} antrean)`, 'success');
                    onNavigate(target);
                  }}
                  className="mj-tactile-btn-success w-full py-2.5 px-3 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{currentUser.role === 'installer' ? 'Laporan Saya' : 'Report & Review'}</span>
                </button>
                <div className="text-center font-mono text-[10px] text-[#8492A5] mt-2">Bevel: #1B6E4F</div>
              </div>
            </div>

            {/* Tier 04: Destructive / Alert */}
            <div className="mj-tactile-card p-4 border border-[#DDE6F0] dark:border-[#3b1d78] flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#9B2C37] dark:text-rose-300">
                    TIER 04 // ESCALATION
                  </span>
                  <span className="w-2 h-2 rounded-full bg-[#D45B66] dark:bg-[#ba1a1a]" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
                    Coral Crystal
                  </h3>
                  <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] mt-1 leading-snug">
                    Koordinasi revisi laporan, eskalasi kendala lapangan, dan penolakan.
                  </p>
                </div>
                <div className="mj-tactile-well p-2 text-[10.5px] text-[#52647A] dark:text-[#cabde8]">
                  <span className="font-mono font-bold block text-[#9B2C37] dark:text-rose-300">REVISION QUEUE</span>
                  <span className="tabular-nums">{counts.revisionRejected} Perlu Revisi</span>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    recordTactileAction('NAV_CONTACT', 'Membuka Coordination / Contact Centre', 'danger');
                    onNavigate('contact_centre');
                  }}
                  className="mj-tactile-btn-danger w-full py-2.5 px-3 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Coordination</span>
                </button>
                <div className="text-center font-mono text-[10px] text-[#8492A5] mt-2">Bevel: #B13E49</div>
              </div>
            </div>

            {/* Tier 05: Warning */}
            <div className="mj-tactile-card p-4 border border-[#DDE6F0] dark:border-[#3b1d78] flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#9D661F] dark:text-amber-300">
                    TIER 05 // SLA ALERT
                  </span>
                  <span className="w-2 h-2 rounded-full bg-[#C88735] dark:bg-[#d97706]" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
                    Amber Prism
                  </h3>
                  <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] mt-1 leading-snug">
                    Pemantauan ambang SLA vendor, ketepatan waktu teknisi, dan notifikasi.
                  </p>
                </div>
                <div className="mj-tactile-well p-2 text-[10.5px] text-[#52647A] dark:text-[#cabde8]">
                  <span className="font-mono font-bold block text-[#9D661F] dark:text-amber-300">UNASSIGNED / DELAY</span>
                  <span className="tabular-nums">{counts.unassigned + counts.notCheckedIn} Perlu Pantau</span>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    const slaTarget = currentUser.role === 'installer' ? 'installer_tasks' : 'sla_monitoring';
                    recordTactileAction('NAV_SLA', `Membuka ${slaTarget}`, 'warning');
                    onNavigate(slaTarget);
                  }}
                  className="mj-tactile-btn-warning w-full py-2.5 px-3 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Monitor SLA</span>
                </button>
                <div className="text-center font-mono text-[10px] text-[#8492A5] mt-2">Bevel: #A16720</div>
              </div>
            </div>
          </div>

          {/* Bottom 3-Column Interaction Deck: Micro Keys | Cloud Sync FAB | Live Event Console */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Micro Keys Tray */}
            <div className="mj-tactile-card p-5 border border-[#DDE6F0] dark:border-[#3b1d78] flex flex-col justify-between gap-4">
              <div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#dab9ff]">
                  TACTILE SQUARE TRAYS
                </span>
                <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white mt-0.5">
                  High-Precision Micro Keys
                </h3>
                <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] mt-1">
                  Keypad taktil 44x44px untuk akses modul cepat dan sinkronisasi instan.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    recordTactileAction('MICRO_PRINT', 'Membuka halaman cetak & ekspor laporan', 'info');
                    onNavigate('reports');
                  }}
                  title="Buka Reports"
                  className="mj-tactile-icon-key w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleCloudSyncClick}
                  disabled={isSyncingNow}
                  title="Refresh Data Database"
                  className="mj-tactile-icon-key w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncingNow ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    recordTactileAction('MICRO_HIST', 'Membuka History Progress', 'info');
                    onNavigate('history_progress');
                  }}
                  title="Riwayat Progres"
                  className="mj-tactile-icon-key w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer"
                >
                  <Clock className="w-4 h-4" />
                </button>
                {['super_admin', 'dispatch'].includes(currentUser.role) && (
                  <button
                    type="button"
                    onClick={() => {
                      recordTactileAction('MICRO_IMPORT', 'Membuka Center Import Batch WO', 'info');
                      onNavigate('import');
                    }}
                    title="Import Data WO"
                    className="mj-tactile-btn-primary w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                  </button>
                )}
                {currentUser.role === 'super_admin' && (
                  <button
                    type="button"
                    onClick={() => {
                      recordTactileAction('MICRO_SETUP', 'Membuka Setup Terpusat MoraJaws', 'info');
                      onNavigate('settings');
                    }}
                    title="Setup Terpusat"
                    className="mj-tactile-btn-secondary w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer border border-[#DDE6F0] dark:border-[#4b386b]"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="mj-tactile-well p-2.5 text-[10.5px] font-mono text-[#52647A] dark:text-[#cabde8]">
                Tekan micro-key di atas untuk memicu aksi modul &amp; audit event.
              </div>
            </div>

            {/* Cloud Sync High-Elevation Switch */}
            <div className="mj-tactile-card p-5 border border-[#DDE6F0] dark:border-[#3b1d78] flex flex-col justify-between gap-4">
              <div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#dab9ff]">
                  TACTILE HIGH-ELEVATION KEY
                </span>
                <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white mt-0.5">
                  Sinkronisasi Cloud &amp; Live Queue
                </h3>
                <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] mt-1">
                  Sinkronisasi penuh ke Express API &amp; Supabase PostgreSQL.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onChangeView('queue')}
                  title="Lihat Antrean Prioritas"
                  className="btn-3d-primary relative w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <Activity className="w-5 h-5" />
                  <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-[#C88735] dark:bg-[#d97706] text-white font-mono text-[10px] font-extrabold flex items-center justify-center shadow-xs tabular-nums">
                    {counts.butuhApproval}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleCloudSyncClick}
                  disabled={isSyncingNow}
                  className="mj-tactile-btn-primary flex-1 py-3 px-4 rounded-xl text-xs inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  <Cloud className="w-4 h-4" />
                  <span>{isSyncingNow ? 'Menyinkronkan...' : 'Sinkron Cloud'}</span>
                </button>
              </div>

              <div className="mj-tactile-well p-2.5 flex items-center justify-between text-[10.5px] font-mono text-[#52647A] dark:text-[#cabde8]">
                <span>Status DB: {databaseStatus}</span>
                <span className="text-[#5145A6] dark:text-[#dab9ff] font-bold">{scopedTickets.length} WO</span>
              </div>
            </div>

            {/* Live Audit & Tactile Event Stream */}
            <div className="mj-tactile-card rounded-xl dark:bg-none dark:bg-[#160D29] text-[#26364A] dark:text-white p-5 border border-[#CFDCE8] dark:border-[#3b1d78] dark:shadow-[0_4px_0_#1f1638,0_12px_24px_-6px_rgba(31,22,56,0.28)] flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2E7D8B] dark:text-[#dab9ff]">
                    LIVE AUDIT &amp; EVENT STREAM
                  </span>
                  <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white mt-0.5 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#a380fe]" />
                    <span>Activity Feedback Log</span>
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded bg-[#E4F5EC] dark:bg-[#1f1638] border border-[#B7E4CC] dark:border-transparent font-mono text-[10px] text-[#218A63] dark:text-emerald-300 font-bold">
                  {syncStatus}
                </span>
              </div>

              <div className="rounded-lg bg-[#F8FAFD] dark:bg-[#1f1638] border border-[#DDE6F0] dark:border-white/10 p-3 space-y-1.5 min-h-[120px] max-h-[148px] overflow-y-auto font-mono text-[10.5px]">
                {consoleFeed.length === 0 ? (
                  <div className="text-[#8492A5] dark:text-[#dab9ff]/70">
                    Menunggu event interaksi atau audit database baru...
                  </div>
                ) : (
                  consoleFeed.map(entry => (
                    <div key={entry.id} className="flex items-start justify-between gap-2 leading-snug">
                      <div className="min-w-0 truncate">
                        <span
                          className={`font-bold mr-1.5 ${
                            entry.tone === 'success'
                              ? 'text-[#218A63] dark:text-emerald-300'
                              : entry.tone === 'danger'
                              ? 'text-[#9B2C37] dark:text-rose-300'
                              : entry.tone === 'warning'
                              ? 'text-[#9D661F] dark:text-amber-300'
                              : 'text-[#5145A6] dark:text-[#dab9ff]'
                          }`}
                        >
                          [{entry.tag}]
                        </span>
                        <span className="text-[#26364A] dark:text-[#f5eeff]/90">{entry.message}</span>
                      </div>
                      <span className="text-[#8492A5] dark:text-[#cabde8]/70 shrink-0 tabular-nums">{entry.time}</span>
                    </div>
                  ))
                )}
              </div>

              {interactionLogs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setInteractionLogs([])}
                  className="btn-3d-secondary dark:bg-none dark:bg-white/10 dark:hover:bg-white/15 dark:border-transparent dark:shadow-none dark:text-[#f5eeff] w-full py-1.5 px-3 rounded-lg text-[11px] font-mono font-semibold transition-colors cursor-pointer"
                >
                  Clear Interactive Events
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
