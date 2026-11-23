import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
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
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Cpu,
  Mail
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
import { EmailNotificationCenterView } from '../settings/EmailNotificationCenterView';

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
  | 'email_notifications'
  | 'ui_builder'
  | 'database'
  | 'workflows'
  | 'health_logs';

interface SetupCategoryDef {
  id: string;
  code: string;
  title: string;
  tabKeys: SetupTabKey[];
}

const SETUP_CATEGORIES: SetupCategoryDef[] = [
  {
    id: 'cat_system',
    code: '01 — SYSTEM CONFIGURATION',
    title: 'Konfigurasi Sistem & UI',
    tabKeys: ['app_config', 'nav_config', 'ui_builder']
  },
  {
    id: 'cat_data',
    code: '02 — DATA & INTEGRATION',
    title: 'Database & Sinkronisasi',
    tabKeys: ['database']
  },
  {
    id: 'cat_users',
    code: '03 — USERS & ACCESS CONTROL',
    title: 'Pengguna & RBAC',
    tabKeys: ['users', 'roles']
  },
  {
    id: 'cat_ops',
    code: '04 — OPERATIONAL CONFIGURATION',
    title: 'Operasional, WA & Otomasi',
    tabKeys: ['droplists', 'whatsapp', 'workflows']
  },
  {
    id: 'cat_pref',
    code: '05 — PREFERENCES & MONITORING',
    title: 'Notifikasi, Audio & Kesehatan Sistem',
    tabKeys: ['sound', 'email_notifications', 'health_logs']
  }
];

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
    contractors,
    rootCauseCategories,
    databaseStatus,
    syncStatus,
    refreshDatabaseData
  } = useApp();
  const {
    config,
    cloudSyncStatus,
    isCloudSyncing,
    lastCloudSyncTime,
    standaloneMenus,
    submenuItems
  } = useUIConfig();
  const { toast } = useToast();

  const normalizedInitialTab: SetupTabKey =
    initialTab === 'master_data' || initialTab === 'general' ? 'app_config' : initialTab;
  const [activeTab, setActiveTab] = useState<SetupTabKey>(normalizedInitialTab);
  const [dbSubTab, setDbSubTab] = useState<'management' | 'monitoring' | 'sheets'>('management');
  const [logSubTab, setLogSubTab] = useState<'health' | 'audit' | 'login'>('health');
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isRefreshingCloud, setIsRefreshingCloud] = useState(false);

  useEffect(() => {
    setActiveTab(normalizedInitialTab);
  }, [normalizedInitialTab]);

  const userRole = currentUser?.role || 'installer';

  // Check role-based tab access (App Flow: allow Superadmin and Dispatch)
  const isSuperadmin = userRole === 'super_admin';
  const isDispatch = userRole === 'dispatch';
  const canAccessSetupHub = isSuperadmin || isDispatch;

  const totalNavMenusCount = useMemo(() => {
    return (standaloneMenus?.length || 0) + (submenuItems?.length || 0);
  }, [standaloneMenus, submenuItems]);

  const accessibleTabs = useMemo(() => {
    const tabs: {
      key: SetupTabKey;
      label: string;
      shortLabel: string;
      icon: React.ElementType;
      badge?: string;
    }[] = [];

    if (!canAccessSetupHub) {
      return tabs;
    }

    // 1. Konfigurasi Sistem & Master Data (Superadmin)
    if (isSuperadmin) {
      tabs.push({
        key: 'app_config',
        label: 'Konfigurasi Sistem',
        shortLabel: 'Konfigurasi',
        icon: Building2,
        badge: contractors.length > 0 ? String(contractors.length) : undefined
      });
      tabs.push({
        key: 'nav_config',
        label: 'Menu Navigasi',
        shortLabel: 'Navigasi',
        icon: FolderTree,
        badge: String(totalNavMenusCount > 0 ? totalNavMenusCount : 10)
      });
      tabs.push({
        key: 'ui_builder',
        label: 'Kolom & Tampilan UI',
        shortLabel: 'Tampilan UI',
        icon: LayoutTemplate,
        badge: `${config.ticketsTable.columns.length}`
      });
      tabs.push({
        key: 'database',
        label: 'Database & Sync',
        shortLabel: 'Database',
        icon: Database
      });
    }

    // 2. Users & Roles (Superadmin only)
    if (isSuperadmin) {
      tabs.push({
        key: 'users',
        label: 'Pengguna & Akun',
        shortLabel: 'Pengguna',
        icon: Users,
        badge: users.length > 0 ? String(users.length) : undefined
      });
      tabs.push({
        key: 'roles',
        label: 'Role & Permission',
        shortLabel: 'RBAC',
        icon: Shield,
        badge: '4'
      });
    }

    // 3. Kategori Report (Superadmin & Dispatch)
    if (isSuperadmin || isDispatch) {
      tabs.push({
        key: 'droplists',
        label: 'Kategori Report',
        shortLabel: 'Kategori',
        icon: List,
        badge: rootCauseCategories.length > 0 ? String(rootCauseCategories.length) : undefined
      });
    }

    // 4. WhatsApp Templates & Workflows (Superadmin & Dispatch)
    if (isSuperadmin || isDispatch) {
      tabs.push({
        key: 'whatsapp',
        label: 'Template WhatsApp',
        shortLabel: 'WhatsApp',
        icon: MessageSquare
      });
      tabs.push({
        key: 'workflows',
        label: 'Workflows & Otomasi',
        shortLabel: 'Workflows',
        icon: GitBranch
      });
    }

    // 5. Notifikasi & Audio (Allowed Setup Hub roles)
    tabs.push({
      key: 'sound',
      label: 'Notifikasi & Audio',
      shortLabel: 'Audio',
      icon: Volume2
    });

    // 5b. Automated Email Notification Center (Superadmin only)
    if (isSuperadmin) {
      tabs.push({
        key: 'email_notifications',
        label: 'Email Notification',
        shortLabel: 'Email',
        icon: Mail
      });
    }

    // 6. System Health & Logs (Superadmin only)
    if (isSuperadmin) {
      tabs.push({
        key: 'health_logs',
        label: 'Kesehatan & Log',
        shortLabel: 'Kesehatan',
        icon: Activity
      });
    }

    return tabs;
  }, [
    canAccessSetupHub,
    isSuperadmin,
    isDispatch,
    totalNavMenusCount,
    config.ticketsTable.columns.length,
    contractors.length,
    users.length,
    rootCauseCategories.length
  ]);

  if (!canAccessSetupHub) {
    return (
      <div className="card-3d-lavender rounded-2xl p-6 sm:p-8 border border-rose-200 dark:border-rose-900/70 text-center max-w-lg mx-auto space-y-4 my-8">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-display font-extrabold text-[#26364A] dark:text-white text-base">
          Akses Ditolak: SETUP TERPUSAT MORAJAWS
        </h3>
        <p className="text-xs text-[#52647A] dark:text-[#CABDE8] leading-relaxed">
          Pusat Setup Terpusat MoraJaws dilindungi dan tidak dapat diakses oleh peran <strong>{userRole}</strong>.
        </p>
      </div>
    );
  }

  // Ensure active tab is allowed, otherwise fallback to first accessible
  const currentTab = accessibleTabs.some(t => t.key === activeTab) ? activeTab : (accessibleTabs[0]?.key || 'sound');
  const activeTabMeta = accessibleTabs.find(t => t.key === currentTab) || accessibleTabs[0];

  // Build grouped categories strictly filtered by accessibleTabs
  const visibleCategories = useMemo(() => {
    return SETUP_CATEGORIES.map(cat => ({
      ...cat,
      items: cat.tabKeys
        .map(k => accessibleTabs.find(t => t.key === k))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
    })).filter(cat => cat.items.length > 0);
  }, [accessibleTabs]);

  const activeCategoryMeta = useMemo(() => {
    return visibleCategories.find(c => c.items.some(i => i.key === currentTab)) || visibleCategories[0];
  }, [visibleCategories, currentTab]);

  // Global numbered index lookup (01..11) for accessible items
  const tabNumberMap = useMemo(() => {
    const map = new Map<SetupTabKey, string>();
    accessibleTabs.forEach((t, idx) => {
      map.set(t.key, String(idx + 1).padStart(2, '0'));
    });
    return map;
  }, [accessibleTabs]);

  const formattedLastModified = lastCloudSyncTime
    ? `${new Date(lastCloudSyncTime).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      })} WIB`
    : 'Belum disinkronkan';

  const handleManualCloudRefresh = async () => {
    setIsRefreshingCloud(true);
    try {
      await refreshDatabaseData();
      toast.success('Status konfigurasi & database berhasil disegarkan dari Supabase PostgreSQL.');
    } finally {
      setIsRefreshingCloud(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ================================================================ */}
      {/* MOBILE CLUSTER STATUS STRIP (STITCH TEMPLATE 3)                  */}
      {/* ================================================================ */}
      <div className="lg:hidden flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#3B1D78] shadow-xs text-[11px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 font-mono font-bold text-[#26364A] dark:text-white truncate">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                databaseStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            Cloud Live · JKT-01
          </span>
          <span className="text-[#CBD5E1] dark:text-[#4B386B]">·</span>
          <span className="font-mono font-semibold text-[#5145A6] dark:text-[#DAB9FF] truncate">
            {isCloudSyncing || isRefreshingCloud ? 'Syncing...' : cloudSyncStatus === 'synced' ? 'SSE Active' : 'Lokal'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleManualCloudRefresh}
          disabled={isRefreshingCloud}
          className="mj-btn-superadmin-lilac px-2.5 py-1 rounded-lg text-[10.5px] font-bold gap-1 shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshingCloud ? 'animate-spin' : ''}`} />
          <span>Sync</span>
        </button>
      </div>

      {/* ================================================================ */}
      {/* ZONE A: SETUP HUB HERO HEADER (STITCH TEMPLATES 1 & 3)           */}
      {/* ================================================================ */}
      <div className="card-3d-lavender rounded-2xl px-4 sm:px-6 py-4 sm:py-5 text-[#26364A] dark:text-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            {/* Badges & Breadcrumb */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:bg-gradient-to-b dark:from-[#6b103b] dark:to-[#480123] dark:text-white dark:shadow-[0_2px_0_#260112] whitespace-nowrap">
                {currentUser?.role?.replace('_', ' ')} · {accessibleTabs.length}-TAB
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${
                  isCloudSyncing || isRefreshingCloud
                    ? 'bg-[#EAE8FF] text-[#5145A6] border-[#C5BEEF] dark:bg-[#2E1459] dark:text-[#DAB9FF] dark:border-[#5B35B1]'
                    : cloudSyncStatus === 'synced'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                    : cloudSyncStatus === 'error'
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                }`}
              >
                {(isCloudSyncing || isRefreshingCloud) && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span>
                  {isCloudSyncing || isRefreshingCloud
                    ? 'Sinkronisasi SSE...'
                    : cloudSyncStatus === 'synced'
                    ? 'SSE Live Sync Active'
                    : cloudSyncStatus === 'error'
                    ? 'SSE Sync Error'
                    : 'Mode Lokal'}
                </span>
              </span>

              {activeCategoryMeta && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10.5px] font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF] bg-[#EAE8FF] dark:bg-[#2A164F] px-2.5 py-0.5 rounded-md border border-[#C5BEEF] dark:border-[#4A258D]">
                  <span>{activeCategoryMeta.code}</span>
                  <ChevronRight className="w-3 h-3" />
                  <span>{activeTabMeta?.label}</span>
                </span>
              )}
            </div>

            <h1 className="font-display text-lg sm:text-2xl font-extrabold tracking-tight text-[#26364A] dark:text-white">
              SETUP TERPUSAT MORAJAWS
            </h1>

            {/* Metadata Strip */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#52647A] dark:text-[#CABDE8]">
              <span className="inline-flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                <span>Supabase PostgreSQL (</span>
                <strong className="font-mono text-[#26364A] dark:text-white">Cluster: JKT-01</strong>
                <span>)</span>
              </span>
              <span className="text-[#CBD5E1] dark:text-[#4B386B]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Sinkronisasi Otomatis {cloudSyncStatus === 'synced' ? 'Aktif' : 'Siaga'}</span>
              </span>
              <span className="text-[#CBD5E1] dark:text-[#4B386B]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#CABDE8]" />
                <span>
                  Last Modified: <span className="font-mono tabular-nums">{formattedLastModified}</span> oleh{' '}
                  <strong className="text-[#26364A] dark:text-white">
                    {currentUser?.name || 'Super Admin'}
                  </strong>
                </span>
              </span>
            </div>
          </div>

          {/* Right Quick Status & Actions (Desktop) */}
          <div className="hidden lg:flex items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2 bg-[#F4F7FB] dark:bg-[#160D29] px-3.5 py-2 rounded-xl border border-[#DDE6F0] dark:border-[#3B1D78] text-xs shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)]">
              <ShieldCheck className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
              <span className="text-[#52647A] dark:text-[#CABDE8]">Hak Akses:</span>
              <span className="font-extrabold font-mono uppercase text-[#5145A6] dark:text-[#DAB9FF]">
                {currentUser?.role?.replace('_', ' ')}
              </span>
            </div>

            <button
              type="button"
              onClick={handleManualCloudRefresh}
              disabled={isRefreshingCloud}
              className="mj-btn-superadmin-lilac px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold gap-1.5 cursor-pointer"
              title="Segarkan seluruh data Setup dari Supabase PostgreSQL"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingCloud ? 'animate-spin' : ''}`} />
              <span>Sync Cloud</span>
            </button>

            {isSuperadmin && currentTab !== 'roles' && (
              <button
                type="button"
                onClick={() => setActiveTab('roles')}
                className="mj-btn-superadmin-primary px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold gap-1.5 cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Matriks RBAC</span>
              </button>
            )}
          </div>
        </div>

        {/* ============================================================== */}
        {/* MOBILE COLLAPSIBLE CATEGORY DRAWER + HORIZONTAL 3D TABS        */}
        {/* ============================================================== */}
        <div className="mt-3.5 lg:hidden space-y-2.5">
          {/* Collapsible Modul Terpilih Accordion */}
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(prev => !prev)}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#4A258D] text-left cursor-pointer"
          >
            <div className="min-w-0">
              <div className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF] truncate">
                Modul Terpilih · {activeCategoryMeta?.code}
              </div>
              <div className="text-xs font-extrabold text-[#26364A] dark:text-white flex items-center gap-1.5 mt-0.5">
                {activeTabMeta && (
                  <>
                    <activeTabMeta.icon className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                    <span>{activeTabMeta.label}</span>
                  </>
                )}
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0 transition-transform ${
                mobileDrawerOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {mobileDrawerOpen && (
            <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3B1D78] space-y-3">
              {visibleCategories.map(cat => (
                <div key={cat.id} className="space-y-1.5">
                  <div className="text-[10px] font-mono font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0] px-1">
                    {cat.code}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {cat.items.map(tab => {
                      const Icon = tab.icon;
                      const isActive = currentTab === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => {
                            setActiveTab(tab.key);
                            setMobileDrawerOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 min-h-[42px] rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            isActive
                              ? 'btn-3d-primary text-white'
                              : 'bg-white dark:bg-[#1E1238] text-[#26364A] dark:text-[#EEDBFF] border border-[#DDE6F0] dark:border-[#35105E]'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`font-mono text-[10px] ${isActive ? 'text-white/85 dark:text-[#EEDBFF]' : 'text-[#8492A5]'}`}>
                              {tabNumberMap.get(tab.key)}
                            </span>
                            <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-[#5145A6] dark:text-[#DAB9FF]'}`} />
                            <span className="truncate">{tab.label}</span>
                          </span>
                          {tab.badge && (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF]'
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
              ))}
            </div>
          )}

          {/* Horizontal Scrollable 3D Module Tabs */}
          <div className="mj-tactile-tab-bar p-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {accessibleTabs.map((tab, idx) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.key;
              const tabNumber = String(idx + 1).padStart(2, '0');
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 min-h-[42px] rounded-lg text-xs whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                    isActive
                      ? 'btn-3d-primary font-bold'
                      : 'text-[#52647A] dark:text-[#CABDE8] font-semibold hover:text-[#26364A] dark:hover:text-white hover:bg-white/75 dark:hover:bg-[#261942]'
                  }`}
                >
                  <span
                    className={`font-mono text-[10.5px] font-bold tabular-nums ${
                      isActive ? 'text-white/85 dark:text-[#EEDBFF]' : 'text-[#8492A5] dark:text-[#A79BC0]'
                    }`}
                  >
                    {tabNumber}
                  </span>
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white/95 dark:text-[#EEDBFF]' : 'text-[#5145A6] dark:text-[#DAB9FF]'}`} />
                  <span>{tab.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* DESKTOP 12-COLUMN SPLIT: ZONE B (VERTICAL TREE) + ZONE C (MAIN)  */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ZONE B: Desktop Vertical 5-Category Navigation + Edge Node Telemetry */}
        <aside className="hidden lg:block lg:col-span-4 xl:col-span-3 space-y-4 sticky top-4">
          <div className="card-3d-lavender rounded-2xl p-3.5 space-y-4">
            <div className="flex items-center justify-between px-1.5 pb-2 border-b border-[#E2E8F0] dark:border-[#35105E]">
              <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                Kategori Setup
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF]">
                {accessibleTabs.length} Modul
              </span>
            </div>

            <div className="space-y-4">
              {visibleCategories.map(cat => (
                <div key={cat.id} className="space-y-1.5">
                  <div className="px-1.5 text-[10px] font-mono font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                    {cat.code}
                  </div>
                  <div className="space-y-1.5">
                    {cat.items.map(tab => {
                      const Icon = tab.icon;
                      const isActive = currentTab === tab.key;
                      const num = tabNumberMap.get(tab.key);
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setActiveTab(tab.key)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs transition-all cursor-pointer text-left ${
                            isActive
                              ? 'btn-3d-primary font-bold text-white'
                              : 'bg-[#F4F7FB]/85 dark:bg-[#160D29]/80 hover:bg-white dark:hover:bg-[#261942] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#EEDBFF] font-semibold'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className={`font-mono text-[10px] font-bold tabular-nums shrink-0 ${
                                isActive ? 'text-white/85 dark:text-[#EEDBFF]' : 'text-[#8492A5] dark:text-[#A79BC0]'
                              }`}
                            >
                              {num}
                            </span>
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                isActive ? 'text-white' : 'text-[#5145A6] dark:text-[#DAB9FF]'
                              }`}
                            />
                            <span className="truncate">{tab.label}</span>
                          </span>

                          {tab.badge && (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tabular-nums shrink-0 ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-white dark:bg-[#2B1A4B] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DDE6F0] dark:border-[#4A258D]'
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
              ))}
            </div>
          </div>

          {/* Edge Node Telemetry Card (Soft Crystal Mist in Light Mode, Preserved Dark Purple in Night Mode) */}
          <div className="bg-gradient-to-br from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#160D29] dark:via-[#160D29] dark:to-[#160D29] text-[#26364A] dark:text-white rounded-2xl border border-[#C5BEEF] dark:border-[#35105E] p-4 shadow-[0_4px_0_#D2DAEA] dark:shadow-[0_4px_0_#0d061b] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#35105E] border border-[#C5BEEF] dark:border-[#7135B5]/50 flex items-center justify-center text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
                  <Cpu className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#5145A6] dark:text-[#A78BFA]">
                    Edge Node · JKT-01
                  </div>
                  <div className="text-xs font-extrabold text-[#26364A] dark:text-white truncate">
                    {databaseStatus === 'connected' ? 'PostgreSQL Realtime' : 'Mode Offline / Lokal'}
                  </div>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md text-[9.5px] font-mono font-extrabold uppercase shrink-0 ${
                  databaseStatus === 'connected'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40'
                    : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40'
                }`}
              >
                {databaseStatus === 'connected' ? 'LIVE' : 'LOCAL'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-xl bg-white/80 dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E]">
                <div className="text-[9.5px] text-[#52647A] dark:text-[#A78BFA] uppercase font-bold">Sync Queue</div>
                <div className="font-mono font-bold text-[#26364A] dark:text-white truncate mt-0.5">{syncStatus}</div>
              </div>
              <div className="p-2 rounded-xl bg-white/80 dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E]">
                <div className="text-[9.5px] text-[#52647A] dark:text-[#A78BFA] uppercase font-bold">Cloud State</div>
                <div className="font-mono font-bold text-emerald-700 dark:text-emerald-300 truncate mt-0.5">
                  {cloudSyncStatus}
                </div>
              </div>
            </div>

            {isSuperadmin && (
              <button
                type="button"
                onClick={() => setActiveTab('health_logs')}
                className="w-full py-2 px-3 rounded-xl bg-white hover:bg-[#EDF3F8] border border-[#C5BEEF] text-[#5145A6] dark:bg-[#2E1459] dark:hover:bg-[#3F1C78] dark:border-[#7135B5]/50 dark:text-[#EEDBFF] text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Buka Kesehatan &amp; Audit Log</span>
              </button>
            )}
          </div>
        </aside>

        {/* ZONE C: MAIN TAB CONTENT WORKSPACE */}
        <div className="lg:col-span-8 xl:col-span-9 min-w-0 transition-all">
          {/* 1. Konfigurasi Sistem & Master Data Terpusat */}
          {currentTab === 'app_config' && isSuperadmin && (
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
              <UserManagementView onOpenRolesTab={() => setActiveTab('roles')} />
            </div>
          )}

          {/* 3. Role & Otoritas */}
          {currentTab === 'roles' && isSuperadmin && (
            <div className="space-y-4">
              <ManagementRoleView onJumpSetupTab={tab => setActiveTab(tab as SetupTabKey)} />
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
              <SoundSettingsView
                onNavigateTab={onNavigateTab}
                onOpenEmailNotifications={isSuperadmin ? () => setActiveTab('email_notifications') : undefined}
              />
            </div>
          )}

          {/* 6b. Automated Email Notification Center (Superadmin only) */}
          {currentTab === 'email_notifications' && isSuperadmin && (
            <div className="space-y-4">
              <EmailNotificationCenterView />
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
          {currentTab === 'database' && isSuperadmin && (
            <div className="space-y-4">
              <div className="mj-tactile-tab-bar rounded-xl flex items-center gap-1.5 p-1.5 text-xs font-semibold overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setDbSubTab('management')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[34px] rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    dbSubTab === 'management'
                      ? 'btn-3d-primary font-bold'
                      : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
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
                      : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
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
                      : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
                  }`}
                >
                  <FileSpreadsheet className={`w-3.5 h-3.5 ${dbSubTab === 'sheets' ? 'text-white/95 dark:text-[#EEDBFF]' : 'text-emerald-600 dark:text-emerald-400'}`} />
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
              <div className="mj-tactile-tab-bar rounded-xl flex items-center gap-1.5 p-1.5 text-xs font-semibold overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setLogSubTab('health')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] sm:min-h-[34px] rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    logSubTab === 'health'
                      ? 'btn-3d-primary font-bold'
                      : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
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
                      : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
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
                      : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#261942]'
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
    </div>
  );
};
