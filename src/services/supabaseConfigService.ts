import {
  UIConfiguration,
  NavigationConfigDoc,
  ReportDropdownCategory,
  ChatCategoryConfig,
  HierarchicalStatus,
  DroplistItem
} from '../types';
import { supabaseDb } from './supabaseDb';

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

export const INITIAL_HIERARCHICAL_DROPLISTS: HierarchicalStatus[] = [
  {
    id: 'hs-complete',
    name: 'COMPLETE',
    code: 'COMPLETE',
    color: '#10B981',
    order: 1,
    active: true,
    reasons: [
      {
        id: 'hr-c1',
        statusId: 'hs-complete',
        name: 'Ganti Drop Wire Baru',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-c1-1', reasonId: 'hr-c1', name: 'Ter tabrak Truk', order: 1, active: true },
          { id: 'hrm-c1-2', reasonId: 'hr-c1', name: 'Tergigit Tikus / Hewan', order: 2, active: true },
          { id: 'hrm-c1-3', reasonId: 'hr-c1', name: 'Kabel Lapuk / Usia', order: 3, active: true },
          { id: 'hrm-1793539959739', reasonId: 'hr-c1', name: 'Kabel Bending', text: 'Kabel Bending', order: 4, active: true, isActive: true },
          { id: 'hrm-1793540022430', reasonId: 'hr-c1', name: 'Kabel Digigit Hewan', text: 'Kabel Digigit Hewan', order: 5, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-c2',
        statusId: 'hs-complete',
        name: 'Ganti Precon Baru',
        order: 2,
        active: true,
        remarks: [
          { id: 'hrm-c2-1', reasonId: 'hr-c2', name: 'Ter tabrak Truk', order: 1, active: true },
          { id: 'hrm-c2-2', reasonId: 'hr-c2', name: 'Konektor SC Rusak / Kotor', order: 2, active: true },
          { id: 'hrm-c2-3', reasonId: 'hr-c2', name: 'Macro Bend Jalur Tiang', order: 3, active: true },
          { id: 'hrm-1793540054485', reasonId: 'hr-c2', name: 'Precone Di Gigit Hewan', text: 'Precone Di Gigit Hewan', order: 4, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-1793540108354',
        statusId: 'hs-complete',
        name: 'Replace ONT',
        code: 'REP_ONT',
        order: 3,
        active: true,
        isActive: true,
        remarks: [
          { id: 'hrm-1793540131976', reasonId: 'hr-1793540108354', name: 'ONT BAD', text: 'ONT BAD', order: 1, active: true, isActive: true },
          { id: 'hrm-1793540165269', reasonId: 'hr-1793540108354', name: 'ONT SLOW SPEED', text: 'ONT SLOW SPEED', order: 2, active: true, isActive: true },
          { id: 'hrm-1793540181440', reasonId: 'hr-1793540108354', name: 'ONT MATI TOTAL', text: 'ONT MATI TOTAL', order: 3, active: true, isActive: true },
          { id: 'hrm-1793540203825', reasonId: 'hr-1793540108354', name: 'SN/MAC TIDAK TERDAFTAR', text: 'SN/MAC TIDAK TERDAFTAR', order: 4, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-1793540232023',
        statusId: 'hs-complete',
        name: 'Ganti Pigtail',
        code: 'REP_PIG',
        order: 4,
        active: true,
        isActive: true,
        remarks: [
          { id: 'hrm-1793540265068', reasonId: 'hr-1793540232023', name: 'PIGTAIL RUSAK', text: 'PIGTAIL RUSAK', order: 1, active: true, isActive: true },
          { id: 'hrm-1793540274510', reasonId: 'hr-1793540232023', name: 'PIGTAIL PUTUS', text: 'PIGTAIL PUTUS', order: 2, active: true, isActive: true },
          { id: 'hrm-1793540294558', reasonId: 'hr-1793540232023', name: 'PIGTAIL BENDING', text: 'PIGTAIL BENDING', order: 3, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-1793540322448',
        statusId: 'hs-complete',
        name: 'Ganti Barrel SC',
        code: 'REp_sc',
        order: 5,
        active: true,
        isActive: true,
        remarks: [
          { id: 'hrm-1793540343037', reasonId: 'hr-1793540322448', name: 'CONNECTOR RUSAK', text: 'CONNECTOR RUSAK', order: 1, active: true, isActive: true },
          { id: 'hrm-1793540364679', reasonId: 'hr-1793540322448', name: 'CONNECTOR TIDAK SESUAI', text: 'CONNECTOR TIDAK SESUAI', order: 2, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-1793540421975',
        statusId: 'hs-complete',
        name: 'Re-splice Kabel',
        code: 'Rsplic',
        order: 6,
        active: true,
        isActive: true,
        remarks: [
          { id: 'hrm-1793540434825', reasonId: 'hr-1793540421975', name: 'KABEL PUTUS', text: 'KABEL PUTUS', order: 1, active: true, isActive: true },
          { id: 'hrm-1793540511910', reasonId: 'hr-1793540421975', name: 'HASIL SPLICE BAD', text: 'HASIL SPLICE BAD', order: 2, active: true, isActive: true }
        ]
      }
    ]
  },
  {
    id: 'hs-cancel',
    name: 'CANCEL',
    code: 'CANCEL',
    color: '#EF4444',
    order: 2,
    active: true,
    reasons: [
      {
        id: 'hr-can1',
        statusId: 'hs-cancel',
        name: 'Pelanggan Berhenti Berlangganan',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-can1-1', reasonId: 'hr-can1', name: 'Pelanggan Berhenti Berlangganan', order: 1, active: true },
          { id: 'hrm-can1-2', reasonId: 'hr-can1', name: 'Pindah Domisili / Lokasi', order: 2, active: true }
        ]
      },
      {
        id: 'hr-can2',
        statusId: 'hs-cancel',
        name: 'Re-Visit Berulang',
        order: 2,
        active: true,
        remarks: [
          { id: 'hrm-can2-1', reasonId: 'hr-can2', name: 'Re-Visit Berulang (tidak bertemu Customer)', order: 1, active: true },
          { id: 'hrm-can2-2', reasonId: 'hr-can2', name: 'Kontak Tidak Dapat Dihubungi', order: 2, active: true }
        ]
      },
      {
        id: 'hr-can3',
        statusId: 'hs-cancel',
        name: 'Pembatalan Request Upgrade',
        order: 3,
        active: true,
        remarks: [{ id: 'hrm-can3-1', reasonId: 'hr-can3', name: 'Pembatalan Request Upgrade', order: 1, active: true }]
      },
      {
        id: 'hr-can4',
        statusId: 'hs-cancel',
        name: 'Pembatalan Request Downgrade',
        order: 4,
        active: true,
        remarks: [{ id: 'hrm-can4-1', reasonId: 'hr-can4', name: 'Pembatalan Request Downgrade', order: 1, active: true }]
      },
      {
        id: 'hr-can5',
        statusId: 'hs-cancel',
        name: 'Dibatalkan Pelanggan Saat Kunjungan',
        order: 5,
        active: true,
        remarks: [
          { id: 'hrm-can5-1', reasonId: 'hr-can5', name: 'Pelanggan Menolak Biaya Pemasangan', order: 1, active: true },
          { id: 'hrm-can5-2', reasonId: 'hr-can5', name: 'Menolak Jalur Tarikan Kabel Rumah', order: 2, active: true }
        ]
      }
    ]
  },
  {
    id: 'hs-pending',
    name: 'PENDING',
    code: 'PENDING',
    color: '#F59E0B',
    order: 3,
    active: true,
    reasons: [
      {
        id: 'hr-p1',
        statusId: 'hs-pending',
        name: 'Kendala Redaman Tinggi / LOS',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-p1-1', reasonId: 'hr-p1', name: 'Loss Signal dari FAT / ODP', order: 1, active: true },
          { id: 'hrm-p1-2', reasonId: 'hr-p1', name: 'Kabel Dropcore Putus di Jalur Utama', order: 2, active: true }
        ]
      },
      {
        id: 'hr-p3',
        statusId: 'hs-pending',
        name: 'Akses Rumah / Lokasi Terkendala',
        order: 3,
        active: true,
        remarks: [
          { id: 'hrm-p3-1', reasonId: 'hr-p3', name: 'Portal Komplek / Cluster Terkunci', order: 1, active: true },
          { id: 'hrm-p3-2', reasonId: 'hr-p3', name: 'Izin Pengelola Gedung Belum Terbit', order: 2, active: true }
        ]
      },
      {
        id: 'hr-p4',
        statusId: 'hs-pending',
        name: 'Menunggu Material / Tim Tambahan',
        order: 4,
        active: true,
        remarks: [
          { id: 'hrm-p4-1', reasonId: 'hr-p4', name: 'Butuh Dropcore Panjang >150 Meter', order: 1, active: true },
          { id: 'hrm-p4-2', reasonId: 'hr-p4', name: 'Memerlukan Tiang Sisipan Tambahan', order: 2, active: true }
        ]
      },
      {
        id: 'hr-1793540563196',
        statusId: 'hs-pending',
        name: 'Power Fat Unstandart',
        code: 'POWER_FAT_UNSTANDART',
        order: 4,
        active: true,
        isActive: true,
        remarks: [{ id: 'hrm-1793540596369', reasonId: 'hr-1793540563196', name: 'Fat Loss', text: 'Fat Loss', order: 1, active: true, isActive: true }]
      },
      {
        id: 'hr-1793540611146',
        statusId: 'hs-pending',
        name: 'Fat Loss',
        code: 'FAT_LOSS',
        order: 5,
        active: true,
        isActive: true,
        remarks: []
      }
    ]
  },
  {
    id: 'hs-enroute',
    name: 'RESCHEDULE',
    code: 'RESCH',
    color: '#3B82F6',
    order: 4,
    active: true,
    reasons: [
      {
        id: 'hr-er1',
        statusId: 'hs-enroute',
        name: 'Teknisi Sedang Menuju Lokasi',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-er1-1', reasonId: 'hr-er1', name: 'Estimasi Tiba Sesuai Slot Waktu', order: 1, active: true },
          { id: 'hrm-er1-2', reasonId: 'hr-er1', name: 'Kendala Lalu Lintas / Cuaca Hujan', order: 2, active: true }
        ]
      }
    ]
  },
  {
    id: 'hs-onsite',
    name: 'ON SITE',
    code: 'ON_SITE',
    color: '#8B5CF6',
    order: 5,
    active: false,
    isActive: false,
    reasons: [
      {
        id: 'hr-os1',
        statusId: 'hs-onsite',
        name: 'Pemeriksaan Lapangan Berlangsung',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-os1-1', reasonId: 'hr-os1', name: 'Pengecekan Jalur FAT & Penarikan Kabel', order: 1, active: true },
          { id: 'hrm-os1-2', reasonId: 'hr-os1', name: 'Pemasangan Roset & Uji Redaman OPM', order: 2, active: true }
        ]
      }
    ]
  },
  {
    id: 'hs-installed',
    name: 'INSTALLED',
    code: 'INSTALLED',
    color: '#059669',
    order: 6,
    active: false,
    isActive: false,
    reasons: [
      {
        id: 'hr-inst1',
        statusId: 'hs-installed',
        name: 'Perangkat Baru Terpasang & Aktif',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-inst1-1', reasonId: 'hr-inst1', name: 'ONT & WiFi Berfungsi Normal', order: 1, active: true },
          { id: 'hrm-inst1-2', reasonId: 'hr-inst1', name: 'Speedtest Sesuai Paket Layanan', order: 2, active: true }
        ]
      }
    ]
  },
  {
    id: 'hs-assigned',
    name: 'ASSIGNED',
    code: 'ASSIGNED',
    color: '#6366F1',
    order: 7,
    active: false,
    isActive: false,
    reasons: [
      {
        id: 'hr-as1',
        statusId: 'hs-assigned',
        name: 'Menunggu Keberangkatan Teknisi',
        order: 1,
        active: true,
        remarks: [{ id: 'hrm-as1-1', reasonId: 'hr-as1', name: 'Jadwal Sesuai Slot Waktu Pelanggan', order: 1, active: true }]
      }
    ]
  }
];

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
    throw new Error(res.error?.message || 'Gagal menyimpan konfigurasi UI ke Supabase PostgreSQL.');
  }
  return { success: true, updatedAt };
}

export async function loadUIConfigurationFromSupabase(): Promise<CloudUIConfigurationPayload | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.UI_CONFIGURATION);
  if (!res.success) {
    throw new Error(res.error?.message || 'Gagal memuat konfigurasi UI dari Supabase PostgreSQL.');
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
        const key = payload?.key || payload?.new?.setting_key;
        const val = payload?.value ?? payload?.new?.setting_value;
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
    throw new Error(res.error?.message || 'Gagal menyimpan konfigurasi navigasi ke Supabase PostgreSQL.');
  }
  return { success: true, updatedAt };
}

