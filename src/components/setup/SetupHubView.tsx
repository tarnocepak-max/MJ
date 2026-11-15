import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useToast } from '../../context/ToastContext';
import {
  Sliders,
  Users,
  Shield,
  List,
  MessageSquare,
  Volume2,
  LayoutTemplate,
  Database,
  GitBranch,
  Activity,
  Server,
  FileSpreadsheet,
  Lock,
  ShieldCheck,
  FolderTree,
  Building2,
  ShieldAlert,
  RotateCcw,
  Save,
  History,
  RefreshCw,
  Clock,
  Loader2,
  AlertTriangle
} from 'lucide-react';

// Sub-components
import { SystemSettings } from '../settings/SystemSettings';
import { UserManagementView } from '../users/UserManagementView';
import { ManagementRoleView } from '../users/ManagementRoleView';
import { DroplistManagementView } from '../settings/DroplistManagementView';
import { TemplateBuilder } from '../whatsapp/TemplateBuilder';
import { SoundSettingsView } from '../settings/SoundSettingsView';
import { UIConfigurationBuilder } from '../uiBuilder/UIConfigurationBuilder';
import { DatabaseManagementView } from '../database/DatabaseManagementView';
import { DatabaseSyncMonitoringView } from '../database/DatabaseSyncMonitoringView';
import { GoogleSheetsSyncView } from '../sheets/GoogleSheetsSyncView';
import { WorkflowManager } from '../workflows/WorkflowManager';
import { SystemHealthView } from '../settings/SystemHealthView';
import { AuditLogViewer } from '../audit/AuditLogViewer';
import { LoginLogView } from '../audit/LoginLogView';
import { NavigationConfigView } from './NavigationConfigView';

export type SetupTabKey =
  | 'app_config'
  | 'master_data'
  | 'general'
  | 'nav_config'
  | 'users'
  | 'roles'
  | 'droplists'
  | 'whatsapp'
  | 'sound'
  | 'ui_builder'
  | 'database'
  | 'workflows'
  | 'health_logs';

interface SetupHubViewProps {
  initialTab?: SetupTabKey;
  onNavigateTab?: (tab: string) => void;
}

