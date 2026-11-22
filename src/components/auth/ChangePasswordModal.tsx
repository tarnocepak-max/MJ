import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  Check,
  X,
  AlertCircle,
  ShieldCheck
} from 'lucide-react';
import type { User } from '../../types/index.ts';
import { MAX_PASSWORD_LENGTH, validateStrongPasswordClient } from '../../utils/passwordPolicy';
import { changePasswordWithRotation } from '../../services/authService';

interface ChangePasswordModalProps {
  isOpen: boolean;
  user: User;
  onClose: () => void;
  onPasswordChanged: (payload: {
    user: User;
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    sessionId?: string;
    sessionVersion?: number;
  }) => Promise<void> | void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  isOpen,
  user,
  onClose,
  onPasswordChanged
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const policy = useMemo(
    () =>
      validateStrongPasswordClient(newPassword, {
        username: user.username,
        email: user.email,
        name: user.name
      }),
    [newPassword, user.username, user.email, user.name]
  );

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  if (!isOpen) return null;

  const resetAndClose = () => {
    if (submitting) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError('Kata sandi saat ini wajib diisi.');
      return;
    }
    if (!policy.valid) {
      setError(policy.error || `Kata sandi baru maksimal ${MAX_PASSWORD_LENGTH} karakter.`);
      return;
    }
    if (currentPassword === newPassword) {
      setError('Kata sandi baru harus berbeda dengan kata sandi saat ini.');
      return;
    }
    if (!passwordsMatch) {
      setError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await changePasswordWithRotation({
        currentPassword,
        newPassword,
        confirmPassword
      });

      if (!res.ok || !res.data?.success) {
        setError(res.data?.error || 'Gagal memperbarui kata sandi. Periksa kembali kata sandi saat ini.');
        return;
      }

      await onPasswordChanged({
        user: {
          ...user,
          ...(res.data.user || {}),
          mustChangePassword: false,
          passwordChangedAt: new Date().toISOString()
        },
        token: res.data.token || res.data.tokens?.accessToken,
        accessToken: res.data.tokens?.accessToken || res.data.token,
        refreshToken: res.data.tokens?.refreshToken,
        sessionId: res.data.sessionId,
        sessionVersion: res.data.sessionVersion
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Terjadi gangguan jaringan saat memperbarui kata sandi.');
    } finally {
      setSubmitting(false);
    }
  };

  const strengthColor =
    policy.score >= 90
      ? 'bg-emerald-500'
      : policy.score >= 75
      ? 'bg-[#7135B5]'
      : policy.score >= 50
      ? 'bg-amber-500'
      : 'bg-rose-500';

  const modalContent = (
    <div
      className="fixed inset-0 z-[130] bg-[#160D29]/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-password-modal-title"
      onClick={resetAndClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#FDF7FF] dark:bg-[#1E1338] border border-[#E8DDFF] dark:border-[#49258C] shadow-[0_24px_60px_rgba(18,8,38,0.55)] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-[#58149C] via-[#7135B5] to-[#4A1285] text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <KeyRound className="w-4 h-4 text-[#F4EAFF]" />
            </div>
            <div className="min-w-0">
              <h2 id="change-password-modal-title" className="font-display text-base font-extrabold tracking-tight truncate">
                Ganti Password Akun
              </h2>
              <p className="text-[11px] text-[#EEDBFF] truncate">
                {user.name} (@{user.username})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={resetAndClose}
            disabled={submitting}
            aria-label="Tutup modal ganti password"
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-xl bg-[#F4EAFF] dark:bg-[#2A194F] border border-[#DFCEFA] dark:border-[#532B9E] text-xs text-[#35105E] dark:text-[#E9D5FF] leading-relaxed flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
            <span>
              Gunakan kata sandi baru <strong>maksimal {MAX_PASSWORD_LENGTH} karakter</strong> (4–{MAX_PASSWORD_LENGTH} karakter tanpa spasi).
            </span>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#BA1A1A] dark:text-rose-400 shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{error}</span>
            </div>
          )}

          {/* Current Password */}
          <div>
            <label className="block text-xs font-bold text-[#1F1638] dark:text-white mb-1.5">
              Password Saat Ini <span className="text-[#BA1A1A]">*</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#7D7484] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showCurrent ? 'text' : 'password'}
                required
                autoFocus
                autoComplete="current-password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="Masukkan password saat ini"
                className="tactile-debossed-input w-full min-h-[42px] pl-10 pr-10 py-2 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#3B1D78] rounded-xl text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#7135B5]/40"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(v => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-[#7D7484] hover:text-[#1F1638] dark:hover:text-white cursor-pointer"
                tabIndex={-1}
                aria-label="Tampilkan atau sembunyikan password saat ini"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#1F1638] dark:text-white">
                Password Baru <span className="text-[#BA1A1A]">*</span>
              </label>
              <span className="font-mono text-[10.5px] font-bold text-[#7135B5] dark:text-[#DAB9FF] tabular-nums">
                {newPassword.length}/{MAX_PASSWORD_LENGTH} karakter
              </span>
            </div>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-[#7D7484] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showNew ? 'text' : 'password'}
                required
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                placeholder={`Maksimal ${MAX_PASSWORD_LENGTH} karakter`}
                className="tactile-debossed-input w-full min-h-[42px] pl-10 pr-10 py-2 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#3B1D78] rounded-xl text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#7135B5]/40"
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-[#7D7484] hover:text-[#1F1638] dark:hover:text-white cursor-pointer"
                tabIndex={-1}
                aria-label="Tampilkan atau sembunyikan password baru"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {newPassword && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#4B4452] dark:text-[#CABDE8] font-semibold">Validitas Password</span>
                  <span className="font-bold text-[#35105E] dark:text-[#DAB9FF] tabular-nums">
                    {policy.strengthLabel} ({policy.score}%)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#E8DDFF] dark:bg-[#2F1859] overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${strengthColor}`}
                    style={{ width: `${policy.score}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Confirm New Password */}
          <div>
            <label className="block text-xs font-bold text-[#1F1638] dark:text-white mb-1.5">
              Konfirmasi Password Baru <span className="text-[#BA1A1A]">*</span>
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-[#7D7484] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                placeholder="Ketik ulang password baru"
                className="tactile-debossed-input w-full min-h-[42px] pl-10 pr-10 py-2 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#3B1D78] rounded-xl text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#7135B5]/40"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-[#7D7484] hover:text-[#1F1638] dark:hover:text-white cursor-pointer"
                tabIndex={-1}
                aria-label="Tampilkan atau sembunyikan konfirmasi password"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Checklist */}
          <div className="p-3 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#3B1D78] space-y-1 text-[11px]">
            {policy.rules.map(rule => (
              <div
                key={rule.id}
                className={`flex items-center gap-2 ${
                  rule.passed
                    ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
                    : 'text-[#6A5F78] dark:text-[#9D8FC2]'
                }`}
              >
                {rule.passed ? (
                  <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <X className="w-3.5 h-3.5 shrink-0 opacity-60" />
                )}
                <span>{rule.label}</span>
              </div>
            ))}
            <div
              className={`flex items-center gap-2 ${
                passwordsMatch
                  ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
                  : 'text-[#6A5F78] dark:text-[#9D8FC2]'
              }`}
            >
              {passwordsMatch ? (
                <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <X className="w-3.5 h-3.5 shrink-0 opacity-60" />
              )}
              <span>Konfirmasi password cocok</span>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#E8DDFF] dark:border-[#3B1D78]">
            <button
              type="button"
              disabled={submitting}
              onClick={resetAndClose}
              className="btn-3d-lilac min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              Batal
            </button>

            <button
              type="submit"
              disabled={submitting || !policy.valid || !passwordsMatch || !currentPassword}
              className="btn-3d-primary min-h-[40px] px-5 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{submitting ? 'Menyimpan...' : 'Simpan Password Baru'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
