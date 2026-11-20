import {
  UIConfiguration,
  HeaderMapping,
  WhatsAppTemplate,
  ColumnConfig,
  SectionDetailConfig,
  WorkflowRule,
  Ticket,
  Contractor,
  CoverageArea,
  RootCauseCategory,
  User,
  NavCategoryConfig,
  StandaloneMenuItem,
  NavSubmenuItem,
  NavigationConfigDoc
} from '../types';
import { DEFAULT_PASSWORD_HASH } from '../services/authService';

export interface CanonicalColumnGroupMeta {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  title: string;
  subtitle?: string;
  mandatoryGroup?: boolean;
}

export const CANONICAL_COLUMN_GROUPS: CanonicalColumnGroupMeta[] = [
  { id: 'A', title: 'A. Identitas Utama & Tiket', subtitle: '5 Kolom • Terkunci Mandatori', mandatoryGroup: true },
  { id: 'B', title: 'B. 4-Dimensi Status & Governance', subtitle: '4 Kolom Status Utama' },
  { id: 'C', title: 'C. Jadwal, Slot & Timestamps' },
  { id: 'D', title: 'D. Wilayah, Alamat & Geolokasi' },
  { id: 'E', title: 'E. Infrastruktur Jaringan FTTH & Redaman' },
  { id: 'F', title: 'F. Perangkat CPE, ONT & Router' },
  { id: 'G', title: 'G. Kontraktor, Korlap & Penugasan Teknisi' },
  { id: 'H', title: 'H. Laporan Lapangan 3-Tingkat & Audit' }
];

const DEFAULT_DISPATCH_VISIBLE_KEYS = new Set([
  'selection',
  'woNumber',
  'idCustomer',
  'customerName',
  'customerPhone',
  'statusWOAgent',
  'statusWOInstaller',
  'statusWhatsApp',
  'approvalStatus',
  'appointmentDate',
  'slotTime',
  'area',
  'clusterName',
  'contactorName',
  'leaderName',
  'installerName',
  'reportStatusLabel',
  'remarksWOInstaller'
]);

const LEADER_VISIBLE_KEYS = new Set([
  'selection',
  'woNumber',
  'idCustomer',
  'customerName',
  'customerPhone',
  'statusWOInstaller',
  'statusWhatsApp',
  'appointmentDate',
  'slotTime',
  'area',
  'clusterName',
  'streetName',
  'installerName',
  'remarksWOInstaller'
]);

