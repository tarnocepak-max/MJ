import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  Building2,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  Info,
  MailWarning,
  MapPin,
  MessageSquare,
  PhoneCall,
  Printer,
  Radio,
  RefreshCw,
  Sliders,
  Wallet,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { supabaseDb } from '../../services/supabaseDb';
import type { Ticket } from '../../types/index';
import type {
  SlaActionType,
  SlaBreachTicketItem,
  SlaPeriod,
  SlaTelemetryPayload,
  SlaThresholdConfig,
  SlaVendorRow
} from '../../types/sla';
import {
  executeSlaAction,
  exportSlaScorecardXlsx,
  fetchSlaTelemetry,
  saveSlaConfig
} from '../../services/slaService';
import { SlaConfigModal } from './SlaConfigModal';
import {
  SlaGovernanceActionModal,
  VendorWoDrilldownModal,
  type SlaActionModalContext
} from './SlaActionModals';

export type SlaDashboardContext = 'dashboard_monitoring' | 'sla_monitoring';

interface SlaTelemetryDashboardViewProps {
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onNavigate?: (tab: string) => void;
  viewContext?: SlaDashboardContext;
}

function formatRupiah(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const formatted = new Intl.NumberFormat('id-ID').format(abs);
  if (amount > 0) return `+Rp ${formatted}`;
  if (amount < 0) return `-Rp ${formatted}`;
  return 'Rp 0';
}

function formatWibClock(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  } catch {
    return date.toTimeString().slice(0, 8);
  }
}

function getTierStyles(tier: SlaVendorRow['slaStatus']) {
  switch (tier) {
    case 'EXCELLENT':
      return {
        badge: 'bg-[#16A36A] text-white',
        bar: 'bg-[#16A36A]',
        text: 'text-[#16A36A] dark:text-emerald-400',
        rank: 'bg-[#16A36A]/20 text-[#16A36A] dark:bg-emerald-950/60 dark:text-emerald-300',
        iconBox: 'bg-[#5B35B1]/10 text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]',
        rowBg: 'hover:bg-[#F5F1FF] dark:hover:bg-[#160D29]/60'
      };
    case 'GOOD':
      return {
        badge: 'bg-[#16A36A]/20 text-[#16A36A] dark:bg-emerald-950/60 dark:text-emerald-300',
        bar: 'bg-[#16A36A]/85',
        text: 'text-[#16A36A] dark:text-emerald-400',
        rank: 'bg-[#F4EAFF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]',
        iconBox: 'bg-[#F4EAFF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]',
        rowBg: 'hover:bg-[#F5F1FF] dark:hover:bg-[#160D29]/60'
      };
    case 'WARNING':
      return {
        badge: 'bg-[#E59A27] text-white',
        bar: 'bg-[#E59A27]',
        text: 'text-[#E59A27] dark:text-amber-400',
        rank: 'bg-[#E59A27]/20 text-[#E59A27] dark:bg-amber-950/60 dark:text-amber-300',
        iconBox: 'bg-[#E59A27]/15 text-[#E59A27] dark:bg-amber-950/50 dark:text-amber-300',
        rowBg: 'bg-[#E59A27]/5 hover:bg-[#F5F1FF] dark:bg-amber-950/10 dark:hover:bg-[#160D29]/60'
      };
    case 'CRITICAL':
      return {
        badge: 'bg-[#DC4C5A] text-white',
        bar: 'bg-[#DC4C5A]',
        text: 'text-[#DC4C5A] dark:text-rose-400',
        rank: 'bg-[#DC4C5A]/20 text-[#DC4C5A] dark:bg-rose-950/60 dark:text-rose-300',
        iconBox: 'bg-[#DC4C5A]/15 text-[#DC4C5A] dark:bg-rose-950/50 dark:text-rose-300',
        rowBg: 'bg-[#DC4C5A]/5 hover:bg-[#F5F1FF] dark:bg-rose-950/10 dark:hover:bg-[#160D29]/60'
      };
    default:
      return {
        badge: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
        bar: 'bg-slate-300 dark:bg-slate-700',
        text: 'text-[#766B83] dark:text-slate-400',
        rank: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
        iconBox: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300',
        rowBg: 'hover:bg-[#F5F1FF] dark:hover:bg-[#160D29]/60'
      };
  }
}

