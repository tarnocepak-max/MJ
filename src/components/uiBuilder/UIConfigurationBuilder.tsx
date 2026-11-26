import React, { useState } from 'react';
import { useUIConfig } from '../../context/UIConfigContext';
import {
  Columns3,
  Palette,
  LayoutTemplate,
  Layers,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Save,
  Check,
  Upload,
  Plus,
  Trash2,
  Sparkles,
  Smartphone,
  Monitor,
  FolderTree,
  Database,
  Cloud,
  CloudUpload,
  CloudDownload,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  FileJson,
  Sliders,
  Lock
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TableColumnsStudio } from './TableColumnsStudio';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { ColumnConfig, DEFAULT_LEADER_COLUMNS } from '../portals/LeaderColumnSettingsModal';
import { mergeLeaderColumnsConfig } from '../../utils/uiLayoutHelpers';
import { safeLocalStorageGet, safeLocalStorageSet, safeLocalStorageRemove } from '../../utils/safeStorage';

interface UIConfigurationBuilderProps {
  onNavigateToTickets?: () => void;
}

export const UIConfigurationBuilder: React.FC<UIConfigurationBuilderProps> = ({
  onNavigateToTickets
}) => {
  const {
    config,
    updateDraft,
    resetToDefaults,
    applyPreset,
    saveCurrentAsPreset,
    deletePreset,
    navigationItems,
    menuCategories,
    exportConfigJson,
    importConfigJson,
    saveConfigToSupabase,
    loadConfigFromSupabase,
    isCloudSyncing,
    lastCloudSyncTime,
    cloudSyncStatus,
    uiConfigVersion,
    uiConflict,
    clearUiConflict,
    resolveUiConflict
  } = useUIConfig();

  const { currentUser, users } = useApp();
  const isSuperAdmin = currentUser?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState<'table_columns' | 'leader_columns' | 'device_layout' | 'toolbar' | 'detail_sections' | 'global_theme' | 'presets' | 'json' | 'supabase_config'>('table_columns');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<'pull' | 'reset_ui' | null>(null);

  const leaderUsers = React.useMemo(
    () => (users || []).filter(u => String(u.role || '').toLowerCase() === 'leader' && u.active !== false && !u.isDeleted),
    [users]
  );
  const [leaderColumnScope, setLeaderColumnScope] = useState<string>('global');
  const readLeaderColumnsForScope = (scopeKey: string): ColumnConfig[] => {
    try {
      const direct = safeLocalStorageGet(`morajaws_leader_columns_${scopeKey}`);
      if (direct) return mergeLeaderColumnsConfig(JSON.parse(direct), DEFAULT_LEADER_COLUMNS);
      const globalRaw = safeLocalStorageGet('morajaws_leader_columns_global');
      if (globalRaw) return mergeLeaderColumnsConfig(JSON.parse(globalRaw), DEFAULT_LEADER_COLUMNS);
    } catch {}
    return DEFAULT_LEADER_COLUMNS.map(col => ({ ...col }));
  };
  const [leaderColumns, setLeaderColumns] = useState<ColumnConfig[]>(() => readLeaderColumnsForScope('global'));

  React.useEffect(() => {
    setLeaderColumns(readLeaderColumnsForScope(leaderColumnScope));
  }, [leaderColumnScope]);

  const persistLeaderColumns = (nextCols: ColumnConfig[], noticeText: string) => {
    if (!isSuperAdmin) return;
    setLeaderColumns(nextCols);
    safeLocalStorageSet(`morajaws_leader_columns_${leaderColumnScope}`, JSON.stringify(nextCols));
    window.dispatchEvent(new CustomEvent('morajaws:leader-columns-updated', { detail: { scope: leaderColumnScope } }));
    triggerNotice(noticeText);
  };

  // New preset modal state
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');
  const [showPresetModal, setShowPresetModal] = useState(false);

  // JSON import state
  const [jsonInput, setJsonInput] = useState('');

  const triggerNotice = (msg: string) => {
    setErrorMessage(null);
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3500);
  };

  const triggerError = (msg: string) => {
    setSuccessMessage(null);
    setErrorMessage(msg);
  };

  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    if (!isSuperAdmin) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= config.ticketDetail.sections.length) return;
    updateDraft(prev => {
      const sections = [...prev.ticketDetail.sections];
      const [moved] = sections.splice(index, 1);
      sections.splice(targetIndex, 0, moved);
      return {
        ...prev,
        ticketDetail: {
          ...prev.ticketDetail,
          sections: sections.map((sec, idx) => ({ ...sec, order: idx + 1 }))
        }
      };
    });
    triggerNotice('Urutan section detail diperbarui di draft.');
  };

  const handleSavePreset = async () => {
    if (!isSuperAdmin) return;
    if (!newPresetName.trim()) {
      triggerError('Nama preset wajib diisi.');
      return;
    }
    const res = await saveCurrentAsPreset(newPresetName.trim(), newPresetDesc.trim() || 'Custom view preset');
    if (res.success) {
      setNewPresetName('');
      setNewPresetDesc('');
      setShowPresetModal(false);
      triggerNotice('Preset tampilan baru berhasil disimpan permanen ke Supabase PostgreSQL!');
    } else {
      triggerError(res.error || 'Gagal menyimpan preset ke database.');
    }
  };

  const handleExport = () => {
    const jsonStr = exportConfigJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Dispatch_UI_Config_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerNotice('Konfigurasi UI berhasil diekspor.');
  };

  const handleImport = async () => {
    if (!isSuperAdmin || !jsonInput.trim()) return;
    const res = await importConfigJson(jsonInput);
    if (res.success) {
      setJsonInput('');
      triggerNotice('Konfigurasi UI berhasil diimpor & disimpan ke Supabase PostgreSQL!');
    } else {
      triggerError(res.error || 'Format JSON konfigurasi tidak valid atau gagal disimpan ke database.');
    }
  };

  const handleUploadToSupabase = async () => {
    if (!isSuperAdmin) {
      triggerError('Akses Ditolak: Hanya Super Admin yang dapat menyimpan konfigurasi UI global.');
      return;
    }
    try {
      const res = await saveConfigToSupabase(currentUser?.name || 'Super Admin');
      if (res.success) {
        triggerNotice(
          `Konfigurasi UI berhasil disimpan ke Supabase PostgreSQL sebagai Database Configuration App! (${res.updatedAt ? new Date(res.updatedAt).toLocaleTimeString('id-ID') : ''})`
        );
      } else {
        triggerError('Gagal menyimpan konfigurasi ke Supabase PostgreSQL: ' + (res.error || 'Terjadi kesalahan'));
      }
    } catch (e: any) {
      triggerError('Gagal mengupload: ' + (e?.message || String(e)));
    }
  };

  const executeConfirmAction = async () => {
    const action = confirmModal;
    setConfirmModal(null);
    if (action === 'pull') {
      try {
        const res = await loadConfigFromSupabase();
        if (res.success) {
          triggerNotice('Konfigurasi UI berhasil ditarik dan disinkronkan dari Supabase PostgreSQL!');
        } else {
          triggerError('Gagal memuat konfigurasi dari Supabase PostgreSQL: ' + (res.error || 'Data belum tersedia'));
        }
      } catch (e: any) {
        triggerError('Gagal memuat: ' + (e?.message || String(e)));
      }
    } else if (action === 'reset_ui') {
      if (!isSuperAdmin) return;
      const res = await resetToDefaults();
      if (res.success) {
        triggerNotice('Konfigurasi berhasil direset dan disimpan ke standar sistem di database.');
      } else {
        triggerError(res.error || 'Gagal mereset konfigurasi UI di database.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {!isSuperAdmin && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>Mode Baca (Read-Only):</strong> Perubahan UI & Layout Configuration Global hanya dapat disimpan oleh <strong>Super Admin</strong>.
          </span>
        </div>
      )}

      {/* Sub-Tabs Switcher */}
      <div className="card-3d-lavender rounded-2xl px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="mj-tactile-tab-bar p-1 rounded-xl flex items-center gap-1.5 text-xs font-semibold flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('table_columns')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'table_columns'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span>Kolom &amp; Ergonomi Tabel ({config.ticketsTable.columns.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('leader_columns')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'leader_columns'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Kolom Tabel Leader ({leaderColumns.filter(c => c.visible).length}/{leaderColumns.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('device_layout')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'device_layout'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Kartu WO, Android &amp; PC</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('toolbar')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'toolbar'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            <span>Toolbar &amp; Aksi</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('detail_sections')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'detail_sections'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Ticket Detail</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('global_theme')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'global_theme'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Tema Global</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'presets'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Presets ({config.ticketsTable.presets.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('json')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'json'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Backup JSON</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('supabase_config')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'supabase_config'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-white hover:bg-white/70 dark:hover:bg-[#35105E]/50'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Cloud Sync (v{uiConfigVersion})</span>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setConfirmModal('pull')}
            disabled={isCloudSyncing}
            className="btn-3d-lilac px-3 py-1.5 text-[11px] font-bold rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <CloudDownload className="w-3.5 h-3.5" />
            <span>Tarik dari Supabase</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmModal('reset_ui')}
            disabled={!isSuperAdmin || isCloudSyncing}
            className="btn-3d-ceramic px-3 py-1.5 text-[11px] font-bold rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Semua</span>
          </button>
        </div>
      </div>

      {uiConflict && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5 text-amber-900 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Konflik Versi Konfigurasi Terdeteksi ({uiConflict.key})</div>
              <div className="text-[11px] opacity-90 mt-0.5">
                Versi server saat ini v{uiConflict.currentVersion} (diperbarui oleh {uiConflict.updatedBy || 'Admin lain'}), sementara sesi Anda v{uiConflict.expectedVersion}.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => resolveUiConflict('reload')}
              className="btn-3d-ceramic px-3 py-1.5 rounded-lg font-bold cursor-pointer"
            >
              Muat Versi Terbaru
            </button>
            <button
              type="button"
              onClick={() => resolveUiConflict('overwrite')}
              className="btn-3d-primary px-3 py-1.5 rounded-lg font-bold cursor-pointer"
            >
              Timpa Versi Server
            </button>
            <button
              type="button"
              onClick={clearUiConflict}
              className="px-2 py-1.5 text-amber-700 dark:text-amber-300 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={handleUploadToSupabase}
              disabled={isCloudSyncing}
              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-semibold shrink-0 cursor-pointer"
            >
              Coba Simpan Ulang
            </button>
          )}
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-[#ECFDF5] dark:bg-emerald-950/40 border border-[#A7F3D0] dark:border-emerald-800 text-[#16A36A] dark:text-emerald-300 rounded-xl text-xs font-medium flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Tab: Database Configuration App (Supabase PostgreSQL Master Storage) */}
      {activeTab === 'supabase_config' && (
        <div className="space-y-6">
          {/* Hero Banner */}
          <div className="bg-gradient-to-br from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#160D29] dark:via-[#27104A] dark:to-[#1A0D36] text-[#26364A] dark:text-white rounded-2xl p-6 sm:p-7 shadow-sm dark:shadow-xl border border-[#C5BEEF] dark:border-[#35105E] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-[#9E95DE]/20 dark:bg-[#A855F7]/15 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#DDF4F4] dark:bg-gradient-to-r dark:from-[#6b103b] dark:to-[#480123] text-[#2E7D8B] dark:text-white border border-[#BDE4E8] dark:border-white/15 flex items-center gap-1.5">
                    <Cloud className="w-3 h-3 text-[#2E7D8B] dark:text-[#DAB9FF]" />
                    Supabase PostgreSQL Real-Time Config
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-white/80 dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#7135B5]/40">
                    app_settings/ui_configuration
                  </span>
                </div>
                <h3 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#26364A] dark:text-white flex items-center gap-2.5">
                  <Database className="w-6 h-6 text-[#5145A6] dark:text-[#D8B4FE]" />
                  Database Configuration App
                </h3>
                <p className="text-xs sm:text-sm text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                  Jadikan tata letak UI, susunan menu, visibilitas kolom tabel, dan preferensi perangkat sebagai <strong>Database Configuration App</strong> terpusat di Supabase PostgreSQL. Seluruh pengguna dan perangkat (Android &amp; PC) akan otomatis menggunakan konfigurasi baku ini secara real-time.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                <button
                  onClick={handleUploadToSupabase}
                  disabled={!isSuperAdmin || isCloudSyncing}
                  className="btn-3d-emerald px-4 py-2.5 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCloudSyncing ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4" />
                  )}
                  <span>Upload ke Supabase Sekarang</span>
                </button>

                <button
                  onClick={() => setConfirmModal('pull')}
                  disabled={isCloudSyncing}
                  className="btn-3d-lilac px-4 py-2.5 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <CloudDownload className="w-4 h-4" />
                  <span>Tarik dari Cloud</span>
                </button>
              </div>
            </div>

            {/* Status Information Bar */}
            <div className="mt-6 pt-4 border-t border-[#C5BEEF]/70 dark:border-[#35105E] grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-[#52647A] dark:text-[#CEC0E8]/75 text-[11px]">Status Sinkronisasi:</p>
                <p className="font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400"></span>
                  {cloudSyncStatus === 'synced' ? `Tersimpan & Aktif (v${uiConfigVersion})` : cloudSyncStatus === 'syncing' ? 'Sedang Sinkronisasi...' : cloudSyncStatus === 'error' ? 'Gagal Terhubung' : 'Konfigurasi Lokal'}
                </p>
              </div>

              <div>
                <p className="text-[#52647A] dark:text-[#CEC0E8]/75 text-[11px]">Terakhir Di-upload:</p>
                <p className="font-semibold text-[#26364A] dark:text-white mt-0.5 font-mono tabular-nums">
                  {lastCloudSyncTime ? new Date(lastCloudSyncTime).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum di-upload'}
                </p>
              </div>

              <div>
                <p className="text-[#52647A] dark:text-[#CEC0E8]/75 text-[11px]">Pengunggah Terakhir:</p>
                <p className="font-semibold text-[#26364A] dark:text-white mt-0.5">
                  {currentUser?.name || 'Super Admin'} ({currentUser?.role || 'Admin'})
                </p>
              </div>

              <div>
                <p className="text-[#52647A] dark:text-[#CEC0E8]/75 text-[11px]">Supabase Table / Key:</p>
                <p className="font-mono text-[#5145A6] dark:text-[#D8B4FE] text-[11px] mt-0.5 truncate">
                  app_settings / ui_configuration
                </p>
              </div>
            </div>
          </div>

          {/* Component Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card-3d-lavender rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#52647A] dark:text-[#CEC0E8] font-semibold">Kolom Tabel WO</span>
                <Columns3 className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
              </div>
              <p className="font-display text-xl font-extrabold text-[#26364A] dark:text-white mt-2 tabular-nums">
                {config.ticketsTable.columns.filter(c => c.visible).length} <span className="text-xs font-normal text-[#8492A5] dark:text-[#CEC0E8]">/ {config.ticketsTable.columns.length} Aktif</span>
              </p>
              <p className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8]/80 mt-1">
                Tersimpan di properti `ticketsTable.columns`
              </p>
            </div>

            <div className="card-3d-lavender rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#52647A] dark:text-[#CEC0E8] font-semibold">Susunan Menu Navigasi</span>
                <FolderTree className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="font-display text-xl font-extrabold text-[#26364A] dark:text-white mt-2 tabular-nums">
                {navigationItems.filter(i => i.visible).length} <span className="text-xs font-normal text-[#8492A5] dark:text-[#CEC0E8]">Menu ({menuCategories.length} Kategori)</span>
              </p>
              <p className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8]/80 mt-1">
                Tersimpan di properti `navigationItems`
              </p>
            </div>

            <div className="card-3d-lavender rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#52647A] dark:text-[#CEC0E8] font-semibold">Mode Perangkat</span>
                <Smartphone className="w-4 h-4 text-[#2E7D8B] dark:text-[#D8B4FE]" />
              </div>
              <p className="font-display text-xl font-extrabold text-[#26364A] dark:text-white mt-2 capitalize">
                {config.device?.mode || 'Auto'}
              </p>
              <p className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8]/80 mt-1">
                Android: {config.device?.android?.layoutType === 'cards' ? 'Card View' : 'Table'}, PC: Compact
              </p>
            </div>

            <div className="card-3d-lavender rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#52647A] dark:text-[#CEC0E8] font-semibold">Preset &amp; Tema Global</span>
                <Palette className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
              </div>
              <p className="font-display text-xl font-extrabold text-[#26364A] dark:text-white mt-2 tabular-nums">
                {config.ticketsTable.presets.length} Preset <span className="text-xs font-normal text-[#8492A5] dark:text-[#CEC0E8] capitalize">({config.global.themeMode})</span>
              </p>
              <p className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8]/80 mt-1">
                Densitas: {config.global.density}, Skala Font: {config.global.fontScale}
              </p>
            </div>
          </div>

          {/* Detailed Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Action 1: Upload Card */}
            <div className="card-3d-lavender rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] flex items-center justify-center shrink-0 border border-[#C5BEEF] dark:border-[#7135B5]/40">
                  <CloudUpload className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm">
                    Simpan &amp; Upload ke Supabase
                  </h4>
                  <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                    Jadikan konfigurasi lokal saat ini sebagai database configuration app baku.
                  </p>
                </div>
              </div>

              <div className="p-3.5 mj-tactile-well border border-[#DDE6F0] dark:border-[#35105E] rounded-xl text-xs text-[#52647A] dark:text-[#CEC0E8] space-y-1.5 leading-relaxed">
                <p className="font-semibold text-[#26364A] dark:text-white">Yang akan disimpan ke Supabase PostgreSQL:</p>
                <ul className="list-disc list-inside space-y-1 text-[#8492A5] dark:text-[#CEC0E8]/90 text-[11px]">
                  <li>Visibilitas, urutan, dan pengaturan {config.ticketsTable.columns.length} kolom tabel Work Order</li>
                  <li>Susunan dan urutan {navigationItems.length} menu navigasi di {menuCategories.length} kategori</li>
                  <li>Pengaturan khusus layar sentuh Android (Navigasi bawah, kartu responsif)</li>
                  <li>Pengaturan efisiensi layar PC Desktop (Sticky column, scroll kompak)</li>
                  <li>Seluruh preset tampilan kolom yang tersimpan ({config.ticketsTable.presets.length} preset)</li>
                  <li>Pengaturan tema global ({config.global.themeMode}, {config.global.density})</li>
                </ul>
              </div>

              <button
                onClick={handleUploadToSupabase}
                disabled={!isSuperAdmin || isCloudSyncing}
                className="btn-3d-primary w-full py-2.5 px-4 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                {isCloudSyncing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudUpload className="w-4 h-4" />
                )}
                <span>Simpan Sekarang ke Supabase PostgreSQL</span>
              </button>
            </div>

            {/* Action 2: Pull / Sync Card */}
            <div className="card-3d-lavender rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
                  <CloudDownload className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm">
                    Tarik Konfigurasi dari Supabase
                  </h4>
                  <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                    Muat konfigurasi master yang tersimpan di cloud database ke sesi Anda.
                  </p>
                </div>
              </div>

              <div className="p-3.5 mj-tactile-well border border-[#DDE6F0] dark:border-[#35105E] rounded-xl text-xs text-[#52647A] dark:text-[#CEC0E8] space-y-1.5 leading-relaxed">
                <p className="font-semibold text-[#26364A] dark:text-white">Manfaat Sinkronisasi dari Cloud:</p>
                <ul className="list-disc list-inside space-y-1 text-[#8492A5] dark:text-[#CEC0E8]/90 text-[11px]">
                  <li>Menerapkan perubahan layout yang dibuat oleh Super Admin dari perangkat lain</li>
                  <li>Mengembalikan tampilan ke konfigurasi baku cloud jika pengaturan lokal berubah</li>
                  <li>Memastikan kolom dan urutan menu selaras dengan tim operasional pusat</li>
                  <li>Bekerja secara real-time tanpa perlu me-reload atau menghapus cache browser</li>
                </ul>
              </div>

              <button
                onClick={() => setConfirmModal('pull')}
                disabled={isCloudSyncing}
                className="btn-3d-lilac w-full py-2.5 px-4 disabled:opacity-60 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                {isCloudSyncing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudDownload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                )}
                <span>Tarik &amp; Terapkan dari Supabase</span>
              </button>
            </div>
          </div>

          {/* Document Preview & JSON Schema */}
          <div className="card-3d-lavender rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <FileJson className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
                <h4 className="font-display font-bold text-[#26364A] dark:text-white text-xs uppercase tracking-wider">
                  Pratinjau Record Supabase (app_settings/ui_configuration)
                </h4>
              </div>
              <span className="text-[11px] text-[#8492A5] dark:text-[#D8B4FE] font-mono">
                Document Schema: AppSetting
              </span>
            </div>

            <div className="p-3.5 bg-[#1B2738] dark:bg-[#160D29] rounded-xl overflow-x-auto text-[11px] font-mono text-[#DDF4F4] dark:text-[#D8B4FE] max-h-72 border border-[#26364A] dark:border-[#35105E]">
              <pre>{JSON.stringify({
                id: 'ui_configuration',
                app: 'MoraJaws',
                type: 'database_configuration_app',
                updatedAt: lastCloudSyncTime || new Date().toISOString(),
                updatedBy: currentUser?.name || 'Super Admin',
                configSummary: {
                  theme: config.global.themeMode,
                  density: config.global.density,
                  deviceMode: config.device?.mode,
                  activeColumnsCount: config.ticketsTable.columns.filter(c => c.visible).length,
                  totalColumnsCount: config.ticketsTable.columns.length,
                  navigationItemsCount: navigationItems.length,
                  menuCategoriesCount: menuCategories.length,
                  presetsCount: config.ticketsTable.presets.length
                },
                navigationCategories: menuCategories
              }, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Tab 0: Android & PC Specific Settings (Fitur Setting UI Khusus Android dan PC) */}
      {activeTab === 'device_layout' && (
        <div className="space-y-6">
          {/* Quick Preset Actions */}
          <div className="card-3d-lavender rounded-2xl p-5 bg-gradient-to-r from-[#EAE8FF] to-[#DDF4F4] dark:from-[#1E1238] dark:to-[#27104A]">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
                  <span>Preset Ergonomis Siap Pakai (1-Klik)</span>
                </h4>
                <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-1">
                  Terapkan tata letak instan yang disesuaikan untuk kenyamanan penggunaan Android (Layar Sentuh) atau PC (Monitor Lebar).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  disabled={!isSuperAdmin || isCloudSyncing}
                  onClick={() => {
                    if (!isSuperAdmin) return;
                    updateDraft(prev => ({
                      ...prev,
                      global: { ...prev.global, contentWidth: 'full', density: 'comfortable', sidebarState: 'closed', sidebarCollapsed: true },
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
                      ticketsTable: { ...prev.ticketsTable, rowsPerPage: 10, density: 'comfortable' }
                    }));
                    triggerNotice('Profil kenyamanan Android diterapkan di draft. Klik "Simpan & Upload ke Supabase" untuk menyimpan ke database.');
                  }}
                  className="btn-3d-emerald px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Terapkan Preset Android / HP</span>
                </button>

                <button
                  disabled={!isSuperAdmin || isCloudSyncing}
                  onClick={() => {
                    if (!isSuperAdmin) return;
                    updateDraft(prev => ({
                      ...prev,
                      global: { ...prev.global, contentWidth: 'full', density: 'compact', sidebarState: 'expanded', sidebarCollapsed: false },
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
                      ticketsTable: { ...prev.ticketsTable, rowsPerPage: 20, density: 'compact' }
                    }));
                    triggerNotice('Profil produktivitas PC diterapkan di draft. Klik "Simpan & Upload ke Supabase" untuk menyimpan ke database.');
                  }}
                  className="btn-3d-primary px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Monitor className="w-4 h-4" />
                  <span>Terapkan Preset PC / Desktop</span>
                </button>

                <button
                  disabled={!isSuperAdmin || isCloudSyncing}
                  onClick={() => {
                    if (!isSuperAdmin) return;
                    updateDraft(prev => ({ ...prev, device: { ...prev.device, mode: 'auto' } }));
                    triggerNotice('Mode adaptif otomatis diterapkan di draft.');
                  }}
                  className="btn-3d-lilac px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <span>Reset ke Auto</span>
                </button>
              </div>
            </div>
          </div>

          {/* Active Mode Switcher */}
          <div className="card-3d-lavender rounded-2xl p-5 space-y-3">
            <h5 className="font-display font-bold text-[#52647A] dark:text-[#D8B4FE] text-xs uppercase tracking-wider">
              Pilihan Mode Perangkat Utama
            </h5>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                  config.device?.mode === 'auto'
                    ? 'border-[#6657C8] dark:border-[#7135B5] ring-2 ring-[#6657C8]/20 dark:ring-[#7135B5]/20 bg-[#EAE8FF]/70 dark:bg-[#2E1859]/60'
                    : 'border-[#DDE6F0] dark:border-[#35105E] hover:border-[#9E95DE] dark:hover:border-[#A855F7]'
                }`}
              >
                <input
                  type="radio"
                  name="device_mode"
                  disabled={!isSuperAdmin}
                  checked={config.device?.mode === 'auto'}
                  onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, mode: 'auto' } }))}
                  className="mt-0.5 text-[#5145A6] dark:text-[#7135B5] focus:ring-[#6657C8]"
                />
                <div>
                  <div className="font-semibold text-[#26364A] dark:text-white text-xs flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                    <span>Otomatis (Adaptif)</span>
                  </div>
                  <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-1 leading-relaxed">
                    Menyesuaikan tampilan secara otomatis sesuai lebar layar perangkat saat dibuka (HP = Kartu, PC = Tabel).
                  </p>
                </div>
              </label>

              <label
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                  config.device?.mode === 'android'
                    ? 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/30'
                    : 'border-[#DDE6F0] dark:border-[#35105E] hover:border-[#9E95DE] dark:hover:border-[#A855F7]'
                }`}
              >
                <input
                  type="radio"
                  name="device_mode"
                  disabled={!isSuperAdmin}
                  checked={config.device?.mode === 'android'}
                  onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, mode: 'android' } }))}
                  className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <div className="font-semibold text-[#26364A] dark:text-white text-xs flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Paksa Mode Android / HP</span>
                  </div>
                  <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-1 leading-relaxed">
                    Mengaktifkan tata letak sentuh jempol, kartu tiket besar, dan navigasi bawah bahkan saat dibuka di PC.
                  </p>
                </div>
              </label>

              <label
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                  config.device?.mode === 'pc'
                    ? 'border-[#2E7D8B] dark:border-[#7135B5] ring-2 ring-[#2E7D8B]/20 dark:ring-[#7135B5]/20 bg-[#DDF4F4]/70 dark:bg-[#2E1859]/60'
                    : 'border-[#DDE6F0] dark:border-[#35105E] hover:border-[#9E95DE] dark:hover:border-[#A855F7]'
                }`}
              >
                <input
                  type="radio"
                  name="device_mode"
                  disabled={!isSuperAdmin}
                  checked={config.device?.mode === 'pc'}
                  onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, mode: 'pc' } }))}
                  className="mt-0.5 text-[#2E7D8B] dark:text-[#7135B5] focus:ring-[#2E7D8B]"
                />
                <div>
                  <div className="font-semibold text-[#26364A] dark:text-white text-xs flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#D8B4FE]" />
                    <span>Paksa Mode PC / Desktop</span>
                  </div>
                  <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-1 leading-relaxed">
                    Mengunci tampilan ke mode tabel data intensif, multi-kolom, dan tombol toolbar desktop lengkap.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Section A: Android Specific Settings */}
          <div className="card-3d-lavender rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-display font-bold text-[#26364A] dark:text-white text-xs">
                  Pengaturan Ergonomis Android / HP (Layar Sentuh)
                </h4>
                <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                  Optimalkan pengalaman pengoperasian dengan jempol satu tangan, visibilitas di lapangan, dan tombol sentuh nyaman.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Option 1: Layout Type on Mobile */}
              <div className="p-3.5 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F4F7FB] dark:bg-[#160D29]/60 space-y-2">
                <label className="font-semibold text-[#26364A] dark:text-white block">
                  Tipe Tampilan Tiket di Android
                </label>
                <p className="text-[11px] text-slate-500 leading-normal mb-2">
                  Format kartu memuat seluruh ringkasan tanpa perlu scroll menyamping (sangat nyaman di smartphone).
                </p>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="android_layoutType"
                      disabled={!isSuperAdmin}
                      checked={config.device?.android?.layoutType === 'cards'}
                      onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, layoutType: 'cards' } } }))}
                      className="text-emerald-600"
                    />
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      Kartu Responsif (Sangat Direkomendasikan)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="android_layoutType"
                      disabled={!isSuperAdmin}
                      checked={config.device?.android?.layoutType === 'compact_table'}
                      onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, layoutType: 'compact_table' } } }))}
                      className="text-emerald-600"
                    />
                    <span className="text-slate-700 dark:text-slate-300">
                      Tabel Grid Kompak (Scroll Horizontal)
                    </span>
                  </label>
                </div>
              </div>

              {/* Option 2: Touch Target Padding */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Ukuran Target Sentuh Tombol (Touch Target Size)
                </label>
                <p className="text-[11px] text-slate-500 leading-normal mb-2">
                  Atur ketinggian tombol aksi agar mudah disentuh jempol saat berjalan atau memakai sarung tangan.
                </p>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="android_touchTargetSize"
                      disabled={!isSuperAdmin}
                      checked={config.device?.android?.touchTargetSize === 'comfortable'}
                      onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, touchTargetSize: 'comfortable' } } }))}
                      className="text-emerald-600"
                    />
                    <span>Standar Nyaman (48px - Standar Android Material)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="android_touchTargetSize"
                      disabled={!isSuperAdmin}
                      checked={config.device?.android?.touchTargetSize === 'large'}
                      onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, touchTargetSize: 'large' } } }))}
                      className="text-emerald-600"
                    />
                    <span>Ekstra Besar (54px - Sangat Mudah Ditekan di Lapangan)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="android_touchTargetSize"
                      disabled={!isSuperAdmin}
                      checked={config.device?.android?.touchTargetSize === 'compact'}
                      onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, touchTargetSize: 'compact' } } }))}
                      className="text-emerald-600"
                    />
                    <span>Ringkas (40px)</span>
                  </label>
                </div>
              </div>

              {/* Option 3: Bottom Navigation Bar */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 dark:text-slate-200">
                    Bilah Navigasi Bawah (Bottom Navigation Dock)
                  </label>
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={config.device?.android?.showBottomNavigation !== false}
                    onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, showBottomNavigation: e.target.checked } } }))}
                    className="rounded text-emerald-600 w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Menampilkan menu navigasi permanen di bagian bawah layar Android dalam jangkauan jempol (Dashboard, Tiket, Import WO, WhatsApp, Menu).
                </p>
              </div>

              {/* Option 4: Quick Action Buttons on Cards */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Tombol Cepat di Kartu Tiket
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!isSuperAdmin}
                      checked={config.device?.android?.showQuickWhatsApp !== false}
                      onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, showQuickWhatsApp: e.target.checked } } }))}
                      className="rounded text-emerald-600"
                    />
                    <span>Tombol WhatsApp URL Langsung (1-Sentuhan)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!isSuperAdmin}
                      checked={config.device?.android?.showQuickCall !== false}
                      onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, showQuickCall: e.target.checked } } }))}
                      className="rounded text-emerald-600"
                    />
                    <span>Tombol Panggil Telepon Langsung (tel:)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!isSuperAdmin}
                      checked={config.device?.android?.showQuickDetail !== false}
                      onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, showQuickDetail: e.target.checked } } }))}
                      className="rounded text-emerald-600"
                    />
                    <span>Tombol Buka Detail & Penugasan</span>
                  </label>
                </div>
              </div>

              {/* Option 5: Outdoor Visibility */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 dark:text-slate-200">
                    Badge Kontras Tinggi (High Contrast)
                  </label>
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={config.device?.android?.highContrastBadges !== false}
                    onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, highContrastBadges: e.target.checked } } }))}
                    className="rounded text-emerald-600 w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Menguatkan warna dan kontras status agar tetap terbaca jelas di bawah sinar matahari saat di luar ruangan.
                </p>
              </div>

              {/* Option 6: Auto-close sidebar on mobile navigation */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 dark:text-slate-200">
                    Otomatis Tutup Menu Saat Memilih Halaman
                  </label>
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={config.device?.android?.autoCloseSidebarOnNavigate !== false}
                    onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, android: { ...prev.device.android, autoCloseSidebarOnNavigate: e.target.checked } } }))}
                    className="rounded text-emerald-600 w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Secara otomatis menyembunyikan drawer menu setelah pengguna mengklik tab menu untuk memaksimalkan ruang baca konten.
                </p>
              </div>

              {/* Option 7: Ticket WO Card Density */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2 md:col-span-2">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Kepadatan Tampilan Kartu Ticket WO (TicketMobileCard)
                </label>
                <p className="text-[11px] text-slate-500 leading-normal mb-2">
                  Mengatur jarak dan padding kartu Ticket WO pada mode layar sentuh / Mobile View.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    { value: 'compact', label: 'Compact (Ringkas)' },
                    { value: 'comfortable', label: 'Comfortable (Standar)' },
                    { value: 'spacious', label: 'Spacious (Lega)' }
                  ] as const).map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg border border-[#DDE6F0] dark:border-[#35105E] bg-white/75 dark:bg-[#1E1238]/60">
                      <input
                        type="radio"
                        name="android_cardDensity"
                        disabled={!isSuperAdmin}
                        checked={(config.device?.android?.cardDensity || 'comfortable') === opt.value}
                        onChange={() =>
                          updateDraft(prev => ({
                            ...prev,
                            device: {
                              ...prev.device,
                              android: { ...prev.device.android, cardDensity: opt.value }
                            }
                          }))
                        }
                        className="text-emerald-600"
                      />
                      <span className="font-medium text-slate-800 dark:text-slate-200">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section B: PC Specific Settings */}
          <div className="card-3d-lavender rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
              <div className="w-8 h-8 rounded-xl bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] flex items-center justify-center">
                <Monitor className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-display font-bold text-[#26364A] dark:text-white text-xs">
                  Pengaturan Produktivitas PC / Desktop (Monitor Lebar)
                </h4>
                <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                  Maksimalkan efisiensi multitasking dengan grid kepadatan tinggi, pin kolom, dan pemanfaatan layar hingga 1600px+.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Option 1: PC Table Row Density */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Kerapatan Baris Grid PC
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pc_tableDensity"
                      disabled={!isSuperAdmin}
                      checked={config.device?.pc?.tableDensity === 'compact'}
                      onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, pc: { ...prev.device.pc, tableDensity: 'compact' } } }))}
                      className="text-blue-600"
                    />
                    <span>Ringkas / Compact (24px - Menampilkan data maksimal per halaman)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pc_tableDensity"
                      disabled={!isSuperAdmin}
                      checked={config.device?.pc?.tableDensity === 'comfortable'}
                      onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, pc: { ...prev.device.pc, tableDensity: 'comfortable' } } }))}
                      className="text-blue-600"
                    />
                    <span>Standar Seimbang (36px)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pc_tableDensity"
                      disabled={!isSuperAdmin}
                      checked={config.device?.pc?.tableDensity === 'spacious'}
                      onChange={() => updateDraft(prev => ({ ...prev, device: { ...prev.device, pc: { ...prev.device.pc, tableDensity: 'spacious' } } }))}
                      className="text-blue-600"
                    />
                    <span>Luas (48px)</span>
                  </label>
                </div>
              </div>

              {/* Option 2: Sticky Columns */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 dark:text-slate-200">
                    Kunci Kolom Tabel (Sticky Columns)
                  </label>
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={config.device?.pc?.stickyColumns !== false}
                    onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, pc: { ...prev.device.pc, stickyColumns: e.target.checked } } }))}
                    className="rounded text-blue-600 w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Kunci kolom checkbox dan Nomor WO di sisi kiri, serta kolom Aksi di sisi kanan agar tetap terlihat saat tabel digeser ke samping.
                </p>
              </div>

              {/* Option 3: Wide Screen Full Width */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 dark:text-slate-200">
                    Optimasi Layar Lebar Penuh (100% Full-Width)
                  </label>
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={config.device?.pc?.wideScreenFullWidth !== false}
                    onChange={e => updateDraft(prev => ({
                      ...prev,
                      global: { ...prev.global, contentWidth: e.target.checked ? 'full' : 'contained' },
                      device: { ...prev.device, pc: { ...prev.device.pc, wideScreenFullWidth: e.target.checked } }
                    }))}
                    className="rounded text-blue-600 w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Memanfaatkan seluruh lebar monitor monitor besar (1440px - 1600px+) tanpa batas container sempit.
                </p>
              </div>

              {/* Option 4: Bulk Selection Toolbar */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 dark:text-slate-200">
                    Bilah Penugasan Massal (Bulk Assign Bar)
                  </label>
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={config.device?.pc?.showBulkToolbar !== false}
                    onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, pc: { ...prev.device.pc, showBulkToolbar: e.target.checked } } }))}
                    className="rounded text-blue-600 w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Memunculkan toolbar floating cepat untuk menugaskan banyak tiket sekaligus ke teknisi yang dipilih.
                </p>
              </div>

              {/* Option 5: Inline Filters */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 dark:text-slate-200">
                    Filter Inline Langsung di Toolbar
                  </label>
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={config.device?.pc?.showInlineFilters !== false}
                    onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, pc: { ...prev.device.pc, showInlineFilters: e.target.checked } } }))}
                    className="rounded text-blue-600 w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Tampilkan dropdown filter Area, Status Agent, Status Installer, dan WhatsApp langsung tanpa harus klik modal.
                </p>
              </div>

              {/* Option 6: Multi-column detail view */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800 dark:text-slate-200">
                    Form Detail Tiket Multi-Kolom (Split View)
                  </label>
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={config.device?.pc?.multiColumnDetail !== false}
                    onChange={e => updateDraft(prev => ({ ...prev, device: { ...prev.device, pc: { ...prev.device.pc, multiColumnDetail: e.target.checked } } }))}
                    className="rounded text-blue-600 w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Menampilkan bagian informasi pelanggan dan data teknis dalam 2 kolom berdampingan pada layar desktop.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 1: Stitch 46-Column Canonical Studio & Live Simulator */}
      {activeTab === 'table_columns' && (
        <TableColumnsStudio
          isSuperAdmin={isSuperAdmin}
          onTriggerNotice={triggerNotice}
          onTriggerError={triggerError}
          onOpenSavePresetModal={() => setShowPresetModal(true)}
          onNavigateToTickets={onNavigateToTickets}
        />
      )}

      {/* Tab 2: Toolbar & Actions */}
      {activeTab === 'toolbar' && (
        <div className="card-3d-lavender rounded-2xl p-6 space-y-6 text-xs">
          <div>
            <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm mb-1">
              Pengaturan Toolbar &amp; Tombol Aksi
            </h4>
            <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
              Konfigurasi kontrol yang tampil pada toolbar tiket utama, termasuk posisi dan pengelompokan aksi.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 mj-tactile-well rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={!isSuperAdmin}
                checked={config.toolbar.showSearch}
                onChange={e => updateDraft(prev => ({ ...prev, toolbar: { ...prev.toolbar, showSearch: e.target.checked } }))}
                className="rounded border-[#DDE6F0] dark:border-[#CEC3D4] text-[#5145A6] dark:text-[#7135B5] focus:ring-[#6657C8]"
              />
              <span className="font-medium text-[#26364A] dark:text-[#CEC0E8]">Tampilkan Kotak Pencarian</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={!isSuperAdmin}
                checked={config.toolbar.showFilters}
                onChange={e => updateDraft(prev => ({ ...prev, toolbar: { ...prev.toolbar, showFilters: e.target.checked } }))}
                className="rounded border-[#DDE6F0] dark:border-[#CEC3D4] text-[#5145A6] dark:text-[#7135B5] focus:ring-[#6657C8]"
              />
              <span className="font-medium text-[#26364A] dark:text-[#CEC0E8]">Tampilkan Baris Filter Area/Status</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={!isSuperAdmin}
                checked={config.toolbar.showExport}
                onChange={e => updateDraft(prev => ({ ...prev, toolbar: { ...prev.toolbar, showExport: e.target.checked } }))}
                className="rounded border-[#DDE6F0] dark:border-[#CEC3D4] text-[#5145A6] dark:text-[#7135B5] focus:ring-[#6657C8]"
              />
              <span className="font-medium text-[#26364A] dark:text-[#CEC0E8]">Tampilkan Tombol Export CSV</span>
            </label>
          </div>

          <div>
            <h5 className="font-semibold text-[#26364A] dark:text-[#D8B4FE] mb-2">Tombol Aksi Toolbar:</h5>
            <div className="space-y-2">
              {config.toolbar.buttons.map(btn => (
                <div
                  key={btn.id}
                  className="flex items-center justify-between p-3 bg-[#F4F7FB] dark:bg-[#160D29]/70 rounded-xl border border-[#DDE6F0] dark:border-[#35105E]"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      disabled={!isSuperAdmin}
                      checked={btn.visible}
                      onChange={e => updateDraft(prev => ({
                        ...prev,
                        toolbar: {
                          ...prev.toolbar,
                          buttons: prev.toolbar.buttons.map(b => b.id === btn.id ? { ...b, visible: e.target.checked } : b)
                        }
                      }))}
                      className="rounded border-[#DDE6F0] dark:border-[#CEC3D4] text-[#5145A6] dark:text-[#7135B5] focus:ring-[#6657C8]"
                    />
                    <div>
                      <span className="font-semibold text-[#26364A] dark:text-white">{btn.label}</span>
                      <span className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8] block font-mono">id: {btn.id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <select
                      disabled={!isSuperAdmin}
                      value={btn.group}
                      onChange={e => updateDraft(prev => ({
                        ...prev,
                        toolbar: {
                          ...prev.toolbar,
                          buttons: prev.toolbar.buttons.map(b => b.id === btn.id ? { ...b, group: e.target.value as any } : b)
                        }
                      }))}
                      className="px-2.5 py-1.5 tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#26364A] dark:text-white rounded-lg text-xs disabled:opacity-60 focus:outline-none"
                    >
                      <option value="primary">Primary Action</option>
                      <option value="secondary">Secondary Action</option>
                      <option value="more_menu">Inside 'More' Menu</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Detail Sections & Empty Fields */}
      {activeTab === 'detail_sections' && (
        <div className="card-3d-lavender rounded-2xl p-6 space-y-6 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
            <div>
              <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm">
                Ticket Detail Layout &amp; Section Architecture
              </h4>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                Atur urutan section, visibilitas section, dan perilaku tampilan field kosong sesuai standar aplikasi.
              </p>
            </div>

            {/* Global Show Empty Fields toggle */}
            <div className="flex items-center gap-2 p-2 mj-tactile-well rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-semibold">Show Empty Fields:</span>
              <button
                disabled={!isSuperAdmin}
                onClick={() => updateDraft(prev => ({
                  ...prev,
                  ticketDetail: { ...prev.ticketDetail, showEmptyFields: !prev.ticketDetail.showEmptyFields }
                }))}
                className={`px-3 py-1 text-xs rounded-lg font-bold transition-all disabled:opacity-50 cursor-pointer ${
                  config.ticketDetail.showEmptyFields
                    ? 'btn-3d-primary text-white'
                    : 'btn-3d-ceramic'
                }`}
              >
                {config.ticketDetail.showEmptyFields ? 'Aktif (Ditampilkan)' : 'Nonaktif (Disembunyikan)'}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {config.ticketDetail.sections.map((section, secIdx) => (
              <div
                key={section.id}
                className="p-4 mj-tactile-well rounded-xl border border-[#DDE6F0] dark:border-[#35105E] space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={!isSuperAdmin}
                      checked={section.visible}
                      onChange={e => updateDraft(prev => ({
                        ...prev,
                        ticketDetail: {
                          ...prev.ticketDetail,
                          sections: prev.ticketDetail.sections.map(s => s.id === section.id ? { ...s, visible: e.target.checked } : s)
                        }
                      }))}
                      className="rounded border-[#DDE6F0] dark:border-[#CEC3D4] text-[#5145A6] dark:text-[#7135B5] focus:ring-[#6657C8]"
                    />
                    <span className="font-display font-bold text-[#26364A] dark:text-white text-sm">{section.title}</span>
                    <span className="text-[11px] text-[#8492A5] dark:text-[#D8B4FE] font-mono">({section.fields.length} fields)</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleMoveSection(secIdx, 'up')}
                      disabled={!isSuperAdmin || secIdx === 0}
                      className="btn-3d-icon p-1.5 disabled:opacity-30 cursor-pointer"
                      title="Pindah Section ke Atas"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveSection(secIdx, 'down')}
                      disabled={!isSuperAdmin || secIdx === config.ticketDetail.sections.length - 1}
                      className="btn-3d-icon p-1.5 disabled:opacity-30 cursor-pointer"
                      title="Pindah Section ke Bawah"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Fields inside section */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
                  {section.fields.map(field => (
                    <div
                      key={field.key}
                      className="p-2 bg-white dark:bg-[#1E1238] rounded-lg border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <input
                          type="checkbox"
                          disabled={!isSuperAdmin}
                          checked={field.visible}
                          onChange={e => updateDraft(prev => ({
                            ...prev,
                            ticketDetail: {
                              ...prev.ticketDetail,
                              sections: prev.ticketDetail.sections.map(s => s.id === section.id
                                ? { ...s, fields: s.fields.map(f => f.key === field.key ? { ...f, visible: e.target.checked } : f) }
                                : s)
                            }
                          }))}
                          className="rounded border-[#DDE6F0] dark:border-[#CEC3D4] text-[#5145A6] dark:text-[#7135B5] focus:ring-[#6657C8]"
                        />
                        <span className="truncate text-[#26364A] dark:text-[#CEC0E8]">{field.label}</span>
                      </div>
                      <select
                        disabled={!isSuperAdmin}
                        value={field.width}
                        onChange={e => updateDraft(prev => ({
                          ...prev,
                          ticketDetail: {
                            ...prev.ticketDetail,
                            sections: prev.ticketDetail.sections.map(s => s.id === section.id
                              ? { ...s, fields: s.fields.map(f => f.key === field.key ? { ...f, width: e.target.value as any } : f) }
                              : s)
                          }
                        }))}
                        className="text-[11px] px-1.5 py-0.5 tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white rounded disabled:opacity-60 focus:outline-none"
                      >
                        <option value="third">1/3</option>
                        <option value="half">1/2</option>
                        <option value="full">Full</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Global Theme, Branding & Density */}
      {activeTab === 'global_theme' && (
        <div className="card-3d-lavender rounded-2xl p-6 space-y-6 text-xs">
          <div>
            <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm mb-1">
              Pengaturan Tampilan Global &amp; Branding
            </h4>
            <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
              Konfigurasi tema warna, mode gelap/terang, kepadatan tabel, font scale, dan batas layout aplikasi.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1">Nama Aplikasi</label>
              <input
                type="text"
                disabled={!isSuperAdmin}
                value={config.global.appName}
                onChange={e => updateDraft(prev => ({ ...prev, global: { ...prev.global, appName: e.target.value } }))}
                className="w-full px-3 py-2 tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white rounded-xl disabled:opacity-60 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1">Tema Mode</label>
              <select
                disabled={!isSuperAdmin}
                value={config.global.themeMode}
                onChange={e => updateDraft(prev => ({ ...prev, global: { ...prev.global, themeMode: e.target.value as any } }))}
                className="w-full px-3 py-2 tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white rounded-xl disabled:opacity-60 focus:outline-none"
              >
                <option value="light">Light Mode</option>
                <option value="dark">Dark Mode</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1">Kepadatan Grid / Tabel (Density)</label>
              <select
                disabled={!isSuperAdmin}
                value={config.ticketsTable.density}
                onChange={e => {
                  const nextDensity = e.target.value as any;
                  updateDraft(prev => ({
                    ...prev,
                    ticketsTable: { ...prev.ticketsTable, density: nextDensity }
                  }));
                }}
                className="w-full px-3 py-2 tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white rounded-xl disabled:opacity-60 focus:outline-none"
              >
                <option value="compact">Compact (Maksimal data)</option>
                <option value="comfortable">Comfortable (Standar)</option>
                <option value="spacious">Spacious (Longgar)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1">Jumlah Baris per Halaman</label>
              <select
                disabled={!isSuperAdmin}
                value={config.ticketsTable.rowsPerPage}
                onChange={e => {
                  const val = parseInt(e.target.value) || 10;
                  updateDraft(prev => ({
                    ...prev,
                    ticketsTable: { ...prev.ticketsTable, rowsPerPage: val }
                  }));
                }}
                className="w-full px-3 py-2 tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white rounded-xl disabled:opacity-60 focus:outline-none"
              >
                <option value={5}>5 baris</option>
                <option value={10}>10 baris</option>
                <option value={15}>15 baris</option>
                <option value={20}>20 baris</option>
                <option value={50}>50 baris</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1">Status Menu Sidebar (Default)</label>
              <select
                disabled={!isSuperAdmin}
                value={config.global.sidebarState || 'expanded'}
                onChange={e => {
                  const state = e.target.value as any;
                  updateDraft(prev => ({
                    ...prev,
                    global: { ...prev.global, sidebarState: state, sidebarCollapsed: state === 'minimized' }
                  }));
                }}
                className="w-full px-3 py-2 tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white rounded-xl disabled:opacity-60 focus:outline-none"
              >
                <option value="expanded">Expanded (Terbuka Penuh - Lebar)</option>
                <option value="minimized">Minimized (Di-minimize - Hanya Ikon)</option>
                <option value="closed">Closed (Ditutup Penuh - Layar Penuh)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Presets Manager */}
      {activeTab === 'presets' && (
        <div className="card-3d-lavender rounded-2xl p-6 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
            <div>
              <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm">
                Daftar Preset Tampilan Tabel
              </h4>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                Pilih atau kelola preset layout tabel yang tersimpan untuk beralih perspektif kerja dalam 1-klik.
              </p>
            </div>
            <button
              disabled={!isSuperAdmin || isCloudSyncing}
              onClick={() => setShowPresetModal(true)}
              className="btn-3d-primary px-3.5 py-2 font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Simpan Konfigurasi Saat Ini Sebagai Preset</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {config.ticketsTable.presets.map(p => {
              const isActive = config.ticketsTable.activePresetId === p.id;
              const visibleColsCount = p.columns.filter(c => c.visible).length;
              return (
                <div
                  key={p.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isActive
                      ? 'border-[#6657C8] dark:border-[#7135B5] bg-[#EAE8FF]/70 dark:bg-[#2E1859]/50 shadow-sm'
                      : 'border-[#DDE6F0] dark:border-[#35105E] bg-white dark:bg-[#160D29]/60 hover:border-[#9E95DE] dark:hover:border-[#A855F7]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <h5 className="font-bold text-[#26364A] dark:text-white text-xs flex items-center gap-2">
                      <span>{p.name}</span>
                      {isActive && (
                        <span className="px-2 py-0.5 bg-[#6657C8] dark:bg-[#58149C] text-white rounded-full text-[10px] font-bold">
                          Aktif
                        </span>
                      )}
                    </h5>

                    <div className="flex items-center gap-1">
                      {!isActive && (
                        <button
                          disabled={!isSuperAdmin || isCloudSyncing}
                          onClick={async () => {
                            const res = await applyPreset(p.id);
                            if (res.success) {
                              triggerNotice(`Preset "${p.name}" diterapkan & disimpan ke database.`);
                            } else {
                              triggerError(res.error || 'Gagal menerapkan preset ke database.');
                            }
                          }}
                          className="btn-3d-primary px-2.5 py-1 rounded-lg text-[11px] font-bold disabled:opacity-50 cursor-pointer"
                        >
                          Terapkan
                        </button>
                      )}
                      {config.ticketsTable.presets.length > 1 && !p.id.startsWith('preset_default') && (
                        <button
                          disabled={!isSuperAdmin || isCloudSyncing}
                          onClick={async () => {
                            const res = await deletePreset(p.id);
                            if (res.success) {
                              triggerNotice(`Preset "${p.name}" dihapus dari database.`);
                            } else {
                              triggerError(res.error || 'Gagal menghapus preset dari database.');
                            }
                          }}
                          className="p-1 text-[#8492A5] hover:text-rose-600 rounded disabled:opacity-40 cursor-pointer"
                          title="Hapus Preset"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[#52647A] dark:text-[#CEC0E8] text-[11px] mb-2">{p.description}</p>
                  <div className="text-[11px] text-[#8492A5] dark:text-[#D8B4FE]/75 font-mono tabular-nums">
                    {visibleColsCount} Kolom Aktif · Kepadatan: {p.density} · {p.rowsPerPage} rows/hal
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 6: JSON Import / Export */}
      {activeTab === 'json' && (
        <div className="card-3d-lavender rounded-2xl p-6 space-y-4 text-xs">
          <div>
            <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm mb-1">
              Backup, Pulihkan &amp; Migrasi Konfigurasi
            </h4>
            <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
              Paste JSON konfigurasi untuk memulihkan seluruh layout, visibilitas kolom, dan pengaturan toolbar.
            </p>
          </div>

          <textarea
            rows={10}
            disabled={!isSuperAdmin}
            placeholder="Paste string JSON konfigurasi UI di sini..."
            value={jsonInput}
            onChange={e => setJsonInput(e.target.value)}
            className="w-full p-3 font-mono text-xs tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl text-[#26364A] dark:text-[#D8B4FE] disabled:opacity-60 focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={handleExport}
              className="btn-3d-lilac px-3.5 py-2 text-xs font-bold rounded-xl cursor-pointer"
            >
              Unduh Konfigurasi Saat Ini (JSON)
            </button>
            <button
              onClick={handleImport}
              disabled={!isSuperAdmin || !jsonInput.trim() || isCloudSyncing}
              className="btn-3d-primary px-4 py-2 font-bold disabled:opacity-40 rounded-xl cursor-pointer"
            >
              {isCloudSyncing ? 'Menyimpan...' : 'Terapkan JSON Konfigurasi'}
            </button>
          </div>
        </div>
      )}

      {/* Tab: Kolom Tabel Leader (Terpusat dari Portal Leader) */}
      {activeTab === 'leader_columns' && (
        <div className="card-3d-lavender rounded-2xl p-6 space-y-5 text-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[#DDE6F0] dark:border-[#35105E] pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Sliders className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
                <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm">
                  Pengaturan Kolom Tabel Portal Leader (Assign WO)
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#7135B5]/40 tabular-nums">
                  {leaderColumns.filter(c => c.visible).length}/{leaderColumns.length} Aktif
                </span>
              </div>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                Terpusat di App Setting. Mengatur visibilitas &amp; urutan kolom tabel Assign WO Leader tanpa mengubah skema 46 Kolom Kanonik Dispatch.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <select
                value={leaderColumnScope}
                onChange={e => setLeaderColumnScope(e.target.value)}
                aria-label="Cakupan Konfigurasi Kolom Leader"
                className="px-3 py-2 text-xs tactile-debossed-input rounded-xl bg-white dark:bg-[#1E1238] text-[#26364A] dark:text-white font-semibold focus:outline-none cursor-pointer"
              >
                <option value="global">Global Default (Semua Leader)</option>
                {leaderUsers.map(u => (
                  <option key={u.id} value={u.id}>
                    Leader: {u.name} {u.area ? `(${u.area})` : ''}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={!isSuperAdmin}
                onClick={() =>
                  persistLeaderColumns(
                    leaderColumns.map(c => ({ ...c, visible: true })),
                    'Semua kolom tabel Leader diaktifkan.'
                  )
                }
                className="btn-3d-lilac px-3 py-2 text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer"
              >
                Tampilkan Semua
              </button>

              <button
                type="button"
                disabled={!isSuperAdmin}
                onClick={() => {
                  const defaultCols = DEFAULT_LEADER_COLUMNS.map(col => ({ ...col }));
                  setLeaderColumns(defaultCols);
                  safeLocalStorageRemove(`morajaws_leader_columns_${leaderColumnScope}`);
                  window.dispatchEvent(new CustomEvent('morajaws:leader-columns-updated', { detail: { scope: leaderColumnScope } }));
                  triggerNotice('Kolom tabel Leader dikembalikan ke default.');
                }}
                className="btn-3d-crimson px-3 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Default</span>
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#DDE6F0]/70 dark:divide-[#35105E] border border-[#DDE6F0] dark:border-[#35105E] rounded-2xl overflow-hidden bg-white dark:bg-[#160D29]/70">
            {leaderColumns.map((col, idx) => {
              const isLocked = col.canHide === false;
              return (
                <div
                  key={col.id}
                  className={`px-4 py-3 flex items-center justify-between gap-3 transition-colors ${
                    col.visible
                      ? 'hover:bg-[#EDF3F8]/70 dark:hover:bg-[#241145]/40'
                      : 'bg-[#F4F7FB]/80 dark:bg-[#160D29]/40 opacity-75'
                  }`}
                >
                  <label className={`flex items-center gap-3 min-w-0 flex-1 ${isLocked || !isSuperAdmin ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={isLocked ? true : col.visible}
                      disabled={isLocked || !isSuperAdmin}
                      onChange={() => {
                        if (isLocked || !isSuperAdmin) return;
                        const next = leaderColumns.map(c =>
                          c.id === col.id ? { ...c, visible: !c.visible } : c
                        );
                        persistLeaderColumns(next, `Visibilitas kolom "${col.label}" diperbarui.`);
                      }}
                      className="w-4 h-4 accent-[#6657C8] rounded cursor-pointer disabled:opacity-60 shrink-0"
                    />
                    <span className="font-mono text-[10px] font-bold text-[#8492A5] dark:text-[#A79BC0] w-6 shrink-0 tabular-nums">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-[#26364A] dark:text-white flex items-center gap-1.5 truncate">
                        <span className="truncate">{col.label}</span>
                        {isLocked && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] text-[9.5px] font-bold shrink-0">
                            <Lock className="w-2.5 h-2.5" />
                            <span>Mandatori</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#8492A5] dark:text-[#CEC0E8]/70 font-mono">
                        Key: {col.id}
                      </div>
                    </div>
                  </label>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={!isSuperAdmin || idx === 0}
                      onClick={() => {
                        if (!isSuperAdmin || idx === 0) return;
                        const next = [...leaderColumns];
                        const [moved] = next.splice(idx, 1);
                        next.splice(idx - 1, 0, moved);
                        persistLeaderColumns(next, `Kolom "${col.label}" dinaikkan.`);
                      }}
                      title="Geser Kolom Naik"
                      className="btn-3d-icon p-1.5 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!isSuperAdmin || idx === leaderColumns.length - 1}
                      onClick={() => {
                        if (!isSuperAdmin || idx === leaderColumns.length - 1) return;
                        const next = [...leaderColumns];
                        const [moved] = next.splice(idx, 1);
                        next.splice(idx + 1, 0, moved);
                        persistLeaderColumns(next, `Kolom "${col.label}" diturunkan.`);
                      }}
                      title="Geser Kolom Turun"
                      className="btn-3d-icon p-1.5 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Save Preset Dialog */}
      <ResponsiveModal
        isOpen={showPresetModal}
        onClose={() => setShowPresetModal(false)}
        title="Simpan Preset Tampilan Kolom"
        icon={<Save className="w-4 h-4" />}
        size="sm"
        mobileVariant="sheet"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowPresetModal(false)}
              disabled={isCloudSyncing}
              className="btn-3d-lilac px-3.5 py-2 min-h-[38px] text-xs font-bold rounded-xl cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSavePreset}
              disabled={!isSuperAdmin || isCloudSyncing}
              className="btn-3d-primary px-4 py-2 min-h-[38px] text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer"
            >
              {isCloudSyncing ? 'Menyimpan...' : 'Simpan Preset'}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-[#52647A] dark:text-[#CEC0E8] mb-1 font-semibold">Nama Preset</label>
            <input
              type="text"
              placeholder="misal: Tampilan Fokus SLA & WA"
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              className="w-full px-3 py-2 min-h-[38px] tactile-debossed-input rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[#52647A] dark:text-[#CEC0E8] mb-1 font-semibold">Deskripsi Singkat</label>
            <input
              type="text"
              placeholder="Penjelasan layout ini"
              value={newPresetDesc}
              onChange={e => setNewPresetDesc(e.target.value)}
              className="w-full px-3 py-2 min-h-[38px] tactile-debossed-input rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none"
            />
          </div>
        </div>
      </ResponsiveModal>

      {/* Confirmation Modal (Replaces native window.confirm) */}
      <ResponsiveModal
        isOpen={Boolean(confirmModal)}
        onClose={() => setConfirmModal(null)}
        title={
          confirmModal === 'pull'
            ? 'Tarik Konfigurasi Master dari Supabase?'
            : 'Reset Seluruh Layout UI ke Standar Sistem?'
        }
        icon={<AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
        size="sm"
        mobileVariant="sheet"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmModal(null)}
              className="btn-3d-lilac px-3.5 py-2 min-h-[38px] text-xs font-bold rounded-xl cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={executeConfirmAction}
              disabled={isCloudSyncing}
              className={`px-4 py-2 min-h-[38px] text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer ${
                confirmModal === 'pull'
                  ? 'btn-3d-primary'
                  : 'btn-3d-crimson'
              }`}
            >
              Ya, Lanjutkan
            </button>
          </>
        }
      >
        <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
          {confirmModal === 'pull'
            ? 'Tindakan ini akan memuat konfigurasi terbaru dari tabel app_settings Supabase PostgreSQL dan membuang draft lokal yang belum disimpan.'
            : 'Seluruh pengaturan layout, tema, dan kolom tabel akan dikembalikan ke standar default sistem dan langsung disimpan ke database global.'}
        </p>
      </ResponsiveModal>
    </div>
  );
};
