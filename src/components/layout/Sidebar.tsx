import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { MoraJawsLogo } from '../common/MoraJawsLogo';
import { Ticket, StandaloneMenuItem } from '../../types/index.ts';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Ticket as TicketIcon,
  Users2,
  MessageSquareQuote,
  Sliders,
  History,
  ChevronDown,
  X,
  RefreshCw,
  Database,
  KeyRound,
  LogOut,
  Calendar,
  Activity,
  MessageSquare,
  ShieldCheck,
  Building2,
  FileText,
  UserCheck,
  BarChart3,
  UserPlus,
  SlidersHorizontal,
  FolderTree,
  Bell,
  Settings as SettingsIcon,
  CheckCircle2,
  ListOrdered,
  Wrench,
  Layers,
  Map as MapIcon,
  MapPin,
  HelpCircle,
  Folder,
  Search,
  Loader2,
  ArrowUpRight,
  ArrowRightLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Inbox,
  AlertTriangle,
  Zap
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  sidebarState: 'expanded' | 'minimized' | 'closed';
  onChangeState: (state: 'expanded' | 'minimized' | 'closed') => void;
}

export const ICON_REGISTRY: Record<string, React.ElementType> = {
  LayoutDashboard,
  FileSpreadsheet,
  Ticket: TicketIcon,
  TicketIcon,
  Users2,
  MessageSquareQuote,
  Sliders,
  History,
  RefreshCw,
  Database,
  KeyRound,
  LogOut,
  Calendar,
  Activity,
  MessageSquare,
  ShieldCheck,
  Building2,
  FileText,
  UserCheck,
  BarChart3,
  UserPlus,
  SlidersHorizontal,
  FolderTree,
  Bell,
  Settings: SettingsIcon,
  CheckCircle2,
  ListOrdered,
  Wrench,
  Layers,
  Map: MapIcon,
  MapIcon,
  MapPin,
  HelpCircle,
  Folder,
  ArrowRightLeft,
  Inbox,
  AlertTriangle
};

