import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useAnimation } from '../../context/AnimationContext';
import { MoraJawsLogo } from '../common/MoraJawsLogo';
import { UserRole } from '../../types/index.ts';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Server,
  Sparkles,
  KeyRound,
  CheckCircle2,
  Check,
  X
} from 'lucide-react';
import { resetPasswordWithToken } from '../../services/authService';
import { MAX_PASSWORD_LENGTH, validateStrongPasswordClient } from '../../utils/passwordPolicy';
interface StaffLoginPortalProps {
  onLoginSuccess?: (role: UserRole) => void;
}

export const StaffLoginPortal: React.FC<StaffLoginPortalProps> = ({ onLoginSuccess }) => {
  const { login } = useApp();
  const { toast } = useToast();
  const { startLoading, stopLoading, showGlobalError } = useAnimation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [tokenMode, setTokenMode] = useState(false);
  const [tokenIdentifier, setTokenIdentifier] = useState('');
  const [resetTokenInput, setResetTokenInput] = useState('');
  const [tokenNewPassword, setTokenNewPassword] = useState('');
  const [tokenConfirmPassword, setTokenConfirmPassword] = useState('');
  const [showTokenNewPassword, setShowTokenNewPassword] = useState(false);
  const [tokenSubmitting, setTokenSubmitting] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenSuccess, setTokenSuccess] = useState<string | null>(null);

  const tokenPolicy = validateStrongPasswordClient(tokenNewPassword, {
    username: tokenIdentifier.trim()
  });

  const handleTokenResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTokenError(null);
    setTokenSuccess(null);

    if (!tokenIdentifier.trim() || !resetTokenInput.trim()) {
      setTokenError('Username/email dan token reset satu-kali wajib diisi.');
      return;
    }
    if (!tokenPolicy.valid) {
      setTokenError(tokenPolicy.error || 'Kata sandi baru belum memenuhi kebijakan keamanan.');
      return;
    }
    if (tokenNewPassword !== tokenConfirmPassword) {
      setTokenError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }

    setTokenSubmitting(true);
    try {
      const res = await resetPasswordWithToken({
        identifier: tokenIdentifier.trim(),
        token: resetTokenInput.trim(),
        newPassword: tokenNewPassword,
        confirmPassword: tokenConfirmPassword
      });
      if (!res.ok || !res.data?.success) {
        setTokenError(res.data?.error || 'Token reset tidak valid atau telah kedaluwarsa.');
        return;
      }
      setTokenSuccess('Kata sandi baru berhasil ditetapkan. Silakan login dengan kata sandi baru Anda.');
      toast.success('Kata sandi berhasil diperbarui melalui token pemulihan.', 'Reset Berhasil');
      setUsername(tokenIdentifier.trim());
      setPassword('');
      setResetTokenInput('');
      setTokenNewPassword('');
      setTokenConfirmPassword('');
      setTokenMode(false);
    } catch (err: any) {
      setTokenError(err?.message || 'Gagal menghubungi server pemulihan sandi.');
    } finally {
      setTokenSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUser = username.trim();
    if (!cleanUser) {
      setError('Nama pengguna atau alamat email wajib diisi.');
      return;
    }
    if (!password) {
      setError('Kata sandi wajib diisi.');
      return;
    }

    setLoading(true);
    startLoading({
      title: 'MENGOTENTIKASI AKUN...',
      subtitle: 'Memverifikasi kredensial staf dan hak akses MoraJaws'
    });

    try {
      const res = await login(cleanUser, password);
      if (res.success && res.user) {
        toast.success(`Selamat datang kembali, ${res.user.name}!`, 'LOGIN BERHASIL');
        onLoginSuccess?.(res.user.role);
      } else {
        const errorMsg = res.error || 'Kredensial login tidak valid. Pastikan nama pengguna dan kata sandi benar.';
        setError(errorMsg);

        if (res.errorCode === 'ACCOUNT_NOT_FOUND' || res.errorCode === 'auth/user-not-found') {
          showGlobalError({
            errorCode: 'MJ-AUTH-002',
            module: 'Authentication',
            operation: 'User Lookup',
            description: 'Akun tidak terdaftar pada direktori internal MoraJaws.',
            message: 'Hubungi Superadmin untuk mendapatkan akses MoraJaws.',
            technicalDetails: errorMsg,
            severity: 'MEDIUM',
            status: 'OPEN'
          });
        } else if (res.errorCode === 'ACCOUNT_LOCKED' || res.errorCode === 'auth/too-many-requests') {
          showGlobalError({
            errorCode: 'MJ-AUTH-LOCK',
            module: 'Authentication',
            operation: 'Brute Force Protection',
            description: 'Akun dikunci sementara karena terlalu banyak percobaan gagal.',
            message: 'Terlalu banyak percobaan login gagal. Akun dikunci sementara demi keamanan.',
            technicalDetails: errorMsg,
            severity: 'HIGH',
            status: 'OPEN'
          });
        } else if (res.errorCode === 'ACCOUNT_DISABLED' || res.errorCode === 'auth/user-disabled') {
          showGlobalError({
            errorCode: 'MJ-AUTH-DISABLED',
            module: 'Authentication',
            operation: 'Account Status Check',
            description: 'Akun dinonaktifkan.',
            message: 'Akun Anda telah dinonaktifkan oleh Administrator. Hubungi Superadmin.',
            technicalDetails: errorMsg,
            severity: 'HIGH',
            status: 'OPEN'
          });
        } else if (
          res.errorCode === 'MJ-AUTH-001' ||
          res.errorCode === 'AUTH_INVALID_CREDENTIALS' ||
          res.errorCode === 'INVALID_CREDENTIALS' ||
          res.errorCode === 'auth/wrong-password'
        ) {
          showGlobalError({
            errorCode: 'MJ-AUTH-001',
            module: 'Authentication',
            operation: 'Staff Credential Login',
            description: 'Autentikasi gagal. Kredensial tidak cocok.',
            message: 'Autentikasi gagal. Kredensial tidak cocok.',
            technicalDetails: errorMsg,
            severity: 'MEDIUM',
            status: 'OPEN'
          });
        } else if (res.errorCode === 'DATABASE_UNAVAILABLE') {
          showGlobalError({
            errorCode: 'MJ-DB-001',
            module: 'Authentication',
            operation: 'Database Connectivity',
            description: 'Database Supabase PostgreSQL tidak dapat dijangkau.',
            message: 'Database PostgreSQL tidak dapat diakses saat login.',
            technicalDetails: errorMsg,
            severity: 'HIGH',
            status: 'OPEN'
          });
        } else if (res.errorCode === 'auth/network-request-failed' || res.errorCode === 'NETWORK_OFFLINE') {
          showGlobalError({
            errorCode: 'MJ-NET-001',
            module: 'Authentication',
            operation: 'Staff Network Connection',
            description: 'Koneksi jaringan terputus.',
            message: 'Gagal terhubung ke layanan autentikasi.',
            technicalDetails: errorMsg,
            severity: 'HIGH',
            status: 'OPEN'
          });
        } else if (res.errorCode === 'auth/user-disabled' || String(errorMsg || '').includes('dinonaktifkan')) {
          showGlobalError({
            errorCode: 'MJ-AUTH-003',
            module: 'Authentication',
            operation: 'Staff Account Status',
            description: 'Akun staf dinonaktifkan.',
            message: 'Akun telah dinonaktifkan oleh Administrator.',
            technicalDetails: errorMsg,
            severity: 'HIGH',
            status: 'OPEN'
          });
        } else if (res.errorCode === 'auth/user-not-found' || String(errorMsg || '').includes('tidak ditemukan') || String(errorMsg || '').includes('tidak terdaftar')) {
          showGlobalError({
            errorCode: 'MJ-AUTH-002',
            module: 'Authentication',
            operation: 'Staff Identity Lookup',
            description: 'Identitas staf tidak terdaftar.',
            message: 'Akun staf tidak ditemukan dalam direktori MoraJaws.',
            technicalDetails: errorMsg,
            severity: 'MEDIUM',
            status: 'OPEN'
          });
        } else if (res.errorCode === 'auth/too-many-requests') {
          showGlobalError({
            errorCode: 'MJ-AUTH-005',
            module: 'Authentication',
            operation: 'Staff Rate Limiting',
            description: 'Terlalu banyak percobaan login yang gagal.',
            message: 'Akses akun ditangguhkan sementara demi keamanan.',
            technicalDetails: errorMsg,
            severity: 'MEDIUM',
            status: 'OPEN'
          });
        } else {
          showGlobalError({
            errorCode: 'MJ-AUTH-004',
            module: 'Authentication',
            operation: 'Staff Authentication',
            description: 'Kendala autentikasi akun staf.',
            message: errorMsg,
            technicalDetails: errorMsg,
            severity: 'MEDIUM',
            status: 'OPEN'
          });
        }
      }
    } catch (err: any) {
      const errTxt = err?.message || 'Terjadi gangguan saat menghubungkan ke server autentikasi.';
      setError(errTxt);
      showGlobalError({
        errorCode: 'MJ-SYS-001',
        module: 'Authentication',
        operation: 'Staff Login Exception',
        description: 'Gagal menghubungi sistem autentikasi.',
        message: 'Gagal menghubungi sistem autentikasi.',
        technicalDetails: errTxt,
        severity: 'HIGH',
        status: 'OPEN'
      });
    } finally {
      setLoading(false);
      stopLoading();
    }
  };

  return (
    <div className="min-h-screen bg-[#140d2d] flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 relative overflow-hidden transition-colors selection:bg-purple-500/30 selection:text-white pt-safe pb-safe">
      {/* Lumina Aurora Diagonal Base & Multi-Layered Ambient Radial Glows */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a103c] via-[#241349] to-[#120a26] pointer-events-none" />
      <div className="absolute -top-32 right-0 w-[680px] sm:w-[850px] h-[580px] sm:h-[750px] rounded-full bg-gradient-to-br from-[#b862ff]/28 to-[#ff5db1]/20 blur-[130px] pointer-events-none" />
      <div className="absolute top-1/3 -right-20 w-[460px] sm:w-[600px] h-[460px] sm:h-[600px] rounded-full bg-gradient-to-bl from-[#38bdf8]/20 via-[#818cf8]/15 to-transparent blur-[140px] pointer-events-none" />
      <div className="absolute -bottom-36 -left-20 w-[560px] sm:w-[780px] h-[560px] sm:h-[780px] rounded-full bg-gradient-to-tr from-[#6366f1]/25 via-[#a855f7]/20 to-transparent blur-[150px] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.05)_0%,_transparent_60%)] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        {/* Brand Header */}
        <div className="text-center mb-6 flex flex-col items-center">
          <div className="mb-4 transform hover:scale-105 transition-transform duration-300">
            <MoraJawsLogo size="lg" showText={true} animated={true} />
          </div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white/[0.10] backdrop-blur-md border border-white/[0.16] rounded-full text-cyan-200 text-xs font-semibold shadow-sm">
            <Server className="w-3.5 h-3.5 text-[#5de6ff]" />
            <span>Dispatch & Work Order Management System</span>
          </div>

          <p className="text-xs sm:text-sm text-white/65 mt-2.5 max-w-sm mx-auto leading-relaxed">
            Masukkan identitas akun resmi MoraJaws. Hak akses dan peran staf diverifikasi melalui Supabase Auth.
          </p>
        </div>

        {/* Login Card: Lumina Aurora Frosted Glass */}
        <div className="w-full bg-white/[0.07] border border-white/[0.14] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.2)] p-5 sm:p-8 backdrop-blur-2xl relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#5de6ff]/50 to-transparent" />
          {error && (
            <div className="mb-5 p-3.5 bg-rose-950/60 border border-rose-800/80 rounded-xl flex items-start gap-3 text-xs text-rose-200 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* Supabase Auth Gateway Notice */}
          <div className="mb-5 p-3.5 bg-white/[0.05] border border-white/[0.12] rounded-xl flex items-center gap-3 text-xs text-white/90 backdrop-blur-md">
            <ShieldCheck className="w-5 h-5 text-[#5de6ff] shrink-0" />
            <div className="leading-snug">
              <span className="font-bold text-white block">Portal Autentikasi Staf MoraJaws</span>
              <span className="text-white/55 text-[11px]">MoraJaws Custom Authentication &amp; Supabase PostgreSQL</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username / Email field */}
            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                Nama Pengguna atau Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  autoFocus
                  required
                  autoComplete="username"
                  placeholder="Masukkan nama pengguna atau email"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 min-h-[44px] bg-white/[0.06] border border-white/[0.15] rounded-xl text-sm sm:text-xs font-medium text-white placeholder-white/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] focus:outline-hidden focus:ring-2 focus:ring-purple-400/50 focus:bg-white/[0.10] transition-all"
                />
              </div>
            </div>

            {/* Password field with show/hide toggle */}
            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                Kata Sandi
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-white/45">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Masukkan kata sandi akun"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-10 pr-11 py-2.5 min-h-[44px] bg-white/[0.06] border border-white/[0.15] rounded-xl text-sm sm:text-xs font-medium text-white placeholder-white/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] focus:outline-hidden focus:ring-2 focus:ring-purple-400/50 focus:bg-white/[0.10] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 min-w-[44px] flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer"
                  title={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember session checkbox */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer select-none text-white/75 min-h-[36px]">
                <input
                  type="checkbox"
                  checked={rememberSession}
                  onChange={e => setRememberSession(e.target.checked)}
                  className="w-4 h-4 rounded border-white/25 bg-white/10 text-purple-500 focus:ring-purple-400"
                />
                <span>Simpan sesi aktif terproteksi</span>
              </label>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 min-h-[48px] py-3 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-[#8c4bf0] to-indigo-600 hover:brightness-110 border border-purple-300/30 shadow-[0_4px_16px_rgba(147,51,234,0.4)] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Memverifikasi Sesi...</span>
                </>
              ) : (
                <>
                  <span>Masuk ke Sistem</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {tokenSuccess && !tokenMode && (
            <div className="mt-4 p-3 rounded-xl bg-emerald-950/60 border border-emerald-700/60 text-emerald-200 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{tokenSuccess}</span>
            </div>
          )}

          {!tokenMode ? (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setTokenIdentifier(username);
                  setTokenError(null);
                  setTokenSuccess(null);
                  setTokenMode(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200/90 hover:text-cyan-100 underline underline-offset-4 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Punya Token Reset Sandi? Atur Ulang Kata Sandi</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleTokenResetSubmit} className="mt-5 pt-5 border-t border-white/15 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-[#5de6ff]" />
                  <span>Pemulihan Sandi dengan Token Satu-Kali</span>
                </span>
                <button
                  type="button"
                  onClick={() => setTokenMode(false)}
                  className="text-white/60 hover:text-white cursor-pointer"
                >
                  Tutup
                </button>
              </div>

              {tokenError && (
                <div className="p-2.5 bg-rose-950/60 border border-rose-800/80 rounded-xl text-rose-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{tokenError}</span>
                </div>
              )}

              <input
                type="text"
                required
                placeholder="Username atau Email"
                value={tokenIdentifier}
                onChange={e => setTokenIdentifier(e.target.value)}
                className="w-full px-3 py-2 min-h-[40px] bg-white/[0.06] border border-white/[0.15] rounded-xl text-white placeholder-white/40"
              />

              <input
                type="text"
                required
                placeholder="Tempel Token Reset dari Superadmin"
                value={resetTokenInput}
                onChange={e => setResetTokenInput(e.target.value)}
                className="w-full px-3 py-2 min-h-[40px] bg-white/[0.06] border border-white/[0.15] rounded-xl text-white font-mono placeholder-white/40"
              />

              <div className="relative">
                <input
                  type={showTokenNewPassword ? 'text' : 'password'}
                  required
                  maxLength={MAX_PASSWORD_LENGTH}
                  placeholder={`Kata Sandi Baru (Maks. ${MAX_PASSWORD_LENGTH} karakter)`}
                  value={tokenNewPassword}
                  onChange={e => setTokenNewPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                  className="w-full pl-3 pr-10 py-2 min-h-[40px] bg-white/[0.06] border border-white/[0.15] rounded-xl text-white placeholder-white/40"
                />
                <button
                  type="button"
                  onClick={() => setShowTokenNewPassword(v => !v)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/60 hover:text-white cursor-pointer"
                  tabIndex={-1}
                >
                  {showTokenNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <input
                type="password"
                required
                maxLength={MAX_PASSWORD_LENGTH}
                placeholder="Konfirmasi Kata Sandi Baru"
                value={tokenConfirmPassword}
                onChange={e => setTokenConfirmPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                className="w-full px-3 py-2 min-h-[40px] bg-white/[0.06] border border-white/[0.15] rounded-xl text-white placeholder-white/40"
              />

              {tokenNewPassword && (
                <div className="p-2.5 rounded-xl bg-black/25 border border-white/10 space-y-1 text-[11px]">
                  {tokenPolicy.rules.map(r => (
                    <div key={r.id} className={`flex items-center gap-1.5 ${r.passed ? 'text-emerald-300' : 'text-white/55'}`}>
                      {r.passed ? <Check className="w-3 h-3 shrink-0" /> : <X className="w-3 h-3 shrink-0" />}
                      <span>{r.label}</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={tokenSubmitting}
                className="w-full min-h-[40px] py-2 px-4 rounded-xl font-bold text-white bg-gradient-to-r from-[#5de6ff]/30 to-[#8c4bf0] border border-cyan-300/30 hover:brightness-110 cursor-pointer disabled:opacity-50"
              >
                {tokenSubmitting ? 'Memvalidasi Token...' : 'Tetapkan Kata Sandi Baru'}
              </button>
            </form>
          )}

          {/* Security footnote */}
          <div className="mt-6 pt-5 border-t border-white/10 text-center">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-white/55">
              <Lock className="w-3.5 h-3.5 text-[#5de6ff]" />
              <span>Akses dibatasi hanya untuk staf berwenang. Semua aktivitas diaudit.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

