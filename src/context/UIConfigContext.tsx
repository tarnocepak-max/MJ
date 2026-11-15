import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  UIConfiguration,
  ColumnConfig,
  ToolbarButtonConfig,
  SectionDetailConfig,
  TablePreset,
  NavigationSettings,
  NavigationDisplayMode,
  getCategoryPermanentId,
  isCategoryAccordion,
  NavCategoryConfig,
  StandaloneMenuItem,
  NavSubmenuItem,
  NavigationConfigDoc,
  CategoryAccordionConfig
} from '../types';
import {
  DEFAULT_UI_CONFIG,
  DEFAULT_NAVIGATION_CATEGORIES,
  DEFAULT_CANONICAL_CATEGORIES,
  DEFAULT_STANDALONE_MENUS,
  DEFAULT_INSTALLER_STANDALONE_MENUS,
  DEFAULT_SUBMENU_ITEMS,
  DEFAULT_NAVIGATION_DOC
} from '../constants/defaultConfig';
import { getAuthHeaders } from '../services/authService';
import {
  saveUIConfigurationToSupabase,
  loadUIConfigurationFromSupabase,
  subscribeToUIConfiguration,
  saveNavigationDocToSupabase,
  loadNavigationDocFromSupabase,
  subscribeToNavigationDoc
} from '../services/supabaseConfigService';
import { useApp } from './AppContext';

interface UIConfigContextType {
  config: UIConfiguration;
  draftConfig: UIConfiguration | null;
  isDrafting: boolean;
  startDrafting: () => void;
  updateDraft: (updater: (prev: UIConfiguration) => UIConfiguration) => void;
  saveDraft: () => void;
  cancelDraft: () => void;
  resetToDefaults: () => void;
  
  // Quick Direct Actions (applied directly)
  setGlobalTheme: (updates: Partial<UIConfiguration['global']>) => void;
  setColumnVisibility: (columnKey: string, visible: boolean) => void;
  setColumnOrder: (sourceIndex: number, destinationIndex: number) => void;
  updateColumnConfig: (columnKey: string, updates: Partial<ColumnConfig>) => void;
  applyPreset: (presetId: string) => void;
  saveCurrentAsPreset: (name: string, description: string) => void;
  deletePreset: (presetId: string) => void;
  
  // Toolbar settings
  updateToolbarButton: (buttonId: string, updates: Partial<ToolbarButtonConfig>) => void;
  toggleToolbarOption: (key: keyof UIConfiguration['toolbar'], value: boolean) => void;

  // Ticket Detail settings
  toggleDetailSection: (sectionId: string, visible: boolean) => void;
  reorderDetailSections: (sourceIndex: number, destinationIndex: number) => void;
  updateDetailField: (sectionId: string, fieldKey: string, updates: any) => void;
  setShowEmptyFields: (show: boolean) => void;

  // Device profile & ergonomic settings (Android vs PC)
  isMobileView: boolean;
  setDeviceMode: (mode: 'auto' | 'pc' | 'android') => void;
  updateAndroidSettings: (updates: Partial<UIConfiguration['device']['android']>) => void;
  updatePCSettings: (updates: Partial<UIConfiguration['device']['pc']>) => void;
  applyDevicePreset: (preset: 'comfortable_android' | 'high_productivity_pc' | 'auto') => void;

  // Sidebar controls
  setSidebarState: (state: 'expanded' | 'minimized' | 'closed') => void;

  // Canonical Navigation System
  navCategories: NavCategoryConfig[];
  standaloneMenus: StandaloneMenuItem[];
  submenuItems: NavSubmenuItem[];
  accordionSettings: { allowMultipleOpenGroups: boolean };

  // Category management
  addCategory: (cat: { name: string; icon?: string; mode?: 'accordion' | 'static'; allowMultipleOpen?: boolean }) => void;
  updateCategory: (id: string, updates: Partial<NavCategoryConfig>) => void;
  deleteCategory: (id: string, actionOnSubmenus: 'move' | 'disable', targetCategoryId?: string) => void;
  reorderCategories: (sourceIndex: number, destinationIndex: number) => void;
  moveCategoryItem: (id: string, direction: 'up' | 'down') => void;
  toggleCategoryActive: (id: string) => void;
  setCategoryAccordionMode: (id: string, mode: 'accordion' | 'static') => void;

  // Submenu management
  addSubmenu: (item: { label: string; icon: string; categoryId: string; roles?: string[] }) => void;
  updateSubmenu: (id: string, updates: Partial<NavSubmenuItem>) => void;
  deleteSubmenu: (id: string) => void;
  moveSubmenu: (id: string, direction: 'up' | 'down') => void;
  reorderSubmenus: (categoryId: string, sourceIndex: number, destinationIndex: number) => void;
  moveSubmenuToCategory: (submenuId: string, targetCategoryId: string) => void;
  toggleSubmenuActive: (id: string) => void;

  // Standalone menu management
  updateStandaloneMenu: (id: string, updates: Partial<StandaloneMenuItem>) => void;
  moveStandaloneMenu: (id: string, direction: 'up' | 'down') => void;
  reorderStandaloneMenus: (sourceIndex: number, destinationIndex: number) => void;
  toggleStandaloneMenuActive: (id: string) => void;
  deleteStandaloneMenu: (id: string) => void;

  // Accordion settings
  setAllowMultipleOpenGroups: (allow: boolean) => void;

  // Save / Reset Navigation to Supabase PostgreSQL
  saveNavigationConfig: (operatorName?: string) => Promise<{ success: boolean; error?: string; updatedAt?: string }>;
  resetNavigationConfig: (operatorName?: string) => Promise<{ success: boolean; error?: string }>;

  // Navigation Display Mode Settings (Legacy / Category-based ON/OFF Accordion)
  navigationSettings: NavigationSettings;
  updateNavigationSettings: (updates: Partial<NavigationSettings>) => void;
  setCategoryAccordion: (categoryIdOrName: string, enabled: boolean) => void;
  toggleCategoryAccordion: (categoryIdOrName: string) => void;
  getCategoryAccordionState: (categoryIdOrName: string) => boolean;
  setRoleNavigationMode: (role: any, mode: NavigationDisplayMode) => void;
  setCategoryNavigationMode: (category: string, mode: NavigationDisplayMode) => void;
  resetNavigationSettings: () => void;

  // Menu Category & Layout settings (Backward compatibility)
  navigationItems: NavigationMenuItem[];
  menuCategories: string[];
  updateNavigationItem: (id: string, updates: Partial<NavigationMenuItem>) => void;
  moveNavigationItem: (id: string, direction: 'up' | 'down') => void;
  renameCategory: (oldCategory: string, newCategory: string) => void;
  moveCategory: (category: string, direction: 'up' | 'down') => void;
  setMenuCategories: (categories: string[]) => void;
  resetNavigationMenu: () => void;

  // Import / Export JSON
  exportConfigJson: () => string;
  importConfigJson: (jsonString: string) => boolean;

  // Cloud Database Configuration (Supabase PostgreSQL)
  saveConfigToSupabase: (operatorName?: string) => Promise<{ success: boolean; error?: string; updatedAt?: string }>;
  loadConfigFromSupabase: () => Promise<{ success: boolean; error?: string }>;
  reloadNavigationFromSupabase: () => Promise<{ success: boolean; error?: string }>;
  isCloudSyncing: boolean;
  lastCloudSyncTime: string | null;
  lastCloudSyncError: string | null;
  hasUnsavedNavChanges: boolean;
  cloudSyncStatus: 'synced' | 'local_only' | 'syncing' | 'error';
}

export interface NavigationMenuItem {
  id: string;
  label: string;
  category: string;
  order: number;
  visible: boolean;
  roles?: string[];
  badge?: string | number;
  badgeColor?: 'purple' | 'amber' | 'emerald' | 'rose';
  highlight?: boolean;
}

