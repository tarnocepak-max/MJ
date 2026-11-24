import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { useToast } from '../../context/ToastContext';
import { UserRole } from '../../types';
import { Permission } from '../../services/authService';
import {
  ShieldCheck,
  Shield,
  Building2,
  Wrench,
  Database,
  Sliders,
  Check,
  X,
  Lock,
  Loader2,
  AlertTriangle,
  Download,
  RefreshCw,
  CheckCircle2,
  Eye,
  LayoutTemplate,
  FolderTree,
  Users,
  List,
  MessageSquare,
  GitBranch,
  Volume2,
  Activity,
  Mail
} from 'lucide-react';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';

const CORE_SUPER_ADMIN_PERMISSIONS: Permission[] = [
  'login',
  'manage_users',
  'ui_configuration',
  'application_configuration',
  'view_audit_logs',
  'system_health'
];

type PersonaPreviewRole = UserRole;

interface SetupTabRBACDef {
  id: string;
  num: string;
  label: string;
  category: string;
  icon: React.ElementType;
  superadminScope: { text: string; tone: 'full' | 'lock' };
  dispatchScope: { text: string; tone: 'write' | 'denied' | 'audio' };
  allowedRoles: PersonaPreviewRole[];
}

const SETUP_TAB_MATRIX: SetupTabRBACDef[] = [
  {
    id: 'app_config',
    num: '01',
    label: 'Konfigurasi Sistem',
    category: '01 · System Configuration',
    icon: Building2,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'DENIED', tone: 'denied' },
    allowedRoles: ['super_admin']
  },
  {
    id: 'nav_config',
    num: '02',
    label: 'Menu Navigasi',
    category: '01 · System Configuration',
    icon: FolderTree,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'DENIED', tone: 'denied' },
    allowedRoles: ['super_admin']
  },
  {
    id: 'ui_builder',
    num: '03',
    label: 'Kolom & Tampilan UI',
    category: '01 · System Configuration',
    icon: LayoutTemplate,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'DENIED', tone: 'denied' },
    allowedRoles: ['super_admin']
  },
  {
    id: 'database',
    num: '04',
    label: 'Database & Sync',
    category: '02 · Data & Integration',
    icon: Database,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'DENIED', tone: 'denied' },
    allowedRoles: ['super_admin']
  },
  {
    id: 'users',
    num: '05',
    label: 'Pengguna & Akun',
    category: '03 · Users & Access Control',
    icon: Users,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'LOCKED', tone: 'denied' },
    allowedRoles: ['super_admin']
  },
  {
    id: 'roles',
    num: '06',
    label: 'Role & Permission',
    category: '03 · Users & Access Control',
    icon: Shield,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'DENIED', tone: 'denied' },
    allowedRoles: ['super_admin']
  },
  {
    id: 'droplists',
    num: '07',
    label: 'Kategori Report',
    category: '04 · Operational Config',
    icon: List,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'WRITE', tone: 'write' },
    allowedRoles: ['super_admin', 'dispatch']
  },
  {
    id: 'whatsapp',
    num: '08',
    label: 'Template WhatsApp',
    category: '04 · Operational Config',
    icon: MessageSquare,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'WRITE', tone: 'write' },
    allowedRoles: ['super_admin', 'dispatch']
  },
  {
    id: 'workflows',
    num: '09',
    label: 'Workflows & Otomasi',
    category: '04 · Operational Config',
    icon: GitBranch,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'WRITE', tone: 'write' },
    allowedRoles: ['super_admin', 'dispatch']
  },
  {
    id: 'sound',
    num: '10',
    label: 'Notifikasi & Audio',
    category: '05 · Preferences & Monitoring',
    icon: Volume2,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'AUDIO WRITE', tone: 'audio' },
    allowedRoles: ['super_admin', 'dispatch']
  },
  {
    id: 'email_notifications',
    num: '11',
    label: 'Email Notification',
    category: '05 · Preferences & Monitoring',
    icon: Mail,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'DENIED', tone: 'denied' },
    allowedRoles: ['super_admin']
  },
  {
    id: 'health_logs',
    num: '12',
    label: 'Kesehatan & Log',
    category: '05 · Preferences & Monitoring',
    icon: Activity,
    superadminScope: { text: 'FULL', tone: 'full' },
    dispatchScope: { text: 'DENIED', tone: 'denied' },
    allowedRoles: ['super_admin']
  }
];

interface ManagementRoleViewProps {
  onJumpSetupTab?: (tabKey: string) => void;
}