const QC_AUDIT_VISIBLE_KEYS = new Set([
  'selection',
  'woNumber',
  'idCustomer',
  'customerName',
  'customerPhone',
  'statusWOAgent',
  'statusWOInstaller',
  'approvalStatus',
  'appointmentDate',
  'workStartedAt',
  'checkOutAt',
  'workDurationMinutes',
  'fdtCode',
  'fatCode',
  'fatRedamanDbm',
  'rosetRedamanDbm',
  'dropcoreLength',
  'ontModel',
  'ontSerialNumber',
  'ontMacAddress',
  'installerName',
  'reportStatusLabel',
  'reasonReportLabel',
  'rootcauseLabel',
  'photoEvidenceCount',
  'dataQualityFlags'
]);

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  // A. Identitas Utama & Tiket (5 Kolom Mandatori)
  { key: 'selection', label: 'Checklist Selection', visible: true, order: 1, width: 48, align: 'center', sticky: 'left', categoryGroup: 'A', mandatory: true, description: 'Kotak centang operasi bulk dispatch & broadcast' },
  { key: 'woNumber', label: 'Nomor Work Order', visible: true, order: 2, width: 140, sticky: 'left', format: 'code', sortable: true, filterable: true, categoryGroup: 'A', mandatory: true, badgeHint: 'Sticky 1', description: 'Nomor unik order WO canonical MyRepublic' },
  { key: 'idCustomer', label: 'ID Pelanggan MyRep', visible: true, order: 3, width: 110, sticky: 'left', format: 'code', sortable: true, filterable: true, categoryGroup: 'A', mandatory: true, badgeHint: 'cust_id | Sticky 2', description: '7 Digit integer numeric Customer ID' },
  { key: 'customerName', label: 'Nama Pelanggan', visible: true, order: 4, width: 180, sticky: 'left', sortable: true, filterable: true, categoryGroup: 'A', mandatory: true, badgeHint: 'Sticky 3', description: 'Nama pemohon registrasi sambungan baru' },
  { key: 'customerPhone', label: 'No. Telepon / WhatsApp', visible: true, order: 5, width: 150, format: 'phone', categoryGroup: 'A', mandatory: true, badgeHint: 'wa.me Action', description: 'Format MSISDN (+628xxx) link langsung kirim template' },

  // B. 4-Dimensi Status & Governance (4 Kolom)
  { key: 'statusWOAgent', label: 'Status WO Agent', visible: true, order: 6, width: 130, format: 'status_agent', sortable: true, filterable: true, categoryGroup: 'B', description: 'Status akhir WO Agent hasil approval Dispatch: Done, Pending, Reschedule, Cancel' },
  { key: 'statusWOInstaller', label: 'Status WO Teknisi', visible: true, order: 7, width: 135, format: 'status_installer', sortable: true, filterable: true, categoryGroup: 'B', description: 'Progress fisik lapangan: En Route, On Site, Completed, Kendala' },
  { key: 'statusWhatsApp', label: 'Status WhatsApp Pelanggan', visible: true, order: 8, width: 145, format: 'status_wa', sortable: true, filterable: true, categoryGroup: 'B', description: 'Konfirmasi janji: Ready, Opened, Confirmed, Unreachable' },
  { key: 'approvalStatus', label: 'Status Approval Dispatch', visible: true, order: 9, width: 140, format: 'badge', sortable: true, filterable: true, categoryGroup: 'B', badgeHint: 'BUTUH APPROVAL', description: 'Gerbang verifikasi data: APPROVED, REJECTED, BUTUH APPROVAL' },

  // C. Jadwal, Slot & Timestamps (6 Kolom)
  { key: 'appointmentDate', label: 'Tanggal Appointment', visible: true, order: 10, width: 120, format: 'date', sortable: true, categoryGroup: 'C', description: 'appointment_date (todayWIB default)' },
  { key: 'slotTime', label: 'Slot Waktu Pengerjaan', visible: true, order: 11, width: 110, sortable: true, categoryGroup: 'C', description: 'slot_time (09:00 - 11:00, 13:00 - 15:00)' },
  { key: 'workStartedAt', label: 'Jam Mulai Pengerjaan', visible: false, order: 12, width: 100, format: 'date', categoryGroup: 'C', description: 'work_started_at' },
  { key: 'checkOutAt', label: 'Jam Selesai / Checkout', visible: false, order: 13, width: 100, format: 'date', categoryGroup: 'C', description: 'work_completed_at' },
  { key: 'workDurationMinutes', label: 'Durasi Pengerjaan Menit', visible: false, order: 14, width: 90, sortable: true, categoryGroup: 'C', description: 'work_duration_minutes (dihitung otomatis)' },
  { key: 'createdAt', label: 'Timestamp Import / Dibuat', visible: false, order: 15, width: 130, format: 'date', sortable: true, categoryGroup: 'C', description: 'created_at' },

  // D. Wilayah, Alamat & Geolokasi (6 Kolom)
  { key: 'regionName', label: 'Wilayah Operasional', visible: false, order: 16, width: 120, sortable: true, categoryGroup: 'D', description: 'region_name (Jabodetabek, Jawa Barat)' },
  { key: 'area', label: 'Area Kerja', visible: true, order: 17, width: 130, sortable: true, filterable: true, categoryGroup: 'D', description: 'area_name (Jakarta Selatan, Depok Timur)' },
  { key: 'clusterName', label: 'Cluster Perumahan', visible: true, order: 18, width: 150, sortable: true, filterable: true, categoryGroup: 'D', description: 'cluster_name' },
  { key: 'streetName', label: 'Alamat Lengkap Pelanggan', visible: false, order: 19, width: 260, wrapText: true, categoryGroup: 'D', badgeHint: 'G-Maps Link', description: 'installation_address' },
  { key: 'customerCoordinates', label: 'Titik Koordinat GPS Pelanggan', visible: false, order: 20, width: 140, format: 'code', categoryGroup: 'D', description: 'customer_coordinates (lat, lng)' },
  { key: 'distanceKm', label: 'Jarak Teknisi ke Lokasi', visible: false, order: 21, width: 90, categoryGroup: 'D', description: 'distance_km (kalkulasi Haversine)' },

  // E. Infrastruktur Jaringan FTTH & Redaman (7 Kolom)
  { key: 'fdtCode', label: 'Kode FDT', visible: false, order: 22, width: 110, format: 'code', categoryGroup: 'E', description: 'fdt_code' },
  { key: 'fatCode', label: 'Kode FAT / Tiang Distribusi', visible: false, order: 23, width: 130, format: 'code', categoryGroup: 'E', description: 'fat_code' },
  { key: 'fatPort', label: 'Nomor Port FAT', visible: false, order: 24, width: 90, format: 'code', categoryGroup: 'E', description: 'fat_port_number (1-16)' },
  { key: 'fatRedamanDbm', label: 'Redaman Tiang FAT dBm', visible: false, order: 25, width: 115, format: 'code', categoryGroup: 'E', description: 'fat_redaman_dbm' },
  { key: 'rosetRedamanDbm', label: 'Redaman OPM Roset Pelanggan dBm', visible: false, order: 26, width: 130, format: 'code', categoryGroup: 'E', badgeHint: '>-24dBm Alert', description: 'roset_redaman_dbm' },
  { key: 'dropcoreLength', label: 'Panjang Dropcore Meter', visible: false, order: 27, width: 110, categoryGroup: 'E', description: 'dropcore_length_meter' },
  { key: 'oltCode', label: 'ID OLT & Port PON', visible: false, order: 28, width: 120, format: 'code', categoryGroup: 'E', description: 'olt_pon_port' },

  // F. Perangkat CPE, ONT & Router (5 Kolom)
  { key: 'ontModel', label: 'Tipe Perangkat ONT / Modem', visible: false, order: 29, width: 140, categoryGroup: 'F', description: 'ont_type_model (Huawei HG8245H5, ZTE F670L)' },
  { key: 'ontSerialNumber', label: 'Serial Number (SN) ONT', visible: false, order: 30, width: 140, format: 'code', categoryGroup: 'F', description: 'ont_serial_number' },
  { key: 'ontMacAddress', label: 'Barcode & MAC Address ONT', visible: false, order: 31, width: 130, format: 'code', categoryGroup: 'F', description: 'ont_mac_address' },
  { key: 'oltRegistrationStatus', label: 'Status Registrasi OLT', visible: false, order: 32, width: 120, categoryGroup: 'F', description: 'olt_registration_status (Online/Registered)' },
  { key: 'stb1Sn', label: 'Serial Number Set-Top Box', visible: false, order: 33, width: 130, format: 'code', categoryGroup: 'F', description: 'stb_serial_number' },

  // G. Kontraktor, Korlap & Penugasan Teknisi (5 Kolom)
  { key: 'contactorName', label: 'Mitra Kontraktor', visible: true, order: 34, width: 140, sortable: true, filterable: true, categoryGroup: 'G', description: 'contractor_name' },
  { key: 'leaderName', label: 'Korlap / Leader Lapangan', visible: true, order: 35, width: 130, sortable: true, categoryGroup: 'G', description: 'leader_name' },
  { key: 'installerName', label: 'Nama Teknisi / Installer', visible: true, order: 36, width: 140, sortable: true, filterable: true, categoryGroup: 'G', description: 'installer_name' },
  { key: 'installerContact', label: 'No. Kontak Teknisi', visible: false, order: 37, width: 120, format: 'phone', categoryGroup: 'G', description: 'installer_phone' },
  { key: 'reassignHistoryCount', label: 'Riwayat Reassign Teknisi', visible: false, order: 38, width: 110, categoryGroup: 'G', badgeHint: 'Counter Badge', description: 'reassign_history_count' },

  // H. Laporan Lapangan 3-Tingkat & Audit (8 Kolom)
  { key: 'reportStatusLabel', label: 'Status Laporan Level 1', visible: true, order: 39, width: 130, categoryGroup: 'H', description: 'report_level_1_status (Done, Pending, Cancel)' },
  { key: 'reasonReportLabel', label: 'Reason Report Level 2', visible: false, order: 40, width: 150, categoryGroup: 'H', description: 'report_level_2_reason' },
  { key: 'rootcauseLabel', label: 'Rootcause Code Level 3', visible: false, order: 41, width: 160, categoryGroup: 'H', description: 'report_level_3_rootcause' },
  { key: 'remarksWOInstaller', label: 'Catatan Teknisi / Remarks', visible: true, order: 42, width: 200, wrapText: true, categoryGroup: 'H', description: 'technician_remarks' },
  { key: 'photoEvidenceCount', label: 'Bukti Foto Fisik (Jumlah Upload)', visible: false, order: 43, width: 110, categoryGroup: 'H', description: 'photo_evidence_count' },
  { key: 'customerSignatureUrl', label: 'Link Tanda Tangan Pelanggan', visible: false, order: 44, width: 130, categoryGroup: 'H', description: 'customer_signature_url' },
  { key: 'rejectionReason', label: 'Catatan Rejection Dispatch', visible: false, order: 45, width: 180, wrapText: true, categoryGroup: 'H', description: 'dispatch_rejection_notes' },
  { key: 'dataQualityFlags', label: 'Flag Audit Kualitas Data', visible: false, order: 46, width: 140, categoryGroup: 'H', badgeHint: 'Audit Telemetry', description: 'data_quality_flags' }
];

