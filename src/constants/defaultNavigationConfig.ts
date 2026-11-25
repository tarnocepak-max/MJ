import { NavigationConfig } from '../types/navigation';

export const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = {
  navigationVersion: 2,
  updatedAt: new Date().toISOString(),
  updatedBy: 'System Default',
  accordionSettings: {
    allowMultipleOpen: true, // Independent accordion collapse: multiple categories can be open concurrently
    defaultExpandedCategoryIds: ['cat_contractor_area', 'cat_installer', 'cat_tambahan'],
    smoothAnimation: true
  },
  // Exact 3 Kategori Accordion
  categories: [
    {
      id: 'cat_contractor_area',
      name: 'Contractor & Area',
      icon: 'Building2',
      order: 1,
      visible: true,
      mode: 'accordion',
      allowMultipleOpen: true
    },
    {
      id: 'cat_installer',
      name: 'Installer',
      icon: 'Wrench',
      order: 2,
      visible: true,
      mode: 'accordion',
      allowMultipleOpen: true
    },
    {
      id: 'cat_tambahan',
      name: 'Menu Tambahan',
      icon: 'Layers',
      order: 3,
      visible: true,
      mode: 'accordion',
      allowMultipleOpen: true
    }
  ],
  // Menu Mandiri (Standalone Menu)
  standaloneMenus: [
    {
      id: 'dashboard',
      name: 'Dashboard Monitoring',
      icon: 'LayoutDashboard',
      order: 1,
      visible: true,
      roles: ['super_admin', 'dispatch', 'leader']
    },
    {
      id: 'tickets',
      name: 'Ticket MyRepublic',
      icon: 'Ticket',
      order: 2,
      visible: true,
      roles: ['super_admin', 'dispatch'],
      badgeKey: 'totalTickets',
      badgeColor: 'purple'
    },
    {
      id: 'contact_centre',
      name: 'Contact Centre',
      icon: 'MessageSquare',
      order: 3,
      visible: true,
      roles: ['super_admin', 'dispatch', 'leader', 'installer']
    },
    {
      id: 'report_data_wo',
      name: 'Report Data WO',
      icon: 'BarChart3',
      order: 4,
      visible: true,
      roles: ['super_admin', 'dispatch']
    },
    {
      id: 'import',
      name: 'Import Data WO',
      icon: 'FileSpreadsheet',
      order: 5,
      visible: true,
      roles: ['super_admin']
    },
    {
      id: 'overdue_wo',
      name: 'Overdue WO',
      icon: 'AlertTriangle',
      order: 6,
      visible: true,
      roles: ['super_admin', 'dispatch', 'leader'],
      badgeKey: 'overdueTickets',
      badgeColor: 'rose'
    },
    {
      id: 'schedule',
      name: 'Schedule',
      icon: 'Calendar',
      order: 7,
      visible: true,
      roles: ['super_admin', 'dispatch', 'leader']
    },
    {
      id: 'users',
      name: 'Management User',
      icon: 'Users',
      order: 8,
      visible: true,
      roles: ['super_admin']
    }
  ],
  // Submenu Items organized inside the 3 categories
  submenuItems: [
    // 1. Contractor & Area submenus
    {
      id: 'leader_portal',
      name: 'Dashboard Leader',
      icon: 'Users2',
      categoryId: 'cat_contractor_area',
      order: 1,
      visible: true,
      roles: ['super_admin', 'leader'],
      badgeKey: 'unassignedTickets',
      badgeColor: 'amber'
    },
    {
      id: 'location_basecamp',
      name: 'Kontraktor & Basecamp',
      icon: 'Building2',
      categoryId: 'cat_contractor_area',
      order: 2,
      visible: true,
      roles: ['super_admin', 'leader']
    },
    {
      id: 'sla_monitoring',
      name: 'Monitoring SLA Kontraktor & Vendor',
      icon: 'Activity',
      categoryId: 'cat_contractor_area',
      order: 3,
      visible: true,
      roles: ['super_admin', 'dispatch', 'leader']
    },

    // 2. Installer submenus
    {
      id: 'installer_portal',
      name: 'Tugas Saya & Laporan',
      icon: 'Wrench',
      categoryId: 'cat_installer',
      order: 1,
      visible: true,
      roles: ['super_admin', 'installer']
    },

    // 3. Menu Tambahan submenus
    {
      id: 'form_sameday',
      name: 'Form Sameday',
      icon: 'Zap',
      categoryId: 'cat_tambahan',
      order: 1,
      visible: true,
      roles: ['dispatch'],
      badgeKey: 'express',
      badgeColor: 'amber'
    },
    {
      id: 'login_logs',
      name: 'Login Log',
      icon: 'KeyRound',
      categoryId: 'cat_tambahan',
      order: 2,
      visible: true,
      roles: ['super_admin']
    },
    {
      id: 'setting_droplist',
      name: 'Setting Droplist',
      icon: 'ListFilter',
      categoryId: 'cat_tambahan',
      order: 3,
      visible: true,
      roles: ['super_admin', 'dispatch']
    },
    {
      id: 'database_sync',
      name: 'Monitoring Sinkronisasi',
      icon: 'RefreshCw',
      categoryId: 'cat_tambahan',
      order: 4,
      visible: true,
      roles: ['super_admin'],
      badgeKey: 'live',
      badgeColor: 'emerald'
    },
    {
      id: 'database_management',
      name: 'Database Application',
      icon: 'Server',
      categoryId: 'cat_tambahan',
      order: 5,
      visible: true,
      roles: ['super_admin', 'dispatch']
    },
    {
      id: 'sheets_sync',
      name: 'Google Sheets Sync',
      icon: 'RefreshCw',
      categoryId: 'cat_tambahan',
      order: 6,
      visible: true,
      roles: ['super_admin'],
      badgeKey: 'auto',
      badgeColor: 'emerald'
    },
    {
      id: 'management_role',
      name: 'Management Role',
      icon: 'ShieldCheck',
      categoryId: 'cat_tambahan',
      order: 7,
      visible: true,
      roles: ['super_admin']
    },
    {
      id: 'settings',
      name: 'Field Mapping',
      icon: 'FileSpreadsheet',
      categoryId: 'cat_tambahan',
      order: 8,
      visible: true,
      roles: ['super_admin']
    },
    {
      id: 'ui_builder',
      name: 'UI Configuration Builder',
      icon: 'Sliders',
      categoryId: 'cat_tambahan',
      order: 9,
      visible: true,
      roles: ['super_admin'],
      highlight: true
    },
    {
      id: 'audit_logs',
      name: 'Audit Log & History',
      icon: 'History',
      categoryId: 'cat_tambahan',
      order: 10,
      visible: true,
      roles: ['super_admin']
    },
    {
      id: 'system_health',
      name: 'System Health',
      icon: 'Activity',
      categoryId: 'cat_tambahan',
      order: 11,
      visible: true,
      roles: ['super_admin'],
      badgeKey: 'live',
      badgeColor: 'emerald'
    },
    {
      id: 'templates',
      name: 'WhatsApp Templates',
      icon: 'MessageSquareQuote',
      categoryId: 'cat_tambahan',
      order: 13,
      visible: true,
      roles: ['super_admin', 'dispatch']
    },
    {
      id: 'workflows',
      name: 'Workflow Automation',
      icon: 'GitBranch',
      categoryId: 'cat_tambahan',
      order: 14,
      visible: true,
      roles: ['super_admin', 'dispatch']
    },
    {
      id: 'offline_sync',
      name: 'Sinkronisasi Offline',
      icon: 'Database',
      categoryId: 'cat_tambahan',
      order: 15,
      visible: true,
      roles: ['super_admin', 'dispatch', 'installer']
    }
  ]
};