export const DEFAULT_MENU_CATEGORIES = [
  'WO CONTRACTOR',
  'Pelanggan',
  'Laporan',
  'Setup'
];

export const DEFAULT_NAVIGATION_ITEMS: NavigationMenuItem[] = [
  // =========================================================================
  // 1. MENU UTAMA STATIC MANDIRI (Positioned directly at top of Sidebar)
  // =========================================================================
  { id: 'dashboard', label: 'Dashboard Monitoring', category: 'Mandiri', order: 1, visible: true, roles: ['super_admin', 'dispatch', 'leader', 'management_data', 'it_support'] },
  { id: 'tickets', label: 'Work Order Management', category: 'Mandiri', order: 2, visible: true, roles: ['super_admin', 'dispatch'] },
  { id: 'schedule', label: 'Jadwal & Kalender', category: 'Mandiri', order: 3, visible: true, roles: ['super_admin', 'dispatch', 'leader'] },
  { id: 'import', label: 'Import Data WO', category: 'Mandiri', order: 4, visible: true, roles: ['super_admin', 'management_data'] },
  { id: 'installer_portal', label: 'Dashboard Installer', category: 'Mandiri', order: 5, visible: true, roles: ['installer'] },
  { id: 'installer_tasks', label: 'Tugas Saya', category: 'Mandiri', order: 6, visible: true, roles: ['installer'] },
  { id: 'users', label: 'Manajemen Akun', category: 'Mandiri', order: 7, visible: true, roles: ['super_admin'] },
  { id: 'database_management', label: 'Database Application', category: 'Mandiri', order: 8, visible: true, roles: ['super_admin'] },

  // =========================================================================
  // 2. KATEGORI: WO CONTRACTOR — STATIC
  // =========================================================================
  { id: 'wo_assignment', label: 'Assign WO', category: 'WO CONTRACTOR', order: 9, visible: true, roles: ['leader'] },
  { id: 'progress_dashboard', label: 'Dashboard Progress WO', category: 'WO CONTRACTOR', order: 10, visible: true, roles: ['super_admin', 'dispatch', 'leader'] },
  { id: 'installer_mgmt', label: 'Pendaftaran Akun Teknisi', category: 'WO CONTRACTOR', order: 11, visible: true, roles: ['super_admin', 'leader'] },
  { id: 'contractor_recap', label: 'Rekap Total WO per Kontraktor', category: 'WO CONTRACTOR', order: 13, visible: true, roles: ['super_admin', 'dispatch', 'leader', 'management_data'] },

  // =========================================================================
  // 3. KATEGORI: PELANGGAN — ACCORDION
  // =========================================================================
  { id: 'contact_centre', label: 'Contact Centre', category: 'Pelanggan', order: 14, visible: true, roles: ['super_admin', 'dispatch', 'leader'] },
  { id: 'templates', label: 'Template WhatsApp', category: 'Pelanggan', order: 15, visible: true, roles: ['super_admin', 'dispatch', 'leader'] },

  // =========================================================================
  // 4. KATEGORI: LAPORAN — ACCORDION
  // =========================================================================
  { id: 'report_data_wo', label: 'Report Data WO', category: 'Laporan', order: 16, visible: true, roles: ['super_admin', 'dispatch', 'management_data'] },
  { id: 'report_installer', label: 'Report Installer', category: 'Laporan', order: 17, visible: true, roles: ['super_admin', 'dispatch', 'management_data', 'leader'] },
  { id: 'audit_logs', label: 'Audit Trail Log', category: 'Laporan', order: 18, visible: true, roles: ['super_admin', 'it_support'] },
  { id: 'login_logs', label: 'Riwayat Sesi Login', category: 'Laporan', order: 19, visible: true, roles: ['super_admin', 'dispatch', 'it_support'] },
  { id: 'system_health', label: 'Kesehatan Sistem', category: 'Laporan', order: 20, visible: true, roles: ['super_admin', 'it_support'] },

  // =========================================================================
  // 5. KATEGORI: SETUP — ACCORDION
  // =========================================================================
  { id: 'setup', label: 'SETUP TERPUSAT MORAJAWS', category: 'Setup', order: 21, visible: true, roles: ['super_admin', 'dispatch', 'management_data'] },
  { id: 'nav_config', label: 'Konfigurasi Menu Navigasi', category: 'Setup', order: 22, visible: true, roles: ['super_admin'] },
  { id: 'management_role', label: 'Role & Permission', category: 'Setup', order: 23, visible: true, roles: ['super_admin'] },
  { id: 'droplist_management', label: 'Droplist Management', category: 'Setup', order: 24, visible: true, roles: ['super_admin', 'dispatch', 'management_data'] },
  { id: 'sound_settings', label: 'Pengaturan Notifikasi', category: 'Setup', order: 25, visible: true, roles: ['super_admin', 'dispatch'] },
  { id: 'settings', label: 'Pengaturan Sistem', category: 'Setup', order: 26, visible: false, roles: ['super_admin'] },
  { id: 'offline_sync', label: 'Sinkronisasi Offline', category: 'Setup', order: 27, visible: true, roles: ['super_admin', 'dispatch', 'leader'] },

  // =========================================================================
  // 6. MENU YANG DISEMBUNYIKAN DARI SIDEBAR (Bagian 7)
  // =========================================================================
  { id: 'form_sameday', label: 'Form Sameday Express', category: 'Hidden', order: 28, visible: false, roles: ['dispatch'] },
  { id: 'location_basecamp', label: 'Kontraktor & Basecamp', category: 'Hidden', order: 29, visible: false, roles: ['super_admin', 'dispatch', 'leader'] },
  { id: 'installer_progress', label: 'Dashboard Progress Teknisi', category: 'Hidden', order: 30, visible: false, roles: ['installer', 'super_admin'] },
  { id: 'installer_history', label: 'Riwayat Pekerjaan Teknisi', category: 'Hidden', order: 31, visible: false, roles: ['installer', 'super_admin'] }
];

/**
 * Sanitizes navigation items: removes duplicates, purges orphan/deprecated items,
 * assigns correct parent category, and preserves order.
 */
export const sanitizeNavigationItems = (items: NavigationMenuItem[]): NavigationMenuItem[] => {
  if (!Array.isArray(items)) return DEFAULT_NAVIGATION_ITEMS;

  const deprecatedOrphanIds = new Set([
    'assign_wo_fat',
    'import_excel',
    'contractors',
    'rekap_laporan',
    'setting_droplist_status',
    'setting_droplist_reason',
    'setting_droplist_rootcause'
  ]);
  const mandiriItemIds = new Set(['dashboard', 'tickets', 'schedule', 'import', 'installer_portal', 'installer_tasks', 'users', 'database_management']);
  const hiddenItemIds = new Set(['form_sameday', 'location_basecamp', 'installer_progress', 'installer_history']);

  const seenIds = new Set<string>();
  const sanitized: NavigationMenuItem[] = [];

  for (const item of items) {
    if (!item || !item.id) continue;
    if (deprecatedOrphanIds.has(item.id)) continue;

    // Prune duplicate tickets in Dashboard (only allow in Mandiri)
    if (item.id === 'tickets' && item.category === 'Dashboard') continue;

    // Skip duplicate IDs
    if (seenIds.has(item.id)) continue;

    seenIds.add(item.id);

    // Normalize category according to the new navigation architecture
    let targetCategory = item.category;
    let targetVisible = item.visible;

    if (mandiriItemIds.has(item.id)) {
      targetCategory = 'Mandiri';
    } else if (hiddenItemIds.has(item.id)) {
      targetCategory = 'Hidden';
      targetVisible = false;
    }

    sanitized.push({
      ...item,
      category: targetCategory,
      visible: targetVisible,
      label: item.label === 'Dashboard Area' ? 'Dashboard Leader' : item.label
    });
  }

  // Ensure all canonical default items are present
  for (const def of DEFAULT_NAVIGATION_ITEMS) {
    if (!seenIds.has(def.id)) {
      seenIds.add(def.id);
      sanitized.push(def);
    }
  }

  return sanitized.sort((a, b) => a.order - b.order);
};

