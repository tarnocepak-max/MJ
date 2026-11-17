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
import { WOKpiFilterKey, WOKpiSummary } from '../../types';
import { computeClientKpiSummary } from '../../services/woLifecycleService';
import { StatusBadge } from '../common/Badge';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';

interface DashboardKpiSummaryCardsProps {
  onDrillDown: (
    filterKey: WOKpiFilterKey,
    filters?: { contractor?: string; area?: string }
  ) => void;
  onOpenHistoryReport?: () => void;
  compact?: boolean;
  defaultPerspective?: 'overview' | 'vendor' | 'area' | 'leader' | 'installer';
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
  compact = false,
  defaultPerspective = 'overview'
}) => {
  const {
    currentUser,
    tickets,
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
    areasList
  } = useApp();

  const [perspective, setPerspective] = useState<'overview' | 'vendor' | 'area' | 'leader' | 'installer'>(
    defaultPerspective
  );

  const isGlobalRole =
    currentUser.role === 'super_admin' ||
    currentUser.role === 'dispatch' ||
    currentUser.role === 'management_data' ||
    currentUser.role === 'it_support';

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

  const allCards: KpiCardDef[] = useMemo(
    () => [
      {
        key: 'total_today',
        label: isInstaller ? 'Total WO Saya Hari Ini' : 'Total WO Hari Ini',
        sublabel: `Appointment ${todayWIB} (WIB)`,
        value: c.totalToday,
        icon: Layers,
        accentBg: 'bg-[#F5F1FF] dark:bg-[#2E1459]',
        accentText: 'text-[#7135B5] dark:text-[#D8B4FE]',
        borderHover: 'hover:border-[#7135B5]/50'
      },
      {
        key: 'unassigned',
        label: 'Belum Assign',
        sublabel: 'Menunggu Leader pilih teknisi',
        value: c.unassigned,
        icon: UserX,
        accentBg: 'bg-[#F1F5F9] dark:bg-slate-800',
        accentText: 'text-[#475569] dark:text-slate-300',
        borderHover: 'hover:border-slate-400'
      },
      {
        key: 'assigned',
        label: 'Sudah Assign',
        sublabel: 'Teknisi sudah ditugaskan',
        value: c.assigned,
        icon: UserCheck,
        accentBg: 'bg-[#EFF6FF] dark:bg-blue-950/60',
        accentText: 'text-[#1D4ED8] dark:text-blue-300',
        borderHover: 'hover:border-blue-400'
      },
      {
        key: 'not_checked_in',
        label: 'Belum Check-in',
        sublabel: 'Belum kirim chat PROGRESS',
        value: c.notCheckedIn,
        icon: Clock,
        accentBg: 'bg-[#F1F5F9] dark:bg-slate-800',
        accentText: 'text-[#475569] dark:text-slate-300',
        borderHover: 'hover:border-slate-400'
      },
      {
        key: 'checked_in_progress',
        label: 'Sudah Check-in / Progress',
        sublabel: 'Sedang dikerjakan di lapangan',
        value: c.checkedInProgress,
        icon: Activity,
        accentBg: 'bg-[#EFF6FF] dark:bg-blue-950/60',
        accentText: 'text-[#1D4ED8] dark:text-blue-300',
        borderHover: 'hover:border-blue-400'
      },
      {
        key: 'report_pending',
        label: 'Report Pending',
        sublabel: 'Status Pembaruan: PENDING',
        value: c.reportPending,
        icon: FileWarning,
        accentBg: 'bg-[#FEF3C7] dark:bg-amber-950/60',
        accentText: 'text-[#B45309] dark:text-amber-300',
        borderHover: 'hover:border-amber-400'
      },
      {
        key: 'report_complete',
        label: 'Report Complete',
        sublabel: 'Status Pembaruan: COMPLETE',
        value: c.reportComplete,
        icon: CheckCircle2,
        accentBg: 'bg-[#ECFDF5] dark:bg-emerald-950/60',
        accentText: 'text-[#15803D] dark:text-emerald-300',
        borderHover: 'hover:border-emerald-400'
      },
      {
        key: 'report_reschedule',
        label: 'Report Reschedule',
        sublabel: 'Status Pembaruan: RESCHEDULE',
        value: c.reportReschedule,
        icon: CalendarClock,
        accentBg: 'bg-[#F5F1FF] dark:bg-purple-950/60',
        accentText: 'text-[#6D28D9] dark:text-purple-300',
        borderHover: 'hover:border-purple-400'
      },
      {
        key: 'report_cancel',
        label: 'Report Cancel',
        sublabel: 'Status Pembaruan: CANCEL',
        value: c.reportCancel,
        icon: XCircle,
        accentBg: 'bg-[#FEF2F2] dark:bg-rose-950/60',
        accentText: 'text-[#B91C1C] dark:text-rose-300',
        borderHover: 'hover:border-rose-400'
      },
      {
        key: 'butuh_approval',
        label: 'Butuh Approval',
        sublabel: 'Antrean review Dispatch',
        value: c.butuhApproval,
        icon: ClipboardCheck,
        accentBg: 'bg-[#FFF7ED] dark:bg-orange-950/60',
        accentText: 'text-[#C2410C] dark:text-orange-300',
        borderHover: 'hover:border-orange-400'
      },
      {
        key: 'approved',
        label: 'Approved',
        sublabel: 'Disetujui Dispatch',
        value: c.approved,
        icon: CheckCircle2,
        accentBg: 'bg-[#ECFDF5] dark:bg-emerald-950/60',
        accentText: 'text-[#15803D] dark:text-emerald-300',
        borderHover: 'hover:border-emerald-400'
      },
      {
        key: 'revision_rejected',
        label: 'Revisi / Rejected',
        sublabel: 'Dikembalikan ke teknisi',
        value: c.revisionRejected,
        icon: RotateCcw,
        accentBg: 'bg-[#FEF2F2] dark:bg-rose-950/60',
        accentText: 'text-[#B91C1C] dark:text-rose-300',
        borderHover: 'hover:border-rose-400'
      },
      {
        key: 'closed',
        label: 'Closed',
        sublabel: 'WO resmi ditutup',
        value: c.closed,
        icon: Lock,
        accentBg: 'bg-[#334155] dark:bg-slate-900',
        accentText: 'text-white',
        borderHover: 'hover:border-slate-600'
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

  const handleCardClick = (filterKey: WOKpiFilterKey) => {
    onDrillDown(filterKey, {
      contractor: kpiContractorFilter !== 'ALL' ? kpiContractorFilter : undefined,
      area: kpiAreaFilter !== 'ALL' ? kpiAreaFilter : undefined
    });
  };

  return (
    <section aria-label="WO Lifecycle KPI Summary" className="space-y-4">
      {/* Dark Plum-Indigo Tactile Command Banner */}
      <div className="rounded-xl bg-[#342b4e] dark:bg-[#160D29] text-white p-4 sm:p-5 border border-[#4f4273] dark:border-[#3E246F] shadow-[0_4px_0_#1f1638,0_12px_24px_-6px_rgba(31,22,56,0.22)]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10.5px] font-bold bg-[#7135B5] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_0_#35105e]">
                <Activity className="w-3.5 h-3.5" />
                <span>WO Lifecycle Live KPI</span>
              </span>
              <span className="text-xs font-mono tabular-nums text-[#dab9ff]">
                WIB: {todayWIB}
              </span>
              {isKpiLoading && (
                <span className="text-[11px] text-[#dab9ff]/80 inline-flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Menyinkronkan...
                </span>
              )}
            </div>
            <h2 className="font-display text-base sm:text-lg font-extrabold tracking-tight text-white">
              Monitoring Status Operasional &amp; Approval Work Order
            </h2>
            <p className="text-xs text-[#f5eeff]/80">
              Klik kartu KPI manapun untuk drill-down langsung ke daftar Work Order yang sesuai.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Vendor & Area Filters */}
            {isGlobalRole ? (
              <>
                <div className="relative w-full sm:w-auto">
                  <Building2 className="w-3.5 h-3.5 text-[#dab9ff] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    aria-label="Filter Vendor Kontraktor"
                    value={kpiContractorFilter}
                    onChange={(e) => setKpiContractorFilter(e.target.value)}
                    className="w-full sm:w-auto pl-8 pr-7 py-2 min-h-[38px] rounded-xl bg-[#1f1638]/75 border border-white/15 shadow-inner text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-[#a380fe]"
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
                  <MapPin className="w-3.5 h-3.5 text-[#dab9ff] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    aria-label="Filter Area"
                    value={kpiAreaFilter}
                    onChange={(e) => setKpiAreaFilter(e.target.value)}
                    className="w-full sm:w-auto pl-8 pr-7 py-2 min-h-[38px] rounded-xl bg-[#1f1638]/75 border border-white/15 shadow-inner text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-[#a380fe]"
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
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1f1638]/75 border border-white/15 text-xs text-[#f5eeff]">
                <Filter className="w-3.5 h-3.5 text-[#dab9ff]" />
                <span>
                  Scope:{' '}
                  <strong className="text-white">
                    {currentUser.contractor || 'Semua Vendor'} {currentUser.area ? `· ${currentUser.area}` : ''}
                  </strong>
                </span>
              </div>
            )}

            {onOpenHistoryReport && (
              <button
                type="button"
                onClick={onOpenHistoryReport}
                className="mj-tactile-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs cursor-pointer whitespace-nowrap"
              >
                <History className="w-3.5 h-3.5" />
                <span>History Progress</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => refreshKpiSummary()}
              disabled={isKpiLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1f1638]/80 hover:bg-[#1f1638] border border-white/15 shadow-[0_3px_0_#160d29] active:translate-y-[2px] active:shadow-[0_1px_0_#160d29] text-xs font-bold text-[#f5eeff] transition-all cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isKpiLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Perspective Tabs (for non-installer roles) */}
        {!isInstaller && !compact && (
          <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'overview', label: '13 KPI Summary Cards', icon: Layers },
                { id: 'vendor', label: `Perspektif Vendor / Kontraktor (${effectiveSummary.byVendor.length})`, icon: Building2 },
                { id: 'area', label: `Per Area (${effectiveSummary.byArea.length})`, icon: MapPin },
                { id: 'leader', label: `Per Leader (${effectiveSummary.byLeader.length})`, icon: Users },
                { id: 'installer', label: `Per Teknisi (${effectiveSummary.byInstaller.length})`, icon: UserCheck }
              ] as const
            ).map(tab => {
              const Icon = tab.icon;
              const active = perspective === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPerspective(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white text-[#1f1638] shadow-[0_3px_0_#cec3d4]'
                      : 'bg-[#1f1638]/55 text-[#dab9ff] hover:bg-white/10 hover:text-white'
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
        <div className="rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] px-4 py-3 flex items-center justify-between gap-3 text-xs text-[#B91C1C]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Sinkronisasi KPI backend tertunda ({kpiError}). Menampilkan perhitungan sinkron lokal.</span>
          </div>
          <button
            type="button"
            onClick={() => refreshKpiSummary()}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#FCA5A5] font-semibold hover:bg-rose-50"
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
          className="w-full text-left rounded-xl bg-[#FFF7ED] dark:bg-orange-950/40 border border-[#FDBA74] dark:border-orange-800 px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#FFEDD5] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#C2410C]/10 text-[#C2410C] flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#9A3412] dark:text-orange-200">
                {c.unmappedDistribution} Work Order Belum Terdistribusi ke Leader
              </p>
              <p className="text-[11px] text-[#C2410C] dark:text-orange-300">
                Mapping Vendor + Area belum menemukan Leader aktif. Klik untuk meninjau & mendistribusikan manual.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-[#C2410C] shrink-0">
            Lihat Antrean <ChevronRight className="w-4 h-4" />
          </span>
        </button>
      )}

      {/* Perspective: 13 KPI Summary Cards */}
      {perspective === 'overview' && (
        <div
          className={`grid gap-3 ${
            isInstaller
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
              : compact
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7'
              : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7'
          }`}
        >
          {visibleCards.map(card => {
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => handleCardClick(card.key)}
                className={`mj-tactile-card group text-left border border-[#e8ddff] dark:border-[#3b1d78] p-3.5 transition-all hover:shadow-md active:translate-y-[2px] cursor-pointer ${card.borderHover} focus:outline-none focus:ring-2 focus:ring-[#7135B5] min-h-[96px] flex flex-col justify-between`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#4b4452] dark:text-[#cabde8] leading-snug">
                    {card.label}
                  </span>
                  <span
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${card.accentBg} ${card.accentText}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-extrabold tracking-tight text-[#1f1638] dark:text-white font-mono tabular-nums">
                    {card.value}
                  </span>
                  <span className="text-[10px] font-bold text-[#7135B5] dark:text-[#dab9ff] opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center">
                    Detail <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[#7d7484] dark:text-[#cabde8]/80 truncate">
                  {card.sublabel}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Perspective: Vendor / Kontraktor Breakdown */}
      {perspective === 'vendor' && (
        <div className="space-y-2.5">
          <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] px-4 py-3 bg-[#f8f1ff] dark:bg-[#1a0f30] flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-[#1f1638] dark:text-white">
                Ringkasan Operasional Per Vendor / Kontraktor
              </h3>
              <p className="text-[11px] text-[#4b4452] dark:text-[#cabde8]">
                Klik nama Vendor atau angka untuk filter &amp; drill-down daftar WO Vendor tersebut.
              </p>
            </div>
          </div>

          <ResponsiveDataTable
            data={effectiveSummary.byVendor}
            getRowKey={row => row.contractorName}
            mobileTitle={row => row.contractorName}
            mobileSubtitle={row => `${row.total} Total WO • ${row.closed} Closed`}
            mobileStatus={row =>
              row.unmapped > 0 ? (
                <span className="px-2 py-0.5 rounded bg-[#FFF7ED] text-[#C2410C] text-[10px] font-bold">
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
              description: `Belum ada data Work Order untuk tanggal operasional ${todayWIB}.`
            }}
            columns={
              [
                {
                  key: 'contractorName',
                  label: 'Vendor / Kontraktor',
                  priority: 'hidden_mobile',
                  tdClassName: 'font-semibold text-[#160D29] dark:text-white',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('total_today', { contractor: row.contractorName })}
                      className="text-left hover:text-[#7135B5] hover:underline flex items-center gap-2 cursor-pointer"
                    >
                      <span>{row.contractorName}</span>
                      {row.unmapped > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-[#FFF7ED] text-[#C2410C] text-[10px] font-bold">
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
                  priority: 'primary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('checked_in_progress', { contractor: row.contractorName })}
                      className="text-[#1D4ED8] dark:text-blue-300 font-semibold hover:underline cursor-pointer"
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
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('report_pending', { contractor: row.contractorName })}
                      className="text-[#B45309] dark:text-amber-300 font-semibold hover:underline cursor-pointer"
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
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('report_complete', { contractor: row.contractorName })}
                      className="text-[#15803D] dark:text-emerald-300 font-semibold hover:underline cursor-pointer"
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
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('report_reschedule', { contractor: row.contractorName })}
                      className="text-[#6D28D9] dark:text-purple-300 font-semibold hover:underline cursor-pointer"
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
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('report_cancel', { contractor: row.contractorName })}
                      className="text-[#B91C1C] dark:text-rose-300 font-semibold hover:underline cursor-pointer"
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
                  priority: 'primary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('butuh_approval', { contractor: row.contractorName })}
                      className="text-[#C2410C] dark:text-orange-300 font-bold hover:underline cursor-pointer"
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
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('approved', { contractor: row.contractorName })}
                      className="text-[#15803D] dark:text-emerald-300 font-semibold hover:underline cursor-pointer"
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
                  priority: 'secondary',
                  render: row => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('revision_rejected', { contractor: row.contractorName })}
                      className="text-[#B91C1C] dark:text-rose-300 font-semibold hover:underline cursor-pointer"
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
          <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] px-4 py-3 bg-[#f8f1ff] dark:bg-[#1a0f30]">
            <h3 className="font-display text-sm font-bold text-[#1f1638] dark:text-white">
              Ringkasan Per Area / Wilayah
            </h3>
          </div>
          <ResponsiveDataTable
            data={effectiveSummary.byArea}
            getRowKey={a => a.area}
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
                  render: a => (
                    <button
                      type="button"
                      onClick={() => onDrillDown('total_today', { area: a.area })}
                      className="font-semibold text-[#160D29] dark:text-white hover:text-[#7135B5] hover:underline cursor-pointer"
                    >
                      {a.area}
                    </button>
                  )
                },
                { key: 'total', label: 'Total', align: 'right', numeric: true, priority: 'primary', render: a => <strong>{a.total}</strong> },
                { key: 'unassigned', label: 'Belum Assign', align: 'right', numeric: true, priority: 'secondary', render: a => a.unassigned },
                {
                  key: 'progress',
                  label: 'Progress',
                  align: 'right',
                  numeric: true,
                  priority: 'primary',
                  render: a => <span className="text-[#1D4ED8] dark:text-blue-300 font-semibold">{a.checkedInProgress}</span>
                },
                {
                  key: 'butuhApproval',
                  label: 'Butuh Approval',
                  align: 'right',
                  numeric: true,
                  priority: 'primary',
                  render: a => <span className="text-[#C2410C] dark:text-orange-300 font-bold">{a.butuhApproval}</span>
                },
                {
                  key: 'approved',
                  label: 'Approved',
                  align: 'right',
                  numeric: true,
                  priority: 'secondary',
                  render: a => <span className="text-[#15803D] dark:text-emerald-300 font-semibold">{a.approved}</span>
                },
                { key: 'closed', label: 'Closed', align: 'right', numeric: true, priority: 'primary', render: a => <strong>{a.closed}</strong> }
              ] as ResponsiveColumn<(typeof effectiveSummary.byArea)[number]>[]
            }
          />
        </div>
      )}

      {/* Perspective: Leader Breakdown */}
      {perspective === 'leader' && (
        <div className="space-y-2.5">
          <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] px-4 py-3 bg-[#f8f1ff] dark:bg-[#1a0f30]">
            <h3 className="font-display text-sm font-bold text-[#1f1638] dark:text-white">
              Distribusi &amp; Beban Kerja Leader
            </h3>
          </div>
          <ResponsiveDataTable
            data={effectiveSummary.byLeader}
            getRowKey={(l, idx) => `${l.leaderName}_${idx}`}
            mobileTitle={l => l.leaderName}
            mobileSubtitle={l => l.contractorName}
            emptyState={{
              title: 'Belum ada data Leader',
              description: `Belum ada data Leader untuk ${todayWIB}.`
            }}
            columns={
              [
                { key: 'leaderName', label: 'Leader', priority: 'hidden_mobile', tdClassName: 'font-semibold text-[#160D29] dark:text-white', render: l => l.leaderName },
                { key: 'contractorName', label: 'Vendor', priority: 'hidden_mobile', tdClassName: 'text-[#475569] dark:text-slate-300', render: l => l.contractorName },
                { key: 'total', label: 'Total', align: 'right', numeric: true, priority: 'primary', render: l => <strong>{l.total}</strong> },
                { key: 'unassigned', label: 'Belum Assign', align: 'right', numeric: true, priority: 'secondary', render: l => l.unassigned },
                { key: 'assigned', label: 'Assigned', align: 'right', numeric: true, priority: 'secondary', render: l => <span className="text-[#1D4ED8] dark:text-blue-300">{l.assigned}</span> },
                { key: 'checkedInProgress', label: 'Progress', align: 'right', numeric: true, priority: 'primary', render: l => <span className="text-[#1D4ED8] dark:text-blue-300 font-semibold">{l.checkedInProgress}</span> },
                { key: 'butuhApproval', label: 'Butuh Approval', align: 'right', numeric: true, priority: 'primary', render: l => <span className="text-[#C2410C] dark:text-orange-300 font-bold">{l.butuhApproval}</span> },
                { key: 'closed', label: 'Closed', align: 'right', numeric: true, priority: 'primary', render: l => <strong>{l.closed}</strong> }
              ] as ResponsiveColumn<(typeof effectiveSummary.byLeader)[number]>[]
            }
          />
        </div>
      )}

      {/* Perspective: Installer Breakdown */}
      {perspective === 'installer' && (
        <div className="space-y-2.5">
          <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] px-4 py-3 bg-[#f8f1ff] dark:bg-[#1a0f30]">
            <h3 className="font-display text-sm font-bold text-[#1f1638] dark:text-white">
              Produktivitas &amp; Status Pekerjaan Teknisi
            </h3>
          </div>
          <ResponsiveDataTable
            data={effectiveSummary.byInstaller}
            getRowKey={(inst, idx) => `${inst.installerName}_${idx}`}
            mobileTitle={inst => inst.installerName}
            mobileSubtitle={inst => `${inst.contractorName} • ${inst.area}`}
            mobileStatus={inst => <StatusBadge status={inst.closed > 0 ? 'CLOSED' : 'PROGRESS'} size="xs" />}
            emptyState={{
              title: 'Belum ada teknisi yang di-assign',
              description: `Belum ada teknisi yang di-assign untuk ${todayWIB}.`
            }}
            columns={
              [
                { key: 'installerName', label: 'Teknisi / Installer', priority: 'hidden_mobile', tdClassName: 'font-semibold text-[#160D29] dark:text-white', render: inst => inst.installerName },
                { key: 'contractorName', label: 'Vendor', priority: 'secondary', tdClassName: 'text-[#475569] dark:text-slate-300', render: inst => inst.contractorName },
                { key: 'area', label: 'Area', priority: 'secondary', tdClassName: 'text-[#475569] dark:text-slate-300', render: inst => inst.area },
                { key: 'total', label: 'Total WO', align: 'right', numeric: true, priority: 'primary', render: inst => <strong>{inst.total}</strong> },
                { key: 'progress', label: 'Progress', align: 'right', numeric: true, priority: 'primary', render: inst => <span className="text-[#1D4ED8] dark:text-blue-300 font-semibold">{inst.checkedInProgress}</span> },
                { key: 'butuhApproval', label: 'Butuh Approval', align: 'right', numeric: true, priority: 'primary', render: inst => <span className="text-[#C2410C] dark:text-orange-300 font-bold">{inst.butuhApproval}</span> },
                { key: 'approved', label: 'Approved', align: 'right', numeric: true, priority: 'secondary', render: inst => <span className="text-[#15803D] dark:text-emerald-300 font-semibold">{inst.approved}</span> },
                { key: 'revisionRejected', label: 'Revisi', align: 'right', numeric: true, priority: 'secondary', render: inst => <span className="text-[#B91C1C] dark:text-rose-300 font-semibold">{inst.revisionRejected}</span> },
                {
                  key: 'closed',
                  label: 'Closed',
                  align: 'right',
                  numeric: true,
                  priority: 'primary',
                  render: inst => (
                    <div className="inline-flex items-center gap-1.5">
                      <StatusBadge status={inst.closed > 0 ? 'CLOSED' : 'PROGRESS'} size="xs" />
                      <strong>{inst.closed}</strong>
                    </div>
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
