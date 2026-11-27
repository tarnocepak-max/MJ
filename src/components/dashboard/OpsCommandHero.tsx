import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ClipboardCheck,
  Database,
  Eye,
  Layers,
  LayoutGrid,
  MessageSquare,
  RefreshCw
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

export type OpsCommandViewTab = 'overview' | 'verification' | 'queue';

interface OpsCommandHeroProps {
  activeView: OpsCommandViewTab;
  onChangeView: (view: OpsCommandViewTab) => void;
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
  onDrillDown?: (filterKey: WOKpiFilterKey, filters?: { contractor?: string; area?: string }) => void;
  overviewTopSlot?: React.ReactNode;
}

export const OpsCommandHero: React.FC<OpsCommandHeroProps> = ({
  activeView,
  onChangeView,
  onNavigate,
  onSelectTicket,
  onOpenWhatsApp,
  onDrillDown,
  overviewTopSlot
}) => {
  const {
    currentUser,
    scopedTickets,
    kpiSummary,
    todayWIB,
    databaseStatus,
    refreshDatabaseData,
    kpiContractorFilter,
    kpiAreaFilter,
    setActiveKpiDrilldown,
    setKpiContractorFilter,
    setKpiAreaFilter
  } = useApp();

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

  const handleCloudSyncClick = async () => {
    setIsSyncingNow(true);
    try {
      await refreshDatabaseData();
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
        </div>
      </div>

      {/* TAB 1: ROLE-ADAPTIVE STITCH COMMAND CENTER (Position 1 & 2 Priority Cards first, then Command Workspace) */}
      {activeView === 'overview' && (
        <>
          {overviewTopSlot}
          {currentUser.role === 'dispatch' ? (
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
          )}
        </>
      )}

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
              desktopActionHeader="ACTION"
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
    </section>
  );
};