export async function loadNavigationDocFromSupabase(): Promise<NavigationConfigDoc | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.NAVIGATION_DOC);
  if (!res.success) {
    throw new Error(res.error?.message || 'Gagal memuat konfigurasi navigasi dari Supabase PostgreSQL.');
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
        const key = payload?.key || payload?.new?.setting_key;
        const val = payload?.value ?? payload?.new?.setting_value;
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
    throw new Error(res.error?.message || 'Gagal menyimpan pengaturan global ke Supabase PostgreSQL.');
  }
  return true;
}

export async function loadGlobalAppSettingsFromSupabase(): Promise<Record<string, any> | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.GLOBAL_APP_SETTINGS);
  if (!res.success) {
    throw new Error(res.error?.message || 'Gagal memuat pengaturan global dari Supabase PostgreSQL.');
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
    throw new Error(res.error?.message || 'Gagal menyimpan hierarchical droplists ke Supabase PostgreSQL.');
  }
  return true;
}

export async function loadHierarchicalDroplistsFromSupabase(): Promise<HierarchicalStatus[] | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.HIERARCHICAL_DROPLISTS);
  if (!res.success) {
    throw new Error(res.error?.message || 'Gagal memuat hierarchical droplists dari Supabase PostgreSQL.');
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
    throw new Error(res.error?.message || 'Gagal menyimpan droplist statis ke Supabase PostgreSQL.');
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
        const key = payload?.key || payload?.new?.setting_key;
        const val = payload?.value ?? payload?.new?.setting_value;
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
    throw new Error(res.error?.message || 'Gagal menyimpan kategori chat ke Supabase PostgreSQL.');
  }
  return true;
}

export async function loadChatCategoriesFromSupabase(): Promise<ChatCategoryConfig[] | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.CHAT_CATEGORIES);
  if (!res.success) {
    throw new Error(res.error?.message || 'Gagal memuat kategori chat dari Supabase PostgreSQL.');
  }
  if (!res.data) return null;
  if (Array.isArray(res.data)) return res.data as ChatCategoryConfig[];
  if (Array.isArray(res.data.categories)) return res.data.categories as ChatCategoryConfig[];
  return null;
}

export async function loadReportDropdownCategoriesFromSupabase(): Promise<ReportDropdownCategory[] | null> {
  const res = await supabaseDb.getAppSetting(SETTING_KEYS.REPORT_DROPDOWN_CATEGORIES);
  if (!res.success) {
    throw new Error(res.error?.message || 'Gagal memuat kategori dropdown report dari Supabase PostgreSQL.');
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
    throw new Error(res.error?.message || 'Gagal menyimpan kategori dropdown ke Supabase PostgreSQL.');
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
    throw new Error(res.error?.message || 'Gagal menghapus kategori dropdown di Supabase PostgreSQL.');
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
    throw new Error(res.error?.message || 'Gagal soft-delete kategori dropdown di Supabase PostgreSQL.');
  }
  return true;
}