export const SlaTelemetryDashboardView: React.FC<SlaTelemetryDashboardViewProps> = ({
  onSelectTicket,
  onNavigate,
  viewContext = 'sla_monitoring'
}) => {
  const { currentUser, scopedTickets, refreshDatabaseData, databaseStatus } = useApp();
  const { toast } = useToast();

  const isLeader = currentUser.role === 'leader';
  const canEditThresholds = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';
  const canRunGovernanceActions = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  const [period, setPeriod] = useState<SlaPeriod>('today');
  const [areaFilter, setAreaFilter] = useState<string>('ALL');
  const [contractorFilter, setContractorFilter] = useState<string>('ALL');
  const [autoSync, setAutoSync] = useState<boolean>(true);

  const [telemetry, setTelemetry] = useState<SlaTelemetryPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  const [sseConnected, setSseConnected] = useState<boolean>(false);

  // Modals & Dropdowns
  const [configModalOpen, setConfigModalOpen] = useState<boolean>(false);
  const [configModalTab, setConfigModalTab] = useState<'thresholds' | 'pks'>('thresholds');
  const [exportMenuOpen, setExportMenuOpen] = useState<boolean>(false);
  const [drilldownVendor, setDrilldownVendor] = useState<SlaVendorRow | null>(null);
  const [actionModalCtx, setActionModalCtx] = useState<SlaActionModalContext | null>(null);
  const [showLogsDrawer, setShowLogsDrawer] = useState<boolean>(false);

  const loadTelemetry = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);
      setErrorMsg(null);
      try {
        const data = await fetchSlaTelemetry({
          period,
          area: areaFilter,
          contractor: isLeader ? 'ALL' : contractorFilter
        });
        setTelemetry(data);
      } catch (err: any) {
        const msg = err?.message || 'Gagal memuat telemetri SLA dari server.';
        setErrorMsg(msg);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [period, areaFilter, contractorFilter, isLeader]
  );

  useEffect(() => {
    loadTelemetry(false);
  }, [loadTelemetry]);

  // Live 1-second tick for countdown timers & WIB clock
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Periodic background poll when autoSync is enabled (every 30s) + SSE realtime change listener
  useEffect(() => {
    if (!autoSync) {
      setSseConnected(false);
      return;
    }

    setSseConnected(true);
    let debounceTimer: number | null = null;
    const scheduleReload = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        loadTelemetry(true);
      }, 600);
    };

    const unsubWo = supabaseDb.subscribeToChanges({ table: 'work_orders', event: '*', onPayload: scheduleReload });
    const unsubMsg = supabaseDb.subscribeToChanges({ table: 'ticket_messages', event: '*', onPayload: scheduleReload });
    const unsubCfg = supabaseDb.subscribeToChanges({ table: 'app_settings', event: '*', onPayload: scheduleReload });
    const unsubContr = supabaseDb.subscribeToChanges({ table: 'contractors', event: '*', onPayload: scheduleReload });

    const pollInterval = window.setInterval(() => {
      loadTelemetry(true);
    }, 30000);

    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      unsubWo();
      unsubMsg();
      unsubCfg();
      unsubContr();
      window.clearInterval(pollInterval);
    };
  }, [autoSync, loadTelemetry]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshDatabaseData(), loadTelemetry(true)]);
      toast.success(
        'Data WO dan metrik kepatuhan vendor berhasil disinkronkan dari database.',
        'Telemetri SLA Diperbarui'
      );
    } catch {
      // loadTelemetry already surfaces errors cleanly
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveThresholds = async (nextConfig: SlaThresholdConfig, notes?: string) => {
    if (!telemetry) return;
    await saveSlaConfig(nextConfig, {
      expectedVersion: telemetry.configVersion,
      forceOverwrite: true,
      notes
    });
    toast.success(
      'Target SLA dan klausul PKS berhasil diperbarui ke database pusat.',
      'Ambang Batas SLA Disimpan'
    );
    await loadTelemetry(true);
  };

  const handleExecuteGovernanceAction = async (payload: Parameters<typeof executeSlaAction>[0]) => {
    await executeSlaAction(payload);
    toast.success(
      `${payload.actionType} berhasil dieksekusi dan disimpan ke Audit Trail.`,
      'Tindakan SLA Tercatat'
    );
    await loadTelemetry(true);
  };

  const handleExportXlsx = () => {
    if (!telemetry) return;
    const filename = exportSlaScorecardXlsx(telemetry);
    setExportMenuOpen(false);
    toast.success(`File ${filename} berhasil diunduh.`, 'Scorecard Excel Diekspor');
  };

  const handlePrintPdf = () => {
    setExportMenuOpen(false);
    window.print();
  };

  const ticketLookupMap = useMemo(() => {
    const map = new Map<string, Ticket>();
    scopedTickets.forEach(t => {
      map.set(t.id, t);
      if (t.woNumber) map.set(t.woNumber, t);
    });
    return map;
  }, [scopedTickets]);

  const getVendorTickets = useCallback(
    (vendor: SlaVendorRow): Ticket[] => {
      return scopedTickets.filter(t => {
        if (t.isDeleted || t.isArchived) return false;
        const tContrId = String(t.contractorId || '').trim();
        const tContrName = String(t.contractorName || t.contactorName || t.vendorName || '').trim().toLowerCase();
        const vName = vendor.contractorName.trim().toLowerCase();
        return (
          (tContrId && tContrId === vendor.contractorId)
          || (tContrName && (tContrName === vName || tContrName.includes(vName) || vName.includes(tContrName)))
        );
      });
    },
    [scopedTickets]
  );

  const handleSelectTicketSafe = useCallback(
    (ticket: Ticket, tab: 'overview' | 'report' | 'chat' | 'history' = 'overview') => {
      if (onSelectTicket) {
        onSelectTicket(ticket, tab);
      } else if (onNavigate) {
        onNavigate('tickets');
      }
    },
    [onSelectTicket, onNavigate]
  );

  const openBreachTicket = (breach: SlaBreachTicketItem, tab: 'overview' | 'chat' = 'overview') => {
    const matched = ticketLookupMap.get(breach.ticketId) || ticketLookupMap.get(breach.woNumber);
    if (matched) {
      handleSelectTicketSafe(matched, tab);
    } else if (onNavigate) {
      onNavigate('tickets');
    } else {
      toast.warning(
        `WO ${breach.woNumber} sedang disinkronkan. Klik Refresh bila belum tampil di daftar tiket.`,
        'Membuka Data WO'
      );
    }
  };

  const openVendorChat = (vendor: SlaVendorRow) => {
    const vendorTickets = getVendorTickets(vendor);
    const activeTicket =
      vendorTickets.find(t => t.statusWOInstaller !== 'Completed' && t.statusWOAgent !== 'Closed') || vendorTickets[0];
    if (activeTicket && onSelectTicket) {
      onSelectTicket(activeTicket, 'chat');
    } else if (onNavigate) {
      onNavigate('contact_centre');
    }
  };

  const triggerBreachAction = (breach: SlaBreachTicketItem, index: number) => {
    let actionType: SlaActionType = 'ESCALATE_DISPATCH';
    let label = 'Eskalasi Dispatch';
    if (breach.issueSummary.toLowerCase().includes('izin') || breach.issueSummary.toLowerCase().includes('security')) {
      actionType = 'BYPASS_PERMIT';
      label = 'Bypass Surat Izin';
    } else if (!breach.workSessionStatus || breach.workSessionStatus === 'Belum Check-in') {
      actionType = 'PING_TECHNICIAN';
      label = 'Ping Teknisi';
    } else if (index % 3 === 2) {
      actionType = 'SEND_ASSISTANCE';
      label = 'Kirim Bantuan';
    }

    return {
      actionType,
      label,
      onClick: () =>
        setActionModalCtx({
          actionType,
          title: `${label} — ${breach.woNumber}`,
          subtitle: `${breach.customerName} (${breach.area})`,
          ticketId: breach.ticketId,
          woNumber: breach.woNumber,
          contractorId: breach.contractorId,
          contractorName: breach.contractorName,
          leaderName: breach.leaderName,
          leaderPhone: breach.leaderPhone,
          targetInstallerName: breach.installerName,
          defaultMessage: `[${label}] Mohon percepatan penanganan ${breach.woNumber} (${breach.customerName}, ${breach.address}). Teknisi: ${breach.installerName}. Status SLA kritis pada slot ${breach.slotTime}.`
        })
    };
  };

  const formatLiveCountdown = (breach: SlaBreachTicketItem): { label: string; isOverdue: boolean; urgent: boolean } => {
    if (breach.slaDeadlineAt) {
      const deadlineMs = Date.parse(breach.slaDeadlineAt);
      if (!Number.isNaN(deadlineMs)) {
        const diffSec = Math.round((deadlineMs - nowTickMs) / 1000);
        const absMin = Math.floor(Math.abs(diffSec) / 60);
        const remSec = Math.abs(diffSec) % 60;
        if (diffSec < 0) {
          return {
            label: `Overdue ${String(absMin).padStart(2, '0')}:${String(remSec).padStart(2, '0')}`,
            isOverdue: true,
            urgent: true
          };
        }
        return {
          label: absMin <= 10 ? `Sisa ${String(absMin).padStart(2, '0')} Mnt!` : `Sisa ${String(absMin).padStart(2, '0')} Mnt`,
          isOverdue: false,
          urgent: absMin <= 10
        };
      }
    }
    return {
      label: breach.isOverdue
        ? `Overdue ${Math.abs(breach.minutesRemaining)} Mnt`
        : breach.minutesRemaining <= 10
        ? `Sisa ${String(Math.max(0, breach.minutesRemaining)).padStart(2, '0')} Mnt!`
        : `Sisa ${String(Math.max(0, breach.minutesRemaining)).padStart(2, '0')} Mnt`,
      isOverdue: breach.isOverdue,
      urgent: breach.isOverdue || breach.minutesRemaining <= 10
    };
  };

  if (isLoading && !telemetry) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-36 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E]" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-36 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E]" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E]" />
      </div>
    );
  }

  if (errorMsg && !telemetry) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 rounded-2xl bg-white dark:bg-[#1E1238] border border-rose-200 dark:border-rose-900/60 shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-[#DC4C5A] flex items-center justify-center mx-auto">
          <AlertOctagon className="w-6 h-6" />
        </div>
        <div>
          <h3 className="font-display font-bold text-base text-[#211A2E] dark:text-white">
            Gagal Memuat SLA Telemetry Engine
          </h3>
          <p className="text-xs text-[#766B83] dark:text-slate-300 mt-1">{errorMsg}</p>
        </div>
        <button
          type="button"
          onClick={() => loadTelemetry(false)}
          className="px-4 py-2 rounded-lg bg-[#431599] hover:bg-[#35105E] text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Coba Muat Ulang
        </button>
      </div>
    );
  }

  if (!telemetry) return null;

  const { kpis, vendorLeaderboard, slotTrend, slotInsights, operationalMatrix, breachQueue, pksLedger } = telemetry;
  const activeVendorCount = telemetry.filterOptions.contractors.length || vendorLeaderboard.length;

  const breadcrumbSection = viewContext === 'dashboard_monitoring' ? 'Operations Core' : 'Contractor & Area';
  const breadcrumbPage =
    viewContext === 'dashboard_monitoring' ? 'Dashboard Monitoring' : 'Monitoring SLA Kontraktor & Vendor';

  return (
    <div className="flex flex-col w-full space-y-4 pb-6">
      {/* 1. INTEGRATED TOP OPERATIONAL SUB-BAR & FILTER TOOLBAR RIBBON */}
      <section className="rounded-xl border border-[#E9E5F0] dark:border-[#35105E] overflow-hidden shadow-sm bg-white dark:bg-[#1E1238]">
        {/* Top Operational Sub-bar */}
        <div className="px-4 sm:px-5 py-3.5 bg-white dark:bg-[#1E1238] border-b border-[#E9E5F0] dark:border-[#35105E] flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#8B8495] dark:text-[#A78BFA]">
              <button
                type="button"
                onClick={() => onNavigate?.('dashboard')}
                className="hover:text-[#431599] transition-colors cursor-pointer"
              >
                MoraJaws
              </button>
              <span>/</span>
              <span>{breadcrumbSection}</span>
              <span>/</span>
              <span className="text-[#431599] dark:text-[#D8B4FE] font-semibold">{breadcrumbPage}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#160D29] dark:text-white leading-tight">
                SLA Telemetry &amp; Vendor Performance Engine
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase ${
                  autoSync
                    ? 'bg-[#16A36A]/10 text-[#16A36A] dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-[#E59A27]/15 text-[#E59A27] dark:bg-amber-950/50 dark:text-amber-300'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${autoSync ? 'bg-[#16A36A] animate-pulse' : 'bg-[#E59A27]'}`} />
                <span>{autoSync ? 'CALCULATION ACTIVE (REAL-TIME)' : 'AUTO-SYNC PAUSED'}</span>
              </div>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#5B35B1]/10 text-[#7135B5] dark:bg-[#35105E] dark:text-[#D8B4FE] text-[11px] font-bold tracking-wide uppercase">
                <Database className="w-3.5 h-3.5" />
                <span>{telemetry.databaseSource === 'supabase' ? 'SUPABASE POSTGRESQL (CLUSTER: JKT-01)' : 'LOCAL DEV STORE'}</span>
              </div>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F4EAFF] text-[#431599] dark:bg-[#35105E]/80 dark:text-[#D8B4FE] text-[11px] font-bold tracking-wide uppercase">
                <Radio className="w-3.5 h-3.5" />
                <span>TARGET GLOBAL: {telemetry.config.globalSlaTarget.toFixed(2)}%</span>
              </div>
            </div>
          </div>

          {/* Quick Action Control Bar */}
          <div className="flex flex-wrap items-center xl:justify-end gap-2 shrink-0 print:hidden">
            <button
              type="button"
              onClick={() => {
                setConfigModalTab('thresholds');
                setConfigModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F4EAFF] hover:bg-[#F0E3FF] dark:bg-[#35105E] dark:hover:bg-[#5B35B1]/60 text-[#35105E] dark:text-white text-[11px] font-bold transition-all shadow-xs cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-[#431599] dark:text-[#D8B4FE]" />
              <span>Ambang Batas SLA</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setExportMenuOpen(prev => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#160D29] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-white border border-[#E9E5F0] dark:border-[#35105E] text-[11px] font-bold transition-all shadow-xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#431599] dark:text-[#A78BFA]" />
                <span>Export Scorecard (XLS/PDF)</span>
                <ChevronDown className="w-3 h-3 text-[#766B83]" />
              </button>

              {exportMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-52 bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] rounded-xl shadow-xl z-30 py-1.5">
                  <button
                    type="button"
                    onClick={handleExportXlsx}
                    className="w-full px-3.5 py-2 text-left text-xs font-semibold text-[#211A2E] dark:text-white hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] flex items-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-[#16A36A]" />
                    Unduh Excel (.XLSX)
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintPdf}
                    className="w-full px-3.5 py-2 text-left text-xs font-semibold text-[#211A2E] dark:text-white hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] flex items-center gap-2 cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-[#431599]" />
                    Cetak / Save PDF Scorecard
                  </button>
                </div>
              )}
            </div>

            {canRunGovernanceActions && (
              <button
                type="button"
                onClick={() =>
                  setActionModalCtx({
                    actionType: 'MASS_ALERT_KORLAP',
                    title: 'Peringatan Masal Korlap Kontraktor',
                    subtitle: `${kpis.criticalBreachCount} WO kritis • ${kpis.criticalVendorCount} Vendor terdampak`,
                    defaultMessage: `[PERINGATAN MASAL SLA] Terdapat ${kpis.criticalBreachCount} Work Order berisiko breach SLA (<${telemetry.config.criticalRemainingMinutes} mnt) pada tanggal operasional ${telemetry.operationalDateWIB}. Seluruh Korlap wajib melakukan konfirmasi status teknisi segera.`
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#DC4C5A]/10 hover:bg-[#DC4C5A]/20 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-[#DC4C5A] dark:text-rose-300 text-[11px] font-bold transition-all cursor-pointer"
              >
                <MailWarning className="w-3.5 h-3.5" />
                <span>Peringatan Masal Korlap</span>
              </button>
            )}
          </div>
        </div>

        {/* Operational Filter Toolbar (Integrated Canvas Ribbon) */}
        <div className="px-4 sm:px-5 py-2.5 bg-[#F5F1FF] dark:bg-[#160D29] flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Time Slot Selector Pill */}
              <div className="flex items-center bg-white dark:bg-[#1E1238] p-0.5 rounded-lg border border-[#E9E5F0] dark:border-[#35105E] shadow-xs">
                {(
                  [
                    { id: 'today', label: 'Hari Ini (todayWIB)' },
                    { id: '7d', label: '7 Hari Terakhir' },
                    { id: 'mtd', label: 'Bulan Ini (MTD)' }
                  ] as { id: SlaPeriod; label: string }[]
                ).map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPeriod(tab.id)}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      period === tab.id
                        ? 'bg-[#7135B5] text-white shadow-xs'
                        : 'text-[#766B83] dark:text-slate-300 hover:text-[#211A2E] dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Area Region Dropdown */}
              <div className="relative flex items-center bg-white dark:bg-[#1E1238] rounded-lg border border-[#E9E5F0] dark:border-[#35105E] px-2.5 py-1 text-[#211A2E] dark:text-white shadow-xs">
                <MapPin className="w-3.5 h-3.5 text-[#8B8495] mr-1.5 shrink-0" />
                <select
                  value={areaFilter}
                  onChange={e => setAreaFilter(e.target.value)}
                  className="bg-transparent text-xs font-medium text-[#211A2E] dark:text-white pr-6 focus:outline-none cursor-pointer appearance-none"
                >
                  <option value="ALL" className="dark:bg-[#1E1238]">
                    Semua Wilayah Operasional ({telemetry.filterOptions.areas.length} Area)
                  </option>
                  {telemetry.filterOptions.areas.map(area => (
                    <option key={area} value={area} className="dark:bg-[#1E1238]">
                      Area: {area}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#8B8495] absolute right-2 pointer-events-none" />
              </div>

              {/* Contractor Partner Filter */}
              <div className="relative flex items-center bg-white dark:bg-[#1E1238] rounded-lg border border-[#E9E5F0] dark:border-[#35105E] px-2.5 py-1 text-[#211A2E] dark:text-white shadow-xs">
                <Building2 className="w-3.5 h-3.5 text-[#8B8495] mr-1.5 shrink-0" />
                <select
                  value={
                    isLeader && telemetry.filterOptions.contractors[0]
                      ? telemetry.filterOptions.contractors[0].id
                      : contractorFilter
                  }
                  disabled={isLeader}
                  onChange={e => setContractorFilter(e.target.value)}
                  className="bg-transparent text-xs font-medium text-[#211A2E] dark:text-white pr-6 focus:outline-none cursor-pointer appearance-none disabled:opacity-75"
                >
                  {!isLeader && (
                    <option value="ALL" className="dark:bg-[#1E1238]">
                      Semua Mitra Vendor ({activeVendorCount} Kontraktor Aktif)
                    </option>
                  )}
                  {telemetry.filterOptions.contractors.map(c => (
                    <option key={c.id} value={c.id} className="dark:bg-[#1E1238]">
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#8B8495] absolute right-2 pointer-events-none" />
              </div>
            </div>

            {/* Telemetry Pulse & Quick Sync */}
            <div className="flex flex-wrap items-center gap-3 text-[#766B83] dark:text-[#CEC0E8] font-mono text-[11px]">
              <button
                type="button"
                onClick={() => setAutoSync(prev => !prev)}
                className="flex items-center gap-1.5 font-semibold hover:text-[#431599] dark:hover:text-white transition-colors cursor-pointer"
                title="Toggle Sinkronisasi Otomatis SSE & 30s Polling"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${autoSync ? 'bg-[#7135B5] animate-ping' : 'bg-slate-400'}`} />
                <span>SINKRONISASI OTOMATIS: {formatWibClock(new Date(telemetry.generatedAt))} WIB</span>
              </button>

              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="p-1 rounded hover:bg-white dark:hover:bg-[#35105E] text-[#211A2E] dark:text-white transition-colors disabled:opacity-50 cursor-pointer"
                title="Refresh Live Data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>

              {telemetry.recentGovernanceLogs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLogsDrawer(prev => !prev)}
                  className="font-sans font-bold text-[11px] text-[#431599] dark:text-[#D8B4FE] hover:underline cursor-pointer"
                >
                  Log Tindakan ({telemetry.recentGovernanceLogs.length})
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Optional Governance Logs Banner */}
      {showLogsDrawer && telemetry.recentGovernanceLogs.length > 0 && (
        <section className="bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] rounded-xl p-4 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#211A2E] dark:text-white">
              Riwayat Tindakan &amp; Eskalasi SLA Terbaru
            </h3>
            <button
              type="button"
              onClick={() => setShowLogsDrawer(false)}
              className="text-xs font-semibold text-[#766B83] hover:text-[#211A2E] cursor-pointer"
            >
              Tutup
            </button>
          </div>
          <div className="divide-y divide-[#E9E5F0] dark:divide-[#35105E] max-h-48 overflow-y-auto">
            {telemetry.recentGovernanceLogs.slice(0, 8).map(log => (
              <div key={log.id} className="py-2 flex items-start justify-between gap-3 text-xs">
                <div>
                  <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-[#F4EAFF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE] mr-2">
                    {log.actionType}
                  </span>
                  <span className="font-semibold text-[#211A2E] dark:text-white">
                    {log.woNumber || log.contractorName || 'Global'}
                  </span>
                  <p className="text-[11px] text-[#766B83] mt-0.5">{log.message}</p>
                </div>
                <div className="text-right shrink-0 text-[10px] text-[#8B8495]">
                  <div>{log.performedBy}</div>
                  <div className="font-mono">{formatWibClock(new Date(log.createdAt))} WIB</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. KPI METRIC SUMMARY ROW (5 MODERN EXECUTIVE CARDS) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Card 1: Kepatuhan SLA Global */}
        <div className="bg-white dark:bg-[#1E1238] rounded-xl p-3.5 border border-[#E9E5F0] dark:border-[#35105E] shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div
            className={`absolute -right-3 -top-3 w-16 h-16 rounded-full pointer-events-none ${
              kpis.complianceStatus === 'ON_TARGET'
                ? 'bg-[#16A36A]/10'
                : kpis.complianceStatus === 'CRITICAL'
                ? 'bg-[#DC4C5A]/10'
                : 'bg-[#E59A27]/10'
            }`}
          />
          <div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] font-bold text-[#8B8495] dark:text-[#A78BFA] uppercase tracking-wider">
                Kepatuhan SLA Global
              </span>
              {kpis.complianceGap !== null ? (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                    kpis.complianceGap >= 0
                      ? 'bg-[#16A36A]/15 text-[#16A36A]'
                      : kpis.complianceStatus === 'CRITICAL'
                      ? 'bg-[#DC4C5A]/15 text-[#DC4C5A]'
                      : 'bg-[#E59A27]/15 text-[#E59A27]'
                  }`}
                >
                  {kpis.complianceGap >= 0 ? 'ON TARGET' : `GAP ${kpis.complianceGap}%`}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 shrink-0">
                  NO DATA
                </span>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[26px] font-extrabold text-[#160D29] dark:text-white tabular-nums leading-none">
                {kpis.globalComplianceRate !== null ? `${kpis.globalComplianceRate.toFixed(1)}%` : '0.0%'}
              </span>
              <span className="font-mono text-[11px] text-[#8B8495]">Target {kpis.globalTarget.toFixed(1)}%</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between text-xs">
            <span
              className={`font-semibold flex items-center gap-1 ${
                kpis.complianceStatus === 'ON_TARGET'
                  ? 'text-[#16A36A]'
                  : kpis.complianceStatus === 'NO_DATA'
                  ? 'text-[#766B83]'
                  : 'text-[#E59A27]'
              }`}
            >
              {kpis.complianceStatus === 'ON_TARGET' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : kpis.complianceStatus === 'NO_DATA' ? (
                <Info className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {kpis.complianceStatus === 'ON_TARGET'
                  ? 'Memenuhi Target'
                  : kpis.complianceStatus === 'NO_DATA'
                  ? 'Belum Ada Data'
                  : 'Perlu Perhatian'}
              </span>
            </span>
            <span className="font-mono text-[11px] text-[#8B8495]">
              {kpis.compliantWoCount}/{kpis.evaluatedWoCount} Sesuai
            </span>
          </div>
        </div>

        {/* Card 2: Total Work Orders */}
        <div className="bg-white dark:bg-[#1E1238] rounded-xl p-3.5 border border-[#E9E5F0] dark:border-[#35105E] shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-[#8B8495] dark:text-[#A78BFA] uppercase tracking-wider">
                Total WO Terdistribusi
              </span>
              <BarChart3 className="w-4 h-4 text-[#7135B5] shrink-0" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[26px] font-extrabold text-[#160D29] dark:text-white tabular-nums leading-none">
                {kpis.totalDistributedWo}
              </span>
              <span className="text-[11px] font-bold text-[#766B83] dark:text-[#CEC0E8]">
                {period === 'today' ? 'SPK Hari Ini' : period === '7d' ? 'SPK 7 Hari' : 'SPK Bulan Ini'}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] grid grid-cols-3 gap-1 text-center font-mono text-[11px]">
            <div className="bg-[#16A36A]/10 rounded py-0.5 text-[#16A36A] font-bold" title={`${kpis.okCount} WO Tepat Waktu`}>
              {kpis.okCount} OK
            </div>
            <div className="bg-[#F4EAFF] dark:bg-[#35105E] rounded py-0.5 text-[#7135B5] dark:text-[#D8B4FE] font-bold" title={`${kpis.wipCount} WO Dalam Pengerjaan`}>
              {kpis.wipCount} WIP
            </div>
            <div className="bg-[#DC4C5A]/10 rounded py-0.5 text-[#DC4C5A] font-bold" title={`${kpis.latCount} WO Terkendala`}>
              {kpis.latCount} LAT
            </div>
          </div>
        </div>

        {/* Card 3: First-Time-Right */}
        <div className="bg-white dark:bg-[#1E1238] rounded-xl p-3.5 border border-[#E9E5F0] dark:border-[#35105E] shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full bg-[#16A36A]/10 pointer-events-none" />
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-[#8B8495] dark:text-[#A78BFA] uppercase tracking-wider">
                First-Time-Right (FTR)
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                  kpis.ftrStatus === 'STABIL'
                    ? 'bg-[#16A36A]/15 text-[#16A36A]'
                    : kpis.ftrStatus === 'NO_DATA'
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-[#E59A27]/15 text-[#E59A27]'
                }`}
              >
                {kpis.ftrStatus}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[26px] font-extrabold text-[#16A36A] tabular-nums leading-none">
                {kpis.ftrRate !== null ? `${kpis.ftrRate.toFixed(1)}%` : '0.0%'}
              </span>
              <span className="font-mono text-[11px] text-[#8B8495]">Target {kpis.ftrTarget.toFixed(0)}%</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between text-xs">
            <span className="text-[#766B83] dark:text-[#CEC0E8]">Zero-Rework Instalasi</span>
            <span className="font-mono text-[11px] text-[#16A36A] font-bold">{kpis.ftrPassCount} Pass</span>
          </div>
        </div>

        {/* Card 4: Kepatuhan Foto & OPM */}
        <div className="bg-white dark:bg-[#1E1238] rounded-xl p-3.5 border border-[#E9E5F0] dark:border-[#35105E] shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-[#8B8495] dark:text-[#A78BFA] uppercase tracking-wider">
                Kepatuhan Foto &amp; OPM
              </span>
              <Award className="w-4 h-4 text-[#431599] dark:text-[#D8B4FE] shrink-0" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[26px] font-extrabold text-[#160D29] dark:text-white tabular-nums leading-none">
                {kpis.photoOpmComplianceRate !== null ? `${kpis.photoOpmComplianceRate.toFixed(1)}%` : '0.0%'}
              </span>
              <span className="font-mono text-[11px] text-[#8B8495]">Eviden {kpis.requiredPhotoCount} Titik</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between text-xs">
            <span className="text-[#766B83] dark:text-[#CEC0E8]">Redaman &gt; {kpis.opmThresholdDbm} dBm</span>
            <span className="font-mono text-[11px] text-[#431599] dark:text-[#D8B4FE] font-bold">
              {kpis.photoOpmValidCount} Valid
            </span>
          </div>
        </div>

        {/* Card 5: Critical Threshold Breaches */}
        <div className="bg-gradient-to-br from-white via-white to-[#DC4C5A]/5 dark:from-[#1E1238] dark:via-[#1E1238] dark:to-rose-950/30 rounded-xl p-3.5 border border-[#DC4C5A]/30 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="absolute -right-2 -bottom-2 opacity-10 text-[#DC4C5A] pointer-events-none">
            <AlertOctagon className="w-16 h-16" />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-[#DC4C5A] uppercase tracking-wider">
                Kritis (&lt;{telemetry.config.criticalRemainingMinutes} Mnt SLA)
              </span>
              <span className="flex h-2 w-2 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DC4C5A] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#DC4C5A]" />
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[26px] font-extrabold text-[#DC4C5A] tabular-nums leading-none">
                {kpis.criticalBreachCount}{' '}
                <span className="text-base font-bold">WO</span>
              </span>
              <span className="font-mono text-[11px] text-[#DC4C5A] font-bold">Overdue Risk</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#E9E5F0] dark:border-rose-900/50 flex items-center justify-between text-xs relative z-10">
            <span className="text-[#DC4C5A] font-semibold">Tindakan Cepat</span>
            <span className="px-1.5 py-0.5 rounded bg-[#DC4C5A] text-white text-[10px] font-bold">
              {kpis.criticalVendorCount} Vendor
            </span>
          </div>
        </div>
      </section>

      {/* 3. VENDOR SLA LEADERBOARD & EXECUTION SCORECARD */}
      <section className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] shadow-sm overflow-hidden">
        {/* Section Header */}
        <div className="px-5 py-3.5 bg-[#F5F1FF] dark:bg-[#160D29] border-b border-[#E9E5F0] dark:border-[#35105E] flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#35105E] text-white shadow-xs shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-bold text-[#160D29] dark:text-white leading-tight">
                Leaderboard &amp; Matrix Performa {vendorLeaderboard.length} Mitra Kontraktor
              </h2>
              <p className="text-xs text-[#766B83] dark:text-[#A78BFA]">
                Peringkat kepatuhan Service Level Agreement (SLA) FTTH harian terhitung otomatis berdasarkan telemetri sistem
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-bold text-[#8B8495] uppercase">Legend:</span>
            <span className="px-2.5 py-0.5 rounded-full bg-[#16A36A]/15 text-[#16A36A] font-mono font-bold">
              ≥{telemetry.config.excellentMin}% EXCELLENT
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-[#E59A27]/15 text-[#E59A27] font-mono font-bold">
              {telemetry.config.goodMin}-{(telemetry.config.excellentMin - 0.1).toFixed(1)}% GOOD/WARN
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-[#DC4C5A]/15 text-[#DC4C5A] font-mono font-bold">
              &lt;{telemetry.config.goodMin}% CRITICAL
            </span>
          </div>
        </div>

        {/* High Density Vendor Data Table */}
        {vendorLeaderboard.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#766B83]">
            Belum ada data Kontraktor/Vendor atau Work Order pada filter yang dipilih.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[980px]">
              <thead>
                <tr className="bg-[#F4EAFF]/60 dark:bg-[#160D29] border-b border-[#E9E5F0] dark:border-[#35105E] text-[11px] font-bold text-[#766B83] dark:text-[#A78BFA] uppercase">
                  <th className="py-2.5 px-3 text-center w-14"># Rank</th>
                  <th className="py-2.5 px-3">Mitra Kontraktor &amp; Area Kerja</th>
                  <th className="py-2.5 px-3 text-center">Status SLA</th>
                  <th className="py-2.5 px-3 w-60">SLA Achievement Rate</th>
                  <th className="py-2.5 px-3 text-center">Volume WO</th>
                  <th className="py-2.5 px-3 text-center">On-Time</th>
                  <th className="py-2.5 px-3 text-center">FTR Pass</th>
                  <th className="py-2.5 px-3 text-center">Avg Response</th>
                  <th className="py-2.5 px-3 text-center">Utilisasi Kuota</th>
                  <th className="py-2.5 px-3 text-right">Aksi Manajemen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9E5F0] dark:divide-[#35105E] text-xs">
                {vendorLeaderboard.map(vendor => {
                  const styles = getTierStyles(vendor.slaStatus);
                  const slaWidth = vendor.slaRate !== null ? Math.min(100, Math.max(0, vendor.slaRate)) : 0;

                  return (
                    <tr key={vendor.contractorId} className={`transition-colors ${styles.rowBg}`}>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-bold font-mono ${styles.rank}`}
                        >
                          {vendor.rank}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${styles.iconBox}`}>
                            {vendor.contractorCode.slice(0, 3)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-[#160D29] dark:text-white truncate">{vendor.contractorName}</div>
                            <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#8B8495] mt-0.5">
                              <span>Area: {vendor.primaryArea}</span>
                              <span>•</span>
                              <span className="text-[#7135B5] dark:text-[#D8B4FE] font-semibold">
                                {vendor.activeTechniciansCount} Teknisi Aktif
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider inline-block ${styles.badge}`}>
                          {vendor.slaStatus === 'NO_DATA' ? 'NO DATA' : vendor.slaStatus}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center justify-between font-mono text-[11px] mb-1">
                          <span className={`font-bold ${styles.text}`}>
                            {vendor.slaRate !== null ? `${vendor.slaRate.toFixed(1)}%` : 'Belum ada data'}
                          </span>
                          {vendor.targetGap !== null && vendor.targetGap < 0 ? (
                            <span className="text-[#DC4C5A] font-semibold">{vendor.targetGap.toFixed(1)}%</span>
                          ) : (
                            <span className="text-[#8B8495]">Target: {telemetry.config.globalSlaTarget.toFixed(1)}%</span>
                          )}
                        </div>
                        <div className="w-full bg-[#F7F6FA] dark:bg-[#140827] rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${styles.bar}`}
                            style={{ width: `${slaWidth}%` }}
                          />
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center font-mono font-semibold text-[#211A2E] dark:text-white">
                        {vendor.volumeWo} WO
                      </td>

                      <td className={`py-3 px-3 text-center font-mono font-bold ${styles.text}`}>
                        {vendor.onTimeRate !== null ? `${vendor.onTimeRate.toFixed(1)}%` : '-'}
                      </td>

                      <td className="py-3 px-3 text-center font-mono font-semibold text-[#211A2E] dark:text-white">
                        {vendor.ftrRate !== null ? `${vendor.ftrRate.toFixed(1)}%` : '-'}
                      </td>

                      <td className="py-3 px-3 text-center font-mono">
                        <span
                          className={
                            vendor.avgResponseMinutes !== null && vendor.avgResponseMinutes > telemetry.config.maxDispatchResponseMinutes
                              ? 'text-[#DC4C5A] font-bold'
                              : 'text-[#766B83] dark:text-slate-300'
                          }
                        >
                          {vendor.avgResponseMinutes !== null ? `<${vendor.avgResponseMinutes} mnt` : '-'}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-center">
                        {vendor.quotaTotal > 0 ? (
                          <div>
                            <div className="font-mono text-[#211A2E] dark:text-white font-semibold">
                              {vendor.quotaUtilizationRate?.toFixed(1)}%
                            </div>
                            <div className="text-[10px] text-[#8B8495] font-mono">
                              {vendor.quotaUsed}/{vendor.quotaTotal} Slot
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#8B8495]">0 Teknisi</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setDrilldownVendor(vendor)}
                            className="px-2 py-1 rounded bg-[#F4EAFF] hover:bg-[#F0E3FF] dark:bg-[#35105E] dark:hover:bg-[#5B35B1]/60 text-[#431599] dark:text-[#D8B4FE] text-[11px] font-bold transition-colors cursor-pointer"
                          >
                            Detail WO
                          </button>

                          <button
                            type="button"
                            onClick={() => openVendorChat(vendor)}
                            className="p-1 rounded text-[#8B8495] hover:text-[#211A2E] dark:hover:text-white hover:bg-[#F7F6FA] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                            title="Kontak Koordinator Lapangan"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>

                          {canRunGovernanceActions && vendor.slaStatus === 'WARNING' && (
                            <button
                              type="button"
                              onClick={() =>
                                setActionModalCtx({
                                  actionType: 'TEGUR_KORLAP',
                                  title: `Tegur Korlap — ${vendor.contractorName}`,
                                  subtitle: `Korlap: ${vendor.leaderName} • SLA saat ini ${vendor.slaRate ?? 0}%`,
                                  contractorId: vendor.contractorId,
                                  contractorName: vendor.contractorName,
                                  leaderName: vendor.leaderName,
                                  leaderPhone: vendor.leaderPhone,
                                  defaultMessage: `[TEGURAN SLA] Kepada Yth. Korlap ${vendor.leaderName} (${vendor.contractorName}), pencapaian SLA saat ini berada di ${vendor.slaRate ?? 0}% (Target ${telemetry.config.globalSlaTarget}%). Mohon percepatan penyelesaian ${vendor.breachWoCount} WO kritis & optimasi respon teknisi.`
                                })
                              }
                              className="px-2 py-1 rounded bg-[#E59A27]/15 hover:bg-[#E59A27]/25 text-[#E59A27] text-[11px] font-bold transition-colors cursor-pointer"
                            >
                              Tegur Korlap
                            </button>
                          )}

                          {canRunGovernanceActions && vendor.slaStatus === 'CRITICAL' && (
                            <button
                              type="button"
                              onClick={() =>
                                setActionModalCtx({
                                  actionType: 'ISSUE_SP1',
                                  title: `Penerbitan Surat Peringatan (SP-1) — ${vendor.contractorName}`,
                                  subtitle: `Korlap: ${vendor.leaderName} • SLA Critical ${vendor.slaRate ?? 0}%`,
                                  contractorId: vendor.contractorId,
                                  contractorName: vendor.contractorName,
                                  leaderName: vendor.leaderName,
                                  leaderPhone: vendor.leaderPhone,
                                  defaultMessage: `[SURAT PERINGATAN 1 / SP-1] Kepada Mitra ${vendor.contractorName} (Korlap: ${vendor.leaderName}), tingkat kepatuhan SLA tercatat ${vendor.slaRate ?? 0}% di bawah ambang minimum ${telemetry.config.goodMin}% dengan ${vendor.lateCount} WO terlambat. Harap lakukan corrective action plan hari ini.`
                                })
                              }
                              className="px-2 py-1 rounded bg-[#DC4C5A] hover:bg-rose-700 text-white text-[11px] font-bold transition-colors shadow-xs cursor-pointer"
                            >
                              Surat SP-1
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-2.5 bg-white dark:bg-[#1E1238] border-t border-[#E9E5F0] dark:border-[#35105E] flex flex-col sm:flex-row items-center justify-between text-[#766B83] dark:text-[#A78BFA] text-xs gap-2">
          <span>
            Menampilkan {vendorLeaderboard.length} dari {activeVendorCount} Vendor Resmi Terdaftar di MoraJaws FTTH Core.
          </span>
          <span className="font-mono text-[11px]">SLA Threshold Rules: {telemetry.config.ruleVersionLabel}</span>
        </div>
      </section>

      {/* 4. TWO-COLUMN DEEP OPERATIONAL ANALYTICS & ESCALATIONS */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column (7 cols): Time Hourly Breakdown & Parameter Matrix */}
        <div className="lg:col-span-7 space-y-4">
          {/* Hourly SLA Performance Trend Chart Card */}
          <div className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] shadow-sm p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold text-[#160D29] dark:text-white">
                  Tren Performa SLA per Slot Jam Kerja
                </h3>
                <p className="text-xs text-[#766B83] dark:text-[#A78BFA]">
                  Distribusi kepatuhan SLA dispatch pada 4 slot appointment (WIB)
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-block w-3 h-3 rounded-full bg-[#7135B5]" />
                <span className="font-mono text-xs text-[#766B83] dark:text-[#CEC0E8]">
                  Target ({telemetry.config.globalSlaTarget.toFixed(1)}%)
                </span>
              </div>
            </div>

            {/* Inline Bar Visualization (Responsive SVG inside Tinted Card) */}
            <div className="w-full bg-[#F5F1FF] dark:bg-[#140827] p-3 sm:p-4 rounded-lg border border-[#E9E5F0] dark:border-[#35105E] overflow-x-auto">
              <svg
                viewBox="0 0 540 165"
                className="w-full min-w-[440px] h-48 select-none"
                fill="none"
                role="img"
                aria-label="Grafik Tren SLA per Slot Jam Kerja"
              >
                {[
                  { pct: 100, y: 20, dashed: true },
                  { pct: 98, y: 55, dashed: true },
                  { pct: 95, y: 90, dashed: true },
                  { pct: 90, y: 125, dashed: false }
                ].map(tick => (
                  <g key={tick.pct}>
                    <line
                      x1="50"
                      x2="520"
                      y1={tick.y}
                      y2={tick.y}
                      stroke="currentColor"
                      className="text-[#E9E5F0] dark:text-[#35105E]"
                      strokeDasharray={tick.dashed ? '3 3' : undefined}
                    />
                    <text x="15" y={tick.y + 4} fill="#8B8495" className="text-[10px] font-mono">
                      {tick.pct}%
                    </text>
                  </g>
                ))}

                {/* Target Benchmark Reference Line */}
                {(() => {
                  const tVal = Math.min(100, Math.max(88, telemetry.config.globalSlaTarget));
                  const targetY = 125 - ((tVal - 90) / 10) * 105;
                  return (
                    <line
                      x1="50"
                      x2="520"
                      y1={targetY}
                      y2={targetY}
                      stroke="#7135B5"
                      strokeDasharray="4 2"
                      strokeWidth="1.5"
                    />
                  );
                })()}

                {/* 4 Slot Bars */}
                {slotTrend.map((slot, idx) => {
                  const barW = 60;
                  const barX = 80 + idx * 120;
                  const colCenterX = barX + barW / 2;
                  const baselineY = 125;
                  const maxBarH = 100;

                  const rate = slot.slaRate;
                  const clamped = rate !== null ? Math.min(100, Math.max(88, rate)) : 88;
                  const barH = rate !== null ? Math.max(16, ((clamped - 88) / 12) * maxBarH) : 12;
                  const barY = baselineY - barH;

                  let fill = '#CBD5E1';
                  let labelColor = '#64748B';
                  if (rate !== null) {
                    if (rate >= telemetry.config.excellentMin) {
                      fill = '#16A36A';
                      labelColor = '#16A36A';
                    } else if (rate >= telemetry.config.goodMin) {
                      fill = '#5B35B1';
                      labelColor = '#5B35B1';
                    } else if (rate >= telemetry.config.warningMin) {
                      fill = '#E59A27';
                      labelColor = '#E59A27';
                    } else {
                      fill = '#DC4C5A';
                      labelColor = '#DC4C5A';
                    }
                  }

                  return (
                    <g key={slot.slotTime}>
                      <rect
                        x={barX}
                        y={barY}
                        width={barW}
                        height={barH}
                        rx="4"
                        fill={fill}
                        opacity={rate !== null ? 1 : 0.45}
                      />
                      <text
                        x={colCenterX}
                        y={barY - 6}
                        textAnchor="middle"
                        fill={labelColor}
                        className="text-[11px] font-mono font-bold"
                      >
                        {rate !== null ? `${rate.toFixed(1)}%` : 'N/A'}
                      </text>
                      <text
                        x={colCenterX}
                        y="145"
                        textAnchor="middle"
                        className="fill-[#494453] dark:fill-white text-[11px] font-semibold"
                      >
                        {slot.shortLabel}
                      </text>
                      <text
                        x={colCenterX}
                        y="158"
                        textAnchor="middle"
                        fill={slot.wipCount > 0 && slot.lateCount > 0 ? '#DC4C5A' : '#8B8495'}
                        className="text-[10px] font-mono"
                      >
                        {slot.volume} WO{slot.wipCount > 0 ? ` (${slot.wipCount} WIP)` : ''}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 text-xs">
              {slotInsights.map(insight => {
                const ToneIcon =
                  insight.tone === 'warning' ? AlertTriangle : insight.tone === 'success' ? CheckCircle2 : Info;
                const iconColor =
                  insight.tone === 'warning'
                    ? 'text-[#E59A27]'
                    : insight.tone === 'success'
                    ? 'text-[#16A36A]'
                    : 'text-[#431599]';

                return (
                  <div
                    key={insight.id}
                    className="p-2.5 rounded-lg bg-[#F4EAFF]/60 dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] flex items-start gap-2"
                  >
                    <ToneIcon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
                    <div>
                      <span className="font-bold text-[#160D29] dark:text-white block">{insight.title}</span>
                      <span className="text-[#766B83] dark:text-slate-300 text-[11px] leading-tight block mt-0.5">
                        {insight.description}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SLA Compliance Parameter Matrix Card */}
          <div className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] shadow-sm p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 mb-3.5">
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold text-[#160D29] dark:text-white">
                  Matriks Kepatuhan 4 Parameter Operasional
                </h3>
                <p className="text-xs text-[#766B83] dark:text-[#A78BFA]">
                  Standard Operational Procedure (SOP) pengerjaan teknisi di lapangan
                </p>
              </div>
              <span className="text-[11px] font-bold text-[#431599] dark:text-[#D8B4FE] px-2 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#35105E] shrink-0">
                Audit Otomatis
              </span>
            </div>

            <div className="space-y-3.5">
              {operationalMatrix.map((item, idx) => {
                const Icon = idx === 0 ? Clock : idx === 1 ? MessageSquare : idx === 2 ? Radio : Camera;
                const pct = item.complianceRate;
                const barWidth = pct !== null ? Math.min(100, Math.max(0, pct)) : 0;
                const barClass =
                  item.statusTone === 'emerald'
                    ? 'bg-[#16A36A]'
                    : item.statusTone === 'amber'
                    ? 'bg-[#E59A27]'
                    : item.statusTone === 'rose'
                    ? 'bg-[#DC4C5A]'
                    : 'bg-[#7135B5]';
                const pctClass =
                  item.statusTone === 'emerald'
                    ? 'text-[#16A36A]'
                    : item.statusTone === 'amber'
                    ? 'text-[#E59A27]'
                    : item.statusTone === 'rose'
                    ? 'text-[#DC4C5A]'
                    : 'text-[#7135B5] dark:text-[#D8B4FE]';
                const iconClass = item.statusTone === 'amber' ? 'text-[#E59A27]' : 'text-[#7135B5] dark:text-[#D8B4FE]';

                return (
                  <div key={item.id}>
                    <div className="flex items-center justify-between text-xs mb-1 gap-2">
                      <span className="font-semibold text-[#211A2E] dark:text-white flex items-center gap-1.5 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${iconClass}`} />
                        <span className="truncate">{item.title}</span>
                      </span>
                      <span className={`font-mono font-bold shrink-0 ${pctClass}`}>
                        {pct !== null ? `${pct.toFixed(1)}% Terpenuhi` : 'Belum ada sampel'}
                      </span>
                    </div>
                    <div className="w-full bg-[#F7F6FA] dark:bg-[#140827] rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Critical SLA Breach Alerts & Penalty/Incentive Ledger */}
        <div className="lg:col-span-5 space-y-4">
          {/* Critical SLA Breach Warning Feed (<15 Mins) */}
          <div className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#DC4C5A]/30 shadow-md p-4 sm:p-5 relative overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-[#E9E5F0] dark:border-[#35105E] gap-2">
              <div className="flex items-center gap-2">
                <AlertOctagon className="w-5 h-5 text-[#DC4C5A] animate-pulse shrink-0" />
                <div>
                  <h3 className="font-display text-base sm:text-lg font-bold text-[#DC4C5A] leading-none">
                    Antrean Berisiko Breach SLA
                  </h3>
                  <span className="text-[11px] font-bold text-[#8B8495] uppercase tracking-wide">
                    Peringatan Kritis &lt;{telemetry.config.criticalRemainingMinutes} Menit Tersisa
                  </span>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-[#DC4C5A] text-white font-mono font-bold text-xs shrink-0">
                {breachQueue.length} Tiket Aktif
              </span>
            </div>

            <div className="mt-3 space-y-2.5 max-h-[540px] overflow-y-auto">
              {breachQueue.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-[#16A36A] mx-auto opacity-80" />
                  <p className="text-xs font-bold text-[#211A2E] dark:text-white">
                    Tidak Ada Antrean Berisiko Breach SLA
                  </p>
                  <p className="text-[11px] text-[#766B83] max-w-xs mx-auto">
                    Seluruh Work Order aktif masih memiliki buffer waktu ≥ {telemetry.config.criticalRemainingMinutes} menit pada periode ini.
                  </p>
                </div>
              ) : (
                breachQueue.map((breach, idx) => {
                  const countdown = formatLiveCountdown(breach);
                  const actionCfg = triggerBreachAction(breach, idx);
                  const cleanPhone = breach.leaderPhone.replace(/\D/g, '');
                  const isUrgent = countdown.urgent;

                  return (
                    <div
                      key={breach.ticketId}
                      className={`p-3 rounded-lg border transition-colors ${
                        isUrgent
                          ? 'border-[#DC4C5A]/30 bg-[#DC4C5A]/5 hover:bg-[#DC4C5A]/10 dark:bg-rose-950/20'
                          : 'border-[#E59A27]/40 bg-[#E59A27]/5 hover:bg-[#E59A27]/10 dark:bg-amber-950/20'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <button
                          type="button"
                          onClick={() => openBreachTicket(breach, 'overview')}
                          className="font-mono text-xs font-bold text-[#160D29] dark:text-white hover:text-[#431599] hover:underline text-left cursor-pointer"
                        >
                          {breach.woNumber}
                        </button>
                        <span
                          className={`px-2 py-0.5 rounded text-white font-mono text-[11px] font-bold flex items-center gap-1 shrink-0 ${
                            isUrgent ? 'bg-[#DC4C5A]' : 'bg-[#E59A27]'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          {countdown.label}
                        </span>
                      </div>

                      <div className="text-xs text-[#211A2E] dark:text-white">
                        <div className="font-semibold">
                          {breach.customerName} • {breach.address}
                        </div>
                        <div className="text-[11px] text-[#8B8495] dark:text-slate-300 mt-0.5">
                          Mitra:{' '}
                          <strong className={isUrgent ? 'text-[#DC4C5A]' : 'text-[#E59A27]'}>{breach.contractorName}</strong> • Teknisi:{' '}
                          {breach.installerName}
                        </div>
                      </div>

                      <div
                        className={`mt-2.5 pt-2 border-t flex flex-wrap items-center justify-between gap-2 ${
                          isUrgent ? 'border-[#DC4C5A]/20' : 'border-[#E59A27]/30'
                        }`}
                      >
                        <span
                          className={`text-[11px] font-semibold flex-1 min-w-[130px] ${
                            isUrgent ? 'text-[#DC4C5A]' : 'text-[#E59A27]'
                          }`}
                        >
                          Kendala: {breach.issueSummary}
                        </span>

                        <div className="flex items-center gap-1 shrink-0">
                          {canRunGovernanceActions ? (
                            <button
                              type="button"
                              onClick={actionCfg.onClick}
                              className={`px-2 py-1 rounded text-white text-[11px] font-bold shadow-xs transition-colors cursor-pointer ${
                                isUrgent ? 'bg-[#DC4C5A] hover:bg-rose-700' : 'bg-[#431599] hover:bg-[#35105E]'
                              }`}
                            >
                              {actionCfg.label}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openBreachTicket(breach, 'chat')}
                              className="px-2 py-1 rounded bg-[#431599] text-white text-[11px] font-bold cursor-pointer"
                            >
                              Buka Chat
                            </button>
                          )}

                          {cleanPhone ? (
                            <a
                              href={`tel:${breach.leaderPhone}`}
                              className="px-2 py-1 rounded bg-white dark:bg-[#1E1238] text-[#211A2E] dark:text-white border border-[#E9E5F0] dark:border-[#35105E] text-[11px] font-bold hover:bg-[#F7F6FA] inline-flex items-center gap-1"
                            >
                              <PhoneCall className="w-3 h-3 text-[#431599]" />
                              Call Korlap
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openBreachTicket(breach, 'overview')}
                              className="px-2 py-1 rounded bg-white dark:bg-[#1E1238] text-[#211A2E] dark:text-white border border-[#E9E5F0] dark:border-[#35105E] text-[11px] font-bold hover:bg-[#F7F6FA] cursor-pointer"
                            >
                              Detail WO
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Incentive & Penalty Ledger Overview */}
          <div className="bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] shadow-sm p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold text-[#160D29] dark:text-white">
                  Proyeksi Insentif &amp; Penalti
                </h3>
                <p className="text-xs text-[#766B83] dark:text-[#A78BFA]">
                  Estimasi penalti keterlambatan SLA atau bonus pencapaian
                </p>
              </div>
              <Wallet className="w-5 h-5 text-[#7135B5] shrink-0" />
            </div>

            {!pksLedger.isCustomConfigured && (
              <div className="mb-2.5 px-3 py-2 rounded-lg bg-[#F5F1FF] dark:bg-[#140827] border border-[#E9E5F0] dark:border-[#35105E] text-[11px] text-[#766B83] flex items-center justify-between gap-2">
                <span>Menggunakan tarif baseline PKS default sistem.</span>
                <button
                  type="button"
                  onClick={() => {
                    setConfigModalTab('pks');
                    setConfigModalOpen(true);
                  }}
                  className="font-bold text-[#431599] dark:text-[#D8B4FE] hover:underline shrink-0 cursor-pointer"
                >
                  Atur Tarif
                </button>
              </div>
            )}

            <div className="space-y-2 text-xs">
              {pksLedger.items.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#766B83]">
                  Belum ada data proyeksi PKS pada periode terpilih.
                </div>
              ) : (
                pksLedger.items.map(item => {
                  const isWarningPenalty = item.ledgerType === 'PENALTY' && item.slaStatus === 'WARNING';
                  const boxClass =
                    item.ledgerType === 'BONUS'
                      ? 'bg-[#16A36A]/10 border-[#16A36A]/20 dark:bg-emerald-950/30 dark:border-emerald-800/60'
                      : isWarningPenalty
                      ? 'bg-[#E59A27]/10 border-[#E59A27]/20 dark:bg-amber-950/30 dark:border-amber-800/60'
                      : item.ledgerType === 'PENALTY'
                      ? 'bg-[#DC4C5A]/10 border-[#DC4C5A]/20 dark:bg-rose-950/30 dark:border-rose-800/60'
                      : 'bg-[#F4EAFF] border-[#E9E5F0] dark:bg-[#140827] dark:border-[#35105E]';

                  const subColor =
                    item.ledgerType === 'BONUS'
                      ? 'text-[#16A36A]'
                      : isWarningPenalty
                      ? 'text-[#E59A27]'
                      : item.ledgerType === 'PENALTY'
                      ? 'text-[#DC4C5A]'
                      : 'text-[#766B83]';

                  const amountColor =
                    item.ledgerType === 'BONUS'
                      ? 'text-[#16A36A]'
                      : isWarningPenalty
                      ? 'text-[#E59A27]'
                      : item.ledgerType === 'PENALTY'
                      ? 'text-[#DC4C5A]'
                      : 'text-[#766B83]';

                  return (
                    <div
                      key={item.contractorId}
                      className={`p-2.5 rounded-lg border ${boxClass} flex items-center justify-between gap-2`}
                    >
                      <div className="min-w-0">
                        <span className="font-bold text-[#160D29] dark:text-white block truncate">{item.contractorName}</span>
                        <span className={`text-[11px] font-semibold block ${subColor}`}>{item.explanation}</span>
                      </div>
                      <span className={`font-mono font-bold text-sm shrink-0 ${amountColor}`}>
                        {formatRupiah(item.amount)}
                        {item.ledgerType === 'BONUS' ? ' (Bonus)' : item.ledgerType === 'NEUTRAL' ? ' (Netral)' : ''}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-3 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between font-mono text-[11px] text-[#8B8495]">
              <span>Dihitung berdasarkan {pksLedger.clauseReference}</span>
              <button
                type="button"
                onClick={() => {
                  setConfigModalTab('pks');
                  setConfigModalOpen(true);
                }}
                className="text-[#7135B5] dark:text-[#D8B4FE] font-bold hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                Detail Klausul
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 5. LIVE TELEMETRY LOG FOOTER BAR */}
      <footer className="bg-white dark:bg-[#1E1238] rounded-xl p-3.5 border border-[#E9E5F0] dark:border-[#35105E] flex flex-col md:flex-row items-center justify-between gap-2 shadow-sm text-[#766B83] dark:text-[#A78BFA] text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              sseConnected && databaseStatus === 'connected' ? 'bg-[#16A36A]' : 'bg-[#E59A27]'
            }`}
          />
          {sseConnected && databaseStatus === 'connected' ? (
            <Wifi className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-[#E59A27] shrink-0" />
          )}
          <span>
            Realtime Stream: <strong className="text-[#160D29] dark:text-white font-mono">/api/supabase/realtime/stream</strong>{' '}
            {autoSync ? 'terhubung (Event-Driven + 30s Sync).' : 'mode sinkronisasi manual.'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
          <span>Source: {telemetry.databaseSource === 'supabase' ? 'Supabase PostgreSQL' : 'Local Dev Store'}</span>
          <span>•</span>
          <span>Tanggal Ops: {telemetry.operationalDateWIB}</span>
          <span>•</span>
          <span className="text-[#431599] dark:text-[#D8B4FE] font-bold">MoraJaws Core Enterprise</span>
        </div>
      </footer>

      {/* MODALS */}
      <SlaConfigModal
        isOpen={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        config={telemetry.config}
        configVersion={telemetry.configVersion}
        isConfigPersistedInDb={telemetry.isConfigPersistedInDb}
        canEdit={canEditThresholds}
        initialTab={configModalTab}
        onSave={handleSaveThresholds}
      />

      <VendorWoDrilldownModal
        isOpen={Boolean(drilldownVendor)}
        onClose={() => setDrilldownVendor(null)}
        vendor={drilldownVendor}
        tickets={drilldownVendor ? getVendorTickets(drilldownVendor) : []}
        onSelectTicket={handleSelectTicketSafe}
      />

      <SlaGovernanceActionModal
        context={actionModalCtx}
        onClose={() => setActionModalCtx(null)}
        onSubmit={handleExecuteGovernanceAction}
      />
    </div>
  );
};
