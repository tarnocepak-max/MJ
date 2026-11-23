import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Navigation,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  LocateFixed,
  CloudUpload
} from 'lucide-react';
import {
  installerGpsTracker,
  type InstallerGpsUiSnapshot
} from '../../services/installerGpsTrackingService';
import { useToast } from '../../context/ToastContext';

export const InstallerGpsSyncWidget: React.FC = () => {
  const { toast } = useToast();
  const [snap, setSnap] = useState<InstallerGpsUiSnapshot>(() => installerGpsTracker.getSnapshot());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unsubState = installerGpsTracker.subscribe(nextSnap => {
      setSnap(nextSnap);
    });
    const unsubToasts = installerGpsTracker.subscribeToasts(evt => {
      if (evt.type === 'success') {
        toast.success(evt.message, evt.title, {
          badge: evt.badge,
          withSound: true
        });
      } else if (evt.type === 'warning') {
        toast.warning(evt.message, evt.title, {
          badge: evt.badge,
          duration: 6000,
          withSound: true
        });
      } else if (evt.type === 'error') {
        toast.error(evt.message, evt.title, {
          badge: evt.badge,
          withSound: true
        });
      } else {
        toast.sync(evt.message, evt.title, {
          badge: evt.badge,
          withSound: false
        });
      }
    });

    return () => {
      unsubState();
      unsubToasts();
    };
  }, [toast]);

  if (!snap.active) return null;

  const isConnected = snap.stage === 'LOCATION_CONNECTED' && snap.locationStatus === 'Location Fresh';
  const isError =
    snap.stage === 'LOCATION_ERROR' ||
    snap.locationStatus === 'Permission Denied' ||
    snap.locationStatus === 'GPS Disabled' ||
    snap.locationStatus === 'No Signal';

  const pulseDotColor = isConnected
    ? 'bg-emerald-500'
    : isError
    ? 'bg-amber-500'
    : 'bg-[#6657C8] dark:bg-[#7135B5]';

  const statusPillClass = isConnected
    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30'
    : isError
    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-400/35'
    : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] border-[#C5BEEF] dark:border-[#7135B5]/40';

  const handleManualSync = async () => {
    const res = await installerGpsTracker.connectAndSyncNow();
    if (res.ok) {
      toast.success(res.message, 'Sinkronisasi GPS Berhasil', {
        badge: 'MAPS MONITOR LIVE',
        withSound: true
      });
    } else {
      toast.warning(res.message, 'Sinkronisasi GPS Tertunda', {
        badge: 'GPS STATUS',
        duration: 5000
      });
    }
  };

  return (
    <div
      className="fixed bottom-[76px] right-3 sm:bottom-5 sm:right-5 z-[1100] flex flex-col items-end max-w-[calc(100vw-24px)] sm:max-w-[320px]"
      data-testid="installer-gps-sync-widget"
    >
      {expanded && (
        <div className="mb-2 w-[300px] sm:w-[316px] rounded-2xl border border-[#DDE6F0] dark:border-[#35105E] bg-white/95 dark:bg-[#160D29]/95 backdrop-blur-md shadow-xl p-3.5 text-left transition-all">
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#E2E8F0] dark:border-[#35105E]">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pulseDotColor}`}
                  />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${pulseDotColor}`} />
                </span>
                <span className="text-[10px] font-bold tracking-wider uppercase text-[#5145A6] dark:text-[#DAB9FF]">
                  {snap.stageBadge}
                </span>
              </div>
              <p className="mt-0.5 text-xs font-bold text-[#26364A] dark:text-white truncate">
                {snap.headline}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="p-1 rounded-lg hover:bg-[#EDF3F8] dark:hover:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] cursor-pointer"
              title="Perkecil panel GPS"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-[#52647A] dark:text-[#CFC2E8]">
            {snap.detail}
          </p>

          {/* Two Strictly Decoupled Telemetry Badges */}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <div className="rounded-xl bg-[#F4F7FB] dark:bg-[#22153D] border border-[#DDE6F0] dark:border-[#35105E] px-2.5 py-1.5">
              <span className="block text-[9px] font-semibold uppercase tracking-wide text-[#8492A5] dark:text-[#A996CE]">
                Status Sesi
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-[#26364A] dark:text-white">
                {snap.onlineStatus === 'Online' ? (
                  <Wifi className="w-3 h-3 text-emerald-500" />
                ) : (
                  <WifiOff className="w-3 h-3 text-slate-400" />
                )}
                {snap.onlineStatus}
              </span>
            </div>

            <div className="rounded-xl bg-[#F4F7FB] dark:bg-[#22153D] border border-[#DDE6F0] dark:border-[#35105E] px-2.5 py-1.5">
              <span className="block text-[9px] font-semibold uppercase tracking-wide text-[#8492A5] dark:text-[#A996CE]">
                Status Lokasi
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-[#26364A] dark:text-white truncate">
                {isConnected ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                ) : isError ? (
                  <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                ) : (
                  <Navigation className="w-3 h-3 text-[#6657C8] dark:text-[#7135B5] shrink-0" />
                )}
                <span className="truncate">{snap.locationStatus}</span>
              </span>
            </div>
          </div>

          {snap.latitude !== null && snap.longitude !== null && (
            <div className="mt-2 rounded-xl bg-[#F4F7FB] dark:bg-[#22153D] border border-[#DDE6F0] dark:border-[#35105E] px-2.5 py-1.5 flex items-center justify-between gap-2 text-[10px]">
              <span className="font-mono text-[#26364A] dark:text-[#E5D7FF] truncate">
                {snap.latitude.toFixed(6)}, {snap.longitude.toFixed(6)}
              </span>
              <span className="shrink-0 font-semibold text-[#5145A6] dark:text-[#DAB9FF]">
                ±{snap.accuracyMeters ?? '?'}m
              </span>
            </div>
          )}

          {isConnected && (
            <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-400/30 px-2.5 py-1.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
              <span>Tersinkron Realtime ke Monitoring Maps</span>
            </div>
          )}

          {snap.queuedPointsCount > 0 && (
            <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-amber-500/10 border border-amber-400/30 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
              <CloudUpload className="w-3.5 h-3.5 shrink-0" />
              <span>{snap.queuedPointsCount} koordinat antre sinkronisasi</span>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            {isError ? (
              <button
                type="button"
                disabled={snap.isBusy}
                onClick={() => void handleManualSync()}
                className="btn-3d-primary flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl disabled:opacity-65 disabled:cursor-wait text-white text-[11px] font-bold py-2 px-3 transition-colors shadow-sm cursor-pointer"
              >
                <LocateFixed className={`w-3.5 h-3.5 ${snap.isBusy ? 'animate-spin' : ''}`} />
                {snap.isBusy ? 'Menghubungkan GPS...' : 'Aktifkan / Coba Ulang GPS'}
              </button>
            ) : (
              <button
                type="button"
                disabled={snap.isBusy}
                onClick={() => void handleManualSync()}
                className="btn-3d-primary flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl disabled:opacity-65 disabled:cursor-wait text-white text-[11px] font-bold py-2 px-3 transition-colors shadow-sm cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${snap.isBusy ? 'animate-spin' : ''}`} />
                {snap.isBusy ? 'Menyinkronkan GPS...' : 'Sinkronkan Lokasi Sekarang'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Compact Minimal Pill Trigger */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className={`group flex items-center gap-2 rounded-2xl border px-3 py-1.5 shadow-lg backdrop-blur-md transition-all hover:scale-[1.01] ${statusPillClass}`}
        title="Status Live GPS Installer"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pulseDotColor}`}
          />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${pulseDotColor}`} />
        </span>
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[11px] font-bold tracking-tight whitespace-nowrap">
          {snap.locationStatus === 'Permission Denied'
            ? 'Location Permission Required'
            : snap.locationStatus}
        </span>
        {snap.queuedPointsCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-[9px] font-extrabold">
            {snap.queuedPointsCount}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 opacity-75 shrink-0" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 opacity-75 shrink-0" />
        )}
      </button>
    </div>
  );
};
