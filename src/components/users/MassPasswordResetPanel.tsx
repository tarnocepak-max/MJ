import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Play,
  RefreshCw,
  XCircle,
  RotateCcw,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  Users,
  KeyRound,
  Ban
} from 'lucide-react';
import type { User, UserRole } from '../../types/index.ts';
import {
  adminCreateMassResetJob,
  adminListMassResetJobs,
  adminGetMassResetJob,
  adminRetryMassResetJob,
  adminCancelMassResetJob,
  adminRollbackMassResetJob,
  adminDownloadMassResetReport,
  type MassResetJob,
  type MassResetMode
} from '../../services/authService';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { useToast } from '../../context/ToastContext';

interface MassPasswordResetPanelProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  currentUser: User;
  onCompleted?: () => Promise<void> | void;
}

export const MassPasswordResetPanel: React.FC<MassPasswordResetPanelProps> = ({
  isOpen,
  onClose,
  users,
  currentUser,
  onCompleted
}) => {
  const { toast } = useToast();
  const [targetScope, setTargetScope] = useState<'all_active' | 'by_role' | 'selected_users'>('all_active');
  const [roleFilter, setRoleFilter] = useState<UserRole>('installer');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [resetMode, setResetMode] = useState<MassResetMode>('force_change_with_token');
  const [excludeSelf, setExcludeSelf] = useState(true);
  const [invalidateSessions, setInvalidateSessions] = useState(true);
  const [tokenTtlHours, setTokenTtlHours] = useState(24);
  const [batchSize, setBatchSize] = useState(10);
  const [reason, setReason] = useState('Rotasi Keamanan Sandi Berkala Seluruh Staf MoraJaws');
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<MassResetJob[]>([]);
  const [activeJob, setActiveJob] = useState<MassResetJob | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const eligibleUsers = users.filter(u => !u.isDeleted && u.active && (!excludeSelf || u.id !== currentUser.id));

  const targetCountPreview =
    targetScope === 'all_active'
      ? eligibleUsers.length
      : targetScope === 'by_role'
      ? eligibleUsers.filter(u => u.role === roleFilter).length
      : selectedUserIds.filter(id => eligibleUsers.some(u => u.id === id)).length;

  const loadJobs = async () => {
    setLoadingJobs(true);
    try {
      const res = await adminListMassResetJobs();
      if (res.ok && Array.isArray(res.data?.jobs)) {
        setJobs(res.data.jobs);
        if (!activeJob && res.data.jobs.length > 0) {
          const detail = await adminGetMassResetJob(res.data.jobs[0].id);
          if (detail.ok && detail.data?.job) {
            setActiveJob(detail.data.job);
          }
        }
      }
    } finally {
      setLoadingJobs(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadJobs();
    }
  }, [isOpen]);

  // Poll active job progress while queued or running
  useEffect(() => {
    if (!isOpen || !activeJob) return;
    if (activeJob.status !== 'queued' && activeJob.status !== 'running') return;

    const timer = window.setInterval(async () => {
      const res = await adminGetMassResetJob(activeJob.id);
      if (res.ok && res.data?.job) {
        setActiveJob(res.data.job);
        if (res.data.job.status !== 'queued' && res.data.job.status !== 'running') {
          void loadJobs();
          void onCompleted?.();
        }
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [isOpen, activeJob?.id, activeJob?.status]);

  const handleToggleUser = (id: string) => {
    setSelectedUserIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleStartMassReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmChecked) {
      toast.warning('Centang konfirmasi eksekusi batch sebelum memulai.', 'Konfirmasi Diperlukan');
      return;
    }
    if (targetCountPreview === 0) {
      toast.warning('Tidak ada akun target yang sesuai kriteria.', 'Target Kosong');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `mass_reset_${targetScope}_${Date.now()}`;
      const res = await adminCreateMassResetJob({
        resetMode,
        targetScope,
        roleFilter: targetScope === 'by_role' ? roleFilter : undefined,
        userIds: targetScope === 'selected_users' ? selectedUserIds : undefined,
        excludeSelf,
        invalidateSessions,
        tokenTtlHours,
        batchSize,
        idempotencyKey,
        reason
      });

      if (!res.ok || !res.data?.success) {
        toast.error(res.data?.error || 'Gagal memulai proses mass password reset.', 'Gagal');
        return;
      }

      setActiveJob(res.data.job);
      setConfirmChecked(false);
      toast.success(
        `Batch reset sandi dimulai untuk ${res.data.job.totalTargets} akun. Tanpa plaintext password.`,
        'Batch Dimulai'
      );
      void loadJobs();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryFailed = async (jobId: string) => {
    const res = await adminRetryMassResetJob(jobId);
    if (res.ok && res.data?.job) {
      setActiveJob(res.data.job);
      toast.success('Mengulang item yang gagal tanpa menduplikasi akun yang sudah selesai.', 'Retry Berjalan');
    } else {
      toast.error(res.data?.error || 'Gagal mengulang item.', 'Gagal');
    }
  };

  const handleCancelJob = async (jobId: string) => {
    const res = await adminCancelMassResetJob(jobId);
    if (res.ok && res.data?.job) {
      setActiveJob(res.data.job);
      toast.info('Permintaan pembatalan batch dikirim.', 'Dibatalkan');
      void loadJobs();
    } else {
      toast.error(res.data?.error || 'Gagal membatalkan job.', 'Gagal');
    }
  };

  const handleRollbackJob = async (jobId: string) => {
    const res = await adminRollbackMassResetJob(jobId);
    if (res.ok && res.data?.job) {
      setActiveJob(res.data.job);
      toast.success('Rollback metadata & kredensial sebelumnya berhasil dijalankan.', 'Rollback Selesai');
      void loadJobs();
      void onCompleted?.();
    } else {
      toast.error(res.data?.error || 'Gagal melakukan rollback.', 'Rollback Gagal');
    }
  };

  const handleDownload = async (jobId: string, format: 'json' | 'csv') => {
    try {
      await adminDownloadMassResetReport(jobId, format);
      toast.success(`Laporan audit reset sandi (.${format.toUpperCase()}) berhasil diunduh.`, 'Laporan Diunduh');
    } catch (err: any) {
      toast.error(err?.message || 'Gagal mengunduh laporan.', 'Gagal');
    }
  };

  const selectJob = async (jobId: string) => {
    const res = await adminGetMassResetJob(jobId);
    if (res.ok && res.data?.job) {
      setActiveJob(res.data.job);
    }
  };

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Reset Sandi Massal (Batch Aman)"
      subtitle="Eksklusif Superadmin · Zero Plaintext Password · Idempoten & Dapat Di-Rollback"
      icon={<ShieldAlert className="w-5 h-5 text-[#58149C] dark:text-[#DAB9FF]" />}
      size="xl"
      mobileVariant="sheet"
      zIndexClass="z-50"
    >
      <div className="space-y-5 text-xs">
        <div className="p-3.5 rounded-xl bg-[#F4EAFF] dark:bg-[#29174B] border border-[#DFCEFA] dark:border-[#4F2D91] text-[#35105E] dark:text-[#E9D5FF] leading-relaxed flex items-start gap-2.5">
          <KeyRound className="w-4 h-4 shrink-0 mt-0.5 text-[#58149C] dark:text-[#DAB9FF]" />
          <div>
            Sistem tidak pernah membuat, menyimpan, atau mengekspor kata sandi plaintext. Setiap akun target akan menerima kewajiban <strong>Ganti Sandi Saat Login (must_change_password)</strong>, sesi aktif dicabut, serta token pemulihan satu-kali berbatas waktu (SHA-256 hash).
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Form: Configure New Mass Reset Batch */}
          <form onSubmit={handleStartMassReset} className="lg:col-span-5 space-y-3.5 p-4 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#3B1D78]">
            <h4 className="font-display font-extrabold text-sm text-[#1F1638] dark:text-white">
              Konfigurasi Batch Baru
            </h4>

            <div>
              <label className="block font-bold text-[#1F1638] dark:text-white mb-1">Cakupan Target Akun</label>
              <select
                value={targetScope}
                onChange={e => setTargetScope(e.target.value as any)}
                className="tactile-debossed-input w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1E1338] border border-[#D8CCF3] dark:border-[#3B1D78] text-[#1F1638] dark:text-white font-semibold"
              >
                <option value="all_active">Semua Akun Aktif</option>
                <option value="by_role">Berdasarkan Role Tertentu</option>
                <option value="selected_users">Pilih User Secara Manual</option>
              </select>
            </div>

            {targetScope === 'by_role' && (
              <div>
                <label className="block font-bold text-[#1F1638] dark:text-white mb-1">Filter Role</label>
                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value as UserRole)}
                  className="tactile-debossed-input w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1E1338] border border-[#D8CCF3] dark:border-[#3B1D78] text-[#1F1638] dark:text-white font-semibold"
                >
                  <option value="dispatch">Dispatch</option>
                  <option value="leader">Leader</option>
                  <option value="installer">Installer</option>
                  <option value="management_data">Management Data</option>
                  <option value="it_support">IT Support Application</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
            )}

            {targetScope === 'selected_users' && (
              <div className="max-h-40 overflow-y-auto p-2.5 rounded-xl bg-white dark:bg-[#1E1338] border border-[#D8CCF3] dark:border-[#3B1D78] space-y-1.5">
                {eligibleUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(u.id)}
                      onChange={() => handleToggleUser(u.id)}
                      className="rounded accent-[#58149C]"
                    />
                    <span className="font-semibold text-[#1F1638] dark:text-white truncate">{u.name}</span>
                    <span className="text-[10px] font-mono text-[#7D7484]">@{u.username} ({u.role})</span>
                  </label>
                ))}
              </div>
            )}

            <div>
              <label className="block font-bold text-[#1F1638] dark:text-white mb-1">Mode Keamanan Reset</label>
              <select
                value={resetMode}
                onChange={e => setResetMode(e.target.value as MassResetMode)}
                className="tactile-debossed-input w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1E1338] border border-[#D8CCF3] dark:border-[#3B1D78] text-[#1F1638] dark:text-white font-semibold"
              >
                <option value="force_change_with_token">Wajib Ganti Sandi + Terbitkan Token 1x (Sandi Lama Tetap Berlaku s.d. Ganti)</option>
                <option value="rotate_credential_and_force">Rotasi Kredensial Otomatis + Token Pemulihan 1x</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold text-[#1F1638] dark:text-white mb-1">Ukuran Batch</label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={batchSize}
                  onChange={e => setBatchSize(Math.min(25, Math.max(1, Number(e.target.value) || 10)))}
                  className="tactile-debossed-input w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1E1338] border border-[#D8CCF3] dark:border-[#3B1D78] text-[#1F1638] dark:text-white font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-bold text-[#1F1638] dark:text-white mb-1">Masa Berlaku Token (Jam)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={tokenTtlHours}
                  onChange={e => setTokenTtlHours(Math.min(168, Math.max(1, Number(e.target.value) || 24)))}
                  className="tactile-debossed-input w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1E1338] border border-[#D8CCF3] dark:border-[#3B1D78] text-[#1F1638] dark:text-white font-mono tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-[#1F1638] dark:text-white mb-1">Alasan / Catatan Audit</label>
              <input
                type="text"
                required
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="tactile-debossed-input w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1E1338] border border-[#D8CCF3] dark:border-[#3B1D78] text-[#1F1638] dark:text-white"
              />
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeSelf}
                  onChange={e => setExcludeSelf(e.target.checked)}
                  className="rounded accent-[#58149C]"
                />
                <span className="font-semibold text-[#1F1638] dark:text-white">Kecualikan akun saya sendiri ({currentUser.username})</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={invalidateSessions}
                  onChange={e => setInvalidateSessions(e.target.checked)}
                  className="rounded accent-[#58149C]"
                />
                <span className="font-semibold text-[#1F1638] dark:text-white">Cabut seluruh sesi aktif user target</span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                <input
                  type="checkbox"
                  checked={confirmChecked}
                  onChange={e => setConfirmChecked(e.target.checked)}
                  className="mt-0.5 rounded accent-[#58149C]"
                />
                <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-200 leading-snug">
                  Saya mengonfirmasi eksekusi reset sandi aman untuk <strong>{targetCountPreview} akun</strong> secara bertahap.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || !confirmChecked || targetCountPreview === 0}
              className="btn-3d-primary w-full min-h-[42px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              <span>{submitting ? 'Memulai Batch...' : `Mulai Reset Massal (${targetCountPreview} Akun)`}</span>
            </button>
          </form>

          {/* Right Panel: Live Job Progress, Counters, Retry/Cancel/Rollback, Report */}
          <div className="lg:col-span-7 space-y-4">
            {activeJob ? (
              <div className="p-4 rounded-2xl bg-white dark:bg-[#1E1338] border border-[#E8DDFF] dark:border-[#3B1D78] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E8DDFF] dark:border-[#3B1D78]">
                  <div>
                    <div className="text-[10.5px] font-mono text-[#7D7484] dark:text-[#A79BC0]">
                      JOB ID: {activeJob.id}
                    </div>
                    <h5 className="font-display font-extrabold text-sm text-[#1F1638] dark:text-white">
                      Status Batch: <span className="uppercase text-[#58149C] dark:text-[#DAB9FF]">{activeJob.status.replace(/_/g, ' ')}</span>
                    </h5>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeJob.failedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleRetryFailed(activeJob.id)}
                        className="btn-3d-amber px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry Gagal ({activeJob.failedCount})</span>
                      </button>
                    )}

                    {(activeJob.status === 'queued' || activeJob.status === 'running') && (
                      <button
                        type="button"
                        onClick={() => void handleCancelJob(activeJob.id)}
                        className="btn-3d-crimson px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Batalkan</span>
                      </button>
                    )}

                    {activeJob.completedCount > 0 && activeJob.status !== 'rolled_back' && (
                      <button
                        type="button"
                        onClick={() => void handleRollbackJob(activeJob.id)}
                        className="btn-3d-lilac px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Rollback</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleDownload(activeJob.id, 'csv')}
                      className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownload(activeJob.id, 'json')}
                      className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh JSON</span>
                    </button>
                  </div>
                </div>

                {/* Aggregate Progress Bar */}
                {(() => {
                  const done = activeJob.completedCount + activeJob.failedCount;
                  const pct = activeJob.totalTargets > 0 ? Math.round((done / activeJob.totalTargets) * 100) : 0;
                  return (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px] font-bold">
                        <span className="text-[#4B4452] dark:text-[#CABDE8]">Progres Eksekusi Batch</span>
                        <span className="font-mono tabular-nums text-[#58149C] dark:text-[#DAB9FF]">{done}/{activeJob.totalTargets} ({pct}%)</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#F4EAFF] dark:bg-[#2E1459] overflow-hidden">
                        <div className="h-full bg-[#7135B5] transition-all duration-300" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })()}

                {/* 5 Aggregate Counters */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div className="p-2.5 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#3B1D78]">
                    <div className="text-[10px] font-bold text-[#7D7484]">PENDING</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-[#1F1638] dark:text-white">{activeJob.pendingCount}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#3B1D78]">
                    <div className="text-[10px] font-bold text-[#7D7484]">PROSES</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-[#58149C] dark:text-[#DAB9FF]">{activeJob.processingCount}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
                    <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">SELESAI</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">{activeJob.completedCount}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60">
                    <div className="text-[10px] font-bold text-rose-700 dark:text-rose-300">GAGAL</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-rose-700 dark:text-rose-300">{activeJob.failedCount}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                    <div className="text-[10px] font-bold text-amber-800 dark:text-amber-300">WAJIB GANTI</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-amber-800 dark:text-amber-300">{activeJob.mustChangePasswordCount}</div>
                  </div>
                </div>

                {/* Itemized Table */}
                <div className="max-h-56 overflow-y-auto rounded-xl border border-[#E8DDFF] dark:border-[#3B1D78]">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-[#F4EAFF] dark:bg-[#2E1459] sticky top-0 text-[#35105E] dark:text-[#E9D5FF]">
                      <tr>
                        <th className="py-2 px-3 font-bold">Akun</th>
                        <th className="py-2 px-3 font-bold">Role</th>
                        <th className="py-2 px-3 font-bold">Status</th>
                        <th className="py-2 px-3 font-bold">Sesi Dicabut</th>
                        <th className="py-2 px-3 font-bold">Catatan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE6FF] dark:divide-[#2D1857]">
                      {(activeJob.items || []).map(item => (
                        <tr key={item.id} className="hover:bg-[#FAF5FF] dark:hover:bg-[#241447]">
                          <td className="py-1.5 px-3">
                            <div className="font-bold text-[#1F1638] dark:text-white">{item.userName}</div>
                            <div className="font-mono text-[10px] text-[#7D7484]">@{item.username}</div>
                          </td>
                          <td className="py-1.5 px-3 font-mono">{item.userRole}</td>
                          <td className="py-1.5 px-3 font-bold">
                            {item.status === 'completed' && <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Selesai</span>}
                            {item.status === 'failed' && <span className="text-rose-600 dark:text-rose-400 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" />Gagal</span>}
                            {item.status === 'pending' && <span className="text-[#7D7484] inline-flex items-center gap-1"><Clock className="w-3 h-3" />Antre</span>}
                            {item.status === 'processing' && <span className="text-[#7135B5] inline-flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" />Proses</span>}
                            {item.status === 'cancelled' && <span className="text-amber-600 inline-flex items-center gap-1"><XCircle className="w-3 h-3" />Batal</span>}
                            {item.status === 'rolled_back' && <span className="text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />Rollback</span>}
                          </td>
                          <td className="py-1.5 px-3">{item.sessionsRevoked ? 'Ya' : 'Tidak'}</td>
                          <td className="py-1.5 px-3 text-[#4B4452] dark:text-[#CABDE8] truncate max-w-[160px]" title={item.errorMessage || ''}>
                            {item.errorMessage || (item.mustChangePassword ? 'Wajib ganti sandi aktif' : '-')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#3B1D78] text-center space-y-2">
                <Users className="w-8 h-8 mx-auto text-[#7135B5] dark:text-[#DAB9FF]" />
                <div className="font-bold text-[#1F1638] dark:text-white">Belum Ada Batch Reset Dipilih</div>
                <p className="text-[11px] text-[#7D7484] dark:text-[#A79BC0]">
                  Konfigurasikan target di panel kiri untuk memulai reset sandi massal atau pilih riwayat batch di bawah.
                </p>
              </div>
            )}

            {/* Recent Jobs History */}
            <div className="p-3.5 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#3B1D78] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#1F1638] dark:text-white">Riwayat Batch Terbaru</span>
                <button
                  type="button"
                  onClick={() => void loadJobs()}
                  className="text-[11px] font-bold text-[#58149C] dark:text-[#DAB9FF] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingJobs ? 'animate-spin' : ''}`} />
                  <span>Segarkan</span>
                </button>
              </div>
              {jobs.length === 0 ? (
                <div className="text-[11px] text-[#7D7484]">Belum ada riwayat batch reset sandi.</div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {jobs.map(j => (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => void selectJob(j.id)}
                      className={`w-full text-left p-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        activeJob?.id === j.id
                          ? 'bg-white dark:bg-[#2A194F] border-[#7135B5]'
                          : 'bg-white/60 dark:bg-[#1E1338] border-[#E8DDFF] dark:border-[#3B1D78] hover:border-[#A78BFA]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-[#1F1638] dark:text-white truncate">{j.reason || j.targetScope}</div>
                        <div className="text-[10px] font-mono text-[#7D7484]">
                          {new Date(j.createdAt).toLocaleString('id-ID')} · {j.completedCount}/{j.totalTargets} selesai
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] shrink-0">
                        {j.status.replace(/_/g, ' ')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ResponsiveModal>
  );
};
