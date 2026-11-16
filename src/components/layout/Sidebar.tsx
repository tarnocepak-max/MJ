import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { MoraJawsLogo } from '../common/MoraJawsLogo';
import { Ticket } from '../../types/index.ts';
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
  MapPin,
  HelpCircle,
  Folder,
  Search,
  Loader2,
  ArrowUpRight
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
  MapPin,
  HelpCircle,
  Folder
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
  const { currentUser, tickets, scopedTickets, todayWIB, logout, setIsSessionModalOpen, hasPermission, rolePermissions, databaseStatus, syncStatus } = useApp();
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
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Ticket[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsCompactViewport(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isDrawerMode = isMobileView || isCompactViewport;
  const userRole = currentUser?.role || 'installer';
  const isInstaller = userRole === 'installer';
  const canCrossDateSearch = userRole === 'super_admin' || userRole === 'dispatch';

  const canAccessMenuId = (menuId: string): boolean => {
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
    return tickets.filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      return getTicketAppointmentDate(t) === todayWIB;
    });
  }, [tickets, todayWIB]);

  const totalActiveTickets = todayActiveTickets.length;
  const unassignedCount = todayActiveTickets.filter(t => !t.installerName).length;

  // =========================================================================
  // 1. STANDALONE MENUS (Menu Mandiri tanpa accordion, tanpa kategori induk)
  // Untuk Installer: Hanya Dashboard Installer & Tugas Saya
  // Untuk Non-Installer: 7 Menu Mandiri yang dapat dikonfigurasi
  // =========================================================================
  const filteredStandaloneMenus = useMemo(() => {
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

    const list = Array.isArray(standaloneMenus) ? standaloneMenus : [];
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
    if (itemId === 'wo_assignment' && unassignedCount > 0) {
      return { text: `${unassignedCount} Belum`, color: 'amber' as const };
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

      {/* Sidebar Main Frame: Dark Purple #160D29 */}
      <aside
        data-testid="app-sidebar"
        data-drawer-mode={isDrawerMode ? 'true' : 'false'}
        className={`${
          isDrawerMode
            ? 'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-2xl'
            : 'relative w-64 shadow-none'
        } bg-[#160D29] text-[#CEC0E8] border-r border-[#35105E]/70 transition-all duration-200 ease-out flex flex-col shrink-0 h-full select-none`}
      >
        {/* 1. Sidebar Header / MoraJaws Logo */}
        <div className="h-16 px-4 flex items-center justify-between bg-[#160D29] border-b border-[#35105E]/60 sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <MoraJawsLogo size="sm" animated={false} withGlow={false} />
            <div className="flex flex-col min-w-0">
              <span className="font-display font-bold text-[17px] leading-none text-white tracking-tight truncate">
                {config.global.appName || 'MoraJaws'}
              </span>
              <span className="text-[10px] font-semibold text-[#A78BFA] uppercase tracking-wider mt-1 truncate">
                Work Order Management
              </span>
            </div>
          </div>
          {isDrawerMode && (
            <button
              type="button"
              onClick={() => onChangeState('closed')}
              className="p-1.5 text-[#A78BFA] hover:text-white hover:bg-[#35105E] rounded-lg transition-colors cursor-pointer"
              title="Tutup Menu"
              aria-label="Tutup Menu"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 2. Global Search Bar (Positioned directly below Sidebar Header & above Navigation Menu) */}
        <div className="px-3 pt-3 pb-2 border-b border-[#35105E]/50 bg-[#160D29] shrink-0">
          <div className="relative flex items-center w-full">
            <Search className="w-3.5 h-3.5 text-[#A78BFA] absolute left-2.5 pointer-events-none shrink-0" />
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
              className="w-full pl-8 pr-12 py-2 bg-[#1E1236] hover:bg-[#23163F] focus:bg-[#251742] text-xs text-white placeholder-[#8B8495] rounded-lg border border-[#35105E] focus:border-[#A78BFA] focus:ring-1 focus:ring-[#A78BFA]/40 outline-none transition-all"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2 p-1 rounded text-[#A78BFA] hover:text-white hover:bg-[#35105E] transition-colors cursor-pointer"
                title="Bersihkan pencarian"
                aria-label="Bersihkan pencarian"
              >
                <X className="w-3 h-3" />
              </button>
            ) : (
              !isDrawerMode && (
                <kbd className="absolute right-2 px-1.5 py-0.5 bg-[#35105E]/70 border border-[#5B35B1]/50 rounded text-[9px] font-mono font-bold text-[#D8B4FE] pointer-events-none">
                  Ctrl K
                </kbd>
              )
            )}
          </div>
        </div>

        {/* 3. Navigation Menu (Unified Live Search Results OR Standard Menu) */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto scrollbar-thin">
          {searchQuery.trim() ? (
            <div className="space-y-3" data-testid="sidebar-search-results">
              {/* Group A: Live RBAC Menu & Feature Results */}
              <div className="space-y-1">
                <div className="px-2 py-1 flex items-center justify-between text-[10px] font-bold text-[#A78BFA] uppercase tracking-wider">
                  <span>Menu & Fitur (RBAC)</span>
                  <span className="font-mono text-[#D8B4FE]">{matchedMenus.length}</span>
                </div>
                {matchedMenus.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-[11px] text-[#8B8495] italic">
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
                            ? 'bg-gradient-to-r from-[#5B35B1] to-[#7135B5] text-white font-bold shadow-xs'
                            : 'text-[#CEC0E8] hover:bg-[#35105E] hover:text-white'
                        }`}
                      >
                        <ItemIcon className="w-4 h-4 shrink-0 text-[#A78BFA]" />
                        <div className="flex-1 min-w-0 text-left">
                          <div className="truncate font-semibold">{item.label}</div>
                          {item.group && (
                            <div className="text-[9.5px] text-[#8B8495] truncate">{item.group}</div>
                          )}
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-[#A78BFA] shrink-0" />
                      </button>
                    );
                  })
                )}
              </div>

              {/* Group B: Live Work Order Search Results */}
              <div className="space-y-1 pt-2 border-t border-[#35105E]/60">
                <div className="px-2 py-1 flex items-center justify-between text-[10px] font-bold text-[#A78BFA] uppercase tracking-wider">
                  <span>Work Order</span>
                  {isSearching ? (
                    <Loader2 className="w-3 h-3 animate-spin text-[#D8B4FE]" />
                  ) : (
                    <span className="font-mono text-[#D8B4FE]">{searchResults.length}</span>
                  )}
                </div>

                {searchError && (
                  <p className="px-2.5 py-1 text-[10px] text-amber-300/90">{searchError}</p>
                )}

                {!isSearching && searchResults.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-[11px] text-[#8B8495] italic">
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
                        className="w-full text-left px-2.5 py-2 rounded-lg bg-[#1E1236]/80 hover:bg-[#35105E] border border-[#35105E]/70 transition-colors cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-white truncate">
                            {t.woNumber || '-'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#35105E] text-[#D8B4FE] text-[9px] font-bold shrink-0">
                            {apptDate}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#CEC0E8] truncate">
                          {t.customerName || '-'}
                        </div>
                        <div className="flex items-center justify-between gap-1.5 text-[9.5px] text-[#8B8495]">
                          <span className="truncate">{t.idCustomer || t.installerName || '-'}</span>
                          <span className="text-[#A78BFA] font-semibold shrink-0">{t.statusWOInstaller || t.statusWOAgent || 'OPEN'}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="px-2.5 py-1.5 text-[11px] font-bold text-[#8B8495] uppercase tracking-wider">
                Operations Core
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
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#7135B5] text-white font-bold shadow-sm'
                      : 'text-[#CEC0E8] font-medium hover:bg-[#35105E] hover:text-white'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#E9D5FF]' : 'text-[#A78BFA]'}`} />
                  <span className="flex-1 text-left truncate whitespace-nowrap">{item.label}</span>
                  {badgeInfo && (
                    <span
                      className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-mono font-bold rounded tabular-nums shrink-0 ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : badgeInfo.color === 'amber'
                          ? 'bg-[#E59A27]/20 text-[#FBBF24]'
                          : 'bg-[#35105E] text-[#D8B4FE]'
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
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          hasActiveChild
                            ? 'text-white bg-[#35105E]/70'
                            : 'text-[#CEC0E8] hover:bg-[#35105E] hover:text-white'
                        }`}
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CatIcon className="w-4 h-4 shrink-0 text-[#A78BFA]" />
                          <span className="truncate">{cat.name}</span>
                        </div>
                        <ChevronDown
                          className={`w-3.5 h-3.5 shrink-0 text-[#A78BFA] transition-transform duration-200 ${
                            isOpen ? 'rotate-180' : 'rotate-0'
                          }`}
                        />
                      </button>
                    ) : (
                      <div className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-bold text-[#D8B4FE]">
                        <CatIcon className="w-4 h-4 shrink-0 text-[#A78BFA]" />
                        <span className="truncate">{cat.name}</span>
                      </div>
                    )}

                    {isOpen && (
                      <div className="pl-6 pr-1 py-0.5 space-y-0.5">
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
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                                isActive
                                  ? 'bg-[#7135B5] text-white font-bold shadow-sm'
                                  : item.highlight
                                  ? 'text-[#E9D5FF] bg-[#35105E]/50 hover:bg-[#35105E] hover:text-white font-medium'
                                  : 'text-[#CEC0E8] hover:bg-[#35105E] hover:text-white font-normal'
                              }`}
                            >
                              <SubIcon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#E9D5FF]' : 'text-[#A78BFA]/80'}`} />
                              <span className="flex-1 text-left truncate whitespace-nowrap">{item.label}</span>
                              {badgeInfo && (
                                <span
                                  className={`ml-1 px-1.5 py-0.5 text-[9.5px] font-mono font-bold rounded tabular-nums shrink-0 ${
                                    isActive
                                      ? 'bg-white/20 text-white'
                                      : badgeInfo.color === 'amber'
                                      ? 'bg-[#E59A27]/20 text-[#FBBF24]'
                                      : badgeInfo.color === 'emerald'
                                      ? 'bg-[#16A36A]/20 text-emerald-300'
                                      : 'bg-[#35105E] text-[#D8B4FE]'
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

        {/* 4. User Profile / Account Section + Live Cluster Status */}
        <div className="p-3 bg-[#1E1236] border-t border-[#35105E]/70 space-y-2 shrink-0">
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#160D29] border border-[#35105E]/70 text-[10.5px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  databaseStatus === 'connected'
                    ? 'bg-[#16A36A]'
                    : databaseStatus === 'connecting'
                    ? 'bg-[#E59A27] animate-pulse'
                    : 'bg-[#DC4C5A]'
                }`}
              />
              <span className="font-semibold text-[#E9D5FF] truncate">
                {databaseStatus === 'connected'
                  ? 'Cluster: JKT-01'
                  : databaseStatus === 'connecting'
                  ? 'Menghubungkan DB'
                  : 'Mode Lokal'}
              </span>
            </div>
            <span className="font-mono text-[10px] text-[#A78BFA] font-bold uppercase">
              {syncStatus === 'SAVED' ? 'LIVE' : syncStatus}
            </span>
          </div>

          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#160D29]/75 text-[11px] text-[#CEC0E8]">
            <span className="truncate capitalize font-medium">
              {userRole.replace('_', ' ')}
            </span>
            <span className="font-mono text-[10.5px] text-[#A78BFA] truncate max-w-[100px]">
              @{currentUser?.username || 'staff'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {userRole === 'super_admin' && (
              <button
                type="button"
                onClick={() => setIsSessionModalOpen(true)}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[#CEC0E8] hover:text-white hover:bg-[#35105E] text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
                title="Kelola Sesi Staf Aktif"
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0 text-[#A78BFA]" />
                <span>Sesi</span>
              </button>
            )}

            <button
              type="button"
              onClick={logout}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-rose-300 hover:text-white hover:bg-[#DC4C5A]/25 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
              title="Keluar / Logout"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>Keluar</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
