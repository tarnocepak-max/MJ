import {
  UIConfiguration,
  NavigationConfigDoc,
  ReportDropdownCategory,
  ChatCategoryConfig,
  HierarchicalStatus,
  DroplistItem
} from '../types';
import { supabaseDb, formatSupabaseErrorMessage } from './supabaseDb';

function extractAppSettingEvent(payload: any): { key?: string; value?: any } {
  const key = payload?.record?.key ?? payload?.key ?? payload?.new?.setting_key;
  const value = payload?.record?.value ?? payload?.value ?? payload?.new?.setting_value;
  return { key, value };
}

// Canonical setting keys in Supabase PostgreSQL `public.app_settings`
export const SETTING_KEYS = {
  UI_CONFIGURATION: 'ui_configuration',
  NAVIGATION_DOC: 'navigation_doc',
  GLOBAL_APP_SETTINGS: 'global_app_settings',
  HIERARCHICAL_DROPLISTS: 'hierarchical_droplists',
  GENERAL_DROPLISTS: 'general_droplists',
  REPORT_DROPDOWN_CATEGORIES: 'report_dropdown_categories',
  CHAT_CATEGORIES: 'chat_categories'
} as const;

export interface CloudUIConfigurationPayload {
  config: UIConfiguration;
  navigationItems?: any[];
  menuCategories?: string[];
  updatedBy: string;
  updatedAt?: string;
}

// =============================================================================
// CANONICAL SEED ARRAYS (Preserved from MoraJaws Production Schema)
// =============================================================================

export const INITIAL_CHAT_CATEGORIES: ChatCategoryConfig[] = [
  {
    id: 'cat-progress',
    name: 'PROGRESS',
    description: 'Update progress pengerjaan teknisi di lapangan',
    color: '#7C3AED',
    order: 1,
    active: true,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'cat-complaint',
    name: 'COMPLAINT',
    description: 'Keluhan pelanggan, gangguan redaman, atau komplain instalasi',
    color: '#EF4444',
    order: 2,
    active: true,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'cat-followup',
    name: 'FOLLOW UP',
    description: 'Tindak lanjut progress pengerjaan atau konfirmasi status',
    color: '#3B82F6',
    order: 3,
    active: true,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'cat-techsupport',
    name: 'TECHNICAL SUPPORT',
    description: 'Dukungan teknis OPM, konfigurasi OLT, dan kendala kabel',
    color: '#F59E0B',
    order: 4,
    active: true,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'cat-schedule',
    name: 'SCHEDULE / APPOINTMENT',
    description: 'Jadwal kunjungan, perubahan slot, dan waktu temu',
    color: '#8B5CF6',
    order: 5,
    active: true,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'cat-confirmation',
    name: 'CUSTOMER CONFIRMATION',
    description: 'Konfirmasi pelanggan via WhatsApp atau telepon',
    color: '#10B981',
    order: 6,
    active: true,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'cat-escalation',
    name: 'ESCALATION',
    description: 'Eskalasi kendala mendesak ke Supervisor / Management',
    color: '#EC4899',
    order: 7,
    active: true,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'cat-unclassified',
    name: 'UNCLASSIFIED',
    description: 'Pesan koordinasi umum',
    color: '#64748B',
    order: 8,
    active: true,
    createdAt: '2026-01-01T00:00:00Z'
  }
];

import { INITIAL_HIERARCHICAL_DROPLISTS } from '../constants/hierarchicalDroplists';
export { INITIAL_HIERARCHICAL_DROPLISTS };

function flattenHierarchicalToReportDropdowns(statuses: HierarchicalStatus[]): ReportDropdownCategory[] {
  const now = '2026-11-01T13:43:31.468Z';
  const items: ReportDropdownCategory[] = [];
  for (const s of statuses) {
    items.push({
      id: s.id,
      categoryType: 'report_status',
      name: s.name,
      isActive: s.active !== false && s.isActive !== false,
      sortOrder: s.order,
      createdAt: now
    });
    for (const r of s.reasons || []) {
      items.push({
        id: r.id,
        categoryType: 'reason_report',
        name: r.name,
        isActive: r.active !== false && r.isActive !== false,
        sortOrder: r.order,
        createdAt: now
      });
      for (const rm of r.remarks || []) {
        items.push({
          id: rm.id,
          categoryType: 'rootcause',
          name: rm.name || rm.text || '',
          isActive: rm.active !== false && rm.isActive !== false,
          sortOrder: rm.order,
          createdAt: now
        });
      }
    }
  }
  return items;
}