export const resolveNavIcon = (iconName?: string): React.ElementType => {
  if (!iconName) return Folder;
  return ICON_REGISTRY[iconName] || Folder;
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onNavigate,
  onSelectTicket,
  sidebarState,
  onChangeState
}) => {
  const { currentUser, tickets, scopedTickets, overdueSummary, todayWIB, logout, setIsSessionModalOpen, hasPermission, rolePermissions, databaseStatus, syncStatus, totalLiveChatUnreadCount } = useApp();
  const {
    isMobileView,
    config,
    navCategories,
    standaloneMenus,
    submenuItems,
    accordionSettings
  } = useUIConfig();
  const { isOnline } = useOfflineSync();

  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Ticket[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsCompactViewport(window.innerWidth < 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isDrawerMode = isMobileView || isCompactViewport;
  const isMiniMode = !isDrawerMode && sidebarState === 'minimized';
  const userRole = currentUser?.role || 'installer';
  const isInstaller = userRole === 'installer';
  const canCrossDateSearch = userRole === 'super_admin' || userRole === 'dispatch';

  const canAccessMenuId = (menuId: string): boolean => {
    if (menuId === 'overdue_wo') {
      return ['super_admin', 'dispatch', 'leader', 'management_data'].includes(userRole);
    }
    if (userRole === 'super_admin') return true;
    const permMap: Record<string, any> = {
      audit_logs: 'view_audit_logs',
      templates: 'manage_whatsapp_templates',
      database_management: 'database_management',
      ui_builder: 'ui_configuration',
      users: 'manage_users',
      import: 'import_data',
      import_excel: 'import_data',
      droplist_management: 'setting_droplist',
      setting_droplist: 'setting_droplist',
      system_health: 'system_health'
    };
    const reqPerm = permMap[menuId];
    return reqPerm ? hasPermission(reqPerm) : true;
  };

  // Requirement 1: Ticket indicators strictly calculate WO with Appointment Date = Today (Asia/Jakarta, reactive 00:00 WIB)
  const todayActiveTickets = useMemo(() => {
    return scopedTickets.filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      return getTicketAppointmentDate(t) === todayWIB;
    });
  }, [scopedTickets, todayWIB]);

  const totalActiveTickets = todayActiveTickets.length;
  const unassignedCount = todayActiveTickets.filter(t => !t.installerName).length;
  const completedTodayCount = todayActiveTickets.filter(
    t =>
      String(t.statusWOAgent || '').trim().toLowerCase() === 'closed' ||
      String(t.approvalStatus || '').trim().toUpperCase() === 'APPROVED'
  ).length;
  const todayCompletionPct =
    totalActiveTickets > 0 ? Math.round((completedTodayCount / totalActiveTickets) * 100) : 0;
  const butuhApprovalCount = useMemo(
    () =>
      (canCrossDateSearch ? tickets : scopedTickets).filter(
        t => !t.isArchived && !t.isDeleted && t.approvalStatus === 'BUTUH APPROVAL'
      ).length,
    [canCrossDateSearch, tickets, scopedTickets]
  );

  // =========================================================================
  // 1. STANDALONE MENUS (Menu Mandiri tanpa accordion, tanpa kategori induk)
  // Untuk Installer: Hanya Dashboard Installer & Tugas Saya
  // Untuk Non-Installer: Menu Mandiri yang dapat dikonfigurasi + Verification Desk Dispatch/Super Admin
  // =========================================================================
  const filteredStandaloneMenus = useMemo<StandaloneMenuItem[]>(() => {
    if (isInstaller) {
      return [
        {
          id: 'installer_portal',
          label: 'Dashboard Installer',
          icon: 'LayoutDashboard',
          order: 1,
          visible: true,
          roles: ['installer']
        },
        {
          id: 'installer_tasks',
          label: 'Tugas Saya',
          icon: 'CheckCircle2',
          order: 2,
          visible: true,
          roles: ['installer']
        }
      ];
    }

    const rawList: StandaloneMenuItem[] = Array.isArray(standaloneMenus) ? standaloneMenus : [];
    const list: StandaloneMenuItem[] = [...rawList];
    const hasVerificationDesk = list.some(m => m && m.id === 'verification_desk');
    if (!hasVerificationDesk && (userRole === 'super_admin' || userRole === 'dispatch')) {
      list.push({
        id: 'verification_desk',
        label: 'Antrean Verifikasi',
        icon: 'Inbox',
        order: 1.5,
        visible: true,
        roles: ['super_admin', 'dispatch']
      });
    }
    const hasOverdueWo = list.some(m => m && m.id === 'overdue_wo');
    if (!hasOverdueWo && ['super_admin', 'dispatch', 'leader', 'management_data'].includes(userRole)) {
      list.push({
        id: 'overdue_wo',
        label: 'OVERDUE WO',
        icon: 'AlertTriangle',
        order: 2.5,
        visible: true,
        roles: ['super_admin', 'dispatch', 'leader', 'management_data']
      });
    }

    return [...list]
      .filter(item => {
        if (!item || item.visible === false) return false;
        if (item.id === 'templates' && userRole !== 'super_admin' && userRole !== 'dispatch') return false;
        if (Array.isArray(item.roles) && item.roles.length > 0 && (!userRole || !item.roles.includes(userRole))) return false;
        if (!canAccessMenuId(item.id)) return false;
        return true;
      })
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [isInstaller, standaloneMenus, userRole, rolePermissions]);

  // =========================================================================
  // 2. KATEGORI ACCORDION (3 Kategori Utama: Contractor & Area, Installer, Menu Tambahan)
  // Khusus Non-Installer (Installer hanya memiliki 2 menu mandiri)
  // Submenu difilter berdasarkan role & izin akses. Kategori tanpa submenu disembunyikan.
  // =========================================================================
  const filteredCategoriesWithSubmenus = useMemo(() => {
    if (isInstaller) return [];

    const categories = Array.isArray(navCategories) ? navCategories : [];
    const allSubmenus = Array.isArray(submenuItems) ? submenuItems : [];
    const isDispatchOrLeader = userRole === 'dispatch' || userRole === 'leader';

    return [...categories]
      .filter(cat => {
        if (!cat || cat.isActive === false) return false;
        const catId = String(cat.id || '').toLowerCase();
        const catName = String(cat.name || '').toLowerCase();
        // Role DISPATCH dan LEADER tidak boleh melihat kategori installer (Hanya super_admin & installer)
        if (isDispatchOrLeader && (catId === 'cat_installer' || catId === 'installer' || catName.includes('installer'))) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(cat => {
        const catId = String(cat.id || '');
        const matchingSubmenus = allSubmenus
          .filter(sub => {
            if (!sub || String(sub.categoryId || '') !== catId) return false;
            if (sub.visible === false) return false;
            const subId = String(sub.id || '');
            const subCatId = String(sub.categoryId || '');
            // Role DISPATCH tidak boleh melihat pendaftaran/menu installer
            if (userRole === 'dispatch' && (subCatId === 'installer' || subId === 'report_installer' || subId === 'installer_mgmt')) {
              return false;
            }
            // Role LEADER tidak boleh melihat report installer, hanya pendaftaran akun teknisi
            if (userRole === 'leader' && subId === 'report_installer') {
              return false;
            }
            // Requirement 5: WhatsApp Templates strictly for super_admin and dispatch only
            if (subId === 'templates' && userRole !== 'super_admin' && userRole !== 'dispatch') {
              return false;
            }
            if (Array.isArray(sub.roles) && sub.roles.length > 0 && (!userRole || !sub.roles.includes(userRole))) return false;
            if (!canAccessMenuId(subId)) return false;
            return true;
          })
          .sort((a, b) => (a.order || 0) - (b.order || 0));

        return {
          ...cat,
          submenus: matchingSubmenus
        };
      })
      .filter(cat => cat.submenus.length > 0); // Sembunyikan kategori jika tidak ada submenu yang dapat diakses
  }, [isInstaller, navCategories, submenuItems, userRole, rolePermissions]);

  // =========================================================================
  // 3. ACCORDION STATE
  // Mendukung multi-submenu collapse (beberapa kategori terbuka bersamaan)
  // Kategori dibuka/ditutup secara independen tanpa menutup kategori lain
  // =========================================================================
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    filteredCategoriesWithSubmenus.forEach(cat => {
      // Default: check if activeTab is within this category
      const hasActive = cat.submenus.some(
        sub =>
          sub.id === activeTab ||
          (sub.id === 'contractor_recap' && activeTab === 'rekap_laporan') ||
          (sub.id === 'setup' && ['setup', 'ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab))
      );
      initial[cat.id] = hasActive || cat.mode === 'static';
    });
    return initial;
  });

  // Ensure active category expands when activeTab navigates into it
  useEffect(() => {
    filteredCategoriesWithSubmenus.forEach(cat => {
      const hasActive = cat.submenus.some(
        sub =>
          sub.id === activeTab ||
          (sub.id === 'contractor_recap' && activeTab === 'rekap_laporan') ||
          (sub.id === 'setup' && ['setup', 'ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab))
      );
      if (hasActive) {
        setOpenGroups(prev => ({
          ...prev,
          [cat.id]: true
        }));
      }
    });
  }, [activeTab, filteredCategoriesWithSubmenus]);

  // Toggle category independent expand/collapse
  const toggleGroup = (groupId: string, mode?: 'accordion' | 'static') => {
    if (mode === 'static') return; // Static mode stays open
    setOpenGroups(prev => {
      const isCurrentlyOpen = !!prev[groupId];
      const allowMultiple = accordionSettings?.allowMultipleOpenGroups !== false;

      if (allowMultiple) {
        // Multi-open mode: keep existing states, toggle clicked category
        return {
          ...prev,
          [groupId]: !isCurrentlyOpen
        };
      } else {
        // Single-open mode
        const next: Record<string, boolean> = {};
        // Keep static categories open
        filteredCategoriesWithSubmenus.forEach(c => {
          if (c.mode === 'static') next[c.id] = true;
        });
        next[groupId] = !isCurrentlyOpen;
        return next;
      }
    });
  };

  const handleItemClick = (id: string) => {
    onNavigate(id);
    if (isDrawerMode) {
      if (config?.device?.android?.autoCloseSidebarOnNavigate !== false) {
        onChangeState('closed');
      }
    }
  };

  // Focus Sidebar Search Input when triggered via Ctrl+K / custom event
  useEffect(() => {
    if (sidebarState === 'closed' || isInstaller) return;
    const focusSearch = () => {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 40);
    };
    if ((window as any).__mjFocusSidebarSearch) {
      (window as any).__mjFocusSidebarSearch = false;
      focusSearch();
    }
    const handler = () => focusSearch();
    window.addEventListener('morajaws:focus-sidebar-search', handler);
    return () => window.removeEventListener('morajaws:focus-sidebar-search', handler);
  }, [sidebarState, isInstaller]);

  // Live RBAC-filtered Menus & Submenus search
  const matchedMenus = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{ id: string; label: string; icon?: string; group?: string; badge?: string | number }> = [];
    filteredStandaloneMenus.forEach(item => {
      const labelMatch = String(item.label || '').toLowerCase().includes(q);
      const idMatch = String(item.id || '').toLowerCase().includes(q);
      if (labelMatch || idMatch) {
        results.push({
          id: item.id,
          label: item.label,
          icon: item.icon,
          group: 'Operations Core',
          badge: item.badge
        });
      }
    });
    filteredCategoriesWithSubmenus.forEach(cat => {
      const catMatch = String(cat.name || '').toLowerCase().includes(q);
      cat.submenus.forEach(sub => {
        const labelMatch = String(sub.label || '').toLowerCase().includes(q);
        const idMatch = String(sub.id || '').toLowerCase().includes(q);
        if (catMatch || labelMatch || idMatch) {
          results.push({
            id: sub.id,
            label: sub.label,
            icon: sub.icon,
            group: cat.name,
            badge: sub.badge
          });
        }
      });
    });
    return results;
  }, [searchQuery, filteredStandaloneMenus, filteredCategoriesWithSubmenus]);

  // Unified Work Order live search (cross-date server API for Superadmin/Dispatch, scoped local fallback for others/offline)
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError('');
      setIsSearching(false);
      return;
    }

    const qLower = q.toLowerCase();
    const pool = canCrossDateSearch ? tickets : scopedTickets;
    const localSearch = () =>
      pool
        .filter(
          t =>
            !t.isDeleted &&
            (t.woNumber?.toLowerCase().includes(qLower) ||
              t.idCustomer?.toLowerCase().includes(qLower) ||
              t.customerName?.toLowerCase().includes(qLower) ||
              t.customerPhone?.toLowerCase().includes(qLower) ||
              t.installerName?.toLowerCase().includes(qLower))
        )
        .slice(0, 12);

    if (!canCrossDateSearch || !isOnline) {
      setSearchResults(localSearch());
      setSearchError('');
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setSearchError('');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tickets/search?q=${encodeURIComponent(q)}`, {
          credentials: 'include'
        });
        if (!res.ok) throw new Error('Search request failed');
        const json = await res.json();
        if (!cancelled) {
          setSearchResults(Array.isArray(json.tickets) ? json.tickets.slice(0, 12) : localSearch());
        }
      } catch {
        if (!cancelled) {
          setSearchResults(localSearch());
          setSearchError('Menggunakan pencarian lokal (endpoint server tidak merespons).');
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, canCrossDateSearch, isOnline, tickets, scopedTickets]);

  // Helper for dynamic badge calculation
  const getItemBadge = (itemId: string, defaultBadge?: string | number) => {
    if (itemId === 'verification_desk' && butuhApprovalCount > 0) {
      return {
        text: butuhApprovalCount > 99 ? '99+' : butuhApprovalCount,
        color: 'rose' as const
      };
    }
    if (itemId === 'contact_centre' && totalLiveChatUnreadCount > 0) {
      return {
        text: totalLiveChatUnreadCount > 99 ? '99+' : totalLiveChatUnreadCount,
        color: 'rose' as const
      };
    }
    if (itemId === 'wo_assignment' && unassignedCount > 0) {
      return { text: `${unassignedCount} Belum`, color: 'amber' as const };
    }
    if (itemId === 'overdue_wo' && overdueSummary.totalOverdue > 0) {
      return {
        text: overdueSummary.totalOverdue > 99 ? '99+' : overdueSummary.totalOverdue,
        color: 'rose' as const
      };
    }
    if (itemId === 'tickets' && totalActiveTickets > 0) {
      return { text: totalActiveTickets, color: 'purple' as const };
    }
    if (itemId === 'progress_dashboard') {
      return { text: 'Live', color: 'purple' as const };
    }
    if (itemId === 'system_health') {
      return { text: 'OK', color: 'emerald' as const };
    }
    if (itemId === 'setup') {
      return { text: 'Hub', color: 'purple' as const };
    }
    if (defaultBadge !== undefined) {
      return { text: defaultBadge, color: 'purple' as const };
    }
    return null;
  };

  // KHUSUS ROLE INSTALLER: Sidebar HILANG SEPENUHNYA (Bottom Navigation ONLY)
  if (sidebarState === 'closed' || isInstaller) {
    return null;
  }

  return (
    <>
      {/* Mobile / Drawer Backdrop Overlay */}
      {isDrawerMode && (
        <div
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-45 transition-opacity"
          onClick={() => onChangeState('closed')}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Main Frame: Stitch AI Light Elevated Surface (Dark Mode #160D29) */}
      <aside
        data-testid="app-sidebar"
        data-drawer-mode={isDrawerMode ? 'true' : 'false'}
        data-mini-mode={isMiniMode ? 'true' : 'false'}
        className={`${
          isDrawerMode
            ? 'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-2xl'
            : isMiniMode
            ? 'relative w-[72px] shadow-none'
            : 'relative w-72 shadow-[0_8px_32px_rgba(53,16,94,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.28)]'
        } bg-[#FAF0FF]/76 dark:bg-white/[0.06] backdrop-blur-2xl text-[#4b4452] dark:text-[#CEC0E8] border-r border-[#e8ddff]/85 dark:border-white/[0.14] transition-all duration-200 ease-out flex flex-col shrink-0 h-full select-none`}
      >
        {/* 1. Sidebar Header / MoraJaws Brand Lockup */}
        <div className={`h-16 ${isMiniMode ? 'px-2 justify-center' : 'px-5 justify-between'} flex items-center bg-transparent dark:bg-transparent border-b border-[#e8ddff]/80 dark:border-white/[0.12] sticky top-0 z-10 shrink-0`}>
          {isMiniMode ? (
            <button
              type="button"
              onClick={() => onChangeState('expanded')}
              className="w-10 h-10 rounded-xl bg-[#7135b5] text-white flex items-center justify-center shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_2px_6px_rgba(53,16,94,0.22)] active:translate-y-0.5 cursor-pointer"
              title="Perluas Sidebar (Work Order Management)"
              aria-label="Perluas Sidebar"
            >
              <MoraJawsLogo size="sm" animated={false} withGlow={false} />
            </button>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[#240C45] dark:bg-[#7135b5] flex items-center justify-center shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_2px_6px_rgba(33,24,58,0.22)] shrink-0">
                <MoraJawsLogo size="sm" animated={false} withGlow={false} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-display font-extrabold text-[17px] leading-none text-[#1F1638] dark:text-white tracking-tight truncate">
                  {config.global.appName || 'MoraJaws'}
                </span>
                <span className="text-[9.5px] font-bold text-[#6a46c1] dark:text-[#A78BFA] uppercase tracking-[0.14em] mt-1 truncate">
                  {userRole === 'dispatch' ? 'FTTH DISPATCH OPS' : 'FTTH COMMAND'}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            {!isMiniMode && !isDrawerMode && (
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/90 dark:bg-[#22123F] border border-[#e8ddff] dark:border-[#35105E]"
                title={`Status Core: ${isOnline ? databaseStatus : 'offline'} / ${syncStatus}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    !isOnline
                      ? 'bg-amber-500'
                      : databaseStatus === 'connected'
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-amber-500'
                  }`}
                />
                <span className="text-[10px] font-bold tracking-wider text-[#1f1638] dark:text-white">
                  {!isOnline ? 'OFF' : syncStatus === 'SYNCING' ? 'SYNC' : 'LIVE'}
                </span>
              </div>
            )}
            {isDrawerMode ? (
              <button
                type="button"
                onClick={() => onChangeState('closed')}
                className="min-w-[38px] min-h-[38px] flex items-center justify-center text-[#4b4452] dark:text-[#CEC0E8] hover:text-[#58149c] dark:hover:text-white hover:bg-[#eee4ff] dark:hover:bg-[#35105E] rounded-lg transition-colors cursor-pointer"
                title="Tutup Menu"
                aria-label="Tutup Menu"
              >
                <X className="w-4 h-4" />
              </button>
            ) : !isMiniMode ? (
              <button
                type="button"
                onClick={() => onChangeState('minimized')}
                className="p-1.5 text-[#7d7484] dark:text-[#A78BFA] hover:text-[#58149c] dark:hover:text-white hover:bg-[#eee4ff] dark:hover:bg-[#35105E] rounded-lg transition-colors cursor-pointer shrink-0"
                title="Mode Ikon Ringkas (72px)"
                aria-label="Mode Ikon Ringkas"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Console Mode & Live Topology Chip (Expanded Mode) */}
        {!isMiniMode && (
          <div className="px-4 pt-3 pb-1 shrink-0 space-y-1.5">
            <div className="bg-white/80 dark:bg-white/[0.06] backdrop-blur-xl rounded-xl px-3 py-2 flex items-center justify-between shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1.5px_0_#E8DDFF] dark:shadow-none border border-[#e8ddff] dark:border-white/[0.12]">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#4b4452] dark:text-[#CEC0E8] truncate">
                CONSOLE MODE
              </span>
              <span className="px-2 py-0.5 rounded-full bg-[#EEE4FF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] text-[10px] font-bold capitalize shrink-0">
                {userRole === 'super_admin'
                  ? 'Superadmin'
                  : userRole === 'dispatch'
                  ? 'Dispatch Ops'
                  : userRole.replace('_', ' ')}
              </span>
            </div>
          </div>
        )}

        {/* 2. Global Search Bar */}
        {isMiniMode ? (
          <div className="px-2 py-2.5 border-b border-[#f3eaff] dark:border-white/10 flex flex-col items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                (window as any).__mjFocusSidebarSearch = true;
                onChangeState('expanded');
              }}
              className="w-11 h-10 rounded-xl bg-[#f8f1ff] dark:bg-[#22123F] hover:bg-[#eee4ff] dark:hover:bg-[#35105E] text-[#58149c] dark:text-[#A78BFA] flex items-center justify-center border border-[#e8ddff] dark:border-[#35105E] transition-colors cursor-pointer"
              title="Cari menu, fitur, No. WO (Ctrl+K)"
              aria-label="Cari di Sidebar"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onChangeState('expanded')}
              className="w-11 h-8 rounded-lg text-[#6a46c1] dark:text-[#A78BFA] hover:bg-[#eee4ff] dark:hover:bg-[#35105E] flex items-center justify-center transition-colors cursor-pointer"
              title="Perluas Sidebar"
              aria-label="Perluas Sidebar"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="px-4 pt-2 pb-2.5 border-b border-[#e8ddff]/80 dark:border-white/[0.12] bg-transparent dark:bg-transparent shrink-0">
            <div className="relative flex items-center w-full">
              <Search className="w-3.5 h-3.5 text-[#7d7484] dark:text-[#A78BFA] absolute left-2.5 pointer-events-none shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape' && searchQuery) {
                    e.stopPropagation();
                    setSearchQuery('');
                  }
                }}
                placeholder="Cari menu, fitur, No. WO..."
                aria-label="Global Search Sidebar"
                data-testid="sidebar-global-search"
                className="w-full pl-8 pr-12 py-1.5 bg-white dark:bg-[#22123F] hover:bg-[#fcfaff] dark:hover:bg-[#2A1650] focus:bg-white dark:focus:bg-[#2A1650] text-xs text-[#1f1638] dark:text-white placeholder-[#7d7484] dark:placeholder-[#8B8495] rounded-lg border border-[#e8ddff] dark:border-[#35105E] focus:border-[#7135b5] dark:focus:border-[#A78BFA]/70 focus:ring-2 focus:ring-[#7135b5]/20 shadow-[inset_0_1px_2px_rgba(33,24,58,0.04)] outline-none transition-all"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2 p-1 rounded text-[#7d7484] dark:text-[#A78BFA] hover:text-[#58149c] dark:hover:text-white hover:bg-[#eee4ff] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                  title="Bersihkan pencarian"
                  aria-label="Bersihkan pencarian"
                >
                  <X className="w-3 h-3" />
                </button>
              ) : (
                !isDrawerMode && (
                  <kbd className="absolute right-2 px-1.5 py-0.5 bg-[#FAF0FF] dark:bg-[#160D29]/90 border border-[#e8ddff] dark:border-[#35105E] rounded text-[9px] font-mono font-bold text-[#6a46c1] dark:text-[#A78BFA] pointer-events-none">
                    Ctrl K
                  </kbd>
                )
              )}
            </div>
          </div>
        )}

        {/* 3. Navigation Menu (Iconic Mini OR Unified Live Search Results OR Standard Menu) */}
        <nav className={`flex-1 ${isMiniMode ? 'px-2 py-3 space-y-1.5' : 'px-4 py-2.5 space-y-1'} overflow-y-auto scrollbar-thin`}>
          {isMiniMode ? (
            <div className="flex flex-col items-center gap-1.5">
              {filteredStandaloneMenus.map(item => {
                const Icon = resolveNavIcon(item.icon);
                const isActive =
                  activeTab === item.id ||
                  (item.id === 'tickets' && (activeTab === 'tickets' || activeTab === 'wo_management')) ||
                  (item.id === 'installer_portal' && (activeTab === 'installer_portal' || activeTab === 'installer_dashboard'));
                const badgeInfo = getItemBadge(item.id, item.badge);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleItemClick(item.id)}
                    title={badgeInfo ? `${item.label} (${badgeInfo.text})` : item.label}
                    aria-label={item.label}
                    className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer active:translate-y-0.5 ${
                      isActive
                        ? 'bg-[#7135b5] text-white shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_2px_6px_rgba(53,16,94,0.22)]'
                        : 'text-[#4b4452] dark:text-[#CEC0E8] hover:bg-[#eee4ff] dark:hover:bg-[#35105E] hover:text-[#1f1638] dark:hover:text-white'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-[#6a46c1] dark:text-[#A78BFA]'}`} />
                    {badgeInfo && (
                      <span
                        className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[8.5px] font-mono font-bold flex items-center justify-center tabular-nums ring-2 ring-white dark:ring-[#160D29] ${
                          badgeInfo.color === 'rose'
                            ? 'bg-[#DC4C5A] text-white'
                            : badgeInfo.color === 'amber'
                            ? 'bg-[#D97706] text-white'
                            : badgeInfo.color === 'emerald'
                            ? 'bg-[#16A36A] text-white'
                            : 'bg-[#7b1eca] text-white'
                        }`}
                      >
                        {typeof badgeInfo.text === 'number' && badgeInfo.text > 99 ? '99+' : badgeInfo.text}
                      </span>
                    )}
                  </button>
                );
              })}

              {filteredCategoriesWithSubmenus.length > 0 && (
                <div className="w-8 h-px bg-[#e8ddff] dark:bg-[#35105E] my-1" />
              )}

              {filteredCategoriesWithSubmenus.flatMap(cat => cat.submenus).map(item => {
                const SubIcon = resolveNavIcon(item.icon);
                const isActive =
                  activeTab === item.id ||
                  (item.id === 'contractor_recap' && activeTab === 'rekap_laporan') ||
                  (item.id === 'setup' &&
                    ['ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab));
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleItemClick(item.id)}
                    title={item.label}
                    aria-label={item.label}
                    className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer active:translate-y-0.5 ${
                      isActive
                        ? 'bg-[#7135b5] text-white shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_2px_6px_rgba(53,16,94,0.22)]'
                        : 'text-[#4b4452] dark:text-[#CEC0E8] hover:bg-[#eee4ff] dark:hover:bg-[#35105E] hover:text-[#1f1638] dark:hover:text-white'
                    }`}
                  >
                    <SubIcon className={`w-4.5 h-4.5 ${isActive ? 'text-white' : 'text-[#6a46c1] dark:text-[#A78BFA]'}`} />
                  </button>
                );
              })}
            </div>
          ) : searchQuery.trim() ? (
            <div className="space-y-3" data-testid="sidebar-search-results">
              {/* Group A: Live RBAC Menu & Feature Results */}
              <div className="space-y-1">
                <div className="px-2 py-1 flex items-center justify-between text-[10px] font-bold text-[#7d7484] dark:text-[#A78BFA] uppercase tracking-wider">
                  <span>Menu &amp; Fitur (RBAC)</span>
                  <span className="font-mono text-[#58149c] dark:text-[#D8B4FE]">{matchedMenus.length}</span>
                </div>
                {matchedMenus.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-[11px] text-[#7d7484] italic">
                    Tidak ada menu yang cocok.
                  </p>
                ) : (
                  matchedMenus.map(item => {
                    const ItemIcon = resolveNavIcon(item.icon);
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={`search-menu-${item.id}`}
                        type="button"
                        onClick={() => {
                          handleItemClick(item.id);
                          setSearchQuery('');
                        }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[#7135b5] text-white font-bold shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_2px_6px_rgba(53,16,94,0.2)]'
                            : 'text-[#4b4452] dark:text-[#CEC0E8] hover:bg-[#eee4ff] dark:hover:bg-[#35105E] hover:text-[#1f1638] dark:hover:text-white'
                        }`}
                      >
                        <ItemIcon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#6a46c1] dark:text-[#A78BFA]'}`} />
                        <div className="flex-1 min-w-0 text-left">
                          <div className="truncate font-semibold">{item.label}</div>
                          {item.group && (
                            <div className={`text-[9.5px] truncate ${isActive ? 'text-white/80' : 'text-[#7d7484]'}`}>{item.group}</div>
                          )}
                        </div>
                        <ArrowUpRight className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-[#6a46c1] dark:text-[#A78BFA]'}`} />
                      </button>
                    );
                  })
                )}
              </div>

              {/* Group B: Live Work Order Search Results */}
              <div className="space-y-1 pt-2 border-t border-[#e8ddff] dark:border-[#35105E]/60">
                <div className="px-2 py-1 flex items-center justify-between text-[10px] font-bold text-[#7d7484] dark:text-[#A78BFA] uppercase tracking-wider">
                  <span>Work Order</span>
                  {isSearching ? (
                    <Loader2 className="w-3 h-3 animate-spin text-[#7135b5] dark:text-[#D8B4FE]" />
                  ) : (
                    <span className="font-mono text-[#58149c] dark:text-[#D8B4FE]">{searchResults.length}</span>
                  )}
                </div>

                {searchError && (
                  <p className="px-2.5 py-1 text-[10px] text-amber-700 dark:text-amber-300/90">{searchError}</p>
                )}

                {!isSearching && searchResults.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-[11px] text-[#7d7484] italic">
                    Tidak ada Work Order cocok.
                  </p>
                ) : (
                  searchResults.map(t => {
                    const apptDate = getTicketAppointmentDate(t) || '-';
                    return (
                      <button
                        key={`search-wo-${t.id}`}
                        type="button"
                        onClick={() => {
                          if (onSelectTicket) {
                            onSelectTicket(t, 'overview');
                          } else {
                            onNavigate('tickets');
                          }
                          if (isDrawerMode && config?.device?.android?.autoCloseSidebarOnNavigate !== false) {
                            onChangeState('closed');
                          }
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-lg bg-[#f8f1ff] dark:bg-[#1E1236]/80 hover:bg-[#eee4ff] dark:hover:bg-[#35105E] border border-[#e8ddff] dark:border-[#35105E]/70 transition-colors cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-[#58149c] dark:text-white truncate">
                            {t.woNumber || '-'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#eee4ff] dark:bg-[#35105E] text-[#58149c] dark:text-[#D8B4FE] text-[9px] font-bold shrink-0">
                            {apptDate}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium text-[#1f1638] dark:text-[#CEC0E8] truncate">
                          {t.customerName || '-'}
                        </div>
                        <div className="flex items-center justify-between gap-1.5 text-[9.5px] text-[#7d7484] dark:text-[#8B8495]">
                          <span className="truncate">{t.idCustomer || t.installerName || '-'}</span>
                          <span className="text-[#6a46c1] dark:text-[#A78BFA] font-semibold shrink-0">{t.statusWOInstaller || t.statusWOAgent || 'OPEN'}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="px-2 pt-1 pb-1 text-[10px] font-extrabold text-[#7d7484] dark:text-[#8B8495] uppercase tracking-[0.1em]">
                Operational Queue
              </div>

              {/* Standalone Menus */}
              <div className="space-y-1">
                {filteredStandaloneMenus.map(item => {
                  const Icon = resolveNavIcon(item.icon);
                  const isActive =
                    activeTab === item.id ||
                    (item.id === 'tickets' && (activeTab === 'tickets' || activeTab === 'wo_management')) ||
                    (item.id === 'installer_portal' && (activeTab === 'installer_portal' || activeTab === 'installer_dashboard'));

                  const badgeInfo = getItemBadge(item.id, item.badge);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleItemClick(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-all cursor-pointer active:translate-y-0.5 ${
                        isActive
                          ? 'bg-white text-[#58149C] font-bold border border-[#D8B4FE] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_2.5px_0_#D8CCF3,0_4px_10px_rgba(88,20,156,0.1)] dark:bg-[#7135b5] dark:text-white dark:border-[#A78BFA]/40 dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.45),0_2px_6px_rgba(53,16,94,0.22)]'
                          : 'text-[#4b4452] dark:text-[#CEC0E8] font-semibold hover:bg-white/75 dark:hover:bg-[#35105E] hover:text-[#1f1638] dark:hover:text-white'
                      }`}
                    >
                      <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-[#58149C] dark:text-white' : 'text-[#6a46c1] dark:text-[#A78BFA]'}`} />
                      <span className="flex-1 text-left truncate whitespace-nowrap">{item.label}</span>
                      {badgeInfo && (
                        <span
                          className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full tabular-nums shrink-0 ${
                            badgeInfo.color === 'rose'
                              ? 'bg-[#DC4C5A] text-white'
                              : isActive
                              ? 'bg-[#F3EAFF] text-[#58149C] dark:bg-white/20 dark:text-white'
                              : badgeInfo.color === 'amber'
                              ? 'bg-amber-100 text-amber-800 dark:bg-[#E59A27]/25 dark:text-[#FBBF24]'
                              : badgeInfo.color === 'emerald'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-[#16A36A]/25 dark:text-emerald-300'
                              : 'bg-[#7b1eca] text-white dark:bg-[#35105E] dark:text-[#D8B4FE]'
                          }`}
                        >
                          {badgeInfo.text}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Collapsible Category Accordions */}
              {filteredCategoriesWithSubmenus.length > 0 && (
                <div className="pt-3 space-y-1.5">
                  {filteredCategoriesWithSubmenus.map(cat => {
                    const CatIcon = resolveNavIcon(cat.icon);
                    const isAccordionMode = cat.mode !== 'static';
                    const isOpen = isAccordionMode ? !!openGroups[cat.id] : true;
                    const hasActiveChild = cat.submenus.some(
                      sub =>
                        activeTab === sub.id ||
                        (sub.id === 'contractor_recap' && activeTab === 'rekap_laporan') ||
                        (sub.id === 'setup' && ['setup', 'ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab))
                    );

                    return (
                      <div key={cat.id} className="space-y-1">
                        {isAccordionMode ? (
                          <button
                            type="button"
                            onClick={() => toggleGroup(cat.id, 'accordion')}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                              hasActiveChild
                                ? 'text-[#58149c] dark:text-white bg-[#f3eaff] dark:bg-[#35105E]/70'
                                : 'text-[#7d7484] dark:text-[#A78BFA] hover:bg-[#f8f1ff] dark:hover:bg-[#35105E] hover:text-[#1f1638] dark:hover:text-white'
                            }`}
                            aria-expanded={isOpen}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <CatIcon className="w-3.5 h-3.5 shrink-0 text-[#6a46c1] dark:text-[#A78BFA]" />
                              <span className="truncate">{cat.name}</span>
                            </div>
                            <ChevronDown
                              className={`w-3.5 h-3.5 shrink-0 text-[#7d7484] dark:text-[#A78BFA] transition-transform duration-200 ${
                                isOpen ? 'rotate-180' : 'rotate-0'
                              }`}
                            />
                          </button>
                        ) : (
                          <div className="w-full flex items-center gap-2 px-2.5 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-[#7d7484] dark:text-[#A78BFA]">
                            <CatIcon className="w-3.5 h-3.5 shrink-0 text-[#6a46c1] dark:text-[#A78BFA]" />
                            <span className="truncate">{cat.name}</span>
                          </div>
                        )}

                        {isOpen && (
                          <div className="space-y-0.5 pl-1">
                            {cat.submenus.map(item => {
                              const SubIcon = resolveNavIcon(item.icon);
                              const isActive =
                                activeTab === item.id ||
                                (item.id === 'contractor_recap' && activeTab === 'rekap_laporan') ||
                                (item.id === 'setup' &&
                                  ['ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab));

                              const badgeInfo = getItemBadge(item.id, item.badge);

                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleItemClick(item.id)}
                                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] transition-all cursor-pointer active:translate-y-0.5 ${
                                    isActive
                                      ? 'bg-white text-[#58149C] font-bold border border-[#D8B4FE] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_2px_0_#D8CCF3] dark:bg-[#7135b5] dark:text-white dark:border-[#A78BFA]/40 dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.45),0_2px_6px_rgba(53,16,94,0.22)]'
                                      : item.highlight
                                      ? 'text-[#58149c] dark:text-white bg-[#f3eaff] dark:bg-[#35105E]/50 hover:bg-white/80 dark:hover:bg-[#35105E] font-semibold'
                                      : 'text-[#4b4452] dark:text-[#CEC0E8] hover:bg-white/75 dark:hover:bg-[#35105E] hover:text-[#1f1638] dark:hover:text-white font-semibold'
                                  }`}
                                >
                                  <SubIcon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#58149C] dark:text-white' : 'text-[#6a46c1] dark:text-[#A78BFA]'}`} />
                                  <span className="flex-1 text-left truncate whitespace-nowrap">{item.label}</span>
                                  {badgeInfo && (
                                    <span
                                      className={`ml-1 px-1.5 py-0.5 text-[9.5px] font-mono font-bold rounded-full tabular-nums shrink-0 ${
                                        badgeInfo.color === 'rose'
                                          ? 'bg-[#DC4C5A] text-white'
                                          : isActive
                                          ? 'bg-[#F3EAFF] text-[#58149C] dark:bg-white/20 dark:text-white'
                                          : badgeInfo.color === 'amber'
                                          ? 'bg-amber-100 text-amber-800 dark:bg-[#E59A27]/25 dark:text-[#FBBF24]'
                                          : badgeInfo.color === 'emerald'
                                          ? 'bg-emerald-100 text-emerald-800 dark:bg-[#16A36A]/25 dark:text-emerald-300'
                                          : 'bg-[#7b1eca] text-white dark:bg-[#35105E] dark:text-[#D8B4FE]'
                                      }`}
                                    >
                                      {badgeInfo.text}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </nav>

        {/* 4. Bottom Core Telemetry Summary & Quick Operational Escalation */}
        <div className={`${isMiniMode ? 'p-2 items-center' : 'p-4'} bg-white/30 dark:bg-white/[0.03] border-t border-[#e8ddff]/85 dark:border-white/[0.12] space-y-2.5 shrink-0`}>
          {isMiniMode ? (
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="w-11 h-9 rounded-lg bg-white dark:bg-[#160D29]/75 flex items-center justify-center border border-[#e8ddff] dark:border-[#35105E]"
                title={`Cluster: ${databaseStatus === 'connected' ? 'LIVE' : databaseStatus} (${syncStatus})`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    databaseStatus === 'connected'
                      ? 'bg-[#16A36A]'
                      : databaseStatus === 'connecting'
                      ? 'bg-[#E59A27] animate-pulse'
                      : 'bg-[#DC4C5A]'
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={logout}
                className="w-11 h-9 rounded-lg text-rose-600 dark:text-rose-300 hover:text-white hover:bg-[#DC4C5A] flex items-center justify-center transition-colors cursor-pointer"
                title="Keluar / Logout"
                aria-label="Keluar / Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="p-3 rounded-xl bg-white/82 dark:bg-white/[0.06] backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_2px_0_#E8DDFF] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] border border-[#e8ddff] dark:border-white/[0.12] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1F1638] dark:text-[#D8B4FE]">
                    CORE TELEMETRY
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      databaseStatus === 'connected'
                        ? 'bg-[#58149C] dark:bg-[#16A36A] animate-pulse'
                        : databaseStatus === 'connecting'
                        ? 'bg-[#E59A27] animate-pulse'
                        : 'bg-[#DC4C5A]'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-[#4b4452] dark:text-[#CEC0E8] tabular-nums">
                  <span>{totalActiveTickets} WO Aktif</span>
                  <span className="text-[#58149C] dark:text-[#DAB9FF] font-mono font-bold">
                    {todayCompletionPct}% Done
                  </span>
                </div>
                <div className="w-full bg-[#F3EAFF] dark:bg-[#22123F] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#58149c] dark:bg-[#a380fe] h-full transition-all duration-300"
                    style={{ width: `${todayCompletionPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#f3eaff] dark:border-white/10 text-[10.5px]">
                  <span className="font-bold text-[#1f1638] dark:text-[#CEC0E8] truncate">
                    {currentUser?.name || 'Staff'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#f3eaff] dark:bg-[#35105E] text-[#58149c] dark:text-[#DAB9FF] font-bold tabular-nums shrink-0">
                    {unassignedCount} Unassigned
                  </span>
                </div>
              </div>

              {(userRole === 'super_admin' || userRole === 'dispatch') && (
                <button
                  type="button"
                  onClick={() =>
                    handleItemClick(
                      overdueSummary.totalOverdue > 0
                        ? 'overdue_wo'
                        : butuhApprovalCount > 0
                        ? 'verification_desk'
                        : 'tickets'
                    )
                  }
                  className="btn-3d-darkpurple w-full py-2.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Zap className="w-3.5 h-3.5 text-[#D8B4FE] shrink-0" />
                  <span>
                    {overdueSummary.totalOverdue > 0
                      ? `Emergency Overdue (${overdueSummary.totalOverdue})`
                      : butuhApprovalCount > 0
                      ? `Antrean Verifikasi (${butuhApprovalCount})`
                      : 'Triage Work Orders'}
                  </span>
                </button>
              )}

              <div className="flex items-center gap-1.5">
                {userRole === 'super_admin' && (
                  <button
                    type="button"
                    onClick={() => setIsSessionModalOpen(true)}
                    className="btn-3d-lilac flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap"
                    title="Kelola Sesi Staf Aktif"
                  >
                    <KeyRound className="w-3.5 h-3.5 shrink-0" />
                    <span>Sesi</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={logout}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-rose-50 dark:bg-[#DC4C5A]/20 text-rose-700 dark:text-rose-200 border border-rose-200/80 dark:border-transparent hover:bg-rose-600 hover:text-white dark:hover:bg-[#DC4C5A]/45 text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                  title="Keluar / Logout"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span>Keluar</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
