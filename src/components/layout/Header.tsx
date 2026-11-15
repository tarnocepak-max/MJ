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
  Search,
  Bell,
  X,
  MessageSquare,
  CheckCircle2,
  Loader2,
  ArrowUpRight
} from 'lucide-react';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { MoraJawsLogo } from '../common/MoraJawsLogo';
import { useAnimation } from '../../context/AnimationContext';
import { useToast } from '../../context/ToastContext';
import { useMoraJawsSound } from '../../context/SoundContext';
import { formatIndonesianWODate } from '../../services/woDateFilterEngine';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';

interface HeaderProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
}

const TAB_TITLES: Record<string, string> = {
  dashboard: 'Dashboard Monitoring',
  tickets: 'Ticket MyRepublic',
  form_sameday: 'Form Sameday Express',
  report_data_wo: 'Report Data WO',
  schedule: 'Schedule',
  import: 'Import Data WO',
  contact_centre: 'Contact Centre',
  users: 'Management User',
  leader_portal: 'Dashboard Leader',
  wo_assignment: 'Assign WO',
  progress_dashboard: 'Dashboard Progress WO',
  installer_mgmt: 'Pendaftaran Akun Teknisi',
  quota_settings: 'Kuota & Kolom',
  contractor_recap: 'Rekap Total WO',
  location_basecamp: 'Basecamp',
  setup: 'Setup Terpusat MoraJaws',
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
  const { config, setSidebarState } = useUIConfig();
  const { isOnline, isSyncing, pendingCount, setIsOfflineModalOpen, isSimulatedOffline } = useOfflineSync();
  const { triggerRefresh } = useAnimation();
  const { toast } = useToast();
  const { playSyncSound } = useMoraJawsSound();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<(Ticket & { _crossDateMeta?: { woDate?: string; dateTag?: string; isCrossDate?: boolean } })[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const canCrossDateSearch = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  // Keyboard shortcut Ctrl+K / Cmd+K for Quick Search
  useEffect(() => {
    if (currentUser.role === 'installer') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentUser.role, searchOpen]);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 40);
    }
  }, [searchOpen]);

  // Execute search via /api/tickets/search for super_admin & dispatch, or scopedTickets locally for other roles
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchError(null);
      const qLower = q.toLowerCase();
      if (canCrossDateSearch && isOnline) {
        setIsSearching(true);
        try {
          const res = await fetch(`/api/tickets/search?q=${encodeURIComponent(q)}`, {
            credentials: 'include'
          });
          const data = await res.json();
          if (res.ok && data?.success && Array.isArray(data.tickets)) {
            setSearchResults(data.tickets.slice(0, 12));
            setIsSearching(false);
            return;
          }
        } catch {
          // Fallback cleanly to local tickets pool below
        }
        setIsSearching(false);
      }

      const pool = canCrossDateSearch ? tickets : (scopedTickets || tickets);
      const localMatches = pool
        .filter(t => !t.isDeleted)
        .filter(t => {
          const wo = String(t.woNumber || '').toLowerCase();
          const cid = String(t.idCustomer || '').toLowerCase();
          const cname = String(t.customerName || '').toLowerCase();
          return wo.includes(qLower) || cid.includes(qLower) || cname.includes(qLower);
        })
        .slice(0, 12);
      setSearchResults(localMatches);
    }, 220);

    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen, canCrossDateSearch, isOnline, tickets, scopedTickets]);

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
      ? pool.filter(t => t.progressReport?.approvalStatus === 'pending_approval').slice(0, 5)
      : [];
    const totalCount = unreadTickets.length + pendingApprovalTickets.length + (pendingCount > 0 ? 1 : 0);
    return { unreadTickets, pendingApprovalTickets, totalCount };
  }, [canCrossDateSearch, tickets, scopedTickets, todayWIB, getTicketUnreadCount, pendingCount]);

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
    const cloudLabel =
      syncStatus === 'SAVED'
        ? 'Cloud Live'
        : syncStatus === 'SYNCING'
        ? 'Menyimpan...'
        : syncStatus === 'LOADING'
        ? 'Memuat...'
        : syncStatus === 'OFFLINE'
        ? 'Offline Mode'
        : 'Sync Error';

    return (
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#160D29]/95 backdrop-blur-xl border-b border-[#E9E5F0] dark:border-[#35105E] shadow-[0_1px_8px_rgba(33,26,46,0.04)] transition-colors">
        <div className="max-w-lg lg:max-w-5xl mx-auto px-3.5 sm:px-6 pt-2.5 pb-2 space-y-2">
          {/* Row 1: Brand + FTTH + Technician Identity | Date + Profile Button */}
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => onNavigate('installer_dashboard')}
                className="shrink-0 cursor-pointer"
                title="Kembali ke Dashboard"
              >
                <MoraJawsLogo size="sm" animated={false} withGlow={false} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-display font-extrabold text-[15px] text-[#211A2E] dark:text-white tracking-tight leading-none">
                    {config.global.appName || 'MoraJaws'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#F0E3FF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] text-[9.5px] font-extrabold tracking-wider uppercase leading-none">
                    FTTH
                  </span>
                </div>
                <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] truncate mt-0.5">
                  {currentUser.name} · {activeContractor || 'Mitra Lapangan'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[11px] font-semibold text-[#766B83] dark:text-[#CEC0E8] tabular-nums whitespace-nowrap">
                {formattedToday}
              </span>

              {/* User Account Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-label="Profil & Pengaturan Akun"
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-[#5B35B1] to-[#431599] text-white font-display font-bold text-xs flex items-center justify-center shadow-xs hover:opacity-95 active:scale-95 transition-all cursor-pointer relative"
                >
                  {getInitials(currentUser.name)}
                  <span
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-[#160D29] ${
                      isOnline ? 'bg-[#16A36A]' : 'bg-[#E59A27]'
                    }`}
                  />
                </button>

                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-[#1A0E2E] rounded-xl shadow-xl border border-[#E9E5F0] dark:border-[#35105E] py-2 z-50 text-xs">
                      <div className="px-4 py-2.5 border-b border-[#E9E5F0] dark:border-[#35105E] space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#211A2E] dark:text-white truncate">{currentUser.name}</span>
                          {getRoleIcon(currentUser.role)}
                        </div>
                        <div className="font-mono text-[11px] text-[#7135B5] dark:text-[#D8B4FE]">@{currentUser.username}</div>
                        <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] pt-1 space-y-0.5">
                          <div>
                            Peran: <span className="font-semibold capitalize text-[#211A2E] dark:text-white">Teknisi Lapangan</span>
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
                        <button
                          type="button"
                          onClick={() => {
                            setUserMenuOpen(false);
                            setIsOfflineModalOpen(true);
                          }}
                          className="w-full text-left py-2 px-3 rounded-lg text-xs font-semibold text-[#211A2E] dark:text-[#E9D5FF] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
                        >
                          <span>Pusat Sinkronisasi Offline</span>
                          <span className="font-mono text-[11px] text-[#431599] dark:text-[#D8B4FE]">{pendingCount} Pending</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setUserMenuOpen(false);
                            handleGlobalRefresh();
                          }}
                          className="w-full text-left py-2 px-3 rounded-lg text-xs font-semibold text-[#211A2E] dark:text-[#E9D5FF] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] flex items-center justify-between cursor-pointer"
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
            </div>
          </div>

          {/* Row 2: Compact Cloud & Connectivity Strip */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E9E5F0]/80 dark:border-[#35105E]/70">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Cloud Live indicator */}
              <button
                type="button"
                onClick={handleGlobalRefresh}
                disabled={isRefreshing}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  syncStatus === 'SAVED'
                    ? 'bg-[#ECFDF5] text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-300'
                    : syncStatus === 'SYNCING' || syncStatus === 'LOADING'
                    ? 'bg-[#F0E3FF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                    : syncStatus === 'OFFLINE'
                    ? 'bg-[#FEF3C7] text-[#B45309] dark:bg-amber-950/60 dark:text-amber-300'
                    : 'bg-[#FEF2F2] text-[#DC4C5A] dark:bg-rose-950/60 dark:text-rose-300'
                }`}
                title="Ketuk untuk sinkronisasi cloud"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    syncStatus === 'SAVED'
                      ? 'bg-[#16A36A]'
                      : syncStatus === 'SYNCING' || syncStatus === 'LOADING'
                      ? 'bg-[#431599] animate-pulse'
                      : syncStatus === 'OFFLINE'
                      ? 'bg-[#E59A27]'
                      : 'bg-[#DC4C5A]'
                  }`}
                />
                <span>{isRefreshing ? 'Syncing...' : cloudLabel}</span>
              </button>

              {/* Pending Queue Button */}
              <button
                type="button"
                onClick={() => setIsOfflineModalOpen(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold border transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                  pendingCount > 0
                    ? 'bg-[#FEF3C7] border-[#F59E0B]/40 text-[#92400E] dark:bg-amber-950/60 dark:text-amber-300'
                    : 'bg-[#F7F6FA] border-[#E9E5F0] text-[#494453] dark:bg-[#22123F] dark:border-[#35105E] dark:text-[#CEC0E8]'
                }`}
                title="Lihat antrean sinkronisasi offline"
              >
                <Cloud className="w-3 h-3 text-[#766B83] dark:text-[#A78BFA]" />
                <span className="font-mono">{pendingCount} Pending</span>
              </button>
            </div>

            {/* Right: Online / Offline pill + mini refresh */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleGlobalRefresh}
                disabled={isRefreshing}
                aria-label="Sinkronisasi data"
                className="p-1.5 rounded-full text-[#766B83] hover:text-[#431599] hover:bg-[#F5F1FF] dark:text-[#CEC0E8] dark:hover:bg-[#35105E] transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => setIsOfflineModalOpen(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-extrabold tracking-wide uppercase cursor-pointer whitespace-nowrap ${
                  !isOnline
                    ? 'bg-[#FEF3C7] text-[#B45309] dark:bg-amber-950/60 dark:text-amber-300'
                    : isSyncing
                    ? 'bg-[#F0E3FF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                    : 'bg-[#ECFDF5] text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-300'
                }`}
              >
                {!isOnline ? (
                  <>
                    <WifiOff className="w-3 h-3" />
                    <span>{isSimulatedOffline ? 'SIMULASI OFFLINE' : 'OFFLINE'}</span>
                  </>
                ) : isSyncing ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>SYNCING</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#16A36A]" />
                    <span>ONLINE</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-40 h-16 flex items-center justify-between gap-3 sm:gap-4 px-4 sm:px-6 bg-white/95 dark:bg-[#160D29]/95 backdrop-blur-xl border-b border-[#E9E5F0] dark:border-[#35105E] shadow-[0_1px_8px_rgba(0,0,0,0.03)] transition-colors">
        {/* Zone 1: Toggle + Breadcrumbs + Appointment Date Pill */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => {
              const current = config.global.sidebarState || 'expanded';
              setSidebarState(current === 'closed' ? 'expanded' : 'closed');
            }}
            className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#F4EAFF] hover:text-[#211A2E] dark:text-[#D8B4FE] dark:hover:bg-[#35105E] dark:hover:text-white transition-colors cursor-pointer shrink-0"
            title="Buka / Tutup Sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {/* Breadcrumb trail on wide screens */}
          <nav
            aria-label="Breadcrumb"
            className="hidden xl:flex items-center gap-1.5 text-xs text-[#8B8495] dark:text-[#CEC0E8]/70 truncate max-w-[260px]"
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
              className="hover:text-[#211A2E] dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              {config.global.appName || 'MoraJaws'}
            </button>
            <span aria-hidden="true">/</span>
            <span className="text-[#35105E] dark:text-[#D8B4FE] font-semibold truncate">
              {activePageTitle}
            </span>
          </nav>

          {/* Active Appointment Date Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-[#F5F1FF] dark:bg-[#35105E]/70 border border-[#D8CCF3] dark:border-[#7135B5]/50 rounded-full text-[#35105E] dark:text-[#E9D5FF] shrink-0">
            <Calendar className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA] shrink-0" />
            <span className="text-[11px] font-bold tracking-tight whitespace-nowrap tabular-nums">
              Appointment: Hari Ini (todayWIB) · {formattedToday}
            </span>
          </div>
        </div>

        {/* Zone 2 & 3: Search (Ctrl+K) + Connectivity + Cloud Live + Notifications + User Profile */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Quick Cross-Date Search Trigger */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F7F6FA] hover:bg-[#F0E3FF]/70 dark:bg-[#22123F] dark:hover:bg-[#35105E] border border-[#E9E5F0] dark:border-[#35105E] text-[#766B83] dark:text-[#CEC0E8] text-xs transition-colors cursor-pointer shrink-0"
            title={
              canCrossDateSearch
                ? 'Pencarian WO & Pelanggan Lintas Tanggal (Ctrl+K)'
                : 'Cari Work Order (Ctrl+K)'
            }
          >
            <Search className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA]" />
            <span className="hidden lg:inline text-[11px] font-medium text-[#766B83] dark:text-[#CEC0E8]">
              {canCrossDateSearch ? 'Cari WO / ID...' : 'Cari WO...'}
            </span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-white dark:bg-[#160D29] text-[#494453] dark:text-[#D8B4FE] rounded border border-[#E9E5F0] dark:border-[#35105E]">
              Ctrl+K
            </kbd>
          </button>

          {/* Mobile Search Icon */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="md:hidden p-1.5 rounded-full bg-[#F7F6FA] dark:bg-[#22123F] border border-[#E9E5F0] dark:border-[#35105E] text-[#7135B5] dark:text-[#D8B4FE] cursor-pointer"
            aria-label="Cari Work Order"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Offline Queue & Online Status Pill */}
          <button
            type="button"
            onClick={() => setIsOfflineModalOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-full border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              !isOnline
                ? 'bg-[#FEF3C7] border-[#F59E0B]/30 text-[#B45309] dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-300'
                : pendingCount > 0
                ? 'bg-[#EFF6FF] border-[#3977C9]/30 text-[#3977C9] dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-300'
                : 'bg-[#ECFDF5] border-[#16A36A]/20 text-[#15803D] dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-300'
            }`}
            title="Pusat Sinkronisasi Database Offline"
          >
            {!isOnline ? (
              <>
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{isSimulatedOffline ? 'Simulasi Offline' : 'Offline'}</span>
              </>
            ) : isSyncing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="hidden sm:inline">Syncing</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-[#16A36A] shrink-0" />
                <span className="hidden md:inline">Online</span>
              </>
            )}
            <span className="hidden lg:inline font-mono text-[10px] opacity-80 tabular-nums">
              · {pendingCount} Pending
            </span>
          </button>

          {/* Cloud Live Pill & Trigger Refresh */}
          <button
            type="button"
            onClick={handleGlobalRefresh}
            disabled={isRefreshing}
            className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 ${
              syncStatus === 'SAVED'
                ? 'bg-[#F5F1FF] hover:bg-[#EADDFA] border-[#D8CCF3] text-[#431599] dark:bg-[#35105E] dark:hover:bg-[#5B35B1] dark:border-[#7135B5]/50 dark:text-[#E9D5FF]'
                : syncStatus === 'SYNCING' || syncStatus === 'LOADING'
                ? 'bg-[#F0E3FF] border-[#A78BFA] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                : syncStatus === 'OFFLINE'
                ? 'bg-[#FEF3C7] border-[#F59E0B]/30 text-[#B45309] dark:bg-amber-950/60 dark:text-amber-300'
                : 'bg-[#FEF2F2] border-[#DC4C5A]/30 text-[#DC4C5A] dark:bg-rose-950/60 dark:text-rose-300'
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
                ? 'Cloud Live'
                : syncStatus === 'SYNCING'
                ? 'Menyimpan...'
                : syncStatus === 'LOADING'
                ? 'Memuat...'
                : syncStatus === 'OFFLINE'
                ? 'Offline'
                : 'Sync Error'}
            </span>
          </button>

          {/* Exclusive Dispatch Sameday Express Quick Action */}
          {currentUser.role === 'dispatch' && activeTab !== 'form_sameday' && (
            <button
              type="button"
              onClick={() => onNavigate('form_sameday')}
              className="hidden 2xl:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#35105E] hover:bg-[#7135B5] text-white text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
              title="Buat Work Order Sameday Express (Khusus Dispatch)"
            >
              <Zap className="w-3.5 h-3.5 text-[#D8B4FE]" />
              <span>Form Sameday</span>
            </button>
          )}

          {/* Notification Bell Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setNotifOpen(prev => !prev);
                setUserMenuOpen(false);
              }}
              className="relative p-2 rounded-full text-[#494453] hover:bg-[#F5F1FF] hover:text-[#431599] dark:text-[#CEC0E8] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
              aria-label="Notifikasi Operasional"
              title="Notifikasi Operasional"
            >
              <Bell className="w-4 h-4" />
              {notificationSummary.totalCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#DC4C5A] text-white text-[9.5px] font-mono font-bold flex items-center justify-center tabular-nums ring-2 ring-white dark:ring-[#160D29]">
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
        </div>
      </header>

      {/* Quick Cross-Date Search Modal (Ctrl+K) */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#160D29]/55 backdrop-blur-xs flex items-start justify-center pt-16 sm:pt-24 px-4"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#D8CCF3] dark:border-[#35105E] shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#E9E5F0] dark:border-[#35105E]">
              <Search className="w-4 h-4 text-[#7135B5] dark:text-[#D8B4FE] shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={
                  canCrossDateSearch
                    ? 'Cari Nomor WO atau ID Pelanggan 7-digit (Lintas Tanggal)...'
                    : 'Cari Nomor WO, ID Pelanggan, atau Nama Pelanggan...'
                }
                className="flex-1 bg-transparent text-sm text-[#211A2E] dark:text-white placeholder-[#8B8495] focus:outline-none"
              />
              {isSearching && <Loader2 className="w-4 h-4 text-[#7135B5] animate-spin shrink-0" />}
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="p-1 rounded-lg text-[#766B83] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-[#E9E5F0] dark:divide-[#35105E]">
              {searchError && (
                <div className="p-4 text-xs text-[#DC4C5A] bg-rose-50 dark:bg-rose-950/40">{searchError}</div>
              )}

              {!searchQuery.trim() ? (
                <div className="p-6 text-center text-xs text-[#766B83] dark:text-[#CEC0E8] space-y-1">
                  <p className="font-semibold text-[#211A2E] dark:text-white">
                    {canCrossDateSearch ? 'Pencarian Lintas Tanggal Aktif' : 'Pencarian Cepat Work Order'}
                  </p>
                  <p>
                    Ketik Nomor WO (mis. <span className="font-mono text-[#7135B5] dark:text-[#D8B4FE]">WO-</span>) atau 7 digit ID Pelanggan.
                  </p>
                </div>
              ) : isSearching && searchResults.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#766B83] dark:text-[#CEC0E8]">
                  Mencari di database PostgreSQL...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#766B83] dark:text-[#CEC0E8]">
                  Tidak ada Work Order yang cocok dengan &ldquo;{searchQuery}&rdquo;.
                </div>
              ) : (
                searchResults.map(t => {
                  const woDate = t._crossDateMeta?.woDate || getTicketAppointmentDate(t) || '-';
                  const dateTag = t._crossDateMeta?.dateTag;
                  return (
                    <button
                      key={`quick-search-${t.id}`}
                      type="button"
                      onClick={() => {
                        setSearchOpen(false);
                        if (onSelectTicket) {
                          onSelectTicket(t, 'overview');
                        } else {
                          onNavigate('tickets');
                        }
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]/50 flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#431599] dark:text-[#D8B4FE]">
                            {t.woNumber}
                          </span>
                          <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[#F7F6FA] dark:bg-[#22123F] text-[#494453] dark:text-[#CEC0E8]">
                            {t.idCustomer || '-'}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-[#211A2E] dark:text-white truncate mt-0.5">
                          {t.customerName}
                        </div>
                        <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] truncate">
                          {t.area || '-'} · {t.contactorName || t.contractorName || '-'} · {t.installerName || 'Unassigned'}
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tabular-nums ${
                            dateTag === 'previous'
                              ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                              : dateTag === 'upcoming'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                              : 'bg-[#ECFDF5] text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {woDate}
                        </span>
                        <div className="text-[10.5px] font-semibold text-[#766B83] dark:text-[#CEC0E8]">
                          {t.statusWOAgent || 'Pending'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
