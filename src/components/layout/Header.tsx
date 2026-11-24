import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { UserRole, Ticket } from '../../types/index.ts';
import {
  ShieldCheck,
  ChevronDown,
  Building2,
  Wrench,
  Shield,
  WifiOff,
  Database,
  RefreshCw,
  LogOut,
  Calendar,
  Cloud,
  Zap,
  PanelLeft,
  Monitor,
  Smartphone,
  Search,
  X,
  Loader2,
  Radio,
  Network,
  BadgeCheck,
  KeyRound
} from 'lucide-react';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { MoraJawsLogo } from '../common/MoraJawsLogo';
import { NotificationBell } from '../notification/NotificationBell';
import { useAnimation } from '../../context/AnimationContext';
import { useToast } from '../../context/ToastContext';
import { useMoraJawsSound } from '../../context/SoundContext';
import { formatIndonesianWODate } from '../../services/woDateFilterEngine';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { getAuthHeaders } from '../../services/authService';

interface HeaderProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
}

const TAB_TITLES: Record<string, string> = {
  dashboard: 'Dashboard Monitoring',
  verification_desk: 'Antrean Verifikasi & QC Desk',
  monitoring_maps: 'Monitoring Maps',
  tickets: 'Ticket MyRepublic',
  overdue_wo: 'Overdue WO',
  form_sameday: 'Form Sameday Express',
  report_data_wo: 'Report Data WO',
  schedule: 'Schedule',
  import: 'Import Data WO',
  contact_centre: 'Contact Centre',
  users: 'Management User',
  leader_portal: 'Dashboard Leader',
  wo_assignment: 'Assign WO',
  reassign_wo: 'Reassign WO',
  progress_dashboard: 'Dashboard Progress WO',
  installer_mgmt: 'Pendaftaran Akun Teknisi',
  quota_settings: 'Kuota & Kolom',
  contractor_recap: 'Rekap Total WO',
  location_basecamp: 'Basecamp',
  sla_monitoring: 'Monitoring SLA Kontraktor & Vendor',
  setup: 'Setup',
  nav_config: 'Konfigurasi Menu',
  management_role: 'Role & Permission',
  droplist_management: 'Kategori Report',
  templates: 'Template WhatsApp',
  audit_logs: 'Audit Trail Log',
  login_logs: 'Riwayat Sesi Login',
  system_health: 'Kesehatan Sistem',
  database_management: 'Database Application',
  database_sync: 'Monitoring Sinkronisasi',
  sheets_sync: 'Google Sheets Sync',
  offline_sync: 'Sinkronisasi Offline',
  installer_dashboard: 'Dashboard Teknisi',
  installer_portal: 'Tugas Saya',
  installer_tasks: 'Tugas Saya',
  installer_whatsapp: 'WhatsApp Pelanggan',
  installer_chat: 'Live Chat Center'
};