export const DEFAULT_DETAIL_SECTIONS: SectionDetailConfig[] = [
  {
    id: 'customer_info',
    title: 'Customer Information',
    visible: true,
    order: 1,
    fields: [
      { key: 'customerName', label: 'Customer Name', visible: true, order: 1, width: 'half' },
      { key: 'idCustomer', label: 'Customer ID', visible: true, order: 2, width: 'half', isReadOnly: true },
      { key: 'customerPhone', label: 'Phone Number', visible: true, order: 3, width: 'half' },
      { key: 'area', label: 'Service Area', visible: true, order: 4, width: 'half' },
      { key: 'clusterName', label: 'Cluster / Complex', visible: true, order: 5, width: 'half' },
      { key: 'streetName', label: 'Primary Address', visible: true, order: 6, width: 'full' },
      { key: 'streetAlternatif', label: 'Alternative Address / Landmark', visible: true, order: 7, width: 'full' }
    ]
  },
  {
    id: 'work_order_info',
    title: 'Work Order Information',
    visible: true,
    order: 2,
    fields: [
      { key: 'woNumber', label: 'WO Number', visible: true, order: 1, width: 'half', isReadOnly: true },
      { key: 'ticketCategory', label: 'Category / Service', visible: true, order: 2, width: 'half' },
      { key: 'slotTime', label: 'Scheduled Slot Time', visible: true, order: 3, width: 'half' },
      { key: 'date', label: 'Appointment Date', visible: true, order: 4, width: 'half' },
      { key: 'ticketNumber', label: 'Ticket Reference', visible: true, order: 5, width: 'half' },
      { key: 'fileName', label: 'Import Source File', visible: true, order: 6, width: 'half' }
    ]
  },
  {
    id: 'location_technical',
    title: 'Location & Technical Information',
    visible: true,
    order: 3,
    fields: [
      { key: 'fdtCode', label: 'FDT Code', visible: true, order: 1, width: 'half' },
      { key: 'fatCode', label: 'FAT Code', visible: true, order: 2, width: 'half' },
      { key: 'agentId', label: 'Originating Agent ID', visible: true, order: 3, width: 'half' },
      { key: 'dateUpload', label: 'Upload Date', visible: true, order: 4, width: 'half' }
    ]
  },
  {
    id: 'dispatch_assignment',
    title: 'Dispatch & Personnel Assignment',
    visible: true,
    order: 4,
    fields: [
      { key: 'contactorName', label: 'Contractor Vendor', visible: true, order: 1, width: 'third' },
      { key: 'leaderName', label: 'Assigned Leader / Korlap', visible: true, order: 2, width: 'third' },
      { key: 'installerName', label: 'Assigned Installer / Teknisi', visible: true, order: 3, width: 'third' }
    ]
  },
  {
    id: 'status_reports',
    title: 'Status & Execution Reports',
    visible: true,
    order: 5,
    fields: [
      { key: 'statusWOAgent', label: 'Agent Status', visible: true, order: 1, width: 'half' },
      { key: 'statusWOInstaller', label: 'Installer Field Status', visible: true, order: 2, width: 'half' },
      { key: 'remarksAgent', label: 'Agent Dispatch Notes', visible: true, order: 3, width: 'full' },
      { key: 'remarksWOInstaller', label: 'Installer Field Remarks', visible: true, order: 4, width: 'full' }
    ]
  },
  {
    id: 'whatsapp_confirmation',
    title: 'WhatsApp Customer Confirmation',
    visible: true,
    order: 6,
    fields: [
      { key: 'statusWhatsApp', label: 'Confirmation Status', visible: true, order: 1, width: 'half', isReadOnly: true },
      { key: 'waLastOpenedAt', label: 'Last Opened in WhatsApp', visible: true, order: 2, width: 'half', isReadOnly: true },
      { key: 'waConfirmedAt', label: 'Confirmed At', visible: true, order: 3, width: 'half', isReadOnly: true },
      { key: 'waConfirmedBy', label: 'Confirmed By Officer', visible: true, order: 4, width: 'half', isReadOnly: true },
      { key: 'waConfirmationNotes', label: 'Customer Confirmation Notes', visible: true, order: 5, width: 'full' }
    ]
  }
];

