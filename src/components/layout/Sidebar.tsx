import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { MoraJawsLogo } from '../common/MoraJawsLogo';
import { Ticket, StandaloneMenuItem } from '../../types/index.ts';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { partitionSidebarNavigation } from '../../utils/uiLayoutHelpers';
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
  AlertTriangle
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
  const { currentUser, tickets, scopedTickets, overdueSummary, todayWIB, logout, setIsSessionModalOpen, setIsChangePasswordModalOpen, hasPermission, rolePermissions, databaseStatus, syncStatus, totalLiveChatUnreadCount } = useApp();
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
      return ['super_admin', 'dispatch', 'leader'].includes(userRole);
    }
    if (menuId === 'database_management' || menuId === 'data_deletion') {
      return userRole === 'super_admin' || (userRole === 'dispatch' && hasPermission('delete_wo_data'));
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
    const list: StandaloneMenuItem[] = rawList.map(m => (m ? { ...m } : m));
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
    const liveChatItem = list.find(
      m =>
        m &&
        (m.id === 'contact_centre' ||
          ['livechat', 'live chat'].includes(String(m.label || '').trim().toLowerCase()))
    );
    const existingOverdueWo = list.find(m => m && m.id === 'overdue_wo');
    if (!existingOverdueWo && ['super_admin', 'dispatch', 'leader'].includes(userRole)) {
      const ticketsItem = list.find(m => m && m.id === 'tickets');
      const targetLiveChatOrder = ticketsItem ? Number(ticketsItem.order || 3) + 0.5 : 2.5;
      const overdueOrder = liveChatItem ? Number(liveChatItem.order || 6) : 6;
      if (liveChatItem && Number(liveChatItem.order || 0) > targetLiveChatOrder) {
        liveChatItem.order = targetLiveChatOrder;
      }
      list.push({
        id: 'overdue_wo',
        label: 'Overdue WO',
        icon: 'AlertTriangle',
        order: overdueOrder,
        visible: true,
        roles: ['super_admin', 'dispatch', 'leader']
      });
    } else if (existingOverdueWo && String(existingOverdueWo.label || '').trim() === 'OVERDUE WO') {
      existingOverdueWo.label = 'Overdue WO';
      if (liveChatItem && Number(existingOverdueWo.order || 0) < Number(liveChatItem.order || 0)) {
        const prevOverdueOrder = existingOverdueWo.order;
        existingOverdueWo.order = liveChatItem.order;
        liveChatItem.order = prevOverdueOrder;
      }
    }

    return [...list]
      .filter(item => {
        if (!item || item.visible === false) return false;
        if (item.id === 'templates' && userRole !== 'super_admin' && userRole !== 'dispatch') return false;
        if (item.id === 'database_management') {
          return canAccessMenuId('database_management');
        }
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
        // Role LEADER tidak memiliki kategori Setting / Setup / Menu Tambahan
        if (
          userRole === 'leader' &&
          (catId === 'menu_tambahan' ||
            catId === 'cat_tambahan' ||
            catId.includes('setting') ||
            catName.includes('setting') ||
            catName.includes('menu tambahan') ||
            catName === 'setup')
        ) {
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
            // Role LEADER tidak boleh melihat report installer maupun menu setting
            if (
              userRole === 'leader' &&
              (subId === 'report_installer' ||
                subId === 'offline_sync' ||
                subId === 'quota_settings' ||
                subId === 'setup' ||
                subId === 'nav_config' ||
                subId === 'management_role' ||
                subId === 'droplist_management' ||
                subId === 'sound_settings' ||
                subId.includes('setting'))
            ) {
              return false;
            }
            // Requirement 5: WhatsApp Templates strictly for super_admin and dispatch only
            if (subId === 'templates' && userRole !== 'super_admin' && userRole !== 'dispatch') {
              return false;
            }
            if (subId === 'database_management') {
              return canAccessMenuId('database_management');
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

  const {
    operationalStandalone,
    operationalCategories,
    adminStandalone,
    adminCategories
  } = useMemo(
    () => partitionSidebarNavigation(filteredStandaloneMenus, filteredCategoriesWithSubmenus),
    [filteredStandaloneMenus, filteredCategoriesWithSubmenus]
  );

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
          (sub.id === 'database_management' && activeTab === 'data_deletion') ||
          (sub.id === 'contractor_recap' && activeTab === 'rekap_laporan') ||
          (sub.id === 'setup' && ['ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab))
      );
      initial[cat.id] = hasActive || cat.mode === 'static' || cat.id === 'menu_tambahan';
    });
    return initial;
  });

  // Ensure active category expands when activeTab navigates into it
  useEffect(() => {
    filteredCategoriesWithSubmenus.forEach(cat => {
      const hasActive = cat.submenus.some(
        sub =>
          sub.id === activeTab ||
          (sub.id === 'database_management' && activeTab === 'data_deletion') ||
          (sub.id === 'contractor_recap' && activeTab === 'rekap_laporan') ||
          (sub.id === 'setup' && ['ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab))
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
  const getItemBadge = (
    itemId: string,
    defaultBadge?: string | number
  ): { text: string | number; color: 'rose' | 'amber' | 'emerald' | 'purple' } | null => {
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

      {/* Sidebar Main Frame: Crystal Aqua Lavender Light Water Glass (Dark Mode untouched) */}
      <aside
        data-testid="app-sidebar"
        data-drawer-mode={isDrawerMode ? 'true' : 'false'}
        data-mini-mode={isMiniMode ? 'true' : 'false'}
        className={`${
          isDrawerMode
            ? 'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-2xl'
            : isMiniMode
            ? 'relative w-[72px] shadow-none'
            : 'relative w-72 shadow-[0_12px_36px_rgba(38,54,74,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.28)]'
        } bg-white/78 dark:bg-white/[0.06] backdrop-blur-2xl text-[#52647A] dark:text-[#CEC0E8] border-r border-[#DDE6F0]/90 dark:border-white/[0.14] transition-all duration-200 ease-out flex flex-col shrink-0 h-full select-none`}
      >
        {/* 1. Sidebar Header / MoraJaws Brand Lockup */}
        <div className={`h-16 ${isMiniMode ? 'px-2 justify-center' : 'px-5 justify-between'} flex items-center bg-transparent dark:bg-transparent border-b border-[#DDE6F0]/80 dark:border-white/[0.12] sticky top-0 z-10 shrink-0`}>
          {isMiniMode ? (
            <button
              type="button"
              onClick={() => onChangeState('expanded')}
              className="w-10 h-10 rounded-xl bg-white/95 dark:bg-[#140D33]/90 border border-[#D8CCF3] dark:border-purple-400/35 flex items-center justify-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_3px_0_#D8CCF3,0_6px_14px_rgba(102,87,200,0.16)] dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.22),0_2px_8px_rgba(16,8,36,0.45)] active:translate-y-0.5 cursor-pointer"
              title="Perluas Sidebar (Work Order Management)"
              aria-label="Perluas Sidebar"
            >
              <MoraJawsLogo variant="symbol" size="sm" animated={false} withGlow={false} />
            </button>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-white/95 dark:bg-[#140D33]/90 border border-[#D8CCF3] dark:border-purple-400/35 flex items-center justify-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_2px_8px_rgba(102,87,200,0.16)] dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.22),0_2px_8px_rgba(16,8,36,0.45)] shrink-0">
                <MoraJawsLogo variant="symbol" size="sm" animated={false} withGlow={false} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-display font-extrabold text-[17px] leading-none text-[#1E1B3A] dark:text-white tracking-tight truncate">
                  {config.global.appName && config.global.appName !== 'MoraJaws' ? (
                    config.global.appName
                  ) : (
                    <>
                      Mora<span className="text-[#6D28D9] dark:text-[#C084FC]">Jaws</span>
                    </>
                  )}
                </span>
                <span className="text-[9.5px] font-bold text-[#6657C8] dark:text-[#A78BFA] uppercase tracking-[0.14em] mt-1 truncate">
                  {userRole === 'dispatch' ? 'FTTH DISPATCH OPS' : 'FTTH COMMAND'}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            {!isMiniMode && !isDrawerMode && (
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EDF3F8]/95 dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E]"
                title={`Status Core: ${isOnline ? databaseStatus : 'offline'} / ${syncStatus}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    !isOnline
                      ? 'bg-[#C88735] dark:bg-amber-500'
                      : databaseStatus === 'connected'
                      ? 'bg-[#218A63] dark:bg-emerald-500 animate-pulse'
                      : 'bg-[#C88735] dark:bg-amber-500'
                  }`}
                />
                <span className="text-[10px] font-bold tracking-wider text-[#26364A] dark:text-white">
                  {!isOnline ? 'OFF' : syncStatus === 'SYNCING' ? 'SYNC' : 'LIVE'}
                </span>
              </div>
            )}
            {isDrawerMode ? (
              <button
                type="button"
                onClick={() => onChangeState('closed')}
                className="min-w-[38px] min-h-[38px] flex items-center justify-center text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] rounded-lg transition-colors cursor-pointer"
                title="Tutup Menu"
                aria-label="Tutup Menu"
              >
                <X className="w-4 h-4" />
              </button>
            ) : !isMiniMode ? (
              <button
                type="button"
                onClick={() => onChangeState('minimized')}
                className="p-1.5 text-[#8492A5] dark:text-[#A78BFA] hover:text-[#5145A6] dark:hover:text-white hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] rounded-lg transition-colors cursor-pointer shrink-0"
                title="Mode Ikon Ringkas (72px)"
                aria-label="Mode Ikon Ringkas"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>

        {/* 2. Global Search Bar */}
        {isMiniMode ? (
          <div className="px-2 py-2.5 border-b border-[#DDE6F0] dark:border-white/10 flex flex-col items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                (window as any).__mjFocusSidebarSearch = true;
                onChangeState('expanded');
              }}
              className="w-11 h-10 rounded-xl bg-[#F8FAFD] dark:bg-[#22123F] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] text-[#5145A6] dark:text-[#A78BFA] flex items-center justify-center border border-[#DDE6F0] dark:border-[#35105E] transition-colors cursor-pointer"
              title="Cari menu, fitur, No. WO (Ctrl+K)"
              aria-label="Cari di Sidebar"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onChangeState('expanded')}
              className="w-11 h-8 rounded-lg text-[#6657C8] dark:text-[#A78BFA] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] flex items-center justify-center transition-colors cursor-pointer"
              title="Perluas Sidebar"
              aria-label="Perluas Sidebar"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="px-4 pt-2 pb-2.5 border-b border-[#DDE6F0]/80 dark:border-white/[0.12] bg-transparent dark:bg-transparent shrink-0">
            <div className="relative flex items-center w-full">
              <Search className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A78BFA] absolute left-2.5 pointer-events-none shrink-0" />
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
                className="w-full pl-8 pr-12 py-1.5 bg-white/95 dark:bg-[#22123F] hover:bg-white dark:hover:bg-[#2A1650] focus:bg-white dark:focus:bg-[#2A1650] text-xs text-[#26364A] dark:text-white placeholder-[#8492A5] dark:placeholder-[#8B8495] rounded-lg border border-[#DDE6F0] dark:border-[#35105E] focus:border-[#6657C8] dark:focus:border-[#A78BFA]/70 focus:ring-2 focus:ring-[#6657C8]/20 dark:focus:ring-[#7135b5]/20 shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)] outline-none transition-all"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2 p-1 rounded text-[#8492A5] dark:text-[#A78BFA] hover:text-[#5145A6] dark:hover:text-white hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                  title="Bersihkan pencarian"
                  aria-label="Bersihkan pencarian"
                >
                  <X className="w-3 h-3" />
                </button>
              ) : (
                !isDrawerMode && (
                  <kbd className="absolute right-2 px-1.5 py-0.5 bg-[#EDF3F8] dark:bg-[#160D29]/90 border border-[#DDE6F0] dark:border-[#35105E] rounded text-[9px] font-mono font-bold text-[#5145A6] dark:text-[#A78BFA] pointer-events-none">
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
              {[...operationalStandalone, ...operationalCategories.flatMap(cat => cat.submenus)].map(item => {
                const Icon = resolveNavIcon(item.icon);
                const isActive =
                  activeTab === item.id ||
                  (item.id === 'tickets' && (activeTab === 'tickets' || activeTab === 'wo_management')) ||
                  (item.id === 'installer_portal' && (activeTab === 'installer_portal' || activeTab === 'installer_dashboard')) ||
                  (item.id === 'contractor_recap' && activeTab === 'rekap_laporan');
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
                        ? 'bg-gradient-to-b from-[#7364D4] to-[#6657C8] dark:bg-[#7135b5] dark:bg-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_2.5px_0_#5145A6,0_5px_12px_rgba(102,87,200,0.2)] dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_2px_6px_rgba(53,16,94,0.22)]'
                        : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-[#6657C8] dark:text-[#A78BFA]'}`} />
                    {badgeInfo && (
                      <span
                        className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[8.5px] font-mono font-bold flex items-center justify-center tabular-nums ring-2 ring-white dark:ring-[#160D29] ${
                          badgeInfo.color === 'rose'
                            ? 'bg-[#D45B66] dark:bg-[#DC4C5A] text-white'
                            : badgeInfo.color === 'amber'
                            ? 'bg-[#C88735] dark:bg-[#D97706] text-white'
                            : badgeInfo.color === 'emerald'
                            ? 'bg-[#218A63] dark:bg-[#16A36A] text-white'
                            : 'bg-[#6657C8] dark:bg-[#7b1eca] text-white'
                        }`}
                      >
                        {typeof badgeInfo.text === 'number' && badgeInfo.text > 99 ? '99+' : badgeInfo.text}
                      </span>
                    )}
                  </button>
                );
              })}

              {(adminStandalone.length > 0 || adminCategories.length > 0) && (
                <div className="w-8 h-px bg-[#DDE6F0] dark:bg-[#35105E] my-1" />
              )}

              {[...adminStandalone, ...adminCategories.flatMap(cat => cat.submenus)].map(item => {
                const SubIcon = resolveNavIcon(item.icon);
                const isActive =
                  activeTab === item.id ||
                  (item.id === 'database_management' && activeTab === 'data_deletion') ||
                  (item.id === 'setup' &&
                    ['setup', 'ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab));
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleItemClick(item.id)}
                    title={item.label}
                    aria-label={item.label}
                    className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer active:translate-y-0.5 ${
                      isActive
                        ? 'bg-gradient-to-b from-[#7364D4] to-[#6657C8] dark:bg-[#7135b5] dark:bg-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_2.5px_0_#5145A6,0_5px_12px_rgba(102,87,200,0.2)] dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_2px_6px_rgba(53,16,94,0.22)]'
                        : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white'
                    }`}
                  >
                    <SubIcon className={`w-4.5 h-4.5 ${isActive ? 'text-white' : 'text-[#6657C8] dark:text-[#A78BFA]'}`} />
                  </button>
                );
              })}
            </div>
          ) : searchQuery.trim() ? (
            <div className="space-y-3" data-testid="sidebar-search-results">
              {/* Group A: Live RBAC Menu & Feature Results */}
              <div className="space-y-1">
                <div className="px-2 py-1 flex items-center justify-between text-[10px] font-bold text-[#8492A5] dark:text-[#A78BFA] uppercase tracking-wider">
                  <span>Menu &amp; Fitur (RBAC)</span>
                  <span className="font-mono text-[#5145A6] dark:text-[#D8B4FE]">{matchedMenus.length}</span>
                </div>
                {matchedMenus.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-[11px] text-[#8492A5] italic">
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
                            ? 'bg-gradient-to-b from-[#7364D4] to-[#6657C8] dark:bg-[#7135b5] dark:bg-none text-white font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_0_#5145A6] dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_2px_6px_rgba(53,16,94,0.2)]'
                            : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white'
                        }`}
                      >
                        <ItemIcon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#6657C8] dark:text-[#A78BFA]'}`} />
                        <div className="flex-1 min-w-0 text-left">
                          <div className="truncate font-semibold">{item.label}</div>
                          {item.group && (
                            <div className={`text-[9.5px] truncate ${isActive ? 'text-white/80' : 'text-[#8492A5]'}`}>{item.group}</div>
                          )}
                        </div>
                        <ArrowUpRight className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-[#6657C8] dark:text-[#A78BFA]'}`} />
                      </button>
                    );
                  })
                )}
              </div>

              {/* Group B: Live Work Order Search Results */}
              <div className="space-y-1 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]/60">
                <div className="px-2 py-1 flex items-center justify-between text-[10px] font-bold text-[#8492A5] dark:text-[#A78BFA] uppercase tracking-wider">
                  <span>Work Order</span>
                  {isSearching ? (
                    <Loader2 className="w-3 h-3 animate-spin text-[#6657C8] dark:text-[#D8B4FE]" />
                  ) : (
                    <span className="font-mono text-[#5145A6] dark:text-[#D8B4FE]">{searchResults.length}</span>
                  )}
                </div>

                {searchError && (
                  <p className="px-2.5 py-1 text-[10px] text-amber-700 dark:text-amber-300/90">{searchError}</p>
                )}

                {!isSearching && searchResults.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-[11px] text-[#8492A5] italic">
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
                        className="w-full text-left px-2.5 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#1E1236]/80 hover:bg-[#F0EDFF] dark:hover:bg-[#35105E] border border-[#DDE6F0] dark:border-[#35105E]/70 transition-colors cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-[#5145A6] dark:text-white truncate">
                            {t.woNumber || '-'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] text-[9px] font-bold shrink-0">
                            {apptDate}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium text-[#26364A] dark:text-[#CEC0E8] truncate">
                          {t.customerName || '-'}
                        </div>
                        <div className="flex items-center justify-between gap-1.5 text-[9.5px] text-[#8492A5] dark:text-[#8B8495]">
                          <span className="truncate">{t.idCustomer || t.installerName || '-'}</span>
                          <span className="text-[#6657C8] dark:text-[#A78BFA] font-semibold shrink-0">{t.statusWOInstaller || t.statusWOAgent || 'OPEN'}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <>
              <div
                data-testid="sidebar-section-operational"
                className="px-2 pt-1 pb-1 text-[10px] font-extrabold text-[#8492A5] dark:text-[#8B8495] uppercase tracking-[0.1em]"
              >
                Operational Queue
              </div>

              {/* Operational Standalone Menus */}
              <div className="space-y-1">
                {operationalStandalone.map(item => {
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
                          ? 'bg-gradient-to-b from-white to-[#F0EDFF]/90 text-[#5145A6] font-bold border border-[#D4CEFA] shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_2.5px_0_#D2CEF2,0_5px_12px_rgba(102,87,200,0.1)] dark:bg-[#7135b5] dark:bg-none dark:text-white dark:border-[#A78BFA]/40 dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.45),0_2px_6px_rgba(53,16,94,0.22)]'
                          : 'text-[#52647A] dark:text-[#CEC0E8] font-semibold hover:bg-white/80 dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white'
                      }`}
                    >
                      <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-[#6657C8] dark:text-white' : 'text-[#6657C8] dark:text-[#A78BFA]'}`} />
                      <span className="flex-1 text-left truncate whitespace-nowrap">{item.label}</span>
                      {badgeInfo && (
                        <span
                          className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full tabular-nums shrink-0 ${
                            badgeInfo.color === 'rose'
                              ? 'bg-[#D45B66] dark:bg-[#DC4C5A] text-white'
                              : isActive
                              ? 'bg-[#EAE8FF] text-[#5145A6] dark:bg-white/20 dark:text-white'
                              : badgeInfo.color === 'amber'
                              ? 'bg-[#FFF2D9] text-[#C88735] dark:bg-[#E59A27]/25 dark:text-[#FBBF24]'
                              : badgeInfo.color === 'emerald'
                              ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-[#16A36A]/25 dark:text-emerald-300'
                              : 'bg-[#6657C8] text-white dark:bg-[#35105E] dark:text-[#D8B4FE]'
                          }`}
                        >
                          {badgeInfo.text}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Operational Category Accordions */}
              {operationalCategories.length > 0 && (
                <div className="pt-3 space-y-1.5">
                  {operationalCategories.map(cat => {
                    const CatIcon = resolveNavIcon(cat.icon);
                    const isAccordionMode = cat.mode !== 'static';
                    const isOpen = isAccordionMode ? !!openGroups[cat.id] : true;
                    const hasActiveChild = cat.submenus.some(
                      sub =>
                        activeTab === sub.id ||
                        (sub.id === 'contractor_recap' && activeTab === 'rekap_laporan')
                    );

                    return (
                      <div key={cat.id} className="space-y-1">
                        {isAccordionMode ? (
                          <button
                            type="button"
                            onClick={() => toggleGroup(cat.id, 'accordion')}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                              hasActiveChild
                                ? 'text-[#5145A6] dark:text-white bg-[#F0EDFF] dark:bg-[#35105E]/70'
                                : 'text-[#8492A5] dark:text-[#A78BFA] hover:bg-[#F8FAFD] dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white'
                            }`}
                            aria-expanded={isOpen}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <CatIcon className="w-3.5 h-3.5 shrink-0 text-[#6657C8] dark:text-[#A78BFA]" />
                              <span className="truncate">{cat.name}</span>
                            </div>
                            <ChevronDown
                              className={`w-3.5 h-3.5 shrink-0 text-[#8492A5] dark:text-[#A78BFA] transition-transform duration-200 ${
                                isOpen ? 'rotate-180' : 'rotate-0'
                              }`}
                            />
                          </button>
                        ) : (
                          <div className="w-full flex items-center gap-2 px-2.5 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A78BFA]">
                            <CatIcon className="w-3.5 h-3.5 shrink-0 text-[#6657C8] dark:text-[#A78BFA]" />
                            <span className="truncate">{cat.name}</span>
                          </div>
                        )}

                        {isOpen && (
                          <div className="space-y-0.5 pl-1">
                            {cat.submenus.map(item => {
                              const SubIcon = resolveNavIcon(item.icon);
                              const isActive =
                                activeTab === item.id ||
                                (item.id === 'contractor_recap' && activeTab === 'rekap_laporan');

                              const badgeInfo = getItemBadge(item.id, item.badge);

                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleItemClick(item.id)}
                                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] transition-all cursor-pointer active:translate-y-0.5 ${
                                    isActive
                                      ? 'bg-gradient-to-b from-white to-[#F0EDFF]/90 text-[#5145A6] font-bold border border-[#D4CEFA] shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_2px_0_#D2CEF2] dark:bg-[#7135b5] dark:bg-none dark:text-white dark:border-[#A78BFA]/40 dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.45),0_2px_6px_rgba(53,16,94,0.22)]'
                                      : item.highlight
                                      ? 'text-[#5145A6] dark:text-white bg-[#F0EDFF] dark:bg-[#35105E]/50 hover:bg-white/80 dark:hover:bg-[#35105E] font-semibold'
                                      : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-white/80 dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white font-semibold'
                                  }`}
                                >
                                  <SubIcon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#6657C8] dark:text-white' : 'text-[#6657C8] dark:text-[#A78BFA]'}`} />
                                  <span className="flex-1 text-left truncate whitespace-nowrap">{item.label}</span>
                                  {badgeInfo && (
                                    <span
                                      className={`ml-1 px-1.5 py-0.5 text-[9.5px] font-mono font-bold rounded-full tabular-nums shrink-0 ${
                                        badgeInfo.color === 'rose'
                                          ? 'bg-[#D45B66] dark:bg-[#DC4C5A] text-white'
                                          : isActive
                                          ? 'bg-[#EAE8FF] text-[#5145A6] dark:bg-white/20 dark:text-white'
                                          : badgeInfo.color === 'amber'
                                          ? 'bg-[#FFF2D9] text-[#C88735] dark:bg-[#E59A27]/25 dark:text-[#FBBF24]'
                                          : badgeInfo.color === 'emerald'
                                          ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-[#16A36A]/25 dark:text-emerald-300'
                                          : 'bg-[#6657C8] text-white dark:bg-[#35105E] dark:text-[#D8B4FE]'
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

              {/* App Setting & Administration (Separated from Operational Queue) */}
              {(adminStandalone.length > 0 || adminCategories.length > 0) && (
                <div
                  data-testid="sidebar-section-admin"
                  className="pt-3 mt-3 border-t border-[#DDE6F0]/80 dark:border-white/[0.12] space-y-1.5"
                >
                  <div className="px-2 pt-0.5 pb-1 text-[10px] font-extrabold text-[#5145A6] dark:text-[#A78BFA] uppercase tracking-[0.1em]">
                    App Setting &amp; Administration
                  </div>

                  {adminStandalone.length > 0 && (
                    <div className="space-y-1">
                      {adminStandalone.map(item => {
                        const Icon = resolveNavIcon(item.icon);
                        const isActive =
                          activeTab === item.id ||
                          (item.id === 'database_management' && activeTab === 'data_deletion') ||
                          (item.id === 'setup' &&
                            ['setup', 'ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab));

                        const badgeInfo = getItemBadge(item.id, item.badge);

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleItemClick(item.id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-all cursor-pointer active:translate-y-0.5 ${
                              isActive
                                ? 'bg-gradient-to-b from-white to-[#F0EDFF]/90 text-[#5145A6] font-bold border border-[#D4CEFA] shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_2.5px_0_#D2CEF2,0_5px_12px_rgba(102,87,200,0.1)] dark:bg-[#7135b5] dark:bg-none dark:text-white dark:border-[#A78BFA]/40 dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.45),0_2px_6px_rgba(53,16,94,0.22)]'
                                : 'text-[#52647A] dark:text-[#CEC0E8] font-semibold hover:bg-white/80 dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white'
                            }`}
                          >
                            <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-[#6657C8] dark:text-white' : 'text-[#6657C8] dark:text-[#A78BFA]'}`} />
                            <span className="flex-1 text-left truncate whitespace-nowrap">{item.label}</span>
                            {badgeInfo && (
                              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full tabular-nums shrink-0 bg-[#6657C8] text-white dark:bg-[#35105E] dark:text-[#D8B4FE]">
                                {badgeInfo.text}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {adminCategories.map(cat => {
                    const CatIcon = resolveNavIcon(cat.icon);
                    const isAccordionMode = cat.mode !== 'static';
                    const isOpen = isAccordionMode ? !!openGroups[cat.id] : true;
                    const hasActiveChild = cat.submenus.some(
                      sub =>
                        activeTab === sub.id ||
                        (sub.id === 'database_management' && activeTab === 'data_deletion') ||
                        (sub.id === 'setup' && ['setup', 'ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab))
                    );

                    return (
                      <div key={`admin-${cat.id}`} className="space-y-1">
                        {isAccordionMode ? (
                          <button
                            type="button"
                            onClick={() => toggleGroup(cat.id, 'accordion')}
                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                              hasActiveChild
                                ? 'text-[#5145A6] dark:text-white bg-[#F0EDFF] dark:bg-[#35105E]/70'
                                : 'text-[#8492A5] dark:text-[#A78BFA] hover:bg-[#F8FAFD] dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white'
                            }`}
                            aria-expanded={isOpen}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <CatIcon className="w-3.5 h-3.5 shrink-0 text-[#6657C8] dark:text-[#A78BFA]" />
                              <span className="truncate">{cat.name}</span>
                            </div>
                            <ChevronDown
                              className={`w-3.5 h-3.5 shrink-0 text-[#8492A5] dark:text-[#A78BFA] transition-transform duration-200 ${
                                isOpen ? 'rotate-180' : 'rotate-0'
                              }`}
                            />
                          </button>
                        ) : (
                          <div className="w-full flex items-center gap-2 px-2.5 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A78BFA]">
                            <CatIcon className="w-3.5 h-3.5 shrink-0 text-[#6657C8] dark:text-[#A78BFA]" />
                            <span className="truncate">{cat.name}</span>
                          </div>
                        )}

                        {isOpen && (
                          <div className="space-y-0.5 pl-1">
                            {cat.submenus.map(item => {
                              const SubIcon = resolveNavIcon(item.icon);
                              const isActive =
                                activeTab === item.id ||
                                (item.id === 'database_management' && activeTab === 'data_deletion') ||
                                (item.id === 'setup' &&
                                  ['setup', 'ui_builder', 'workflows', 'database_sync', 'sheets_sync'].includes(activeTab));

                              const badgeInfo = getItemBadge(item.id, item.badge);

                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleItemClick(item.id)}
                                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] transition-all cursor-pointer active:translate-y-0.5 ${
                                    isActive
                                      ? 'bg-gradient-to-b from-white to-[#F0EDFF]/90 text-[#5145A6] font-bold border border-[#D4CEFA] shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_2px_0_#D2CEF2] dark:bg-[#7135b5] dark:bg-none dark:text-white dark:border-[#A78BFA]/40 dark:shadow-[inset_0_1px_0_0_rgba(216,180,254,0.45),0_2px_6px_rgba(53,16,94,0.22)]'
                                      : item.highlight
                                      ? 'text-[#5145A6] dark:text-white bg-[#F0EDFF] dark:bg-[#35105E]/50 hover:bg-white/80 dark:hover:bg-[#35105E] font-semibold'
                                      : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-white/80 dark:hover:bg-[#35105E] hover:text-[#26364A] dark:hover:text-white font-semibold'
                                  }`}
                                >
                                  <SubIcon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#6657C8] dark:text-white' : 'text-[#6657C8] dark:text-[#A78BFA]'}`} />
                                  <span className="flex-1 text-left truncate whitespace-nowrap">{item.label}</span>
                                  {badgeInfo && (
                                    <span
                                      className={`ml-1 px-1.5 py-0.5 text-[9.5px] font-mono font-bold rounded-full tabular-nums shrink-0 ${
                                        badgeInfo.color === 'rose'
                                          ? 'bg-[#D45B66] dark:bg-[#DC4C5A] text-white'
                                          : isActive
                                          ? 'bg-[#EAE8FF] text-[#5145A6] dark:bg-white/20 dark:text-white'
                                          : badgeInfo.color === 'amber'
                                          ? 'bg-[#FFF2D9] text-[#C88735] dark:bg-[#E59A27]/25 dark:text-[#FBBF24]'
                                          : badgeInfo.color === 'emerald'
                                          ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-[#16A36A]/25 dark:text-emerald-300'
                                          : 'bg-[#6657C8] text-white dark:bg-[#35105E] dark:text-[#D8B4FE]'
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
        <div className={`${isMiniMode ? 'p-2 items-center' : 'p-4'} bg-white/35 dark:bg-white/[0.03] border-t border-[#DDE6F0]/85 dark:border-white/[0.12] space-y-2.5 shrink-0`}>
          {isMiniMode ? (
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="w-11 h-9 rounded-lg bg-white dark:bg-[#160D29]/75 flex items-center justify-center border border-[#DDE6F0] dark:border-[#35105E]"
                title={`Cluster: ${databaseStatus === 'connected' ? 'LIVE' : databaseStatus} (${syncStatus})`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    databaseStatus === 'connected'
                      ? 'bg-[#218A63] dark:bg-[#16A36A]'
                      : databaseStatus === 'connecting'
                      ? 'bg-[#C88735] dark:bg-[#E59A27] animate-pulse'
                      : 'bg-[#D45B66] dark:bg-[#DC4C5A]'
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={() => setIsChangePasswordModalOpen(true)}
                className="w-11 h-9 rounded-lg text-[#5145A6] dark:text-[#D8B4FE] hover:bg-[#EAE8FF] dark:hover:bg-[#35105E] flex items-center justify-center transition-colors cursor-pointer"
                title="Ganti Password Akun"
                aria-label="Ganti Password"
              >
                <KeyRound className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={logout}
                className="w-11 h-9 rounded-lg text-[#D45B66] dark:text-rose-300 hover:text-white hover:bg-[#D45B66] dark:hover:bg-[#DC4C5A] flex items-center justify-center transition-colors cursor-pointer"
                title="Keluar / Logout"
                aria-label="Keluar / Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="p-3 rounded-xl bg-white/85 dark:bg-white/[0.06] backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.95),0_2px_0_#DDE6F0] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] border border-[#DDE6F0] dark:border-white/[0.12] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#26364A] dark:text-[#D8B4FE]">
                    CORE TELEMETRY
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      databaseStatus === 'connected'
                        ? 'bg-[#218A63] dark:bg-[#16A36A] animate-pulse'
                        : databaseStatus === 'connecting'
                        ? 'bg-[#C88735] dark:bg-[#E59A27] animate-pulse'
                        : 'bg-[#D45B66] dark:bg-[#DC4C5A]'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-[#52647A] dark:text-[#CEC0E8] tabular-nums">
                  <span>{totalActiveTickets} WO Aktif</span>
                  <span className="text-[#5145A6] dark:text-[#DAB9FF] font-mono font-bold">
                    {todayCompletionPct}% Done
                  </span>
                </div>
                <div className="w-full bg-[#EDF3F8] dark:bg-[#22123F] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-[#65B8C4] to-[#6657C8] dark:bg-[#a380fe] dark:bg-none h-full transition-all duration-300"
                    style={{ width: `${todayCompletionPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#DDE6F0] dark:border-white/10 text-[10.5px]">
                  <span className="font-bold text-[#26364A] dark:text-[#CEC0E8] truncate">
                    {currentUser?.name || 'Staff'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] font-bold tabular-nums shrink-0">
                    {unassignedCount} Unassigned
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsChangePasswordModalOpen(true)}
                  className="btn-3d-lilac flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap"
                  title="Ganti Password Akun"
                >
                  <KeyRound className="w-3.5 h-3.5 shrink-0" />
                  <span>Password</span>
                </button>

                {userRole === 'super_admin' && (
                  <button
                    type="button"
                    onClick={() => setIsSessionModalOpen(true)}
                    className="btn-3d-lilac flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap"
                    title="Kelola Sesi Staf Aktif"
                  >
                    <span>Sesi</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={logout}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#FCE9EB] dark:bg-[#DC4C5A]/20 text-[#D45B66] dark:text-rose-200 border border-[#D45B66]/25 dark:border-transparent hover:bg-[#D45B66] hover:text-white dark:hover:bg-[#DC4C5A]/45 text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap"
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
