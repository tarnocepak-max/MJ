import React, { useMemo, useState } from 'react';
import {
  ShieldAlert,
  Lock,
  Eye,
  EyeOff,
  Check,
  X,
  LogOut,
  KeyRound,
  AlertCircle,
  ShieldCheck
} from 'lucide-react';
import type { User } from '../../types/index.ts';
import { MAX_PASSWORD_LENGTH, validateStrongPasswordClient } from '../../utils/passwordPolicy';
import { changePasswordWithRotation } from '../../services/authService';
import { MoraJawsLogo } from '../common/MoraJawsLogo';
import { useVisualViewportModal } from '../../hooks/useVisualViewportModal';

interface ForcePasswordChangeModalProps {
  user: User;
  onPasswordChanged: (payload: {
    user: User;
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    sessionId?: string;
    sessionVersion?: number;
  }) => Promise<void> | void;
  onLogout: () => Promise<void> | void;
}

export const ForcePasswordChangeModal: React.FC<ForcePasswordChangeModalProps> = ({
  user,
  onPasswordChanged,
  onLogout
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const vv = useVisualViewportModal(true);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError('Kata sandi saat ini wajib diisi.');
      return;
    }
    if (!policy.valid) {
      setError(policy.error || 'Kata sandi baru belum memenuhi kebijakan keamanan.');
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
      ? 'bg-[#6657C8] dark:bg-[#7135B5]'
      : policy.score >= 50
      ? 'bg-amber-500'
      : 'bg-rose-500';

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-900/50 dark:bg-[#160D29]/90 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-password-change-title"
    >
      <div
        style={
          vv.viewportHeight
            ? { maxHeight: `${Math.max(320, vv.viewportHeight - (vv.isKeyboardOpen ? 8 : 20))}px` }
            : undefined
        }
        className="w-full max-w-lg max-h-[92dvh] flex flex-col rounded-t-[24px] sm:rounded-2xl bg-white dark:bg-[#1E1338] border border-[#DDE6F0] dark:border-[#49258C] shadow-[0_24px_60px_rgba(38,54,74,0.22)] dark:shadow-[0_24px_60px_rgba(18,8,38,0.65)] overflow-hidden"
      >
        {/* Top Accent Header */}
        <div className="px-5 sm:px-6 py-4 sm:py-5 bg-gradient-to-r from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#58149C] dark:via-[#7135B5] dark:to-[#4A1285] text-[#26364A] dark:text-white border-b border-[#DDE6F0] dark:border-transparent flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/85 dark:bg-white/15 border border-[#C5BEEF] dark:border-white/25 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-[#5145A6] dark:text-[#F4EAFF]" />
            </div>
            <div className="min-w-0">
              <h2 id="force-password-change-title" className="font-display text-base sm:text-lg font-extrabold tracking-tight truncate">
                Wajib Ganti Kata Sandi Baru
              </h2>
              <p className="text-[11px] text-[#52647A] dark:text-[#EEDBFF] truncate">
                Keamanan Akun MoraJaws · {user.name} (@{user.username})
              </p>
            </div>
          </div>
          <div className="hidden sm:block shrink-0">
            <MoraJawsLogo size="sm" showText={false} />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-4">
          <div className="p-3.5 rounded-xl bg-[#EAE8FF] dark:bg-[#2A194F] border border-[#C5BEEF] dark:border-[#532B9E] text-xs text-[#26364A] dark:text-[#E9D5FF] leading-relaxed flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
            <div>
              <strong>Akses fitur utama ditahan sementara.</strong> Kebijakan keamanan mewajibkan Anda membuat kata sandi baru (<strong>maksimal {MAX_PASSWORD_LENGTH} karakter</strong>, tanpa spasi) sebelum mengakses data Work Order dan operasional MoraJaws.
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#BA1A1A] dark:text-rose-400 shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{error}</span>
            </div>
          )}

          {/* Current Password */}
          <div>
            <label className="block text-xs font-bold text-[#26364A] dark:text-white mb-1.5">
              Kata Sandi Saat Ini <span className="text-[#BA1A1A]">*</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#8492A5] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showCurrent ? 'text' : 'password'}
                required
                autoFocus
                autoComplete="current-password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="Masukkan kata sandi sementara / saat ini"
                className="tactile-debossed-input w-full min-h-[42px] pl-10 pr-10 py-2 bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3B1D78] rounded-xl text-xs text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#6657C8]/35 dark:focus:ring-[#7135B5]/40"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(v => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                tabIndex={-1}
                aria-label="Tampilkan atau sembunyikan kata sandi saat ini"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#26364A] dark:text-white">
                Kata Sandi Baru <span className="text-[#BA1A1A]">*</span>
              </label>
              <span className="font-mono text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                {newPassword.length}/{MAX_PASSWORD_LENGTH} karakter
              </span>
            </div>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-[#8492A5] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showNew ? 'text' : 'password'}
                required
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                placeholder={`Maksimal ${MAX_PASSWORD_LENGTH} karakter (4-${MAX_PASSWORD_LENGTH} karakter)`}
                className="tactile-debossed-input w-full min-h-[42px] pl-10 pr-10 py-2 bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3B1D78] rounded-xl text-xs text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#6657C8]/35 dark:focus:ring-[#7135B5]/40"
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                tabIndex={-1}
                aria-label="Tampilkan atau sembunyikan kata sandi baru"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {newPassword && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#52647A] dark:text-[#CABDE8] font-semibold">Kekuatan Sandi</span>
                  <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                    {policy.strengthLabel} ({policy.score}%)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#DDE6F0] dark:bg-[#2F1859] overflow-hidden">
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
            <label className="block text-xs font-bold text-[#26364A] dark:text-white mb-1.5">
              Konfirmasi Kata Sandi Baru <span className="text-[#BA1A1A]">*</span>
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-[#8492A5] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                placeholder="Ketik ulang kata sandi baru"
                className="tactile-debossed-input w-full min-h-[42px] pl-10 pr-10 py-2 bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3B1D78] rounded-xl text-xs text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#6657C8]/35 dark:focus:ring-[#7135B5]/40"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                tabIndex={-1}
                aria-label="Tampilkan atau sembunyikan konfirmasi kata sandi"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Policy Checklist */}
          <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3B1D78] space-y-1.5 text-[11px]">
            {policy.rules.map(rule => (
              <div
                key={rule.id}
                className={`flex items-center gap-2 ${
                  rule.passed
                    ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
                    : 'text-[#52647A] dark:text-[#9D8FC2]'
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
                  : 'text-[#52647A] dark:text-[#9D8FC2]'
              }`}
            >
              {passwordsMatch ? (
                <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <X className="w-3.5 h-3.5 shrink-0 opacity-60" />
              )}
              <span>Konfirmasi kata sandi cocok</span>
            </div>
          </div>

          </div>

          {/* Sticky Footer Actions */}
          <div className="px-5 sm:px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 border-t border-[#DDE6F0] dark:border-[#3B1D78] shrink-0">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onLogout()}
              className="btn-3d-lilac min-h-[44px] sm:min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar (Logout)</span>
            </button>

            <button
              type="submit"
              disabled={submitting || !policy.valid || !passwordsMatch || !currentPassword}
              className="btn-3d-primary min-h-[44px] sm:min-h-[42px] px-5 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{submitting ? 'Memperbarui Kredensial...' : 'Simpan Sandi Baru & Lanjutkan'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
