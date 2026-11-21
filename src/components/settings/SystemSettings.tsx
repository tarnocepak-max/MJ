import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { RootCauseCategory, Contractor, CoverageArea } from '../../types/index.ts';
import {
  Settings,
  Plus,
  Check,
  Save,
  Building2,
  MapPin,
  Wrench,
  FileSpreadsheet,
  Trash2,
  AlertCircle,
  Palette,
  Clock,
  KeyRound,
  ListFilter,
  Volume2,
  Lock,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Info,
  ShieldAlert,
  Loader2
} from 'lucide-react';
import { getJakartaDateString } from '../../services/appointmentDateParser';
import { DroplistManagementView } from './DroplistManagementView';
import { SoundSettingsView } from './SoundSettingsView';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';

interface SystemSettingsProps {
  defaultTab?: 'core_config' | 'contractors' | 'coverage' | 'root_causes' | 'header_mapping' | 'branding' | 'system_session' | 'report_dropdowns' | 'sound_settings';
  embeddedInSetupHub?: boolean;
}

interface HealthTelemetry {
  status?: string;
  backend?: { active?: boolean; runtime?: string; port?: number };
  database?: { active?: boolean; primaryTarget?: string; status?: string };
  server?: { name?: string; status?: string; environment?: string; uptimeSeconds?: number; timestamp?: string };
  supabase?: { status?: string; latencyMs?: number | null; message?: string };
  databaseStats?: { totalTickets?: number | null; totalUsers?: number | null; totalContractors?: number | null; totalAuditLogs?: number | null };
}

