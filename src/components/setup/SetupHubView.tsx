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
      <div className="card-3d-lavender rounded-2xl p-6 sm:p-8 border border-rose-200 dark:border-rose-900/70 text-center max-w-lg mx-auto space-y-4 my-8">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-display font-extrabold text-[#1F1638] dark:text-white text-base">
          Akses Ditolak: SETUP TERPUSAT MORAJAWS
        </h3>
        <p className="text-xs text-[#4B4452] dark:text-[#CABDE8] leading-relaxed">
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
      {/* Sticky Sub-Header & 3D Tactile Tab Ribbon */}
      <div className="card-3d-lavender rounded-2xl px-4 sm:px-6 pt-5 pb-4 text-[#1F1638] dark:text-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-gradient-to-b from-[#6b103b] to-[#480123] text-white shadow-[0_2px_0_#260112] whitespace-nowrap">
                SETUP TERPUSAT · {accessibleTabs.length}-TAB
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${
                  isCloudSyncing
                    ? 'bg-[#F3EAFF] text-[#58149C] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#DAB9FF] dark:border-[#5B35B1]'
                    : cloudSyncStatus === 'synced'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                    : cloudSyncStatus === 'error'
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                }`}
              >
                {isCloudSyncing && <RefreshCw className="w-3 h-3 animate-spin" />}
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

            <h1 className="font-display text-lg sm:text-2xl font-extrabold tracking-tight text-[#1F1638] dark:text-white">
              SETUP TERPUSAT MORAJAWS
            </h1>

            {/* Metadata Line */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
              <span className="inline-flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                <span>Supabase PostgreSQL (</span>
                <strong className="font-mono text-[#1F1638] dark:text-white">Cluster: JKT-01</strong>
                <span>)</span>
              </span>
              <span className="text-[#CEC3D4] dark:text-[#4B386B]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Sinkronisasi Otomatis {cloudSyncStatus === 'synced' ? 'Aktif' : 'Siaga'}
                </span>
              </span>
              <span className="text-[#CEC3D4] dark:text-[#4B386B]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#7D7484] dark:text-[#CABDE8]" />
                <span>
                  Last Modified: <span className="font-mono tabular-nums">{formattedLastModified}</span> oleh{' '}
                  <strong className="text-[#1F1638] dark:text-white">
                    {currentUser?.name || 'Super Admin'}
                  </strong>
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto bg-[#F8F1FF] dark:bg-[#160D29] px-3.5 py-2 rounded-xl border border-[#E8DDFF] dark:border-[#3B1D78] text-xs shrink-0 shadow-[inset_0_1px_2px_rgba(31,22,56,0.05)]">
            <ShieldCheck className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />
            <span className="text-[#4B4452] dark:text-[#CABDE8]">Hak Akses:</span>
            <span className="font-extrabold font-mono uppercase text-[#58149C] dark:text-[#DAB9FF]">
              {currentUser?.role?.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Numbered 01..NN 3D Tactile Tab Navigation Ribbon */}
        <div className="mt-4 mj-tactile-tab-bar p-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {accessibleTabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.key;
            const tabNumber = String(idx + 1).padStart(2, '0');
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 min-h-[42px] sm:min-h-[36px] rounded-lg text-xs whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                  isActive
                    ? 'btn-3d-primary font-bold'
                    : 'text-[#4B4452] dark:text-[#CABDE8] font-semibold hover:text-[#1F1638] dark:hover:text-white hover:bg-white/75 dark:hover:bg-[#261942]'
                }`}
              >
                <span
                  className={`font-mono text-[10.5px] font-bold tabular-nums ${
                    isActive ? 'text-[#EEDBFF]' : 'text-[#7D7484] dark:text-[#A79BC0]'
                  }`}
                >
                  {tabNumber}
                </span>
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#EEDBFF]' : 'text-[#58149C] dark:text-[#DAB9FF]'}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold font-mono tabular-nums ${
                      isActive ? 'bg-white/20 text-white' : 'bg-[#EEDBFF] text-[#58149C] dark:bg-[#35105E] dark:text-[#DAB9FF]'
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
            <UserManagementView onOpenRolesTab={() => setActiveTab('roles')} />
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
            <SoundSettingsView onNavigateTab={onNavigateTab} />
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
            <div className="mj-tactile-tab-bar rounded-xl flex items-center gap-1.5 p-1.5 text-xs font-semibold overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setDbSubTab('management')}
                className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[34px] rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  dbSubTab === 'management'
                    ? 'btn-3d-primary font-bold'
                    : 'text-[#4B4452] dark:text-[#CABDE8] hover:text-[#1F1638] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Database &amp; Backup</span>
              </button>
              <button
                type="button"
                onClick={() => setDbSubTab('monitoring')}
                className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[34px] rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  dbSubTab === 'monitoring'
                    ? 'btn-3d-primary font-bold'
                    : 'text-[#4B4452] dark:text-[#CABDE8] hover:text-[#1F1638] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>Monitoring Realtime Sync</span>
              </button>
              <button
                type="button"
                onClick={() => setDbSubTab('sheets')}
                className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[34px] rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  dbSubTab === 'sheets'
                    ? 'btn-3d-primary font-bold'
                    : 'text-[#4B4452] dark:text-[#CABDE8] hover:text-[#1F1638] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
                }`}
              >
                <FileSpreadsheet className={`w-3.5 h-3.5 ${dbSubTab === 'sheets' ? 'text-[#EEDBFF]' : 'text-emerald-600 dark:text-emerald-400'}`} />
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
            <div className="mj-tactile-tab-bar rounded-xl flex items-center gap-1.5 p-1.5 text-xs font-semibold overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setLogSubTab('health')}
                className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[34px] rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  logSubTab === 'health'
                    ? 'btn-3d-primary font-bold'
                    : 'text-[#4B4452] dark:text-[#CABDE8] hover:text-[#1F1638] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Status Kesehatan Sistem</span>
              </button>
              <button
                type="button"
                onClick={() => setLogSubTab('audit')}
                className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[34px] rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  logSubTab === 'audit'
                    ? 'btn-3d-primary font-bold'
                    : 'text-[#4B4452] dark:text-[#CABDE8] hover:text-[#1F1638] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Audit Trail Log</span>
              </button>
              <button
                type="button"
                onClick={() => setLogSubTab('login')}
                className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[34px] rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  logSubTab === 'login'
                    ? 'btn-3d-primary font-bold'
                    : 'text-[#4B4452] dark:text-[#CABDE8] hover:text-[#1F1638] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Riwayat Sesi &amp; Login</span>
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
