import React from 'react';
import {
  MapPin,
  LocateFixed,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Navigation,
  LogOut,
  RefreshCw,
  Wifi,
  WifiOff,
  Radio
} from 'lucide-react';
import {
  installerGpsTracker,
  type InstallerGpsUiSnapshot
} from '../../services/installerGpsTrackingService';
import { isValidCoordinatePair } from '../../services/mapsService';
import { useToast } from '../../context/ToastContext';
import type { User } from '../../types';

interface InstallerGpsGateProps {
  currentUser: User;
  gpsSnapshot: InstallerGpsUiSnapshot;
  onLogout: () => void;
}

export const InstallerGpsGate: React.FC<InstallerGpsGateProps> = ({
  currentUser,
  gpsSnapshot,
  onLogout
}) => {
  const { toast } = useToast();

  const hasPermission = gpsSnapshot.permissionState === 'granted';
  const isDeniedOrUnsupported =
    gpsSnapshot.permissionState === 'denied' ||
    gpsSnapshot.permissionState === 'unsupported' ||
    gpsSnapshot.locationStatus === 'Permission Denied' ||
    gpsSnapshot.locationStatus === 'GPS Disabled';
  const hasCoords = isValidCoordinatePair(gpsSnapshot.latitude, gpsSnapshot.longitude);
  const isSyncedToServer = Boolean(gpsSnapshot.lastSyncedAt) && gpsSnapshot.locationStatus === 'Location Fresh';

  const handleConnectGps = async () => {
    const res = await installerGpsTracker.connectAndSyncNow();
    if (res.ok) {
      toast.success(res.message, 'GPS Terhubung & Tersinkron', {
        badge: 'PORTAL TERBUKA',
        withSound: true
      });
    } else {
      toast.warning(res.message, 'GPS Belum Terhubung', {
        badge: 'VERIFIKASI GPS',
        duration: 5000
      });
    }
  };

  return (
    <div className="min-h-dvh w-full mj-aurora-bg text-[#1f1638] dark:text-[#f3effc] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-lg card-3d-lavender rounded-3xl p-5 sm:p-7 border border-[#D8C5FF] dark:border-[#35105E] shadow-2xl">
        {/* Top Badge & Logout */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#E8DDFF] dark:border-[#35105E]">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-[#58149C]/10 dark:bg-[#7135B5]/25 border border-[#7135B5]/25 text-[#58149C] dark:text-[#DAB9FF]">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span className="text-[11px] font-extrabold uppercase tracking-wider">
              Wajib Koneksi GPS Realtime
            </span>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#D8C5FF] dark:border-[#35105E] bg-white/70 dark:bg-[#22153D] hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold text-[#4E4266] dark:text-[#CFC2E8] hover:text-rose-600 dark:hover:text-rose-300 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar
          </button>
        </div>

        {/* Hero Heading & Identity */}
        <div className="mt-5 flex items-start gap-3.5">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-md ${
              isDeniedOrUnsupported
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-400/35'
                : 'bg-gradient-to-br from-[#58149C] to-[#7135B5] text-white'
            }`}
          >
            {isDeniedOrUnsupported ? (
              <AlertTriangle className="w-6 h-6" />
            ) : (
              <MapPin className="w-6 h-6" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-[#1f1638] dark:text-white">
              Aktifkan GPS Sebelum Masuk Portal Installer
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-[#4E4266] dark:text-[#CFC2E8]">
              Demi akurasi penugasan lapangan dan pemantauan posisi pada{' '}
              <span className="font-bold text-[#58149C] dark:text-[#DAB9FF]">Monitoring Maps</span>,
              portal kerja Installer hanya dapat diakses setelah perangkat terhubung dengan GPS aktif.
            </p>
          </div>
        </div>

        {/* Installer Profile Strip */}
        <div className="mt-4 rounded-2xl bg-white/75 dark:bg-[#22153D]/80 border border-[#E8DDFF] dark:border-[#35105E] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#1f1638] dark:text-white truncate">
              {currentUser.name}
            </p>
            <p className="text-[11px] text-[#6A5A8C] dark:text-[#B6A5D8] truncate">
              @{currentUser.username}
              {currentUser.contractor ? ` · ${currentUser.contractor}` : ''}
              {currentUser.area ? ` · ${currentUser.area}` : ''}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold border ${
              gpsSnapshot.onlineStatus === 'Online'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-400/30'
                : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-400/30'
            }`}
          >
            {gpsSnapshot.onlineStatus === 'Online' ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            {gpsSnapshot.onlineStatus}
          </span>
        </div>

        {/* 3-Step Verification Progress */}
        <div className="mt-4 space-y-2.5">
          {/* Step 1: Browser Location Permission */}
          <div className="rounded-2xl bg-white/80 dark:bg-[#22153D]/70 border border-[#E8DDFF] dark:border-[#35105E] px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                  hasPermission
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                    : isDeniedOrUnsupported
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                    : 'bg-[#E8DDFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1f1638] dark:text-white">
                  1. Izin Lokasi Browser
                </p>
                <p className="text-[11px] text-[#6A5A8C] dark:text-[#B6A5D8] truncate">
                  {hasPermission
                    ? 'Izin lokasi diizinkan'
                    : isDeniedOrUnsupported
                    ? 'Izin ditolak atau layanan lokasi nonaktif'
                    : 'Menunggu persetujuan izin lokasi'}
                </p>
              </div>
            </div>
            <span
              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-lg shrink-0 ${
                hasPermission
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : isDeniedOrUnsupported
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-[#E8DDFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
              }`}
            >
              {hasPermission ? 'OK' : isDeniedOrUnsupported ? 'TERBLOKIR' : 'MENUNGGU'}
            </span>
          </div>

          {/* Step 2: Real Coordinates Lock */}
          <div className="rounded-2xl bg-white/80 dark:bg-[#22153D]/70 border border-[#E8DDFF] dark:border-[#35105E] px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                  hasCoords
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                    : 'bg-[#E8DDFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
                }`}
              >
                <Navigation className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1f1638] dark:text-white">
                  2. Kunci Koordinat GPS Perangkat
                </p>
                <p className="text-[11px] font-mono text-[#6A5A8C] dark:text-[#B6A5D8] truncate">
                  {hasCoords && gpsSnapshot.latitude !== null && gpsSnapshot.longitude !== null
                    ? `${gpsSnapshot.latitude.toFixed(6)}, ${gpsSnapshot.longitude.toFixed(6)} (±${gpsSnapshot.accuracyMeters ?? '?'}m)`
                    : 'Belum ada koordinat valid'}
                </p>
              </div>
            </div>
            <span
              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-lg shrink-0 ${
                hasCoords
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-[#E8DDFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
              }`}
            >
              {hasCoords ? 'TERKUNCI' : 'MENUNGGU'}
            </span>
          </div>

          {/* Step 3: Realtime Sync to Monitoring Maps */}
          <div className="rounded-2xl bg-white/80 dark:bg-[#22153D]/70 border border-[#E8DDFF] dark:border-[#35105E] px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                  isSyncedToServer
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                    : 'bg-[#E8DDFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1f1638] dark:text-white">
                  3. Sinkron Realtime ke Monitoring Maps
                </p>
                <p className="text-[11px] text-[#6A5A8C] dark:text-[#B6A5D8] truncate">
                  {isSyncedToServer
                    ? 'Posisi aktif terhubung ke server & peta monitoring'
                    : 'Menunggu pengiriman koordinat pertama ke server'}
                </p>
              </div>
            </div>
            <span
              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-lg shrink-0 ${
                isSyncedToServer
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-[#E8DDFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
              }`}
            >
              {isSyncedToServer ? 'LIVE' : 'BELUM'}
            </span>
          </div>
        </div>

        {/* Error / Instruction Banner */}
        {(gpsSnapshot.errorMessage || isDeniedOrUnsupported) && (
          <div className="mt-4 rounded-2xl bg-amber-500/10 border border-amber-400/35 p-3.5 text-left">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                <p className="font-bold">
                  {gpsSnapshot.headline || 'Koneksi GPS Diperlukan'}
                </p>
                <p className="mt-0.5">
                  {gpsSnapshot.errorMessage || gpsSnapshot.detail}
                </p>
                {isDeniedOrUnsupported && (
                  <p className="mt-1.5 text-[10px] opacity-90">
                    Tips: Klik ikon gembok / pengaturan situs di bilah alamat browser, ubah izin{' '}
                    <span className="font-bold">Lokasi / Location</span> menjadi{' '}
                    <span className="font-bold">Izinkan (Allow)</span>, aktifkan GPS perangkat, lalu
                    tekan tombol di bawah.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Primary Connect GPS Action */}
        <div className="mt-5">
          <button
            type="button"
            disabled={gpsSnapshot.isBusy}
            onClick={() => void handleConnectGps()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#58149C] to-[#7135B5] hover:from-[#671EB3] hover:to-[#8142CA] disabled:opacity-65 disabled:cursor-wait text-white text-sm font-extrabold py-3.5 px-5 shadow-lg shadow-[#58149C]/25 transition-all cursor-pointer"
          >
            {gpsSnapshot.isBusy ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Menghubungkan &amp; Menyinkronkan GPS...</span>
              </>
            ) : (
              <>
                <LocateFixed className="w-4 h-4" />
                <span>Hubungkan GPS &amp; Masuk Portal Installer</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
