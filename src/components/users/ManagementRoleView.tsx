import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
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
  AlertTriangle
} from 'lucide-react';

const CORE_SUPER_ADMIN_PERMISSIONS: Permission[] = [
  'login',
  'manage_users',
  'ui_configuration',
  'application_configuration',
  'view_audit_logs',
  'system_health'
];

export const ManagementRoleView: React.FC = () => {
  const {
    currentUser,
    rolePermissions,
    rolePermissionsVersion,
    updateRolePermissions
  } = useApp();

  const isSuperAdmin = currentUser.role === 'super_admin';
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const roles: { role: UserRole; label: string; desc: string; icon: any; color: string }[] = [
    {
      role: 'super_admin',
      label: 'Super Admin (Super Agent)',
      desc: 'Pemegang kendali konfigurasi global aplikasi, manajemen RBAC, manajemen akun, Google Sheets, dan supervisi operasional.',
      icon: ShieldCheck,
      color: 'text-purple-600 bg-purple-100 dark:bg-purple-950/60'
    },
    {
      role: 'dispatch',
      label: 'Dispatch Management',
      desc: 'Monitoring sentral seluruh WO, import data, penutupan (close) tiket, live chat, dan penugasan koordinator.',
      icon: Shield,
      color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-950/60'
    },
    {
      role: 'leader',
      label: 'Leader / Korlap Lapangan',
      desc: 'Pengawasan wilayah & kontraktor terikat, assign WO ke teknisi, reassign WO, pendaftaran akun teknisi tim.',
      icon: Building2,
      color: 'text-amber-600 bg-amber-100 dark:bg-amber-950/60'
    },
    {
      role: 'installer',
      label: 'Installer / Teknisi Lapangan',
      desc: 'Hanya melihat WO yang ditugaskan ke akunnya, formulir laporan teknis OPM, upload foto, dan chat.',
      icon: Wrench,
      color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/60'
    },
    {
      role: 'management_data',
      label: 'Monitoring Data (Management Data)',
      desc: 'Validasi integritas data WO, pemeriksaan Customer ID 7-digit, duplicate checker, dan pemantauan sinkronisasi.',
      icon: Database,
      color: 'text-blue-600 bg-blue-100 dark:bg-blue-950/60'
    },
    {
      role: 'it_support',
      label: 'IT Support Application',
      desc: 'Pemantauan System Health & Audit Log (Read-Only). Pengubahan konfigurasi global aplikasi dikunci eksklusif untuk Super Admin.',
      icon: Sliders,
      color: 'text-teal-600 bg-teal-100 dark:bg-teal-950/60'
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
    { key: 'view_audit_logs', label: 'Melihat Audit Log & History (Read-Only IT Support)', category: 'Keamanan' },
    { key: 'delete_wo_data', label: 'Menghapus Data Work Order (Eksklusif Management Data)', category: 'Keamanan' },
    { key: 'manage_whatsapp_templates', label: 'Kelola Template WhatsApp (Super Admin & Dispatch)', category: 'Komunikasi' },
    { key: 'ui_configuration', label: 'Konfigurasi Layout & UI Builder', category: 'Teknis & Sistem' },
    { key: 'application_configuration', label: 'Konfigurasi Global Aplikasi & Menu', category: 'Teknis & Sistem' },
    { key: 'system_health', label: 'Monitoring System Health & Diagnostik', category: 'Teknis & Sistem' },
    { key: 'setting_droplist', label: 'Mengatur Droplist Kamus Pilihan', category: 'Teknis & Sistem' }
  ];

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#D8CCF3] dark:border-purple-900/60 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#5B35B1] text-white flex items-center justify-center font-bold shadow-xs">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#3B1D78] dark:text-purple-200 flex flex-wrap items-center gap-2">
              <span>Manajemen Role & Matriks Hak Akses (RBAC)</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E9E1FF] text-[#3B1D78] dark:bg-purple-900/60 dark:text-purple-200">
                6 Peran Resmi
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono tabular-nums font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                v{rolePermissionsVersion} • DB-First
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Setiap perubahan permission oleh Super Admin langsung disimpan ke PostgreSQL dan disinkronkan secara real-time ke semua sesi pengguna aktif.
            </p>
          </div>
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

      {/* Role Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {roles.map(r => {
          const Icon = r.icon;
          const permsCount = Array.isArray(rolePermissions[r.role]) ? rolePermissions[r.role].length : 0;
          return (
            <div
              key={r.role}
              className="p-4 bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#D8CCF3] dark:border-purple-900/60 space-y-2 text-xs flex flex-col justify-between shadow-2xs"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-xl ${r.color} shrink-0`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs">{r.label}</h4>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {r.desc}
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-purple-900/40 text-[10.5px] font-mono tabular-nums text-slate-400 flex items-center justify-between">
                <span>Total Izin: {permsCount}</span>
                <span className="capitalize text-[#5B35B1] dark:text-purple-300 font-semibold">{r.role}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Full Permission Matrix Table */}
      <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#D8CCF3] dark:border-purple-900/60 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-purple-900/50 text-xs flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-slate-800 dark:text-slate-200">
            Matriks Hak Akses & Permission Granular
          </span>
          <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
            {isSuperAdmin ? 'Klik badge izin untuk menyimpan langsung ke Database' : 'Read-Only Backend Enforced'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#F5F1FF] dark:bg-[#251545] text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
              <tr>
                <th className="py-2.5 px-3 min-w-[230px]">Kemampuan / Permission</th>
                <th className="py-2.5 px-3 text-center">Super Admin</th>
                <th className="py-2.5 px-3 text-center">Dispatch</th>
                <th className="py-2.5 px-3 text-center">Leader</th>
                <th className="py-2.5 px-3 text-center">Installer</th>
                <th className="py-2.5 px-3 text-center">Management Data</th>
                <th className="py-2.5 px-3 text-center">IT Support</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {permissionsList.map(perm => (
                <tr key={perm.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3">
                    <div className="font-bold text-slate-800 dark:text-slate-200">{perm.label}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{perm.key} ({perm.category})</div>
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
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-full border transition-all ${
                            isSaving
                              ? 'bg-purple-100 border-purple-300 text-purple-700 cursor-wait'
                              : has
                              ? 'bg-emerald-100 border-emerald-300 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300'
                              : 'bg-slate-100 border-slate-200 text-slate-400 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-500'
                          } ${canClick ? 'hover:scale-110 cursor-pointer' : 'opacity-80 cursor-not-allowed'}`}
                        >
                          {isSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : has ? (
                            isCoreLocked ? <Lock className="w-3 h-3" /> : <Check className="w-3.5 h-3.5 stroke-[3]" />
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
      </div>
    </div>
  );
};