export const DEFAULT_UI_CONFIG: UIConfiguration = {
  id: 'default_config_v1',
  version: 1,
  updatedAt: new Date().toISOString(),
  updatedBy: 'System Administrator',
  global: {
    appName: 'MoraJaws',
    logoIcon: 'Truck',
    primaryColor: 'indigo', // 'blue' | 'indigo' | 'emerald' | 'slate' | 'violet'
    themeMode: 'light',
    fontScale: 'medium',
    density: 'comfortable',
    contentWidth: 'contained',
    borderRadius: 'medium',
    buttonStyle: 'solid',
    tableStyle: 'bordered',
    sidebarState: 'expanded',
    sidebarCollapsed: false,
    toolbarPosition: 'top',
    modalSize: 'large'
  },
  ticketsTable: {
    columns: DEFAULT_COLUMNS,
    density: 'comfortable',
    rowsPerPage: 10,
    showEmptyFields: false,
    activePresetId: 'preset_default',
    cellFontSize: 'medium',
    freezeColumnCount: 4,
    smartOmitEmpty: true,
    showHoverTooltips: true,
    presets: [
      {
        id: 'preset_default',
        name: 'Preset Default Dispatch',
        description: 'Tampilan seimbang 18 kolom kanonik utama untuk monitoring & routing dispatch harian',
        columns: DEFAULT_COLUMNS.map(col => ({
          ...col,
          visible: col.mandatory ? true : DEFAULT_DISPATCH_VISIBLE_KEYS.has(col.key)
        })),
        density: 'comfortable',
        rowsPerPage: 10
      },
      {
        id: 'preset_leader',
        name: 'Korlap / Leader',
        description: 'Fokus 14 kolom lapangan untuk penugasan teknisi, alamat, dan konfirmasi WhatsApp',
        columns: DEFAULT_COLUMNS.map(col => ({
          ...col,
          visible: col.mandatory ? true : LEADER_VISIBLE_KEYS.has(col.key)
        })),
        density: 'comfortable',
        rowsPerPage: 15
      },
      {
        id: 'preset_qc',
        name: 'QC & Audit Kualitas',
        description: 'Tampilan 26 kolom verifikasi jaringan FTTH, OPM redaman, ONT, dan laporan 3-tingkat',
        columns: DEFAULT_COLUMNS.map(col => ({
          ...col,
          visible: col.mandatory ? true : QC_AUDIT_VISIBLE_KEYS.has(col.key)
        })),
        density: 'compact',
        rowsPerPage: 20
      },
      {
        id: 'preset_all_46',
        name: 'Semua 46 Kolom',
        description: 'Menampilkan seluruh 46 kolom kanonik BASE_DATA_WO secara lengkap untuk audit penuh',
        columns: DEFAULT_COLUMNS.map(col => ({
          ...col,
          visible: true
        })),
        density: 'compact',
        rowsPerPage: 15
      }
    ]
  },
  toolbar: {
    buttons: [
      { id: 'btn_refresh', label: 'Refresh', icon: 'RotateCw', visible: true, order: 1, group: 'secondary' },
      { id: 'btn_import_wo', label: 'Import WO', icon: 'FileSpreadsheet', visible: true, order: 2, group: 'primary', roleRequired: ['super_admin', 'management_data'] },
      { id: 'btn_export', label: 'Export Data', icon: 'Download', visible: true, order: 3, group: 'secondary' },
      { id: 'btn_view_presets', label: 'View Presets', icon: 'LayoutGrid', visible: true, order: 4, group: 'secondary' },
      { id: 'btn_table_settings', label: 'Customize Table', icon: 'SlidersHorizontal', visible: true, order: 5, group: 'secondary' },
      { id: 'btn_archive_toggle', label: 'Archived Tickets', icon: 'Archive', visible: true, order: 6, group: 'more_menu' },
      { id: 'btn_bulk_assign', label: 'Bulk Assign', icon: 'UserCheck', visible: true, order: 7, group: 'more_menu', roleRequired: ['leader'] }
    ],
    showSearch: true,
    showFilters: true,
    showExport: true,
    showImport: true,
    showArchiveToggle: true,
    showDensityToggle: true
  },
  ticketDetail: {
    showEmptyFields: false,
    sections: DEFAULT_DETAIL_SECTIONS
  },
  pageLayouts: {
    dashboard: { sectionOrder: ['kpi_cards', 'quick_actions', 'contractor_distribution', 'recent_wos'], columns: 4 },
    tickets: { layout: 'table', filterPosition: 'top' },
    importWO: { showInstructions: true },
    detail: { layout: 'two_column' }
  },
  device: {
    mode: 'auto',
    android: {
      layoutType: 'cards',
      touchTargetSize: 'comfortable',
      showBottomNavigation: true,
      cardDensity: 'comfortable',
      showQuickCall: true,
      showQuickWhatsApp: true,
      showQuickDetail: true,
      highContrastBadges: true,
      autoCloseSidebarOnNavigate: true
    },
    pc: {
      tableDensity: 'compact',
      stickyColumns: true,
      wideScreenFullWidth: true,
      showInlineFilters: true,
      showBulkToolbar: true,
      actionButtonsLayout: 'inline_icons',
      multiColumnDetail: true
    }
  },
  navigationSettings: {
    categories: {
      contractor_area: { accordionEnabled: true },
      installer: { accordionEnabled: true },
      menu_tambahan: { accordionEnabled: true }
    },
    allowMultipleOpenGroups: true
  }
};

export const DEFAULT_CANONICAL_CATEGORIES: NavCategoryConfig[] = [
  {
    id: 'contractor_area',
    name: 'Contractor & Area',
    icon: 'Building2',
    order: 1,
    isActive: true,
    mode: 'accordion',
    allowMultipleOpen: true
  },
  {
    id: 'installer',
    name: 'Installer',
    icon: 'Wrench',
    order: 2,
    isActive: true,
    mode: 'accordion',
    allowMultipleOpen: true
  },
  {
    id: 'menu_tambahan',
    name: 'Menu Tambahan',
    icon: 'Sliders',
    order: 3,
    isActive: true,
    mode: 'accordion',
    allowMultipleOpen: true
  }
];

export const DEFAULT_STANDALONE_MENUS: StandaloneMenuItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard Monitoring',
    icon: 'LayoutDashboard',
    order: 1,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader', 'management_data', 'it_support']
  },
  {
    id: 'verification_desk',
    label: 'Antrean Verifikasi',
    icon: 'Inbox',
    order: 2,
    visible: true,
    roles: ['super_admin', 'dispatch']
  },
  {
    id: 'monitoring_maps',
    label: 'Monitoring Maps',
    icon: 'Map',
    order: 3,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader', 'management_data']
  },
  {
    id: 'tickets',
    label: 'Ticket MyRepublic',
    icon: 'Ticket',
    order: 3,
    visible: true,
    roles: ['super_admin', 'dispatch']
  },
  {
    id: 'report_data_wo',
    label: 'Report Data WO',
    icon: 'FileSpreadsheet',
    order: 4,
    visible: true,
    roles: ['super_admin', 'dispatch', 'management_data']
  },
  {
    id: 'import',
    label: 'Import Data WO',
    icon: 'FileSpreadsheet',
    order: 5,
    visible: true,
    roles: ['super_admin', 'management_data']
  },
  {
    id: 'contact_centre',
    label: 'Contact Centre',
    icon: 'MessageSquare',
    order: 6,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader']
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: 'Calendar',
    order: 7,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader']
  },
  {
    id: 'users',
    label: 'Management User',
    icon: 'Users2',
    order: 8,
    visible: true,
    roles: ['super_admin']
  }
];

export const DEFAULT_INSTALLER_STANDALONE_MENUS: StandaloneMenuItem[] = [
  {
    id: 'installer_portal',
    label: 'Dashboard Installer',
    icon: 'LayoutDashboard',
    order: 1,
    visible: true,
    roles: ['installer']
  },
  {
    id: 'installer_tasks',
    label: 'Tugas Saya',
    icon: 'CheckCircle2',
    order: 2,
    visible: true,
    roles: ['installer']
  }
];

