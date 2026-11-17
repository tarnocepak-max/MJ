import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { SessionMetadata, SessionConfig } from '../../types/index.ts';
import {
  ShieldAlert,
  Clock,
  Laptop,
  Smartphone,
  LogOut,
  RotateCw,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Search,
  Users
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { getAuthHeaders } from '../../services/authService';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';

interface SessionManagementModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const SessionManagementModal: React.FC<SessionManagementModalProps> = ({ isOpen: propIsOpen, onClose: propOnClose }) => {
  const { currentUser, isSessionModalOpen, setIsSessionModalOpen } = useApp();
  const { toast } = useToast();

  const isOpen = propIsOpen !== undefined ? propIsOpen : isSessionModalOpen;
  const onClose = propOnClose || (() => setIsSessionModalOpen(false));
  const isSuperAdmin = currentUser?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState<'monitoring' | 'config'>('monitoring');
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({
    sessionMaxDurationHours: 8,
    idleTimeoutMinutes: 60,
    extendOnActivity: true,
    maxActiveSessionsPerUser: 3,
    revokePreviousOnLogin: false,
    revokeOnDeactivate: true,
    revokeOnPasswordChange: true
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [searchUser, setSearchUser] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'expired' | 'revoked'>('ALL');

  const fetchSessionsAndConfig = async () => {
    setIsLoading(true);
    try {
      const authHdrs = getAuthHeaders();
      const [sessRes, cfgRes] = await Promise.all([
        fetch('/api/sessions', {
          headers: {
            ...authHdrs,
            'x-user-role': currentUser.role,
            'x-user-id': currentUser.id
          }
        }),
        fetch('/api/sessions/config', {
          headers: {
            ...authHdrs,
            'x-user-role': currentUser.role,
            'x-user-id': currentUser.id
          }
        })
      ]);

      if (sessRes.ok) {
        const sData = await sessRes.json();
        setSessions(sData.sessions || []);
      }
      if (cfgRes.ok) {
        const cData = await cfgRes.json();
        if (cData.config) setSessionConfig(cData.config);
      }
    } catch (err) {
      console.warn('Could not fetch sessions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSessionsAndConfig();
    }
  }, [isOpen]);

  const handleRevokeSession = async (sessionId: string, username: string) => {
    try {
      const res = await fetch('/api/sessions/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          'x-user-role': currentUser.role,
          'x-user-id': currentUser.id
        },
        body: JSON.stringify({ sessionId, reason: `Dicabut oleh Administrator ${currentUser.name}` })
      });
      if (res.ok) {
        toast.success(`Sesi untuk ${username} berhasil dicabut.`, 'Sesi Dicabut');
        fetchSessionsAndConfig();
      } else {
        const d = await res.json();
        toast.error(d.error || 'Gagal mencabut sesi', 'Error');
      }
    } catch {
      toast.error('Gagal mencabut sesi.', 'Error');
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      toast.error('Akses Ditolak: Hanya Super Admin yang dapat mengubah kebijakan sesi global.', 'Akses Ditolak');
      return;
    }
    setIsSavingConfig(true);
    try {
      const res = await fetch('/api/sessions/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          'x-user-role': currentUser.role,
          'x-user-id': currentUser.id
        },
        body: JSON.stringify(sessionConfig)
      });
      if (res.ok) {
        toast.success('Kebijakan sesi berhasil disimpan ke database.', 'Konfigurasi Sesi Tersimpan');
      } else {
        const d = await res.json();
        toast.error(d.error || 'Gagal menyimpan konfigurasi sesi', 'Error');
      }
    } catch {
      toast.error('Gagal menghubungi backend.', 'Error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  if (!isOpen) return null;

  const filteredSessions = sessions.filter(s => {
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
    if (searchUser) {
      const q = searchUser.toLowerCase();
      return (
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.username || '').toLowerCase().includes(q) ||
        String(s.role || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Manajemen Sesi Login Staf (Session Management)"
      subtitle="Kelola masa berlaku sesi, timeout aktivitas, dan pantau sesi aktif staf Dispatch, Leader, dan Installer."
      icon={<ShieldAlert className="w-5 h-5" />}
      size="xl"
      mobileVariant="fullscreen"
      zIndexClass="z-60"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 min-h-[40px] bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-xl font-semibold text-xs cursor-pointer"
        >
          Tutup
        </button>
      }
    >
      <div className="space-y-4 text-xs">
        {/* Tab Selector */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('monitoring')}
            className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'monitoring'
                ? 'border-[#5B35B1] text-[#5B35B1] dark:text-[#E9E1FF] font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Monitoring Sesi Aktif ({sessions.filter(s => s.status === 'active').length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'config'
                ? 'border-[#5B35B1] text-[#5B35B1] dark:text-[#E9E1FF] font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Pengaturan Kebijakan Sesi
          </button>
        </div>

        {/* Body Content */}
        {activeTab === 'monitoring' && (
          <div className="space-y-3">
            {/* Search & Status Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="relative flex-1 sm:max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari nama staf atau username..."
                  value={searchUser}
                  onChange={e => setSearchUser(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 min-h-[38px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as any)}
                  className="flex-1 sm:flex-none py-1.5 px-3 min-h-[38px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 font-medium"
                >
                  <option value="ALL">Semua Sesi</option>
                  <option value="active">Aktif Saja</option>
                  <option value="expired">Kedaluwarsa</option>
                  <option value="revoked">Dicabut</option>
                </select>
                <button
                  type="button"
                  onClick={fetchSessionsAndConfig}
                  className="min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 cursor-pointer"
                  title="Refresh"
                >
                  <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <ResponsiveDataTable<SessionMetadata>
              data={filteredSessions}
              getRowKey={s => s.sessionId}
              isLoading={isLoading}
              emptyState={{
                icon: <Users className="w-7 h-7" />,
                title: 'Tidak ada sesi staf ditemukan',
                description: 'Belum ada sesi staf yang cocok dengan pencarian atau filter status saat ini.'
              }}
              mobileTitle={s => <span className="font-bold text-slate-900 dark:text-white">{s.name}</span>}
              mobileSubtitle={s => (
                <span className="font-mono capitalize">
                  @{s.username} · {s.role.replace('_', ' ')}
                </span>
              )}
              mobileStatus={s => (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    s.status === 'active'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                      : s.status === 'expired'
                      ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                  }`}
                >
                  {s.status === 'active' ? 'Aktif' : s.status === 'expired' ? 'Kedaluwarsa' : 'Dicabut'}
                </span>
              )}
              columns={[
                {
                  key: 'user',
                  label: 'Pengguna & Peran',
                  priority: 'hidden_mobile',
                  render: s => (
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        @{s.username} · <span className="capitalize">{s.role.replace('_', ' ')}</span>
                      </div>
                    </div>
                  )
                },
                {
                  key: 'loginAt',
                  label: 'Waktu Login',
                  priority: 'primary',
                  render: s => (
                    <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap text-[11px]">
                      {new Date(s.loginAt).toLocaleTimeString('id-ID')} WIB
                    </span>
                  )
                },
                {
                  key: 'lastActivityAt',
                  label: 'Aktivitas Terakhir',
                  priority: 'secondary',
                  render: s => (
                    <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap text-[11px]">
                      {new Date(s.lastActivityAt).toLocaleTimeString('id-ID')} WIB
                    </span>
                  )
                },
                {
                  key: 'expiresAt',
                  label: 'Kedaluwarsa',
                  priority: 'secondary',
                  render: s => (
                    <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap text-[11px]">
                      {new Date(s.expiresAt).toLocaleTimeString('id-ID')} WIB
                    </span>
                  )
                },
                {
                  key: 'device',
                  label: 'Perangkat',
                  priority: 'primary',
                  render: s => (
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 text-[11px]">
                      {s.deviceType === 'mobile' ? <Smartphone className="w-3.5 h-3.5" /> : <Laptop className="w-3.5 h-3.5" />}
                      <span>{s.ipAddress || '127.0.0.1'}</span>
                    </div>
                  )
                },
                {
                  key: 'status',
                  label: 'Status',
                  priority: 'hidden_mobile',
                  render: s => (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        s.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                          : s.status === 'expired'
                          ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                      }`}
                    >
                      {s.status === 'active' ? 'Aktif' : s.status === 'expired' ? 'Kedaluwarsa' : 'Dicabut'}
                    </span>
                  )
                }
              ] satisfies ResponsiveColumn<SessionMetadata>[]}
              desktopActionHeader="Tindakan"
              getRowActions={s =>
                s.status === 'active'
                  ? [
                      {
                        id: 'revoke',
                        label: 'Cabut Sesi',
                        icon: <LogOut className="w-3.5 h-3.5" />,
                        onClick: () => handleRevokeSession(s.sessionId, s.name),
                        variant: 'danger' as const
                      }
                    ]
                  : []
              }
              renderDesktopActions={s =>
                s.status === 'active' ? (
                  <button
                    type="button"
                    onClick={() => handleRevokeSession(s.sessionId, s.name)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                  >
                    Cabut Sesi
                  </button>
                ) : null
              }
            />
          </div>
        )}

        {activeTab === 'config' && (
          <form onSubmit={handleSaveConfig} className="space-y-4 max-w-xl">
            {!isSuperAdmin && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Mode Hanya-Baca: Hanya <strong>Super Admin</strong> yang dapat mengubah kebijakan sesi global aplikasi.</span>
              </div>
            )}

            <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <h5 className="font-bold text-slate-900 dark:text-white text-xs">
                Kebijakan Waktu Sesi (Duration & Timeout)
              </h5>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Durasi Maksimum Sesi (Jam):</label>
                  <input
                    type="number"
                    min={1}
                    max={72}
                    disabled={!isSuperAdmin || isSavingConfig}
                    value={sessionConfig.sessionMaxDurationHours}
                    onChange={e => setSessionConfig({ ...sessionConfig, sessionMaxDurationHours: parseInt(e.target.value) || 8 })}
                    className="w-full px-3 py-1.5 min-h-[38px] bg-white dark:bg-slate-800 border rounded-lg text-xs disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Batas Waktu Tidak Aktif / Idle (Menit):</label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    disabled={!isSuperAdmin || isSavingConfig}
                    value={sessionConfig.idleTimeoutMinutes}
                    onChange={e => setSessionConfig({ ...sessionConfig, idleTimeoutMinutes: parseInt(e.target.value) || 60 })}
                    className="w-full px-3 py-1.5 min-h-[38px] bg-white dark:bg-slate-800 border rounded-lg text-xs disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Batas Maksimum Sesi Bersamaan per Akun:</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  disabled={!isSuperAdmin || isSavingConfig}
                  value={sessionConfig.maxActiveSessionsPerUser}
                  onChange={e => setSessionConfig({ ...sessionConfig, maxActiveSessionsPerUser: parseInt(e.target.value) || 3 })}
                  className="w-full px-3 py-1.5 min-h-[38px] bg-white dark:bg-slate-800 border rounded-lg text-xs disabled:opacity-60"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
              <h5 className="font-bold text-slate-900 dark:text-white text-xs">
                Otomatisasi Pembatalan Sesi
              </h5>

              <label className={`flex items-center gap-2 text-xs min-h-[32px] ${isSuperAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin || isSavingConfig}
                  checked={sessionConfig.extendOnActivity}
                  onChange={e => setSessionConfig({ ...sessionConfig, extendOnActivity: e.target.checked })}
                  className="rounded text-[#5B35B1]"
                />
                <span>Perpanjang sesi otomatis saat pengguna aktif mengerjakan tiket</span>
              </label>

              <label className={`flex items-center gap-2 text-xs min-h-[32px] ${isSuperAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin || isSavingConfig}
                  checked={sessionConfig.revokeOnDeactivate}
                  onChange={e => setSessionConfig({ ...sessionConfig, revokeOnDeactivate: e.target.checked })}
                  className="rounded text-[#5B35B1]"
                />
                <span>Cabut seluruh sesi aktif saat akun dinonaktifkan oleh administrator</span>
              </label>

              <label className={`flex items-center gap-2 text-xs min-h-[32px] ${isSuperAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin || isSavingConfig}
                  checked={sessionConfig.revokeOnPasswordChange}
                  onChange={e => setSessionConfig({ ...sessionConfig, revokeOnPasswordChange: e.target.checked })}
                  className="rounded text-[#5B35B1]"
                />
                <span>Cabut seluruh sesi aktif saat kata sandi akun diubah</span>
              </label>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={!isSuperAdmin || isSavingConfig}
                className="px-5 py-2.5 min-h-[40px] bg-[#5B35B1] hover:bg-[#3B1D78] text-white rounded-xl font-bold text-xs shadow-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingConfig ? 'Menyimpan...' : 'Simpan Kebijakan Sesi'}
              </button>
            </div>
          </form>
        )}
      </div>
    </ResponsiveModal>
  );
};
