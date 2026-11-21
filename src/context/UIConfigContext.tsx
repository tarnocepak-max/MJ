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
  CategoryAccordionConfig,
  UserRole
} from '../types';
import {
  DEFAULT_UI_CONFIG,
  DEFAULT_COLUMNS,
  DEFAULT_NAVIGATION_CATEGORIES,
  DEFAULT_CANONICAL_CATEGORIES,
  DEFAULT_STANDALONE_MENUS,
  DEFAULT_INSTALLER_STANDALONE_MENUS,
  DEFAULT_SUBMENU_ITEMS,
  DEFAULT_NAVIGATION_DOC
} from '../constants/defaultConfig';
import {
  loadUIConfigurationFromSupabase,
  loadNavigationDocFromSupabase
} from '../services/supabaseConfigService';
import {
  getGlobalConfig,
  saveGlobalConfig,
  subscribeToGlobalConfigUpdates,
  ConfigConflictError,
  GlobalConfigConflictDetails,
  setTrackedConfigVersion
} from '../services/globalConfigService';
import { useApp } from './AppContext';

export type DisplayMode = 'desktop' | 'mobile';

export const DISPLAY_MODE_STORAGE_PREFIX = 'morajaws_display_mode_v1';

export const getScopedDisplayModeKey = (
  user?: { id?: string; username?: string; role?: UserRole | string } | null
): string | null => {
  if (!user || !user.role) return null;
  const uid = String(user.id || user.username || 'anon').trim() || 'anon';
  const role = String(user.role).trim();
  return `${DISPLAY_MODE_STORAGE_PREFIX}:${uid}:${role}`;
};

export const resolveDisplayModeForUser = (
  user: { id?: string; username?: string; role?: UserRole | string } | null | undefined,
  isLoggedIn: boolean,
  windowWidth: number
): DisplayMode => {
  const defaultMode: DisplayMode = windowWidth < 768 ? 'mobile' : 'desktop';
  if (!isLoggedIn || !user || !user.role) {
    return defaultMode;
  }

  const key = getScopedDisplayModeKey(user);

  // Strict Role Guard: TEKNISI (installer) is permanently locked to Mobile Mode
  if (user.role === 'installer') {
    if (key && typeof window !== 'undefined') {
      try {
        if (window.localStorage.getItem(key) !== 'mobile') {
          window.localStorage.setItem(key, 'mobile');
        }
      } catch {}
    }
    return 'mobile';
  }

  if (key && typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === 'desktop' || saved === 'mobile') {
        return saved;
      }
    } catch {}
  }

  return defaultMode;
};

interface UIConfigContextType {
  config: UIConfiguration;
  draftConfig: UIConfiguration | null;
  isDrafting: boolean;
  startDrafting: () => void;
  updateDraft: (updater: (prev: UIConfiguration) => UIConfiguration) => void;
  saveDraft: () => Promise<{ success: boolean; error?: string }>;
  cancelDraft: () => void;
  resetToDefaults: () => Promise<{ success: boolean; error?: string }>;
  
  // Quick Direct Actions (Database-First for Super Admin)
  setGlobalTheme: (updates: Partial<UIConfiguration['global']>) => Promise<{ success: boolean; error?: string }>;
  setColumnVisibility: (columnKey: string, visible: boolean) => Promise<{ success: boolean; error?: string }>;
  setColumnOrder: (sourceIndex: number, destinationIndex: number) => Promise<{ success: boolean; error?: string }>;
  updateColumnConfig: (columnKey: string, updates: Partial<ColumnConfig>) => Promise<{ success: boolean; error?: string }>;
  applyPreset: (presetId: string) => Promise<{ success: boolean; error?: string }>;
  saveCurrentAsPreset: (name: string, description: string) => Promise<{ success: boolean; error?: string }>;
  deletePreset: (presetId: string) => Promise<{ success: boolean; error?: string }>;
  
  // Toolbar settings
  updateToolbarButton: (buttonId: string, updates: Partial<ToolbarButtonConfig>) => Promise<{ success: boolean; error?: string }>;
  toggleToolbarOption: (key: keyof UIConfiguration['toolbar'], value: boolean) => Promise<{ success: boolean; error?: string }>;

  // Ticket Detail settings
  toggleDetailSection: (sectionId: string, visible: boolean) => Promise<{ success: boolean; error?: string }>;
  reorderDetailSections: (sourceIndex: number, destinationIndex: number) => Promise<{ success: boolean; error?: string }>;
  updateDetailField: (sectionId: string, fieldKey: string, updates: any) => Promise<{ success: boolean; error?: string }>;
  setShowEmptyFields: (show: boolean) => Promise<{ success: boolean; error?: string }>;

  // Centralized Personal Display Mode (per user + per role) & Device Profile
  displayMode: DisplayMode;
  canSwitchDisplayMode: boolean;
  setDisplayMode: (mode: DisplayMode) => void;
  isMobileView: boolean;
  setDeviceMode: (mode: 'auto' | 'pc' | 'android') => Promise<{ success: boolean; error?: string }>;
  updateAndroidSettings: (updates: Partial<UIConfiguration['device']['android']>) => Promise<{ success: boolean; error?: string }>;
  updatePCSettings: (updates: Partial<UIConfiguration['device']['pc']>) => Promise<{ success: boolean; error?: string }>;
  applyDevicePreset: (preset: 'comfortable_android' | 'high_productivity_pc' | 'auto') => Promise<{ success: boolean; error?: string }>;