export const DEFAULT_SUBMENU_ITEMS: NavSubmenuItem[] = [
  // 1. Contractor & Area
  {
    id: 'wo_assignment',
    label: 'Assign WO',
    icon: 'UserCheck',
    categoryId: 'contractor_area',
    order: 1,
    visible: true,
    roles: ['leader']
  },
  {
    id: 'reassign_wo',
    label: 'Reassign WO',
    icon: 'ArrowRightLeft',
    categoryId: 'contractor_area',
    order: 2,
    visible: true,
    roles: ['leader']
  },
  {
    id: 'progress_dashboard',
    label: 'Dashboard Progress WO',
    icon: 'BarChart3',
    categoryId: 'contractor_area',
    order: 3,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader']
  },
  {
    id: 'contractor_recap',
    label: 'Rekap Total WO per Kontraktor',
    icon: 'FileText',
    categoryId: 'contractor_area',
    order: 3,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader', 'management_data']
  },
  {
    id: 'location_basecamp',
    label: 'Kontraktor & Basecamp',
    icon: 'Building2',
    categoryId: 'contractor_area',
    order: 4,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader']
  },
  {
    id: 'quota_settings',
    label: 'Pengaturan Kuota & Kolom Visibilitas',
    icon: 'SlidersHorizontal',
    categoryId: 'contractor_area',
    order: 5,
    visible: true,
    roles: ['super_admin', 'leader']
  },
  {
    id: 'sla_monitoring',
    label: 'Monitoring SLA Kontraktor & Vendor',
    icon: 'Activity',
    categoryId: 'contractor_area',
    order: 6,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader', 'management_data']
  },

  // 2. Installer (Strict Access: Only super_admin and installer)
  {
    id: 'installer_mgmt',
    label: 'Pendaftaran Akun Teknisi',
    icon: 'UserPlus',
    categoryId: 'installer',
    order: 1,
    visible: true,
    roles: ['super_admin', 'leader']
  },
  {
    id: 'report_installer',
    label: 'Report Installer',
    icon: 'FileText',
    categoryId: 'installer',
    order: 2,
    visible: true,
    roles: ['super_admin', 'installer']
  },

  // 3. Menu Tambahan
  {
    id: 'setup',
    label: 'Setup',
    icon: 'Sliders',
    categoryId: 'menu_tambahan',
    order: 1,
    visible: true,
    highlight: true,
    roles: ['super_admin', 'dispatch', 'management_data']
  },
  {
    id: 'nav_config',
    label: 'Konfigurasi Menu Navigasi',
    icon: 'FolderTree',
    categoryId: 'menu_tambahan',
    order: 2,
    visible: true,
    roles: ['super_admin']
  },
  {
    id: 'management_role',
    label: 'Role & Permission',
    icon: 'ShieldCheck',
    categoryId: 'menu_tambahan',
    order: 3,
    visible: true,
    roles: ['super_admin']
  },
  {
    id: 'droplist_management',
    label: 'Kategori Report',
    icon: 'ListOrdered',
    categoryId: 'menu_tambahan',
    order: 4,
    visible: true,
    roles: ['super_admin', 'dispatch', 'management_data']
  },
  {
    id: 'templates',
    label: 'Template WhatsApp',
    icon: 'MessageSquareQuote',
    categoryId: 'menu_tambahan',
    order: 5,
    visible: true,
    roles: ['super_admin', 'dispatch']
  },
  {
    id: 'sound_settings',
    label: 'Pengaturan Notifikasi',
    icon: 'Bell',
    categoryId: 'menu_tambahan',
    order: 6,
    visible: true,
    roles: ['super_admin', 'dispatch']
  },
  {
    id: 'audit_logs',
    label: 'Audit Trail Log',
    icon: 'History',
    categoryId: 'menu_tambahan',
    order: 7,
    visible: true,
    roles: ['super_admin', 'it_support']
  },
  {
    id: 'login_logs',
    label: 'Riwayat Sesi Login',
    icon: 'KeyRound',
    categoryId: 'menu_tambahan',
    order: 8,
    visible: true,
    roles: ['super_admin', 'dispatch', 'it_support']
  },
  {
    id: 'system_health',
    label: 'Kesehatan Sistem',
    icon: 'Activity',
    categoryId: 'menu_tambahan',
    order: 9,
    visible: true,
    roles: ['super_admin', 'it_support']
  },
  {
    id: 'offline_sync',
    label: 'Sinkronisasi Offline',
    icon: 'RefreshCw',
    categoryId: 'menu_tambahan',
    order: 10,
    visible: true,
    roles: ['super_admin', 'dispatch', 'leader']
  },
  {
    id: 'database_management',
    label: 'Database Application',
    icon: 'Database',
    categoryId: 'menu_tambahan',
    order: 11,
    visible: true,
    roles: ['super_admin']
  }
];

export const DEFAULT_NAVIGATION_DOC: NavigationConfigDoc = {
  categories: DEFAULT_CANONICAL_CATEGORIES,
  standaloneMenus: DEFAULT_STANDALONE_MENUS,
  submenuItems: DEFAULT_SUBMENU_ITEMS,
  accordionSettings: {
    allowMultipleOpenGroups: true
  },
  navigationVersion: 2,
  updatedAt: new Date().toISOString(),
  updatedBy: 'System'
};

export const DEFAULT_NAVIGATION_CATEGORIES = {
  contractor_area: { accordionEnabled: true },
  installer: { accordionEnabled: true },
  menu_tambahan: { accordionEnabled: true }
};


