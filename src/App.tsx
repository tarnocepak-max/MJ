import React, { useState, useMemo, useEffect, Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { UIConfigProvider, useUIConfig } from './context/UIConfigContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { AnimationProvider } from './context/AnimationContext';
import { OfflineSyncProvider } from './context/OfflineSyncContext';
import { MoraJawsSoundProvider, useMoraJawsSound } from './context/SoundContext';
import { ConfigConflictModal } from './components/common/ConfigConflictModal';
import { LoadingSkeleton } from './components/common/LoadingSkeleton';

import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { AndroidBottomNav } from './components/layout/AndroidBottomNav';
import { LeaderBottomNav, LeaderTabType } from './components/layout/LeaderBottomNav';
import { InstallerBottomNav } from './components/layout/InstallerBottomNav';

import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { DispatchVerificationDesk } from './components/dashboard/DispatchVerificationDesk';
import { TicketsTable } from './components/tickets/TicketsTable';
import { OverdueWorkOrdersView } from './components/tickets/OverdueWorkOrdersView';
import { FormSamedayView } from './components/sameday/FormSamedayView';

import { LeaderPortal } from './components/portals/LeaderPortal';
import { LeaderProgressDashboardView } from './components/portals/LeaderProgressDashboardView';
import { InstallerPortal, classifyInstallerStatus, StatusFilterCategory } from './components/portals/InstallerPortal';
import { InstallerDashboardView } from './components/portals/InstallerDashboardView';
import { InstallerWhatsAppCenter } from './components/whatsapp/InstallerWhatsAppCenter';
import { ManagementDataPortal } from './components/portals/ManagementDataPortal';
import { InstallerGpsSyncWidget } from './components/maps/InstallerGpsSyncWidget';
import { InstallerGpsGate } from './components/maps/InstallerGpsGate';
import {
  installerGpsTracker,
  type InstallerGpsUiSnapshot
} from './services/installerGpsTrackingService';
import { isValidCoordinatePair } from './services/mapsService';

import { StaffLoginPortal } from './components/auth/StaffLoginPortal';
import { ForcePasswordChangeModal } from './components/auth/ForcePasswordChangeModal';
import { SessionManagementModal } from './components/settings/SessionManagementModal';
import { OfflineSyncModal } from './components/offline/OfflineSyncModal';
import { OfflineBanner } from './components/offline/OfflineBanner';
import { TicketDetailModal } from './components/tickets/TicketDetailModal';
import { WhatsAppSendModal } from './components/whatsapp/WhatsAppSendModal';

import { Ticket } from './types';
import { Menu, Database } from 'lucide-react';
import { MoraJawsErrorBoundary } from './components/common/MoraJawsErrorBoundary';
import { getTicketAppointmentDate } from './services/appointmentDateParser';
import { ThemeBrandBackground } from './components/common/MoraRepublicBrandVisuals';

const SetupHubView = lazy(() =>
  import('./components/setup/SetupHubView').then(m => ({ default: m.SetupHubView }))
);
const ReportDataWOView = lazy(() =>
  import('./components/reports/ReportDataWOView').then(m => ({ default: m.ReportDataWOView }))
);
const HistoryProgressReportView = lazy(() =>
  import('./components/reports/HistoryProgressReportView').then(m => ({ default: m.HistoryProgressReportView }))
);
const ScheduleCalendarView = lazy(() =>
  import('./components/schedule/ScheduleCalendarView').then(m => ({ default: m.ScheduleCalendarView }))
);
const LoginLogView = lazy(() =>
  import('./components/audit/LoginLogView').then(m => ({ default: m.LoginLogView }))
);
const AuditLogViewer = lazy(() =>
  import('./components/audit/AuditLogViewer').then(m => ({ default: m.AuditLogViewer }))
);
const TemplateBuilder = lazy(() =>
  import('./components/whatsapp/TemplateBuilder').then(m => ({ default: m.TemplateBuilder }))
);
const ContractorAreaRecapView = lazy(() =>
  import('./components/reports/ContractorAreaRecapView').then(m => ({ default: m.ContractorAreaRecapView }))
);
const LocationBasecampView = lazy(() =>
  import('./components/contractors/LocationBasecampView').then(m => ({ default: m.LocationBasecampView }))
);
const SlaTelemetryDashboardView = lazy(() =>
  import('./components/sla/SlaTelemetryDashboardView').then(m => ({ default: m.SlaTelemetryDashboardView }))
);
const ContactCentreView = lazy(() =>
  import('./components/contact/ContactCentreView').then(m => ({ default: m.ContactCentreView }))
);
const DatabaseSyncMonitoringView = lazy(() =>
  import('./components/database/DatabaseSyncMonitoringView').then(m => ({ default: m.DatabaseSyncMonitoringView }))
);
const DatabaseManagementView = lazy(() =>
  import('./components/database/DatabaseManagementView').then(m => ({ default: m.DatabaseManagementView }))
);
const TextToTableImporter = lazy(() =>
  import('./components/textToTable/TextToTableImporter').then(m => ({ default: m.TextToTableImporter }))
);
const GoogleSheetsSyncView = lazy(() =>
  import('./components/sheets/GoogleSheetsSyncView').then(m => ({ default: m.GoogleSheetsSyncView }))
);
const MonitoringMapsView = lazy(() =>
  import('./components/maps/MonitoringMapsView').then(m => ({ default: m.MonitoringMapsView }))
);

const WO_NAVIGATION_ROUTES = new Set([
  'tickets',
  'dashboard',
  'overdue_wo',
  'leader_portal',
  'wo_assignment',
  'reassign_wo',
  'progress_dashboard',
  'installer_portal',
  'installer_dashboard',
  'installer_tasks',
  'installer_history',
  'verification_desk',
  'history_progress',
  'monitoring_maps'
]);

const MainLayout: React.FC = () => {
  const {
    currentUser,
    isLoggedIn,
    tickets,
    users,
    todayWIB,
    openOfflineSyncCenter,
    totalLiveChatUnreadCount,
    rolePermissions,
    hasPermission,
    globalConflict,
    resolveGlobalConflict,
    clearGlobalConflict,
    setActiveKpiDrilldown,
    revalidateWoView,
    completeMandatoryPasswordChange,
    logout
  } = useApp();
  const { config, setSidebarState, isMobileView, uiConflict, resolveUiConflict, clearUiConflict } = useUIConfig();
  const { soundConflict, resolveSoundConflict, clearSoundConflict } = useMoraJawsSound();
  const { toast } = useToast();

  const isInstaller = Boolean(isLoggedIn && currentUser?.role === 'installer');
  const [gpsSnapshot, setGpsSnapshot] = useState<InstallerGpsUiSnapshot>(() =>
    installerGpsTracker.getSnapshot()
  );

  useEffect(() => {
    if (!isInstaller) return;
    return installerGpsTracker.subscribe(setGpsSnapshot);
  }, [isInstaller]);

  const isInstallerGpsConnected = Boolean(
    !isInstaller ||
      (gpsSnapshot.active &&
        gpsSnapshot.permissionState === 'granted' &&
        isValidCoordinatePair(gpsSnapshot.latitude, gpsSnapshot.longitude) &&
        gpsSnapshot.lastSyncedAt !== null &&
        gpsSnapshot.locationStatus !== 'Permission Denied' &&
        gpsSnapshot.locationStatus !== 'GPS Disabled')
  );

  const installerAllowedTabs = useMemo(
    () => [
      'installer_dashboard',
      'installer_portal',
      'installer_tasks',
      'installer_progress',
      'installer_history',
      'installer_whatsapp',
      'whatsapp',
      'installer_chat',
      'live_chat',
      'contact_centre'
    ],
    []
  );

  // Initial active tab resolution: URL hash > localStorage > Role Default
  const getInitialActiveTab = (): string => {
    if (!isLoggedIn) return 'dashboard';
    const role = currentUser?.role;
    try {
      const hash = window.location.hash.replace('#', '').trim();
      const saved = localStorage.getItem(`morajaws_active_tab_${currentUser?.id || role}`);

      if (isInstaller) {
        if (hash && installerAllowedTabs.includes(hash)) return hash;
        if (saved && installerAllowedTabs.includes(saved)) return saved;
        return 'installer_dashboard';
      }

      if (hash) return hash;
      if (saved) return saved;
    } catch (e) {}

    if (role === 'installer') return 'installer_dashboard';
    if (role === 'leader') return 'wo_assignment';
    if (role === 'dispatch') return 'tickets';
    return 'dashboard';
  };

  const [activeTab, setActiveTab] = useState<string>(getInitialActiveTab);

  // Security guard: Force redirect installer away from global dashboard, tickets, or admin settings
  useEffect(() => {
    if (isInstaller && !installerAllowedTabs.includes(activeTab)) {
      setActiveTab('installer_dashboard');
      try {
        const userKey = currentUser?.id || currentUser?.role || 'default';
        localStorage.setItem(`morajaws_active_tab_${userKey}`, 'installer_dashboard');
        window.history.replaceState({ tab: 'installer_dashboard' }, '', '#installer_dashboard');
      } catch (e) {}
    }
  }, [isInstaller, activeTab, installerAllowedTabs, currentUser]);

  // Dynamic RBAC enforcement when Super Admin updates role permissions live via SSE
  useEffect(() => {
    if (!isLoggedIn || !currentUser?.role || currentUser.role === 'super_admin') return;
    const tabPermMap: Record<string, any> = {
      audit_logs: 'view_audit_logs',
      templates: 'manage_whatsapp_templates',
      database_management: 'database_management',
      ui_builder: 'ui_configuration',
      import: 'import_data',
      import_excel: 'import_data',
      droplist_management: 'setting_droplist',
      setting_droplist: 'setting_droplist',
      system_health: 'system_health'
    };
    const reqPerm = tabPermMap[activeTab];
    if (reqPerm && !hasPermission(reqPerm)) {
      const safeHome =
        currentUser.role === 'installer'
          ? 'installer_dashboard'
          : currentUser.role === 'leader'
          ? 'wo_assignment'
          : currentUser.role === 'dispatch'
          ? 'tickets'
          : 'dashboard';
      setActiveTab(safeHome);
      toast.warning(
        'Hak akses untuk halaman ini baru saja dicabut oleh Super Admin. Dialihkan ke beranda aman.',
        'Hak Akses Diperbarui'
      );
    }
  }, [rolePermissions, isLoggedIn, currentUser?.role, activeTab]);

  const getInitialLeaderSubTab = (): LeaderTabType => {
    if (
      ['progress_dashboard', 'wo_assignment', 'reassign_wo', 'contractor_recap', 'monitoring_maps'].includes(
        activeTab
      )
    ) {
      return activeTab as LeaderTabType;
    }
    return 'wo_assignment';
  };

  const [leaderSubTab, setLeaderSubTab] = useState<LeaderTabType>(getInitialLeaderSubTab);
  const [installerTaskFilter, setInstallerTaskFilter] = useState<StatusFilterCategory>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const liveSelectedTicket = useMemo(() => {
    if (!selectedTicket) return null;
    return tickets.find(t => t.id === selectedTicket.id) || selectedTicket;
  }, [selectedTicket, tickets]);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailDefaultTab, setDetailDefaultTab] = useState<'overview' | 'report' | 'chat' | 'history'>('overview');
  const [whatsAppTicket, setWhatsAppTicket] = useState<Ticket | null>(null);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [liveChatInitialTicketId, setLiveChatInitialTicketId] = useState<string | undefined>(undefined);

  // Central Navigation Dispatcher: updates activeTab, leaderSubTab, localStorage, and history state
  const navigateTo = (tab: string, pushHistory = true) => {
    let targetTab = tab;
    // Strict isolation: map any disallowed tabs back to installer_dashboard
    if (isInstaller && !installerAllowedTabs.includes(tab)) {
      targetTab = 'installer_dashboard';
    }
    if (currentUser?.role === 'leader' && targetTab === 'quota_settings') {
      targetTab = 'wo_assignment';
    }

    setActiveTab(targetTab);
    if (
      ['progress_dashboard', 'wo_assignment', 'reassign_wo', 'contractor_recap', 'monitoring_maps'].includes(
        targetTab
      )
    ) {
      setLeaderSubTab(targetTab as LeaderTabType);
    }
    try {
      const userKey = currentUser?.id || currentUser?.role || 'default';
      localStorage.setItem(`morajaws_active_tab_${userKey}`, targetTab);
    } catch (e) {}
    if (pushHistory) {
      if (window.location.hash !== `#${targetTab}`) {
        window.history.pushState({ tab: targetTab }, '', `#${targetTab}`);
      }
    }
  };

  // Browser Back/Forward history navigation listener
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const hash = window.location.hash.replace('#', '').trim();
      let targetTab = e.state?.tab || hash;
      if (targetTab) {
        if (isInstaller && !installerAllowedTabs.includes(targetTab)) {
          targetTab = 'installer_dashboard';
        }
        if (currentUser?.role === 'leader' && targetTab === 'quota_settings') {
          targetTab = 'wo_assignment';
        }
        setActiveTab(targetTab);
        if (
          ['progress_dashboard', 'wo_assignment', 'reassign_wo', 'contractor_recap', 'monitoring_maps'].includes(
            targetTab
          )
        ) {
          setLeaderSubTab(targetTab as LeaderTabType);
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isInstaller, installerAllowedTabs, currentUser?.role]);

  // Compute active tab for Leader Bottom Navigation
  const activeLeaderBottomTab: LeaderTabType = useMemo(() => {
    if (activeTab === 'progress_dashboard') return 'progress_dashboard';
    if (activeTab === 'reassign_wo') return 'reassign_wo';
    if (activeTab === 'contractor_recap' || activeTab === 'rekap_laporan' || activeTab === 'report_installer') {
      return 'contractor_recap';
    }
    if (activeTab === 'monitoring_maps') return 'monitoring_maps';
    if (activeTab === 'wo_assignment') return 'wo_assignment';
    if (
      ['progress_dashboard', 'wo_assignment', 'reassign_wo', 'contractor_recap', 'monitoring_maps'].includes(
        leaderSubTab
      )
    ) {
      return leaderSubTab;
    }
    return 'wo_assignment';
  }, [activeTab, leaderSubTab]);

  // Scoped unassigned tickets count for Leader's contractor (strictly today WIB)
  const leaderUnassignedCount = useMemo(() => {
    if (!isLoggedIn || currentUser?.role !== 'leader') return 0;
    const myContractor = String(currentUser?.contractor || '').toLowerCase().trim();
    return tickets.filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (getTicketAppointmentDate(t) !== todayWIB) return false;
      if (t.installerName) return false;
      if (!myContractor) return true;
      const tContractor = String(t.contactorName || t.contractorName || '').toLowerCase().trim();
      return (tContractor && myContractor && (tContractor.includes(myContractor) || myContractor.includes(tContractor)));
    }).length;
  }, [isLoggedIn, tickets, currentUser, todayWIB]);

  // Helper matching for logged-in technician
  const isInstallerMatch = (ticketInstaller: string | undefined, installerName: string) => {
    if (!ticketInstaller || !ticketInstaller.trim()) return false;
    const tInst = String(ticketInstaller).toLowerCase().trim();
    const effInst = String(installerName).toLowerCase().trim();
    if (!tInst || !effInst) return false;
    if (tInst === effInst) return true;
    if (tInst.includes(effInst) || effInst.includes(tInst)) return true;
    const cleanEff = effInst.replace(/\(.*?\)/g, '').trim();
    if (cleanEff && (tInst.includes(cleanEff) || cleanEff.includes(tInst))) return true;
    return false;
  };

  // Scoped pending tickets count for logged-in Installer (strictly today WIB)
  const installerPendingCount = useMemo(() => {
    if (!isLoggedIn || !isInstaller) return 0;
    const myName = (currentUser?.name || '').toLowerCase().trim();
    const myId = currentUser?.id || '';
    const myUsername = (currentUser?.username || '').toLowerCase().trim();

    return tickets.filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (getTicketAppointmentDate(t) !== todayWIB) return false;
      const assigned = (myId && t.assignedTo === myId) || (myUsername && t.assignedTo === myUsername);
      const tInst = (t.installerName || '').toLowerCase().trim();
      const nameMatch =
        (myName && (tInst === myName || isInstallerMatch(t.installerName, myName))) ||
        (myUsername && (tInst === myUsername || isInstallerMatch(t.installerName, myUsername)));
      if (!assigned && !nameMatch) return false;

      const cat = classifyInstallerStatus(t);
      return cat === 'pending';
    }).length;
  }, [isLoggedIn, isInstaller, tickets, currentUser, todayWIB]);

  // Personal unread LiveChat counter strictly scoped to active today WOs assigned to this Installer
  const installerUnreadChatCount = useMemo(() => {
    if (!isLoggedIn || !isInstaller) return 0;
    return totalLiveChatUnreadCount;
  }, [isLoggedIn, isInstaller, totalLiveChatUnreadCount]);

  // Scoped unconfirmed WhatsApp count for logged-in Installer (strictly today WIB)
  const installerWaPendingCount = useMemo(() => {
    if (!isLoggedIn || !isInstaller) return 0;
    const myName = (currentUser?.name || '').toLowerCase().trim();
    const myId = currentUser?.id || '';
    const myUsername = (currentUser?.username || '').toLowerCase().trim();

    return tickets.filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (getTicketAppointmentDate(t) !== todayWIB) return false;
      const assigned = (myId && t.assignedTo === myId) || (myUsername && t.assignedTo === myUsername);
      const tInst = (t.installerName || '').toLowerCase().trim();
      const nameMatch =
        (myName && (tInst === myName || isInstallerMatch(t.installerName, myName))) ||
        (myUsername && (tInst === myUsername || isInstallerMatch(t.installerName, myUsername)));
      if (!assigned && !nameMatch) return false;
      return t.statusWhatsApp !== 'confirmed' && t.statusWhatsApp !== 'cancelled';
    }).length;
  }, [isLoggedIn, isInstaller, tickets, currentUser, todayWIB]);

  const isFullWidth = config.global.contentWidth === 'full';
  const isFullChatMode = activeTab === 'contact_centre' || activeTab === 'installer_chat' || activeTab === 'live_chat';
  const currentSidebarState = config.global.sidebarState || (config.global.sidebarCollapsed ? 'minimized' : 'expanded');

  // Global Ctrl+K / Cmd+K shortcut -> open Sidebar (if closed) & focus Sidebar Global Search
  useEffect(() => {
    if (!isLoggedIn || isInstaller) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (currentSidebarState === 'closed') {
          (window as any).__mjFocusSidebarSearch = true;
          setSidebarState('expanded');
        }
        window.dispatchEvent(new CustomEvent('morajaws:focus-sidebar-search'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoggedIn, isInstaller, currentSidebarState, setSidebarState]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const handleOpenLiveChat = (e: Event) => {
      const detail = (e as CustomEvent<{ ticketId?: string }>).detail;
      if (detail?.ticketId) {
        setLiveChatInitialTicketId(detail.ticketId);
      }
      navigateTo(isInstaller ? 'installer_chat' : 'contact_centre');
    };
    window.addEventListener('morajaws:open-live-chat', handleOpenLiveChat);
    return () => window.removeEventListener('morajaws:open-live-chat', handleOpenLiveChat);
  }, [isLoggedIn, isInstaller]);

  // SWR background revalidation whenever navigating between WO routes
  useEffect(() => {
    if (!isLoggedIn || currentUser?.mustChangePassword) return;
    if (WO_NAVIGATION_ROUTES.has(activeTab)) {
      void revalidateWoView(activeTab);
    }
  }, [isLoggedIn, currentUser?.mustChangePassword, activeTab, revalidateWoView]);

  // Unauthenticated Staff Protection: Render dedicated Staff Login Portal
  if (!isLoggedIn) {
    return (
      <StaffLoginPortal
        onLoginSuccess={(role) => {
          if (role === 'installer') navigateTo('installer_dashboard');
          else if (role === 'leader') navigateTo('wo_assignment');
          else if (role === 'dispatch') navigateTo('tickets');
          else navigateTo('dashboard');
        }}
      />
    );
  }

  // Mandatory Password Reset Gate: Block access to main operational features until password changed
  if (currentUser?.mustChangePassword === true) {
    return (
      <div className="min-h-dvh mj-aurora-bg flex items-center justify-center p-4">
        <ForcePasswordChangeModal
          user={currentUser}
          onPasswordChanged={completeMandatoryPasswordChange}
          onLogout={logout}
        />
      </div>
    );
  }

  // Strict Installer GPS Gate: Do not render Installer Portal until browser GPS is granted, locked, and synced to Monitoring Maps
  if (isInstaller && !isInstallerGpsConnected) {
    return (
      <InstallerGpsGate
        currentUser={currentUser}
        gpsSnapshot={gpsSnapshot}
        onLogout={logout}
      />
    );
  }

  const handleOpenTicketDetail = (ticket: Ticket, defaultTab: 'overview' | 'report' | 'chat' | 'history' = 'overview') => {
    if (isInstaller) {
      const myName = (currentUser.name || '').toLowerCase().trim();
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const tInst = (ticket.installerName || '').toLowerCase().trim();
      const isMine =
        (myId && ticket.assignedTo === myId) ||
        (myUsername && (ticket.assignedTo === myUsername || (ticket.assignedTo && ticket.assignedTo.toLowerCase() === myUsername))) ||
        (myName && (tInst === myName || isInstallerMatch(ticket.installerName, myName))) ||
        (myUsername && (tInst === myUsername || isInstallerMatch(ticket.installerName, myUsername)));

      if (!isMine) {
        toast.error('Akses ditolak: Anda hanya dapat mengakses tiket yang ditugaskan kepada Anda.');
        return;
      }

      if (activeTab === 'installer_portal' || activeTab === 'installer_tasks') {
        // Installer uses the dedicated fullview experience inside InstallerPortal
        return;
      }
    }
    setSelectedTicket(ticket);
    setDetailDefaultTab(defaultTab);
    setIsDetailModalOpen(true);
  };

  const handleOpenWhatsAppModal = (ticket: Ticket) => {
    if (isInstaller) {
      const myName = (currentUser.name || '').toLowerCase().trim();
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const tInst = (ticket.installerName || '').toLowerCase().trim();
      const isMine =
        (myId && ticket.assignedTo === myId) ||
        (myUsername && (ticket.assignedTo === myUsername || (ticket.assignedTo && ticket.assignedTo.toLowerCase() === myUsername))) ||
        (myName && (tInst === myName || isInstallerMatch(ticket.installerName, myName))) ||
        (myUsername && (tInst === myUsername || isInstallerMatch(ticket.installerName, myUsername)));

      if (!isMine) {
        toast.error('Akses ditolak: Tiket ini bukan milik Anda.');
        return;
      }
    }
    setWhatsAppTicket(ticket);
    setIsWhatsAppModalOpen(true);
  };

  // Render view based on active tab with fallback
  const renderContent = () => {
    const handleInstallerNavigateTab = (tab: string, filter?: string) => {
      if (filter === 'field_requested') {
        setInstallerTaskFilter('tugas_baru');
      } else if (filter === 'field_checkin') {
        setInstallerTaskFilter('dalam_proses');
      } else if (
        filter === 'field_complete' ||
        filter === 'field_reschedule' ||
        filter === 'field_pending' ||
        filter === 'field_cancel'
      ) {
        setInstallerTaskFilter('selesai');
      } else if (
        filter &&
        [
          'tugas_baru',
          'dalam_proses',
          'selesai',
          'all',
          'pending',
          'butuh_approval',
          'revision',
          'done',
          'reschedule',
          'cancel'
        ].includes(filter)
      ) {
        setInstallerTaskFilter(filter as StatusFilterCategory);
      } else if (tab === 'installer_tasks') {
        setInstallerTaskFilter('tugas_baru');
      } else if (tab === 'installer_history') {
        setInstallerTaskFilter('selesai');
      } else {
        setInstallerTaskFilter('tugas_baru');
      }
      navigateTo(tab);
    };

    // EXCLUSIVE INSTALLER VIEWPORT (Dashboard, Tugas Saya, WhatsApp, Live Chat Center)
    if (isInstaller) {
      switch (activeTab) {
        case 'installer_dashboard':
          return (
            <InstallerDashboardView
              onNavigateTab={handleInstallerNavigateTab}
              onSelectTicket={handleOpenTicketDetail}
              onOpenWhatsApp={handleOpenWhatsAppModal}
            />
          );
        case 'installer_portal':
        case 'installer_tasks':
        case 'installer_progress':
        case 'installer_history':
          return (
            <InstallerPortal
              initialFilter={
                activeTab === 'installer_history'
                  ? 'selesai'
                  : installerTaskFilter === 'all' && activeTab === 'installer_tasks'
                  ? 'tugas_baru'
                  : installerTaskFilter
              }
              onSelectTicket={handleOpenTicketDetail}
              onOpenWhatsApp={handleOpenWhatsAppModal}
            />
          );
        case 'installer_whatsapp':
        case 'whatsapp':
          return (
            <InstallerWhatsAppCenter
              onOpenWhatsAppModal={handleOpenWhatsAppModal}
              onSelectTicket={handleOpenTicketDetail}
            />
          );
        case 'installer_chat':
        case 'live_chat':
        case 'contact_centre':
          return (
            <ContactCentreView
              initialTicketId={liveChatInitialTicketId}
              onSelectTicket={handleOpenTicketDetail}
              onOpenWhatsApp={handleOpenWhatsAppModal}
            />
          );
        default:
          return (
            <InstallerDashboardView
              onNavigateTab={handleInstallerNavigateTab}
              onSelectTicket={handleOpenTicketDetail}
              onOpenWhatsApp={handleOpenWhatsAppModal}
            />
          );
      }
    }

    switch (activeTab) {
      // Dispatch Management
      case 'dashboard':
        return (
          <DashboardOverview
            onNavigate={tab => navigateTo(tab)}
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
          />
        );
      case 'verification_desk': {
        const canAccessVerification =
          currentUser.role === 'super_admin' ||
          currentUser.role === 'dispatch';
        if (!canAccessVerification) {
          const redirectTarget = currentUser.role === 'leader' ? 'leader_portal' : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1200);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Dispatch Verification &amp; QC Desk
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Modul Verifikasi QC hanya tersedia untuk Super Admin dan Dispatch. Role Anda ({currentUser.role}) tidak memiliki izin.
              </p>
            </div>
          );
        }
        return (
          <DispatchVerificationDesk
            onNavigate={tab => navigateTo(tab)}
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
          />
        );
      }
      case 'monitoring_maps': {
        const canAccessMonitoringMaps =
          currentUser.role === 'super_admin' ||
          currentUser.role === 'dispatch' ||
          currentUser.role === 'leader';
        if (!canAccessMonitoringMaps) {
          const redirectTarget = isInstaller ? 'installer_dashboard' : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1200);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Monitoring Maps GIS
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Modul Monitoring Maps hanya tersedia untuk Super Admin, Dispatch, dan Leader/Korlap. Role Anda ({currentUser.role}) tidak memiliki izin.
              </p>
            </div>
          );
        }
        return (
          <MonitoringMapsView
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
            onNavigate={tab => navigateTo(tab)}
          />
        );
      }
      case 'tickets':
        return (
          <TicketsTable
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
            onNavigate={tab => navigateTo(tab)}
          />
        );
      case 'overdue_wo': {
        const canAccessOverdue =
          currentUser.role === 'super_admin' ||
          currentUser.role === 'dispatch' ||
          currentUser.role === 'leader';
        if (!canAccessOverdue) {
          const redirectTarget = isInstaller ? 'installer_dashboard' : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1200);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Overdue WO
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Menu Overdue WO hanya tersedia untuk Super Admin, Dispatch, dan Leader/Korlap. Role Anda ({currentUser.role}) tidak memiliki izin.
              </p>
            </div>
          );
        }
        return (
          <OverdueWorkOrdersView
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
            onNavigate={tab => navigateTo(tab)}
          />
        );
      }
      case 'form_sameday':
        // WO Same Day is strictly exclusive to Dispatch role
        if (currentUser.role !== 'dispatch') {
          return <DashboardOverview onNavigate={tab => navigateTo(tab)} onSelectTicket={handleOpenTicketDetail} />;
        }
        return <FormSamedayView />;
      case 'report_data_wo':
        return <ReportDataWOView />;
      case 'history_progress':
        return (
          <HistoryProgressReportView
            onSelectTicket={tid => {
              const found = tickets.find(t => t.id === tid);
              if (found) handleOpenTicketDetail(found, 'history');
            }}
          />
        );
      case 'schedule':
        return (
          <ScheduleCalendarView
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
          />
        );
      case 'login_logs': {
        const canAccessLoginLogs = currentUser.role === 'super_admin';
        if (!canAccessLoginLogs) {
          const redirectTarget = isInstaller
            ? 'installer_dashboard'
            : currentUser.role === 'leader'
            ? 'leader_portal'
            : currentUser.role === 'dispatch'
            ? 'tickets'
            : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1500);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Khusus Super Admin
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Log aktivitas login dilindungi dan hanya dapat diakses oleh Super Admin. Role Anda ({currentUser.role}) tidak memiliki izin. Mengalihkan...
              </p>
            </div>
          );
        }
        return <LoginLogView />;
      }
      case 'setting_droplist':
        return <SetupHubView initialTab="droplists" onNavigateTab={tab => setActiveTab(tab)} />;

      // Leader & Contractor Basecamp (WO CONTRACTOR)
      case 'leader_portal':
        return (
          <LeaderPortal
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
            onNavigate={tab => navigateTo(tab)}
            activeLeaderTab={leaderSubTab === 'monitoring_maps' ? 'wo_assignment' : leaderSubTab}
            onLeaderTabChange={tab => navigateTo(tab)}
          />
        );
      case 'wo_assignment':
        return (
          <LeaderPortal
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
            onNavigate={tab => navigateTo(tab)}
            activeLeaderTab="wo_assignment"
            onLeaderTabChange={tab => navigateTo(tab)}
          />
        );
      case 'reassign_wo':
        return (
          <LeaderPortal
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
            onNavigate={tab => navigateTo(tab)}
            activeLeaderTab="reassign_wo"
            onLeaderTabChange={tab => navigateTo(tab)}
          />
        );
      case 'progress_dashboard':
        return (
          <LeaderProgressDashboardView
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
          />
        );
      case 'installer_mgmt':
        return (
          <LeaderPortal
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
            onNavigate={tab => navigateTo(tab)}
            activeLeaderTab="installer_mgmt"
            onLeaderTabChange={tab => navigateTo(tab)}
          />
        );
      case 'quota_settings':
        if (currentUser.role === 'leader') {
          return (
            <LeaderPortal
              onSelectTicket={handleOpenTicketDetail}
              onOpenWhatsApp={handleOpenWhatsAppModal}
              onNavigate={tab => navigateTo(tab)}
              activeLeaderTab="wo_assignment"
              onLeaderTabChange={tab => navigateTo(tab)}
            />
          );
        }
        return (
          <LeaderPortal
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
            onNavigate={tab => navigateTo(tab)}
            activeLeaderTab="quota_settings"
            onLeaderTabChange={tab => navigateTo(tab)}
          />
        );
      case 'contractor_recap':
      case 'rekap_laporan':
      case 'report_installer':
        return <ContractorAreaRecapView />;
      case 'location_basecamp':
      case 'contractors':
        return <LocationBasecampView />;
      case 'sla_monitoring': {
        const canAccessSla =
          currentUser.role === 'super_admin' ||
          currentUser.role === 'dispatch' ||
          currentUser.role === 'leader';
        if (!canAccessSla) {
          const redirectTarget = isInstaller ? 'installer_dashboard' : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1200);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Monitoring SLA Kontraktor &amp; Vendor
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Modul Monitoring SLA Kontraktor &amp; Vendor hanya tersedia untuk Super Admin, Dispatch, dan Leader/Korlap. Role Anda ({currentUser.role}) tidak memiliki izin.
              </p>
            </div>
          );
        }
        return (
          <SlaTelemetryDashboardView
            onSelectTicket={handleOpenTicketDetail}
            onNavigate={tab => navigateTo(tab)}
          />
        );
      }

      // Technician Portal (TASK INSTALLER) - Protected (Bagian 3: Only Superadmin and Installer)
      case 'installer_portal':
      case 'installer_tasks':
      case 'installer_progress':
      case 'installer_history': {
        if (currentUser.role === 'dispatch' || currentUser.role === 'leader') {
          // Direct URL / Routing rejection and auto-redirect to respective dashboard
          const targetTab = currentUser.role === 'dispatch' ? 'tickets' : 'leader_portal';
          setTimeout(() => {
            setActiveTab(targetTab);
          }, 0);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900 shadow-sm max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Modul Khusus Installer
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sesuai Konstitusi Keamanan MoraJaws (Bagian 3), role <strong>{currentUser.role}</strong> tidak memiliki izin mengakses modul Installer. Anda dialihkan kembali ke Dashboard.
              </p>
            </div>
          );
        }

        return (
          <InstallerPortal
            initialFilter={
              activeTab === 'installer_tasks'
                ? 'tugas_baru'
                : activeTab === 'installer_history'
                ? 'selesai'
                : 'all'
            }
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
          />
        );
      }

      // Contact & Messaging
      case 'contact_centre':
        return (
          <ContactCentreView
            initialTicketId={liveChatInitialTicketId}
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
          />
        );

      // Data Operations & Sync (Superadmin Exclusive)
      case 'management_data_portal': {
        if (currentUser.role !== 'super_admin') {
          const redirectTarget = isInstaller
            ? 'installer_dashboard'
            : currentUser.role === 'leader'
            ? 'leader_portal'
            : currentUser.role === 'dispatch'
            ? 'tickets'
            : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1500);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Khusus Super Admin
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Portal Pengelolaan Data dilindungi dan hanya dapat diakses oleh Super Admin. Role Anda ({currentUser.role}) tidak memiliki izin. Mengalihkan...
              </p>
            </div>
          );
        }
        return (
          <ManagementDataPortal
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
          />
        );
      }
      case 'database_sync':
        return currentUser.role === 'super_admin'
          ? <DatabaseSyncMonitoringView />
          : <SetupHubView initialTab="app_config" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'database_management':
        return currentUser.role === 'super_admin'
          ? <DatabaseManagementView />
          : <SetupHubView initialTab="app_config" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'import':
      case 'import_excel': {
        const canImportWO = currentUser.role === 'super_admin';
        if (!canImportWO) {
          const redirectTarget = isInstaller
            ? 'installer_dashboard'
            : currentUser.role === 'leader'
            ? 'wo_assignment'
            : currentUser.role === 'dispatch'
            ? 'tickets'
            : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1500);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Otoritas Import Work Order Dibatasi
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sesuai App Flow MoraJaws, modul Import Work Order hanya diizinkan untuk <strong>Super Admin</strong>. Role Anda ({currentUser.role}) tidak memiliki akses. Mengalihkan...
              </p>
            </div>
          );
        }
        return <TextToTableImporter onImportSuccess={() => setActiveTab('tickets')} />;
      }
      case 'sheets_sync':
        return currentUser.role === 'super_admin' ? (
          <GoogleSheetsSyncView />
        ) : (
          <DashboardOverview onNavigate={tab => setActiveTab(tab)} onSelectTicket={handleOpenTicketDetail} />
        );

      // System, Roles, Users & Config (Consolidated into SETUP TERPUSAT MORAJAWS)
      case 'users':
        return <SetupHubView initialTab="users" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'management_role':
        return <SetupHubView initialTab="roles" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'settings':
        return <SetupHubView initialTab="app_config" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'ui_builder':
        return <SetupHubView initialTab="ui_builder" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'audit_logs': {
        const canAccessAudit = currentUser.role === 'super_admin';
        if (!canAccessAudit) {
          const redirectTarget = isInstaller
            ? 'installer_dashboard'
            : currentUser.role === 'leader'
            ? 'leader_portal'
            : currentUser.role === 'dispatch'
            ? 'tickets'
            : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1500);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Otoritas Audit Log Dibatasi
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Audit Log dilindungi dan hanya dapat diakses oleh Super Admin. Role Anda ({currentUser.role}) tidak memiliki izin. Mengalihkan...
              </p>
            </div>
          );
        }
        return <AuditLogViewer />;
      }
      case 'system_health':
        return <SetupHubView initialTab="health_logs" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'templates': {
        const canAccessTemplates = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';
        if (!canAccessTemplates) {
          const redirectTarget = isInstaller
            ? 'installer_dashboard'
            : currentUser.role === 'leader'
            ? 'leader_portal'
            : 'dashboard';
          setTimeout(() => {
            setActiveTab(redirectTarget);
          }, 1500);
          return (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-rose-300 dark:border-rose-900 shadow-md max-w-lg mx-auto my-12 space-y-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto font-bold text-lg">
                ✕
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Akses Ditolak: Khusus Superadmin & Dispatch
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Menu Template WhatsApp dilindungi dan hanya dapat diakses oleh Superadmin dan Dispatch. Role Anda ({currentUser.role}) tidak memiliki izin. Mengalihkan ke dashboard...
              </p>
            </div>
          );
        }
        return <TemplateBuilder />;
      }
      case 'workflows':
        return <SetupHubView initialTab="workflows" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'offline_sync':
        return (
          <div className="p-8 bg-white/88 dark:bg-[#1a0f30] backdrop-blur-xl rounded-2xl shadow-sm border border-[#DDE6F0] dark:border-[#3B1D78] text-center space-y-4 max-w-2xl mx-auto">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#DDF4F4] dark:bg-indigo-950/60 text-[#5145A6] dark:text-indigo-400 flex items-center justify-center shadow-inner">
              <Database className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#26364A] dark:text-[#F5F1FF]">Pusat Sinkronisasi Database Offline</h2>
              <p className="text-xs text-[#52647A] dark:text-[#D8CCF3] mt-1">
                Sistem penyimpanan lokal IndexedDB dan antrean mutasi data saat berada di area tanpa sinyal internet.
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={openOfflineSyncCenter}
                className="px-6 py-2.5 mj-tactile-btn-primary text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                Buka Panel Kontrol Sinkronisasi
              </button>
            </div>
          </div>
        );

      case 'setup':
        return <SetupHubView initialTab="app_config" onNavigateTab={tab => setActiveTab(tab)} />;

      case 'nav_config':
        return <SetupHubView initialTab="nav_config" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'sound_settings':
        return <SetupHubView initialTab="sound" onNavigateTab={tab => setActiveTab(tab)} />;
      case 'droplist_management':
      case 'setting_droplist_status':
      case 'setting_droplist_reason':
      case 'setting_droplist_rootcause':
        return <SetupHubView initialTab="droplists" onNavigateTab={tab => setActiveTab(tab)} />;

      default:
        return (
          <DashboardOverview
            onNavigate={tab => navigateTo(tab)}
            onSelectTicket={handleOpenTicketDetail}
            onOpenWhatsApp={handleOpenWhatsAppModal}
          />
        );
    }
  };

  return (
    <div
      className="h-dvh flex flex-col overflow-hidden mj-aurora-bg text-[#26364A] dark:text-[#f3effc] transition-colors relative"
    >
      <ThemeBrandBackground variant="workspace" />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative z-10">
        {/* Navigation Sidebar: STRICTLY NOT RENDERED FOR INSTALLER */}
        {!isInstaller && (
          <Sidebar
            activeTab={activeTab}
            onNavigate={tab => navigateTo(tab)}
            onSelectTicket={handleOpenTicketDetail}
            sidebarState={currentSidebarState}
            onChangeState={state => setSidebarState(state)}
          />
        )}

        {/* Right Column: Sticky Header + Content Viewport */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Header
            activeTab={activeTab}
            onNavigate={tab => navigateTo(tab)}
            onSelectTicket={handleOpenTicketDetail}
          />

          {/* Floating Open Menu Button when sidebar is closed on desktop mode */}
          {!isInstaller && !isMobileView && currentSidebarState === 'closed' && !isDetailModalOpen && !isWhatsAppModalOpen && (
            <button
              type="button"
              onClick={() => setSidebarState('expanded')}
              className="hidden md:flex fixed bottom-6 left-6 z-30 items-center gap-2 px-4 py-2.5 mj-tactile-btn-primary text-xs rounded-xl cursor-pointer whitespace-nowrap"
              title="Buka Menu Navigasi"
            >
              <Menu className="w-4 h-4 shrink-0" />
              <span>Buka Menu</span>
            </button>
          )}

          {/* Content Viewport with responsive floating topbar & bottom navigation spacing */}
          <main
            data-display-mode={isMobileView ? 'mobile' : 'desktop'}
            className={
              isFullChatMode
                ? `flex-1 min-h-0 flex flex-col overflow-hidden p-0 pt-2 w-full ${
                    isInstaller
                      ? 'pb-24'
                      : currentUser.role === 'leader' && isMobileView
                      ? 'pb-24'
                      : isMobileView && config.device?.android?.showBottomNavigation !== false
                      ? 'pb-24'
                      : ''
                  }`
                : `flex-1 overflow-y-auto overflow-x-hidden ${
                    isMobileView ? 'p-3 pt-4 sm:p-4 sm:pt-4 pb-28 w-full' : 'p-3 pt-4 sm:p-5 lg:p-6'
                  } ${
                    isInstaller
                      ? 'pb-28 w-full'
                      : currentUser.role === 'leader' && isMobileView
                      ? 'pb-28'
                      : isMobileView && config.device?.android?.showBottomNavigation !== false
                      ? 'pb-28'
                      : ''
                  }`
            }
          >
            <div
              className={
                isFullChatMode
                  ? 'flex-1 min-h-0 w-full flex flex-col'
                  : isInstaller || isMobileView || isFullWidth || (config.device?.mode === 'pc' && config.device?.pc?.wideScreenFullWidth)
                  ? 'w-full min-w-0'
                  : 'max-w-7xl mx-auto min-w-0'
              }
            >
              <Suspense fallback={<LoadingSkeleton variant="table" rows={6} />}>
                {renderContent()}
              </Suspense>
            </div>
          </main>
        </div>
      </div>

      {/* Bottom Ergonomic Navigation:
          - Dedicated 4-item Bar for Installer (Responsive across mobile, tablet, and desktop)
          - Dedicated 5-item Bar for Leader
          - Standard Android Bottom Navigation for other roles on mobile
      */}
      {isInstaller ? (
        <InstallerBottomNav
          activeTab={activeTab}
          onTabChange={tab => {
            if (tab === 'installer_tasks') {
              setActiveKpiDrilldown(null);
              setInstallerTaskFilter('tugas_baru');
            }
            navigateTo(tab);
          }}
          pendingTasksCount={installerPendingCount}
          unreadMessagesCount={installerUnreadChatCount}
          waPendingCount={installerWaPendingCount}
        />
      ) : currentUser.role === 'leader' ? (
        isMobileView && (
          <LeaderBottomNav
            activeTab={activeLeaderBottomTab}
            onTabChange={tab => {
              navigateTo(tab);
            }}
            unassignedCount={leaderUnassignedCount}
          />
        )
      ) : (
        isMobileView && config.device?.android?.showBottomNavigation !== false && (
          <AndroidBottomNav
            activeTab={activeTab}
            onNavigate={tab => {
              navigateTo(tab);
              if (currentSidebarState === 'expanded') {
                setSidebarState('closed');
              }
            }}
            isMenuOpen={currentSidebarState === 'expanded'}
            onToggleMenu={() => {
              setSidebarState(currentSidebarState === 'expanded' ? 'closed' : 'expanded');
            }}
          />
        )
      )}

      {/* Exclusive Live GPS Sync Pill for authenticated Installer */}
      {isInstaller && <InstallerGpsSyncWidget />}

      {/* Modals & Offline Alerts */}
      <SessionManagementModal />
      <OfflineSyncModal />
      <OfflineBanner />
      <ConfigConflictModal
        conflict={globalConflict || uiConflict || soundConflict}
        onReloadLatest={async () => {
          if (globalConflict) {
            await resolveGlobalConflict('reload');
          } else if (uiConflict) {
            await resolveUiConflict('reload');
          } else if (soundConflict) {
            await resolveSoundConflict('reload');
          }
        }}
        onForceOverwrite={async () => {
          if (globalConflict) {
            await resolveGlobalConflict('overwrite');
          } else if (uiConflict) {
            await resolveUiConflict('overwrite');
          } else if (soundConflict) {
            await resolveSoundConflict('overwrite');
          }
        }}
        onClose={() => {
          if (globalConflict) clearGlobalConflict();
          else if (uiConflict) clearUiConflict();
          else if (soundConflict) clearSoundConflict();
        }}
      />

      <TicketDetailModal
        ticket={liveSelectedTicket}
        isOpen={isDetailModalOpen}
        defaultTab={detailDefaultTab}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedTicket(null);
        }}
        onApprovedAndClosed={() => {
          setIsDetailModalOpen(false);
          setSelectedTicket(null);
          if (currentUser.role === 'dispatch') {
            navigateTo('dashboard');
          }
        }}
        onOpenWhatsApp={ticket => {
          setIsDetailModalOpen(false);
          handleOpenWhatsAppModal(ticket);
        }}
      />

      {whatsAppTicket && (
        <WhatsAppSendModal
          ticket={whatsAppTicket}
          isOpen={isWhatsAppModalOpen}
          onClose={() => {
            setIsWhatsAppModalOpen(false);
            setWhatsAppTicket(null);
          }}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <AnimationProvider>
        <OfflineSyncProvider>
          <MoraJawsSoundProvider>
            <AppProvider>
              <UIConfigProvider>
                <MoraJawsErrorBoundary fallbackTitle="Kendala Antarmuka MoraJaws">
                  <MainLayout />
                </MoraJawsErrorBoundary>
              </UIConfigProvider>
            </AppProvider>
          </MoraJawsSoundProvider>
        </OfflineSyncProvider>
      </AnimationProvider>
    </ToastProvider>
  );
}