export const INITIAL_REPORT_DROPDOWN_CATEGORIES: ReportDropdownCategory[] =
  flattenHierarchicalToReportDropdowns(INITIAL_HIERARCHICAL_DROPLISTS);

/**
 * Reconciles flat legacy ReportDropdownCategory items into the 3-level HierarchicalStatus tree.
 */
export function reconcileDroplistData(
  currentHierarchy: HierarchicalStatus[],
  legacyCategories: ReportDropdownCategory[]
): { reconciled: HierarchicalStatus[]; changedCount: number } {
  const reconciled: HierarchicalStatus[] = JSON.parse(JSON.stringify(currentHierarchy || []));
  let changedCount = 0;

  if (!Array.isArray(legacyCategories) || legacyCategories.length === 0) {
    return { reconciled, changedCount };
  }

  for (const cat of legacyCategories) {
    if (cat.isDeleted) continue;
    const normName = (cat.name || '').trim().toLowerCase();
    if (!normName) continue;

    if (cat.categoryType === 'report_status') {
      const exists = reconciled.some(
        s => s.id === cat.id || s.name.trim().toLowerCase() === normName
      );
      if (!exists) {
        reconciled.push({
          id: cat.id || `hs-${Date.now()}-${changedCount}`,
          name: cat.name.trim(),
          code: cat.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
          order: reconciled.length + 1,
          active: cat.isActive !== false,
          isActive: cat.isActive !== false,
          color: '#7C3AED',
          reasons: []
        });
        changedCount++;
      }
    } else if (cat.categoryType === 'reason_report') {
      const exists = reconciled.some(s =>
        (s.reasons || []).some(r => r.id === cat.id || r.name.trim().toLowerCase() === normName)
      );
      if (!exists && reconciled.length > 0) {
        const targetStatus = reconciled[0];
        targetStatus.reasons = targetStatus.reasons || [];
        targetStatus.reasons.push({
          id: cat.id || `hr-${Date.now()}-${changedCount}`,
          statusId: targetStatus.id,
          name: cat.name.trim(),
          order: targetStatus.reasons.length + 1,
          active: cat.isActive !== false,
          isActive: cat.isActive !== false,
          remarks: []
        });
        changedCount++;
      }
    } else if (cat.categoryType === 'rootcause') {
      const exists = reconciled.some(s =>
        (s.reasons || []).some(r =>
          (r.remarks || []).some(rm => rm.id === cat.id || (rm.name || rm.text || '').trim().toLowerCase() === normName)
        )
      );
      if (!exists && reconciled.length > 0 && reconciled[0].reasons.length > 0) {
        const targetReason = reconciled[0].reasons[0];
        targetReason.remarks = targetReason.remarks || [];
        targetReason.remarks.push({
          id: cat.id || `hrm-${Date.now()}-${changedCount}`,
          reasonId: targetReason.id,
          name: cat.name.trim(),
          text: cat.name.trim(),
          order: targetReason.remarks.length + 1,
          active: cat.isActive !== false,
          isActive: cat.isActive !== false
        });
        changedCount++;
      }
    }
  }

  return { reconciled, changedCount };
}

// =============================================================================
// SUPABASE BACKEND PROXY SETTINGS & CONFIGURATION WRAPPERS
// =============================================================================

export async function saveUIConfigurationToSupabase(
  payload: CloudUIConfigurationPayload
): Promise<{ success: boolean; updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const dataToSave: CloudUIConfigurationPayload = {
    ...payload,
    updatedAt
  };
  const res = await supabaseDb.saveAppSetting(
    SETTING_KEYS.UI_CONFIGURATION,
    dataToSave,
    `UI configuration updated by ${payload.updatedBy || 'Super Admin'}`
  );
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menyimpan konfigurasi UI ke Supabase PostgreSQL.'));
  }
  return { success: true, updatedAt: res.updatedAt || updatedAt };
}

export async function loadUIConfigurationFromSupabase(): Promise<CloudUIConfigurationPayload | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.UI_CONFIGURATION);
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal memuat konfigurasi UI dari Supabase PostgreSQL.'));
  }
  if (!res.data) return null;
  return res.data as CloudUIConfigurationPayload;
}