export const STANDARD_HEADER_MAPPINGS: HeaderMapping[] = [
  {
    standardField: 'woNumber',
    label: 'WO Number',
    aliases: ['wo number', 'no wo', 'nomor wo', 'wo_number', 'wo id', 'work order number', 'wonumber', 'no. wo'],
    required: true,
    category: 'core'
  },
  {
    standardField: 'idCustomer',
    label: 'Customer ID',
    aliases: ['id customer', 'customer id', 'no pelanggan', 'id pelanggan', 'cust id', 'id_customer', 'customerid'],
    required: true,
    category: 'customer'
  },
  {
    standardField: 'customerName',
    label: 'Customer Name',
    aliases: ['customer name', 'nama customer', 'nama pelanggan', 'customer_name', 'name', 'nama'],
    required: true,
    category: 'customer'
  },
  {
    standardField: 'customerPhone',
    label: 'Customer Phone',
    aliases: ['customer phone', 'no hp', 'no telp', 'nomor telepon', 'customer_phone', 'phone', 'contact', 'telepon', 'mobile'],
    required: true,
    category: 'customer'
  },
  {
    standardField: 'date',
    label: 'Date',
    aliases: ['date', 'tanggal', 'tgl', 'date wo', 'appointment date', 'tanggal wo'],
    required: false,
    category: 'core'
  },
  {
    standardField: 'slotTime',
    label: 'Slot Time',
    aliases: ['slot time', 'slot_time', 'waktu kunjungan', 'jadwal', 'slot', 'appointment time', 'jam kunjungan'],
    required: false,
    category: 'core'
  },
  {
    standardField: 'contactorName',
    label: 'Contractor Name',
    aliases: ['contactor name', 'contractor name', 'nama kontraktor', 'kategori kontraktor', 'kategori vendor', 'kategori mitra', 'kat kontraktor', 'vendor', 'mitra', 'kontraktor', 'contractor'],
    required: false,
    category: 'assignment'
  },
  {
    standardField: 'area',
    label: 'Area',
    aliases: ['area', 'wilayah', 'regional', 'kota', 'city', 'zone', 'region'],
    required: false,
    category: 'location'
  },
  {
    standardField: 'installerName',
    label: 'Installer Name',
    aliases: ['installer name', 'teknisi', 'nama teknisi', 'installer', 'petugas', 'installer_name', 'technician'],
    required: false,
    category: 'assignment'
  },
  {
    standardField: 'clusterName',
    label: 'Cluster Name',
    aliases: ['cluster name', 'cluster', 'nama cluster', 'perumahan', 'komplek', 'cluster_name'],
    required: false,
    category: 'location'
  },
  {
    standardField: 'fdtCode',
    label: 'FDT Code',
    aliases: ['fdt code', 'fdt', 'kode fdt', 'fdt_code'],
    required: false,
    category: 'technical'
  },
  {
    standardField: 'fatCode',
    label: 'FAT Code',
    aliases: ['fat code', 'fat', 'kode fat', 'fat_code'],
    required: false,
    category: 'technical'
  },
  {
    standardField: 'ticketCategory',
    label: 'Ticket Category',
    aliases: ['ticket category', 'kategori tiket', 'category', 'jenis tiket', 'jenis wo', 'tipe wo', 'tipe tiket'],
    required: false,
    category: 'core'
  },
  {
    standardField: 'statusWOInstaller',
    label: 'Status WO Installer',
    aliases: ['status wo installer', 'status installer', 'status teknisi', 'installer status', 'progres installer'],
    required: false,
    category: 'status'
  },
  {
    standardField: 'remarksWOInstaller',
    label: 'Remarks WO Installer',
    aliases: ['remarks wo installer', 'remarks installer', 'catatan teknisi', 'remarks', 'keterangan teknisi'],
    required: false,
    category: 'status'
  },
  {
    standardField: 'fileName',
    label: 'File Name',
    aliases: ['file name', 'nama file', 'source file', 'file_name'],
    required: false,
    category: 'core'
  },
  {
    standardField: 'dateUpload',
    label: 'Date Upload',
    aliases: ['date upload', 'tgl upload', 'tanggal upload', 'uploaded date', 'date_upload'],
    required: false,
    category: 'core'
  },
  {
    standardField: 'agentId',
    label: 'Agent ID',
    aliases: ['agent id', 'id agent', 'agent', 'petugas agent', 'agent_id'],
    required: false,
    category: 'core'
  },
  {
    standardField: 'streetName',
    label: 'Street Name',
    aliases: ['street name', 'alamat', 'street', 'alamat pelanggan', 'address', 'street_name'],
    required: false,
    category: 'location'
  },
  {
    standardField: 'streetAlternatif',
    label: 'Street Alternatif',
    aliases: ['street alternatif', 'alamat alternatif', 'patokan', 'landmark', 'alamat cadangan'],
    required: false,
    category: 'location'
  }
];

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: 'tpl_schedule_confirmation',
    name: 'Konfirmasi Jadwal Kunjungan Teknisi',
    description: 'Pesan standar konfirmasi jadwal kedatangan teknisi dan alamat pemasangan kepada pelanggan',
    category: 'Konfirmasi Jadwal Kunjungan',
    messageBody: `Halo Bapak/Ibu {{customer_name}},

Kami menginformasikan bahwa Work Order Anda telah dijadwalkan dengan detail berikut:

Nomor WO: {{wo_number}}
Nomor Pelanggan: {{customer_id}}
Jadwal Kunjungan: {{slot_time}}
Alamat: {{street_name}}
Cluster: {{cluster_name}}
Teknisi: {{installer_name}}
Kontraktor: {{contractor_name}}

Mohon konfirmasi apakah Bapak/Ibu bersedia menerima kunjungan teknisi pada jadwal tersebut.

Balas "YA" untuk konfirmasi, atau hubungi kami jika ingin mengajukan perubahan jadwal (reschedule).

Terima kasih.
Tim Dispatch & Customer Support`,
    availableVariables: [
      'customer_name',
      'customer_id',
      'customer_phone',
      'wo_number',
      'slot_time',
      'street_name',
      'cluster_name',
      'area',
      'installer_name',
      'contractor_name',
      'ticket_category',
      'date'
    ],
    isDefault: true,
    active: true,
    editableByRole: ['super_admin', 'dispatch', 'leader'],
    createdBy: 'System',
    updatedBy: 'System',
    version: 1,
    lastUpdated: new Date().toISOString()
  },
  {
    id: 'tpl_en_route',
    name: 'Teknisi Menuju Lokasi (En Route)',
    description: 'Pemberitahuan bahwa teknisi sedang dalam perjalanan menuju alamat pelanggan',
    category: 'Teknisi Menuju Lokasi',
    messageBody: `Halo Bapak/Ibu {{customer_name}},

Teknisi kami, {{installer_name}} (Mitra: {{contractor_name}}), sedang dalam perjalanan menuju lokasi Anda di {{cluster_name}}, {{area}} untuk pengerjaan WO {{wo_number}}.

Estimasi kedatangan sesuai slot: {{slot_time}}.
Mohon pastikan ada perwakilan di rumah saat teknisi tiba.

Jika ada kendala arah lokasi, teknisi dapat menghubungi nomor ini.

Terima kasih.`,
    availableVariables: [
      'customer_name',
      'customer_id',
      'wo_number',
      'slot_time',
      'cluster_name',
      'area',
      'installer_name',
      'contractor_name'
    ],
    isDefault: false,
    active: true,
    editableByRole: ['super_admin', 'dispatch', 'leader'],
    createdBy: 'System',
    updatedBy: 'System',
    version: 1,
    lastUpdated: new Date().toISOString()
  },
  {
    id: 'tpl_reschedule_offer',
    name: 'Penjadwalan Ulang (Reschedule Request)',
    description: 'Template untuk menawarkan opsi jadwal baru bila pelanggan berhalangan',
    category: 'Perubahan Jadwal',
    messageBody: `Halo Bapak/Ibu {{customer_name}},

Menindaklanjuti permohonan reschedule untuk WO {{wo_number}}, saat ini kami menyediakan pilihan slot waktu kunjungan berikutnya.

Mohon informasikan ketersediaan waktu Bapak/Ibu di antara opsi berikut atau ajukan tanggal alternatif yang diinginkan.

Nomor Pelanggan: {{customer_id}}
Cluster: {{cluster_name}}

Kami siap membantu agar pengerjaan dapat berjalan lancar. Terima kasih.`,
    availableVariables: [
      'customer_name',
      'customer_id',
      'wo_number',
      'cluster_name',
      'slot_time'
    ],
    isDefault: false,
    active: true,
    editableByRole: ['super_admin', 'dispatch'],
    createdBy: 'System',
    updatedBy: 'System',
    version: 1,
    lastUpdated: new Date().toISOString()
  },
  {
    id: 'tpl_completion_check',
    name: 'Konfirmasi Penyelesaian Pemasangan',
    description: 'Verifikasi kepuasan dan status penyelesaian instalasi dari pelanggan',
    category: 'Konfirmasi Penyelesaian',
    messageBody: `Halo Bapak/Ibu {{customer_name}},

Pengerjaan WO {{wo_number}} oleh teknisi {{installer_name}} telah dilaporkan selesai.

Mohon pastikan layanan sudah dapat digunakan dengan baik. Apabila ada pertanyaan atau catatan perbaikan, silakan sampaikan kepada kami.

Terima kasih atas kerja sama Bapak/Ibu.
Salam hangat, Dispatch Management`,
    availableVariables: [
      'customer_name',
      'wo_number',
      'installer_name',
      'slot_time'
    ],
    isDefault: false,
    active: true,
    editableByRole: ['super_admin', 'dispatch'],
    createdBy: 'System',
    updatedBy: 'System',
    version: 1,
    lastUpdated: new Date().toISOString()
  },
  {
    id: 'tpl_installer_assignment',
    name: 'Penugasan WO Teknisi Lapangan (Assignment Notification)',
    description: 'Pesan notifikasi resmi penugasan Work Order dari Leader/Korlap langsung ke nomor WhatsApp teknisi installer',
    category: 'Penugasan Teknisi Lapangan',
    messageBody: `Halo Rekan Teknisi {{installer_name}},

Ada penugasan Work Order baru untuk Anda dari Korlap ({{leader_name}} - {{contractor_name}}):

📌 Detail Work Order:
- No. WO: {{wo_number}}
- Kategori: {{ticket_category}}
- Tanggal Kunjungan: {{appointment_date}}
- Slot Waktu: {{slot_time}}

📍 Lokasi Pelanggan:
- Nama: {{customer_name}}
- No. Kontak Pelanggan: {{customer_phone}}
- Alamat: {{street_name}}
- Patokan: {{street_alternatif}}
- Cluster: {{cluster_name}}
- Area: {{area}}

🔧 Data Jaringan:
- OLT/FDT: {{fdt_code}}
- FAT Code: {{fat_code}}

Harap segera konfirmasi penerimaan tugas melalui Portal Teknisi Lapangan atau balas pesan ini jika siap meluncur.
Terima kasih, selamat bertugas!`,
    availableVariables: [
      'installer_name',
      'installer_phone',
      'leader_name',
      'contractor_name',
      'wo_number',
      'ticket_category',
      'appointment_date',
      'slot_time',
      'customer_name',
      'customer_phone',
      'street_name',
      'street_alternatif',
      'cluster_name',
      'area',
      'fdt_code',
      'fat_code'
    ],
    isDefault: false,
    active: true,
    editableByRole: ['super_admin', 'dispatch', 'leader'],
    createdBy: 'System',
    updatedBy: 'System',
    version: 1,
    lastUpdated: new Date().toISOString()
  }
];

