import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  X,
  RotateCcw,
  Check,
  MapPin,
  RefreshCw,
  AlertTriangle,
  Satellite,
  SwitchCamera,
  ShieldAlert,
  Clock,
  Upload
} from 'lucide-react';
import {
  GpsPositionSnapshot,
  GpsSignalIndicator,
  acquireCurrentDeviceGps,
  applyGeoTagWatermarkToCanvas,
  buildGpsSnapshotFromCoords,
  queryLocationPermissionStatus
} from '../../services/geolocationService.ts';
import { formatCoordinates, isValidCoordinatePair } from '../../services/mapsService.ts';
import { GeoLocationMiniMap } from '../maps/GeoLocationMiniMap.tsx';
import { TechnicalPhotoSlotKey } from '../../types/index.ts';
import { formatJakartaTimeOnly } from '../../services/workSessionService.ts';

export interface CapturedPhotoPayload {
  slotKey: TechnicalPhotoSlotKey;
  title: string;
  fileData: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  capturedAtIso: string;
  captureMethod: 'camera' | 'gallery';
  gps?: GpsPositionSnapshot | null;
  clientCaptureId: string;
}

interface GeoTagCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  slotKey: TechnicalPhotoSlotKey;
  slotTitle: string;
  slotHint?: string;
  woNumber: string;
  technicianName: string;
  customerName?: string;
  onConfirmPhoto: (payload: CapturedPhotoPayload) => Promise<void> | void;
}

