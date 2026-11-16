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
      {/* Dark Purple Gloss Header Strip */}
      <div className="rounded-2xl bg-[#160D29] text-white p-4 sm:p-5 border border-[#3E246F] shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#7135B5]/40 text-[#E9D5FF] border border-[#9F67EA]/40">
                <Activity className="w-3.5 h-3.5" />
                <span>WO Lifecycle Live KPI</span>
              </span>
              <span className="text-xs font-mono tabular-nums text-purple-200/80">
                WIB: {todayWIB}
              </span>
              {isKpiLoading && (
                <span className="text-[11px] text-purple-200/70 inline-flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Menyinkronkan...
                </span>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-white">
              Monitoring Status Operasional & Approval Work Order
            </h2>
            <p className="text-xs text-purple-200/80">
              Klik kartu KPI manapun untuk drill-down langsung ke daftar Work Order yang sesuai.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Vendor & Area Filters */}
            {isGlobalRole ? (
              <>
                <div className="relative">
                  <Building2 className="w-3.5 h-3.5 text-purple-300 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    aria-label="Filter Vendor Kontraktor"
                    value={kpiContractorFilter}
                    onChange={(e) => setKpiContractorFilter(e.target.value)}
                    className="pl-8 pr-7 py-2 rounded-xl bg-[#241442] border border-[#4E2F8A] text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-[#9F67EA]"
                  >
                    <option value="ALL">Semua Vendor / Kontraktor</option>
                    {contractorsList.map(vendor => (
                      <option key={vendor} value={vendor}>
                        {vendor}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="relative">
                  <MapPin className="w-3.5 h-3.5 text-purple-300 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    aria-label="Filter Area"
                    value={kpiAreaFilter}
                    onChange={(e) => setKpiAreaFilter(e.target.value)}
                    className="pl-8 pr-7 py-2 rounded-xl bg-[#241442] border border-[#4E2F8A] text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-[#9F67EA]"
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
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#241442] border border-[#4E2F8A] text-xs text-purple-100">
                <Filter className="w-3.5 h-3.5 text-purple-300" />
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
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#7135B5] hover:bg-[#8244CB] text-xs font-semibold text-white transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                <span>History Progress</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => refreshKpiSummary()}
              disabled={isKpiLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#241442] hover:bg-[#311C59] border border-[#4E2F8A] text-xs font-semibold text-purple-100 transition-colors disabled:opacity-60"
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
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-white text-[#160D29]'
                      : 'bg-white/5 text-purple-200 hover:bg-white/10 hover:text-white'
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
                className={`group text-left rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 p-3.5 transition-all hover:shadow-md ${card.borderHover} focus:outline-none focus:ring-2 focus:ring-[#7135B5] min-h-[96px] flex flex-col justify-between`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-semibold text-[#475569] dark:text-slate-300 leading-snug">
                    {card.label}
                  </span>
                  <span
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${card.accentBg} ${card.accentText}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-extrabold tracking-tight text-[#160D29] dark:text-white font-mono tabular-nums">
                    {card.value}
                  </span>
                  <span className="text-[10px] font-semibold text-[#7135B5] dark:text-purple-300 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center">
                    Detail <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[#64748B] dark:text-slate-400 truncate">
                  {card.sublabel}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Perspective: Vendor / Kontraktor Breakdown */}
      {perspective === 'vendor' && (
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-[#E2E8F0] dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#160D29] dark:text-white">
                Ringkasan Operasional Per Vendor / Kontraktor
              </h3>
              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                Klik baris Vendor atau angka untuk filter & drill-down daftar WO Vendor tersebut.
              </p>
            </div>
          </div>
          {effectiveSummary.byVendor.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Belum ada data Work Order untuk tanggal operasional {todayWIB}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F8FAFC] dark:bg-slate-800/40 text-[11px] uppercase tracking-wider text-[#475569] dark:text-slate-400 border-b border-[#E2E8F0] dark:border-slate-800">
                    <th className="py-2.5 px-3 font-bold">Vendor / Kontraktor</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Total</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Belum Assign</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Progress</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Pending</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Complete</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Reschedule</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Cancel</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Butuh Approval</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Approved</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Revisi</th>
                    <th className="py-2.5 px-2.5 text-right font-bold">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800 tabular-nums">
                  {effectiveSummary.byVendor.map(row => (
                    <tr
                      key={row.contractorName}
                      className="hover:bg-[#F5F1FF]/60 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-semibold text-[#160D29] dark:text-white">
                        <button
                          type="button"
                          onClick={() =>
                            onDrillDown('total_today', {
                              contractor: row.contractorName
                            })
                          }
                          className="text-left hover:text-[#7135B5] hover:underline flex items-center gap-2"
                        >
                          <span>{row.contractorName}</span>
                          {row.unmapped > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-[#FFF7ED] text-[#C2410C] text-[10px] font-bold">
                              {row.unmapped} Unmapped
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-bold text-[#160D29] dark:text-white">
                        <button
                          type="button"
                          onClick={() => onDrillDown('total_today', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.total}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#475569] dark:text-slate-300">
                        <button
                          type="button"
                          onClick={() => onDrillDown('unassigned', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.unassigned}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#1D4ED8] font-semibold">
                        <button
                          type="button"
                          onClick={() => onDrillDown('checked_in_progress', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.checkedInProgress}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#B45309] font-semibold">
                        <button
                          type="button"
                          onClick={() => onDrillDown('report_pending', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.reportPending}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#15803D] font-semibold">
                        <button
                          type="button"
                          onClick={() => onDrillDown('report_complete', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.reportComplete}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#6D28D9] font-semibold">
                        <button
                          type="button"
                          onClick={() => onDrillDown('report_reschedule', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.reportReschedule}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#B91C1C] font-semibold">
                        <button
                          type="button"
                          onClick={() => onDrillDown('report_cancel', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.reportCancel}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#C2410C] font-bold">
                        <button
                          type="button"
                          onClick={() => onDrillDown('butuh_approval', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.butuhApproval}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#15803D] font-semibold">
                        <button
                          type="button"
                          onClick={() => onDrillDown('approved', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.approved}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-[#B91C1C] font-semibold">
                        <button
                          type="button"
                          onClick={() => onDrillDown('revision_rejected', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.revisionRejected}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-bold text-[#334155] dark:text-slate-200">
                        <button
                          type="button"
                          onClick={() => onDrillDown('closed', { contractor: row.contractorName })}
                          className="hover:underline"
                        >
                          {row.closed}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Perspective: Area Breakdown */}
      {perspective === 'area' && (
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-[#E2E8F0] dark:border-slate-800">
            <h3 className="text-sm font-bold text-[#160D29] dark:text-white">Ringkasan Per Area / Wilayah</h3>
          </div>
          {effectiveSummary.byArea.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">Belum ada data area untuk {todayWIB}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F8FAFC] dark:bg-slate-800/40 text-[11px] uppercase text-[#475569] border-b border-[#E2E8F0]">
                    <th className="py-2.5 px-3 font-bold">Area</th>
                    <th className="py-2.5 px-3 text-right font-bold">Total</th>
                    <th className="py-2.5 px-3 text-right font-bold">Belum Assign</th>
                    <th className="py-2.5 px-3 text-right font-bold">Progress</th>
                    <th className="py-2.5 px-3 text-right font-bold">Butuh Approval</th>
                    <th className="py-2.5 px-3 text-right font-bold">Approved</th>
                    <th className="py-2.5 px-3 text-right font-bold">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800 tabular-nums">
                  {effectiveSummary.byArea.map(a => (
                    <tr key={a.area} className="hover:bg-[#F5F1FF]/50">
                      <td className="py-2.5 px-3 font-semibold text-[#160D29] dark:text-white">
                        <button
                          type="button"
                          onClick={() => onDrillDown('total_today', { area: a.area })}
                          className="hover:text-[#7135B5] hover:underline"
                        >
                          {a.area}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold">{a.total}</td>
                      <td className="py-2.5 px-3 text-right text-[#475569]">{a.unassigned}</td>
                      <td className="py-2.5 px-3 text-right text-[#1D4ED8] font-semibold">{a.checkedInProgress}</td>
                      <td className="py-2.5 px-3 text-right text-[#C2410C] font-bold">{a.butuhApproval}</td>
                      <td className="py-2.5 px-3 text-right text-[#15803D] font-semibold">{a.approved}</td>
                      <td className="py-2.5 px-3 text-right font-bold">{a.closed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Perspective: Leader Breakdown */}
      {perspective === 'leader' && (
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-[#E2E8F0] dark:border-slate-800">
            <h3 className="text-sm font-bold text-[#160D29] dark:text-white">Distribusi & Beban Kerja Leader</h3>
          </div>
          {effectiveSummary.byLeader.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">Belum ada data Leader untuk {todayWIB}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F8FAFC] dark:bg-slate-800/40 text-[11px] uppercase text-[#475569] border-b border-[#E2E8F0]">
                    <th className="py-2.5 px-3 font-bold">Leader</th>
                    <th className="py-2.5 px-3 font-bold">Vendor</th>
                    <th className="py-2.5 px-3 text-right font-bold">Total</th>
                    <th className="py-2.5 px-3 text-right font-bold">Belum Assign</th>
                    <th className="py-2.5 px-3 text-right font-bold">Assigned</th>
                    <th className="py-2.5 px-3 text-right font-bold">Progress</th>
                    <th className="py-2.5 px-3 text-right font-bold">Butuh Approval</th>
                    <th className="py-2.5 px-3 text-right font-bold">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800 tabular-nums">
                  {effectiveSummary.byLeader.map((l, idx) => (
                    <tr key={`${l.leaderName}_${idx}`} className="hover:bg-[#F5F1FF]/50">
                      <td className="py-2.5 px-3 font-semibold text-[#160D29] dark:text-white">{l.leaderName}</td>
                      <td className="py-2.5 px-3 text-[#475569] dark:text-slate-300">{l.contractorName}</td>
                      <td className="py-2.5 px-3 text-right font-bold">{l.total}</td>
                      <td className="py-2.5 px-3 text-right">{l.unassigned}</td>
                      <td className="py-2.5 px-3 text-right text-[#1D4ED8]">{l.assigned}</td>
                      <td className="py-2.5 px-3 text-right text-[#1D4ED8] font-semibold">{l.checkedInProgress}</td>
                      <td className="py-2.5 px-3 text-right text-[#C2410C] font-bold">{l.butuhApproval}</td>
                      <td className="py-2.5 px-3 text-right font-bold">{l.closed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Perspective: Installer Breakdown */}
      {perspective === 'installer' && (
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-[#E2E8F0] dark:border-slate-800">
            <h3 className="text-sm font-bold text-[#160D29] dark:text-white">Produktivitas & Status Pekerjaan Teknisi</h3>
          </div>
          {effectiveSummary.byInstaller.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">Belum ada teknisi yang di-assign untuk {todayWIB}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F8FAFC] dark:bg-slate-800/40 text-[11px] uppercase text-[#475569] border-b border-[#E2E8F0]">
                    <th className="py-2.5 px-3 font-bold">Teknisi / Installer</th>
                    <th className="py-2.5 px-3 font-bold">Vendor</th>
                    <th className="py-2.5 px-3 font-bold">Area</th>
                    <th className="py-2.5 px-3 text-right font-bold">Total WO</th>
                    <th className="py-2.5 px-3 text-right font-bold">Progress</th>
                    <th className="py-2.5 px-3 text-right font-bold">Butuh Approval</th>
                    <th className="py-2.5 px-3 text-right font-bold">Approved</th>
                    <th className="py-2.5 px-3 text-right font-bold">Revisi</th>
                    <th className="py-2.5 px-3 text-right font-bold">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800 tabular-nums">
                  {effectiveSummary.byInstaller.map((inst, idx) => (
                    <tr key={`${inst.installerName}_${idx}`} className="hover:bg-[#F5F1FF]/50">
                      <td className="py-2.5 px-3 font-semibold text-[#160D29] dark:text-white">{inst.installerName}</td>
                      <td className="py-2.5 px-3 text-[#475569] dark:text-slate-300">{inst.contractorName}</td>
                      <td className="py-2.5 px-3 text-[#475569] dark:text-slate-300">{inst.area}</td>
                      <td className="py-2.5 px-3 text-right font-bold">{inst.total}</td>
                      <td className="py-2.5 px-3 text-right text-[#1D4ED8] font-semibold">{inst.checkedInProgress}</td>
                      <td className="py-2.5 px-3 text-right text-[#C2410C] font-bold">{inst.butuhApproval}</td>
                      <td className="py-2.5 px-3 text-right text-[#15803D] font-semibold">{inst.approved}</td>
                      <td className="py-2.5 px-3 text-right text-[#B91C1C] font-semibold">{inst.revisionRejected}</td>
                      <td className="py-2.5 px-3 text-right font-bold">
                        <StatusBadge status={inst.closed > 0 ? 'CLOSED' : 'PROGRESS'} size="xs" />
                        <span className="ml-1.5">{inst.closed}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