export const DEFAULT_WORKFLOW_RULES: WorkflowRule[] = [
  {
    id: 'wf_assign_prepare_wa',
    name: 'Otomatis Siapkan URL WhatsApp Saat Installer Ditugaskan',
    description: 'Ketika teknisi berhasil di-assign ke tiket, sistem langsung menyiapkan URL konfirmasi WhatsApp dengan template aktif.',
    trigger: 'installer_assigned',
    conditions: [
      { field: 'customerPhone', operator: 'is_not_empty' }
    ],
    actions: [
      { type: 'prepare_whatsapp', templateId: 'tpl_schedule_confirmation', targetStatus: 'ready' },
      { type: 'log_event' }
    ],
    enabled: true,
    executionCount: 14,
    lastExecutedAt: new Date().toISOString()
  },
  {
    id: 'wf_slot_time_changed',
    name: 'Reset Konfirmasi Jika Slot Waktu Berubah',
    description: 'Bila slot waktu kunjungan diubah, set status WhatsApp kembali menjadi Ready dan siapkan pesan update.',
    trigger: 'slot_time_changed',
    conditions: [],
    actions: [
      { type: 'update_wa_status', targetStatus: 'ready' },
      { type: 'prepare_whatsapp', templateId: 'tpl_schedule_confirmation' },
      { type: 'log_event' }
    ],
    enabled: true,
    executionCount: 3,
    lastExecutedAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 'wf_new_import_validation',
    name: 'Notifikasi & Validasi Saat Tiket Baru Diimpor',
    description: 'Validasi otomatis kelengkapan nomor telepon pelanggan dan cluster saat tiket diimpor.',
    trigger: 'ticket_imported',
    conditions: [],
    actions: [
      { type: 'log_event' }
    ],
    enabled: true,
    executionCount: 42,
    lastExecutedAt: new Date().toISOString()
  }
];

export const INITIAL_SAMPLE_TICKETS: Ticket[] = [];

export const DEFAULT_CONTRACTORS: Contractor[] = [];

export const DEFAULT_COVERAGE_AREAS: CoverageArea[] = [];