export const SetupHubView: React.FC<SetupHubViewProps> = ({
  initialTab = 'app_config',
  onNavigateTab
}) => {
  const {
    currentUser,
    users,
    templates,
    workflowRules,
    hierarchicalStatuses,
    databaseStatus,
    syncStatus
  } = useApp();
  const {
    config,
    standaloneMenus,
    submenuItems,
    uiConfigVersion,
    lastCloudSyncTime,
    isCloudSyncing,
    hasUnsavedNavChanges,
    saveConfigToSupabase,
    saveNavigationConfig,
    resetToDefaults,
    resetNavigationConfig
  } = useUIConfig();
  const { soundSettings } = useMoraJawsSound();
  const { toast } = useToast();

  const normalizedInitialTab: SetupTabKey =
    initialTab === 'master_data' || initialTab === 'general' ? 'app_config' : initialTab;
  const [activeTab, setActiveTab] = useState<SetupTabKey>(normalizedInitialTab);
  const [dbSubTab, setDbSubTab] = useState<'management' | 'monitoring' | 'sheets'>('management');
  const [logSubTab, setLogSubTab] = useState<'health' | 'audit' | 'login'>('health');
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    setActiveTab(normalizedInitialTab);
  }, [normalizedInitialTab]);

  const userRole = currentUser?.role || 'installer';

  // Check role-based tab access (App Flow 6: block Leader & Installer)
  const isSuperadmin = userRole === 'super_admin';
  const isDispatch = userRole === 'dispatch';
  const isManagement = userRole === 'management_data';
  const canAccessSetupHub = isSuperadmin || isManagement || isDispatch;

  const totalNavMenusCount = (standaloneMenus?.length || 0) + (submenuItems?.length || 0);
  const totalColumnsCount = config?.ticketsTable?.columns?.length || 0;

  const accessibleTabs = useMemo(() => {
    const tabs: {
      key: SetupTabKey;
      num: number;
      label: string;
      icon: React.ElementType;
      badge?: string;
      badgeTone?: 'purple' | 'emerald' | 'neutral';
    }[] = [];

    if (!canAccessSetupHub) {
      return tabs;
    }

    // 1–4. Core System, Navigation, Columns & Database (Super Admin & Management Data)
    if (isSuperadmin || isManagement) {
      tabs.push({
        key: 'app_config',
        num: 1,
        label: '1. Konfigurasi Sistem',
        icon: Building2,
        badge: 'Core',
        badgeTone: 'purple'
      });
      tabs.push({
        key: 'nav_config',
        num: 2,
        label: '2. Menu Navigasi',
        icon: FolderTree,
        badge: `${totalNavMenusCount} Menu`,
        badgeTone: 'neutral'
      });
      tabs.push({
        key: 'ui_builder',
        num: 3,
        label: '3. Kolom & Tampilan',
        icon: LayoutTemplate,
        badge: `${totalColumnsCount} Kolom`,
        badgeTone: 'neutral'
      });
      tabs.push({
        key: 'database',
        num: 4,
        label: '4. Database & Sync',
        icon: Database,
        badge: databaseStatus === 'connected' ? 'SSE Live' : 'Lokal',
        badgeTone: databaseStatus === 'connected' ? 'emerald' : 'neutral'
      });
    }

    // 5–6. Users & Roles (Superadmin only)
    if (isSuperadmin) {
      tabs.push({
        key: 'users',
        num: 5,
        label: '5. Pengguna',
        icon: Users,
        badge: `${users?.length || 0}`,
        badgeTone: 'neutral'
      });
      tabs.push({
        key: 'roles',
        num: 6,
        label: '6. Role & Otoritas',
        icon: Shield,
        badge: '6 Role',
        badgeTone: 'neutral'
      });
    }

    // 7. Kategori Report (Superadmin, Dispatch, Management Data)
    if (isSuperadmin || isDispatch || isManagement) {
      tabs.push({
        key: 'droplists',
        num: 7,
        label: '7. Kategori Report',
        icon: List,
        badge: `${hierarchicalStatuses?.length || 0} Lv1`,
        badgeTone: 'neutral'
      });
    }

    // 8–9. WhatsApp Templates & Workflows (Superadmin & Dispatch)
    if (isSuperadmin || isDispatch) {
      tabs.push({
        key: 'whatsapp',
        num: 8,
        label: '8. Template WhatsApp',
        icon: MessageSquare,
        badge: `${templates?.length || 0}`,
        badgeTone: 'neutral'
      });
      tabs.push({
        key: 'workflows',
        num: 9,
        label: '9. Workflows',
        icon: GitBranch,
        badge: `${workflowRules?.length || 0}`,
        badgeTone: 'neutral'
      });
    }

    // 10. Notifikasi & Audio (Allowed Setup Hub roles)
    tabs.push({
      key: 'sound',
      num: 10,
      label: '10. Notifikasi & Audio',
      icon: Volume2,
      badge: soundSettings.enabled ? 'ON' : 'OFF',
      badgeTone: soundSettings.enabled ? 'emerald' : 'neutral'
    });

    // 11. System Health & Logs (Superadmin only)
    if (isSuperadmin) {
      tabs.push({
        key: 'health_logs',
        num: 11,
        label: '11. Audit & Health',
        icon: Activity,
        badge: syncStatus === 'SAVED' ? 'OK' : 'Sync',
        badgeTone: syncStatus === 'SAVED' ? 'emerald' : 'neutral'
      });
    }

    return tabs;
  }, [
    canAccessSetupHub,
    isSuperadmin,
    isDispatch,
    isManagement,
    totalNavMenusCount,
    totalColumnsCount,
    databaseStatus,
    users?.length,
    hierarchicalStatuses?.length,
    templates?.length,
    workflowRules?.length,
    soundSettings.enabled,
    syncStatus
  ]);

  const handleSaveAllConfigs = async () => {
    if (!isSuperadmin || isSavingAll) return;
    setIsSavingAll(true);
    try {
      const [uiRes, navRes] = await Promise.all([
        saveConfigToSupabase(currentUser?.name),
        saveNavigationConfig(currentUser?.name)
      ]);

      if (uiRes.success && navRes.success) {
        toast.success('Seluruh konfigurasi UI dan Navigasi berhasil disinkronkan ke Supabase PostgreSQL.');
      } else {
        const msg = uiRes.error || navRes.error || 'Sebagian konfigurasi gagal disinkronkan.';
        toast.error(msg);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menyimpan konfigurasi ke database.');
    } finally {
      setIsSavingAll(false);
    }
  };

  const handleConfirmResetDefaults = async () => {
    if (!isSuperadmin || isResetting) return;
    setIsResetting(true);
    try {
      const [uiRes, navRes] = await Promise.all([
        resetToDefaults(),
        resetNavigationConfig(currentUser?.name)
      ]);
      setIsResetConfirmOpen(false);
      if (uiRes.success && navRes.success) {
        toast.success('Konfigurasi UI & Menu Navigasi berhasil dipulihkan ke standar pabrikan MoraJaws.');
      } else {
        toast.error(uiRes.error || navRes.error || 'Gagal memulihkan konfigurasi default.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Terjadi kesalahan saat memulihkan default.');
    } finally {
      setIsResetting(false);
    }
  };

  if (!canAccessSetupHub) {
    return (
      <div className="bg-white dark:bg-[#1E1238] rounded-2xl p-8 border border-rose-200 dark:border-rose-900 text-center max-w-lg mx-auto space-y-4 shadow-sm my-8">
        <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-bold text-[#211A2E] dark:text-white text-base">
          Akses Ditolak: SETUP TERPUSAT MORAJAWS
        </h3>
        <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] leading-relaxed">
          Pusat Setup Terpusat MoraJaws dilindungi dan tidak dapat diakses oleh peran <strong>{userRole}</strong>.
        </p>
      </div>
    );
  }

  // Ensure active tab is allowed, otherwise fallback to first accessible
  const currentTab = accessibleTabs.some(t => t.key === activeTab) ? activeTab : (accessibleTabs[0]?.key || 'sound');
  const formattedLastSync = lastCloudSyncTime
    ? new Date(lastCloudSyncTime).toLocaleString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short'
      })
    : 'Real-time Aktif';

  return (
    <div className="space-y-5">
      {/* Command Header & Metadata Bar */}
      <div className="bg-white dark:bg-[#1E1238] rounded-2xl p-5 sm:p-6 border border-[#E9E5F0] dark:border-[#35105E] shadow-[0_1px_3px_rgba(33,26,46,0.04)] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            {/* Breadcrumb Context */}
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#766B83] dark:text-[#CEC0E8]">
              <span>{config?.global?.appName || 'MoraJaws'}</span>
              <span>/</span>
              <span>Menu Tambahan</span>
              <span>/</span>
              <span className="font-bold text-[#431599] dark:text-[#D8B4FE]">SETUP TERPUSAT MORAJAWS</span>
            </div>

            {/* Title & Enterprise Pills */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#F5F1FF] dark:bg-[#35105E] border border-[#D8CCF3] dark:border-[#7135B5]/50 flex items-center justify-center text-[#7135B5] dark:text-[#E9D5FF] shrink-0">
                <Sliders className="w-5 h-5" />
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#211A2E] dark:text-white">
                SETUP TERPUSAT MORAJAWS
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F5F1FF] dark:bg-[#35105E] border border-[#D8CCF3] dark:border-[#7135B5]/50 text-[#431599] dark:text-[#E9D5FF]">
                <Sliders className="w-3 h-3" />
                <span>Pusat Konfigurasi Sistem 11-Tab</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-mono font-bold bg-[#160D29] text-white dark:bg-[#7135B5] tabular-nums">
                <ShieldCheck className="w-3 h-3 text-[#D8B4FE]" />
                <span>
                  v{uiConfigVersion} · {currentUser?.role?.replace('_', ' ')}
                </span>
              </span>
            </div>

            {/* Live Metadata Strip */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-[#766B83] dark:text-[#CEC0E8] pt-0.5">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    databaseStatus === 'connected'
                      ? 'bg-[#16A36A]'
                      : databaseStatus === 'connecting'
                      ? 'bg-[#E59A27] animate-pulse'
                      : 'bg-[#DC4C5A]'
                  }`}
                />
                <span>
                  Database:{' '}
                  <strong className="text-[#211A2E] dark:text-white">
                    {databaseStatus === 'connected' ? 'Supabase PostgreSQL' : 'Local / Connecting'}
                  </strong>
                </span>
              </span>

              <span className="inline-flex items-center gap-1.5 text-[#15803D] dark:text-emerald-300 font-semibold">
                <RefreshCw className="w-3 h-3" />
                <span>
                  {databaseStatus === 'connected'
                    ? 'Sinkronisasi Otomatis Aktif (SSE)'
                    : 'Sinkronisasi Terbatas'}
                </span>
              </span>

              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Clock className="w-3 h-3 text-[#8B8495]" />
                <span>
                  Last Sync: <strong className="text-[#211A2E] dark:text-white">{formattedLastSync}</strong> oleh{' '}
                  <strong className="text-[#431599] dark:text-[#D8B4FE]">{currentUser?.name}</strong>
                </span>
              </span>

              {hasUnsavedNavChanges && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10.5px] font-bold">
                  Perubahan Navigasi Belum Disimpan
                </span>
              )}
            </div>
          </div>

          {/* Right Action Cluster */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isSuperadmin && (
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(true)}
                disabled={isSavingAll || isResetting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-white hover:bg-[#F7F6FA] dark:bg-[#160D29] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-[#E9D5FF] text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#766B83] dark:text-[#A78BFA]" />
                <span>Pulihkan Default</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (isSuperadmin) {
                  setActiveTab('health_logs');
                  setLogSubTab('audit');
                } else if (onNavigateTab) {
                  onNavigateTab('audit_logs');
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-white hover:bg-[#F5F1FF] dark:bg-[#160D29] dark:hover:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] text-xs font-bold transition-colors cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
              <span>Audit Log Perubahan</span>
            </button>

            {isSuperadmin && (
              <button
                type="button"
                onClick={handleSaveAllConfigs}
                disabled={isSavingAll || isCloudSyncing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#7135B5] to-[#5B35B1] hover:from-[#5B35B1] hover:to-[#431599] text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-60"
              >
                {isSavingAll || isCloudSyncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{isSavingAll ? 'Menyimpan...' : 'Simpan Seluruh Konfigurasi'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sticky 11-Tab Segmented Navigation Ribbon */}
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-[#1E1238]/95 backdrop-blur-md rounded-2xl p-2 border border-[#E9E5F0] dark:border-[#35105E] shadow-[0_2px_10px_rgba(33,26,46,0.04)]">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
          {accessibleTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-[#7135B5] text-white font-bold shadow-xs'
                    : 'text-[#494453] dark:text-[#CEC0E8] font-semibold hover:text-[#431599] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] dark:hover:text-white'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isActive ? 'text-[#E9D5FF]' : 'text-[#7135B5] dark:text-[#A78BFA]'
                  }`}
                />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[9.5px] font-mono font-bold tabular-nums leading-none ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : tab.badgeTone === 'emerald'
                        ? 'bg-[#ECFDF5] text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-300'
                        : tab.badgeTone === 'purple'
                        ? 'bg-[#F0E3FF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                        : 'bg-[#F7F6FA] text-[#766B83] dark:bg-[#160D29] dark:text-[#CEC0E8]'
                    }`}
                  >
                    {isActive ? 'Active' : tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Tab Content View */}
      <div className="transition-all">
        {/* 1. Konfigurasi Sistem & Master Data Terpusat */}
        {currentTab === 'app_config' && (isSuperadmin || isManagement) && (
          <div className="space-y-4">
            <SystemSettings defaultTab="core_config" embeddedInSetupHub />
          </div>
        )}

        {/* 1B. Konfigurasi Menu Navigasi */}
        {currentTab === 'nav_config' && (
          <div className="space-y-4">
            <NavigationConfigView />
          </div>
        )}

        {/* 2. Manajemen Pengguna */}
        {currentTab === 'users' && isSuperadmin && (
          <div className="space-y-4">
            <UserManagementView />
          </div>
        )}

        {/* 3. Role & Otoritas */}
        {currentTab === 'roles' && isSuperadmin && (
          <div className="space-y-4">
            <ManagementRoleView />
          </div>
        )}

        {/* 4. Droplist Management */}
        {currentTab === 'droplists' && (
          <div className="space-y-4">
            <DroplistManagementView />
          </div>
        )}

        {/* 5. Template WhatsApp */}
        {currentTab === 'whatsapp' && (
          <div className="space-y-4">
            <TemplateBuilder />
          </div>
        )}

        {/* 6. Notifikasi & Audio */}
        {currentTab === 'sound' && (
          <div className="space-y-4">
            <SoundSettingsView />
          </div>
        )}

        {/* 7. Kolom & Tampilan UI */}
        {currentTab === 'ui_builder' && (
          <div className="space-y-4">
            <UIConfigurationBuilder />
          </div>
        )}

        {/* 4. Database & Sinkronisasi */}
        {currentTab === 'database' && (isSuperadmin || isManagement) && (
          <div className="space-y-4">
            {/* Sub-tab Switcher for Database */}
            <div className="flex flex-wrap items-center gap-2 p-1.5 bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] text-xs font-semibold">
              <button
                type="button"
                onClick={() => setDbSubTab('management')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  dbSubTab === 'management'
                    ? 'bg-[#7135B5] text-white shadow-xs font-bold'
                    : 'text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Database & Backup</span>
              </button>
              <button
                type="button"
                onClick={() => setDbSubTab('monitoring')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  dbSubTab === 'monitoring'
                    ? 'bg-[#7135B5] text-white shadow-xs font-bold'
                    : 'text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>Monitoring Realtime Sync</span>
              </button>
              <button
                type="button"
                onClick={() => setDbSubTab('sheets')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  dbSubTab === 'sheets'
                    ? 'bg-[#7135B5] text-white shadow-xs font-bold'
                    : 'text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#16A36A]" />
                <span>Google Sheets Live Sync</span>
              </button>
            </div>

            {dbSubTab === 'management' && <DatabaseManagementView />}
            {dbSubTab === 'monitoring' && <DatabaseSyncMonitoringView />}
            {dbSubTab === 'sheets' && <GoogleSheetsSyncView />}
          </div>
        )}

        {/* 9. Workflows & Otomasi */}
        {currentTab === 'workflows' && (isSuperadmin || isDispatch) && (
          <div className="space-y-4">
            <WorkflowManager />
          </div>
        )}

        {/* 11. Kesehatan & Log Sistem */}
        {currentTab === 'health_logs' && isSuperadmin && (
          <div className="space-y-4">
            {/* Sub-tab Switcher for Logs */}
            <div className="flex flex-wrap items-center gap-2 p-1.5 bg-white dark:bg-[#1E1238] rounded-xl border border-[#E9E5F0] dark:border-[#35105E] text-xs font-semibold">
              <button
                type="button"
                onClick={() => setLogSubTab('health')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  logSubTab === 'health'
                    ? 'bg-[#7135B5] text-white shadow-xs font-bold'
                    : 'text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Status Kesehatan Sistem</span>
              </button>
              <button
                type="button"
                onClick={() => setLogSubTab('audit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  logSubTab === 'audit'
                    ? 'bg-[#7135B5] text-white shadow-xs font-bold'
                    : 'text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Audit Trail Log</span>
              </button>
              <button
                type="button"
                onClick={() => setLogSubTab('login')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  logSubTab === 'login'
                    ? 'bg-[#7135B5] text-white shadow-xs font-bold'
                    : 'text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Riwayat Sesi & Login</span>
              </button>
            </div>

            {logSubTab === 'health' && <SystemHealthView />}
            {logSubTab === 'audit' && <AuditLogViewer />}
            {logSubTab === 'login' && <LoginLogView />}
          </div>
        )}
      </div>

      {/* Confirmation Modal for Pulihkan Default */}
      {isResetConfirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#160D29]/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => !isResetting && setIsResetConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#1E1238] rounded-2xl border border-[#D8CCF3] dark:border-[#35105E] shadow-2xl p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display font-bold text-base text-[#211A2E] dark:text-white">
                  Pulihkan Konfigurasi Default?
                </h3>
                <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] leading-relaxed">
                  Tindakan ini akan mengembalikan konfigurasi UI (kolom, tampilan, tema) dan susunan menu navigasi ke pengaturan standar MoraJaws di Supabase PostgreSQL. Data Work Order dan Pengguna tidak akan terhapus.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isResetting}
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-4 py-2 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] text-xs font-semibold text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F7F6FA] dark:hover:bg-[#35105E] cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={handleConfirmResetDefaults}
                className="px-4 py-2 rounded-xl bg-[#DC4C5A] hover:bg-[#C03846] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isResetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                <span>{isResetting ? 'Memulihkan...' : 'Ya, Pulihkan Default'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