export const GeoTagCameraModal: React.FC<GeoTagCameraModalProps> = ({
  isOpen,
  onClose,
  slotKey,
  slotTitle,
  slotHint,
  woNumber,
  technicianName,
  customerName,
  onConfirmPhoto
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'initializing' | 'ready' | 'error'>('initializing');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string>('');

  const [gpsState, setGpsState] = useState<GpsSignalIndicator>('WAITING_GPS');
  const [gpsSnapshot, setGpsSnapshot] = useState<GpsPositionSnapshot | null>(null);
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string>('');
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);

  const [rawCapturedCanvasData, setRawCapturedCanvasData] = useState<{
    cleanDataUrl: string;
    watermarkedDataUrl: string;
    capturedAtIso: string;
    captureMethod: 'camera' | 'gallery';
    gpsAtCapture: GpsPositionSnapshot | null;
    fileSizeBytes: number;
    fileName: string;
  } | null>(null);

  const [includeWatermark, setIncludeWatermark] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopGpsWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch {}
      watchIdRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async (targetFacing: 'environment' | 'user') => {
    stopCameraStream();
    setCameraState('initializing');
    setCameraErrorMsg('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      setCameraErrorMsg('Browser ini tidak mendukung akses kamera langsung (getUserMedia).');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraState('ready');
    } catch (err: any) {
      let msg = 'Kamera perangkat tidak dapat dibuka.';
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        msg = 'Izin kamera ditolak oleh pengguna atau browser. Berikan izin kamera agar dokumentasi lapangan dapat diambil.';
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        msg = 'Tidak ada perangkat kamera yang terdeteksi pada perangkat ini.';
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        msg = 'Kamera sedang digunakan oleh aplikasi lain.';
      } else if (err?.message) {
        msg = `Gagal membuka kamera: ${err.message}`;
      }
      setCameraState('error');
      setCameraErrorMsg(msg);
    }
  }, [stopCameraStream]);

  const startGpsTracking = useCallback(async () => {
    stopGpsWatch();
    setGpsErrorMsg('');
    setGpsState('WAITING_GPS');

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsState('GPS_UNAVAILABLE');
      setGpsErrorMsg('Perangkat tidak mendukung Geolocation GPS.');
      return;
    }

    const perm = await queryLocationPermissionStatus();
    if (perm === 'denied') {
      setGpsState('PERMISSION_DENIED');
      setGpsErrorMsg('Izin lokasi ditolak. Aktifkan izin lokasi pada browser/perangkat.');
      return;
    }

    const initial = await acquireCurrentDeviceGps({ timeoutMs: 8000, maximumAgeMs: 0 });
    if (initial.snapshot) {
      setGpsSnapshot(initial.snapshot);
      setGpsState(initial.snapshot.signalIndicator);
    } else if (initial.errorCode === 'PERMISSION_DENIED') {
      setGpsState('PERMISSION_DENIED');
      setGpsErrorMsg(initial.errorMessage || 'Izin lokasi ditolak.');
      return;
    }

    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        pos => {
          const snap = buildGpsSnapshotFromCoords(pos.coords, 'granted');
          if (snap) {
            setGpsSnapshot(snap);
            setGpsState(snap.signalIndicator);
            setGpsErrorMsg('');
          }
        },
        err => {
          if (err.code === err.PERMISSION_DENIED) {
            setGpsState('PERMISSION_DENIED');
            setGpsErrorMsg('Izin lokasi ditolak oleh pengguna.');
          } else if (!gpsSnapshot) {
            setGpsState(err.code === err.TIMEOUT ? 'GPS_WEAK_SIGNAL' : 'GPS_UNAVAILABLE');
            setGpsErrorMsg('Menunggu sinyal GPS yang lebih stabil...');
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    } catch {}
  }, [stopGpsWatch, gpsSnapshot]);

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      stopGpsWatch();
      setRawCapturedCanvasData(null);
      return;
    }

    setRawCapturedCanvasData(null);
    startCamera(facingMode);
    startGpsTracking();

    return () => {
      stopCameraStream();
      stopGpsWatch();
    };
  }, [isOpen]);

  const handleToggleCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    startCamera(next);
  };

  const handleRefreshGps = async () => {
    if (isRefreshingGps) return;
    setIsRefreshingGps(true);
    setGpsErrorMsg('');
    const res = await acquireCurrentDeviceGps({ timeoutMs: 10000, maximumAgeMs: 0 });
    if (res.snapshot) {
      setGpsSnapshot(res.snapshot);
      setGpsState(res.snapshot.signalIndicator);
    } else if (res.errorCode) {
      setGpsState(res.errorCode);
      setGpsErrorMsg(res.errorMessage || 'Gagal memperbarui lokasi GPS.');
    }
    setIsRefreshingGps(false);
  };

  const renderPreviewPairFromImageSource = (
    drawSource: CanvasImageSource,
    srcW: number,
    srcH: number,
    captureMethod: 'camera' | 'gallery',
    gpsAtCapture: GpsPositionSnapshot | null
  ) => {
    const maxDim = 1440;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH, 1));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const capturedAtIso = new Date().toISOString();

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = w;
    cleanCanvas.height = h;
    const cleanCtx = cleanCanvas.getContext('2d');
    if (cleanCtx) {
      cleanCtx.drawImage(drawSource, 0, 0, w, h);
    }
    const cleanDataUrl = cleanCanvas.toDataURL('image/jpeg', 0.82);

    const wmCanvas = document.createElement('canvas');
    wmCanvas.width = w;
    wmCanvas.height = h;
    const wmCtx = wmCanvas.getContext('2d');
    if (wmCtx) {
      wmCtx.drawImage(drawSource, 0, 0, w, h);
      applyGeoTagWatermarkToCanvas(wmCanvas, {
        woNumber,
        slotTitle,
        technicianName,
        customerName,
        capturedAtIso,
        latitude: gpsAtCapture?.latitude,
        longitude: gpsAtCapture?.longitude,
        accuracyMeters: gpsAtCapture?.accuracyMeters,
        geotagStatus: gpsAtCapture?.geotagStatus
      });
    }
    const watermarkedDataUrl = wmCanvas.toDataURL('image/jpeg', 0.84);
    const approxBytes = Math.round(((watermarkedDataUrl.split(',')[1] || '').length * 3) / 4);

    setRawCapturedCanvasData({
      cleanDataUrl,
      watermarkedDataUrl,
      capturedAtIso,
      captureMethod,
      gpsAtCapture,
      fileSizeBytes: approxBytes,
      fileName: `${woNumber}_${slotKey}_${Date.now()}.jpg`
    });
  };

  const handleTakePhoto = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    // Grab the freshest GPS snapshot right at shutter press if not already locked
    let activeGps = gpsSnapshot;
    if (!activeGps) {
      const quickGps = await acquireCurrentDeviceGps({ timeoutMs: 3500, maximumAgeMs: 5000 });
      if (quickGps.snapshot) {
        activeGps = quickGps.snapshot;
        setGpsSnapshot(quickGps.snapshot);
        setGpsState(quickGps.snapshot.signalIndicator);
      }
    }

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    renderPreviewPairFromImageSource(video, srcW, srcH, 'camera', activeGps);
    stopCameraStream();
  };

  const handleFallbackCaptureFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    let activeGps = gpsSnapshot;
    if (!activeGps) {
      const quickGps = await acquireCurrentDeviceGps({ timeoutMs: 4000, maximumAgeMs: 5000 });
      if (quickGps.snapshot) {
        activeGps = quickGps.snapshot;
        setGpsSnapshot(quickGps.snapshot);
        setGpsState(quickGps.snapshot.signalIndicator);
      }
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        renderPreviewPairFromImageSource(
          img,
          img.naturalWidth || img.width,
          img.naturalHeight || img.height,
          'camera',
          activeGps
        );
        stopCameraStream();
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRetake = () => {
    setRawCapturedCanvasData(null);
    startCamera(facingMode);
    if (!gpsSnapshot) {
      startGpsTracking();
    }
  };

  const handleConfirm = async () => {
    if (!rawCapturedCanvasData || isConfirming) return;
    setIsConfirming(true);
    try {
      const chosenDataUrl = includeWatermark
        ? rawCapturedCanvasData.watermarkedDataUrl
        : rawCapturedCanvasData.cleanDataUrl;
      const approxBytes = Math.round(((chosenDataUrl.split(',')[1] || '').length * 3) / 4);
      await onConfirmPhoto({
        slotKey,
        title: slotTitle,
        fileData: chosenDataUrl,
        fileName: rawCapturedCanvasData.fileName,
        fileSizeBytes: approxBytes,
        mimeType: 'image/jpeg',
        capturedAtIso: rawCapturedCanvasData.capturedAtIso,
        captureMethod: rawCapturedCanvasData.captureMethod,
        gps: rawCapturedCanvasData.gpsAtCapture,
        clientCaptureId: `cap_${woNumber}_${slotKey}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      });
      onClose();
    } finally {
      setIsConfirming(false);
    }
  };

  if (!isOpen) return null;

  const isAutoLocationSlot = slotKey === 'customer_house' || slotKey === 'fat_attenuation';
  const activeGpsForBanner = rawCapturedCanvasData ? rawCapturedCanvasData.gpsAtCapture : gpsSnapshot;
  const hasValidGps = Boolean(
    activeGpsForBanner && isValidCoordinatePair(activeGpsForBanner.latitude, activeGpsForBanner.longitude)
  );

  const gpsBadgeConfig = (() => {
    if (gpsState === 'GPS_ACQUIRED' && activeGpsForBanner) {
      return {
        cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
        label: `GPS Acquired (±${Math.round(activeGpsForBanner.accuracyMeters)}m)`
      };
    }
    if (gpsState === 'GPS_WEAK_SIGNAL' && activeGpsForBanner) {
      return {
        cls: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
        label: `GPS Weak Signal (±${Math.round(activeGpsForBanner.accuracyMeters)}m)`
      };
    }
    if (gpsState === 'PERMISSION_DENIED') {
      return {
        cls: 'bg-rose-500/25 text-rose-200 border-rose-400/50',
        label: 'Location Permission Denied'
      };
    }
    if (gpsState === 'GPS_UNAVAILABLE') {
      return {
        cls: 'bg-rose-500/25 text-rose-200 border-rose-400/50',
        label: 'GPS Unavailable'
      };
    }
    return {
      cls: 'bg-blue-500/20 text-blue-200 border-blue-400/40',
      label: 'Waiting for GPS...'
    };
  })();

  const previewUrl = rawCapturedCanvasData
    ? includeWatermark
      ? rawCapturedCanvasData.watermarkedDataUrl
      : rawCapturedCanvasData.cleanDataUrl
    : '';

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[96vh] bg-[#0B1222] text-white sm:rounded-2xl rounded-t-2xl border border-slate-700/80 shadow-2xl flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="px-4 py-3 bg-[#0F172A] border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-blue-400 shrink-0" />
              <h3 className="font-display font-bold text-sm text-white truncate">{slotTitle}</h3>
            </div>
            <p className="font-mono text-[10px] text-slate-400 truncate">
              WO: {woNumber} {slotHint ? `• ${slotHint}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Tutup Kamera"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live GPS Status Strip */}
        <div className="px-4 py-2 bg-[#0D162B] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-bold flex items-center gap-1.5 ${gpsBadgeConfig.cls}`}>
            <Satellite className={`w-3.5 h-3.5 ${gpsState === 'WAITING_GPS' ? 'animate-pulse' : ''}`} />
            <span>{gpsBadgeConfig.label}</span>
          </div>

          <div className="flex items-center gap-2">
            {hasValidGps && activeGpsForBanner && (
              <span className="font-mono text-[10.5px] text-slate-300 tabular-nums">
                {formatCoordinates(activeGpsForBanner.latitude, activeGpsForBanner.longitude)}
              </span>
            )}
            <button
              type="button"
              onClick={handleRefreshGps}
              disabled={isRefreshingGps}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-[10.5px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Refresh GPS"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshingGps ? 'animate-spin' : ''}`} />
              <span>Refresh GPS</span>
            </button>
          </div>
        </div>

        {/* Auto WO Location Banner for Foto Rumah & Foto Redaman FAT */}
        {isAutoLocationSlot && (
          <div className="px-4 py-2 bg-blue-950/60 border-b border-blue-800/60 flex items-start gap-2 text-[11px] text-blue-200 shrink-0">
            <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
            <span>
              {slotKey === 'customer_house'
                ? 'Koordinat GPS dari Foto Rumah akan otomatis memperbarui field Lokasi Rumah pada Work Order.'
                : 'Koordinat GPS dari Foto Redaman FAT akan otomatis memperbarui field Lokasi FAT pada Work Order.'}
            </span>
          </div>
        )}

        {/* Body Stage */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {!rawCapturedCanvasData ? (
            <>
              {/* Live Camera Viewport */}
              <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-black border border-slate-700 flex items-center justify-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraState === 'ready' ? 'block' : 'hidden'}`}
                />

                {cameraState === 'initializing' && (
                  <div className="flex flex-col items-center gap-2 text-slate-300 text-xs">
                    <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
                    <span>Mengaktifkan kamera belakang...</span>
                  </div>
                )}

                {cameraState === 'error' && (
                  <div className="p-5 text-center space-y-3 max-w-sm">
                    <div className="w-11 h-11 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 flex items-center justify-center mx-auto">
                      <ShieldAlert className="w-5 h-5" />
                    </div>
                    <div className="text-xs text-rose-200 font-semibold leading-relaxed">
                      {cameraErrorMsg}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => startCamera(facingMode)}
                        className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Coba Buka Kamera Lagi</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => fallbackInputRef.current?.click()}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Kamera Native / File</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Camera Switcher Button */}
                {cameraState === 'ready' && (
                  <button
                    type="button"
                    onClick={handleToggleCamera}
                    className="absolute top-2.5 right-2.5 px-2.5 py-1.5 rounded-lg bg-slate-950/75 hover:bg-slate-900 text-white border border-white/20 text-[10.5px] font-semibold flex items-center gap-1.5 cursor-pointer backdrop-blur-xs"
                  >
                    <SwitchCamera className="w-3.5 h-3.5 text-blue-300" />
                    <span>{facingMode === 'environment' ? 'Kamera Belakang' : 'Kamera Depan'}</span>
                  </button>
                )}

                {/* Subtle Live Geotag HUD on Viewfinder */}
                {cameraState === 'ready' && (
                  <div className="absolute inset-x-2.5 bottom-2.5 px-2.5 py-1.5 rounded-lg bg-slate-950/75 border border-white/10 backdrop-blur-xs text-[10px] font-mono text-slate-200 flex items-center justify-between gap-2 pointer-events-none">
                    <span className="truncate">
                      {hasValidGps && activeGpsForBanner
                        ? `${formatCoordinates(activeGpsForBanner.latitude, activeGpsForBanner.longitude)} (±${Math.round(activeGpsForBanner.accuracyMeters)}m)`
                        : 'GPS: Mencari posisi perangkat...'}
                    </span>
                    <span className="text-blue-300 shrink-0">{woNumber}</span>
                  </div>
                )}
              </div>

              <input
                ref={fallbackInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFallbackCaptureFile}
                className="hidden"
              />

              {gpsErrorMsg && (
                <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-700/60 text-[11px] text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>{gpsErrorMsg}</span>
                </div>
              )}
            </>
          ) : (
            /* Preview & Geotag Confirmation Step */
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-black">
                <img
                  src={previewUrl}
                  alt={slotTitle}
                  className="w-full max-h-[42vh] object-contain mx-auto"
                />
              </div>

              {/* Watermark Toggle & Metadata Summary */}
              <div className="p-3 rounded-xl bg-[#0F172A] border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-slate-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    <span>Diambil: {formatJakartaTimeOnly(rawCapturedCanvasData.capturedAtIso)} WIB</span>
                  </span>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeWatermark}
                      onChange={e => setIncludeWatermark(e.target.checked)}
                      className="rounded accent-blue-500"
                    />
                    <span>Watermark Geotag</span>
                  </label>
                </div>

                {hasValidGps && activeGpsForBanner ? (
                  <GeoLocationMiniMap
                    latitude={activeGpsForBanner.latitude}
                    longitude={activeGpsForBanner.longitude}
                    accuracyMeters={activeGpsForBanner.accuracyMeters}
                    geotagStatus={activeGpsForBanner.geotagStatus}
                    label={slotTitle}
                    markerVariant={
                      slotKey === 'customer_house'
                        ? 'house'
                        : slotKey === 'fat_attenuation'
                        ? 'fat'
                        : 'photo'
                    }
                    heightClass="h-32"
                    compact
                  />
                ) : (
                  <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-700/60 text-[11px] text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Koordinat GPS tidak tersedia pada foto ini. Status geotag akan dicatat sebagai <strong>Geotag Missing</strong>
                      {isAutoLocationSlot ? ' dan lokasi WO tidak akan diperbarui otomatis.' : '.'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="px-4 py-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] bg-[#0F172A] border-t border-slate-800 shrink-0">
          {!rawCapturedCanvasData ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
              >
                Batal
              </button>

              <button
                type="button"
                disabled={cameraState !== 'ready'}
                onClick={handleTakePhoto}
                className="flex-1 max-w-[220px] min-h-[48px] px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg cursor-pointer"
              >
                <Camera className="w-5 h-5" />
                <span>Take Photo</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={isConfirming}
                onClick={handleRetake}
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retake</span>
              </button>
              <button
                type="button"
                disabled={isConfirming}
                onClick={handleConfirm}
                className="flex-[1.5] min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg cursor-pointer disabled:opacity-60"
              >
                {isConfirming ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>{isConfirming ? 'Mengunggah...' : 'Confirm Photo'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