export const Header: React.FC<HeaderProps> = ({ activeTab, onNavigate, onSelectTicket }) => {
  const {
    currentUser,
    users,
    todayWIB,
    logout,
    contractorsList,
    areasList,
    databaseStatus,
    syncStatus,
    syncStage,
    isProgressiveHydrating,
    syncError,
    lastSyncTime,
    refreshDatabaseData,
    setIsChangePasswordModalOpen,
    tickets,
    scopedTickets,
    realtimeConnectionState,
    realtimeStatusInfo,
    reconnectRealtimeNow,
    lastKpiUpdatedAt
  } = useApp();
  const { config, setSidebarState, displayMode, canSwitchDisplayMode, setDisplayMode, isMobileView } = useUIConfig();
  const { isOnline, isSyncing, pendingCount, setIsOfflineModalOpen, isSimulatedOffline } = useOfflineSync();
  const { triggerRefresh } = useAnimation();
  const { toast } = useToast();
  const { playSyncSound } = useMoraJawsSound();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [connectionMonitorOpen, setConnectionMonitorOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [quickResults, setQuickResults] = useState<Ticket[]>([]);
  const [isQuickSearching, setIsQuickSearching] = useState(false);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const quickSearchRef = useRef<HTMLDivElement>(null);
  const quickSearchInputRef = useRef<HTMLInputElement>(null);
  const connectionMonitorRef = useRef<HTMLDivElement>(null);

  const canCrossDateSearch = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  useEffect(() => {
    const q = quickSearch.trim();
    if (!q || currentUser.role === 'installer') {
      setQuickResults([]);
      setIsQuickSearching(false);
      return;
    }

    const qLower = q.toLowerCase();
    const pool = canCrossDateSearch ? tickets : scopedTickets;
    const localSearch = () =>
      (pool || [])
        .filter(
          t =>
            !t.isDeleted &&
            (t.woNumber?.toLowerCase().includes(qLower) ||
              t.idCustomer?.toLowerCase().includes(qLower) ||
              t.customerName?.toLowerCase().includes(qLower) ||
              t.customerPhone?.toLowerCase().includes(qLower) ||
              t.installerName?.toLowerCase().includes(qLower))
        )
        .slice(0, 8);

    if (!canCrossDateSearch || !isOnline) {
      setQuickResults(localSearch());
      setIsQuickSearching(false);
      return;
    }

    let cancelled = false;
    setIsQuickSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tickets/search?q=${encodeURIComponent(q)}`, {
          credentials: 'include',
          headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Search failed');
        const json = await res.json();
        if (!cancelled) {
          setQuickResults(Array.isArray(json.tickets) ? json.tickets.slice(0, 8) : localSearch());
        }
      } catch {
        if (!cancelled) {
          setQuickResults(localSearch());
        }
      } finally {
        if (!cancelled) setIsQuickSearching(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [quickSearch, canCrossDateSearch, isOnline, tickets, scopedTickets, currentUser.role]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (quickSearchRef.current && !quickSearchRef.current.contains(e.target as Node)) {
        setQuickSearchOpen(false);
      }
      if (connectionMonitorRef.current && !connectionMonitorRef.current.contains(e.target as Node)) {
        setConnectionMonitorOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuickSearchOpen(false);
        setConnectionMonitorOpen(false);
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const isTypingField =
          tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable);
        if (!isTypingField && quickSearchInputRef.current) {
          e.preventDefault();
          quickSearchInputRef.current.focus();
          setQuickSearchOpen(true);
        }
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const headerTelemetry = useMemo(() => {
    const todayScoped = (scopedTickets || []).filter(
      t => !t.isDeleted && !t.isArchived && getTicketAppointmentDate(t) === todayWIB
    );
    const openCount = todayScoped.filter(
      t => String(t.statusWOAgent || '').trim().toLowerCase() !== 'closed'
    ).length;
    const completedCount = todayScoped.filter(
      t =>
        String(t.statusWOAgent || '').trim().toLowerCase() === 'closed' ||
        String(t.approvalStatus || '').trim().toUpperCase() === 'APPROVED'
    ).length;
    const slaPct =
      todayScoped.length > 0 ? Math.round((completedCount / todayScoped.length) * 1000) / 10 : 0;

    const totalTechs = (users || []).filter(u => u.role === 'installer' && u.active !== false).length;
    const activeTechNames = new Set(
      todayScoped
        .map(t => String(t.installerName || t.installerId || '').trim().toLowerCase())
        .filter(Boolean)
    );
    return {
      totalToday: todayScoped.length,
      openCount,
      activeTechs: activeTechNames.size,
      totalTechs,
      slaPct
    };
  }, [scopedTickets, todayWIB, users]);

  const handleGlobalRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      playSyncSound();
      await triggerRefresh(async () => {
        await refreshDatabaseData();
      }, 'SINKRONISASI REAL-TIME CLOUD...', 'Menyelaraskan data Work Order, Statistik, Jadwal, dan Konfigurasi');
      toast.success('Sinkronisasi dan Refresh Berhasil');
    } catch (err) {
      console.error('Refresh error:', err);
      toast.error('Gagal memperbarui data dari server');
    } finally {
      setIsRefreshing(false);
    }
  };

  const isCentralOpsRole =
    currentUser.role === 'super_admin' || currentUser.role === 'dispatch';
  const activeContractor = isCentralOpsRole
    ? ''
    : currentUser.contractor || (contractorsList?.[0] || '');
  const activeArea = isCentralOpsRole
    ? ''
    : currentUser.area || (areasList?.[0] || '');
  const activePageTitle = TAB_TITLES[activeTab] || 'Work Order Operations';
  const formattedToday = formatIndonesianWODate(todayWIB);

  const getInitials = (name?: string) => {
    if (!name) return 'MJ';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(s => s[0].toUpperCase())
      .join('');
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'super_admin':
        return <ShieldCheck className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE]" />;
      case 'dispatch':
        return <Shield className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#A78BFA]" />;
      case 'leader':
        return <Building2 className="w-3.5 h-3.5 text-[#C88735] dark:text-[#E59A27]" />;
      case 'installer':
        return <Wrench className="w-3.5 h-3.5 text-[#218A63] dark:text-[#16A36A]" />;
      default:
        return <Shield className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#766B83]" />;
    }
  };

  const formattedLastSyncWIB = useMemo(() => {
    if (!lastSyncTime) return '';
    const d = new Date(lastSyncTime);
    if (Number.isNaN(d.getTime())) return '';
    return (
      d.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
      }) + ' WIB'
    );
  }, [lastSyncTime]);

  const formatWibTimestamp = (iso?: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return (
      d.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
      }) + ' WIB'
    );
  };

  const sseVisualState = useMemo(() => {
    if (!isOnline || syncStatus === 'OFFLINE') {
      return {
        label: isSimulatedOffline ? 'SIMULASI OFFLINE' : 'OFFLINE',
        shortLabel: 'Offline',
        dotClass: 'bg-[#D45B66] dark:bg-rose-500',
        textClass: 'text-[#9B2C37] dark:text-rose-300',
        pillClass:
          'bg-[#FCE9EB] text-[#9B2C37] dark:bg-rose-500/15 dark:text-rose-300 border border-[#D45B66]/30 dark:border-rose-500/25'
      };
    }
    const isDeltaPolling = realtimeStatusInfo.transport === 'delta_polling';
    if (realtimeConnectionState === 'connected') {
      return {
        label: isDeltaPolling ? 'Delta Sync: Live' : 'SSE: Live Sync',
        shortLabel: isDeltaPolling ? 'DELTA LIVE' : 'LIVE',
        dotClass: 'bg-[#218A63] dark:bg-emerald-400 animate-pulse',
        textClass: 'text-[#218A63] dark:text-emerald-300',
        pillClass:
          'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-500/12 dark:text-emerald-300 border border-[#218A63]/25 dark:border-emerald-500/20'
      };
    }
    if (realtimeConnectionState === 'reconnecting') {
      const attempt = realtimeStatusInfo.reconnectAttempt || 1;
      return {
        label: isDeltaPolling ? `Sync Retry (${attempt})` : `Reconnect (${attempt})`,
        shortLabel: `RETRY ${attempt}`,
        dotClass: 'bg-[#C88735] dark:bg-amber-400 animate-pulse',
        textClass: 'text-[#9D661F] dark:text-amber-300',
        pillClass:
          'bg-[#FFF2D9] text-[#9D661F] dark:bg-amber-500/15 dark:text-amber-300 border border-[#C88735]/30 dark:border-amber-500/25'
      };
    }
    if (realtimeConnectionState === 'connecting') {
      return {
        label: 'Connecting...',
        shortLabel: 'CONNECTING',
        dotClass: 'bg-[#3E81C6] dark:bg-sky-400 animate-pulse',
        textClass: 'text-[#3E81C6] dark:text-sky-300',
        pillClass:
          'bg-[#E7F1FB] text-[#3E81C6] dark:bg-sky-500/15 dark:text-sky-300 border border-[#3E81C6]/30 dark:border-sky-500/25'
      };
    }
    return {
      label: isDeltaPolling ? 'Sync Terputus' : 'SSE Terputus',
      shortLabel: 'TERPUTUS',
      dotClass: 'bg-[#D45B66] dark:bg-rose-500',
      textClass: 'text-[#9B2C37] dark:text-rose-300',
      pillClass:
        'bg-[#FCE9EB] text-[#9B2C37] dark:bg-rose-500/15 dark:text-rose-300 border border-[#D45B66]/30 dark:border-rose-500/25'
    };
  }, [isOnline, syncStatus, isSimulatedOffline, realtimeConnectionState, realtimeStatusInfo.reconnectAttempt, realtimeStatusInfo.transport]);

  const renderConnectionMonitorPopover = () => (
    <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-[#DDE6F0] dark:border-white/15 p-3.5 z-50 text-xs space-y-3 pointer-events-auto">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DDE6F0] dark:border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sseVisualState.dotClass}`} />
          <div className="min-w-0">
            <div className="font-bold text-[#26364A] dark:text-white truncate">Realtime Connection Monitor</div>
            <div className="text-[10.5px] font-mono text-[#52647A] dark:text-[#CEC0E8] truncate">
              State: {realtimeConnectionState} · Bridge: {realtimeStatusInfo.bridgeStatus || 'standby'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConnectionMonitorOpen(false)}
          className="p-1 rounded-lg text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
          aria-label="Tutup Connection Monitor"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl p-2.5 border border-[#DDE6F0] dark:border-white/10">
        <div>
          <div className="text-[#8492A5] dark:text-[#A493C2] text-[10px] uppercase font-bold">Last Connected</div>
          <div className="font-mono font-semibold text-[#26364A] dark:text-white tabular-nums">
            {formatWibTimestamp(realtimeStatusInfo.lastConnectedAt)}
          </div>
        </div>
        <div>
          <div className="text-[#8492A5] dark:text-[#A493C2] text-[10px] uppercase font-bold">Last Event</div>
          <div className="font-mono font-semibold text-[#26364A] dark:text-white tabular-nums">
            {formatWibTimestamp(realtimeStatusInfo.lastEventAt)}
          </div>
        </div>
        <div>
          <div className="text-[#8492A5] dark:text-[#A493C2] text-[10px] uppercase font-bold">Last KPI Sync</div>
          <div className="font-mono font-semibold text-[#26364A] dark:text-white tabular-nums">
            {formatWibTimestamp(lastKpiUpdatedAt)}
          </div>
        </div>
        <div>
          <div className="text-[#8492A5] dark:text-[#A493C2] text-[10px] uppercase font-bold">Event Cursor / Retry</div>
          <div className="font-mono font-semibold text-[#26364A] dark:text-white tabular-nums truncate">
            #{realtimeStatusInfo.lastEventId || '0'} · Retry {realtimeStatusInfo.reconnectAttempt}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            reconnectRealtimeNow();
            toast.info('Menghubungkan ulang stream SSE real-time...');
          }}
          className="flex-1 py-2 px-3 rounded-xl bg-[#EAE8FF] dark:bg-[#35105E] hover:brightness-95 text-[#5145A6] dark:text-[#E9D5FF] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Radio className="w-3.5 h-3.5" />
          <span>Reconnect Now</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setConnectionMonitorOpen(false);
            handleGlobalRefresh();
          }}
          disabled={isRefreshing}
          className="flex-1 py-2 px-3 rounded-xl bg-[#E4F5EC] dark:bg-emerald-500/20 hover:brightness-95 text-[#218A63] dark:text-emerald-300 font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Sync Sekarang</span>
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
          Log Diagnostik Terbaru ({Math.min(realtimeStatusInfo.logs.length, 12)})
        </div>
        <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono text-[10px]">
          {realtimeStatusInfo.logs.length === 0 ? (
            <div className="text-[#8492A5] dark:text-[#A493C2] py-2 text-center">Belum ada aktivitas stream.</div>
          ) : (
            realtimeStatusInfo.logs.slice(0, 12).map(log => (
              <div
                key={log.id}
                className="px-2 py-1 rounded-lg bg-[#F8FAFD] dark:bg-[#140827] border border-[#DDE6F0] dark:border-white/10 flex items-start gap-1.5"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${
                    log.level === 'error'
                      ? 'bg-[#D45B66]'
                      : log.level === 'warn'
                      ? 'bg-[#C88735]'
                      : 'bg-[#218A63]'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 text-[#5145A6] dark:text-[#D8B4FE] font-bold">
                    <span className="truncate">{log.event}</span>
                    <span className="text-[9.5px] text-[#8492A5] shrink-0 tabular-nums">
                      {formatWibTimestamp(log.timestamp).replace(' WIB', '')}
                    </span>
                  </div>
                  <div className="text-[#52647A] dark:text-[#CEC0E8] break-words">{log.detail}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  if (currentUser.role === 'installer') {
    const liveBadge = !isOnline || syncStatus === 'OFFLINE'
      ? {
          label: isSimulatedOffline ? 'SIMULASI OFFLINE' : 'OFFLINE',
          pillClass: 'bg-[#FFF2D9] text-[#C88735] dark:bg-amber-500/15 dark:text-amber-300 border border-[#C88735]/30 dark:border-amber-500/25',
          dotClass: 'bg-[#C88735] dark:bg-amber-500'
        }
      : isSyncing || isRefreshing || syncStatus === 'SYNCING' || syncStatus === 'LOADING' || isProgressiveHydrating
      ? {
          label: 'SYNCING',
          pillClass: 'bg-[#F0EDFF] text-[#5145A6] dark:bg-[#7135b5]/12 dark:text-[#DAB9FF] border border-[#6657C8]/25 dark:border-[#7135b5]/25',
          dotClass: 'bg-[#6657C8] dark:bg-[#7135b5] animate-pulse'
        }
      : syncStatus === 'ERROR'
      ? {
          label: 'SYNC FAILED',
          pillClass: 'bg-[#FCE9EB] text-[#D45B66] dark:bg-rose-500/15 dark:text-rose-300 border border-[#D45B66]/30 dark:border-rose-500/25',
          dotClass: 'bg-[#D45B66] dark:bg-rose-500'
        }
      : realtimeConnectionState === 'connected'
      ? {
          label: formattedLastSyncWIB ? `LIVE · ${formattedLastSyncWIB}` : 'LIVE SSE',
          pillClass: 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-500/12 dark:text-emerald-300 border border-[#218A63]/25 dark:border-emerald-500/20',
          dotClass: 'bg-[#218A63] dark:bg-emerald-500 animate-pulse'
        }
      : {
          label: sseVisualState.shortLabel,
          pillClass: sseVisualState.pillClass,
          dotClass: sseVisualState.dotClass
        };

    const subtitleText = [
      'TECH',
      activeArea || activeContractor || formattedToday
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <div className="sticky top-2.5 sm:top-3 z-40 w-full px-3 sm:px-5 pt-safe pointer-events-none">
        <header className="pointer-events-auto max-w-lg md:max-w-3xl lg:max-w-6xl mx-auto h-14 sm:h-[60px] px-3 sm:px-4 rounded-full mj-glass-capsule flex items-center justify-between gap-2 transition-all">
          {/* Left: 3D Crystal Hub + Field Dispatch + Live Telemetry */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate('installer_dashboard')}
              title="Kembali ke Dashboard Field Dispatch"
              aria-label="Kembali ke Dashboard Field Dispatch"
              className="w-9 h-9 rounded-full bg-gradient-to-br from-[#65B8C4] via-[#6657C8] to-[#5145A6] dark:from-[#8b5cf6] dark:via-[#6d28d9] dark:to-[#35105e] p-0.5 shrink-0 shadow-[0_4px_12px_rgba(102,87,200,0.28),inset_0_1px_1px_rgba(255,255,255,0.65)] dark:shadow-[0_4px_12px_rgba(88,20,156,0.35),inset_0_1px_1px_rgba(255,255,255,0.45)] active:scale-95 transition-transform cursor-pointer"
            >
              <span className="w-full h-full rounded-full bg-[#6657C8]/95 dark:bg-[#160d33] flex items-center justify-center border border-white/40 dark:border-white/25">
                <Network className="w-4 h-4 text-white dark:text-[#e9d5ff]" strokeWidth={2.2} />
              </span>
            </button>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onNavigate('installer_dashboard')}
                  className="font-display font-extrabold text-[14px] sm:text-[16px] tracking-tight text-[#26364A] dark:text-white leading-none truncate cursor-pointer text-left"
                >
                  {activeTab === 'installer_dashboard' ? 'Field Dispatch' : activePageTitle}
                </button>
                <div className="relative" ref={connectionMonitorRef}>
                  <button
                    type="button"
                    onClick={() => setConnectionMonitorOpen(prev => !prev)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold tracking-wider uppercase leading-none shrink-0 cursor-pointer ${liveBadge.pillClass}`}
                    title="Lihat status koneksi real-time SSE"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${liveBadge.dotClass} mj-glow-dot`} />
                    <span>{liveBadge.label}</span>
                  </button>
                  {connectionMonitorOpen && renderConnectionMonitorPopover()}
                </div>
              </div>
              <span className="text-[10px] font-semibold text-[#52647A] dark:text-[#CEC0E8] flex items-center gap-1 mt-0.5 truncate uppercase tracking-wide">
                <BadgeCheck className="w-3 h-3 text-[#6657C8] dark:text-[#C77BE9] shrink-0" />
                <span className="truncate">{subtitleText}</span>
              </span>
            </div>
          </div>

          {/* Right: Telemetry / Offline Queue Button, Quick Sync, & Circular User Avatar */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsOfflineModalOpen(true)}
              aria-label="Status Sinkronisasi & Telemetri Jaringan"
              title={`Antrean Offline: ${pendingCount} · Status: ${liveBadge.label}`}
              className={`relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all cursor-pointer active:scale-95 ${
                pendingCount > 0 || !isOnline
                  ? 'bg-[#FFF2D9] text-[#C88735] border border-[#C88735]/35 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/40'
                  : 'mj-floating-nav-pill-idle'
              }`}
            >
              {isOnline ? <Radio className="w-[17px] h-[17px]" /> : <WifiOff className="w-[17px] h-[17px]" />}
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-[#C88735] dark:bg-amber-500 text-white text-[9.5px] font-extrabold flex items-center justify-center ring-2 ring-white dark:ring-[#160D29] tabular-nums">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleGlobalRefresh}
              disabled={isRefreshing}
              aria-label="Sinkronisasi data cloud"
              title="Sinkronisasi cloud sekarang"
              className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full mj-floating-nav-pill-idle cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <NotificationBell
              onNavigate={onNavigate}
              onSelectTicket={onSelectTicket}
              onOpenMenu={() => setUserMenuOpen(false)}
              buttonClassName="relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full mj-floating-nav-pill-idle cursor-pointer active:scale-95"
            />

            {/* User Account Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-label="Profil & Pengaturan Akun"
                className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#65B8C4] via-[#6657C8] to-[#5145A6] dark:from-[#8b5cf6] dark:to-[#58149c] p-0.5 text-white font-display font-bold text-xs flex items-center justify-center shadow-[0_3px_10px_rgba(102,87,200,0.28)] dark:shadow-[0_3px_10px_rgba(88,20,156,0.35)] hover:opacity-95 active:scale-95 transition-all cursor-pointer relative ml-0.5"
              >
                <span className="w-full h-full rounded-full bg-[#5145A6] dark:bg-[#1b1238] flex items-center justify-center border border-white/40 dark:border-white/30">
                  {getInitials(currentUser.name)}
                </span>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#F4F7FB] dark:border-[#160D29] ${
                    isOnline ? 'bg-[#218A63] dark:bg-emerald-500' : 'bg-[#C88735] dark:bg-amber-500'
                  }`}
                />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-3 w-72 max-w-[calc(100vw-1.5rem)] bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-[#DDE6F0] dark:border-white/15 py-2 z-50 text-xs">
                    <div className="px-4 py-2.5 border-b border-[#DDE6F0] dark:border-white/10 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#26364A] dark:text-white truncate">{currentUser.name}</span>
                        {getRoleIcon(currentUser.role)}
                      </div>
                      <div className="font-mono text-[11px] text-[#5145A6] dark:text-[#D8B4FE]">@{currentUser.username}</div>
                      <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] pt-1 space-y-0.5">
                        <div>
                          Tanggal Ops: <span className="font-mono font-semibold text-[#26364A] dark:text-white">{formattedToday}</span>
                        </div>
                        {activeContractor && (
                          <div className="truncate">
                            Vendor: <span className="font-medium text-[#26364A] dark:text-white">{activeContractor}</span>
                          </div>
                        )}
                        {activeArea && (
                          <div className="truncate">
                            Wilayah: <span className="font-medium text-[#26364A] dark:text-white">{activeArea}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-2 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setIsOfflineModalOpen(true);
                        }}
                        className="w-full text-left py-2.5 px-3 rounded-xl text-xs font-semibold text-[#26364A] dark:text-[#E9D5FF] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <Cloud className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE]" />
                          <span>Pusat Sinkronisasi Offline</span>
                        </span>
                        <span className="font-mono text-[11px] text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">{pendingCount} Pending</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          handleGlobalRefresh();
                        }}
                        className="w-full text-left py-2.5 px-3 rounded-xl text-xs font-semibold text-[#26364A] dark:text-[#E9D5FF] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                      >
                        <span>Sync Cloud Sekarang</span>
                        <RefreshCw className={`w-3.5 h-3.5 text-[#6657C8] dark:text-current ${isRefreshing ? 'animate-spin' : ''}`} />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setIsChangePasswordModalOpen(true);
                        }}
                        className="w-full text-left py-2.5 px-3 rounded-xl text-xs font-semibold text-[#26364A] dark:text-[#E9D5FF] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <KeyRound className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE]" />
                          <span>Ganti Password</span>
                        </span>
                        <span>&rarr;</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          logout();
                        }}
                        className="w-full text-center py-2.5 px-3 bg-[#FCE9EB] dark:bg-[#ba1a1a]/10 hover:bg-[#D45B66]/20 dark:hover:bg-[#ba1a1a]/20 text-[#D45B66] dark:text-rose-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-1"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Keluar / Logout dari Sistem</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="sticky top-2.5 sm:top-3 z-40 w-full px-2.5 sm:px-4 lg:px-5 pt-safe pointer-events-none">
      <header
        data-testid="floating-topbar"
        className={`pointer-events-auto w-full mx-auto h-14 sm:h-[60px] rounded-full mj-glass-capsule flex items-center justify-between gap-2 sm:gap-3 transition-all ${
          isMobileView ? 'px-2.5 sm:px-4' : 'px-3 sm:px-5'
        }`}
      >
        {/* Zone 1: Toggle + Breadcrumbs + Engine & Telemetry Strip */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => {
              const current = config.global.sidebarState || 'expanded';
              setSidebarState(current === 'closed' ? 'expanded' : 'closed');
            }}
            className="w-9 h-9 rounded-full mj-floating-nav-pill-idle flex items-center justify-center cursor-pointer shrink-0"
            title="Buka / Tutup Sidebar"
            aria-label="Buka / Tutup Sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {/* Compact identity in Mobile Mode; full Breadcrumb trail + Engine Status in Desktop Mode */}
          {isMobileView ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-white/95 dark:bg-[#140D33]/90 border border-[#D8CCF3] dark:border-purple-400/35 flex items-center justify-center shadow-sm shrink-0">
                <MoraJawsLogo variant="symbol" size={24} animated={false} withGlow={false} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-display font-extrabold text-[13px] sm:text-[14px] text-[#26364A] dark:text-white tracking-tight leading-none truncate">
                    {config.global.appName || 'MoraJaws'} Ops
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-purple-500/25 text-[#5145A6] dark:text-purple-200 border border-[#D4CEFA] dark:border-purple-400/30 text-[9px] font-extrabold tracking-wider uppercase leading-none shrink-0">
                    {currentUser.role === 'super_admin'
                      ? 'ADMIN'
                      : currentUser.role === 'dispatch'
                      ? 'DISPATCH'
                      : currentUser.role === 'leader'
                      ? 'LEADER'
                      : 'OPS'}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 mj-glow-dot ${isOnline ? 'bg-[#218A63] dark:bg-emerald-500' : 'bg-[#C88735] dark:bg-amber-500'}`} />
                  <span className="text-[10px] font-semibold text-[#6657C8] dark:text-[#CEC0E8] truncate">
                    {activePageTitle}
                    {currentUser.role === 'leader' && (activeArea || activeContractor)
                      ? ` · ${activeArea || activeContractor}`
                      : ''}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <nav
                aria-label="Breadcrumb"
                className="hidden xl:flex items-center gap-1.5 text-xs text-[#8492A5] dark:text-[#CEC0E8]/75 truncate max-w-[230px]"
              >
                <button
                  type="button"
                  onClick={() =>
                    onNavigate(
                      currentUser.role === 'dispatch'
                        ? 'tickets'
                        : currentUser.role === 'leader'
                        ? 'wo_assignment'
                        : 'dashboard'
                    )
                  }
                  className="hover:text-[#5145A6] dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap font-semibold"
                >
                  {config.global.appName || 'MoraJaws'}
                </button>
                <span aria-hidden="true">/</span>
                <span className="text-[#5145A6] dark:text-[#C77BE9] font-bold truncate">
                  {activePageTitle}
                </span>
              </nav>

              {/* Page title shown cleanly on Tablet / Small Desktop (<1280px) where full breadcrumb is hidden */}
              <span className="xl:hidden text-xs sm:text-sm font-bold text-[#26364A] dark:text-white truncate">
                {activePageTitle}
              </span>

              {/* Floating Cluster & SSE Live Sync Pill with Connection Monitor Popover */}
              <div className="relative hidden lg:block shrink-0" ref={connectionMonitorRef}>
                <button
                  type="button"
                  onClick={() => setConnectionMonitorOpen(prev => !prev)}
                  className="flex items-center gap-2 px-3 py-1 bg-[#EDF3F8]/95 hover:bg-white dark:bg-white/[0.06] dark:hover:bg-white/[0.1] border border-[#DDE6F0] dark:border-white/[0.14] rounded-full text-[#26364A] dark:text-[#E9D5FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-none shrink-0 cursor-pointer transition-colors"
                  title="Klik untuk membuka Realtime Connection Monitor & Log Diagnostik"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 mj-glow-dot ${sseVisualState.dotClass}`} />
                  <span className="text-[11px] font-bold tracking-wide uppercase whitespace-nowrap">
                    {currentUser.role === 'dispatch'
                      ? 'Dispatch Ops'
                      : currentUser.role === 'super_admin'
                      ? 'Superadmin'
                      : currentUser.role === 'leader'
                      ? 'Leader Console'
                      : 'Ops Console'}
                  </span>
                  <span className="text-[#CFDCE8] dark:text-white/25">•</span>
                  <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold whitespace-nowrap ${sseVisualState.textClass}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sseVisualState.dotClass}`} />
                    <span>{sseVisualState.label}</span>
                  </span>
                  <span className="hidden xl:inline text-[#CFDCE8] dark:text-white/25">•</span>
                  <Calendar className="hidden xl:inline w-3.5 h-3.5 text-[#6657C8] dark:text-[#A7A1F0] shrink-0" />
                  <span className="hidden xl:inline text-[11px] font-bold text-[#5145A6] dark:text-[#dab9ff] tracking-tight whitespace-nowrap tabular-nums">
                    {activeArea ? `${activeArea} · ${formattedToday}` : formattedToday}
                  </span>
                </button>
                {connectionMonitorOpen && renderConnectionMonitorPopover()}
              </div>

              {/* Live Telemetry Counters on 2xl */}
              <div className="hidden 2xl:flex items-center gap-3 pl-1 text-xs shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-semibold text-[#8492A5] dark:text-[#CEC0E8]/80 uppercase">Open:</span>
                  <span className="font-display font-bold text-[#26364A] dark:text-white tabular-nums">
                    {headerTelemetry.openCount}
                  </span>
                </div>
                <span className="w-1 h-3 bg-[#DDE6F0] dark:bg-white/20 rounded-full" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-semibold text-[#8492A5] dark:text-[#CEC0E8]/80 uppercase">Techs:</span>
                  <span className="font-display font-bold text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                    {headerTelemetry.activeTechs}/{headerTelemetry.totalTechs}
                  </span>
                </div>
                <span className="w-1 h-3 bg-[#DDE6F0] dark:bg-white/20 rounded-full" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-semibold text-[#8492A5] dark:text-[#CEC0E8]/80 uppercase">Done:</span>
                  <span className="font-display font-bold text-[#218A63] dark:text-emerald-300 tabular-nums">
                    {headerTelemetry.slaPct}%
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Zone 2: Quick Cross-Date Search with 3D Inset Floating Pill (Desktop >= 1024px non-mobile mode) */}
        {!isMobileView && (
          <div ref={quickSearchRef} className="hidden lg:block flex-1 max-w-xs xl:max-w-sm mx-2 relative">
            <div className="relative flex items-center w-full">
              <Search className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#27B9D9] absolute left-3.5 pointer-events-none" />
              <input
                ref={quickSearchInputRef}
                type="text"
                value={quickSearch}
                onFocus={() => setQuickSearchOpen(true)}
                onChange={e => {
                  setQuickSearch(e.target.value);
                  setQuickSearchOpen(true);
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setQuickSearch('');
                    setQuickSearchOpen(false);
                  }
                }}
                placeholder={
                  canCrossDateSearch
                    ? 'Lookup Ticket, OLT, Splitter ID...'
                    : 'Cari Work Order hari ini...'
                }
                aria-label="Quick Cross-Date Search"
                className="w-full pl-9 pr-14 py-1.5 mj-search-inset-well rounded-full text-xs text-[#26364A] dark:text-white placeholder:text-[#8492A5] dark:placeholder:text-slate-400 focus:outline-none focus:border-[#6657C8] dark:focus:border-purple-400 focus:ring-2 focus:ring-[#6657C8]/25 dark:focus:ring-purple-500/30 transition-all"
              />
              {quickSearch ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuickSearch('');
                    setQuickResults([]);
                  }}
                  className="absolute right-2.5 p-0.5 text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                  aria-label="Bersihkan pencarian cepat"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div className="absolute right-2 px-2 py-0.5 rounded-full bg-white/95 dark:bg-white/10 font-mono text-[10px] font-bold text-[#6657C8] dark:text-slate-200 pointer-events-none border border-[#DDE6F0] dark:border-white/15">
                  /
                </div>
              )}
            </div>

            {quickSearchOpen && quickSearch.trim().length > 0 && (
              <div className="absolute left-0 right-0 mt-2.5 bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-2xl border border-[#DDE6F0] dark:border-white/15 rounded-2xl shadow-2xl z-50 overflow-hidden text-xs">
                <div className="px-3 py-2 bg-[#F8FAFD] dark:bg-[#22123F] border-b border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between text-[10.5px] font-bold text-[#52647A] dark:text-[#A78BFA] uppercase">
                  <span>{canCrossDateSearch ? 'Hasil Pencarian Lintas Tanggal' : 'Hasil Work Order'}</span>
                  {isQuickSearching ? (
                    <Loader2 className="w-3 h-3 animate-spin text-[#6657C8]" />
                  ) : (
                    <span className="font-mono tabular-nums">{quickResults.length} WO</span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#DDE6F0] dark:divide-[#35105E]">
                  {!isQuickSearching && quickResults.length === 0 ? (
                    <div className="p-4 text-center text-[#8492A5]">
                      Tidak ditemukan WO untuk &ldquo;{quickSearch}&rdquo;
                    </div>
                  ) : (
                    quickResults.map(t => (
                      <button
                        key={`hdr-search-${t.id}`}
                        type="button"
                        onClick={() => {
                          setQuickSearchOpen(false);
                          setQuickSearch('');
                          if (onSelectTicket) onSelectTicket(t, 'overview');
                          else onNavigate('tickets');
                        }}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-[#F0EDFF] dark:hover:bg-[#35105E]/60 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">
                              {t.woNumber}
                            </span>
                            <span className="font-mono text-[10px] text-[#8492A5]">
                              {getTicketAppointmentDate(t) || '-'}
                            </span>
                          </div>
                          <div className="font-semibold text-[#26364A] dark:text-white truncate">
                            {t.customerName} · {t.idCustomer || '-'}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] text-[10px] font-bold shrink-0">
                          {t.statusWOInstaller || t.statusWOAgent || 'OPEN'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Zone 2 & 3: Display Mode Switch + Connectivity + Cloud Live + Quick Actions + Notifications + User Profile */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Display Mode Switch: Available for ALL non-Teknisi roles (hidden strictly for installer) */}
          {canSwitchDisplayMode && (
            <div
              role="group"
              aria-label="Display Mode Switch"
              data-testid="display-mode-switch"
              className="inline-flex items-center p-1 rounded-full bg-[#EDF3F8]/95 dark:bg-black/30 border border-[#DDE6F0] dark:border-white/15 shadow-[inset_0_1px_2px_rgba(38,54,74,0.06)] shrink-0 gap-0.5"
            >
              <button
                type="button"
                onClick={() => setDisplayMode('desktop')}
                aria-label="Desktop Mode"
                aria-pressed={displayMode === 'desktop'}
                data-testid="display-mode-desktop"
                title="Desktop Mode — Tampilan tabel lengkap, grid desktop, dan sidebar penuh"
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1 min-h-[28px] rounded-full text-[11px] leading-none font-semibold tracking-tight transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                  displayMode === 'desktop'
                    ? 'mj-floating-nav-pill-active text-white'
                    : 'text-[#52647A] hover:text-[#26364A] hover:bg-white/75 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-white/10'
                }`}
              >
                <Monitor className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Desktop</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('mobile')}
                aria-label="Mobile Mode"
                aria-pressed={displayMode === 'mobile'}
                data-testid="display-mode-mobile"
                title="Mobile Mode — Tampilan kartu compact dan drawer navigation"
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1 min-h-[28px] rounded-full text-[11px] leading-none font-semibold tracking-tight transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                  displayMode === 'mobile'
                    ? 'mj-floating-nav-pill-active text-white'
                    : 'text-[#52647A] hover:text-[#26364A] hover:bg-white/75 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-white/10'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Mobile</span>
              </button>
            </div>
          )}

          {/* Cloud Live Pill & Trigger Refresh */}
          <button
            type="button"
            onClick={handleGlobalRefresh}
            disabled={isRefreshing}
            data-testid="cloud-sync-indicator"
            className={`${isMobileView ? 'hidden sm:flex' : 'hidden md:flex'} items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full border transition-all cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 ${
              !isOnline || syncStatus === 'OFFLINE'
                ? 'bg-[#FFF2D9] border-[#C88735]/35 text-[#C88735] dark:bg-amber-500/20 dark:border-amber-400/35 dark:text-amber-200'
                : syncStatus === 'ERROR'
                ? 'bg-[#FCE9EB] border-[#D45B66]/35 text-[#D45B66] dark:bg-rose-500/20 dark:border-rose-400/35 dark:text-rose-200'
                : isRefreshing || syncStatus === 'SYNCING' || syncStatus === 'LOADING' || isProgressiveHydrating
                ? 'bg-[#F0EDFF] border-[#6657C8]/30 text-[#5145A6] dark:bg-purple-500/20 dark:border-purple-400/35 dark:text-[#D8B4FE]'
                : 'bg-[#E4F5EC] hover:bg-[#D5EFE1] border-[#218A63]/25 text-[#218A63] dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:border-emerald-400/30 dark:text-emerald-300'
            }`}
            title={`Supabase PostgreSQL: ${databaseStatus} / ${syncStatus} (${syncStage})${
              formattedLastSyncWIB ? ` | Terakhir sinkron: ${formattedLastSyncWIB}` : ''
            }${syncError ? ` | Error: ${syncError}` : ''} — Klik untuk Sinkronisasi Ulang`}
          >
            {isRefreshing || syncStatus === 'SYNCING' || syncStatus === 'LOADING' || isProgressiveHydrating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : !isOnline || syncStatus === 'OFFLINE' ? (
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Cloud className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>
              {!isOnline || syncStatus === 'OFFLINE'
                ? `Offline${formattedLastSyncWIB ? ` · ${formattedLastSyncWIB}` : ''}`
                : syncStatus === 'ERROR'
                ? 'Sync Failed'
                : isRefreshing || syncStatus === 'SYNCING' || syncStatus === 'LOADING' || isProgressiveHydrating
                ? `Syncing${isProgressiveHydrating && syncStage !== 'complete' ? '...' : ''}`
                : `Synced${formattedLastSyncWIB ? ` · ${formattedLastSyncWIB}` : ''}`}
            </span>
          </button>

          {/* Exclusive Dispatch Sameday Express + Sync Cloud Quick Actions on 2xl */}
          {!isMobileView && (
            <div className="hidden 2xl:flex items-center gap-1.5 shrink-0">
              {currentUser.role === 'dispatch' && activeTab !== 'form_sameday' && (
                <button
                  type="button"
                  onClick={() => onNavigate('form_sameday')}
                  className="mj-tactile-cta-pill flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-bold cursor-pointer whitespace-nowrap"
                  title="Buat Work Order Sameday Express (Khusus Dispatch)"
                >
                  <Zap className="w-3.5 h-3.5 text-[#DDF4F4] dark:text-[#eedbff]" />
                  <span>Form Sameday Express</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleGlobalRefresh}
                disabled={isRefreshing}
                className="mj-floating-nav-pill-idle flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-60"
                title="Sinkronisasi ulang data cloud"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE] ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Sync Cloud</span>
              </button>
            </div>
          )}

          {/* Floating Notification Bell Popover + Full Drawer */}
          <NotificationBell
            onNavigate={onNavigate}
            onSelectTicket={onSelectTicket}
            onOpenMenu={() => setUserMenuOpen(false)}
          />

          {/* User Account Dropdown */}
          <div className="relative pl-0.5">
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(!userMenuOpen);
              }}
              className="flex items-center gap-2 px-1.5 py-1 rounded-full hover:bg-white/75 dark:hover:bg-white/10 transition-colors cursor-pointer group"
            >
              <div className="relative w-8 h-8 rounded-full bg-gradient-to-tr from-[#65B8C4] via-[#6657C8] to-[#5145A6] dark:from-[#8b5cf6] dark:to-[#6366f1] p-0.5 shadow-md shadow-[#6657C8]/25 dark:shadow-purple-900/35 shrink-0">
                <div className="w-full h-full rounded-full bg-[#5145A6] dark:bg-[#1b1238] text-white font-display font-bold text-xs flex items-center justify-center border border-white/40 dark:border-white/30">
                  {getInitials(currentUser.name)}
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#218A63] dark:bg-[#16A36A] ring-2 ring-white dark:ring-[#160D29]" />
              </div>
              <div className="hidden lg:flex flex-col text-left min-w-0 max-w-[140px]">
                <span className="text-xs font-bold text-[#26364A] dark:text-white group-hover:text-[#5145A6] dark:group-hover:text-[#C77BE9] transition-colors leading-tight truncate">
                  {currentUser.name}
                </span>
                <span className="text-[10px] text-[#52647A] dark:text-[#CEC0E8] capitalize leading-tight truncate">
                  {currentUser.role.replace('_', ' ')}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A78BFA] hidden lg:block shrink-0" />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-3 w-72 max-w-[calc(100vw-1.5rem)] bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-[#DDE6F0] dark:border-white/15 py-2 z-50 text-xs">
                  <div className="px-4 py-2.5 border-b border-[#DDE6F0] dark:border-white/10 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#26364A] dark:text-white truncate">{currentUser.name}</span>
                      {getRoleIcon(currentUser.role)}
                    </div>
                    <div className="font-mono text-[11px] text-[#6657C8] dark:text-[#D8B4FE]">@{currentUser.username}</div>
                    <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] pt-1 space-y-0.5">
                      <div>
                        Peran:{' '}
                        <span className="font-semibold capitalize text-[#26364A] dark:text-white">
                          {currentUser.role.replace('_', ' ')}
                        </span>
                      </div>
                      {activeContractor && (
                        <div className="truncate">
                          Vendor: <span className="font-medium text-[#26364A] dark:text-white">{activeContractor}</span>
                        </div>
                      )}
                      {activeArea && (
                        <div className="truncate">
                          Wilayah: <span className="font-medium text-[#26364A] dark:text-white">{activeArea}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-2 flex flex-col gap-1">
                    {currentUser.role === 'super_admin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          onNavigate('users');
                        }}
                        className="w-full text-left py-2 px-3 rounded-lg text-xs font-semibold text-[#26364A] dark:text-[#E9D5FF] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                      >
                        <span>Manajemen Akun & Pengguna</span>
                        <span>&rarr;</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setIsChangePasswordModalOpen(true);
                      }}
                      className="w-full text-left py-2 px-3 rounded-lg text-xs font-semibold text-[#26364A] dark:text-[#E9D5FF] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <KeyRound className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE]" />
                        <span>Ganti Password</span>
                      </span>
                      <span>&rarr;</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full text-center py-2 px-3 bg-[#FCE9EB] dark:bg-[#DC4C5A]/10 hover:bg-[#D45B66]/20 dark:hover:bg-[#DC4C5A]/20 text-[#D45B66] dark:text-rose-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-1"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Keluar / Logout dari Sistem</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Offline Queue & Online Status Chip */}
          <button
            type="button"
            onClick={() => setIsOfflineModalOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              !isOnline
                ? 'bg-[#FFF2D9] border-[#C88735]/35 text-[#C88735] dark:bg-amber-500/20 dark:border-amber-400/35 dark:text-amber-200'
                : pendingCount > 0
                ? 'bg-[#FFF2D9] border-[#C88735]/35 text-[#C88735] dark:bg-amber-500/20 dark:border-amber-400/35 dark:text-amber-200'
                : 'bg-[#E4F5EC] border-[#218A63]/25 text-[#218A63] dark:bg-emerald-500/15 dark:border-emerald-400/30 dark:text-emerald-300'
            }`}
            title="Pusat Sinkronisasi Database Offline"
          >
            {!isOnline ? (
              <>
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span className={isMobileView ? 'hidden' : 'hidden sm:inline'}>
                  {isSimulatedOffline ? 'Simulasi Offline' : 'Offline'}
                </span>
              </>
            ) : isSyncing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 text-[#6657C8] dark:text-[#7135B5]" />
                <span className={isMobileView ? 'hidden' : 'hidden sm:inline'}>Syncing</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[#218A63] dark:bg-[#16A36A] mj-glow-dot shrink-0" />
                <span className={isMobileView ? 'hidden sm:inline' : 'hidden md:inline'}>Online</span>
              </>
            )}
            {!isMobileView && (
              <span className="hidden lg:inline font-medium text-[#52647A] dark:text-[#CEC0E8] tabular-nums">
                {pendingCount} Pending
              </span>
            )}
          </button>
        </div>
      </header>
    </div>
  );
};
