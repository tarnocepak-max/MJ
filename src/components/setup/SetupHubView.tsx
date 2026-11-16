import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
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
  Clock,
  RefreshCw
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
  const { currentUser } = useApp();
  const {
    config,
    cloudSyncStatus,
    isCloudSyncing,
    lastCloudSyncTime,
    standaloneMenus,
    submenuItems
  } = useUIConfig();

  const normalizedInitialTab: SetupTabKey =
    initialTab === 'master_data' || initialTab === 'general' ? 'app_config' : initialTab;
  const [activeTab, setActiveTab] = useState<SetupTabKey>(normalizedInitialTab);
  const [dbSubTab, setDbSubTab] = useState<'management' | 'monitoring' | 'sheets'>('management');
  const [logSubTab, setLogSubTab] = useState<'health' | 'audit' | 'login'>('health');

  useEffect(() => {
    setActiveTab(normalizedInitialTab);
  }, [normalizedInitialTab]);

  const userRole = currentUser?.role || 'installer';

  // Check role-based tab access (App Flow 6: block Leader & Installer)
  const isSuperadmin = userRole === 'super_admin';
  const isDispatch = userRole === 'dispatch';
  const isManagement = userRole === 'management_data';
  const canAccessSetupHub = isSuperadmin || isManagement || isDispatch;

  const totalNavMenusCount = useMemo(() => {
    return (standaloneMenus?.length || 0) + (submenuItems?.length || 0);
  }, [standaloneMenus, submenuItems]);

  const accessibleTabs = useMemo(() => {
    const tabs: { key: SetupTabKey; label: string; icon: React.ElementType; badge?: string }[] = [];

    if (!canAccessSetupHub) {
      return tabs;
    }

    // 1. Konfigurasi Sistem & Master Data (Super Admin & Management Data)
    if (isSuperadmin || isManagement) {
      tabs.push({ key: 'app_config', label: 'Konfigurasi Sistem', icon: Building2 });
      tabs.push({
        key: 'nav_config',
        label: `Menu Navigasi (${totalNavMenusCount > 0 ? totalNavMenusCount : 10})`,
        icon: FolderTree
      });
      tabs.push({
        key: 'ui_builder',
        label: `Kolom & Tampilan UI (${config.ticketsTable.columns.length} Kolom)`,
        icon: LayoutTemplate
      });
      tabs.push({ key: 'database', label: 'Database & Sync', icon: Database });
    }

    // 2. Users & Roles (Superadmin only)
    if (isSuperadmin) {
      tabs.push({ key: 'users', label: 'Pengguna & Akun', icon: Users });
      tabs.push({ key: 'roles', label: 'Role & Permission', icon: Shield });
    }

    // 3. Kategori Report (Superadmin, Dispatch, Management Data)
    if (isSuperadmin || isDispatch || isManagement) {
      tabs.push({ key: 'droplists', label: 'Kategori Report', icon: List });
    }

    // 4. WhatsApp Templates & Workflows (Superadmin & Dispatch)
    if (isSuperadmin || isDispatch) {
      tabs.push({ key: 'whatsapp', label: 'Template WhatsApp', icon: MessageSquare });
      tabs.push({ key: 'workflows', label: 'Workflows & Otomasi', icon: GitBranch });
    }

    // 5. Notifikasi & Audio (Allowed Setup Hub roles)
    tabs.push({ key: 'sound', label: 'Notifikasi & Audio', icon: Volume2 });

    // 6. System Health & Logs (Superadmin only)
    if (isSuperadmin) {
      tabs.push({ key: 'health_logs', label: 'Kesehatan & Log', icon: Activity });
    }

    return tabs;
  }, [
    canAccessSetupHub,
    isSuperadmin,
    isDispatch,
    isManagement,
    totalNavMenusCount,
    config.ticketsTable.columns.length
  ]);

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

  const formattedLastModified = lastCloudSyncTime
    ? `${new Date(lastCloudSyncTime).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      })} WIB`
    : 'Belum disinkronkan';

  return (
    <div className="space-y-5">
      {/* Stitch AI Sticky Sub-Header & Numbered Tab Ribbon */}
      <div className="bg-white dark:bg-[#1E1238] rounded-xl px-5 pt-4 pb-2.5 text-[#211A2E] dark:text-white shadow-2xs border border-[#E9E5F0] dark:border-[#35105E]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-[#211A2E] dark:text-white">
                SETUP TERPUSAT MORAJAWS
              </h1>
              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#5B35B1] whitespace-nowrap">
                PUSAT KONFIGURASI SISTEM {accessibleTabs.length}-TAB
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${
                  isCloudSyncing
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800'
                    : cloudSyncStatus === 'synced'
                    ? 'bg-[#ECFDF5] text-[#16A36A] border-[#A7F3D0] dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                    : cloudSyncStatus === 'error'
                    ? 'bg-[#FEF2F2] text-[#DC4C5A] border-[#FECACA] dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                }`}
              >
                {isCloudSyncing ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      cloudSyncStatus === 'synced'
                        ? 'bg-[#16A36A]'
                        : cloudSyncStatus === 'error'
                        ? 'bg-[#DC4C5A]'
                        : 'bg-amber-500'
                    }`}
                  />
                )}
                <span>
                  {isCloudSyncing
                    ? 'Sinkronisasi SSE...'
                    : cloudSyncStatus === 'synced'
                    ? 'SSE Live Sync Active'
                    : cloudSyncStatus === 'error'
                    ? 'SSE Sync Error'
                    : 'Mode Lokal'}
                </span>
              </span>
            </div>

            {/* Metadata Line */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
              <span className="inline-flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#431599] dark:text-[#A78BFA]" />
                <span>Supabase PostgreSQL (</span>
                <strong className="font-mono text-[#211A2E] dark:text-white">Cluster: JKT-01</strong>
                <span>)</span>
              </span>
              <span className="text-[#D8CCF3] dark:text-[#5B35B1]">•</span>
              <span className="inline-flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#16A36A]" />
                <span>
                  Sinkronisasi Otomatis {cloudSyncStatus === 'synced' ? 'Aktif' : 'Siaga'}
                </span>
              </span>
              <span className="text-[#D8CCF3] dark:text-[#5B35B1]">•</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#8B8495]" />
                <span>
                  Last Modified: {formattedLastModified} oleh{' '}
                  <strong className="text-[#211A2E] dark:text-white">
                    {currentUser?.name || 'Super Admin'}
                  </strong>
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto bg-[#F7F6FA] dark:bg-[#160D29] px-3 py-1.5 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] text-xs shrink-0">
            <ShieldCheck className="w-4 h-4 text-[#16A36A]" />
            <span className="text-[#766B83] dark:text-[#CEC0E8]">Hak Akses:</span>
            <span className="font-bold font-mono uppercase text-[#431599] dark:text-[#D8B4FE]">
              {currentUser?.role?.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Numbered 01..NN Tab Navigation Ribbon */}
        <div className="mt-4 pt-2.5 border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center gap-1.5 overflow-x-auto pb-1">
          {accessibleTabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.key;
            const tabNumber = String(idx + 1).padStart(2, '0');
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-[#2D115B] text-white font-bold shadow-xs'
                    : 'text-[#494453] dark:text-[#CEC0E8] font-semibold hover:text-[#431599] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E]'
                }`}
              >
                <span
                  className={`font-mono text-[10.5px] font-bold tabular-nums ${
                    isActive ? 'text-[#D8B4FE]' : 'text-[#8B8495]'
                  }`}
                >
                  {tabNumber}
                </span>
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#D8B4FE]' : 'text-[#8B8495]'}`} />
                <span>{tab.label}</span>
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#A78BFA] ml-0.5" />}
                {tab.badge && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-[#F4EAFF] text-[#431599]'
                    }`}
                  >
                    {tab.badge}
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
            <SystemSettings defaultTab="contractors" embeddedInSetupHub />
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
            <UIConfigurationBuilder
              onNavigateToTickets={onNavigateTab ? () => onNavigateTab('tickets') : undefined}
            />
          </div>
        )}

        {/* 8. Database & Sinkronisasi */}
        {currentTab === 'database' && (isSuperadmin || isManagement) && (
          <div className="space-y-4">
            {/* Sub-tab Switcher for Database */}
            <div className="flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-[#1A0E2E] rounded-xl border border-slate-200 dark:border-purple-900/60 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setDbSubTab('management')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  dbSubTab === 'management'
                    ? 'bg-[#5B35B1] text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
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
                    ? 'bg-[#5B35B1] text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
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
                    ? 'bg-[#5B35B1] text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
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

        {/* 10. Kesehatan & Log Sistem */}
        {currentTab === 'health_logs' && isSuperadmin && (
          <div className="space-y-4">
            {/* Sub-tab Switcher for Logs */}
            <div className="flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-[#1A0E2E] rounded-xl border border-slate-200 dark:border-purple-900/60 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setLogSubTab('health')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  logSubTab === 'health'
                    ? 'bg-[#5B35B1] text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
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
                    ? 'bg-[#5B35B1] text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
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
                    ? 'bg-[#5B35B1] text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
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
    </div>
  );
};
