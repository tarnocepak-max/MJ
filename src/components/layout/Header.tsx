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
import { ChangePasswordModal } from '../auth/ChangePasswordModal';
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
  management_data_portal: 'Management Data Portal',
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
    applyRotatedPasswordSession,
    tickets,
    scopedTickets
  } = useApp();
  const { config, setSidebarState, displayMode, canSwitchDisplayMode, setDisplayMode, isMobileView } = useUIConfig();
  const { isOnline, isSyncing, pendingCount, setIsOfflineModalOpen, isSimulatedOffline } = useOfflineSync();
  const { triggerRefresh } = useAnimation();
  const { toast } = useToast();
  const { playSyncSound } = useMoraJawsSound();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [quickResults, setQuickResults] = useState<Ticket[]>([]);
  const [isQuickSearching, setIsQuickSearching] = useState(false);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const quickSearchRef = useRef<HTMLDivElement>(null);
  const quickSearchInputRef = useRef<HTMLInputElement>(null);

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
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuickSearchOpen(false);
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
        return <ShieldCheck className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />;
      case 'dispatch':
        return <Shield className="w-3.5 h-3.5 text-[#431599] dark:text-[#A78BFA]" />;
      case 'leader':
        return <Building2 className="w-3.5 h-3.5 text-[#E59A27]" />;
      case 'installer':
        return <Wrench className="w-3.5 h-3.5 text-[#16A36A]" />;
      case 'management_data':
        return <Database className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />;
      default:
        return <Shield className="w-3.5 h-3.5 text-[#766B83]" />;
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

  if (currentUser.role === 'installer') {
    const liveBadge = !isOnline || syncStatus === 'OFFLINE'
      ? {
          label: isSimulatedOffline ? 'SIMULASI OFFLINE' : 'OFFLINE',
          pillClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25',
          dotClass: 'bg-amber-500'
        }
      : isSyncing || isRefreshing || syncStatus === 'SYNCING' || syncStatus === 'LOADING' || isProgressiveHydrating
      ? {
          label: 'SYNCING',
          pillClass: 'bg-[#7135b5]/12 text-[#58149c] dark:text-[#DAB9FF] border border-[#7135b5]/25',
          dotClass: 'bg-[#7135b5] animate-pulse'
        }
      : syncStatus === 'ERROR'
      ? {
          label: 'SYNC ERROR',
          pillClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25',
          dotClass: 'bg-rose-500'
        }
      : {
          label: formattedLastSyncWIB ? `SYNCED · ${formattedLastSyncWIB}` : 'SYNCED',
          pillClass: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20',
          dotClass: 'bg-emerald-500 animate-pulse'
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
          {/* Left: 3D Gem Purple Hub + Field Dispatch + Live Telemetry */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate('installer_dashboard')}
              title="Kembali ke Dashboard Field Dispatch"
              aria-label="Kembali ke Dashboard Field Dispatch"
              className="w-9 h-9 rounded-full bg-gradient-to-br from-[#8b5cf6] via-[#6d28d9] to-[#35105e] p-0.5 shrink-0 shadow-[0_4px_12px_rgba(88,20,156,0.35),inset_0_1px_1px_rgba(255,255,255,0.45)] active:scale-95 transition-transform cursor-pointer"
            >
              <span className="w-full h-full rounded-full bg-[#240c45]/85 dark:bg-[#160d33] flex items-center justify-center border border-white/25">
                <Network className="w-4 h-4 text-[#e9d5ff]" strokeWidth={2.2} />
              </span>
            </button>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onNavigate('installer_dashboard')}
                  className="font-display font-extrabold text-[14px] sm:text-[16px] tracking-tight text-[#1f1638] dark:text-white leading-none truncate cursor-pointer text-left"
                >
                  {activeTab === 'installer_dashboard' ? 'Field Dispatch' : activePageTitle}
                </button>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold tracking-wider uppercase leading-none shrink-0 ${liveBadge.pillClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${liveBadge.dotClass} mj-glow-dot`} />
                  <span>{liveBadge.label}</span>
                </span>
              </div>
              <span className="text-[10px] font-semibold text-[#4b4452] dark:text-[#CEC0E8] flex items-center gap-1 mt-0.5 truncate uppercase tracking-wide">
                <BadgeCheck className="w-3 h-3 text-[#58149c] dark:text-[#C77BE9] shrink-0" />
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
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/40'
                  : 'mj-floating-nav-pill-idle'
              }`}
            >
              {isOnline ? <Radio className="w-[17px] h-[17px]" /> : <WifiOff className="w-[17px] h-[17px]" />}
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-amber-500 text-white text-[9.5px] font-extrabold flex items-center justify-center ring-2 ring-white dark:ring-[#160D29] tabular-nums">
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
                className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#8b5cf6] to-[#58149c] p-0.5 text-white font-display font-bold text-xs flex items-center justify-center shadow-[0_3px_10px_rgba(88,20,156,0.35)] hover:opacity-95 active:scale-95 transition-all cursor-pointer relative ml-0.5"
              >
                <span className="w-full h-full rounded-full bg-[#240c45]/90 dark:bg-[#1b1238] flex items-center justify-center border border-white/30">
                  {getInitials(currentUser.name)}
                </span>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#fdf7ff] dark:border-[#160D29] ${
                    isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-3 w-72 max-w-[calc(100vw-1.5rem)] bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-[#e8ddff] dark:border-white/15 py-2 z-50 text-xs">
                    <div className="px-4 py-2.5 border-b border-[#e8ddff] dark:border-white/10 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#1f1638] dark:text-white truncate">{currentUser.name}</span>
                        {getRoleIcon(currentUser.role)}
                      </div>
                      <div className="font-mono text-[11px] text-[#58149c] dark:text-[#D8B4FE]">@{currentUser.username}</div>
                      <div className="text-[11px] text-[#4b4452] dark:text-[#CEC0E8] pt-1 space-y-0.5">
                        <div>
                          Tanggal Ops: <span className="font-mono font-semibold text-[#1f1638] dark:text-white">{formattedToday}</span>
                        </div>
                        {activeContractor && (
                          <div className="truncate">
                            Vendor: <span className="font-medium text-[#1f1638] dark:text-white">{activeContractor}</span>
                          </div>
                        )}
                        {activeArea && (
                          <div className="truncate">
                            Wilayah: <span className="font-medium text-[#1f1638] dark:text-white">{activeArea}</span>
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
                        className="w-full text-left py-2.5 px-3 rounded-xl text-xs font-semibold text-[#1f1638] dark:text-[#E9D5FF] hover:bg-[#f3eaff] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <Cloud className="w-3.5 h-3.5 text-[#58149c] dark:text-[#D8B4FE]" />
                          <span>Pusat Sinkronisasi Offline</span>
                        </span>
                        <span className="font-mono text-[11px] text-[#58149c] dark:text-[#D8B4FE] tabular-nums">{pendingCount} Pending</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          handleGlobalRefresh();
                        }}
                        className="w-full text-left py-2.5 px-3 rounded-xl text-xs font-semibold text-[#1f1638] dark:text-[#E9D5FF] hover:bg-[#f3eaff] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                      >
                        <span>Sync Cloud Sekarang</span>
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setChangePasswordOpen(true);
                        }}
                        className="w-full text-left py-2.5 px-3 rounded-xl text-xs font-semibold text-[#1f1638] dark:text-[#E9D5FF] hover:bg-[#f3eaff] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <KeyRound className="w-3.5 h-3.5 text-[#58149c] dark:text-[#D8B4FE]" />
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
                        className="w-full text-center py-2.5 px-3 bg-[#ba1a1a]/10 hover:bg-[#ba1a1a]/20 text-[#ba1a1a] dark:text-rose-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-1"
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
        <ChangePasswordModal
          isOpen={changePasswordOpen}
          user={currentUser}
          onClose={() => setChangePasswordOpen(false)}
          onPasswordChanged={applyRotatedPasswordSession}
        />
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
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#a855f7] via-[#6d28d9] to-[#171c58] p-0.5 shadow-sm shrink-0">
                <div className="w-full h-full rounded-[10px] bg-[#240c45] dark:bg-[#160d33] flex items-center justify-center border border-white/25">
                  <MoraJawsLogo size="sm" animated={false} withGlow={false} />
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-display font-extrabold text-[13px] sm:text-[14px] text-[#1f1638] dark:text-white tracking-tight leading-none truncate">
                    {config.global.appName || 'MoraJaws'} Ops
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[#f3eaff] dark:bg-purple-500/25 text-[#58149c] dark:text-purple-200 border border-[#d8b4fe]/60 dark:border-purple-400/30 text-[9px] font-extrabold tracking-wider uppercase leading-none shrink-0">
                    {currentUser.role === 'super_admin'
                      ? 'ADMIN'
                      : currentUser.role === 'dispatch'
                      ? 'DISPATCH'
                      : currentUser.role === 'leader'
                      ? 'LEADER'
                      : currentUser.role === 'management_data'
                      ? 'DATA'
                      : 'OPS'}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 mj-glow-dot ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-[10px] font-semibold text-[#6a46c1] dark:text-[#CEC0E8] truncate">
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
                className="hidden xl:flex items-center gap-1.5 text-xs text-[#7d7484] dark:text-[#CEC0E8]/75 truncate max-w-[230px]"
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
                  className="hover:text-[#58149c] dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap font-semibold"
                >
                  {config.global.appName || 'MoraJaws'}
                </button>
                <span aria-hidden="true">/</span>
                <span className="text-[#58149c] dark:text-[#C77BE9] font-bold truncate">
                  {activePageTitle}
                </span>
              </nav>

              {/* Page title shown cleanly on Tablet / Small Desktop (<1280px) where full breadcrumb is hidden */}
              <span className="xl:hidden text-xs sm:text-sm font-bold text-[#1f1638] dark:text-white truncate">
                {activePageTitle}
              </span>

              {/* Floating Cluster & SSE Live Sync Pill */}
              <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-[#f3eaff]/90 dark:bg-white/[0.06] border border-[#e8ddff] dark:border-white/[0.14] rounded-full text-[#1f1638] dark:text-[#E9D5FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-none shrink-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 mj-glow-dot ${
                    isOnline && databaseStatus === 'connected'
                      ? 'bg-[#7135B5] dark:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                      : 'bg-amber-500'
                  }`}
                />
                <span className="text-[11px] font-bold tracking-wide uppercase whitespace-nowrap">
                  {currentUser.role === 'dispatch'
                    ? 'Dispatch Ops'
                    : currentUser.role === 'super_admin'
                    ? 'Superadmin'
                    : currentUser.role === 'leader'
                    ? 'Leader Console'
                    : 'Ops Console'}
                </span>
                <span className="text-[#cec3d4] dark:text-white/25">•</span>
                <span
                  className={`inline-flex items-center gap-1 text-[10.5px] font-bold whitespace-nowrap ${
                    isOnline && databaseStatus === 'connected'
                      ? 'text-[#58149C] dark:text-emerald-300'
                      : 'text-amber-700 dark:text-amber-300'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isOnline && databaseStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  <span>{isOnline && databaseStatus === 'connected' ? 'SSE: Live Sync' : 'Local Sync'}</span>
                </span>
                <span className="hidden xl:inline text-[#cec3d4] dark:text-white/25">•</span>
                <Calendar className="hidden xl:inline w-3.5 h-3.5 text-[#58149c] dark:text-[#A7A1F0] shrink-0" />
                <span className="hidden xl:inline text-[11px] font-bold text-[#58149c] dark:text-[#dab9ff] tracking-tight whitespace-nowrap tabular-nums">
                  {activeArea ? `${activeArea} · ${formattedToday}` : formattedToday}
                </span>
              </div>

              {/* Live Telemetry Counters on 2xl */}
              <div className="hidden 2xl:flex items-center gap-3 pl-1 text-xs shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-semibold text-[#7d7484] dark:text-[#CEC0E8]/80 uppercase">Open:</span>
                  <span className="font-display font-bold text-[#1f1638] dark:text-white tabular-nums">
                    {headerTelemetry.openCount}
                  </span>
                </div>
                <span className="w-1 h-3 bg-[#cec3d4] dark:bg-white/20 rounded-full" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-semibold text-[#7d7484] dark:text-[#CEC0E8]/80 uppercase">Techs:</span>
                  <span className="font-display font-bold text-[#58149c] dark:text-[#D8B4FE] tabular-nums">
                    {headerTelemetry.activeTechs}/{headerTelemetry.totalTechs}
                  </span>
                </div>
                <span className="w-1 h-3 bg-[#cec3d4] dark:bg-white/20 rounded-full" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-semibold text-[#7d7484] dark:text-[#CEC0E8]/80 uppercase">Done:</span>
                  <span className="font-display font-bold text-[#6a46c1] dark:text-emerald-300 tabular-nums">
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
              <Search className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#27B9D9] absolute left-3.5 pointer-events-none" />
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
                className="w-full pl-9 pr-14 py-1.5 mj-search-inset-well rounded-full text-xs text-[#211A2E] dark:text-white placeholder:text-[#7d7484] dark:placeholder:text-slate-400 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/30 transition-all"
              />
              {quickSearch ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuickSearch('');
                    setQuickResults([]);
                  }}
                  className="absolute right-2.5 p-0.5 text-[#8B8495] hover:text-[#211A2E] dark:hover:text-white cursor-pointer"
                  aria-label="Bersihkan pencarian cepat"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div className="absolute right-2 px-2 py-0.5 rounded-full bg-white/90 dark:bg-white/10 font-mono text-[10px] font-bold text-[#7135B5] dark:text-slate-200 pointer-events-none border border-[#D8CCF3] dark:border-white/15">
                  /
                </div>
              )}
            </div>

            {quickSearchOpen && quickSearch.trim().length > 0 && (
              <div className="absolute left-0 right-0 mt-2.5 bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-2xl border border-[#E9E5F0] dark:border-white/15 rounded-2xl shadow-2xl z-50 overflow-hidden text-xs">
                <div className="px-3 py-2 bg-[#F7F6FA] dark:bg-[#22123F] border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between text-[10.5px] font-bold text-[#766B83] dark:text-[#A78BFA] uppercase">
                  <span>{canCrossDateSearch ? 'Hasil Pencarian Lintas Tanggal' : 'Hasil Work Order'}</span>
                  {isQuickSearching ? (
                    <Loader2 className="w-3 h-3 animate-spin text-[#7135B5]" />
                  ) : (
                    <span className="font-mono tabular-nums">{quickResults.length} WO</span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#E9E5F0] dark:divide-[#35105E]">
                  {!isQuickSearching && quickResults.length === 0 ? (
                    <div className="p-4 text-center text-[#8B8495]">
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
                        className="w-full text-left px-3.5 py-2.5 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]/60 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-[#35105E] dark:text-[#D8B4FE]">
                              {t.woNumber}
                            </span>
                            <span className="font-mono text-[10px] text-[#8B8495]">
                              {getTicketAppointmentDate(t) || '-'}
                            </span>
                          </div>
                          <div className="font-semibold text-[#211A2E] dark:text-white truncate">
                            {t.customerName} · {t.idCustomer || '-'}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] text-[10px] font-bold shrink-0">
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
              className="inline-flex items-center p-1 rounded-full bg-[#f3eaff]/90 dark:bg-black/30 border border-[#e8ddff] dark:border-white/15 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] shrink-0 gap-0.5"
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
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-white/10'
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
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-white/10'
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
                ? 'bg-[#FEF3C7] border-[#F59E0B]/30 text-[#B45309] dark:bg-amber-500/20 dark:border-amber-400/35 dark:text-amber-200'
                : syncStatus === 'ERROR'
                ? 'bg-[#ffdad6] border-[#ba1a1a]/30 text-[#93000a] dark:bg-rose-500/20 dark:border-rose-400/35 dark:text-rose-200'
                : isRefreshing || syncStatus === 'SYNCING' || syncStatus === 'LOADING' || isProgressiveHydrating
                ? 'bg-[#F4EAFF] border-[#A78BFA] text-[#431599] dark:bg-purple-500/20 dark:border-purple-400/35 dark:text-[#D8B4FE]'
                : 'bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/25 text-emerald-700 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:border-emerald-400/30 dark:text-emerald-300'
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
                ? 'Sync Error'
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
                  <Zap className="w-3.5 h-3.5 text-[#eedbff]" />
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
                <RefreshCw className={`w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE] ${isRefreshing ? 'animate-spin' : ''}`} />
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
              className="flex items-center gap-2 px-1.5 py-1 rounded-full hover:bg-white/60 dark:hover:bg-white/10 transition-colors cursor-pointer group"
            >
              <div className="relative w-8 h-8 rounded-full bg-gradient-to-tr from-[#8b5cf6] to-[#6366f1] p-0.5 shadow-md shadow-purple-900/35 shrink-0">
                <div className="w-full h-full rounded-full bg-[#240c45] dark:bg-[#1b1238] text-white font-display font-bold text-xs flex items-center justify-center border border-white/30">
                  {getInitials(currentUser.name)}
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#16A36A] ring-2 ring-white dark:ring-[#160D29]" />
              </div>
              <div className="hidden lg:flex flex-col text-left min-w-0 max-w-[140px]">
                <span className="text-xs font-bold text-[#211A2E] dark:text-white group-hover:text-[#58149c] dark:group-hover:text-[#C77BE9] transition-colors leading-tight truncate">
                  {currentUser.name}
                </span>
                <span className="text-[10px] text-[#766B83] dark:text-[#CEC0E8] capitalize leading-tight truncate">
                  {currentUser.role.replace('_', ' ')}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#766B83] dark:text-[#A78BFA] hidden lg:block shrink-0" />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-3 w-72 max-w-[calc(100vw-1.5rem)] bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-[#E9E5F0] dark:border-white/15 py-2 z-50 text-xs">
                  <div className="px-4 py-2.5 border-b border-[#E9E5F0] dark:border-white/10 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#211A2E] dark:text-white truncate">{currentUser.name}</span>
                      {getRoleIcon(currentUser.role)}
                    </div>
                    <div className="font-mono text-[11px] text-[#7135B5] dark:text-[#D8B4FE]">@{currentUser.username}</div>
                    <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] pt-1 space-y-0.5">
                      <div>
                        Peran:{' '}
                        <span className="font-semibold capitalize text-[#211A2E] dark:text-white">
                          {currentUser.role.replace('_', ' ')}
                        </span>
                      </div>
                      {activeContractor && (
                        <div className="truncate">
                          Vendor: <span className="font-medium text-[#211A2E] dark:text-white">{activeContractor}</span>
                        </div>
                      )}
                      {activeArea && (
                        <div className="truncate">
                          Wilayah: <span className="font-medium text-[#211A2E] dark:text-white">{activeArea}</span>
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
                        className="w-full text-left py-2 px-3 rounded-lg text-xs font-semibold text-[#211A2E] dark:text-[#E9D5FF] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                      >
                        <span>Manajemen Akun & Pengguna</span>
                        <span>&rarr;</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setChangePasswordOpen(true);
                      }}
                      className="w-full text-left py-2 px-3 rounded-lg text-xs font-semibold text-[#211A2E] dark:text-[#E9D5FF] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <KeyRound className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
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
                      className="w-full text-center py-2 px-3 bg-[#DC4C5A]/10 hover:bg-[#DC4C5A]/20 text-[#DC4C5A] dark:text-rose-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-1"
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
                ? 'bg-[#FEF3C7] border-[#E59A27]/40 text-[#B45309] dark:bg-amber-500/20 dark:border-amber-400/35 dark:text-amber-200'
                : pendingCount > 0
                ? 'bg-[#FEF3C7] border-[#E59A27]/40 text-[#92400E] dark:bg-amber-500/20 dark:border-amber-400/35 dark:text-amber-200'
                : 'bg-[#16A36A]/10 border-[#16A36A]/20 text-[#16A36A] dark:bg-emerald-500/15 dark:border-emerald-400/30 dark:text-emerald-300'
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
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 text-[#7135B5]" />
                <span className={isMobileView ? 'hidden' : 'hidden sm:inline'}>Syncing</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[#16A36A] mj-glow-dot shrink-0" />
                <span className={isMobileView ? 'hidden sm:inline' : 'hidden md:inline'}>Online</span>
              </>
            )}
            {!isMobileView && (
              <span className="hidden lg:inline font-medium text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
                {pendingCount} Pending
              </span>
            )}
          </button>
        </div>
      </header>
      <ChangePasswordModal
        isOpen={changePasswordOpen}
        user={currentUser}
        onClose={() => setChangePasswordOpen(false)}
        onPasswordChanged={applyRotatedPasswordSession}
      />
    </div>
  );
};
