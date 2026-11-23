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
          className="btn-3d-lilac px-4 py-2 min-h-[40px] rounded-xl font-bold text-xs cursor-pointer"
        >
          Tutup
        </button>
      }
    >
      <div className="space-y-4 text-xs">
        {/* Tab Selector */}
        <div className="mj-tactile-tab-bar p-1 rounded-xl flex items-center gap-1.5 text-xs font-semibold overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('monitoring')}
            className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'monitoring'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] hover:text-[#26364A] dark:text-[#CEC0E8] dark:hover:text-white'
            }`}
          >
            Monitoring Sesi Aktif ({sessions.filter(s => s.status === 'active').length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'config'
                ? 'btn-3d-primary text-white font-bold'
                : 'text-[#52647A] hover:text-[#26364A] dark:text-[#CEC0E8] dark:hover:text-white'
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
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8492A5] dark:text-[#A78BFA]" />
                <input
                  type="text"
                  placeholder="Cari nama staf atau username..."
                  value={searchUser}
                  onChange={e => setSearchUser(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 min-h-[38px] tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white rounded-xl focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as any)}
                  className="flex-1 sm:flex-none py-1.5 px-3 min-h-[38px] tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl text-[#26364A] dark:text-[#D8B4FE] font-semibold focus:outline-none"
                >
                  <option value="ALL">Semua Sesi</option>
                  <option value="active">Aktif Saja</option>
                  <option value="expired">Kedaluwarsa</option>
                  <option value="revoked">Dicabut</option>
                </select>
                <button
                  type="button"
                  onClick={fetchSessionsAndConfig}
                  className="btn-3d-icon min-w-[38px] min-h-[38px] cursor-pointer"
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
              mobileTitle={s => <span className="font-bold text-[#26364A] dark:text-white">{s.name}</span>}
              mobileSubtitle={s => (
                <span className="font-mono capitalize text-[#8492A5] dark:text-[#D8B4FE]">
                  @{s.username} · {s.role.replace('_', ' ')}
                </span>
              )}
              mobileStatus={s => (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    s.status === 'active'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                      : s.status === 'expired'
                      ? 'bg-[#EDF3F8] text-[#52647A] dark:bg-[#2E1859] dark:text-[#CEC0E8]'
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
                      <div className="font-bold text-[#26364A] dark:text-white">{s.name}</div>
                      <div className="text-[11px] text-[#8492A5] dark:text-[#D8B4FE]/75 font-mono">
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
                    <span className="text-[#52647A] dark:text-[#CEC0E8] font-mono tabular-nums whitespace-nowrap text-[11px]">
                      {new Date(s.loginAt).toLocaleTimeString('id-ID')} WIB
                    </span>
                  )
                },
                {
                  key: 'lastActivityAt',
                  label: 'Aktivitas Terakhir',
                  priority: 'secondary',
                  render: s => (
                    <span className="text-[#52647A] dark:text-[#CEC0E8] font-mono tabular-nums whitespace-nowrap text-[11px]">
                      {new Date(s.lastActivityAt).toLocaleTimeString('id-ID')} WIB
                    </span>
                  )
                },
                {
                  key: 'expiresAt',
                  label: 'Kedaluwarsa',
                  priority: 'secondary',
                  render: s => (
                    <span className="text-[#52647A] dark:text-[#CEC0E8] font-mono tabular-nums whitespace-nowrap text-[11px]">
                      {new Date(s.expiresAt).toLocaleTimeString('id-ID')} WIB
                    </span>
                  )
                },
                {
                  key: 'device',
                  label: 'Perangkat',
                  priority: 'primary',
                  render: s => (
                    <div className="flex items-center gap-1.5 text-[#52647A] dark:text-[#CEC0E8] font-mono text-[11px]">
                      {s.deviceType === 'mobile' ? <Smartphone className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" /> : <Laptop className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />}
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
                          ? 'bg-[#EDF3F8] text-[#52647A] dark:bg-[#2E1859] dark:text-[#CEC0E8]'
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
                    className="btn-3d-crimson px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer"
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

            <div className="p-4 mj-tactile-well border border-[#DDE6F0] dark:border-[#35105E] rounded-2xl space-y-3">
              <h5 className="font-display font-bold text-[#26364A] dark:text-white text-xs">
                Kebijakan Waktu Sesi (Duration &amp; Timeout)
              </h5>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1">Durasi Maksimum Sesi (Jam):</label>
                  <input
                    type="number"
                    min={1}
                    max={72}
                    disabled={!isSuperAdmin || isSavingConfig}
                    value={sessionConfig.sessionMaxDurationHours}
                    onChange={e => setSessionConfig({ ...sessionConfig, sessionMaxDurationHours: parseInt(e.target.value) || 8 })}
                    className="w-full px-3 py-1.5 min-h-[38px] tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#26364A] dark:text-white rounded-xl text-xs font-mono tabular-nums disabled:opacity-60 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1">Batas Waktu Tidak Aktif / Idle (Menit):</label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    disabled={!isSuperAdmin || isSavingConfig}
                    value={sessionConfig.idleTimeoutMinutes}
                    onChange={e => setSessionConfig({ ...sessionConfig, idleTimeoutMinutes: parseInt(e.target.value) || 60 })}
                    className="w-full px-3 py-1.5 min-h-[38px] tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#26364A] dark:text-white rounded-xl text-xs font-mono tabular-nums disabled:opacity-60 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1">Batas Maksimum Sesi Bersamaan per Akun:</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  disabled={!isSuperAdmin || isSavingConfig}
                  value={sessionConfig.maxActiveSessionsPerUser}
                  onChange={e => setSessionConfig({ ...sessionConfig, maxActiveSessionsPerUser: parseInt(e.target.value) || 3 })}
                  className="w-full px-3 py-1.5 min-h-[38px] tactile-debossed-input bg-white dark:bg-[#1E1238] text-[#26364A] dark:text-white rounded-xl text-xs font-mono tabular-nums disabled:opacity-60 focus:outline-none"
                />
              </div>
            </div>

            <div className="p-4 mj-tactile-well border border-[#DDE6F0] dark:border-[#35105E] rounded-2xl space-y-2.5">
              <h5 className="font-display font-bold text-[#26364A] dark:text-white text-xs">
                Otomatisasi Pembatalan Sesi
              </h5>

              <label className={`flex items-center gap-2 text-xs min-h-[32px] text-[#52647A] dark:text-[#CEC0E8] ${isSuperAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin || isSavingConfig}
                  checked={sessionConfig.extendOnActivity}
                  onChange={e => setSessionConfig({ ...sessionConfig, extendOnActivity: e.target.checked })}
                  className="rounded accent-[#5145A6] dark:accent-[#7135B5] text-[#5145A6] focus:ring-[#6657C8]"
                />
                <span>Perpanjang sesi otomatis saat pengguna aktif mengerjakan tiket</span>
              </label>

              <label className={`flex items-center gap-2 text-xs min-h-[32px] text-[#52647A] dark:text-[#CEC0E8] ${isSuperAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin || isSavingConfig}
                  checked={sessionConfig.revokeOnDeactivate}
                  onChange={e => setSessionConfig({ ...sessionConfig, revokeOnDeactivate: e.target.checked })}
                  className="rounded accent-[#5145A6] dark:accent-[#7135B5] text-[#5145A6] focus:ring-[#6657C8]"
                />
                <span>Cabut seluruh sesi aktif saat akun dinonaktifkan oleh administrator</span>
              </label>

              <label className={`flex items-center gap-2 text-xs min-h-[32px] text-[#52647A] dark:text-[#CEC0E8] ${isSuperAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin || isSavingConfig}
                  checked={sessionConfig.revokeOnPasswordChange}
                  onChange={e => setSessionConfig({ ...sessionConfig, revokeOnPasswordChange: e.target.checked })}
                  className="rounded accent-[#5145A6] dark:accent-[#7135B5] text-[#5145A6] focus:ring-[#6657C8]"
                />
                <span>Cabut seluruh sesi aktif saat kata sandi akun diubah</span>
              </label>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={!isSuperAdmin || isSavingConfig}
                className="btn-3d-primary px-5 py-2.5 min-h-[40px] rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