  // Sidebar controls (personal viewport state)
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
  saveNavigationConfig: (
    operatorName?: string,
    options?: { forceOverwrite?: boolean }
  ) => Promise<{ success: boolean; error?: string; updatedAt?: string }>;
  resetNavigationConfig: (
    operatorName?: string,
    options?: { forceOverwrite?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;

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
  importConfigJson: (jsonString: string) => Promise<{ success: boolean; error?: string }>;

  // Cloud Database Configuration (Supabase PostgreSQL)
  saveConfigToSupabase: (
    operatorName?: string,
    options?: { forceOverwrite?: boolean }
  ) => Promise<{ success: boolean; error?: string; updatedAt?: string }>;
  loadConfigFromSupabase: () => Promise<{ success: boolean; error?: string }>;
  reloadNavigationFromSupabase: () => Promise<{ success: boolean; error?: string }>;
  isCloudSyncing: boolean;
  lastCloudSyncTime: string | null;
  lastCloudSyncError: string | null;
  hasUnsavedNavChanges: boolean;
  cloudSyncStatus: 'synced' | 'local_only' | 'syncing' | 'error';
  uiConfigVersion: number;
  navDocVersion: number;
  uiConflict: GlobalConfigConflictDetails | null;
  clearUiConflict: () => void;
  resolveUiConflict: (strategy: 'reload' | 'overwrite') => Promise<void>;
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
  { id: 'setup', label: 'Setup', category: 'Setup', order: 21, visible: true, roles: ['super_admin', 'dispatch', 'management_data'] },
  { id: 'nav_config', label: 'Konfigurasi Menu Navigasi', category: 'Setup', order: 22, visible: true, roles: ['super_admin'] },
  { id: 'management_role', label: 'Role & Permission', category: 'Setup', order: 23, visible: true, roles: ['super_admin'] },
  { id: 'droplist_management', label: 'Droplist Management', category: 'Setup', order: 24, visible: true, roles: ['super_admin', 'dispatch', 'management_data'] },
  { id: 'sound_settings', label: 'Pengaturan Notifikasi', category: 'Setup', order: 25, visible: true, roles: ['super_admin', 'dispatch'] },
  { id: 'settings', label: 'Pengaturan Sistem', category: 'Setup', order: 26, visible: false, roles: ['super_admin'] },
  { id: 'offline_sync', label: 'Sinkronisasi Offline', category: 'Setup', order: 27, visible: true, roles: ['super_admin', 'dispatch'] },

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
  const { isLoggedIn, currentUser, toast } = useApp();
  const [windowWidth, setWindowWidth] = useState<number>(() => {
    return typeof window !== 'undefined' ? window.innerWidth : 1200;
  });

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const sanitizeToolbarButtons = (toolbarCfg: UIConfiguration['toolbar']): UIConfiguration['toolbar'] => ({
    ...toolbarCfg,
    buttons: (toolbarCfg?.buttons || DEFAULT_UI_CONFIG.toolbar.buttons).map(btn => {
      if (btn.id === 'btn_import_wo') {
        return { ...btn, roleRequired: ['super_admin', 'management_data'] as UserRole[] };
      }
      if (btn.id === 'btn_bulk_assign') {
        return { ...btn, roleRequired: ['leader'] as UserRole[] };
      }
      return btn;
    })
  });

  const mergeCanonicalColumns = (savedColumns?: ColumnConfig[]): ColumnConfig[] => {
    const defaultByKey = new Map(DEFAULT_COLUMNS.map(col => [col.key, col]));
    if (!Array.isArray(savedColumns) || savedColumns.length === 0) {
      return DEFAULT_COLUMNS.map(col => ({ ...col }));
    }

    const seenKeys = new Set<string>();
    const merged: ColumnConfig[] = [];

    for (const col of savedColumns) {
      if (!col || !col.key || col.key === 'actions' || seenKeys.has(col.key)) continue;
      const canonical = defaultByKey.get(col.key);
      if (!canonical) continue;
      seenKeys.add(col.key);
      merged.push({
        ...canonical,
        ...col,
        visible: canonical.mandatory ? true : Boolean(col.visible),
        mandatory: canonical.mandatory,
        categoryGroup: canonical.categoryGroup,
        description: canonical.description,
        badgeHint: canonical.badgeHint
      });
    }

    for (const canonical of DEFAULT_COLUMNS) {
      if (!seenKeys.has(canonical.key)) {
        seenKeys.add(canonical.key);
        merged.push({ ...canonical });
      }
    }

    return merged
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map((col, idx) => ({ ...col, order: idx + 1 }));
  };

  const mergeCanonicalPresets = (savedPresets?: TablePreset[]): TablePreset[] => {
    const basePresets = DEFAULT_UI_CONFIG.ticketsTable.presets.map(p => ({
      ...p,
      columns: mergeCanonicalColumns(p.columns)
    }));
    if (!Array.isArray(savedPresets) || savedPresets.length === 0) {
      return basePresets;
    }
    const customPresets = savedPresets
      .filter(p => p && p.id && p.id.startsWith('preset_custom_'))
      .map(p => ({
        ...p,
        columns: mergeCanonicalColumns(p.columns)
      }));
    return [...basePresets, ...customPresets];
  };

  const normalizeTicketsTableConfig = (
    incomingTable?: Partial<UIConfiguration['ticketsTable']>
  ): UIConfiguration['ticketsTable'] => {
    const base = DEFAULT_UI_CONFIG.ticketsTable;
    const freezeCountRaw = incomingTable?.freezeColumnCount ?? base.freezeColumnCount ?? 4;
    const freezeColumnCount = Math.max(1, Math.min(4, Number(freezeCountRaw) || 4));
    return {
      ...base,
      ...(incomingTable || {}),
      columns: mergeCanonicalColumns(incomingTable?.columns),
      presets: mergeCanonicalPresets(incomingTable?.presets),
      cellFontSize: incomingTable?.cellFontSize || base.cellFontSize || 'medium',
      freezeColumnCount,
      smartOmitEmpty: incomingTable?.smartOmitEmpty ?? base.smartOmitEmpty ?? true,
      showHoverTooltips: incomingTable?.showHoverTooltips ?? base.showHoverTooltips ?? true
    };
  };

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
          ticketsTable: normalizeTicketsTableConfig(parsed.ticketsTable),
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

  const uiVersionRef = useRef<number>(1);
  const [uiConfigVersion, setUiConfigVersion] = useState<number>(1);
  const [navDocVersion, setNavDocVersion] = useState<number>(1);
  const [uiConflict, setUiConflict] = useState<GlobalConfigConflictDetails | null>(null);
  const pendingUiActionRef = useRef<
    | { type: 'ui'; nextConfig: UIConfiguration; operatorName: string }
    | { type: 'nav_save'; operatorName: string }
    | { type: 'nav_reset'; operatorName: string }
    | null
  >(null);

  // Sync confirmed UI config to local cache & dark theme class (never triggers background DB writes)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.error('Failed to save UI configuration to localStorage', e);
    }

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
    const cleaned = items
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
            label: 'Setup',
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
        if (item.id === 'sla_monitoring') {
          return {
            ...item,
            label: 'Monitoring SLA Kontraktor & Vendor',
            categoryId: 'contractor_area',
            roles: ['super_admin', 'dispatch', 'leader', 'management_data']
          };
        }
        return { ...item, roles: safeRoles };
      });

    if (!seen.has('reassign_wo')) {
      cleaned.push({
        id: 'reassign_wo',
        label: 'Reassign WO',
        icon: 'ArrowRightLeft',
        categoryId: 'contractor_area',
        order: 2,
        visible: true,
        roles: ['leader']
      });
    }

    if (!seen.has('sla_monitoring')) {
      cleaned.push({
        id: 'sla_monitoring',
        label: 'Monitoring SLA Kontraktor & Vendor',
        icon: 'Activity',
        categoryId: 'contractor_area',
        order: 6,
        visible: true,
        roles: ['super_admin', 'dispatch', 'leader', 'management_data']
      });
    }

    return cleaned;
  };

  const sanitizeStandaloneMenus = (items: StandaloneMenuItem[]): StandaloneMenuItem[] => {
    if (!Array.isArray(items)) return DEFAULT_STANDALONE_MENUS;
    const cleaned = items.map(item => {
      const roles = Array.isArray(item.roles) ? item.roles : ['super_admin'];
      if (item.id === 'import') {
        return {
          ...item,
          roles: ['super_admin', 'management_data']
        };
      }
      if (item.id === 'monitoring_maps') {
        return {
          ...item,
          roles: roles.filter(r => r !== 'installer' && r !== 'it_support')
        };
      }
      return {
        ...item,
        roles
      };
    });

    if (!cleaned.some(i => i?.id === 'monitoring_maps')) {
      cleaned.splice(1, 0, {
        id: 'monitoring_maps',
        label: 'Monitoring Maps',
        icon: 'Map',
        order: 2,
        visible: true,
        roles: ['super_admin', 'dispatch', 'leader', 'management_data']
      });
    }

    return cleaned;
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

  const mergeServerUiConfig = (incoming: Partial<UIConfiguration>) => {
    setConfig(prev => ({
      ...prev,
      ...incoming,
      global: { ...prev.global, ...(incoming.global || {}) },
      ticketsTable: normalizeTicketsTableConfig({
        ...prev.ticketsTable,
        ...(incoming.ticketsTable || {})
      }),
      toolbar: sanitizeToolbarButtons({ ...prev.toolbar, ...(incoming.toolbar || {}) }),
      device: {
        ...prev.device,
        ...(incoming.device || {}),
        android: { ...prev.device.android, ...(incoming.device?.android || {}) },
        pc: { ...prev.device.pc, ...(incoming.device?.pc || {}) }
      }
    }));
  };

  // Load from Supabase PostgreSQL whenever authenticated session is ready & subscribe to real-time SSE updates
  useEffect(() => {
    if (!isLoggedIn || !currentUser?.id) {
      setCloudSyncStatus('local_only');
      setLastCloudSyncError(null);
      return;
    }

    let isMounted = true;
    let unsubGlobal: (() => void) | null = null;

    async function initCloudConfig() {
      setIsCloudSyncing(true);
      setCloudSyncStatus('syncing');
      setLastCloudSyncError(null);

      try {
        // 1. Load navigation_doc from Supabase PostgreSQL (authoritative persisted source)
        try {
          const navRes = await getGlobalConfig<NavigationConfigDoc>('navigation_doc').catch(() => null);
          const navDoc = navRes?.value ?? (await loadNavigationDocFromSupabase());
          if (isMounted) {
            if (navDoc) {
              const ver = navRes?.version || navDoc.navigationVersion || 1;
              navVersionRef.current = ver;
              setNavDocVersion(ver);
              setTrackedConfigVersion('navigation_doc', ver);
              applyLoadedNavigationDoc(navDoc);
            } else {
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

        // 2. Load general UI configuration (tables, theme, devices)
        try {
          const uiRes = await getGlobalConfig<any>('ui_configuration').catch(() => null);
          const cloudData = uiRes?.value ?? (await loadUIConfigurationFromSupabase());
          if (cloudData && isMounted && cloudData.config) {
            const ver = uiRes?.version || 1;
            uiVersionRef.current = ver;
            setUiConfigVersion(ver);
            setTrackedConfigVersion('ui_configuration', ver);
            mergeServerUiConfig(cloudData.config);
            if (uiRes?.updatedAt || cloudData.updatedAt) {
              setLastCloudSyncTime(uiRes?.updatedAt || cloudData.updatedAt);
            }
            setCloudSyncStatus('synced');
          }
        } catch (uiErr: any) {
          console.warn('[UIConfig] Could not load ui_configuration:', uiErr?.message || uiErr);
        }

        // 3. Single shared SSE subscription for both navigation_doc and ui_configuration
        if (isMounted) {
          unsubGlobal = subscribeToGlobalConfigUpdates(
            (ev) => {
              if (!isMounted || !ev.value) return;
              if (ev.key === 'navigation_doc') {
                if (typeof ev.version === 'number') {
                  navVersionRef.current = ev.version;
                  setNavDocVersion(ev.version);
                  setTrackedConfigVersion('navigation_doc', ev.version);
                }
                applyLoadedNavigationDoc(ev.value as NavigationConfigDoc);
              } else if (ev.key === 'ui_configuration') {
                if (typeof ev.version === 'number') {
                  uiVersionRef.current = ev.version;
                  setUiConfigVersion(ev.version);
                  setTrackedConfigVersion('ui_configuration', ev.version);
                }
                const nextCfg = ev.value?.config || ev.value;
                if (nextCfg && typeof nextCfg === 'object') {
                  mergeServerUiConfig(nextCfg);
                }
                if (ev.updatedAt) {
                  setLastCloudSyncTime(ev.updatedAt);
                  try {
                    localStorage.setItem('morajaws_ui_cloud_sync_time', ev.updatedAt);
                  } catch {}
                }
                setCloudSyncStatus('synced');
              }
            },
            (err) => {
              console.warn('[UIConfig] Realtime SSE notice:', err?.message || err);
            }
          );
        }
      } finally {
        if (isMounted) {
          setIsCloudSyncing(false);
        }
      }
    }

    void initCloudConfig();

    return () => {
      isMounted = false;
      if (unsubGlobal) unsubGlobal();
    };
  }, [isLoggedIn, currentUser?.id, currentUser?.role]);

  const reloadNavigationFromSupabase = async (): Promise<{ success: boolean; error?: string }> => {
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setLastCloudSyncError(null);
    try {
      const navRes = await getGlobalConfig<NavigationConfigDoc>('navigation_doc').catch(() => null);
      const navDoc = navRes?.value ?? (await loadNavigationDocFromSupabase());
      if (!navDoc) {
        setCloudSyncStatus('local_only');
        return {
          success: false,
          error: 'Belum ada konfigurasi navigasi tersimpan di tabel app_settings Supabase PostgreSQL.'
        };
      }
      if (navRes?.version) {
        navVersionRef.current = navRes.version;
        setNavDocVersion(navRes.version);
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

  // Save Canonical Navigation Configuration to Supabase PostgreSQL (Database-First + OCC)
  const saveNavigationConfig = async (
    operatorName: string = 'Super Admin',
    options?: { forceOverwrite?: boolean }
  ): Promise<{ success: boolean; error?: string; updatedAt?: string }> => {
    if (currentUser?.role !== 'super_admin') {
      const msg = 'Akses Ditolak: Hanya Super Admin yang dapat menyimpan konfigurasi navigasi global.';
      setCloudSyncStatus('error');
      setLastCloudSyncError(msg);
      toast.error(msg, 'Akses Ditolak');
      return { success: false, error: msg };
    }
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
    pendingUiActionRef.current = { type: 'nav_save', operatorName };

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
      const res = await saveGlobalConfig<NavigationConfigDoc>('navigation_doc', docData, {
        module: 'navigation_doc',
        expectedVersion: navVersionRef.current,
        forceOverwrite: Boolean(options?.forceOverwrite),
        description: `Navigation doc updated by ${operatorName}`
      });
      navVersionRef.current = res.version;
      setNavDocVersion(res.version);
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
      setUiConflict(null);
      pendingUiActionRef.current = null;
      try {
        localStorage.setItem('morajaws_ui_cloud_sync_time', res.updatedAt);
      } catch {}
      return { success: true, updatedAt: res.updatedAt };
    } catch (err: any) {
      setCloudSyncStatus('error');
      if (err instanceof ConfigConflictError) {
        setUiConflict(err.conflict);
        setLastCloudSyncError(err.message);
        return { success: false, error: err.message };
      }
      const msg = err?.message || 'Gagal menyimpan konfigurasi navigasi ke database.';
      setLastCloudSyncError(msg);
      return { success: false, error: msg };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const resetNavigationConfig = async (
    operatorName: string = 'Super Admin',
    options?: { forceOverwrite?: boolean }
  ): Promise<{ success: boolean; error?: string }> => {
    if (currentUser?.role !== 'super_admin') {
      const msg = 'Akses Ditolak: Hanya Super Admin yang dapat mereset konfigurasi navigasi global.';
      toast.error(msg, 'Akses Ditolak');
      return { success: false, error: msg };
    }
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setLastCloudSyncError(null);
    pendingUiActionRef.current = { type: 'nav_reset', operatorName };
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
      const res = await saveGlobalConfig<NavigationConfigDoc>('navigation_doc', docData, {
        module: 'navigation_doc',
        expectedVersion: navVersionRef.current,
        forceOverwrite: Boolean(options?.forceOverwrite),
        description: `Navigation doc reset by ${operatorName}`
      });
      // Only mutate React state & localStorage after DB confirms persistence
      navVersionRef.current = res.version;
      setNavDocVersion(res.version);
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
      setUiConflict(null);
      pendingUiActionRef.current = null;
      try {
        localStorage.setItem('morajaws_ui_cloud_sync_time', res.updatedAt);
      } catch {}
      return { success: true };
    } catch (err: any) {
      setCloudSyncStatus('error');
      if (err instanceof ConfigConflictError) {
        setUiConflict(err.conflict);
        setLastCloudSyncError(err.message);
        return { success: false, error: err.message };
      }
      const msg = err?.message || 'Gagal mereset konfigurasi navigasi di database.';
      setLastCloudSyncError(msg);
      return { success: false, error: msg };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // Database-First shared persistence helper for UI Configuration
  const persistUiConfigurationGlobal = async (
    nextConfig: UIConfiguration,
    options?: { operatorName?: string; forceOverwrite?: boolean }
  ): Promise<{ success: boolean; error?: string; updatedAt?: string }> => {
    if (currentUser?.role !== 'super_admin') {
      const msg = 'Akses Ditolak: Hanya Super Admin yang berwenang mengubah konfigurasi UI global.';
      setLastCloudSyncError(msg);
      toast.error(msg, 'Akses Ditolak');
      return { success: false, error: msg };
    }

    const operatorName = options?.operatorName || currentUser?.name || 'Super Admin';
    const stampedConfig: UIConfiguration = {
      ...nextConfig,
      updatedAt: new Date().toISOString()
    };

    pendingUiActionRef.current = { type: 'ui', nextConfig: stampedConfig, operatorName };
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    setLastCloudSyncError(null);

    try {
      const res = await saveGlobalConfig<any>(
        'ui_configuration',
        {
          config: stampedConfig,
          navigationItems,
          menuCategories,
          updatedBy: operatorName,
          updatedAt: stampedConfig.updatedAt
        },
        {
          module: 'ui_configuration',
          expectedVersion: uiVersionRef.current,
          forceOverwrite: Boolean(options?.forceOverwrite),
          description: `UI configuration updated by ${operatorName}`
        }
      );

      uiVersionRef.current = res.version;
      setUiConfigVersion(res.version);
      const confirmedCfg = res.value?.config || stampedConfig;
      setConfig(confirmedCfg);
      setDraftConfig(null);
      setLastCloudSyncTime(res.updatedAt);
      setLastCloudSyncError(null);
      setCloudSyncStatus('synced');
      setUiConflict(null);
      pendingUiActionRef.current = null;
      try {
        localStorage.setItem('morajaws_ui_cloud_sync_time', res.updatedAt);
      } catch {}
      return { success: true, updatedAt: res.updatedAt };
    } catch (err: any) {
      setCloudSyncStatus('error');
      if (err instanceof ConfigConflictError) {
        setUiConflict(err.conflict);
        setLastCloudSyncError(err.message);
        toast.warning(err.message, 'Konflik Versi Konfigurasi UI');
        return { success: false, error: err.message };
      }
      const msg = err?.message || 'Gagal menyimpan konfigurasi UI ke database.';
      setLastCloudSyncError(msg);
      toast.error(msg, 'Gagal Menyimpan');
      return { success: false, error: msg };
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const saveConfigToSupabase = async (
    operatorName?: string,
    options?: { forceOverwrite?: boolean }
  ): Promise<{ success: boolean; error?: string; updatedAt?: string }> => {
    const activeCfg = draftConfig || config;
    return persistUiConfigurationGlobal(activeCfg, {
      operatorName: operatorName || currentUser?.name || 'Super Admin',
      forceOverwrite: options?.forceOverwrite
    });
  };

  const loadConfigFromSupabase = async (): Promise<{ success: boolean; error?: string }> => {
    setIsCloudSyncing(true);
    setCloudSyncStatus('syncing');
    try {
      const uiRes = await getGlobalConfig<any>('ui_configuration').catch(() => null);
      const cloudData = uiRes?.value ?? (await loadUIConfigurationFromSupabase());
      if (!cloudData) {
        setCloudSyncStatus('local_only');
        return { success: false, error: 'Belum ada data konfigurasi tersimpan di Supabase PostgreSQL.' };
      }
      if (uiRes?.version) {
        uiVersionRef.current = uiRes.version;
        setUiConfigVersion(uiRes.version);
      }
      if (cloudData.config) {
        mergeServerUiConfig(cloudData.config);
      }
      setDraftConfig(null);
      if (uiRes?.updatedAt || cloudData.updatedAt) {
        const ts = uiRes?.updatedAt || cloudData.updatedAt;
        setLastCloudSyncTime(ts);
        try {
          localStorage.setItem('morajaws_ui_cloud_sync_time', ts);
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

  const saveDraft = async (): Promise<{ success: boolean; error?: string }> => {
    if (!draftConfig) return { success: true };
    const finalized: UIConfiguration = {
      ...draftConfig,
      version: (draftConfig.version || 1) + 1,
      updatedAt: new Date().toISOString()
    };
    return persistUiConfigurationGlobal(finalized);
  };

  const cancelDraft = () => {
    setDraftConfig(null);
  };

  const resetToDefaults = async (): Promise<{ success: boolean; error?: string }> => {
    const res = await persistUiConfigurationGlobal(DEFAULT_UI_CONFIG);
    if (res.success) {
      setDraftConfig(null);
    }
    return res;
  };

  const setGlobalTheme = async (updates: Partial<UIConfiguration['global']>) => {
    const nextConfig: UIConfiguration = {
      ...config,
      global: { ...config.global, ...updates },
      updatedAt: new Date().toISOString()
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  // Personal sidebar viewport collapse state (never mutates global DB config)
  const setSidebarState = (state: 'expanded' | 'minimized' | 'closed') => {
    setConfig(prev => ({
      ...prev,
      global: {
        ...prev.global,
        sidebarState: state,
        sidebarCollapsed: state === 'minimized'
      }
    }));
  };

  const setColumnVisibility = async (columnKey: string, visible: boolean) => {
    const nextConfig: UIConfiguration = {
      ...config,
      ticketsTable: {
        ...config.ticketsTable,
        columns: config.ticketsTable.columns.map(col =>
          col.key === columnKey ? { ...col, visible } : col
        )
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const setColumnOrder = async (sourceIndex: number, destinationIndex: number) => {
    const cols = [...config.ticketsTable.columns];
    const [moved] = cols.splice(sourceIndex, 1);
    cols.splice(destinationIndex, 0, moved);
    const reordered = cols.map((col, idx) => ({ ...col, order: idx + 1 }));
    const nextConfig: UIConfiguration = {
      ...config,
      ticketsTable: {
        ...config.ticketsTable,
        columns: reordered
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const updateColumnConfig = async (columnKey: string, updates: Partial<ColumnConfig>) => {
    const nextConfig: UIConfiguration = {
      ...config,
      ticketsTable: {
        ...config.ticketsTable,
        columns: config.ticketsTable.columns.map(col =>
          col.key === columnKey ? { ...col, ...updates } : col
        )
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const applyPreset = async (presetId: string) => {
    const preset = config.ticketsTable.presets.find(p => p.id === presetId);
    if (!preset) return { success: false, error: 'Preset tidak ditemukan.' };
    const nextConfig: UIConfiguration = {
      ...config,
      ticketsTable: {
        ...config.ticketsTable,
        activePresetId: presetId,
        columns: mergeCanonicalColumns(preset.columns),
        density: preset.density,
        rowsPerPage: preset.rowsPerPage
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const saveCurrentAsPreset = async (name: string, description: string) => {
    const base = draftConfig || config;
    const newPreset: TablePreset = {
      id: 'preset_custom_' + Date.now(),
      name,
      description,
      columns: base.ticketsTable.columns,
      density: base.ticketsTable.density,
      rowsPerPage: base.ticketsTable.rowsPerPage
    };
    const nextConfig: UIConfiguration = {
      ...base,
      ticketsTable: {
        ...base.ticketsTable,
        presets: [...base.ticketsTable.presets, newPreset],
        activePresetId: newPreset.id
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const deletePreset = async (presetId: string) => {
    const nextConfig: UIConfiguration = {
      ...config,
      ticketsTable: {
        ...config.ticketsTable,
        presets: config.ticketsTable.presets.filter(p => p.id !== presetId)
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const updateToolbarButton = async (buttonId: string, updates: Partial<ToolbarButtonConfig>) => {
    const nextConfig: UIConfiguration = {
      ...config,
      toolbar: {
        ...config.toolbar,
        buttons: config.toolbar.buttons.map(btn =>
          btn.id === buttonId ? { ...btn, ...updates } : btn
        )
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const toggleToolbarOption = async (key: keyof UIConfiguration['toolbar'], value: boolean) => {
    const nextConfig: UIConfiguration = {
      ...config,
      toolbar: {
        ...config.toolbar,
        [key]: value
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const toggleDetailSection = async (sectionId: string, visible: boolean) => {
    const nextConfig: UIConfiguration = {
      ...config,
      ticketDetail: {
        ...config.ticketDetail,
        sections: config.ticketDetail.sections.map(sec =>
          sec.id === sectionId ? { ...sec, visible } : sec
        )
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const reorderDetailSections = async (sourceIndex: number, destinationIndex: number) => {
    const sections = [...config.ticketDetail.sections];
    const [moved] = sections.splice(sourceIndex, 1);
    sections.splice(destinationIndex, 0, moved);
    const reordered = sections.map((sec, idx) => ({ ...sec, order: idx + 1 }));
    const nextConfig: UIConfiguration = {
      ...config,
      ticketDetail: {
        ...config.ticketDetail,
        sections: reordered
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const updateDetailField = async (sectionId: string, fieldKey: string, updates: any) => {
    const nextConfig: UIConfiguration = {
      ...config,
      ticketDetail: {
        ...config.ticketDetail,
        sections: config.ticketDetail.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          return {
            ...sec,
            fields: sec.fields.map(f => (f.key === fieldKey ? { ...f, ...updates } : f))
          };
        })
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const setShowEmptyFields = async (show: boolean) => {
    const nextConfig: UIConfiguration = {
      ...config,
      ticketDetail: {
        ...config.ticketDetail,
        showEmptyFields: show
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  // =========================================================================
  // CENTRALIZED PERSONAL DISPLAY MODE (ISOLATED PER USER + ROLE)
  // =========================================================================
  const isInstallerRole = Boolean(isLoggedIn && currentUser?.role === 'installer');
  const canSwitchDisplayMode = Boolean(isLoggedIn && currentUser?.role && currentUser.role !== 'installer');

  const [displayModeState, setDisplayModeState] = useState<DisplayMode>(() =>
    resolveDisplayModeForUser(currentUser, isLoggedIn, windowWidth)
  );

  const prevIdentityRef = useRef<string>('');

  // Re-evaluate display mode whenever authenticated user or role changes
  useEffect(() => {
    const resolved = resolveDisplayModeForUser(currentUser, isLoggedIn, windowWidth);
    setDisplayModeState(resolved);

    const identity = isLoggedIn ? `${currentUser?.id || currentUser?.username || 'anon'}:${currentUser?.role || ''}` : 'logged_out';
    if (prevIdentityRef.current !== identity) {
      prevIdentityRef.current = identity;
      if (isLoggedIn) {
        const nextSidebarState = resolved === 'mobile' || windowWidth < 1024 ? 'closed' : 'expanded';
        setConfig(prev => ({
          ...prev,
          global: {
            ...prev.global,
            sidebarState: nextSidebarState,
            sidebarCollapsed: nextSidebarState !== 'expanded'
          }
        }));
      }
    }
  }, [isLoggedIn, currentUser?.id, currentUser?.username, currentUser?.role]);

  // Auto-adapt sidebar drawer state when crossing 1024px desktop/tablet threshold
  const prevIsCompactViewportRef = useRef<boolean>(windowWidth < 1024);
  useEffect(() => {
    const isNowCompact = windowWidth < 1024;
    if (prevIsCompactViewportRef.current !== isNowCompact) {
      prevIsCompactViewportRef.current = isNowCompact;
      if (isLoggedIn && currentUser?.role !== 'installer') {
        setSidebarState(isNowCompact || displayModeState === 'mobile' ? 'closed' : 'expanded');
      }
    }
  }, [windowWidth, isLoggedIn, currentUser?.role, displayModeState]);

  // Guard against manual localStorage tampering (cross-tab & focus re-validation)
  useEffect(() => {
    const enforceScopedDisplayMode = () => {
      const resolved = resolveDisplayModeForUser(currentUser, isLoggedIn, windowWidth);
      setDisplayModeState(resolved);
    };
    const handleStorage = (e: StorageEvent) => {
      const scopedKey = getScopedDisplayModeKey(currentUser);
      if (!e.key || e.key === scopedKey || e.key.startsWith(DISPLAY_MODE_STORAGE_PREFIX)) {
        enforceScopedDisplayMode();
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', enforceScopedDisplayMode);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', enforceScopedDisplayMode);
    };
  }, [isLoggedIn, currentUser?.id, currentUser?.username, currentUser?.role, windowWidth]);

  // Derived Display Mode: Hard-locked to 'mobile' for TEKNISI (installer) regardless of any client storage
  // Defaults to 'mobile' on <768px viewports unless the user explicitly switches to 'desktop'
  const displayMode: DisplayMode = isInstallerRole ? 'mobile' : displayModeState;
  const isMobileView = displayMode === 'mobile';

  // Sync HTML root dataset attribute for styling & verification hooks
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.displayMode = displayMode;
    }
  }, [displayMode]);

  const setDisplayMode = (mode: DisplayMode) => {
    if (!isLoggedIn || !currentUser?.role || currentUser.role === 'installer') {
      // Strictly reject Desktop Mode for TEKNISI / unauthenticated state
      const key = getScopedDisplayModeKey(currentUser);
      if (key && currentUser?.role === 'installer') {
        try {
          window.localStorage.setItem(key, 'mobile');
        } catch {}
      }
      setDisplayModeState('mobile');
      return;
    }

    const validMode: DisplayMode = mode === 'mobile' ? 'mobile' : 'desktop';
    const scopedKey = getScopedDisplayModeKey(currentUser);
    if (scopedKey) {
      try {
        window.localStorage.setItem(scopedKey, validMode);
      } catch {}
    }
    setDisplayModeState(validMode);
    setSidebarState(validMode === 'mobile' || windowWidth < 1024 ? 'closed' : 'expanded');
  };

  const setDeviceMode = async (mode: 'auto' | 'pc' | 'android') => {
    const nextConfig: UIConfiguration = {
      ...config,
      device: {
        ...config.device,
        mode
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const updateAndroidSettings = async (updates: Partial<UIConfiguration['device']['android']>) => {
    const nextConfig: UIConfiguration = {
      ...config,
      device: {
        ...config.device,
        android: {
          ...config.device.android,
          ...updates
        }
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const updatePCSettings = async (updates: Partial<UIConfiguration['device']['pc']>) => {
    const nextConfig: UIConfiguration = {
      ...config,
      device: {
        ...config.device,
        pc: {
          ...config.device.pc,
          ...updates
        }
      }
    };
    return persistUiConfigurationGlobal(nextConfig);
  };

  const applyDevicePreset = async (preset: 'comfortable_android' | 'high_productivity_pc' | 'auto') => {
    let nextConfig: UIConfiguration;
    if (preset === 'comfortable_android') {
      nextConfig = {
        ...config,
        global: {
          ...config.global,
          contentWidth: 'full',
          density: 'comfortable',
          sidebarState: 'closed',
          sidebarCollapsed: true
        },
        device: {
          ...config.device,
          mode: 'android',
          android: {
            ...config.device.android,
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
          ...config.ticketsTable,
          rowsPerPage: 10,
          density: 'comfortable'
        }
      };
    } else if (preset === 'high_productivity_pc') {
      nextConfig = {
        ...config,
        global: {
          ...config.global,
          contentWidth: 'full',
          density: 'compact',
          sidebarState: 'expanded',
          sidebarCollapsed: false
        },
        device: {
          ...config.device,
          mode: 'pc',
          pc: {
            ...config.device.pc,
            tableDensity: 'compact',
            stickyColumns: true,
            wideScreenFullWidth: true,
            showInlineFilters: true,
            showBulkToolbar: true,
            multiColumnDetail: true
          }
        },
        ticketsTable: {
          ...config.ticketsTable,
          rowsPerPage: 20,
          density: 'compact'
        }
      };
    } else {
      nextConfig = {
        ...config,
        device: {
          ...config.device,
          mode: 'auto'
        }
      };
    }
    return persistUiConfigurationGlobal(nextConfig);
  };

  const exportConfigJson = () => {
    return JSON.stringify(config, null, 2);
  };

  const importConfigJson = async (jsonString: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.global && parsed.ticketsTable) {
        const nextConfig: UIConfiguration = {
          ...DEFAULT_UI_CONFIG,
          ...parsed,
          version: (parsed.version || 1) + 1,
          updatedAt: new Date().toISOString()
        };
        return persistUiConfigurationGlobal(nextConfig);
      }
      return { success: false, error: 'Struktur JSON konfigurasi UI tidak valid.' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Format JSON konfigurasi tidak valid.' };
    }
  };

  const clearUiConflict = () => {
    setUiConflict(null);
    pendingUiActionRef.current = null;
  };

  const resolveUiConflict = async (strategy: 'reload' | 'overwrite') => {
    const pending = pendingUiActionRef.current;
    if (strategy === 'reload') {
      if (pending?.type === 'nav_save' || pending?.type === 'nav_reset') {
        await reloadNavigationFromSupabase();
      } else {
        await loadConfigFromSupabase();
      }
      setUiConflict(null);
      pendingUiActionRef.current = null;
      return;
    }

    if (pending?.type === 'nav_save') {
      await saveNavigationConfig(pending.operatorName, { forceOverwrite: true });
    } else if (pending?.type === 'nav_reset') {
      await resetNavigationConfig(pending.operatorName, { forceOverwrite: true });
    } else if (pending?.type === 'ui') {
      await persistUiConfigurationGlobal(pending.nextConfig, {
        operatorName: pending.operatorName,
        forceOverwrite: true
      });
    } else {
      setUiConflict(null);
    }
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
        displayMode,
        canSwitchDisplayMode,
        setDisplayMode,
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
        cloudSyncStatus,
        uiConfigVersion,
        navDocVersion,
        uiConflict,
        clearUiConflict,
        resolveUiConflict
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