export const DEFAULT_ROOT_CAUSE_CATEGORIES: RootCauseCategory[] = [
  {
    id: 'rc-1',
    name: 'Gangguan Fiber Optic dan Jaringan',
    description: 'Kendala pada media transmisi optik, kabel dropcore, redaman, dan pasif optik (FAT/FDT/ODP)',
    items: [
      'Fiber Optic Putus',
      'Kabel Dropcore Rusak',
      'Kabel Dropcore Tertekuk',
      'Redaman Fiber Tinggi',
      'Konektor Fiber Kotor atau Rusak',
      'Splicing Bermasalah',
      'ODP/FAT Bermasalah',
      'FDT Bermasalah',
      'OLT/Port Bermasalah',
      'Jalur Fiber Tidak Tersedia',
      'Gangguan Jaringan Area',
      'Gangguan Backbone atau Distribusi'
    ]
  },
  {
    id: 'rc-2',
    name: 'ONT, Router, dan Wi-Fi',
    description: 'Kendala pada perangkat aktif pelanggan, konfigurasi, sinyal radio Wi-Fi, dan power',
    items: [
      'ONT Rusak',
      'Router Rusak',
      'ONT Tidak Mendapatkan Daya',
      'ONT LOS',
      'ONT Tidak Terhubung ke Jaringan',
      'Router Tidak Menyala',
      'Wi-Fi Tidak Terdeteksi',
      'Wi-Fi Lemah',
      'Interferensi Wi-Fi',
      'Salah Konfigurasi Router',
      'Masalah DHCP atau IP',
      'Perangkat Pelanggan Bermasalah'
    ]
  },
  {
    id: 'rc-3',
    name: 'Instalasi dan Infrastruktur',
    description: 'Kebutuhan pekerjaan fisik tarikan baru, relokasi, tiang, dan ketersediaan port',
    items: [
      'Instalasi Baru',
      'Relokasi Kabel',
      'Penataan Ulang Kabel',
      'Jalur Kabel Terhalang',
      'Kabel Tidak Cukup',
      'Akses Tiang atau Jalur Terkendala',
      'FAT/ODP Tidak Ditemukan',
      'Port Tidak Tersedia',
      'Perangkat Tidak Sesuai',
      'Instalasi Belum Selesai'
    ]
  },
  {
    id: 'rc-4',
    name: 'Pelanggan dan Lokasi',
    description: 'Kendala non-teknis terkait kehadiran pelanggan, akses hunian, dan jadwal',
    items: [
      'Pelanggan Tidak di Tempat',
      'Pelanggan Tidak Dapat Dihubungi',
      'Pelanggan Menolak Pengerjaan',
      'Alamat Tidak Sesuai',
      'Lokasi Tidak Ditemukan',
      'Akses Rumah atau Gedung Terkendala',
      'Perlu Penjadwalan Ulang',
      'Menunggu Persetujuan Pelanggan'
    ]
  },
  {
    id: 'rc-5',
    name: 'Sistem, Administrasi, dan Operasional',
    description: 'Kesalahan data perintah kerja, penugasan personel, atau ketergantungan material/eskalasi',
    items: [
      'Data WO Tidak Sesuai',
      'Duplikasi WO',
      'Salah Assign Teknisi',
      'Salah Data Perangkat',
      'Menunggu Tim Lain',
      'Menunggu Material',
      'Menunggu Eskalasi',
      'Gangguan Sistem',
      'Kendala Operasional Lainnya'
    ]
  }
];

export const DEFAULT_WORK_RESULTS: string[] = [
  'Berhasil Diperbaiki',
  'Berhasil dengan Penggantian Perangkat',
  'Berhasil dengan Perbaikan Kabel',
  'Berhasil setelah Konfigurasi Ulang',
  'Tidak Berhasil',
  'Pekerjaan Tertunda',
  'Perlu Eskalasi',
  'Perlu Kunjungan Ulang'
];

export const DEFAULT_USERS: User[] = [
  {
    id: 'u-ray',
    userId: 'u-ray',
    name: 'Ray (Super Admin)',
    username: 'ray',
    email: 'rayjs666@gmail.com',
    role: 'super_admin',
    active: true,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 1,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u-1',
    userId: 'u-1',
    name: 'Alamsyah (Super Admin)',
    username: 'superadmin',
    email: 'tarnocepak@gmail.com',
    role: 'super_admin',
    active: true,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 1,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u-mgmt',
    userId: 'u-mgmt',
    name: 'Staff Management Data',
    username: 'datamgmt',
    email: 'data.ops@morajaws.net',
    role: 'management_data',
    active: true,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 1,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u-dispatch-1',
    userId: 'u-dispatch-1',
    name: 'Siti Rahma (Dispatcher)',
    username: 'dispatch',
    email: 'dispatch@morajaws.net',
    role: 'dispatch',
    phone: '081299001122',
    active: true,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 1,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u-leader-1',
    userId: 'u-leader-1',
    name: 'Hendra Gunawan (Leader MJS)',
    username: 'leadermjs',
    email: 'hendra@mjs.morajaws.net',
    role: 'leader',
    contractor: 'PT Mitra Jaringan Solusi',
    contractorId: 'c-mjs',
    area: 'Jakarta Selatan',
    phone: '081288990011',
    active: true,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 1,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u-installer-1',
    userId: 'u-installer-1',
    name: 'Andi Saputra',
    username: 'installer1',
    email: 'andi@installer.morajaws.net',
    role: 'installer',
    contractor: 'PT Mitra Jaringan Solusi',
    contractorId: 'c-mjs',
    area: 'Jakarta Selatan',
    phone: '081299883344',
    active: true,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 1,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u-leader-2',
    userId: 'u-leader-2',
    name: 'Dedi Kurniawan (Leader KCS)',
    username: 'leaderkcs',
    email: 'dedi@kcs.morajaws.net',
    role: 'leader',
    contractor: 'PT Kencana Solusindo',
    contractorId: 'c-kcs',
    area: 'Jakarta Barat',
    phone: '085711223344',
    active: true,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 1,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u-installer-2',
    userId: 'u-installer-2',
    name: 'Budi Santoso',
    username: 'installer2',
    email: 'budi@installer.morajaws.net',
    role: 'installer',
    contractor: 'PT Kencana Solusindo',
    contractorId: 'c-kcs',
    area: 'Jakarta Barat',
    phone: '085711224455',
    active: true,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 1,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'u-inactive-1',
    userId: 'u-inactive-1',
    name: 'Bambang Sudirgo (Akun Nonaktif)',
    username: 'staf_nonaktif',
    email: 'bambang.nonaktif@morajaws.net',
    role: 'installer',
    contractor: 'PT Kencana Solusindo',
    contractorId: 'c-kcs',
    area: 'Jakarta Barat',
    phone: '085711229988',
    active: false,
    passwordHash: DEFAULT_PASSWORD_HASH,
    lastLoginAt: '2026-01-01T00:00:00Z',
    loginCount: 0,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z'
  }
];