export function subscribeToUIConfiguration(
  onUpdate: (data: CloudUIConfigurationPayload) => void,
  onError?: (err: Error) => void
): () => void {
  return supabaseDb.subscribeToChanges({
    table: 'app_settings',
    onPayload: (payload) => {
      try {
        const { key, value: val } = extractAppSettingEvent(payload);
        if (key === SETTING_KEYS.UI_CONFIGURATION && val) {
          onUpdate(val as CloudUIConfigurationPayload);
        }
      } catch (err: any) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    onError: (err) => onError?.(err instanceof Error ? err : new Error(String(err)))
  });
}

export async function saveNavigationDocToSupabase(
  docData: NavigationConfigDoc
): Promise<{ success: boolean; updatedAt: string }> {
  const updatedAt = docData.updatedAt || new Date().toISOString();
  const res = await supabaseDb.saveAppSetting(
    SETTING_KEYS.NAVIGATION_DOC,
    { ...docData, updatedAt },
    `Navigation doc updated by ${docData.updatedBy || 'Super Admin'}`
  );
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menyimpan konfigurasi navigasi ke Supabase PostgreSQL.'));
  }
  return { success: true, updatedAt: res.updatedAt || updatedAt };
}

export async function loadNavigationDocFromSupabase(): Promise<NavigationConfigDoc | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.NAVIGATION_DOC);
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal memuat konfigurasi navigasi dari Supabase PostgreSQL.'));
  }
  if (!res.data) return null;
  return res.data as NavigationConfigDoc;
}

export function subscribeToNavigationDoc(
  onUpdate: (doc: NavigationConfigDoc) => void,
  onError?: (err: Error) => void
): () => void {
  return supabaseDb.subscribeToChanges({
    table: 'app_settings',
    onPayload: (payload) => {
      try {
        const { key, value: val } = extractAppSettingEvent(payload);
        if (key === SETTING_KEYS.NAVIGATION_DOC && val) {
          onUpdate(val as NavigationConfigDoc);
        }
      } catch (err: any) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    onError: (err) => onError?.(err instanceof Error ? err : new Error(String(err)))
  });
}

export async function saveGlobalAppSettingsToSupabase(settings: Record<string, any>): Promise<boolean> {
  const existingRes = await supabaseDb.getAppSetting(SETTING_KEYS.GLOBAL_APP_SETTINGS);
  const current = (existingRes.success && existingRes.data && typeof existingRes.data === 'object') ? existingRes.data : {};
  const merged = { ...current, ...settings, updatedAt: new Date().toISOString() };
  const res = await supabaseDb.saveAppSetting(SETTING_KEYS.GLOBAL_APP_SETTINGS, merged, 'Global application settings');
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menyimpan pengaturan global ke Supabase PostgreSQL.'));
  }
  return true;
}

export async function loadGlobalAppSettingsFromSupabase(): Promise<Record<string, any> | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.GLOBAL_APP_SETTINGS);
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal memuat pengaturan global dari Supabase PostgreSQL.'));
  }
  return res.data || null;
}

export async function saveHierarchicalDroplistsToSupabase(
  statuses: HierarchicalStatus[],
  updatedBy: string = 'Droplist Management'
): Promise<boolean> {
  const payload = {
    statuses,
    updatedAt: new Date().toISOString(),
    updatedBy
  };
  const res = await supabaseDb.saveAppSetting(
    SETTING_KEYS.HIERARCHICAL_DROPLISTS,
    payload,
    '3-Level Hierarchical WO Droplist Configuration'
  );
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menyimpan hierarchical droplists ke Supabase PostgreSQL.'));
  }
  return true;
}

export async function loadHierarchicalDroplistsFromSupabase(): Promise<HierarchicalStatus[] | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.HIERARCHICAL_DROPLISTS);
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal memuat hierarchical droplists dari Supabase PostgreSQL.'));
  }
  if (!res.data) return null;
  if (Array.isArray(res.data)) return res.data as HierarchicalStatus[];
  if (Array.isArray(res.data.statuses)) return res.data.statuses as HierarchicalStatus[];
  return null;
}

export async function saveGeneralDroplistsToSupabase(items: DroplistItem[]): Promise<boolean> {
  const res = await supabaseDb.saveAppSetting(
    SETTING_KEYS.GENERAL_DROPLISTS,
    { items, updatedAt: new Date().toISOString() },
    'General static droplist items'
  );
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menyimpan droplist statis ke Supabase PostgreSQL.'));
  }
  return true;
}

