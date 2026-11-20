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
  Bell,
  MessageSquare,
  CheckCircle2,
  ArrowUpRight,
  Monitor,
  Smartphone,
  Search,
  X,
  Loader2,
  Radio,
  Network,
  BadgeCheck
} from 'lucide-react';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { MoraJawsLogo } from '../common/MoraJawsLogo';
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
    lastSyncTime,
    refreshDatabaseData,
    tickets,
    scopedTickets,
    getTicketUnreadCount
  } = useApp();
  const { config, setSidebarState, displayMode, canSwitchDisplayMode, setDisplayMode, isMobileView } = useUIConfig();
  const { isOnline, isSyncing, pendingCount, setIsOfflineModalOpen, isSimulatedOffline } = useOfflineSync();
  const { triggerRefresh } = useAnimation();
  const { toast } = useToast();
  const { playSyncSound } = useMoraJawsSound();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [quickResults, setQuickResults] = useState<Ticket[]>([]);
  const [isQuickSearching, setIsQuickSearching] = useState(false);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const quickSearchRef = useRef<HTMLDivElement>(null);

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
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Real notification items computed from live unread messages, pending dispatch approvals, and offline queue
  const notificationSummary = useMemo(() => {
    const pool = (canCrossDateSearch ? tickets : scopedTickets).filter(
      t => !t.isDeleted && !t.isArchived && getTicketAppointmentDate(t) === todayWIB
    );
    const unreadTickets = pool
      .map(t => ({ ticket: t, unread: getTicketUnreadCount(t.id) }))
      .filter(item => item.unread > 0)
      .slice(0, 5);
    const pendingApprovalTickets = canCrossDateSearch
      ? pool
          .filter(
            t =>
              t.approvalStatus === 'BUTUH APPROVAL' ||
              t.progressReports?.some(r => r.approvalStatus === 'BUTUH APPROVAL')
          )
          .slice(0, 5)
      : [];
    const totalCount = unreadTickets.length + pendingApprovalTickets.length + (pendingCount > 0 ? 1 : 0);
    return { unreadTickets, pendingApprovalTickets, totalCount };
  }, [canCrossDateSearch, tickets, scopedTickets, todayWIB, getTicketUnreadCount, pendingCount]);

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

  const activeContractor = currentUser.contractor || (contractorsList?.[0] || '');
  const activeArea = currentUser.area || (areasList?.[0] || '');
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

  if (currentUser.role === 'installer') {
    const liveBadge = !isOnline
      ? {
          label: isSimulatedOffline ? 'SIMULASI OFFLINE' : 'OFFLINE',
          pillClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25',
          dotClass: 'bg-amber-500'
        }
      : isSyncing || isRefreshing || syncStatus === 'SYNCING' || syncStatus === 'LOADING'
      ? {
          label: 'SYNCING',
          pillClass: 'bg-[#7135b5]/12 text-[#58149c] dark:text-[#DAB9FF] border border-[#7135b5]/25',
          dotClass: 'bg-[#7135b5] animate-pulse'
        }
      : syncStatus === 'ERROR'
      ? {
          label: 'RETRY',
          pillClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25',
          dotClass: 'bg-rose-500'
        }
      : {
          label: 'LIVE',
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
      <header className="sticky top-0 z-40 w-full pt-safe bg-[#fdf7ff]/88 dark:bg-[#160D29]/92 backdrop-blur-xl border-b border-[#e8ddff]/80 dark:border-[#35105E] shadow-[0_2px_12px_rgba(31,22,56,0.04)] transition-colors">
        <div className="max-w-lg md:max-w-3xl lg:max-w-6xl mx-auto h-16 px-3.5 sm:px-6 flex items-center justify-between gap-2">
          {/* Left: Stitch 3D Purple Hub + Field Dispatch + Live Telemetry */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate('installer_dashboard')}
              title="Kembali ke Dashboard Field Dispatch"
              aria-label="Kembali ke Dashboard Field Dispatch"
              className="w-9 h-9 rounded-xl bg-gradient-to-b from-[#58149c] to-[#7135b5] flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_3px_8px_rgba(88,20,156,0.28)] active:scale-95 transition-transform cursor-pointer"
            >
              <Network className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
            </button>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onNavigate('installer_dashboard')}
                  className="font-display font-extrabold text-[16px] sm:text-[18px] tracking-tight text-[#1f1638] dark:text-white leading-none truncate cursor-pointer text-left"
                >
                  {activeTab === 'installer_dashboard' ? 'Field Dispatch' : activePageTitle}
                </button>
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold tracking-wider uppercase leading-none shrink-0 ${liveBadge.pillClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${liveBadge.dotClass}`} />
                  <span>{liveBadge.label}</span>
                </span>
              </div>
              <span className="text-[10.5px] font-semibold text-[#4b4452] dark:text-[#CEC0E8] flex items-center gap-1 mt-0.5 truncate uppercase tracking-wide">
                <BadgeCheck className="w-3 h-3 text-[#58149c] dark:text-[#DAB9FF] shrink-0" />
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
              className={`relative w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl transition-colors cursor-pointer active:scale-95 ${
                pendingCount > 0 || !isOnline
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60'
                  : 'bg-[#eee4ff] dark:bg-[#241442] text-[#4b4452] dark:text-[#CEC0E8] hover:text-[#58149c] dark:hover:text-[#DAB9FF]'
              }`}
            >
              {isOnline ? <Radio className="w-[18px] h-[18px]" /> : <WifiOff className="w-[18px] h-[18px]" />}
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-amber-500 text-white text-[9.5px] font-extrabold flex items-center justify-center ring-2 ring-[#fdf7ff] dark:ring-[#160D29] tabular-nums">
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
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-[#22123F] border border-[#e8ddff] dark:border-[#35105E] text-[#4b4452] dark:text-[#CEC0E8] hover:text-[#58149c] dark:hover:text-[#DAB9FF] shadow-2xs transition-colors cursor-pointer disabled:opacity-50 active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            {/* User Account Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-label="Profil & Pengaturan Akun"
                className="w-9 h-9 rounded-full bg-gradient-to-b from-[#58149c] to-[#7135b5] text-white font-display font-bold text-xs flex items-center justify-center shadow-[0_2px_6px_rgba(88,20,156,0.28)] hover:opacity-95 active:scale-95 transition-all cursor-pointer relative ml-0.5"
              >
                {getInitials(currentUser.name)}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#fdf7ff] dark:border-[#160D29] ${
                    isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-[#1A0E2E] rounded-2xl shadow-xl border border-[#e8ddff] dark:border-[#35105E] py-2 z-50 text-xs">
                    <div className="px-4 py-2.5 border-b border-[#e8ddff] dark:border-[#35105E] space-y-1">
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
        </div>
      </header>
    );
  }

  return (
    <>
      <header
        className={`sticky top-0 z-40 h-16 flex items-center justify-between gap-2 sm:gap-3 bg-[#fdf7ff]/95 dark:bg-[#160D29]/95 backdrop-blur-xl border-b border-[#e8ddff] dark:border-[#35105E] shadow-[0_1px_8px_rgba(53,16,94,0.04)] transition-colors ${
          isMobileView ? 'px-3 sm:px-4' : 'px-4 sm:px-6'
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
            className="btn-3d-icon min-w-[38px] min-h-[38px] sm:w-9 sm:h-9 cursor-pointer shrink-0"
            title="Buka / Tutup Sidebar"
            aria-label="Buka / Tutup Sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {/* Compact Stitch identity in Mobile Mode; full Breadcrumb trail + Engine Status in Desktop Mode */}
          {isMobileView ? (
            <div className="flex items-center gap-2 min-w-0">
              <MoraJawsLogo size="sm" animated={false} withGlow={false} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-display font-extrabold text-[14px] text-[#1f1638] dark:text-white tracking-tight leading-none truncate">
                    {config.global.appName || 'MoraJaws'} Ops
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#f3eaff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff] text-[9px] font-extrabold tracking-wider uppercase leading-none shrink-0">
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
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? 'bg-[#16A36A]' : 'bg-[#E59A27]'}`} />
                  <span className="text-[10.5px] font-semibold text-[#6a46c1] dark:text-[#CEC0E8] truncate">
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
                className="hidden xl:flex items-center gap-1.5 text-xs text-[#7d7484] dark:text-[#CEC0E8]/70 truncate max-w-[230px]"
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
                <span className="text-[#58149c] dark:text-[#D8B4FE] font-bold truncate">
                  {activePageTitle}
                </span>
              </nav>

              {/* Page title shown cleanly on Tablet / Small Desktop (<1280px) where full breadcrumb is hidden */}
              <span className="xl:hidden text-xs sm:text-sm font-bold text-[#1f1638] dark:text-white truncate">
                {activePageTitle}
              </span>

              {/* Stitch Engine Active + Console & Date Pill */}
              <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 bg-[#f3eaff] dark:bg-[#35105E]/70 border border-[#e8ddff] dark:border-[#7135B5]/50 rounded-lg text-[#1f1638] dark:text-[#E9D5FF] shadow-[inset_0_1px_1px_rgba(33,24,58,0.04)] shrink-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    isOnline && databaseStatus === 'connected'
                      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.65)]'
                      : 'bg-amber-500'
                  }`}
                />
                <span className="text-[11px] font-bold tracking-wide uppercase whitespace-nowrap">
                  {currentUser.role === 'dispatch'
                    ? 'DISPATCH CONSOLE'
                    : currentUser.role === 'super_admin'
                    ? 'OPS ADMIN'
                    : currentUser.role === 'leader'
                    ? 'LEADER CONSOLE'
                    : 'OPS CONSOLE'}
                </span>
                <span className="text-[#cec3d4] dark:text-[#7135B5]">•</span>
                <Calendar className="w-3.5 h-3.5 text-[#58149c] dark:text-[#A78BFA] shrink-0" />
                <span className="text-[11px] font-bold text-[#58149c] dark:text-[#dab9ff] tracking-tight whitespace-nowrap tabular-nums">
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
                <span className="w-1 h-3 bg-[#cec3d4] dark:bg-[#5B35B1] rounded-full" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10.5px] font-semibold text-[#7d7484] dark:text-[#CEC0E8]/80 uppercase">Techs:</span>
                  <span className="font-display font-bold text-[#58149c] dark:text-[#D8B4FE] tabular-nums">
                    {headerTelemetry.activeTechs}/{headerTelemetry.totalTechs}
                  </span>
                </div>
                <span className="w-1 h-3 bg-[#cec3d4] dark:bg-[#5B35B1] rounded-full" />
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

        {/* Zone 2: Quick Cross-Date Search (Desktop >= 1024px non-mobile mode) */}
        {!isMobileView && (
          <div ref={quickSearchRef} className="hidden lg:block flex-1 max-w-xs xl:max-w-sm mx-2 relative">
            <div className="relative flex items-center w-full">
              <Search className="w-3.5 h-3.5 text-[#8B8495] absolute left-3 pointer-events-none" />
              <input
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
                    ? 'Quick Cross-Date Search...'
                    : 'Cari Work Order hari ini...'
                }
                aria-label="Quick Cross-Date Search"
                className="w-full pl-8 pr-14 py-1.5 bg-[#F7F6FA] dark:bg-[#22123F] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-xs text-[#211A2E] dark:text-white placeholder:text-[#8B8495] shadow-inner focus:outline-none focus:bg-white dark:focus:bg-[#2A1650] focus:ring-2 focus:ring-[#A78BFA]/70 transition-all"
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
                <div className="absolute right-2 px-1.5 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#35105E] font-mono text-[10px] font-semibold text-[#766B83] dark:text-[#D8B4FE] pointer-events-none border border-[#D8CCF3] dark:border-[#5B35B1]">
                  Ctrl+K
                </div>
              )}
            </div>

            {quickSearchOpen && quickSearch.trim().length > 0 && (
              <div className="absolute left-0 right-0 mt-1.5 bg-white dark:bg-[#1A0E2E] border border-[#E9E5F0] dark:border-[#35105E] rounded-xl shadow-xl z-50 overflow-hidden text-xs">
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
              className="inline-flex items-center p-1 rounded-xl bg-slate-100/90 dark:bg-[#1E1238] border border-slate-200/90 dark:border-[#35105E] shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] shrink-0 gap-0.5"
            >
              <button
                type="button"
                onClick={() => setDisplayMode('desktop')}
                aria-label="Desktop Mode"
                aria-pressed={displayMode === 'desktop'}
                data-testid="display-mode-desktop"
                title="Desktop Mode — Tampilan tabel lengkap, grid desktop, dan sidebar penuh"
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[28px] rounded-lg text-[11.5px] leading-none font-semibold tracking-tight transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                  displayMode === 'desktop'
                    ? 'bg-white text-[#7C3AED] shadow-[0_1px_3px_rgba(15,23,42,0.10),0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80 dark:bg-[#7C3AED] dark:text-white dark:ring-[#A78BFA]/40'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-white/5'
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
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[28px] rounded-lg text-[11.5px] leading-none font-semibold tracking-tight transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                  displayMode === 'mobile'
                    ? 'bg-white text-[#7C3AED] shadow-[0_1px_3px_rgba(15,23,42,0.10),0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80 dark:bg-[#7C3AED] dark:text-white dark:ring-[#A78BFA]/40'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-white/5'
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
            className={`${isMobileView ? 'hidden sm:flex' : 'hidden md:flex'} items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full border transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 ${
              syncStatus === 'SAVED'
                ? 'bg-[#5B35B1]/10 hover:bg-[#5B35B1]/15 border-[#7135B5]/25 text-[#7135B5] dark:bg-[#35105E] dark:hover:bg-[#5B35B1] dark:border-[#7135B5]/50 dark:text-[#E9D5FF]'
                : syncStatus === 'SYNCING' || syncStatus === 'LOADING'
                ? 'bg-[#F4EAFF] border-[#A78BFA] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                : syncStatus === 'OFFLINE'
                ? 'bg-[#FEF3C7] border-[#F59E0B]/30 text-[#B45309] dark:bg-amber-950/60 dark:text-amber-300'
                : 'bg-[#ffdad6] border-[#ba1a1a]/30 text-[#93000a] dark:bg-rose-950/60 dark:text-rose-300'
            }`}
            title={`Supabase PostgreSQL: ${databaseStatus} / ${syncStatus}${
              lastSyncTime ? ` | Terakhir sinkron: ${new Date(lastSyncTime).toLocaleTimeString('id-ID')}` : ''
            } — Klik untuk Sync`}
          >
            {isRefreshing || syncStatus === 'SYNCING' || syncStatus === 'LOADING' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Cloud className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>
              {isRefreshing
                ? 'Sinkronisasi...'
                : syncStatus === 'SAVED'
                ? 'Cloud Live (SAVED)'
                : syncStatus === 'SYNCING'
                ? 'Menyimpan...'
                : syncStatus === 'LOADING'
                ? 'Memuat...'
                : syncStatus === 'OFFLINE'
                ? 'Offline'
                : 'Sync Error'}
            </span>
          </button>

          {/* Exclusive Dispatch Sameday Express + Sync Cloud Quick Actions on 2xl */}
          {!isMobileView && (
            <div className="hidden 2xl:flex items-center gap-1.5 shrink-0">
              {currentUser.role === 'dispatch' && activeTab !== 'form_sameday' && (
                <button
                  type="button"
                  onClick={() => onNavigate('form_sameday')}
                  className="btn-3d-primary flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap"
                  title="Buat Work Order Sameday Express (Khusus Dispatch)"
                >
                  <Zap className="w-3.5 h-3.5 text-[#D8B4FE]" />
                  <span>Form Sameday Express</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleGlobalRefresh}
                disabled={isRefreshing}
                className="btn-3d-ceramic flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-60"
                title="Sinkronisasi ulang data cloud"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE] ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Sync Cloud</span>
              </button>
            </div>
          )}

          {/* Notification Bell Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setNotifOpen(prev => !prev);
                setUserMenuOpen(false);
              }}
              className="relative btn-3d-icon w-9 h-9 cursor-pointer"
              aria-label="Notifikasi Operasional"
              title="Notifikasi Operasional"
            >
              <Bell className="w-4 h-4" />
              {notificationSummary.totalCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#DC4C5A] text-white text-[9.5px] font-mono font-bold flex items-center justify-center tabular-nums ring-2 ring-white dark:ring-[#160D29]">
                  {notificationSummary.totalCount > 9 ? '9+' : notificationSummary.totalCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-[#1A0E2E] rounded-2xl shadow-xl border border-[#E9E5F0] dark:border-[#35105E] z-50 overflow-hidden text-xs">
                  <div className="px-4 py-3 bg-[#F7F6FA] dark:bg-[#22123F] border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between">
                    <span className="font-bold text-[#211A2E] dark:text-white">Notifikasi Hari Ini</span>
                    <span className="font-mono text-[10.5px] font-bold text-[#7135B5] dark:text-[#D8B4FE]">
                      {notificationSummary.totalCount} Item
                    </span>
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-[#E9E5F0] dark:divide-[#35105E]">
                    {notificationSummary.totalCount === 0 ? (
                      <div className="p-6 text-center text-[#766B83] dark:text-[#CEC0E8]">
                        <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-[#16A36A]" />
                        <p className="font-semibold text-[#211A2E] dark:text-white">Semua aman terkendali</p>
                        <p className="text-[11px] mt-0.5">Tidak ada pesan chat belum dibaca atau antrean pending.</p>
                      </div>
                    ) : (
                      <>
                        {pendingCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              setIsOfflineModalOpen(true);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]/50 flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <div>
                              <div className="font-bold text-[#B45309] dark:text-amber-300">
                                {pendingCount} Mutasi Offline Menunggu Sync
                              </div>
                              <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
                                Ketuk untuk membuka Pusat Sinkronisasi
                              </div>
                            </div>
                            <ArrowUpRight className="w-4 h-4 text-[#766B83] shrink-0" />
                          </button>
                        )}

                        {notificationSummary.pendingApprovalTickets.length > 0 && canCrossDateSearch && (
                          <button
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              onNavigate('verification_desk');
                            }}
                            className="w-full text-left px-4 py-2.5 bg-[#f8f1ff] dark:bg-[#2e1459]/70 hover:bg-[#eee4ff] dark:hover:bg-[#35105e] flex items-center justify-between gap-2 text-[11px] font-bold text-[#58149c] dark:text-[#dab9ff] cursor-pointer"
                          >
                            <span>Buka Hot Desk Verifikasi ({notificationSummary.pendingApprovalTickets.length}+ Antrean)</span>
                            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                          </button>
                        )}

                        {notificationSummary.pendingApprovalTickets.map(t => (
                          <button
                            key={`notif-app-${t.id}`}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              if (onSelectTicket) onSelectTicket(t, 'report');
                              else onNavigate('tickets');
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]/50 flex items-start justify-between gap-2 cursor-pointer"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-[#431599] dark:text-[#D8B4FE] truncate">
                                Review Report: {t.woNumber}
                              </div>
                              <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] truncate">
                                {t.customerName} · {t.installerName || 'Teknisi'}
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-bold shrink-0">
                              Approval
                            </span>
                          </button>
                        ))}

                        {notificationSummary.unreadTickets.map(({ ticket: t, unread }) => (
                          <button
                            key={`notif-chat-${t.id}`}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              if (onSelectTicket) onSelectTicket(t, 'chat');
                              else onNavigate('contact_centre');
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]/50 flex items-start justify-between gap-2 cursor-pointer"
                          >
                            <div className="min-w-0 flex items-start gap-2">
                              <MessageSquare className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE] mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <div className="font-bold text-[#211A2E] dark:text-white truncate">
                                  Chat Baru: {t.woNumber}
                                </div>
                                <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] truncate">
                                  {t.customerName}
                                </div>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-[#F0E3FF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE] font-mono text-[10px] font-bold shrink-0">
                              {unread}
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User Account Dropdown */}
          <div className="relative pl-1">
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(!userMenuOpen);
                setNotifOpen(false);
              }}
              className="flex items-center gap-2 px-2 py-1 rounded-full hover:bg-[#F7F6FA] dark:hover:bg-[#35105E]/60 transition-colors cursor-pointer"
            >
              <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-[#7135B5] to-[#35105E] text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                {getInitials(currentUser.name)}
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#16A36A] ring-2 ring-white dark:ring-[#160D29]" />
              </div>
              <div className="hidden lg:flex flex-col text-left min-w-0 max-w-[140px]">
                <span className="text-xs font-bold text-[#211A2E] dark:text-white leading-tight truncate">
                  {currentUser.name}
                </span>
                <span className="text-[10.5px] text-[#766B83] dark:text-[#CEC0E8] capitalize leading-tight truncate">
                  {currentUser.role.replace('_', ' ')}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#766B83] dark:text-[#A78BFA] hidden lg:block shrink-0" />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-[#1A0E2E] rounded-2xl shadow-xl border border-[#E9E5F0] dark:border-[#35105E] py-2 z-50 text-xs">
                  <div className="px-4 py-2.5 border-b border-[#E9E5F0] dark:border-[#35105E] space-y-1">
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
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              !isOnline
                ? 'bg-[#FEF3C7] border-[#E59A27]/40 text-[#B45309] dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-300'
                : pendingCount > 0
                ? 'bg-[#FEF3C7] border-[#E59A27]/40 text-[#92400E] dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-300'
                : 'bg-[#16A36A]/10 border-[#16A36A]/20 text-[#16A36A] dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-300'
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
                <span className="w-1.5 h-1.5 rounded-full bg-[#16A36A] animate-ping shrink-0" />
                <span className={isMobileView ? 'hidden sm:inline' : 'hidden md:inline'}>● Online</span>
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
    </>
  );
};
