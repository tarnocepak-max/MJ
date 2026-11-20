import {
  NavigationConfig,
  NavigationCategory,
  NavigationStandaloneMenu,
  NavigationSubmenuItem
} from '../types/navigation';
import { DEFAULT_NAVIGATION_CONFIG } from '../constants/defaultNavigationConfig';
import { supabaseDb, formatSupabaseErrorMessage } from './supabaseDb';

const NAV_SETTING_KEY = 'navigation_config';

/**
 * Normalize navigation configuration to handle legacy aliases and missing defaults.
 */
export function normalizeNavigationConfig(raw: any): NavigationConfig {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_NAVIGATION_CONFIG;
  }

  const rawCategories = Array.isArray(raw.categories) ? raw.categories : DEFAULT_NAVIGATION_CONFIG.categories;
  const categories: NavigationCategory[] = rawCategories.map((c: any, idx: number) => ({
    id: c.id || `cat_${idx + 1}`,
    name: c.name || c.title || `Kategori ${idx + 1}`,
    icon: c.icon || 'FolderTree',
    order: typeof c.order === 'number' ? c.order : idx + 1,
    visible: c.visible !== undefined ? Boolean(c.visible) : c.active !== undefined ? Boolean(c.active) : true,
    mode: c.mode || (c.isAccordion === false ? 'static' : 'accordion'),
    allowMultipleOpen: c.allowMultipleOpen !== undefined ? Boolean(c.allowMultipleOpen) : true
  }));

  const rawStandalone = Array.isArray(raw.standaloneMenus) ? raw.standaloneMenus : DEFAULT_NAVIGATION_CONFIG.standaloneMenus;
  const standaloneMenus: NavigationStandaloneMenu[] = rawStandalone.map((m: any, idx: number) => ({
    id: m.id,
    name: m.name || m.label || m.id,
    icon: m.icon || 'LayoutDashboard',
    order: typeof m.order === 'number' ? m.order : idx + 1,
    visible: m.visible !== undefined ? Boolean(m.visible) : m.active !== undefined ? Boolean(m.active) : true,
    roles: Array.isArray(m.roles) ? m.roles : undefined,
    badgeKey: m.badgeKey,
    badgeColor: m.badgeColor
  }));

  if (!standaloneMenus.some(m => m.id === 'overdue_wo')) {
    const ticketsMenu = standaloneMenus.find(m => m.id === 'tickets');
    const overdueDefault = DEFAULT_NAVIGATION_CONFIG.standaloneMenus.find(m => m.id === 'overdue_wo');
    if (overdueDefault) {
      standaloneMenus.push({
        ...overdueDefault,
        order: ticketsMenu ? Number(ticketsMenu.order || 2) + 0.5 : 2.5
      });
    }
  }

  const rawSubmenus = Array.isArray(raw.submenuItems) ? raw.submenuItems : DEFAULT_NAVIGATION_CONFIG.submenuItems;
  const submenuItems: NavigationSubmenuItem[] = rawSubmenus.map((s: any, idx: number) => ({
    id: s.id,
    name: s.name || s.label || s.id,
    icon: s.icon || 'FileSpreadsheet',
    categoryId: s.categoryId || s.parentCategoryId || 'cat_tambahan',
    order: typeof s.order === 'number' ? s.order : idx + 1,
    visible: s.visible !== undefined ? Boolean(s.visible) : s.active !== undefined ? Boolean(s.active) : true,
    roles: Array.isArray(s.roles) ? s.roles : undefined,
    badgeKey: s.badgeKey,
    badgeColor: s.badgeColor,
    highlight: Boolean(s.highlight)
  }));

  const accordionSettings = {
    allowMultipleOpen:
      raw.accordionSettings?.allowMultipleOpen ??
      raw.accordionSettings?.allowMultipleOpenGroups ??
      true,
    defaultExpandedCategoryIds: Array.isArray(raw.accordionSettings?.defaultExpandedCategoryIds)
      ? raw.accordionSettings.defaultExpandedCategoryIds
      : DEFAULT_NAVIGATION_CONFIG.accordionSettings.defaultExpandedCategoryIds,
    smoothAnimation: raw.accordionSettings?.smoothAnimation ?? true
  };

  return {
    categories,
    standaloneMenus,
    submenuItems,
    accordionSettings,
    navigationVersion: typeof raw.navigationVersion === 'number' ? raw.navigationVersion : 2,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    updatedBy: raw.updatedBy || 'System'
  };
}

/**
 * Load navigation configuration from Supabase PostgreSQL via Express backend proxy.
 */
export async function loadNavigationConfigFromSupabase(): Promise<NavigationConfig | null> {
  const res = await supabaseDb.getAppSetting(NAV_SETTING_KEY);
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal memuat konfigurasi navigasi dari Supabase PostgreSQL.'));
  }
  const raw = res.data?.value ?? res.data;
  if (raw === null || raw === undefined) {
    return null;
  }
  return normalizeNavigationConfig(raw);
}

/**
 * Save navigation configuration to Supabase PostgreSQL via Express backend proxy.
 */
export async function saveNavigationConfigToSupabase(
  config: NavigationConfig,
  operatorName: string = 'Super Admin'
): Promise<{ success: boolean; updatedAt: string; error?: string }> {
  const updatedAt = new Date().toISOString();
  const payload: NavigationConfig = {
    ...config,
    navigationVersion: (config.navigationVersion || 1) + 1,
    updatedAt,
    updatedBy: operatorName
  };

  const res = await supabaseDb.saveAppSetting(
    NAV_SETTING_KEY,
    payload,
    `MoraJaws navigation configuration updated by ${operatorName}`
  );

  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menyimpan konfigurasi navigasi ke Supabase PostgreSQL.'));
  }

  return { success: true, updatedAt: res.updatedAt || updatedAt };
}

/**
 * Subscribe to real-time navigation configuration updates via Express SSE.
 */
export function subscribeToNavigationConfig(
  onUpdate: (config: NavigationConfig) => void,
  onError?: (error: Error) => void
): () => void {
  return supabaseDb.subscribeToChanges({
    table: 'app_settings',
    onPayload: (payload) => {
      try {
        const key = payload?.record?.key ?? payload?.key ?? payload?.new?.setting_key;
        const val = payload?.record?.value ?? payload?.value ?? payload?.new?.setting_value;
        if (key === NAV_SETTING_KEY && val) {
          onUpdate(normalizeNavigationConfig(val));
        }
      } catch (err: any) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    onError: (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