export const SystemSettings: React.FC<SystemSettingsProps> = ({
  defaultTab = 'core_config',
  embeddedInSetupHub = false
}) => {
  const {
    headerMappings,
    updateHeaderMapping,
    contractors,
    addContractor,
    coverageAreas,
    addCoverageArea,
    rootCauseCategories,
    updateRootCauseCategories,
    currentUser,
    operationalDate,
    setOperationalDate,
    setIsSessionModalOpen,
    databaseStatus,
    syncStatus,
    tickets,
    users,
    refreshDatabaseData
  } = useApp();

  const { config, setGlobalTheme, setShowEmptyFields, updateAndroidSettings } = useUIConfig();

  const initialTab =
    embeddedInSetupHub && (defaultTab === 'report_dropdowns' || defaultTab === 'sound_settings')
      ? 'core_config'
      : defaultTab;

  const [activeTab, setActiveTab] = useState<
    'core_config' | 'contractors' | 'coverage' | 'root_causes' | 'header_mapping' | 'branding' | 'system_session' | 'report_dropdowns' | 'sound_settings'
  >(initialTab);
  const isSuperAdmin = currentUser.role === 'super_admin';
  const [operationalDateInput, setOperationalDateInput] = useState(operationalDate);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Live cluster telemetry from /api/health
  const [healthData, setHealthData] = useState<HealthTelemetry | null>(null);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState(false);

  const fetchHealthTelemetry = useCallback(async () => {
    setIsLoadingTelemetry(true);
    try {
      const res = await fetch('/api/health', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setHealthData(json);
      }
    } catch {
      // keep previous snapshot silently if offline
    } finally {
      setIsLoadingTelemetry(false);
    }
  }, []);

  useEffect(() => {
    fetchHealthTelemetry();
  }, [fetchHealthTelemetry]);

  useEffect(() => {
    setOperationalDateInput(operationalDate);
  }, [operationalDate]);

  // Contractor Form State
  const [showAddContractor, setShowAddContractor] = useState(false);
  const [newCName, setNewCName] = useState('');
  const [newCCode, setNewCCode] = useState('');
  const [newCAreas, setNewCAreas] = useState('');
  const [newCPhone, setNewCPhone] = useState('');
  const [newCEmail, setNewCEmail] = useState('');

  // Coverage Area Form State
  const [showAddArea, setShowAddArea] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaClusters, setNewAreaClusters] = useState('');

  // Root Cause State
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0);
  const [newRootCauseItem, setNewRootCauseItem] = useState('');

  // Header Mapping Edit
  const [editingField, setEditingField] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState('');

  // Branding state
  const [appNameInput, setAppNameInput] = useState(config.global.appName || 'MoraJaws');
  const [appPrimaryColor, setAppPrimaryColor] = useState(config.global.primaryColor || 'indigo');

  if (currentUser.role !== 'super_admin' && currentUser.role !== 'management_data') {
    return (
      <div className="card-3d-lavender rounded-2xl p-8 text-center max-w-lg mx-auto space-y-4 my-8">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/80 text-[#BA1A1A] dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto border border-rose-200 dark:border-rose-900">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-display font-bold text-[#1F1638] dark:text-white text-base">
          Akses Ditolak: Otoritas Setup Terpusat Dibatasi
        </h3>
        <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
          Parameter kontraktor, cakupan area, dan pemetaan kolom dalam Setup Terpusat MoraJaws hanya dapat diakses oleh <strong>Super Admin</strong> dan <strong>Management Data</strong>.
        </p>
        <div className="p-3 mj-tactile-well text-xs text-[#4B4452] dark:text-[#D8B4FE] font-medium">
          Akun Anda: <span className="font-bold capitalize text-[#1F1638] dark:text-white">{currentUser.name} ({currentUser.role})</span>.
        </div>
      </div>
    );
  }

  const triggerNotice = (msg: string) => {
    setErrorNotice(null);
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const triggerError = (msg: string) => {
    setNotice(null);
    setErrorNotice(msg);
  };

  // Handlers
  const handleCreateContractor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      triggerError('Akses ditolak: hanya Super Admin yang dapat menambah master kontraktor.');
      return;
    }
    if (!newCName.trim() || !newCCode.trim()) {
      triggerError('Nama dan kode kontraktor wajib diisi.');
      return;
    }

    const areas = newCAreas.split(',').map(s => s.trim()).filter(Boolean);
    setIsSaving(true);
    try {
      const res = await addContractor({
        name: newCName.trim(),
        code: newCCode.trim().toUpperCase(),
        coverageAreas: areas.length > 0 ? areas : ['Jabodetabek'],
        phone: newCPhone.trim(),
        email: newCEmail.trim(),
        active: true
      });
      if (!res.success) {
        triggerError(res.error || 'Gagal menyimpan kontraktor ke database.');
        return;
      }
      const createdName = newCName.trim();
      setNewCName('');
      setNewCCode('');
      setNewCAreas('');
      setNewCPhone('');
      setNewCEmail('');
      setShowAddContractor(false);
      triggerNotice(`Kontraktor "${createdName}" berhasil disimpan ke database.`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      triggerError('Akses ditolak: hanya Super Admin yang dapat menambah coverage area.');
      return;
    }
    if (!newAreaName.trim()) {
      triggerError('Nama coverage area wajib diisi.');
      return;
    }

    const clusters = newAreaClusters.split(',').map(s => s.trim()).filter(Boolean);
    setIsSaving(true);
    try {
      const res = await addCoverageArea({
        name: newAreaName.trim(),
        clusters,
        active: true
      });
      if (!res.success) {
        triggerError(res.error || 'Gagal menyimpan coverage area ke database.');
        return;
      }
      const createdArea = newAreaName.trim();
      setNewAreaName('');
      setNewAreaClusters('');
      setShowAddArea(false);
      triggerNotice(`Coverage Area "${createdArea}" berhasil disimpan ke database.`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRootCause = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      triggerError('Akses ditolak: hanya Super Admin yang dapat mengubah taksonomi root cause.');
      return;
    }
    if (!newRootCauseItem.trim()) return;

    const currentCat = rootCauseCategories[selectedCategoryIndex];
    if (!currentCat) return;

    if (currentCat.items.includes(newRootCauseItem.trim())) {
      triggerError(`Item "${newRootCauseItem}" sudah ada dalam kategori.`);
      return;
    }

    const updatedCategories = rootCauseCategories.map((cat, idx) => {
      if (idx !== selectedCategoryIndex) return cat;
      return {
        ...cat,
        items: [...cat.items, newRootCauseItem.trim()]
      };
    });

    setIsSaving(true);
    try {
      const res = await updateRootCauseCategories(updatedCategories);
      if (!res.success) {
        triggerError(res.error || 'Gagal menyimpan root cause ke database.');
        return;
      }
      setNewRootCauseItem('');
      triggerNotice(`Root cause baru berhasil disimpan ke "${currentCat.name}".`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveRootCause = async (categoryIdx: number, itemToRemove: string) => {
    if (!isSuperAdmin) {
      triggerError('Akses ditolak: hanya Super Admin yang dapat menghapus root cause.');
      return;
    }
    const updatedCategories = rootCauseCategories.map((cat, idx) => {
      if (idx !== categoryIdx) return cat;
      return {
        ...cat,
        items: cat.items.filter(it => it !== itemToRemove)
      };
    });
    setIsSaving(true);
    try {
      const res = await updateRootCauseCategories(updatedCategories);
      if (!res.success) {
        triggerError(res.error || 'Gagal menghapus root cause di database.');
        return;
      }
      triggerNotice(`Item "${itemToRemove}" berhasil dihapus dari database.`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAliases = async (field: string) => {
    if (!isSuperAdmin) {
      triggerError('Akses ditolak: hanya Super Admin yang dapat mengubah kamus alias header.');
      return;
    }
    const splitted = aliasInput
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0);

    setIsSaving(true);
    try {
      const res = await updateHeaderMapping(field, splitted);
      if (!res.success) {
        triggerError(res.error || 'Gagal memperbarui alias header ke database.');
        return;
      }
      setEditingField(null);
      triggerNotice(`Alias untuk ${field} berhasil disimpan ke database.`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      triggerError('Akses ditolak: hanya Super Admin yang dapat mengubah branding global.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await setGlobalTheme({
        appName: appNameInput.trim() || 'MoraJaws',
        primaryColor: appPrimaryColor
      });
      if (!res.success) {
        triggerError(res.error || 'Gagal menyimpan branding ke database.');
        return;
      }
      triggerNotice('Pengaturan identitas aplikasi & branding global berhasil disimpan ke database.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner (Hidden when embedded cleanly in Setup Terpusat MoraJaws) */}
      {!embeddedInSetupHub && (
        <div className="card-3d-lavender rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#35105E] to-[#7135B5] text-white flex items-center justify-center shrink-0 shadow-[0_4px_12px_rgba(88,20,156,0.28)]">
              <Settings className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-gradient-to-r from-[#6b103b] to-[#480123] text-white shadow-xs">
                  MASTER DATA • SUPERADMIN
                </span>
                <span className="text-[11px] font-bold text-[#7D7484] dark:text-[#D8B4FE]/75">
                  MORAJAWS OPS COMMAND
                </span>
              </div>
              <h3 className="font-display text-base sm:text-lg font-extrabold text-[#1F1638] dark:text-white">
                Parameter Sistem &amp; Master Data Operasional
              </h3>
              <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8]">
                Kelola master vendor kontraktor, cakupan coverage area, taksonomi kendala &amp; root cause Wi-Fi teknisi, kamus alias header impor, dan identitas operasional.
              </p>
            </div>
          </div>
        </div>
      )}

      {!isSuperAdmin && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-lg text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Mode Hanya-Baca: Anda melihat konfigurasi global dalam mode read-only. Hanya <strong>Super Admin</strong> yang dapat mengubah dan menyimpan parameter global ke database.</span>
        </div>
      )}

      {errorNotice && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorNotice}</span>
        </div>
      )}

      {notice && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded text-xs flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="mj-tactile-tab-bar p-1.5 rounded-2xl flex items-center gap-1.5 text-xs font-semibold overflow-x-auto no-scrollbar">
        {!embeddedInSetupHub && (
          <>
            <button
              type="button"
              onClick={() => setActiveTab('report_dropdowns')}
              className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'report_dropdowns'
                  ? 'btn-3d-primary text-white font-bold'
                  : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
              }`}
            >
              <ListFilter className="w-4 h-4" />
              <span>Kategori Report</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('sound_settings')}
              className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'sound_settings'
                  ? 'btn-3d-primary text-white font-bold'
                  : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
              }`}
            >
              <Volume2 className="w-4 h-4" />
              <span>Sound &amp; Notifikasi</span>
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('core_config')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'core_config'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Operasional Core &amp; Telemetri</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('contractors')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'contractors'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Master Kontraktor ({contractors.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('coverage')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'coverage'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>Coverage Area &amp; Cluster ({coverageAreas.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('root_causes')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'root_causes'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
          }`}
        >
          <Wrench className="w-4 h-4" />
          <span>Root Cause Wi-Fi ({rootCauseCategories.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('header_mapping')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'header_mapping'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Alias Header Impor ({headerMappings.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('branding')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'branding'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>Branding &amp; Tema</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('system_session')}
          className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
            activeTab === 'system_session'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#4B4452] hover:text-[#35105E] hover:bg-white/70 dark:text-[#CEC0E8] dark:hover:text-white dark:hover:bg-[#35105E]/50'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Sesi Staf &amp; WIB</span>
        </button>
      </div>

      {/* TAB 0: CORE OPERATIONAL CONFIG & LIVE CLUSTER TELEMETRY */}
      {activeTab === 'core_config' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left 8 Columns: Master Data & Konfigurasi Operasional Core */}
          <div className="xl:col-span-8 card-3d-lavender rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#EFE7FC] dark:border-[#35105E]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#F5F1FF] dark:bg-[#35105E] border border-[#D8CCF3] dark:border-[#7135B5]/50 text-[#58149C] dark:text-[#D8B4FE] flex items-center justify-center shrink-0 shadow-[0_2px_0_#D8CCF3] dark:shadow-none">
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-base text-[#1F1638] dark:text-white">
                    Master Data &amp; Konfigurasi Operasional Core
                  </h3>
                  <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8]">
                    Pengaturan identitas white-label, tanggal operasional WIB, dan perilaku antarmuka global.
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F3EAFF] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#35105E] text-[#58149C] dark:text-[#D8B4FE] self-start sm:self-auto shrink-0">
                Scope: Global System
              </span>
            </div>

            {/* White-Label Name & Locked WIB Timezone */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#4B4452] dark:text-[#CEC0E8]">
                  Nama Aplikasi / White Label
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={!isSuperAdmin || isSaving}
                    value={appNameInput}
                    onChange={e => setAppNameInput(e.target.value)}
                    placeholder="MoraJaws"
                    className="flex-1 px-3 py-2 rounded-xl tactile-debossed-input bg-[#F8F1FF] dark:bg-[#160D29] text-xs font-bold text-[#1F1638] dark:text-white focus:outline-none disabled:opacity-60"
                  />
                  {isSuperAdmin && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={async () => {
                        setIsSaving(true);
                        try {
                          const res = await setGlobalTheme({
                            appName: appNameInput.trim() || 'MoraJaws'
                          });
                          if (!res.success) {
                            triggerError(res.error || 'Gagal memperbarui nama aplikasi.');
                          } else {
                            triggerNotice(`Nama aplikasi "${appNameInput.trim() || 'MoraJaws'}" disimpan ke PostgreSQL.`);
                          }
                        } finally {
                          setIsSaving(false);
                        }
                      }}
                      className="mj-btn-superadmin-primary px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer shrink-0"
                    >
                      Simpan
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]/75">
                  Tampil pada header, sidebar, dan portal login staf.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#4B4452] dark:text-[#CEC0E8]">
                  Timezone Operasional FTTH
                </label>
                <div className="flex items-center justify-between px-3 py-2 rounded-xl tactile-debossed-input bg-[#F8F1FF] dark:bg-[#160D29] text-xs font-bold text-[#494453] dark:text-[#D8B4FE]">
                  <span>Asia/Jakarta (WIB) — Terkunci SOP</span>
                  <Lock className="w-3.5 h-3.5 text-[#58149C] dark:text-[#A78BFA] shrink-0" />
                </div>
                <p className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]/75">
                  Seluruh pencatatan SLA, appointment, dan rollover 00:00 berpatokan pada WIB.
                </p>
              </div>
            </div>

            {/* Operational Date Picker (todayWIB) */}
            <div className="p-4 rounded-2xl bg-[#F8F1FF] dark:bg-[#22123F] border border-[#D8CCF3] dark:border-[#35105E] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#58149C] dark:text-[#D8B4FE]">
                  Tanggal Acuan Operasional (todayWIB)
                </div>
                <div className="text-base sm:text-lg font-extrabold font-mono text-[#1F1638] dark:text-white tabular-nums mt-0.5">
                  {operationalDate} <span className="text-xs font-semibold text-[#766B83] dark:text-[#CEC0E8]">(WIB)</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  disabled={!isSuperAdmin || isSaving}
                  value={operationalDateInput}
                  onChange={e => setOperationalDateInput(e.target.value)}
                  className="px-3 py-1.5 tactile-debossed-input bg-white dark:bg-[#160D29] rounded-xl text-xs font-bold font-mono text-[#1F1638] dark:text-white disabled:opacity-60 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!isSuperAdmin || isSaving}
                  onClick={async () => {
                    if (!isSuperAdmin) return;
                    setIsSaving(true);
                    try {
                      const res = await setOperationalDate(operationalDateInput);
                      if (!res.success) {
                        triggerError(res.error || 'Gagal menyimpan tanggal operasional.');
                      } else {
                        triggerNotice(`Tanggal operasional diperbarui ke ${operationalDateInput} (WIB).`);
                      }
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  className="mj-btn-superadmin-primary px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Terapkan
                </button>
                <button
                  type="button"
                  disabled={!isSuperAdmin || isSaving}
                  onClick={async () => {
                    if (!isSuperAdmin) return;
                    const realDate = getJakartaDateString(0);
                    setIsSaving(true);
                    try {
                      const res = await setOperationalDate(realDate);
                      if (!res.success) {
                        triggerError(res.error || 'Gagal mereset tanggal operasional.');
                      } else {
                        setOperationalDateInput(realDate);
                        triggerNotice(`Tanggal operasional direset ke aktual WIB: ${realDate}.`);
                      }
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  className="mj-btn-superadmin-lilac px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Aktual WIB
                </button>
              </div>
            </div>

            {/* Enterprise UI & Operational Controls (Wired to UIConfigContext) */}
            <div className="space-y-3 pt-1">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#4B4452] dark:text-[#CEC0E8]">
                Preferensi Tampilan &amp; Guardrails Global
              </div>

              {/* 3D Tactile Theme Mode & Table Density Segmented Bars */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-3.5 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-2.5">
                  <div className="text-xs font-extrabold text-[#1F1638] dark:text-white">
                    Mode Tema Antarmuka
                  </div>
                  <div className="mj-seg-track p-1 rounded-xl flex items-center gap-1">
                    {(['light', 'dark', 'system'] as const).map(mode => {
                      const isActive = config.global.themeMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={!isSuperAdmin || isSaving}
                          onClick={async () => {
                            const res = await setGlobalTheme({ themeMode: mode });
                            if (res.success) triggerNotice(`Tema antarmuka diubah ke "${mode}".`);
                          }}
                          className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-all cursor-pointer disabled:opacity-60 ${
                            isActive
                              ? 'btn-3d-primary text-white'
                              : 'text-[#4B4452] dark:text-[#CEC0E8] hover:bg-white/70 dark:hover:bg-[#261942]'
                          }`}
                        >
                          {mode}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-2.5">
                  <div className="text-xs font-extrabold text-[#1F1638] dark:text-white">
                    Kepadatan Tabel Work Order
                  </div>
                  <div className="mj-seg-track p-1 rounded-xl flex items-center gap-1">
                    {(['compact', 'comfortable', 'spacious'] as const).map(dens => {
                      const isActive = config.global.density === dens;
                      return (
                        <button
                          key={dens}
                          type="button"
                          disabled={!isSuperAdmin || isSaving}
                          onClick={async () => {
                            const res = await setGlobalTheme({ density: dens });
                            if (res.success) triggerNotice(`Kepadatan tabel diubah ke "${dens}".`);
                          }}
                          className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-all cursor-pointer disabled:opacity-60 ${
                            isActive
                              ? 'btn-3d-primary text-white'
                              : 'text-[#4B4452] dark:text-[#CEC0E8] hover:bg-white/70 dark:hover:bg-[#261942]'
                          }`}
                        >
                          {dens}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Real 3D Boolean Switches */}
              <div className="divide-y divide-[#EFE7FC] dark:divide-[#35105E] rounded-2xl border border-[#E8DDFF] dark:border-[#35105E] bg-[#F8F1FF]/75 dark:bg-[#160D29]/75">
                <div className="p-3.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-extrabold text-[#1F1638] dark:text-white">
                      Tampilkan Field Kosong di Detail Tiket (WO Fullview)
                    </div>
                    <div className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
                      Menampilkan seluruh atribut canonical 17 section walaupun nilainya belum terisi.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={config.ticketDetail.showEmptyFields}
                    disabled={!isSuperAdmin}
                    onClick={async () => {
                      const nextVal = !config.ticketDetail.showEmptyFields;
                      const res = await setShowEmptyFields(nextVal);
                      if (res.success) triggerNotice(`Tampilkan field kosong: ${nextVal ? 'Aktif' : 'Disembunyikan'}.`);
                    }}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-all cursor-pointer disabled:opacity-50 ${
                      config.ticketDetail.showEmptyFields ? 'mj-switch-track-on' : 'mj-switch-track-off'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full mj-switch-thumb transition-transform ${
                        config.ticketDetail.showEmptyFields ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="p-3.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-extrabold text-[#1F1638] dark:text-white">
                      Auto-Close Sidebar pada Perangkat Mobile / Android
                    </div>
                    <div className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
                      Menutup panel navigasi secara otomatis setelah berpindah halaman di layar kecil.
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={config.device?.android?.autoCloseSidebarOnNavigate !== false}
                    disabled={!isSuperAdmin}
                    onClick={async () => {
                      const currentVal = config.device?.android?.autoCloseSidebarOnNavigate !== false;
                      const res = await updateAndroidSettings({ autoCloseSidebarOnNavigate: !currentVal });
                      if (res.success) triggerNotice(`Auto-close sidebar mobile: ${!currentVal ? 'Aktif' : 'Nonaktif'}.`);
                    }}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-all cursor-pointer disabled:opacity-50 ${
                      config.device?.android?.autoCloseSidebarOnNavigate !== false ? 'mj-switch-track-on' : 'mj-switch-track-off'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full mj-switch-thumb transition-transform ${
                        config.device?.android?.autoCloseSidebarOnNavigate !== false ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right 4 Columns: Live Node Telemetri Cluster & Health + Master Control Notice */}
          <div className="xl:col-span-4 space-y-4">
            <div className="bg-[#160D29] text-white rounded-2xl border border-[#35105E] p-5 shadow-[0_4px_0_#0d061b] space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#35105E]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#35105E] border border-[#7135B5]/50 flex items-center justify-center text-[#D8B4FE]">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-display font-bold text-sm leading-tight">Node Telemetri Cluster &amp; Health</h4>
                    <span className="text-[10.5px] text-[#A78BFA]">Live dari /api/health</span>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-extrabold uppercase ${
                    healthData?.database?.active || databaseStatus === 'connected'
                      ? 'bg-[#16A36A]/20 text-emerald-300 border border-[#16A36A]/40'
                      : 'bg-[#E59A27]/20 text-amber-300 border border-[#E59A27]/40'
                  }`}
                >
                  {healthData?.database?.active || databaseStatus === 'connected' ? 'NORMAL' : 'LOKAL'}
                </span>
              </div>

              {/* 5 Spec Tiles */}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2.5 rounded-xl bg-[#22123F] border border-[#35105E]">
                  <div className="text-[9.5px] text-[#A78BFA] uppercase font-bold">Database</div>
                  <div className="font-mono font-bold text-white truncate mt-0.5">
                    {healthData?.database?.primaryTarget || 'Supabase PG'}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#22123F] border border-[#35105E]">
                  <div className="text-[9.5px] text-[#A78BFA] uppercase font-bold">Backend</div>
                  <div className="font-mono font-bold text-[#D8B4FE] truncate mt-0.5">
                    {healthData?.backend?.runtime || 'Node Express'}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#22123F] border border-[#35105E]">
                  <div className="text-[9.5px] text-[#A78BFA] uppercase font-bold">Latency</div>
                  <div className="font-mono font-bold text-emerald-300 tabular-nums mt-0.5">
                    {typeof healthData?.supabase?.latencyMs === 'number'
                      ? `${healthData.supabase.latencyMs} ms`
                      : databaseStatus === 'connected'
                      ? 'Aktif'
                      : '-'}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#22123F] border border-[#35105E]">
                  <div className="text-[9.5px] text-[#A78BFA] uppercase font-bold">Uptime</div>
                  <div className="font-mono font-bold text-white tabular-nums mt-0.5">
                    {typeof healthData?.server?.uptimeSeconds === 'number'
                      ? `${Math.floor(healthData.server.uptimeSeconds / 60)}m ${healthData.server.uptimeSeconds % 60}s`
                      : '-'}
                  </div>
                </div>
                <div className="col-span-2 p-2.5 rounded-xl bg-[#22123F] border border-[#35105E] flex items-center justify-between gap-2">
                  <span className="text-[9.5px] text-[#A78BFA] uppercase font-bold">Sinkronisasi Status</span>
                  <span className="font-mono font-bold text-[#DAB9FF]">{syncStatus}</span>
                </div>
              </div>

              {/* 3 Real KPI Entity Counts */}
              <div className="p-3 rounded-xl bg-[#22123F] border border-[#35105E] space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#A78BFA]">
                  Populasi Entitas Terverifikasi
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="p-1.5 rounded-lg bg-[#160D29]/80 border border-[#35105E]/80">
                    <div className="font-mono font-extrabold text-sm text-white tabular-nums">
                      {healthData?.databaseStats?.totalTickets ?? tickets.length}
                    </div>
                    <div className="text-[10px] text-[#CEC0E8]/75">Work Order</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-[#160D29]/80 border border-[#35105E]/80">
                    <div className="font-mono font-extrabold text-sm text-white tabular-nums">
                      {healthData?.databaseStats?.totalUsers ?? users.length}
                    </div>
                    <div className="text-[10px] text-[#CEC0E8]/75">Akun Staf</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-[#160D29]/80 border border-[#35105E]/80">
                    <div className="font-mono font-extrabold text-sm text-white tabular-nums">
                      {healthData?.databaseStats?.totalContractors ?? contractors.length}
                    </div>
                    <div className="text-[10px] text-[#CEC0E8]/75">Kontraktor</div>
                  </div>
                </div>
              </div>

              {/* Realtime Cluster Packet Visualizer (Decorative SVG anchored to real latency/status) */}
              <div className="p-3 rounded-xl bg-[#100820] border border-[#35105E] space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[#A78BFA] uppercase font-bold">SSE Heartbeat Stream</span>
                  <span className="text-emerald-300 font-bold">
                    {typeof healthData?.supabase?.latencyMs === 'number'
                      ? `${healthData.supabase.latencyMs}ms RTT`
                      : databaseStatus === 'connected'
                      ? 'Stream Ready'
                      : 'Standby'}
                  </span>
                </div>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 240 42"
                  className="w-full h-9 overflow-visible"
                  fill="none"
                >
                  <defs>
                    <linearGradient id="mjPulseGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#7135B5" />
                      <stop offset="50%" stopColor="#DAB9FF" />
                      <stop offset="100%" stopColor="#10B981" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 24 L26 24 L36 14 L46 30 L56 18 L66 24 L94 24 L104 9 L114 34 L124 17 L134 24 L164 24 L174 13 L184 29 L194 21 L204 24 L240 24"
                    stroke="url(#mjPulseGrad)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <button
                type="button"
                disabled={isLoadingTelemetry}
                onClick={async () => {
                  await Promise.all([fetchHealthTelemetry(), refreshDatabaseData()]);
                  triggerNotice('Telemetri cluster dan data cloud berhasil disegarkan.');
                }}
                className={`mj-btn-superadmin-primary w-full py-2.5 px-3 rounded-xl text-xs font-bold gap-2 cursor-pointer ${
                  isLoadingTelemetry ? 'mj-btn-loading' : ''
                }`}
              >
                {isLoadingTelemetry ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Refresh Telemetri &amp; Re-Sync Cloud</span>
              </button>
            </div>

            {/* Master Control Notice Card */}
            <div className="card-3d-lavender rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <Info className="w-4 h-4 text-[#58149C] dark:text-[#D8B4FE] shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-xs font-extrabold text-[#1F1638] dark:text-white">
                    Master Control Notice
                  </div>
                  <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
                    Perubahan konfigurasi global disebarkan ke seluruh sesi Dispatch, Leader, dan Installer melalui jalur SSE PostgreSQL secara real-time.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsSessionModalOpen(true)}
                className="mj-btn-superadmin-lilac w-full py-2 px-3 rounded-xl text-xs font-bold gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Kelola Sesi Staf Aktif</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: MASTER CONTRACTORS */}
      {activeTab === 'contractors' && (
        <div className="card-3d-lavender rounded-2xl p-5 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="font-display font-bold text-[#1F1638] dark:text-white text-sm">
                Daftar Vendor Kontraktor Resmi
              </h4>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
                Pendaftaran akun Leader wajib memilih kontraktor dari daftar master ini.
              </p>
            </div>

            <button
              type="button"
              disabled={!isSuperAdmin || isSaving}
              onClick={() => setShowAddContractor(!showAddContractor)}
              className="mj-btn-superadmin-primary px-3.5 py-2 rounded-xl font-bold gap-1.5 self-start sm:self-auto cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Kontraktor Baru</span>
            </button>
          </div>

          {showAddContractor && isSuperAdmin && (
            <form onSubmit={handleCreateContractor} className="p-4 mj-tactile-well border border-[#D8CCF3] dark:border-[#35105E] rounded-xl space-y-3">
              <h5 className="font-display font-bold text-[#1F1638] dark:text-white text-xs">Form Kontraktor Baru</h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">Nama Kontraktor *</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: PT Fiber Optik Mandiri"
                    value={newCName}
                    onChange={e => setNewCName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#1F1638] dark:text-white text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">Kode Singkatan *</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: FOM"
                    value={newCCode}
                    onChange={e => setNewCCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#1F1638] dark:text-white text-xs font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">Coverage Area (Pisahkan Koma)</label>
                  <input
                    type="text"
                    placeholder="Contoh: Jakarta Selatan, Depok"
                    value={newCAreas}
                    onChange={e => setNewCAreas(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#1F1638] dark:text-white text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">No. Kontak / Hotline</label>
                  <input
                    type="text"
                    placeholder="0812xxxxxxxx"
                    value={newCPhone}
                    onChange={e => setNewCPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#1F1638] dark:text-white text-xs font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">Email Operasional</label>
                  <input
                    type="email"
                    placeholder="ops@fibermandiri.co.id"
                    value={newCEmail}
                    onChange={e => setNewCEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#1F1638] dark:text-white text-xs focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddContractor(false)}
                  className="btn-3d-lilac px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="btn-3d-primary px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Simpan Kontraktor
                </button>
              </div>
            </form>
          )}

          <ResponsiveDataTable<Contractor>
            data={contractors}
            getRowKey={(c, cIdx) => `settings-contractor-row-${c.id || c.name}-${cIdx}`}
            emptyState={{
              title: 'Belum ada vendor kontraktor',
              description: 'Tambahkan vendor kontraktor baru untuk mengaktifkan alokasi penugasan.'
            }}
            mobileTitle={c => <span className="font-bold text-[#211A2E] dark:text-white">{c.name}</span>}
            mobileSubtitle={c => (
              <span className="font-mono text-[#7135B5] dark:text-[#D8B4FE]">
                Kode: {c.code} · Leader: {c.leaderName || 'Belum ada leader'}
              </span>
            )}
            mobileStatus={c => (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ECFDF5] text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-300">
                {c.active ? 'Aktif' : 'Nonaktif'}
              </span>
            )}
            columns={[
              {
                key: 'name',
                label: 'Nama Vendor',
                priority: 'hidden_mobile',
                render: c => <span className="font-semibold text-[#211A2E] dark:text-white">{c.name}</span>
              },
              {
                key: 'code',
                label: 'Kode',
                priority: 'hidden_mobile',
                render: c => (
                  <span className="font-mono text-[#7135B5] dark:text-[#D8B4FE] font-bold">{c.code}</span>
                )
              },
              {
                key: 'leaderName',
                label: 'Leader / Korlap',
                priority: 'primary',
                render: c =>
                  c.leaderName ? (
                    <span className="font-medium text-[#494453] dark:text-[#CEC0E8]">{c.leaderName}</span>
                  ) : (
                    <span className="text-[#8B8495] italic">Belum ada leader</span>
                  )
              },
              {
                key: 'coverageAreas',
                label: 'Coverage Area',
                priority: 'primary',
                render: c => (
                  <div className="flex flex-wrap gap-1">
                    {c.coverageAreas.map(a => (
                      <span
                        key={a}
                        className="px-2 py-0.5 rounded-full bg-[#F5F1FF] dark:bg-[#35105E] text-[10px] font-semibold text-[#431599] dark:text-[#D8B4FE]"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )
              },
              {
                key: 'contact',
                label: 'Kontak',
                priority: 'secondary',
                render: c => (
                  <div className="text-[#766B83] dark:text-[#CEC0E8]">
                    <div>{c.phone || '-'}</div>
                    <div className="text-[11px] text-[#8B8495]">{c.email || ''}</div>
                  </div>
                )
              },
              {
                key: 'status',
                label: 'Status',
                priority: 'hidden_mobile',
                render: c => (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ECFDF5] text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-300">
                    {c.active ? 'Aktif' : 'Nonaktif'}
                  </span>
                )
              }
            ] satisfies ResponsiveColumn<Contractor>[]}
          />
        </div>
      )}

      {/* TAB 2: COVERAGE AREA & CLUSTER */}
      {activeTab === 'coverage' && (
        <div className="card-3d-lavender rounded-2xl p-5 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="font-display font-bold text-[#1F1638] dark:text-white text-sm">
                Wilayah Cakupan &amp; Cluster Layanan
              </h4>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
                Data master area untuk alokasi otomatis penugasan kontraktor dan pemetaan beban kerja.
              </p>
            </div>

            <button
              type="button"
              disabled={!isSuperAdmin || isSaving}
              onClick={() => setShowAddArea(!showAddArea)}
              className="mj-btn-superadmin-primary px-3.5 py-2 rounded-xl font-bold gap-1.5 self-start sm:self-auto cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Coverage Area Baru</span>
            </button>
          </div>

          {showAddArea && isSuperAdmin && (
            <form onSubmit={handleCreateArea} className="p-4 mj-tactile-well border border-[#D8CCF3] dark:border-[#35105E] rounded-xl space-y-3">
              <h5 className="font-display font-bold text-[#1F1638] dark:text-white text-xs">Form Area Baru</h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">Nama Area / Kota *</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Bogor Kota"
                    value={newAreaName}
                    onChange={e => setNewAreaName(e.target.value)}
                    className="w-full px-3 py-2 tactile-debossed-input rounded-xl bg-white dark:bg-[#1E1238] text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">Daftar Cluster (Pisahkan Koma)</label>
                  <input
                    type="text"
                    placeholder="Contoh: Baranangsiang Indah, Pajajaran Hills, Cimahpar Permai"
                    value={newAreaClusters}
                    onChange={e => setNewAreaClusters(e.target.value)}
                    className="w-full px-3 py-2 tactile-debossed-input rounded-xl bg-white dark:bg-[#1E1238] text-xs focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddArea(false)}
                  className="btn-3d-lilac px-3.5 py-2 rounded-xl font-bold text-xs cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="btn-3d-primary px-4 py-2 rounded-xl font-bold text-xs cursor-pointer"
                >
                  Simpan Area
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {coverageAreas.map(area => (
              <div
                key={area.id}
                className="p-4 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#160D29] space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#211A2E] dark:text-white text-sm flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-[#7135B5] dark:text-[#D8B4FE]" />
                    <span>{area.name}</span>
                  </span>
                  <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-[#F0E3FF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE] tabular-nums">
                    {area.clusters.length} Cluster
                  </span>
                </div>

                <div className="pt-1">
                  <span className="text-[10.5px] text-[#766B83] dark:text-[#CEC0E8] uppercase font-semibold block mb-1">Cluster Terdaftar:</span>
                  <div className="flex flex-wrap gap-1">
                    {area.clusters.map(cluster => (
                      <span key={cluster} className="px-2 py-0.5 rounded-lg bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] text-[11px] text-[#494453] dark:text-[#CEC0E8]">
                        {cluster}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: ROOT CAUSE TAXONOMY */}
      {activeTab === 'root_causes' && (
        <div className="card-3d-lavender rounded-2xl p-5 space-y-4 text-xs">
          <div>
            <h4 className="font-display font-bold text-[#1F1638] dark:text-white text-sm">
              Kamus Taksonomi Root Cause &amp; Kendala Teknisi Wi-Fi
            </h4>
            <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
              Kategori ini menjadi pilihan standar teknisi saat mengisi laporan penutupan tiket atau eskalasi gangguan.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Category Selector */}
            <div className="space-y-2">
              <span className="font-semibold text-[#4B4452] dark:text-[#CEC0E8] block mb-1">Pilih Kategori Utama:</span>
              {rootCauseCategories.map((cat, idx) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryIndex(idx)}
                  className={`w-full text-left p-3 rounded-xl transition-all cursor-pointer ${
                    selectedCategoryIndex === idx
                      ? 'btn-3d-primary text-white font-bold'
                      : 'bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] hover:bg-white dark:hover:bg-[#261942] text-[#1F1638] dark:text-[#CEC0E8]'
                  }`}
                >
                  <div className="text-xs">{cat.name}</div>
                  <div className={`text-[10px] font-normal mt-0.5 ${selectedCategoryIndex === idx ? 'text-[#EEDBFF]' : 'text-[#7D7484]'}`}>
                    {cat.items.length} Penyebab Masalah
                  </div>
                </button>
              ))}
            </div>

            {/* Root Causes List in Category */}
            <div className="lg:col-span-2 space-y-4">
              <div className="p-4 bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl border border-[#E8DDFF] dark:border-[#35105E] space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="font-display font-bold text-[#1F1638] dark:text-white text-xs">
                    Daftar Root Cause: {rootCauseCategories[selectedCategoryIndex]?.name}
                  </h5>
                  <span className="text-[11px] font-mono text-[#58149C] dark:text-[#CEC0E8] tabular-nums font-bold">
                    {rootCauseCategories[selectedCategoryIndex]?.items.length} item aktif
                  </span>
                </div>

                {rootCauseCategories[selectedCategoryIndex]?.description && (
                  <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] italic">
                    {rootCauseCategories[selectedCategoryIndex].description}
                  </p>
                )}

                {/* Add new item input */}
                <form onSubmit={handleAddRootCause} className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={!isSuperAdmin || isSaving}
                    placeholder="Tambah penyebab masalah baru..."
                    value={newRootCauseItem}
                    onChange={e => setNewRootCauseItem(e.target.value)}
                    className="flex-1 px-3 py-2 tactile-debossed-input rounded-xl bg-white dark:bg-[#1E1238] text-xs disabled:opacity-60 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!isSuperAdmin || isSaving}
                    className="mj-btn-superadmin-primary px-3.5 py-2 rounded-xl font-bold gap-1 shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Menyimpan...' : 'Tambah'}</span>
                  </button>
                </form>

                {/* Items chips */}
                <div className="space-y-1.5 pt-2">
                  {rootCauseCategories[selectedCategoryIndex]?.items.map(item => (
                    <div
                      key={item}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E]"
                    >
                      <span className="font-medium text-[#211A2E] dark:text-[#CEC0E8]">{item}</span>
                      <button
                        type="button"
                        disabled={!isSuperAdmin || isSaving}
                        onClick={() => handleRemoveRootCause(selectedCategoryIndex, item)}
                        className="text-[#8B8495] hover:text-[#DC4C5A] disabled:opacity-40 disabled:cursor-not-allowed p-1 cursor-pointer"
                        title="Hapus root cause"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: HEADER MAPPING */}
      {activeTab === 'header_mapping' && (
        <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E9E5F0] dark:border-[#35105E] p-5 shadow-[0_1px_3px_rgba(33,26,46,0.04)] space-y-4 text-xs">
          <h4 className="font-bold text-[#211A2E] dark:text-white text-sm">
            Kamus Alias Header Terdaftar ({headerMappings.length} Fields)
          </h4>

          <ResponsiveDataTable
            data={headerMappings}
            getRowKey={m => m.standardField}
            mobileTitle={m => (
              <span className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE]">{m.standardField}</span>
            )}
            mobileSubtitle={m => `${m.label} · ${m.category}`}
            mobileStatus={m =>
              m.required ? (
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-[#DC4C5A] text-[10px] font-bold">
                  Wajib
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[#8B8495] text-[10px] font-semibold">
                  Opsional
                </span>
              )
            }
            columns={[
              {
                key: 'standardField',
                label: 'Standard Field',
                priority: 'hidden_mobile',
                render: mapping => (
                  <span className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE] whitespace-nowrap">
                    {mapping.standardField}
                  </span>
                )
              },
              {
                key: 'label',
                label: 'Label',
                priority: 'hidden_mobile',
                render: mapping => (
                  <span className="font-medium whitespace-nowrap text-[#211A2E] dark:text-white">
                    {mapping.label}
                  </span>
                )
              },
              {
                key: 'category',
                label: 'Kategori',
                priority: 'secondary',
                render: mapping => (
                  <span className="font-mono text-[11px] text-[#766B83] uppercase whitespace-nowrap">
                    {mapping.category}
                  </span>
                )
              },
              {
                key: 'required',
                label: 'Wajib',
                priority: 'hidden_mobile',
                render: mapping =>
                  mapping.required ? (
                    <span className="text-[#DC4C5A] font-bold">Yes</span>
                  ) : (
                    <span className="text-[#8B8495]">Optional</span>
                  )
              },
              {
                key: 'aliases',
                label: 'Daftar Alias (Dipisahkan Koma)',
                priority: 'primary',
                render: mapping => {
                  const isEditing = editingField === mapping.standardField;
                  return isEditing ? (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={aliasInput}
                        onChange={e => setAliasInput(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full p-1.5 min-h-[36px] border border-[#D8CCF3] dark:border-[#35105E] rounded-lg bg-white dark:bg-[#160D29] text-xs"
                      />
                      {isSuperAdmin && (
                        <div className="flex items-center gap-1.5 sm:hidden">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleSaveAliases(mapping.standardField)}
                            className="px-3 py-1.5 bg-[#16A36A] text-white rounded-lg text-xs font-bold cursor-pointer"
                          >
                            {isSaving ? '...' : 'Simpan'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingField(null)}
                            className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            Batal
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[#494453] dark:text-[#CEC0E8] break-words">
                      {mapping.aliases.join(', ')}
                    </span>
                  );
                }
              }
            ]}
            desktopActionHeader="Action"
            getRowActions={mapping => {
              if (!isSuperAdmin) return [];
              const isEditing = editingField === mapping.standardField;
              return isEditing
                ? [
                    {
                      id: 'save',
                      label: isSaving ? 'Menyimpan...' : 'Simpan Alias',
                      icon: <Check className="w-3.5 h-3.5" />,
                      onClick: () => handleSaveAliases(mapping.standardField)
                    },
                    {
                      id: 'cancel',
                      label: 'Batal Edit',
                      onClick: () => setEditingField(null)
                    }
                  ]
                : [
                    {
                      id: 'edit',
                      label: 'Edit Alias',
                      onClick: () => {
                        setEditingField(mapping.standardField);
                        setAliasInput(mapping.aliases.join(', '));
                      }
                    }
                  ];
            }}
            renderDesktopActions={mapping => {
              const isEditing = editingField === mapping.standardField;
              return isEditing && isSuperAdmin ? (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => handleSaveAliases(mapping.standardField)}
                  className="px-2.5 py-1 bg-[#16A36A] disabled:opacity-50 text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  {isSaving ? '...' : 'Simpan'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!isSuperAdmin || isSaving}
                  onClick={() => {
                    setEditingField(mapping.standardField);
                    setAliasInput(mapping.aliases.join(', '));
                  }}
                  className="px-2.5 py-1 bg-[#F7F6FA] dark:bg-[#160D29] hover:bg-[#F0E3FF] disabled:opacity-40 disabled:cursor-not-allowed text-[#431599] dark:text-[#D8B4FE] rounded-lg border border-[#E9E5F0] dark:border-[#35105E] text-xs font-semibold cursor-pointer"
                >
                  Edit
                </button>
              );
            }}
          />
        </div>
      )}

      {/* TAB 5: BRANDING & LOGO */}
      {activeTab === 'branding' && (
        <form onSubmit={handleSaveBranding} className="card-3d-lavender rounded-2xl p-6 space-y-4 text-xs max-w-xl">
          <div className="flex items-center gap-3 pb-3 border-b border-[#EFE7FC] dark:border-[#35105E]">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-b from-[#7135B5] to-[#58149C] text-white flex items-center justify-center font-bold shadow-[0_2px_0_#35105E]">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-display font-bold text-[#1F1638] dark:text-white text-sm">
                Kustomisasi Branding Aplikasi (MoraJaws)
              </h4>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
                Atur nama aplikasi dan warna tema utama yang tampil di seluruh navbar dan header.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">
                Nama Aplikasi
              </label>
              <input
                type="text"
                disabled={!isSuperAdmin || isSaving}
                value={appNameInput}
                onChange={e => setAppNameInput(e.target.value)}
                placeholder="MoraJaws"
                className="w-full px-3 py-2 tactile-debossed-input bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl font-bold text-[#1F1638] dark:text-white text-sm disabled:opacity-60 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[#4B4452] dark:text-[#CEC0E8] font-semibold mb-1">
                Aksen Warna Utama (Brand Color)
              </label>
              <select
                disabled={!isSuperAdmin || isSaving}
                value={appPrimaryColor}
                onChange={e => setAppPrimaryColor(e.target.value)}
                className="w-full px-3 py-2 tactile-debossed-input bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl font-medium disabled:opacity-60 focus:outline-none"
              >
                <option value="indigo">Indigo Modern (MoraJaws Default)</option>
                <option value="blue">Deep Ocean Blue</option>
                <option value="emerald">Emerald Field Operations</option>
                <option value="slate">Monochrome Slate Enterprise</option>
                <option value="violet">Electric Violet</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end pt-2">
            <button
              type="submit"
              disabled={!isSuperAdmin || isSaving}
              className="mj-btn-superadmin-primary px-5 py-2.5 rounded-xl font-bold gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan Konfigurasi Branding'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 6: SESI STAF & OPERASIONAL WIB */}
      {activeTab === 'system_session' && (
        <div className="space-y-5">
          {/* Operational Date WIB Card */}
          <div className="card-3d-lavender rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F5F1FF] dark:bg-[#35105E] border border-[#D8CCF3] dark:border-[#7135B5]/40 text-[#58149C] dark:text-[#D8B4FE] flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-display text-sm font-bold text-[#1F1638] dark:text-white">
                  Tanggal &amp; Zona Waktu Operasional (Asia/Jakarta — WIB)
                </h4>
                <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] mt-0.5">
                  Filter jadwal Appointment Date (Hari Ini, Kemarin, Besok) dihitung presisi berdasarkan zona waktu Indonesia Barat tanpa pergeseran UTC. Sistem otomatis berjalan dinamis sesuai kalender nyata.
                </p>
              </div>
            </div>

            <div className="p-4 bg-[#F8F1FF] dark:bg-[#22123F] rounded-xl border border-[#D8CCF3] dark:border-[#35105E] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#58149C] dark:text-[#D8B4FE] font-bold">
                  Tanggal Operasional Aktif Sistem
                </div>
                <div className="text-xl font-extrabold text-[#1F1638] dark:text-white font-mono tabular-nums mt-0.5">
                  {operationalDate} <span className="text-xs font-semibold text-[#7135B5] dark:text-[#D8B4FE]">(WIB)</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  disabled={!isSuperAdmin || isSaving}
                  value={operationalDateInput}
                  onChange={e => setOperationalDateInput(e.target.value)}
                  className="px-3 py-2 tactile-debossed-input bg-white dark:bg-[#160D29] rounded-xl text-xs font-bold font-mono text-[#1F1638] dark:text-white disabled:opacity-60 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!isSuperAdmin || isSaving}
                  onClick={async () => {
                    if (!isSuperAdmin) return;
                    setIsSaving(true);
                    try {
                      const res = await setOperationalDate(operationalDateInput);
                      if (!res.success) {
                        triggerError(res.error || 'Gagal menyimpan tanggal operasional ke database.');
                        return;
                      }
                      triggerNotice(`Tanggal operasional global diperbarui ke ${operationalDateInput} (WIB)`);
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  className="btn-3d-primary px-4 py-2 text-xs font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSaving ? 'Menyimpan...' : 'Terapkan'}
                </button>
                <button
                  type="button"
                  disabled={!isSuperAdmin || isSaving}
                  onClick={async () => {
                    if (!isSuperAdmin) return;
                    const realDate = getJakartaDateString(0);
                    setIsSaving(true);
                    try {
                      const res = await setOperationalDate(realDate);
                      if (!res.success) {
                        triggerError(res.error || 'Gagal mereset tanggal operasional ke database.');
                        return;
                      }
                      setOperationalDateInput(realDate);
                      triggerNotice(`Tanggal operasional di-reset ke tanggal hari ini (WIB): ${realDate}`);
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  className="btn-3d-lilac px-3.5 py-2 text-xs font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Reset Hari Ini (Aktual WIB)
                </button>
              </div>
            </div>
          </div>

          {/* Session Management Card */}
          <div className="card-3d-lavender rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F5F1FF] dark:bg-[#35105E] border border-[#D8CCF3] dark:border-[#7135B5]/40 text-[#58149C] dark:text-[#D8B4FE] flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-display text-sm font-bold text-[#1F1638] dark:text-white">
                  Manajemen Sesi Staf (Dispatch, Leader, Installer) &amp; Idle Timeout
                </h4>
                <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] mt-0.5">
                  Pantau sesi staf yang aktif, revokasi akses perangkat yang mencurigakan, dan atur batas waktu inaktivitas (idle timeout) serta batas sesi bersamaan.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 mj-tactile-well border border-[#E8DDFF] dark:border-[#35105E] rounded-xl">
              <div className="space-y-1.5 text-xs text-[#4B4452] dark:text-[#CEC0E8]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Autentikasi role server-side tanpa token rahasia di client</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#7135B5] dark:bg-[#A855F7]" />
                  <span>Sesi otomatis kedaluwarsa setelah idle timeout tercapai</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsSessionModalOpen(true)}
                className="btn-3d-primary px-5 py-2.5 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <KeyRound className="w-4 h-4" />
                <span>Buka Panel Manajemen Sesi Staf</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB: DROPLIST MANAGEMENT (CONSOLIDATED) */}
      {activeTab === 'report_dropdowns' && (
        <DroplistManagementView />
      )}

      {/* TAB: SOUND & AUDIO NOTIFICATIONS */}
      {activeTab === 'sound_settings' && (
        <SoundSettingsView />
      )}
    </div>
  );
};