const STORAGE_KEY = 'dispatch_system_ui_config_v4';
const NAV_STORAGE_KEY = 'morajaws_navigation_items_v4';
const CAT_STORAGE_KEY = 'morajaws_navigation_categories_v4';

const UIConfigContext = createContext<UIConfigContextType | undefined>(undefined);

export const UIConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoggedIn, currentUser } = useApp();
  const [windowWidth, setWindowWidth] = useState<number>(() => {
    return typeof window !== 'undefined' ? window.innerWidth : 1200;
  });

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const sanitizeToolbarButtons = (toolbarCfg: UIConfiguration['toolbar']) => ({
    ...toolbarCfg,
    buttons: (toolbarCfg?.buttons || DEFAULT_UI_CONFIG.toolbar.buttons).map(btn => {
      if (btn.id === 'btn_import_wo') {
        return { ...btn, roleRequired: ['super_admin', 'management_data'] };
      }
      if (btn.id === 'btn_bulk_assign') {
        return { ...btn, roleRequired: ['leader'] };
      }
      return btn;
    })
  });

  const isFirstConfigMountRef = useRef(true);

  const [config, setConfig] = useState<UIConfiguration>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Ensure structure completeness
        const globalMerged = { ...DEFAULT_UI_CONFIG.global, ...parsed.global };
        if (!globalMerged.sidebarState) {
          globalMerged.sidebarState = globalMerged.sidebarCollapsed ? 'minimized' : 'expanded';
        }
        return {
          ...DEFAULT_UI_CONFIG,
          ...parsed,
          global: globalMerged,
          device: {
            ...DEFAULT_UI_CONFIG.device,
            ...(parsed.device || {}),
            android: { ...DEFAULT_UI_CONFIG.device.android, ...(parsed.device?.android || {}) },
            pc: { ...DEFAULT_UI_CONFIG.device.pc, ...(parsed.device?.pc || {}) }
          },
          ticketsTable: { ...DEFAULT_UI_CONFIG.ticketsTable, ...parsed.ticketsTable },
          toolbar: sanitizeToolbarButtons({ ...DEFAULT_UI_CONFIG.toolbar, ...parsed.toolbar }),
          ticketDetail: { ...DEFAULT_UI_CONFIG.ticketDetail, ...parsed.ticketDetail }
        };
      }
    } catch (e) {
      console.warn('Failed to parse saved UI config, using defaults', e);
    }
    return DEFAULT_UI_CONFIG;
  });

  const [draftConfig, setDraftConfig] = useState<UIConfiguration | null>(null);

  // Load global configuration from backend server on mount
  useEffect(() => {
    fetch('/api/config/global')
      .then(res => res.json())
      .then(data => {
        if (data && data.success && data.config) {
          setConfig(prev => ({
            ...prev,
            ...data.config,
            global: { ...prev.global, ...(data.config.global || {}) },
            toolbar: sanitizeToolbarButtons({ ...prev.toolbar, ...(data.config.toolbar || {}) }),
            device: {
              ...prev.device,
              ...(data.config.device || {}),
              android: { ...prev.device.android, ...(data.config.device?.android || {}) },
              pc: { ...prev.device.pc, ...(data.config.device?.pc || {}) }
            }
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Sync to localStorage and backend (only persist to backend if user is authorized to manage settings)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.error('Failed to save UI configuration to localStorage', e);
    }

    if (isFirstConfigMountRef.current) {
      isFirstConfigMountRef.current = false;
    } else {
      try {
        const sessionStr = localStorage.getItem('morajaws_auth_session');
        const sess = sessionStr ? JSON.parse(sessionStr) : null;
        const role = sess?.user?.role;
        if (sess?.token && ['super_admin', 'management_data', 'dispatch', 'it_support'].includes(role)) {
          fetch('/api/config/global', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeaders()
            },
            body: JSON.stringify({ config })
          }).catch(() => {});
        }
      } catch {}
    }

    // Apply document theme class if dark mode
    if (config.global.themeMode === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [config]);

  // =========================================================================
  // CANONICAL NAVIGATION SYSTEM: 3 ACCORDION CATEGORIES & 7 STANDALONE MENUS
  // =========================================================================
  const NAV_CATEGORIES_KEY = 'morajaws_nav_categories_v6';
  const NAV_STANDALONE_KEY = 'morajaws_nav_standalone_v6';
  const NAV_SUBMENUS_KEY = 'morajaws_nav_submenus_v6';
  const NAV_ACCORDION_KEY = 'morajaws_nav_accordion_v6';

  // Sanitizer: Hapus Reason Report & Rootcause, konsolidasi SETUP TERPUSAT MORAJAWS, & enforce App Flow roles
  const sanitizeSubmenuItems = (items: NavSubmenuItem[]): NavSubmenuItem[] => {
    if (!Array.isArray(items)) return [];
    const seen = new Set<string>();
    return items
      .filter(item => {
        const id = (item.id || '').toLowerCase();
        const label = (item.label || '').toLowerCase();
        if (!id || seen.has(id)) return false;
        // Hapus Reason Report dan Rootcause dari sidebar/submenu
        if (
          id === 'reason_report' ||
          id === 'rootcause' ||
          id === 'setting_droplist_reason' ||
          id === 'setting_droplist_rootcause' ||
          label === 'reason report' ||
          label === 'rootcause' ||
          label === 'root cause'
        ) {
          return false;
        }
        // Konsolidasi: hilangkan menu terpisah Pengaturan Sistem/Master Data lama yang sudah digabung ke SETUP TERPUSAT MORAJAWS
        if (
          id === 'settings' ||
          id === 'master_data' ||
          id === 'master_data_config' ||
          id === 'app_settings' ||
          label === 'pengaturan aplikasi' ||
          label === 'konfigurasi master data' ||
          label === 'pengaturan aplikasi (morajaws)' ||
          label === 'pengaturan sistem'
        ) {
          return false;
        }
        seen.add(id);
        return true;
      })
      .map(item => {
        const safeRoles = Array.isArray(item.roles) ? item.roles : [];
        if (item.id === 'setup') {
          return {
            ...item,
            label: 'SETUP TERPUSAT MORAJAWS',
            roles: ['super_admin', 'dispatch', 'management_data']
          };
        }
        if (item.id === 'wo_assignment') {
          return {
            ...item,
            roles: ['leader']
          };
        }
        if (item.id === 'sound_settings') {
          return {
            ...item,
            roles: safeRoles.filter(r => r !== 'leader' && r !== 'installer')
          };
        }
        if (item.id === 'droplist_management') {
          return { ...item, label: 'Kategori Report', roles: safeRoles };
        }
        return { ...item, roles: safeRoles };
      });
  };

  const sanitizeStandaloneMenus = (items: StandaloneMenuItem[]): StandaloneMenuItem[] => {
    if (!Array.isArray(items)) return DEFAULT_STANDALONE_MENUS;
    return items.map(item => {
      const roles = Array.isArray(item.roles) ? item.roles : ['super_admin'];
      if (item.id === 'import') {
        return {
          ...item,
          roles: ['super_admin', 'management_data']
        };
      }
      return {
        ...item,
        roles
      };
    });
  };

  // 1. Exactly 3 Categories: Contractor & Area, Installer, Menu Tambahan
  const [navCategories, setNavCategoriesState] = useState<NavCategoryConfig[]>(() => {
    try {
      const saved = localStorage.getItem(NAV_CATEGORIES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse saved navCategories', e);
    }
    return DEFAULT_CANONICAL_CATEGORIES;
  });

  // 2. Exactly 7 Standalone Menus (Menu Mandiri)
  const [standaloneMenus, setStandaloneMenusState] = useState<StandaloneMenuItem[]>(() => {
    try {
      const saved = localStorage.getItem(NAV_STANDALONE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return sanitizeStandaloneMenus(parsed);
      }
    } catch (e) {
      console.warn('Failed to parse saved standaloneMenus', e);
    }
    return sanitizeStandaloneMenus(DEFAULT_STANDALONE_MENUS);
  });

  // 3. Submenu Items grouped under categories (Sanitized)
  const [submenuItems, setSubmenuItemsState] = useState<NavSubmenuItem[]>(() => {
    try {
      const saved = localStorage.getItem(NAV_SUBMENUS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return sanitizeSubmenuItems(parsed);
      }
    } catch (e) {
      console.warn('Failed to parse saved submenuItems', e);
    }
    return sanitizeSubmenuItems(DEFAULT_SUBMENU_ITEMS);
  });

  // 4. Accordion Multi-open Settings
  const [accordionSettings, setAccordionSettingsState] = useState<{ allowMultipleOpenGroups: boolean }>(() => {
    try {
      const saved = localStorage.getItem(NAV_ACCORDION_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to parse saved accordionSettings', e);
    }
    return { allowMultipleOpenGroups: true };
  });

  const persistConfirmedNavToLocalStorage = (
    cats: NavCategoryConfig[],
    standalone: StandaloneMenuItem[],
    subs: NavSubmenuItem[],
    accordion: { allowMultipleOpenGroups: boolean }
  ) => {
    try {
      localStorage.setItem(NAV_CATEGORIES_KEY, JSON.stringify(cats));
      localStorage.setItem(NAV_STANDALONE_KEY, JSON.stringify(standalone));
      localStorage.setItem(NAV_SUBMENUS_KEY, JSON.stringify(subs));
      localStorage.setItem(NAV_ACCORDION_KEY, JSON.stringify(accordion));
    } catch (e) {
      console.warn('[UIConfig] Gagal menyimpan cache navigasi lokal:', e);
    }
  };

  const navVersionRef = useRef<number>(1);
  const navCategoriesRef = useRef<NavCategoryConfig[]>(navCategories);
  const standaloneMenusRef = useRef<StandaloneMenuItem[]>(standaloneMenus);
  const submenuItemsRef = useRef<NavSubmenuItem[]>(submenuItems);
  const accordionSettingsRef = useRef<{ allowMultipleOpenGroups: boolean }>(accordionSettings);
  navCategoriesRef.current = navCategories;
  standaloneMenusRef.current = standaloneMenus;
  submenuItemsRef.current = submenuItems;
  accordionSettingsRef.current = accordionSettings;

  const committedNavSnapshotRef = useRef<string>(
    JSON.stringify({
      navCategories,
      standaloneMenus,
      submenuItems,
      accordionSettings
    })
  );
  const [hasUnsavedNavChanges, setHasUnsavedNavChanges] = useState<boolean>(false);

  // Track dirty state deterministically; DO NOT overwrite confirmed localStorage cache on unconfirmed draft edits
  useEffect(() => {
    const currentSnapshot = JSON.stringify({
      navCategories,
      standaloneMenus,
      submenuItems,
      accordionSettings
    });
    setHasUnsavedNavChanges(currentSnapshot !== committedNavSnapshotRef.current);
  }, [navCategories, standaloneMenus, submenuItems, accordionSettings]);

  // Backward compatibility: maintain legacy menuCategories and navigationItems
  const menuCategories = navCategories.filter(c => c.isActive).map(c => c.name);
  const navigationItems: NavigationMenuItem[] = [
    ...standaloneMenus.map(m => ({
      id: m.id,
      label: m.label,
      category: 'Mandiri',
      order: m.order,
      visible: m.visible,
      roles: m.roles,
      badge: m.badge,
      badgeColor: m.badgeColor
    })),
    ...submenuItems.map(s => {
      const parentCat = navCategories.find(c => c.id === s.categoryId);
      return {
        id: s.id,
        label: s.label,
        category: parentCat ? parentCat.name : s.categoryId,
        order: s.order,
        visible: s.visible,
        roles: s.roles,
        badge: s.badge,
        badgeColor: s.badgeColor,
        highlight: s.highlight
      };
    })
  ];

  // Category CRUD
  const addCategory = (cat: { name: string; icon?: string; mode?: 'accordion' | 'static'; allowMultipleOpen?: boolean }) => {
    const cleanId = cat.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || `cat_${Date.now()}`;
    const newCat: NavCategoryConfig = {
      id: cleanId,
      name: cat.name.trim(),
      icon: cat.icon || 'FolderTree',
      order: navCategories.length + 1,
      isActive: true,
      mode: cat.mode || 'accordion',
      allowMultipleOpen: cat.allowMultipleOpen !== false
    };
    setNavCategoriesState(prev => [...prev, newCat]);
  };

  const updateCategory = (id: string, updates: Partial<NavCategoryConfig>) => {
    setNavCategoriesState(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const deleteCategory = (id: string, actionOnSubmenus: 'move' | 'disable', targetCategoryId?: string) => {
    setNavCategoriesState(prev => prev.filter(c => c.id !== id));
    if (actionOnSubmenus === 'move' && targetCategoryId) {
      setSubmenuItemsState(prev => prev.map(s => s.categoryId === id ? { ...s, categoryId: targetCategoryId } : s));
    } else {
      setSubmenuItemsState(prev => prev.map(s => s.categoryId === id ? { ...s, visible: false } : s));
    }
  };

  const reorderCategories = (sourceIndex: number, destinationIndex: number) => {
    setNavCategoriesState(prev => {
      const copy = [...prev].sort((a, b) => a.order - b.order);
      const [moved] = copy.splice(sourceIndex, 1);
      copy.splice(destinationIndex, 0, moved);
      return copy.map((c, idx) => ({ ...c, order: idx + 1 }));
    });
  };

  const moveCategoryItem = (id: string, direction: 'up' | 'down') => {
    setNavCategoriesState(prev => {
      const list = [...prev].sort((a, b) => a.order - b.order);
      const idx = list.findIndex(c => c.id === id);
      if (idx === -1) return prev;
      if (direction === 'up' && idx > 0) {
        const temp = list[idx].order;
        list[idx].order = list[idx - 1].order;
        list[idx - 1].order = temp;
      } else if (direction === 'down' && idx < list.length - 1) {
        const temp = list[idx].order;
        list[idx].order = list[idx + 1].order;
        list[idx + 1].order = temp;
      }
      return [...list].sort((a, b) => a.order - b.order);
    });
  };

  const toggleCategoryActive = (id: string) => {
    setNavCategoriesState(prev => prev.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c));
  };

  const setCategoryAccordionMode = (id: string, mode: 'accordion' | 'static') => {
    setNavCategoriesState(prev => prev.map(c => c.id === id ? { ...c, mode } : c));
  };

  // Submenu CRUD
  const addSubmenu = (item: { label: string; icon: string; categoryId: string; roles?: string[] }) => {
    const cleanId = item.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || `sub_${Date.now()}`;
    const newSub: NavSubmenuItem = {
      id: cleanId,
      label: item.label.trim(),
      icon: item.icon || 'FileText',
      categoryId: item.categoryId,
      order: submenuItems.filter(s => s.categoryId === item.categoryId).length + 1,
      visible: true,
      roles: item.roles && item.roles.length > 0 ? item.roles : ['super_admin', 'dispatch', 'leader']
    };
    setSubmenuItemsState(prev => [...prev, newSub]);
  };

  const updateSubmenu = (id: string, updates: Partial<NavSubmenuItem>) => {
    setSubmenuItemsState(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const deleteSubmenu = (id: string) => {
    setSubmenuItemsState(prev => prev.filter(s => s.id !== id));
  };

  const moveSubmenu = (id: string, direction: 'up' | 'down') => {
    setSubmenuItemsState(prev => {
      const target = prev.find(s => s.id === id);
      if (!target) return prev;
      const inCategory = prev.filter(s => s.categoryId === target.categoryId).sort((a, b) => a.order - b.order);
      const idx = inCategory.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      if (direction === 'up' && idx > 0) {
        const temp = inCategory[idx].order;
        inCategory[idx].order = inCategory[idx - 1].order;
        inCategory[idx - 1].order = temp;
      } else if (direction === 'down' && idx < inCategory.length - 1) {
        const temp = inCategory[idx].order;
        inCategory[idx].order = inCategory[idx + 1].order;
        inCategory[idx + 1].order = temp;
      }
      const map = new Map(inCategory.map(s => [s.id, s.order]));
      return prev.map(s => map.has(s.id) ? { ...s, order: map.get(s.id)! } : s);
    });
  };

  const reorderSubmenus = (categoryId: string, sourceIndex: number, destinationIndex: number) => {
    setSubmenuItemsState(prev => {
      const inCategory = prev.filter(s => s.categoryId === categoryId).sort((a, b) => a.order - b.order);
      const [moved] = inCategory.splice(sourceIndex, 1);
      inCategory.splice(destinationIndex, 0, moved);
      const reordered = inCategory.map((s, idx) => ({ ...s, order: idx + 1 }));
      const map = new Map(reordered.map(s => [s.id, s.order]));
      return prev.map(s => map.has(s.id) ? { ...s, order: map.get(s.id)! } : s);
    });
  };

  const moveSubmenuToCategory = (submenuId: string, targetCategoryId: string) => {
    setSubmenuItemsState(prev => {
      const targetCount = prev.filter(s => s.categoryId === targetCategoryId).length;
      return prev.map(s => s.id === submenuId ? { ...s, categoryId: targetCategoryId, order: targetCount + 1 } : s);
    });
  };

  const toggleSubmenuActive = (id: string) => {
    setSubmenuItemsState(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  };

  // Standalone Menu CRUD
  const updateStandaloneMenu = (id: string, updates: Partial<StandaloneMenuItem>) => {
    setStandaloneMenusState(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const moveStandaloneMenu = (id: string, direction: 'up' | 'down') => {
    setStandaloneMenusState(prev => {
      const list = [...prev].sort((a, b) => a.order - b.order);
      const idx = list.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      if (direction === 'up' && idx > 0) {
        const temp = list[idx].order;
        list[idx].order = list[idx - 1].order;
        list[idx - 1].order = temp;
      } else if (direction === 'down' && idx < list.length - 1) {
        const temp = list[idx].order;
        list[idx].order = list[idx + 1].order;
        list[idx + 1].order = temp;
      }
      return [...list].sort((a, b) => a.order - b.order);
    });
  };

  const reorderStandaloneMenus = (sourceIndex: number, destinationIndex: number) => {
    setStandaloneMenusState(prev => {
      const copy = [...prev].sort((a, b) => a.order - b.order);
      const [moved] = copy.splice(sourceIndex, 1);
      copy.splice(destinationIndex, 0, moved);
      return copy.map((m, idx) => ({ ...m, order: idx + 1 }));
    });
  };

  const toggleStandaloneMenuActive = (id: string) => {
    setStandaloneMenusState(prev => prev.map(m => m.id === id ? { ...m, visible: !m.visible } : m));
  };

  const deleteStandaloneMenu = (id: string) => {
    setStandaloneMenusState(prev => prev.map(m => m.id === id ? { ...m, visible: false } : m));
  };

  const setAllowMultipleOpenGroups = (allow: boolean) => {
    setAccordionSettingsState({ allowMultipleOpenGroups: allow });
  };

  // Legacy helper mappings
  const updateNavigationItem = (id: string, updates: Partial<NavigationMenuItem>) => {
    const isStandalone = standaloneMenus.some(m => m.id === id);
    if (isStandalone) {
      updateStandaloneMenu(id, { label: updates.label, visible: updates.visible });
    } else {
      updateSubmenu(id, { label: updates.label, visible: updates.visible });
    }
  };

  const moveNavigationItem = (id: string, direction: 'up' | 'down') => {
    const isStandalone = standaloneMenus.some(m => m.id === id);
    if (isStandalone) {
      moveStandaloneMenu(id, direction);
    } else {
      moveSubmenu(id, direction);
    }
  };

  const renameCategory = (oldCategory: string, newCategory: string) => {
    const trimmed = newCategory.trim();
    if (!trimmed || oldCategory === trimmed) return;
    setNavCategoriesState(prev => prev.map(c => c.name === oldCategory || c.id === oldCategory ? { ...c, name: trimmed } : c));
  };

  const moveCategory = (category: string, direction: 'up' | 'down') => {
    const target = navCategories.find(c => c.name === category || c.id === category);
    if (target) {
      moveCategoryItem(target.id, direction);
    }
  };

  const setMenuCategories = (_categories: string[]) => {
    // legacy no-op
  };

  const resetNavigationMenu = () => {
    setNavCategoriesState(DEFAULT_CANONICAL_CATEGORIES);
    setStandaloneMenusState(DEFAULT_STANDALONE_MENUS);
    setSubmenuItemsState(DEFAULT_SUBMENU_ITEMS);
    setAccordionSettingsState({ allowMultipleOpenGroups: true });
  };

  // Supabase Cloud Sync State
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [lastCloudSyncTime, setLastCloudSyncTime] = useState<string | null>(() => {
    try {
      return localStorage.getItem('morajaws_ui_cloud_sync_time');
    } catch {
      return null;
    }
  });
  const [lastCloudSyncError, setLastCloudSyncError] = useState<string | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'synced' | 'local_only' | 'syncing' | 'error'>('local_only');

  const applyLoadedNavigationDoc = (navDoc: NavigationConfigDoc) => {
    const nextCats = Array.isArray(navDoc.categories) && navDoc.categories.length > 0
      ? navDoc.categories
      : navCategoriesRef.current;
    const nextStandalone = Array.isArray(navDoc.standaloneMenus) && navDoc.standaloneMenus.length > 0
      ? sanitizeStandaloneMenus(navDoc.standaloneMenus)
      : standaloneMenusRef.current;
    const nextSubmenus = Array.isArray(navDoc.submenuItems) && navDoc.submenuItems.length > 0
      ? sanitizeSubmenuItems(navDoc.submenuItems)
      : submenuItemsRef.current;
    const nextAccordion = navDoc.accordionSettings || accordionSettingsRef.current;

    if (typeof navDoc.navigationVersion === 'number' && Number.isFinite(navDoc.navigationVersion)) {
      navVersionRef.current = navDoc.navigationVersion;
    }
    committedNavSnapshotRef.current = JSON.stringify({
      navCategories: nextCats,
      standaloneMenus: nextStandalone,
      submenuItems: nextSubmenus,
      accordionSettings: nextAccordion
    });

    setNavCategoriesState(nextCats);
    setStandaloneMenusState(nextStandalone);
    setSubmenuItemsState(nextSubmenus);
    setAccordionSettingsState(nextAccordion);
    setHasUnsavedNavChanges(false);
    persistConfirmedNavToLocalStorage(nextCats, nextStandalone, nextSubmenus, nextAccordion);

    if (navDoc.updatedAt) {
      setLastCloudSyncTime(navDoc.updatedAt);
      try {
        localStorage.setItem('morajaws_ui_cloud_sync_time', navDoc.updatedAt);
      } catch {}
    }
    setLastCloudSyncError(null);
    setCloudSyncStatus('synced');
  };

  // Load from Supabase PostgreSQL whenever authenticated session is ready & subscribe to real-time updates
  useEffect(() => {
    if (!isLoggedIn || !currentUser?.id) {
      setCloudSyncStatus('local_only');
      setLastCloudSyncError(null);
      return;
    }

    let isMounted = true;
    let unsubNav: (() => void) | null = null;
    let unsubUI: (() => void) | null = null;

    async function initCloudConfig() {
      setIsCloudSyncing(true);
      setCloudSyncStatus('syncing');
      setLastCloudSyncError(null);

      try {
        // 1. Load navigation_doc from Supabase PostgreSQL (authoritative persisted source)
        try {
          const navDoc = await loadNavigationDocFromSupabase();
          if (isMounted) {
            if (navDoc) {
              applyLoadedNavigationDoc(navDoc);
            } else {
              // Belum ada record di Supabase: pertahankan data lokal tanpa menimpa/menghapus
              setCloudSyncStatus('local_only');
            }
          }
        } catch (navErr: any) {
          console.error('[UIConfig] Gagal memuat navigation_doc dari Supabase:', navErr);
          if (isMounted) {
            setCloudSyncStatus('error');
            setLastCloudSyncError(navErr?.message || 'Gagal memuat konfigurasi navigasi dari Supabase PostgreSQL.');
          }
        }

        // Attach real-time listener for app_settings/navigation_doc
        if (isMounted) {
          unsubNav = subscribeToNavigationDoc(
            (data) => {
              if (!isMounted || !data) return;
              applyLoadedNavigationDoc(data);
            },
            (err) => {
              console.warn('[UIConfig] Navigation subscription notice:', err?.message || err);
              if (isMounted) {
                setCloudSyncStatus('error');
                setLastCloudSyncError(err?.message || 'Koneksi real-time navigasi terputus.');
              }
            }
          );
        }

        // 2. Load general UI configuration (tables, theme, devices)
        try {
          const cloudData = await loadUIConfigurationFromSupabase();
          if (cloudData && isMounted && cloudData.config) {
            setConfig(prev => ({
              ...prev,
              ...cloudData.config,
              global: { ...prev.global, ...(cloudData.config.global || {}) },
              device: {
                ...prev.device,
                ...(cloudData.config.device || {}),
                android: { ...prev.device.android, ...(cloudData.config.device?.android || {}) },
                pc: { ...prev.device.pc, ...(cloudData.config.device?.pc || {}) }
              }
            }));
          }
        } catch (uiErr: any) {
          console.warn('[UIConfig] Could not load ui_configuration:', uiErr?.message || uiErr);
        }

        if (isMounted) {
          unsubUI = subscribeToUIConfiguration((data) => {
            if (!isMounted || !data) return;
            if (data.config) {
              setConfig(prev => ({
                ...prev,
                ...data.config,
                global: { ...prev.global, ...(data.config.global || {}) },
                device: {
                  ...prev.device,
                  ...(data.config.device || {}),
                  android: { ...prev.device.android, ...(data.config.device?.android || {}) },
                  pc: { ...prev.device.pc, ...(data.config.device?.pc || {}) }
                }
              }));
            }
          });
        }
      } finally {
        if (isMounted) {
          setIsCloudSyncing(false);
        }
      }
    }

    initCloudConfig();

    return () => {
      isMounted = false;
      if (unsubNav) unsubNav();
      if (unsubUI) unsubUI();
    };
  }, [isLoggedIn, currentUser?.id, currentUser?.role]);

  const reloadNavigationFromSupabase = async (): Promise<{ success: boolean; error?: string }> => {
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setLastCloudSyncError(null);
    try {
      const navDoc = await loadNavigationDocFromSupabase();
      if (!navDoc) {
        setCloudSyncStatus('local_only');
        return {
          success: false,
          error: 'Belum ada konfigurasi navigasi tersimpan di tabel app_settings Supabase PostgreSQL.'
        };
      }
      applyLoadedNavigationDoc(navDoc);
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Gagal memuat ulang konfigurasi navigasi dari Supabase PostgreSQL.';
      setCloudSyncStatus('error');
      setLastCloudSyncError(msg);
      return { success: false, error: msg };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // Save Canonical Navigation Configuration to Supabase PostgreSQL
  const saveNavigationConfig = async (operatorName: string = 'Super Admin'): Promise<{ success: boolean; error?: string; updatedAt?: string }> => {
    if (!Array.isArray(navCategories) || navCategories.length === 0) {
      const msg = 'Validasi gagal: minimal harus ada 1 kategori navigasi sebelum menyimpan.';
      setCloudSyncStatus('error');
      setLastCloudSyncError(msg);
      return { success: false, error: msg };
    }
    if (!Array.isArray(standaloneMenus) || standaloneMenus.length === 0) {
      const msg = 'Validasi gagal: minimal harus ada 1 menu mandiri sebelum menyimpan.';
      setCloudSyncStatus('error');
      setLastCloudSyncError(msg);
      return { success: false, error: msg };
    }

    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setLastCloudSyncError(null);
    try {
      const nextVersion = (navVersionRef.current || 1) + 1;
      const docData: NavigationConfigDoc = {
        categories: navCategories,
        standaloneMenus,
        submenuItems,
        accordionSettings,
        navigationVersion: nextVersion,
        updatedAt: new Date().toISOString(),
        updatedBy: operatorName
      };
      const res = await saveNavigationDocToSupabase(docData);
      navVersionRef.current = nextVersion;
      committedNavSnapshotRef.current = JSON.stringify({
        navCategories,
        standaloneMenus,
        submenuItems,
        accordionSettings
      });
      setHasUnsavedNavChanges(false);
      persistConfirmedNavToLocalStorage(navCategories, standaloneMenus, submenuItems, accordionSettings);
      setLastCloudSyncTime(res.updatedAt);
      setLastCloudSyncError(null);
      setCloudSyncStatus('synced');
      try {
        localStorage.setItem('morajaws_ui_cloud_sync_time', res.updatedAt);
      } catch {}
      return { success: true, updatedAt: res.updatedAt };
    } catch (err: any) {
      const msg = err?.message || 'Gagal menyimpan konfigurasi navigasi ke Supabase PostgreSQL.';
      setCloudSyncStatus('error');
      setLastCloudSyncError(msg);
      return { success: false, error: msg };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const resetNavigationConfig = async (operatorName: string = 'Super Admin'): Promise<{ success: boolean; error?: string }> => {
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setLastCloudSyncError(null);
    try {
      const nextVersion = (navVersionRef.current || 1) + 1;
      const defaultCats = DEFAULT_CANONICAL_CATEGORIES;
      const defaultStandalone = sanitizeStandaloneMenus(DEFAULT_STANDALONE_MENUS);
      const defaultSubmenus = sanitizeSubmenuItems(DEFAULT_SUBMENU_ITEMS);
      const defaultAccordion = { allowMultipleOpenGroups: true };
      const docData: NavigationConfigDoc = {
        categories: defaultCats,
        standaloneMenus: defaultStandalone,
        submenuItems: defaultSubmenus,
        accordionSettings: defaultAccordion,
        navigationVersion: nextVersion,
        updatedAt: new Date().toISOString(),
        updatedBy: operatorName
      };
      const res = await saveNavigationDocToSupabase(docData);
      // Only mutate React state & localStorage after Supabase confirms persistence
      navVersionRef.current = nextVersion;
      committedNavSnapshotRef.current = JSON.stringify({
        navCategories: defaultCats,
        standaloneMenus: defaultStandalone,
        submenuItems: defaultSubmenus,
        accordionSettings: defaultAccordion
      });
      setNavCategoriesState(defaultCats);
      setStandaloneMenusState(defaultStandalone);
      setSubmenuItemsState(defaultSubmenus);
      setAccordionSettingsState(defaultAccordion);
      setHasUnsavedNavChanges(false);
      persistConfirmedNavToLocalStorage(defaultCats, defaultStandalone, defaultSubmenus, defaultAccordion);
      setLastCloudSyncTime(res.updatedAt);
      setLastCloudSyncError(null);
      setCloudSyncStatus('synced');
      try {
        localStorage.setItem('morajaws_ui_cloud_sync_time', res.updatedAt);
      } catch {}
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Gagal mereset konfigurasi navigasi di Supabase PostgreSQL.';
      setCloudSyncStatus('error');
      setLastCloudSyncError(msg);
      return { success: false, error: msg };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const saveConfigToSupabase = async (operatorName?: string): Promise<{ success: boolean; error?: string; updatedAt?: string }> => {
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    try {
      const activeCfg = draftConfig || config;
      const res = await saveUIConfigurationToSupabase({
        config: activeCfg,
        navigationItems,
        menuCategories,
        updatedBy: operatorName || 'Super Admin'
      });
      setLastCloudSyncTime(res.updatedAt);
      setCloudSyncStatus('synced');
      try {
        localStorage.setItem('morajaws_ui_cloud_sync_time', res.updatedAt);
      } catch {}
      return { success: true, updatedAt: res.updatedAt };
    } catch (err: any) {
      setCloudSyncStatus('error');
      return { success: false, error: err?.message || 'Gagal menyimpan ke Supabase PostgreSQL' };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const loadConfigFromSupabase = async (): Promise<{ success: boolean; error?: string }> => {
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    try {
      const cloudData = await loadUIConfigurationFromSupabase();
      if (!cloudData) {
        setCloudSyncStatus('local_only');
        return { success: false, error: 'Belum ada data konfigurasi tersimpan di Supabase PostgreSQL.' };
      }
      if (cloudData.config) {
        setConfig(prev => ({
          ...prev,
          ...cloudData.config,
          global: { ...prev.global, ...(cloudData.config.global || {}) },
          device: {
            ...prev.device,
            ...(cloudData.config.device || {}),
            android: { ...prev.device.android, ...(cloudData.config.device?.android || {}) },
            pc: { ...prev.device.pc, ...(cloudData.config.device?.pc || {}) }
          }
        }));
      }
      if (cloudData.updatedAt) {
        setLastCloudSyncTime(cloudData.updatedAt);
        try {
          localStorage.setItem('morajaws_ui_cloud_sync_time', cloudData.updatedAt);
        } catch {}
      }
      setCloudSyncStatus('synced');
      return { success: true };
    } catch (err: any) {
      setCloudSyncStatus('error');
      return { success: false, error: err?.message || 'Gagal membaca konfigurasi dari Supabase PostgreSQL.' };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const activeConfig = draftConfig || config;

  const startDrafting = () => {
    setDraftConfig(JSON.parse(JSON.stringify(config)));
  };

  const updateDraft = (updater: (prev: UIConfiguration) => UIConfiguration) => {
    setDraftConfig(prev => {
      const base = prev || config;
      return updater(JSON.parse(JSON.stringify(base)));
    });
  };

  const saveDraft = () => {
    if (draftConfig) {
      const finalized = {
        ...draftConfig,
        version: (draftConfig.version || 1) + 1,
        updatedAt: new Date().toISOString()
      };
      setConfig(finalized);
      setDraftConfig(null);
    }
  };

  const cancelDraft = () => {
    setDraftConfig(null);
  };

  const resetToDefaults = () => {
    setConfig(DEFAULT_UI_CONFIG);
    setDraftConfig(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const setGlobalTheme = (updates: Partial<UIConfiguration['global']>) => {
    setConfig(prev => ({
      ...prev,
      global: { ...prev.global, ...updates },
      updatedAt: new Date().toISOString()
    }));
  };

  const setSidebarState = (state: 'expanded' | 'minimized' | 'closed') => {
    setConfig(prev => ({
      ...prev,
      global: {
        ...prev.global,
        sidebarState: state,
        sidebarCollapsed: state === 'minimized'
      },
      updatedAt: new Date().toISOString()
    }));
  };

  const setColumnVisibility = (columnKey: string, visible: boolean) => {
    setConfig(prev => ({
      ...prev,
      ticketsTable: {
        ...prev.ticketsTable,
        columns: prev.ticketsTable.columns.map(col =>
          col.key === columnKey ? { ...col, visible } : col
        )
      }
    }));
  };

  const setColumnOrder = (sourceIndex: number, destinationIndex: number) => {
    setConfig(prev => {
      const cols = [...prev.ticketsTable.columns];
      const [moved] = cols.splice(sourceIndex, 1);
      cols.splice(destinationIndex, 0, moved);
      const reordered = cols.map((col, idx) => ({ ...col, order: idx + 1 }));
      return {
        ...prev,
        ticketsTable: {
          ...prev.ticketsTable,
          columns: reordered
        }
      };
    });
  };

  const updateColumnConfig = (columnKey: string, updates: Partial<ColumnConfig>) => {
    setConfig(prev => ({
      ...prev,
      ticketsTable: {
        ...prev.ticketsTable,
        columns: prev.ticketsTable.columns.map(col =>
          col.key === columnKey ? { ...col, ...updates } : col
        )
      }
    }));
  };

  const applyPreset = (presetId: string) => {
    setConfig(prev => {
      const preset = prev.ticketsTable.presets.find(p => p.id === presetId);
      if (!preset) return prev;
      return {
        ...prev,
        ticketsTable: {
          ...prev.ticketsTable,
          activePresetId: presetId,
          columns: preset.columns,
          density: preset.density,
          rowsPerPage: preset.rowsPerPage
        }
      };
    });
  };

  const saveCurrentAsPreset = (name: string, description: string) => {
    const newPreset: TablePreset = {
      id: 'preset_custom_' + Date.now(),
      name,
      description,
      columns: config.ticketsTable.columns,
      density: config.ticketsTable.density,
      rowsPerPage: config.ticketsTable.rowsPerPage
    };
    setConfig(prev => ({
      ...prev,
      ticketsTable: {
        ...prev.ticketsTable,
        presets: [...prev.ticketsTable.presets, newPreset],
        activePresetId: newPreset.id
      }
    }));
  };

  const deletePreset = (presetId: string) => {
    setConfig(prev => ({
      ...prev,
      ticketsTable: {
        ...prev.ticketsTable,
        presets: prev.ticketsTable.presets.filter(p => p.id !== presetId)
      }
    }));
  };

  const updateToolbarButton = (buttonId: string, updates: Partial<ToolbarButtonConfig>) => {
    setConfig(prev => ({
      ...prev,
      toolbar: {
        ...prev.toolbar,
        buttons: prev.toolbar.buttons.map(btn =>
          btn.id === buttonId ? { ...btn, ...updates } : btn
        )
      }
    }));
  };

  const toggleToolbarOption = (key: keyof UIConfiguration['toolbar'], value: boolean) => {
    setConfig(prev => ({
      ...prev,
      toolbar: {
        ...prev.toolbar,
        [key]: value
      }
    }));
  };

  const toggleDetailSection = (sectionId: string, visible: boolean) => {
    setConfig(prev => ({
      ...prev,
      ticketDetail: {
        ...prev.ticketDetail,
        sections: prev.ticketDetail.sections.map(sec =>
          sec.id === sectionId ? { ...sec, visible } : sec
        )
      }
    }));
  };

  const reorderDetailSections = (sourceIndex: number, destinationIndex: number) => {
    setConfig(prev => {
      const sections = [...prev.ticketDetail.sections];
      const [moved] = sections.splice(sourceIndex, 1);
      sections.splice(destinationIndex, 0, moved);
      const reordered = sections.map((sec, idx) => ({ ...sec, order: idx + 1 }));
      return {
        ...prev,
        ticketDetail: {
          ...prev.ticketDetail,
          sections: reordered
        }
      };
    });
  };

  const updateDetailField = (sectionId: string, fieldKey: string, updates: any) => {
    setConfig(prev => ({
      ...prev,
      ticketDetail: {
        ...prev.ticketDetail,
        sections: prev.ticketDetail.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          return {
            ...sec,
            fields: sec.fields.map(f => f.key === fieldKey ? { ...f, ...updates } : f)
          };
        })
      }
    }));
  };

  const setShowEmptyFields = (show: boolean) => {
    setConfig(prev => ({
      ...prev,
      ticketDetail: {
        ...prev.ticketDetail,
        showEmptyFields: show
      }
    }));
  };

  // Device mode & ergonomic adjustments
  const isMobileView = config.device?.mode === 'android' 
    ? true 
    : config.device?.mode === 'pc' 
    ? false 
    : windowWidth < 768;

  const setDeviceMode = (mode: 'auto' | 'pc' | 'android') => {
    setConfig(prev => ({
      ...prev,
      device: {
        ...prev.device,
        mode
      }
    }));
  };

  const updateAndroidSettings = (updates: Partial<UIConfiguration['device']['android']>) => {
    setConfig(prev => ({
      ...prev,
      device: {
        ...prev.device,
        android: {
          ...prev.device.android,
          ...updates
        }
      }
    }));
  };

  const updatePCSettings = (updates: Partial<UIConfiguration['device']['pc']>) => {
    setConfig(prev => ({
      ...prev,
      device: {
        ...prev.device,
        pc: {
          ...prev.device.pc,
          ...updates
        }
      }
    }));
  };

  const applyDevicePreset = (preset: 'comfortable_android' | 'high_productivity_pc' | 'auto') => {
    setConfig(prev => {
      if (preset === 'comfortable_android') {
        return {
          ...prev,
          global: {
            ...prev.global,
            contentWidth: 'full',
            density: 'comfortable',
            sidebarState: 'closed',
            sidebarCollapsed: true
          },
          device: {
            ...prev.device,
            mode: 'android',
            android: {
              ...prev.device.android,
              layoutType: 'cards',
              touchTargetSize: 'comfortable',
              showBottomNavigation: true,
              cardDensity: 'comfortable',
              highContrastBadges: true,
              showQuickCall: true,
              showQuickWhatsApp: true,
              showQuickDetail: true,
              autoCloseSidebarOnNavigate: true
            }
          },
          ticketsTable: {
            ...prev.ticketsTable,
            rowsPerPage: 10,
            density: 'comfortable'
          }
        };
      } else if (preset === 'high_productivity_pc') {
        return {
          ...prev,
          global: {
            ...prev.global,
            contentWidth: 'full',
            density: 'compact',
            sidebarState: 'expanded',
            sidebarCollapsed: false
          },
          device: {
            ...prev.device,
            mode: 'pc',
            pc: {
              ...prev.device.pc,
              tableDensity: 'compact',
              stickyColumns: true,
              wideScreenFullWidth: true,
              showInlineFilters: true,
              showBulkToolbar: true,
              multiColumnDetail: true
            }
          },
          ticketsTable: {
            ...prev.ticketsTable,
            rowsPerPage: 20,
            density: 'compact'
          }
        };
      } else {
        // Auto mode
        return {
          ...prev,
          device: {
            ...prev.device,
            mode: 'auto'
          }
        };
      }
    });
  };

  const exportConfigJson = () => {
    return JSON.stringify(config, null, 2);
  };

  const importConfigJson = (jsonString: string): boolean => {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.global && parsed.ticketsTable) {
        setConfig({
          ...DEFAULT_UI_CONFIG,
          ...parsed,
          version: (parsed.version || 1) + 1,
          updatedAt: new Date().toISOString()
        });
        return true;
      }
    } catch (e) {
      console.error('Invalid configuration JSON', e);
    }
    return false;
  };

  const navigationSettings: NavigationSettings = {
    categories: navCategories.reduce((acc, cat) => {
      acc[cat.id] = { accordionEnabled: cat.mode === 'accordion' };
      acc[cat.name] = { accordionEnabled: cat.mode === 'accordion' };
      return acc;
    }, {} as Record<string, CategoryAccordionConfig>),
    allowMultipleOpenGroups: accordionSettings.allowMultipleOpenGroups,
    defaultMode: 'accordion'
  };

  const setCategoryAccordion = (categoryIdOrName: string, enabled: boolean) => {
    const target = navCategories.find(c => c.id === categoryIdOrName || c.name === categoryIdOrName);
    if (target) {
      setCategoryAccordionMode(target.id, enabled ? 'accordion' : 'static');
    }
  };

  const toggleCategoryAccordion = (categoryIdOrName: string) => {
    const currentStatus = isCategoryAccordion(categoryIdOrName, navigationSettings);
    setCategoryAccordion(categoryIdOrName, !currentStatus);
  };

  const getCategoryAccordionState = (categoryIdOrName: string): boolean => {
    return isCategoryAccordion(categoryIdOrName, navigationSettings);
  };

  const updateNavigationSettings = (updates: Partial<NavigationSettings>) => {
    if (updates.allowMultipleOpenGroups !== undefined) {
      setAllowMultipleOpenGroups(updates.allowMultipleOpenGroups);
    }
  };

  const setRoleNavigationMode = (_role: any, _mode: NavigationDisplayMode) => {
    // legacy no-op
  };

  const setCategoryNavigationMode = (category: string, mode: NavigationDisplayMode) => {
    const target = navCategories.find(c => c.id === category || c.name === category);
    if (target) {
      setCategoryAccordionMode(target.id, mode);
    }
  };

  const resetNavigationSettings = () => {
    setAccordionSettingsState({ allowMultipleOpenGroups: true });
    setNavCategoriesState(prev => prev.map(c => ({ ...c, mode: 'accordion' })));
  };

  return (
    <UIConfigContext.Provider
      value={{
        config: activeConfig,
        draftConfig,
        isDrafting: Boolean(draftConfig),
        isMobileView,
        startDrafting,
        updateDraft,
        saveDraft,
        cancelDraft,
        resetToDefaults,
        setGlobalTheme,
        setSidebarState,
        setDeviceMode,
        updateAndroidSettings,
        updatePCSettings,
        applyDevicePreset,
        setColumnVisibility,
        setColumnOrder,
        updateColumnConfig,
        applyPreset,
        saveCurrentAsPreset,
        deletePreset,
        updateToolbarButton,
        toggleToolbarOption,
        toggleDetailSection,
        reorderDetailSections,
        updateDetailField,
        setShowEmptyFields,
        // Canonical Navigation
        navCategories,
        standaloneMenus,
        submenuItems,
        accordionSettings,
        addCategory,
        updateCategory,
        deleteCategory,
        reorderCategories,
        moveCategoryItem,
        toggleCategoryActive,
        setCategoryAccordionMode,
        addSubmenu,
        updateSubmenu,
        deleteSubmenu,
        moveSubmenu,
        reorderSubmenus,
        moveSubmenuToCategory,
        toggleSubmenuActive,
        updateStandaloneMenu,
        moveStandaloneMenu,
        reorderStandaloneMenus,
        toggleStandaloneMenuActive,
        deleteStandaloneMenu,
        setAllowMultipleOpenGroups,
        saveNavigationConfig,
        resetNavigationConfig,
        // Legacy Navigation Compatibility
        navigationSettings,
        updateNavigationSettings,
        setCategoryAccordion,
        toggleCategoryAccordion,
        getCategoryAccordionState,
        setRoleNavigationMode,
        setCategoryNavigationMode,
        resetNavigationSettings,
        navigationItems,
        menuCategories,
        updateNavigationItem,
        moveNavigationItem,
        renameCategory,
        moveCategory,
        setMenuCategories,
        resetNavigationMenu,
        exportConfigJson,
        importConfigJson,
        saveConfigToSupabase,
        loadConfigFromSupabase,
        reloadNavigationFromSupabase,
        isCloudSyncing,
        lastCloudSyncTime,
        lastCloudSyncError,
        hasUnsavedNavChanges,
        cloudSyncStatus
      }}
    >
      {children}
    </UIConfigContext.Provider>
  );
};

export const useUIConfig = () => {
  const context = useContext(UIConfigContext);
  if (!context) {
    throw new Error('useUIConfig must be used within a UIConfigProvider');
  }
  return context;
};