export function subscribeToGeneralDroplists(
  onUpdate: (items: DroplistItem[]) => void,
  onError?: (err: Error) => void
): () => void {
  // Initial load
  supabaseDb.getAppSetting(SETTING_KEYS.GENERAL_DROPLISTS)
    .then((res) => {
      if (res.success && res.data) {
        const items = Array.isArray(res.data) ? res.data : res.data.items;
        if (Array.isArray(items)) onUpdate(items);
      }
    })
    .catch((err) => onError?.(err instanceof Error ? err : new Error(String(err))));

  // Real-time SSE updates
  return supabaseDb.subscribeToChanges({
    table: 'app_settings',
    onPayload: (payload) => {
      try {
        const { key, value: val } = extractAppSettingEvent(payload);
        if (key === SETTING_KEYS.GENERAL_DROPLISTS && val) {
          const items = Array.isArray(val) ? val : val.items;
          if (Array.isArray(items)) onUpdate(items);
        }
      } catch (err: any) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    onError: (err) => onError?.(err instanceof Error ? err : new Error(String(err)))
  });
}

export async function saveChatCategoriesToSupabase(categories: ChatCategoryConfig[]): Promise<boolean> {
  const res = await supabaseDb.saveAppSetting(
    SETTING_KEYS.CHAT_CATEGORIES,
    { categories, updatedAt: new Date().toISOString() },
    'Contact Center chat categories'
  );
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menyimpan kategori chat ke Supabase PostgreSQL.'));
  }
  return true;
}

export async function loadChatCategoriesFromSupabase(): Promise<ChatCategoryConfig[] | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.CHAT_CATEGORIES);
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal memuat kategori chat dari Supabase PostgreSQL.'));
  }
  if (!res.data) return null;
  if (Array.isArray(res.data)) return res.data as ChatCategoryConfig[];
  if (Array.isArray(res.data.categories)) return res.data.categories as ChatCategoryConfig[];
  return null;
}

export async function loadReportDropdownCategoriesFromSupabase(): Promise<ReportDropdownCategory[] | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.REPORT_DROPDOWN_CATEGORIES);
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal memuat kategori dropdown report dari Supabase PostgreSQL.'));
  }
  if (!res.data) return null;
  if (Array.isArray(res.data)) return res.data as ReportDropdownCategory[];
  if (Array.isArray(res.data.categories)) return res.data.categories as ReportDropdownCategory[];
  return null;
}

export async function saveReportDropdownCategoryToSupabase(
  category: ReportDropdownCategory,
  allCategories?: ReportDropdownCategory[]
): Promise<boolean> {
  let list = allCategories;
  if (!list) {
    list = (await loadReportDropdownCategoriesFromSupabase()) || [...INITIAL_REPORT_DROPDOWN_CATEGORIES];
  }
  const idx = list.findIndex(c => c.id === category.id);
  const next = idx >= 0
    ? list.map(c => (c.id === category.id ? category : c))
    : [...list, category];

  const res = await supabaseDb.saveAppSetting(
    SETTING_KEYS.REPORT_DROPDOWN_CATEGORIES,
    { categories: next, updatedAt: new Date().toISOString() },
    'Report dropdown categories'
  );
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menyimpan kategori dropdown ke Supabase PostgreSQL.'));
  }
  return true;
}

export async function deleteReportDropdownCategoryFromSupabase(
  id: string,
  allCategories?: ReportDropdownCategory[]
): Promise<boolean> {
  let list = allCategories;
  if (!list) {
    list = (await loadReportDropdownCategoriesFromSupabase()) || [...INITIAL_REPORT_DROPDOWN_CATEGORIES];
  }
  const next = list.filter(c => c.id !== id);
  const res = await supabaseDb.saveAppSetting(
    SETTING_KEYS.REPORT_DROPDOWN_CATEGORIES,
    { categories: next, updatedAt: new Date().toISOString() },
    'Report dropdown categories'
  );
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal menghapus kategori dropdown di Supabase PostgreSQL.'));
  }
  return true;
}

export async function softDeleteReportDropdownCategoryInSupabase(
  id: string,
  deletedBy: string,
  allCategories?: ReportDropdownCategory[]
): Promise<boolean> {
  let list = allCategories;
  if (!list) {
    list = (await loadReportDropdownCategoriesFromSupabase()) || [...INITIAL_REPORT_DROPDOWN_CATEGORIES];
  }
  const next = list.map(c =>
    c.id === id
      ? { ...c, isActive: false, isDeleted: true, updatedBy: deletedBy, updatedAt: new Date().toISOString() }
      : c
  );
  const res = await supabaseDb.saveAppSetting(
    SETTING_KEYS.REPORT_DROPDOWN_CATEGORIES,
    { categories: next, updatedAt: new Date().toISOString() },
    'Report dropdown categories'
  );
  if (!res.success) {
    throw new Error(formatSupabaseErrorMessage(res.error, 'Gagal soft-delete kategori dropdown di Supabase PostgreSQL.'));
  }
  return true;
}