export const ManagementRoleView: React.FC<ManagementRoleViewProps> = ({ onJumpSetupTab }) => {
  const {
    currentUser,
    users,
    rolePermissions,
    rolePermissionsVersion,
    updateRolePermissions,
    refreshDatabaseData,
    addAuditLog,
    rootCauseCategories
  } = useApp();
  const { config, standaloneMenus, submenuItems } = useUIConfig();
  const { toast } = useToast();

  const isSuperAdmin = currentUser.role === 'super_admin';
  const { isCompactUI } = useResponsiveViewport();
  const [selectedMobileRole, setSelectedMobileRole] = useState<UserRole>('super_admin');
  const [selectedPersona, setSelectedPersona] = useState<PersonaPreviewRole>('super_admin');
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [isSyncingRbac, setIsSyncingRbac] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);

  const roles: { role: UserRole; label: string; shortLabel: string; desc: string; icon: React.ElementType; color: string }[] = [
    {
      role: 'super_admin',
      label: 'Super Admin (Super Agent)',
      shortLabel: 'Super Admin',
      desc: 'Otoritas tunggal pengelolaan sistem: manajemen user & RBAC, database, sinkronisasi, import/backup/hapus WO, konfigurasi UI & navigasi, Audit Log, serta System Health.',
      icon: ShieldCheck,
      color: 'text-[#5145A6] bg-[#EAE8FF] dark:text-purple-200 dark:bg-purple-950/60'
    },
    {
      role: 'dispatch',
      label: 'Dispatch Management',
      shortLabel: 'Dispatch',
      desc: 'Monitoring sentral seluruh WO, verifikasi laporan teknis & penutupan tiket, live chat, Form Sameday, Template WA, Workflows, dan Kategori Report.',
      icon: Shield,
      color: 'text-indigo-700 bg-indigo-100 dark:text-indigo-200 dark:bg-indigo-950/60'
    },
    {
      role: 'leader',
      label: 'Leader / Korlap Lapangan',
      shortLabel: 'Leader',
      desc: 'Pengawasan wilayah & kontraktor terikat, assign WO ke teknisi, reassign WO, kuota harian, dan pendaftaran akun teknisi tim.',
      icon: Building2,
      color: 'text-amber-700 bg-amber-100 dark:text-amber-200 dark:bg-amber-950/60'
    },
    {
      role: 'installer',
      label: 'Installer / Teknisi Lapangan',
      shortLabel: 'Installer',
      desc: 'Hanya melihat WO yang ditugaskan ke akunnya, check-in GPS, formulir laporan teknis OPM, upload foto, dan chat.',
      icon: Wrench,
      color: 'text-emerald-700 bg-emerald-100 dark:text-emerald-200 dark:bg-emerald-950/60'
    }
  ];

  const permissionsList: { key: Permission; label: string; category: string }[] = [
    { key: 'login', label: 'Login ke Sistem', category: 'Autentikasi' },
    { key: 'view_all_wo', label: 'Melihat Seluruh Data WO (System-Wide)', category: 'Data WO' },
    { key: 'view_contractor_wo', label: 'Melihat WO Kontraktor Tertentu', category: 'Data WO' },
    { key: 'view_assigned_wo', label: 'Melihat WO Milik Sendiri (Assigned Only)', category: 'Data WO' },
    { key: 'edit_wo_data', label: 'Mengubah Data WO & Identitas Utama', category: 'Operasional' },
    { key: 'assign_technician', label: 'Assign & Reassign WO ke Teknisi', category: 'Operasional' },
    { key: 'edit_technical_report', label: 'Mengisi & Mengubah Laporan Teknis', category: 'Operasional' },
    { key: 'access_live_chat', label: 'Mengakses Live Chat & Mengirim Pesan', category: 'Komunikasi' },
    { key: 'import_data', label: 'Import Data WO (Excel & Text)', category: 'Manajemen Data' },
    { key: 'manage_field_mapping', label: 'Mengelola Mapping Field & Alias', category: 'Manajemen Data' },
    { key: 'database_management', label: 'Mengakses Menu Database Management', category: 'Manajemen Data' },
    { key: 'manage_users', label: 'Kelola Pengguna Umum & Staff', category: 'Administrasi Akun' },
    { key: 'create_installer', label: 'Mendaftarkan Akun Teknisi (Installer)', category: 'Administrasi Akun' },
    { key: 'delete_user', label: 'Menghapus Akun Pengguna', category: 'Administrasi Akun' },
    { key: 'view_audit_logs', label: 'Melihat Audit Log & History (Superadmin)', category: 'Keamanan' },
    { key: 'delete_wo_data', label: 'Menghapus Data Work Order (Superadmin)', category: 'Keamanan' },
    { key: 'manage_whatsapp_templates', label: 'Kelola Template WhatsApp (Super Admin & Dispatch)', category: 'Komunikasi' },
    { key: 'ui_configuration', label: 'Konfigurasi Layout & UI Builder', category: 'Teknis & Sistem' },
    { key: 'application_configuration', label: 'Konfigurasi Global Aplikasi & Menu', category: 'Teknis & Sistem' },
    { key: 'system_health', label: 'Monitoring System Health & Diagnostik', category: 'Teknis & Sistem' },
    { key: 'setting_droplist', label: 'Mengatur Droplist Kamus Pilihan', category: 'Teknis & Sistem' }
  ];

  const userCountByRole = useMemo(() => {
    const map: Record<string, number> = {};
    (users || []).forEach(u => {
      map[u.role] = (map[u.role] || 0) + 1;
    });
    return map;
  }, [users]);

  const personaStats = useMemo(() => {
    const allowedSetupTabs = SETUP_TAB_MATRIX.filter(t => t.allowedRoles.includes(selectedPersona));
    const restrictedSetupTabs = SETUP_TAB_MATRIX.filter(t => !t.allowedRoles.includes(selectedPersona));
    const granularPerms = Array.isArray(rolePermissions[selectedPersona]) ? rolePermissions[selectedPersona] : [];
    const activeRoleObj = roles.find(r => r.role === selectedPersona) || roles[0];
    return {
      allowedSetupTabs,
      restrictedSetupTabs,
      granularPerms,
      activeRoleObj,
      staffCount: userCountByRole[selectedPersona] || 0
    };
  }, [selectedPersona, rolePermissions, userCountByRole]);

  const groupedSetupMatrix = useMemo(() => {
    const groups: { category: string; items: SetupTabRBACDef[] }[] = [];
    SETUP_TAB_MATRIX.forEach(item => {
      let grp = groups.find(g => g.category === item.category);
      if (!grp) {
        grp = { category: item.category, items: [] };
        groups.push(grp);
      }
      grp.items.push(item);
    });
    return groups;
  }, []);

  const handleTogglePermission = async (role: UserRole, permKey: Permission) => {
    if (!isSuperAdmin || savingCell) return;
    if (role === 'super_admin' && CORE_SUPER_ADMIN_PERMISSIONS.includes(permKey)) {
      return;
    }

    const cellId = `${role}:${permKey}`;
    setSavingCell(cellId);
    setLastError(null);

    const currentList = Array.isArray(rolePermissions[role]) ? rolePermissions[role] : [];
    const exists = currentList.includes(permKey);
    const nextRolePerms = exists
      ? currentList.filter(p => p !== permKey)
      : [...currentList, permKey];

    const nextMatrix: Record<string, string[]> = {
      ...rolePermissions,
      [role]: nextRolePerms
    };

    const res = await updateRolePermissions(nextMatrix, {
      notes: `${exists ? 'Revoke' : 'Grant'} ${permKey} pada role ${role}`
    });

    if (!res.success && res.error) {
      setLastError(res.error);
    }
    setSavingCell(null);
  };

  const handleExportRbacMatrix = () => {
    const escapeCsv = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
    const headers = [
      'Permission Key',
      'Label',
      'Category',
      'Super Admin',
      'Dispatch',
      'Leader',
      'Installer'
    ];
    const rows = permissionsList.map(p => [
      p.key,
      p.label,
      p.category,
      (rolePermissions.super_admin || []).includes(p.key) ? 'ALLOW' : 'DENY',
      (rolePermissions.dispatch || []).includes(p.key) ? 'ALLOW' : 'DENY',
      (rolePermissions.leader || []).includes(p.key) ? 'ALLOW' : 'DENY',
      (rolePermissions.installer || []).includes(p.key) ? 'ALLOW' : 'DENY'
    ]);

    const setupHeader = ['', '--- PEMETAAN 11 TAB SETUP TERPUSAT ---'];
    const setupCols = ['No', 'Tab Setup', 'Kategori', 'Super Admin', 'Dispatch'];
    const setupRows = SETUP_TAB_MATRIX.map(t => [
      t.num,
      t.label,
      t.category,
      t.superadminScope.text,
      t.dispatchScope.text
    ]);

    const csvLines = [
      headers.map(escapeCsv).join(','),
      ...rows.map(r => r.map(escapeCsv).join(',')),
      setupHeader.map(escapeCsv).join(','),
      setupCols.map(escapeCsv).join(','),
      ...setupRows.map(r => r.map(escapeCsv).join(','))
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `morajaws-rbac-matrix-v${rolePermissionsVersion}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    addAuditLog(
      'export_rbac_matrix',
      'global_config',
      `role_permissions_v${rolePermissionsVersion}`,
      `Mengekspor matriks hak akses RBAC v${rolePermissionsVersion} (21 permission + 11 tab Setup)`
    );
    toast.success(`Matriks RBAC v${rolePermissionsVersion} berhasil diekspor ke CSV.`);
  };

  const handleSyncAndVerifyRbac = async () => {
    setIsSyncingRbac(true);
    setLastError(null);
    try {
      await refreshDatabaseData();
      const nowLabel = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      setLastVerifiedAt(`${nowLabel} WIB`);
      toast.success(`Sinkronisasi & validasi matriks RBAC v${rolePermissionsVersion} terverifikasi.`);
    } catch (err: any) {
      setLastError(err?.message || 'Gagal memverifikasi ulang matriks RBAC dari server.');
    } finally {
      setIsSyncingRbac(false);
    }
  };

  const renderScopePill = (text: string, tone: 'full' | 'lock' | 'write' | 'sync' | 'denied' | 'audio') => {
    if (tone === 'full') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold font-mono uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
          <CheckCircle2 className="w-3 h-3" />
          {text}
        </span>
      );
    }
    if (tone === 'lock') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold font-mono uppercase bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:bg-[#2E1459] dark:text-[#DAB9FF] dark:border-[#5B35B1]">
          <Lock className="w-3 h-3" />
          {text}
        </span>
      );
    }
    if (tone === 'write' || tone === 'audio') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold font-mono uppercase bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800">
          <Check className="w-3 h-3 stroke-[2.5]" />
          {text}
        </span>
      );
    }
    if (tone === 'sync') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold font-mono uppercase bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
          <RefreshCw className="w-3 h-3" />
          {text}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase bg-rose-50/70 text-rose-700 border border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900">
        <Lock className="w-2.5 h-2.5" />
        {text}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* ================================================================ */}
      {/* 1. RBAC STRATEGIC HEADER (STITCH TEMPLATE 4)                     */}
      {/* ================================================================ */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-b from-[#6657C8] to-[#5145A6] dark:from-[#7135B5] dark:to-[#58149C] text-white flex items-center justify-center font-bold shadow-[0_3px_0_#3E3484] dark:shadow-[0_3px_0_#35105E] shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-gradient-to-b from-[#881337] to-[#6B103B] dark:from-[#6b103b] dark:to-[#480123] text-white shadow-[0_1.5px_0_#4c0519] dark:shadow-[0_1.5px_0_#260112]">
                RBAC ENFORCEMENT ENGINE
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:bg-purple-900/60 dark:text-purple-200">
                4 Peran Resmi · 12 Tab Setup
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono tabular-nums font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                v{rolePermissionsVersion} · PostgreSQL DB-First
              </span>
              {lastVerifiedAt && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono text-[#2E7D8B] dark:text-[#DAB9FF] bg-[#DDF4F4] dark:bg-[#2E1459] border border-[#BDE4E8] dark:border-[#5B35B1]">
                  Terverifikasi {lastVerifiedAt}
                </span>
              )}
            </div>
            <h2 className="font-display text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white tracking-tight">
              Manajemen Role &amp; Matriks Hak Akses (RBAC)
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#CABDE8] mt-0.5 max-w-2xl">
              Pratinjau isolasi 12 tab Setup Terpusat per persona role, pengawasan guardrails, dan pengaturan {permissionsList.length} izin granular yang tersinkron real-time ke PostgreSQL.
            </p>
          </div>
        </div>

        {/* 3D Tactile Header Actions */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportRbacMatrix}
            className="mj-btn-superadmin-lilac px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
            <span>Ekspor Matriks Hak Akses</span>
          </button>

          <button
            type="button"
            disabled={isSyncingRbac}
            onClick={handleSyncAndVerifyRbac}
            className={`mj-btn-superadmin-primary px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold gap-2 cursor-pointer ${
              isSyncingRbac ? 'mj-btn-loading' : ''
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${isSyncingRbac ? 'animate-spin' : ''}`} />
            <span>{isSyncingRbac ? 'Memverifikasi DB...' : 'Validasi & Sync DB'}</span>
          </button>
        </div>
      </div>

      {/* Non-Super Admin Read-Only Lock Notice */}
      {!isSuperAdmin && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center gap-3 text-xs text-amber-800 dark:text-amber-200">
          <Lock className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            <strong>Mode Baca Saja:</strong> Hanya akun dengan role <strong>Super Admin</strong> yang berwenang mengubah matriks hak akses global (RBAC). Perubahan akan ditolak oleh server.
          </span>
        </div>
      )}

      {/* Database Error Notice */}
      {lastError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-200">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{lastError}</span>
          </div>
          <button
            type="button"
            onClick={() => setLastError(null)}
            className="text-[11px] font-bold underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* ================================================================ */}
      {/* 2. ROLE PERSONA SWITCHER & DUAL PARTITION WORKSPACE SHOWCASE     */}
      {/* ================================================================ */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-[#DDE6F0] dark:border-[#3b1d78]">
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF] flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" />
              <span>Simulasi Tampilan &amp; Isolasi Setup Terpusat Per Persona</span>
            </div>
            <h3 className="font-display text-sm sm:text-base font-extrabold text-[#26364A] dark:text-white mt-0.5">
              Inspector Ruang Kerja &amp; Guardrails RBAC
            </h3>
          </div>

          {/* Role Persona Segmented Ribbon */}
          <div className="mj-tactile-tab-bar p-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {([
              { id: 'super_admin', label: 'SUPERADMIN', count: '12 Tab' },
              { id: 'dispatch', label: 'DISPATCH', count: '4 Tab' },
              { id: 'leader', label: 'LEADER', count: '0 Tab' },
              { id: 'installer', label: 'INSTALLER', count: '0 Tab' }
            ] as { id: PersonaPreviewRole; label: string; count: string }[]).map(p => {
              const isActive = selectedPersona === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPersona(p.id)}
                  className={`px-3 py-1.5 min-h-[36px] rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
                    isActive
                      ? 'btn-3d-primary text-white'
                      : 'text-[#52647A] dark:text-[#CABDE8] hover:bg-white/75 dark:hover:bg-[#261942]'
                  }`}
                >
                  <span>{p.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9.5px] font-mono tabular-nums ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF]'
                    }`}
                  >
                    {p.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dual Partition Showcase */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT 5 COLS: Live Filtered Setup Navigation Preview */}
          <div className="lg:col-span-5 rounded-2xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#DDE6F0] dark:border-[#35105E]">
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                  Pratinjau Tree Navigasi Setup
                </div>
                <div className="font-display text-xs font-extrabold text-[#26364A] dark:text-white truncate">
                  {personaStats.activeRoleObj.label}
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-extrabold bg-white dark:bg-[#251245] text-[#5145A6] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1] shrink-0 tabular-nums">
                {personaStats.allowedSetupTabs.length}/12 Aktif
              </span>
            </div>

            <div className="space-y-3">
              {groupedSetupMatrix.map(group => (
                <div key={group.category} className="space-y-1.5">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0] px-1">
                    {group.category}
                  </div>
                  <div className="space-y-1">
                    {group.items.map(item => {
                      const ItemIcon = item.icon;
                      const isAllowed = item.allowedRoles.includes(selectedPersona);
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs transition-all ${
                            isAllowed
                              ? 'bg-white dark:bg-[#1E1238] border-[#C5BEEF] dark:border-[#5B35B1]/60 text-[#26364A] dark:text-white shadow-[0_1.5px_0_#DDE6F0] dark:shadow-none'
                              : 'bg-[#EDF3F8]/70 dark:bg-[#140827]/70 border-dashed border-[#DDE6F0] dark:border-[#35105E]/70 text-[#8492A5] dark:text-[#8A7EA6] opacity-75'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-[10px] font-bold text-[#8492A5] dark:text-[#A79BC0] shrink-0">
                              {item.num}
                            </span>
                            <ItemIcon
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isAllowed ? 'text-[#5145A6] dark:text-[#DAB9FF]' : 'text-[#8492A5]'
                              }`}
                            />
                            <span className={`truncate font-semibold ${isAllowed ? '' : 'line-through'}`}>
                              {item.label}
                            </span>
                          </div>
                          {isAllowed ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 shrink-0">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>IZIN</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-rose-100/80 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 shrink-0">
                              <Lock className="w-2.5 h-2.5" />
                              <span>RESTRICTED</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT 7 COLS: Guardrails Comparison + Live Persona Metrics */}
          <div className="lg:col-span-7 space-y-4">
            {/* Persona Snapshot Telemetry Card */}
            <div className="rounded-2xl bg-gradient-to-br from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#160D29] dark:via-[#160D29] dark:to-[#160D29] text-[#26364A] dark:text-white border border-[#C5BEEF] dark:border-[#35105E] p-4 sm:p-5 space-y-4 shadow-[0_4px_0_#C5BEEF] dark:shadow-[0_4px_0_#0e071d]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#C5BEEF]/70 dark:border-[#35105E]">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                    Profil Keamanan Persona Terpilih
                  </span>
                  <h4 className="font-display text-sm sm:text-base font-extrabold text-[#26364A] dark:text-white">
                    {personaStats.activeRoleObj.label}
                  </h4>
                </div>
                <span className="px-2.5 py-1 rounded-lg text-[10.5px] font-mono font-extrabold bg-white/85 dark:bg-[#35105E] border border-[#C5BEEF] dark:border-[#7135B5]/50 text-[#5145A6] dark:text-[#EEDBFF] self-start sm:self-auto">
                  {personaStats.staffCount} Akun Staf Terdaftar
                </span>
              </div>

              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                {personaStats.activeRoleObj.desc}
              </p>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl bg-white/80 dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="text-[10px] text-[#5145A6] dark:text-[#A78BFA] uppercase font-bold">Akses Tab Setup</div>
                  <div className="font-mono text-lg font-extrabold text-[#26364A] dark:text-white tabular-nums mt-0.5">
                    {personaStats.allowedSetupTabs.length} / 12
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-white/80 dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="text-[10px] text-[#2E7D8B] dark:text-[#A78BFA] uppercase font-bold">Izin Granular Aktif</div>
                  <div className="font-mono text-lg font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums mt-0.5">
                    {personaStats.granularPerms.length} / {permissionsList.length}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-white/80 dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="text-[10px] text-[#5145A6] dark:text-[#A78BFA] uppercase font-bold">Tab Terkunci</div>
                  <div className="font-mono text-lg font-extrabold text-rose-700 dark:text-rose-300 tabular-nums mt-0.5">
                    {personaStats.restrictedSetupTabs.length}
                  </div>
                </div>
              </div>
            </div>

            {/* Side-by-Side RBAC Guardrails Comparison Panel */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Superadmin System & Data Governance Card */}
              <div className="rounded-2xl bg-[#F4F7FB] dark:bg-[#1A1032] border border-[#DDE6F0] dark:border-[#3B1D78] p-4 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#EAE8FF] text-[#5145A6] dark:bg-purple-950/60 dark:text-purple-200">
                      SUPERADMIN · 12 TAB FULL
                    </span>
                    <Database className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                  </div>
                  <h5 className="font-display font-bold text-xs text-[#26364A] dark:text-white">
                    Kendali Penuh Data, Sistem &amp; Keamanan
                  </h5>
                  <p className="text-[11px] text-[#52647A] dark:text-[#CABDE8] leading-relaxed">
                    Pemegang otoritas penuh untuk <strong>Konfigurasi Sistem</strong>, <strong>Menu Navigasi ({(standaloneMenus?.length || 0) + (submenuItems?.length || 0)})</strong>, <strong>Kolom UI ({config.ticketsTable.columns.length})</strong>, <strong>Database &amp; Sync</strong>, <strong>Import/Hapus WO</strong>, <strong>Manajemen User &amp; RBAC</strong>, serta <strong>Audit Log &amp; System Health</strong>.
                  </p>
                </div>
                {onJumpSetupTab && (
                  <button
                    type="button"
                    onClick={() => onJumpSetupTab('ui_builder')}
                    className="mj-btn-superadmin-lilac px-3 py-1.5 rounded-lg text-[11px] font-bold gap-1.5 cursor-pointer self-start"
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" />
                    <span>Buka Kolom &amp; Tampilan UI</span>
                  </button>
                )}
              </div>

              {/* Dispatch Guardrail Card */}
              <div className="rounded-2xl bg-[#F4F7FB] dark:bg-[#1A1032] border border-[#DDE6F0] dark:border-[#3B1D78] p-4 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#DDF4F4] text-[#2E7D8B] dark:bg-indigo-950/60 dark:text-indigo-300">
                      DISPATCH · 4 TAB
                    </span>
                    <MessageSquare className="w-4 h-4 text-[#2E7D8B] dark:text-[#DAB9FF]" />
                  </div>
                  <h5 className="font-display font-bold text-xs text-[#26364A] dark:text-white">
                    Isolasi Operasional, WA &amp; Otomasi
                  </h5>
                  <p className="text-[11px] text-[#52647A] dark:text-[#CABDE8] leading-relaxed">
                    Akses fokus ke <strong>Kategori Report ({rootCauseCategories.length} taksonomi)</strong>, <strong>Template WhatsApp</strong>, <strong>Workflows &amp; Otomasi</strong>, dan <strong>Audio Notifikasi</strong>. Terkunci penuh dari Database, RBAC, dan Akun Staf.
                  </p>
                </div>
                {onJumpSetupTab && (
                  <button
                    type="button"
                    onClick={() => onJumpSetupTab('workflows')}
                    className="mj-btn-superadmin-lilac px-3 py-1.5 rounded-lg text-[11px] font-bold gap-1.5 cursor-pointer self-start"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>Buka Workflows &amp; Otomasi</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 3. MATRIKS PEMETAAN 12 TAB SETUP TERPUSAT (COMPARATIVE TABLE)    */}
      {/* ================================================================ */}
      <div className="card-3d-lavender rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#DDE6F0] dark:border-[#3b1d78] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
              Matriks Pemetaan 12 Tab Setup Terpusat MoraJaws
            </h3>
            <p className="text-[11px] text-[#52647A] dark:text-[#CABDE8]">
              Perbandingan otoritas modul Setup Hub antara Superadmin (12), Dispatch (4), serta Role Lapangan Leader &amp; Installer (0).
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1]">
            RBAC Guardrails Aktif
          </span>
        </div>

        {isCompactUI ? (
          <div className="p-3.5 space-y-2.5 bg-[#F4F7FB] dark:bg-[#140827]/60">
            {SETUP_TAB_MATRIX.map(row => {
              const RowIcon = row.icon;
              return (
                <div
                  key={row.id}
                  className="p-3.5 rounded-xl bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10px] font-bold text-[#8492A5] dark:text-[#A79BC0]">
                        {row.num}
                      </span>
                      <RowIcon className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                      <span className="text-xs font-extrabold text-[#26364A] dark:text-white truncate">
                        {row.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#8492A5] dark:text-[#CABDE8] shrink-0">
                      {row.category.split('·')[0]}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-[#E2E8F0] dark:border-[#35105E]/70 text-[10px]">
                    <div className="space-y-1">
                      <div className="text-[#8492A5] dark:text-[#A79BC0] font-semibold">Superadmin</div>
                      {renderScopePill(row.superadminScope.text, row.superadminScope.tone)}
                    </div>
                    <div className="space-y-1">
                      <div className="text-[#8492A5] dark:text-[#A79BC0] font-semibold">Dispatch</div>
                      {renderScopePill(row.dispatchScope.text, row.dispatchScope.tone)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#EDF3F8] dark:bg-[#251545] text-[10.5px] font-extrabold text-[#26364A] dark:text-[#DAB9FF] uppercase">
                <tr>
                  <th className="py-2.5 px-4">No &amp; Modul Setup</th>
                  <th className="py-2.5 px-3">Kategori</th>
                  <th className="py-2.5 px-3 text-center">Superadmin (12)</th>
                  <th className="py-2.5 px-3 text-center">Dispatch (4)</th>
                  <th className="py-2.5 px-3 text-center">Leader / Installer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#35105E]">
                {SETUP_TAB_MATRIX.map(row => {
                  const RowIcon = row.icon;
                  return (
                    <tr key={row.id} className="odd:bg-white even:bg-[#F8FAFD] dark:odd:bg-transparent dark:even:bg-transparent hover:bg-[#EDF3F8] dark:hover:bg-[#22123F]/60 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-[11px] font-bold text-[#8492A5] dark:text-[#A79BC0]">
                            {row.num}
                          </span>
                          <div className="p-1.5 rounded-lg bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF]">
                            <RowIcon className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-[#26364A] dark:text-white">{row.label}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-[#52647A] dark:text-[#CABDE8]">
                        {row.category}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {renderScopePill(row.superadminScope.text, row.superadminScope.tone)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {renderScopePill(row.dispatchScope.text, row.dispatchScope.tone)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {renderScopePill('BLOCKED', 'denied')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* 4. ROLE SUMMARY CARDS (4 PERAN RESMI)                            */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {roles.map(r => {
          const Icon = r.icon;
          const permsCount = Array.isArray(rolePermissions[r.role]) ? rolePermissions[r.role].length : 0;
          const roleUsersCount = userCountByRole[r.role] || 0;
          const isInspected = selectedPersona === r.role;
          return (
            <div
              key={r.role}
              className={`card-3d-lavender p-4 rounded-2xl space-y-2.5 text-xs flex flex-col justify-between transition-all ${
                isInspected ? 'ring-2 ring-[#6657C8] dark:ring-[#DAB9FF]' : ''
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`p-2 rounded-xl ${r.color} shrink-0`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <h4 className="font-display font-bold text-[#26364A] dark:text-white text-xs truncate">
                      {r.label}
                    </h4>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] shrink-0">
                    {roleUsersCount} User
                  </span>
                </div>
                <p className="text-[11px] text-[#52647A] dark:text-[#CABDE8] leading-relaxed">
                  {r.desc}
                </p>
              </div>
              <div className="pt-2.5 border-t border-[#DDE6F0] dark:border-[#3b1d78] text-[10.5px] font-mono tabular-nums text-[#8492A5] flex items-center justify-between gap-2">
                <span>
                  Total Izin: <strong className="text-[#26364A] dark:text-white">{permsCount}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedPersona(r.role)}
                  className="text-[10.5px] font-sans font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                >
                  {isInspected ? 'Sedang Diinspeksi ✓' : 'Inspeksi Scope →'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ================================================================ */}
      {/* 5. FULL INTERACTIVE 4-ROLE x 21-PERMISSION POSTGRESQL MATRIX     */}
      {/* ================================================================ */}
      <div className="card-3d-lavender rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#DDE6F0] dark:border-[#3b1d78] text-xs flex flex-wrap items-center justify-between gap-2">
          <span className="font-display font-bold text-[#26364A] dark:text-white">
            Matriks Hak Akses &amp; Permission Granular (21 Kemampuan × 4 Role)
          </span>
          <span className="text-[#5145A6] dark:text-[#DAB9FF] font-mono text-[11px] font-semibold">
            {isSuperAdmin ? 'Ketuk tombol 3D untuk menyimpan langsung ke Database' : 'Read-Only Backend Enforced'}
          </span>
        </div>

        {isCompactUI ? (
          <div className="p-3.5 space-y-3 bg-[#F4F7FB] dark:bg-[#140827]/60">
            {/* Role Selector Strip */}
            <div className="mj-tactile-tab-bar p-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {roles.map(r => {
                const active = selectedMobileRole === r.role;
                const count = Array.isArray(rolePermissions[r.role]) ? rolePermissions[r.role].length : 0;
                return (
                  <button
                    key={r.role}
                    type="button"
                    onClick={() => setSelectedMobileRole(r.role)}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
                      active
                        ? 'btn-3d-primary'
                        : 'text-[#52647A] dark:text-[#CABDE8] hover:bg-white/70 dark:hover:bg-[#261942]'
                    }`}
                  >
                    <span className="capitalize">{r.shortLabel}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
                        active ? 'bg-white/20 text-white' : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF]'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Granular Permission Cards for Selected Role */}
            <div className="space-y-2">
              {permissionsList.map(perm => {
                const perms = rolePermissions[selectedMobileRole];
                const has = Array.isArray(perms) ? perms.includes(perm.key) : false;
                const isCoreLocked =
                  selectedMobileRole === 'super_admin' && CORE_SUPER_ADMIN_PERMISSIONS.includes(perm.key);
                const cellId = `${selectedMobileRole}:${perm.key}`;
                const isSaving = savingCell === cellId;
                const canClick = isSuperAdmin && !isCoreLocked && !savingCell;

                return (
                  <div
                    key={perm.key}
                    className="p-3 rounded-xl bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[#26364A] dark:text-white leading-snug">
                        {perm.label}
                      </div>
                      <div className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] font-mono truncate mt-0.5">
                        {perm.key} · {perm.category}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!canClick}
                      onClick={() => handleTogglePermission(selectedMobileRole, perm.key)}
                      aria-label={`Toggle ${perm.key} untuk ${selectedMobileRole}`}
                      className={`min-w-[68px] min-h-[38px] px-2.5 rounded-xl border flex items-center justify-center gap-1 text-[11px] font-bold transition-all shrink-0 ${
                        isSaving
                          ? 'bg-[#EAE8FF] border-[#C5BEEF] text-[#5145A6] cursor-wait'
                          : isCoreLocked && has
                          ? 'bg-gradient-to-b from-[#6657C8] to-[#5145A6] dark:from-[#3f186d] dark:to-[#240c45] border-[#3E3484] dark:border-[#7135B5] text-white shadow-[0_2px_0_#3E3484] dark:shadow-[0_2px_0_#120624]'
                          : has
                          ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 border-emerald-700 text-white shadow-[0_2.5px_0_#047857]'
                          : 'bg-gradient-to-b from-white to-[#EDF3F8] dark:from-[#261942] dark:to-[#180E2E] border-[#DDE6F0] dark:border-[#3B1D78] text-[#8492A5] dark:text-[#A79BC0] shadow-[0_2px_0_#DDE6F0] dark:shadow-[0_2px_0_#100520]'
                      } ${canClick ? 'cursor-pointer active:translate-y-[1.5px]' : 'opacity-80 cursor-not-allowed'}`}
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : has ? (
                        isCoreLocked ? (
                          <>
                            <Lock className="w-3.5 h-3.5" />
                            <span>Kunci</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>Aktif</span>
                          </>
                        )
                      ) : (
                        <>
                          <X className="w-3.5 h-3.5" />
                          <span>Off</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#EDF3F8] dark:bg-[#251545] text-[11px] font-bold text-[#26364A] dark:text-[#DAB9FF] uppercase">
                <tr>
                  <th className="py-2.5 px-4 min-w-[240px]">Kemampuan / Permission</th>
                  <th className="py-2.5 px-3 text-center">Super Admin</th>
                  <th className="py-2.5 px-3 text-center">Dispatch</th>
                  <th className="py-2.5 px-3 text-center">Leader</th>
                  <th className="py-2.5 px-3 text-center">Installer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#35105E]">
                {permissionsList.map(perm => (
                  <tr key={perm.key} className="odd:bg-white even:bg-[#F8FAFD] dark:odd:bg-transparent dark:even:bg-transparent hover:bg-[#EDF3F8] dark:hover:bg-[#22123F]/50 transition-colors">
                    <td className="py-2.5 px-4">
                      <div className="font-bold text-[#26364A] dark:text-slate-100">{perm.label}</div>
                      <div className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] font-mono">
                        {perm.key} ({perm.category})
                      </div>
                    </td>
                    {roles.map(r => {
                      const perms = rolePermissions[r.role];
                      const has = Array.isArray(perms) ? perms.includes(perm.key) : false;
                      const isCoreLocked = r.role === 'super_admin' && CORE_SUPER_ADMIN_PERMISSIONS.includes(perm.key);
                      const cellId = `${r.role}:${perm.key}`;
                      const isSaving = savingCell === cellId;
                      const canClick = isSuperAdmin && !isCoreLocked && !savingCell;

                      return (
                        <td key={r.role} className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            disabled={!canClick}
                            onClick={() => handleTogglePermission(r.role, perm.key)}
                            title={
                              isCoreLocked
                                ? 'Izin inti Super Admin terkunci untuk keamanan sistem'
                                : !isSuperAdmin
                                ? 'Hanya Super Admin yang dapat mengubah hak akses'
                                : has
                                ? `Cabut izin ${perm.key} dari ${r.role}`
                                : `Berikan izin ${perm.key} ke ${r.role}`
                            }
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border transition-all ${
                              isSaving
                                ? 'bg-[#EAE8FF] border-[#C5BEEF] text-[#5145A6] cursor-wait'
                                : isCoreLocked && has
                                ? 'bg-gradient-to-b from-[#6657C8] to-[#5145A6] dark:from-[#3f186d] dark:to-[#240c45] border-[#3E3484] dark:border-[#7135B5] text-white shadow-[0_2px_0_#3E3484] dark:shadow-[0_2px_0_#120624]'
                                : has
                                ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 border-emerald-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2.5px_0_#047857]'
                                : 'bg-gradient-to-b from-white to-[#EDF3F8] dark:from-[#261942] dark:to-[#180E2E] border-[#DDE6F0] dark:border-[#3B1D78] text-[#8492A5] dark:text-[#8A7EA6] shadow-[0_2px_0_#DDE6F0] dark:shadow-[0_2px_0_#100520]'
                            } ${canClick ? 'hover:-translate-y-0.5 active:translate-y-[1.5px] cursor-pointer' : 'opacity-85 cursor-not-allowed'}`}
                          >
                            {isSaving ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : has ? (
                              isCoreLocked ? <Lock className="w-3.5 h-3.5" /> : <Check className="w-4 h-4 stroke-[3]" />
                            ) : (
                              <X className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
