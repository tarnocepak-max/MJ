import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Grid3x3,
  HelpCircle,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Satellite,
  ShieldCheck,
  SwitchCamera,
  TriangleAlert,
  X,
  Zap
} from 'lucide-react';
import { Ticket, TechnicalPhotoSlot, ChatAttachment } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
  GpsPositionSnapshot,
  GpsSignalIndicator,
  acquireCurrentDeviceGps,
  applyGeoTagWatermarkToCanvas,
  buildGpsSnapshotFromCoords,
  queryLocationPermissionStatus
} from '../../services/geolocationService.ts';
import {
  calculateHaversineDistanceMeters,
  formatCoordinates,
  formatDistanceMetersLabel,
  getTicketRegisteredCoordinates,
  isValidCoordinatePair
} from '../../services/mapsService.ts';
import { formatJakartaTimeOnly } from '../../services/workSessionService.ts';

interface GeoTagCameraCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: Ticket;
  onCheckInSuccess?: (updatedTicket?: Ticket) => void;
}

const GEOFENCE_SOP_LIMIT_METERS = 50;

export const GeoTagCameraCheckInModal: React.FC<GeoTagCameraCheckInModalProps> = ({
  isOpen,
  onClose,
  ticket,
  onCheckInSuccess
}) => {
  const { currentUser, uploadWoPhotoEvidence, sendTicketMessage } = useApp();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'initializing' | 'ready' | 'error'>('initializing');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string>('');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [zoomMode, setZoomMode] = useState<'1.0x' | '0.5x'>('1.0x');
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [showHelpTip, setShowHelpTip] = useState<boolean>(false);

  const [gpsState, setGpsState] = useState<GpsSignalIndicator>('WAITING_GPS');
  const [gpsSnapshot, setGpsSnapshot] = useState<GpsPositionSnapshot | null>(null);
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string>('');
  const [isRefreshingGps, setIsRefreshingGps] = useState<boolean>(false);
  const [nowIso, setNowIso] = useState<string>(() => new Date().toISOString());

  const [capturedPhoto, setCapturedPhoto] = useState<{
    cleanDataUrl: string;
    watermarkedDataUrl: string;
    capturedAtIso: string;
    gpsAtCapture: GpsPositionSnapshot | null;
    fileSizeBytes: number;
    fileName: string;
  } | null>(null);

  const [fieldNotes, setFieldNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitStepLabel, setSubmitStepLabel] = useState<string>('');

  const registeredCoords = useMemo(() => getTicketRegisteredCoordinates(ticket), [ticket]);

  const activeGps = capturedPhoto?.gpsAtCapture || gpsSnapshot;
  const hasValidGps = Boolean(activeGps && isValidCoordinatePair(activeGps.latitude, activeGps.longitude));

  const distanceToRegisteredMeters = useMemo(() => {
    if (!hasValidGps || !activeGps || !registeredCoords) return null;
    return calculateHaversineDistanceMeters(
      registeredCoords.latitude,
      registeredCoords.longitude,
      activeGps.latitude,
      activeGps.longitude
    );
  }, [hasValidGps, activeGps, registeredCoords]);

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
    setTorchEnabled(false);
    setTorchSupported(false);
  }, []);

  const stopGpsWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch {}
      watchIdRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (targetFacing: 'environment' | 'user') => {
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
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
          try {
            const caps: any = videoTrack.getCapabilities();
            setTorchSupported(Boolean(caps && caps.torch));
          } catch {
            setTorchSupported(false);
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraState('ready');
      } catch (err: any) {
        let msg = 'Kamera hardware perangkat tidak dapat diakses.';
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          msg =
            'Izin kamera ditolak oleh pengguna atau browser. Check-In Foto Rumah wajib menggunakan kamera langsung (anti-galeri).';
        } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          msg = 'Tidak ada kamera terdeteksi pada perangkat ini.';
        } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
          msg = 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi kamera lalu coba ulang.';
        } else if (err?.message) {
          msg = `Gagal membuka kamera langsung: ${err.message}`;
        }
        setCameraState('error');
        setCameraErrorMsg(msg);
      }
    },
    [stopCameraStream]
  );

  const startGpsTracking = useCallback(async () => {
    stopGpsWatch();
    setGpsErrorMsg('');
    setGpsState('WAITING_GPS');

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsState('GPS_UNAVAILABLE');
      setGpsErrorMsg('Perangkat/browser tidak mendukung Geolocation GPS.');
      return;
    }

    const perm = await queryLocationPermissionStatus();
    if (perm === 'denied') {
      setGpsState('PERMISSION_DENIED');
      setGpsErrorMsg('Izin lokasi GPS ditolak. Aktifkan izin lokasi pada browser/perangkat.');
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
            setGpsErrorMsg('Izin lokasi GPS ditolak oleh pengguna.');
          } else {
            setGpsState(prev => (prev === 'GPS_ACQUIRED' ? prev : 'GPS_WEAK_SIGNAL'));
            setGpsErrorMsg('Menunggu sinyal satelit GPS yang stabil...');
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0
        }
      );
    } catch {
      // Fallback already handled above
    }
  }, [stopGpsWatch]);

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      stopGpsWatch();
      setCapturedPhoto(null);
      setFieldNotes('');
      setIsSubmitting(false);
      setSubmitStepLabel('');
      setShowHelpTip(false);
      return;
    }

    setCapturedPhoto(null);
    startCamera(facingMode);
    startGpsTracking();

    const timer = window.setInterval(() => {
      setNowIso(new Date().toISOString());
    }, 1000);

    return () => {
      window.clearInterval(timer);
      stopCameraStream();
      stopGpsWatch();
    };
  }, [isOpen, facingMode, startCamera, startGpsTracking, stopCameraStream, stopGpsWatch]);

  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchEnabled;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorchEnabled(next);
    } catch {
      toast.warning('Lampu flash kamera tidak merespons pada perangkat ini.', 'Flash Kamera');
    }
  };

  const handleRefreshGps = async () => {
    setIsRefreshingGps(true);
    setGpsErrorMsg('');
    const res = await acquireCurrentDeviceGps({ timeoutMs: 10000, maximumAgeMs: 0 });
    setIsRefreshingGps(false);
    if (res.snapshot) {
      setGpsSnapshot(res.snapshot);
      setGpsState(res.snapshot.signalIndicator);
    } else if (res.errorMessage) {
      setGpsState(res.errorCode || 'GPS_WEAK_SIGNAL');
      setGpsErrorMsg(res.errorMessage);
    }
  };

  const handleCaptureShutter = async () => {
    const video = videoRef.current;
    if (!video || cameraState !== 'ready' || video.videoWidth <= 0) {
      toast.warning('Menunggu feed kamera langsung siap...', 'Kamera');
      return;
    }

    // Grab freshest GPS coordinate snapshot right at shutter press
    let finalGps = gpsSnapshot;
    if (!finalGps) {
      const quick = await acquireCurrentDeviceGps({ timeoutMs: 3500, maximumAgeMs: 5000 });
      if (quick.snapshot) {
        finalGps = quick.snapshot;
        setGpsSnapshot(quick.snapshot);
        setGpsState(quick.snapshot.signalIndicator);
      }
    }

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const outW = Math.max(320, Math.round(srcW * scale));
    const outH = Math.max(240, Math.round(srcH * scale));

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = outW;
    cleanCanvas.height = outH;
    const ctx = cleanCanvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      ctx.save();
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, outW, outH);
      ctx.restore();
    } else {
      ctx.drawImage(video, 0, 0, outW, outH);
    }

    const capturedAtIso = new Date().toISOString();
    const cleanDataUrl = cleanCanvas.toDataURL('image/jpeg', 0.88);

    const markedCanvas = document.createElement('canvas');
    markedCanvas.width = outW;
    markedCanvas.height = outH;
    const mCtx = markedCanvas.getContext('2d');
    if (mCtx) {
      mCtx.drawImage(cleanCanvas, 0, 0);
      applyGeoTagWatermarkToCanvas(markedCanvas, {
        woNumber: ticket.woNumber,
        slotTitle: 'Check-In Foto Rumah Pelanggan',
        technicianName: currentUser.name,
        customerName: ticket.customerName,
        capturedAtIso,
        latitude: finalGps?.latitude,
        longitude: finalGps?.longitude,
        accuracyMeters: finalGps?.accuracyMeters,
        geotagStatus: finalGps?.geotagStatus
      });
    }
    const watermarkedDataUrl = markedCanvas.toDataURL('image/jpeg', 0.88);
    const approxBytes = Math.round((watermarkedDataUrl.length * 3) / 4);

    setCapturedPhoto({
      cleanDataUrl,
      watermarkedDataUrl,
      capturedAtIso,
      gpsAtCapture: finalGps,
      fileSizeBytes: approxBytes,
      fileName: `${ticket.woNumber}_checkin_rumah_${Date.now()}.jpg`
    });
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    if (cameraState !== 'ready') {
      startCamera(facingMode);
    }
  };

  // SOP Checklist Computation (100% honest against live state)
  const checkCameraOk = cameraState === 'ready' || Boolean(capturedPhoto);
  const checkGpsLocked = Boolean(
    hasValidGps && activeGps && (typeof activeGps.accuracyMeters !== 'number' || activeGps.accuracyMeters <= 50)
  );
  const checkGeofenceOk = Boolean(
    hasValidGps &&
      (distanceToRegisteredMeters === null || distanceToRegisteredMeters <= GEOFENCE_SOP_LIMIT_METERS)
  );
  const sopPassedCount = [checkCameraOk, checkGpsLocked, checkGeofenceOk].filter(Boolean).length;

  const canConfirmCheckIn = Boolean(
    capturedPhoto && hasValidGps && !isSubmitting
  );

  const handleConfirmCheckIn = async () => {
    if (!capturedPhoto || isSubmitting) return;
    if (!hasValidGps || !activeGps) {
      toast.error(
        'Koordinat GPS belum terkunci. Tekan "Refresh GPS" atau pastikan izin lokasi aktif sebelum konfirmasi check-in.',
        'GPS Diperlukan'
      );
      return;
    }

    setIsSubmitting(true);
    const cleanNotes = fieldNotes.trim();
    const clientCaptureId = `checkin_${ticket.id}_${Date.now()}`;

    try {
      setSubmitStepLabel('Mengunggah Foto Rumah & Geotag...');
      const uploadRes = await uploadWoPhotoEvidence(ticket.id, {
        slotKey: 'customer_house',
        title: '5. Foto Rumah',
        fileData: capturedPhoto.watermarkedDataUrl,
        fileName: capturedPhoto.fileName,
        mimeType: 'image/jpeg',
        capturedAt: capturedPhoto.capturedAtIso,
        latitude: activeGps.latitude,
        longitude: activeGps.longitude,
        gpsAccuracyMeters: activeGps.accuracyMeters,
        altitudeMeters: activeGps.altitudeMeters,
        headingDeg: activeGps.headingDeg,
        speedMps: activeGps.speedMps,
        locationSource: activeGps.locationSource,
        permissionStatus: activeGps.permissionStatus,
        geotagStatus: activeGps.geotagStatus,
        captureMethod: 'camera',
        requireLiveCamera: true,
        fieldNotes: cleanNotes || undefined,
        badgeText: 'CHECK-IN RUMAH',
        statusTag: 'LOKASI RUMAH',
        clientCaptureId,
        woNumber: ticket.woNumber
      });

      if (!uploadRes.success) {
        toast.error(
          uploadRes.error || 'Gagal mengunggah bukti foto rumah ke server.',
          'Check-In Gagal'
        );
        return;
      }

      // Atomic AppFlow Trigger: Send LiveChat category PROGRESS reusing the exact uploaded storage URL
      setSubmitStepLabel('Mencatat Check-in #PROGRESS...');
      const savedSlot = uploadRes.photoSlot as TechnicalPhotoSlot | undefined;
      const attachments: ChatAttachment[] = savedSlot?.url
        ? [
            {
              id: savedSlot.id || `att_${Date.now()}`,
              url: savedSlot.url,
              fileName: savedSlot.fileName || capturedPhoto.fileName,
              fileSize: savedSlot.fileSizeBytes || capturedPhoto.fileSizeBytes,
              mimeType: savedSlot.mimeType || 'image/jpeg'
            }
          ]
        : [];

      const coordLabel = formatCoordinates(activeGps.latitude, activeGps.longitude);
      const radiusPart =
        distanceToRegisteredMeters !== null
          ? ` | Jarak titik order: ${formatDistanceMetersLabel(distanceToRegisteredMeters)}`
          : '';
      const messageText = [
        `[CHECK-IN FOTO RUMAH GPS] Lokasi tiba terverifikasi (${coordLabel}, akurasi ±${Math.round(
          activeGps.accuracyMeters
        )}m${radiusPart}).`,
        cleanNotes ? `Catatan: ${cleanNotes}` : ''
      ]
        .filter(Boolean)
        .join(' ');

      const chatRes = await sendTicketMessage(ticket.id, messageText, attachments, 'PROGRESS');
      if (!chatRes.success) {
        toast.warning(
          `Foto rumah tersimpan, namun pesan #PROGRESS gagal tercatat: ${chatRes.error || 'Coba kirim di LiveChat.'}`,
          'Perlu Konfirmasi LiveChat'
        );
      } else {
        toast.success(
          `Check-In Foto Rumah GPS untuk WO ${ticket.woNumber} tersimpan & tersinkron ke Monitoring Maps.`,
          'Check-In Berhasil'
        );
      }

      onCheckInSuccess?.(uploadRes.ticket || ticket);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Terjadi kendala saat memproses Check-In Foto Rumah.', 'Error Check-In');
    } finally {
      setIsSubmitting(false);
      setSubmitStepLabel('');
    }
  };

  if (!isOpen) return null;

  const formattedTimestamp = (() => {
    const dt = new Date(capturedPhoto?.capturedAtIso || nowIso);
    if (Number.isNaN(dt.getTime())) return '-';
    const dStr = dt.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
    return `${dStr} ${formatJakartaTimeOnly(dt.toISOString())} WIB`;
  })();

  const gpsStatusBadge = (() => {
    if (hasValidGps && activeGps) {
      const weak = activeGps.accuracyMeters > GEOFENCE_SOP_LIMIT_METERS;
      return {
        dotCls: weak ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse',
        textCls: weak ? 'text-amber-300' : 'text-emerald-300',
        label: weak
          ? `SINYAL LEMAH (±${Math.round(activeGps.accuracyMeters)}m)`
          : `GPS LOCKED (±${Math.round(activeGps.accuracyMeters)}m AKURASI TINGGI)`
      };
    }
    if (gpsState === 'PERMISSION_DENIED') {
      return {
        dotCls: 'bg-rose-500',
        textCls: 'text-rose-300',
        label: 'IZIN GPS DITOLAK'
      };
    }
    if (gpsState === 'GPS_UNAVAILABLE') {
      return {
        dotCls: 'bg-rose-500',
        textCls: 'text-rose-300',
        label: 'GPS TIDAK TERSEDIA'
      };
    }
    return {
      dotCls: 'bg-amber-400 animate-ping',
      textCls: 'text-amber-200',
      label: 'MENGUNCI KOORDINAT GPS...'
    };
  })();

  const displayAddress =
    [ticket.streetName || ticket.address, ticket.clusterName, ticket.area].filter(Boolean).join(', ') ||
    'Alamat pelanggan belum tercatat';

  return (
    <div className="fixed inset-0 z-[110] bg-[#16102B] text-white flex flex-col overflow-hidden select-none">
      {/* 1. TOP DARK HUD HEADER */}
      <header className="shrink-0 bg-[#16102B] border-b border-white/10 px-3 py-2.5 flex items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50"
            aria-label="Kembali"
          >
            <ArrowLeft className="w-4.5 h-4.5 text-white" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-mono text-[9.5px] font-extrabold tracking-wider uppercase">
                LIVE GEOTAG
              </span>
              <h1 className="font-display font-bold text-sm text-white truncate">
                Check-In WO {ticket.woNumber}
              </h1>
            </div>
            <p className="text-[11px] text-purple-200/80 truncate">
              {ticket.customerName || 'Pelanggan'} • {ticket.ticketCategory || 'FTTH'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowHelpTip(v => !v)}
          className="w-9 h-9 rounded-full bg-[#7C3AED]/30 border border-[#A78BFA]/50 text-[#E9D5FF] flex items-center justify-center shrink-0 cursor-pointer hover:bg-[#7C3AED]/50"
          title="Panduan SOP Foto Rumah"
          aria-label="Panduan SOP"
        >
          <HelpCircle className="w-4.5 h-4.5" />
        </button>
      </header>

      {/* Inline SOP Guide Popover */}
      {showHelpTip && (
        <div className="shrink-0 bg-[#251D3D] border-b border-purple-500/30 px-4 py-2.5 text-[11px] text-purple-100 flex items-start justify-between gap-3 z-20">
          <div className="space-y-0.5">
            <div className="font-bold text-white">Panduan Check-In Foto Rumah GPS</div>
            <p className="text-purple-200/90 leading-relaxed">
              Ambil foto tampak depan rumah/pagar pelanggan menggunakan kamera langsung. Upload galeri diblokir otomatis oleh sistem demi validasi GPS &amp; anti-spoof. Setelah konfirmasi, Check-In &amp; pesan LiveChat <span className="font-mono font-bold text-emerald-300">#PROGRESS</span> langsung tercatat ke Dispatch.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowHelpTip(false)}
            className="p-1 text-purple-300 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. INTERACTIVE LIVE CAMERA VIEWPORT + TELEMETRY HUD */}
      <div className="relative flex-1 min-h-[250px] bg-black overflow-hidden">
        {/* Camera Feed or Captured Image */}
        {!capturedPhoto ? (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover transition-transform duration-200 ${
              facingMode === 'user' ? '-scale-x-100' : ''
            } ${zoomMode === '0.5x' ? 'scale-100' : 'scale-[1.06]'}`}
          />
        ) : (
          <img
            src={capturedPhoto.watermarkedDataUrl}
            alt="Preview Foto Rumah Check-In"
            className="w-full h-full object-contain bg-[#090612]"
          />
        )}

        {/* Rule of Thirds Grid Overlay */}
        {showGrid && !capturedPhoto && cameraState === 'ready' && (
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, idx) => (
              <div key={idx} className="border border-white/15" />
            ))}
          </div>
        )}

        {/* Center Reticle Target Overlay */}
        {!capturedPhoto && cameraState === 'ready' && (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-8 pt-24 pb-6"
          >
            <div className="relative w-44 h-36 sm:w-56 sm:h-44">
              <span className="absolute top-0 left-0 w-5 h-5 border-t-[3px] border-l-[3px] border-amber-400 rounded-tl-md" />
              <span className="absolute top-0 right-0 w-5 h-5 border-t-[3px] border-r-[3px] border-amber-400 rounded-tr-md" />
              <span className="absolute bottom-0 left-0 w-5 h-5 border-b-[3px] border-l-[3px] border-amber-400 rounded-bl-md" />
              <span className="absolute bottom-0 right-0 w-5 h-5 border-b-[3px] border-r-[3px] border-amber-400 rounded-br-md" />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.9)]" />
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-0.5 rounded-full bg-black/75 border border-amber-400/50 text-amber-300 font-mono text-[9.5px] font-bold tracking-wider uppercase">
                FOKUS RUMAH &amp; PAGAR
              </div>
            </div>
          </div>
        )}

        {/* Top Live GPS HUD Telemetry Box */}
        <div className="absolute top-2.5 inset-x-2.5 z-10 pointer-events-auto">
          <div className="rounded-2xl bg-[#100A20]/82 backdrop-blur-md border border-white/15 p-2.5 sm:p-3 space-y-1.5 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${gpsStatusBadge.dotCls}`} />
                <span className={`font-mono text-[10.5px] font-extrabold tracking-wide truncate ${gpsStatusBadge.textCls}`}>
                  {gpsStatusBadge.label}
                </span>
              </div>

              <button
                type="button"
                onClick={handleRefreshGps}
                disabled={isRefreshingGps || Boolean(capturedPhoto)}
                className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 border border-white/15 font-mono text-[9.5px] font-bold text-purple-100 flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                title="Perbarui Kunci Koordinat GPS"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingGps ? 'animate-spin' : ''}`} />
                <span>{hasValidGps ? 'Lock Ulang' : 'Kunci GPS'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10.5px] tabular-nums">
              <div className="flex items-center justify-between gap-1">
                <span className="text-slate-400">LAT:</span>
                <span className="font-bold text-white">
                  {hasValidGps && activeGps ? `${activeGps.latitude.toFixed(6)}°` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-slate-400">ALT:</span>
                <span className="font-bold text-white">
                  {typeof activeGps?.altitudeMeters === 'number'
                    ? `${Math.round(activeGps.altitudeMeters)}m dpl`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-slate-400">LONG:</span>
                <span className="font-bold text-white">
                  {hasValidGps && activeGps ? `${activeGps.longitude.toFixed(6)}°` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-slate-400">RADIUS:</span>
                {distanceToRegisteredMeters !== null ? (
                  <span
                    className={`px-1.5 py-0.2 rounded font-bold text-[9.5px] ${
                      distanceToRegisteredMeters <= GEOFENCE_SOP_LIMIT_METERS
                        ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/40'
                        : 'bg-amber-500/25 text-amber-300 border border-amber-400/40'
                    }`}
                  >
                    {formatDistanceMetersLabel(distanceToRegisteredMeters)} (
                    {distanceToRegisteredMeters <= GEOFENCE_SOP_LIMIT_METERS ? 'SOP Valid' : '> 50m'})
                  </span>
                ) : (
                  <span className="text-purple-200/80 text-[9.5px] font-semibold">
                    {hasValidGps ? 'Baseline Baru' : 'Menunggu GPS'}
                  </span>
                )}
              </div>
            </div>

            <div className="pt-1 border-t border-white/10 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px]">
              <div className="flex items-center gap-1 text-amber-300 font-medium min-w-0 truncate max-w-full">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">Target: {displayAddress}</span>
              </div>
              <div className="flex items-center justify-between w-full font-mono text-[9.5px] text-purple-200/85">
                <span className="truncate">TIMESTAMP: {formattedTimestamp}</span>
                <span className="text-emerald-300 font-bold shrink-0">[LIVE CAMERA ONLY]</span>
              </div>
            </div>

            {gpsErrorMsg && (
              <div className="rounded-lg bg-rose-950/80 border border-rose-500/50 px-2 py-1 text-[10px] text-rose-200 flex items-center gap-1.5">
                <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                <span className="leading-snug">{gpsErrorMsg}</span>
              </div>
            )}
          </div>
        </div>

        {/* Camera Lens Badge & Right Floating Tools */}
        {!capturedPhoto && cameraState === 'ready' && (
          <>
            <div className="absolute bottom-3 left-3 z-10 px-2.5 py-1 rounded-full bg-black/75 border border-white/15 font-mono text-[10px] font-bold text-amber-300 flex items-center gap-1.5">
              <Camera className="w-3 h-3" />
              <span>{zoomMode === '1.0x' ? '1.0x MAIN' : '0.5x WIDE'}</span>
            </div>

            <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-2">
              {torchSupported && (
                <button
                  type="button"
                  onClick={handleToggleTorch}
                  className={`w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer transition-colors ${
                    torchEnabled
                      ? 'bg-amber-500 border-amber-300 text-slate-950 shadow-lg'
                      : 'bg-black/65 border-white/20 text-white hover:bg-black/85'
                  }`}
                  title="Lampu Flash"
                >
                  <Zap className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowGrid(v => !v)}
                className={`w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer transition-colors ${
                  showGrid
                    ? 'bg-[#7C3AED] border-[#A78BFA] text-white shadow-lg'
                    : 'bg-black/65 border-white/20 text-white hover:bg-black/85'
                }`}
                title="Grid Garis Bantu"
              >
                <Grid3x3 className="w-4 h-4" />
              </button>
            </div>
          </>
        )}

        {/* Camera Loading / Error State (Zero Gallery Bypass) */}
        {!capturedPhoto && cameraState !== 'ready' && (
          <div className="absolute inset-0 bg-[#120C22]/95 flex flex-col items-center justify-center p-6 text-center z-10 space-y-3">
            {cameraState === 'initializing' ? (
              <>
                <Loader2 className="w-9 h-9 text-purple-400 animate-spin" />
                <p className="text-xs font-semibold text-purple-100">
                  Membuka kamera perangkat langsung...
                </p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-300 flex items-center justify-center">
                  <TriangleAlert className="w-6 h-6" />
                </div>
                <div className="max-w-xs space-y-1">
                  <div className="font-display font-bold text-sm text-white">
                    Kamera Langsung Diperlukan
                  </div>
                  <p className="text-[11.5px] text-rose-200 leading-relaxed">{cameraErrorMsg}</p>
                </div>
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="px-4 py-2 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Coba Buka Kamera Lagi</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 3. BOTTOM SOP CHECKLIST, SHUTTER & CONFIRMATION PANEL */}
      <div className="shrink-0 bg-[#1E1635] border-t border-white/10 px-3.5 pt-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] space-y-3 max-h-[52dvh] overflow-y-auto">
        {/* SOP Validation Checklist */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-purple-100">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>VALIDASI SISTEM BUKTI LAPANGAN</span>
            </div>
            <span
              className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
                sopPassedCount === 3
                  ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                  : 'bg-amber-500/20 border-amber-400/40 text-amber-300'
              }`}
            >
              {sopPassedCount}/3 Lolos SOP
            </span>
          </div>

          <div className="space-y-1 text-[11px]">
            <div className="flex items-center gap-2">
              <CheckCircle2
                className={`w-3.5 h-3.5 shrink-0 ${
                  checkCameraOk ? 'text-emerald-400' : 'text-slate-500'
                }`}
              />
              <span className={checkCameraOk ? 'text-emerald-200' : 'text-slate-400'}>
                Kamera Hardware Langsung Aktif (Anti-Galeri &amp; Anti-Mock)
              </span>
            </div>

            <div className="flex items-center gap-2">
              {checkGpsLocked ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
              ) : (
                <Satellite className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              )}
              <span className={checkGpsLocked ? 'text-emerald-200' : hasValidGps ? 'text-amber-200' : 'text-slate-400'}>
                {checkGpsLocked && activeGps
                  ? `Koordinat GPS Terkunci Akurat (±${Math.round(activeGps.accuracyMeters)}m ≤ 50m)`
                  : hasValidGps && activeGps
                  ? `GPS Terkunci dengan Akurasi Lemah (±${Math.round(activeGps.accuracyMeters)}m)`
                  : 'Menunggu Penguncian Koordinat GPS Perangkat'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {checkGeofenceOk ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
              ) : (
                <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              )}
              <span className={checkGeofenceOk ? 'text-emerald-200' : 'text-amber-200'}>
                {distanceToRegisteredMeters !== null
                  ? distanceToRegisteredMeters <= GEOFENCE_SOP_LIMIT_METERS
                    ? `Radius Titik Rumah Sesuai GIS Target (${formatDistanceMetersLabel(distanceToRegisteredMeters)})`
                    : `Deviasi Jarak ${formatDistanceMetersLabel(distanceToRegisteredMeters)} dari titik order (> 50m)`
                  : hasValidGps
                  ? 'Titik koordinat order belum terdata — koordinat Check-In dicatat sebagai lokasi rumah'
                  : 'Validasi Geofence menunggu koordinat GPS'}
              </span>
            </div>
          </div>
        </div>

        {/* Camera Controls Row */}
        <div className="flex items-center justify-center gap-7 py-0.5">
          {!capturedPhoto ? (
            <>
              <button
                type="button"
                onClick={() => setZoomMode(prev => (prev === '1.0x' ? '0.5x' : '1.0x'))}
                disabled={cameraState !== 'ready'}
                className="flex flex-col items-center gap-1 text-[10.5px] font-semibold text-purple-200 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                <span className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center font-mono text-[11px] font-bold">
                  {zoomMode}
                </span>
                <span>Lensa</span>
              </button>

              <button
                type="button"
                onClick={handleCaptureShutter}
                disabled={cameraState !== 'ready'}
                aria-label="Ambil Foto Rumah Check-In"
                className="w-16 h-16 rounded-full p-1 bg-white shadow-[0_6px_0_#4C1D95,0_10px_20px_rgba(124,58,237,0.45)] active:translate-y-1 transition-all disabled:opacity-40 cursor-pointer"
              >
                <span className="w-full h-full rounded-full bg-gradient-to-b from-[#9333EA] to-[#6B21A8] flex items-center justify-center">
                  <Camera className="w-6 h-6 text-white" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'))}
                className="flex flex-col items-center gap-1 text-[10.5px] font-semibold text-purple-200 hover:text-white cursor-pointer"
              >
                <span className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                  <SwitchCamera className="w-4.5 h-4.5" />
                </span>
                <span>Putar</span>
              </button>
            </>
          ) : (
            <div className="flex items-center justify-between w-full gap-2.5 bg-[#251D3D] border border-purple-500/30 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    Foto Rumah Terambil (Kamera Langsung)
                  </div>
                  <div className="font-mono text-[10px] text-purple-200 truncate">
                    {hasValidGps && activeGps
                      ? `${formatCoordinates(activeGps.latitude, activeGps.longitude)} • ±${Math.round(
                          activeGps.accuracyMeters
                        )}m`
                      : 'Menunggu GPS Lock'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRetake}
                disabled={isSubmitting}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-white flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Ulangi</span>
              </button>
            </div>
          )}
        </div>

        {/* Optional Field Note Input */}
        <div className="rounded-xl bg-[#251D3D] border border-white/10 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10.5px]">
            <label htmlFor="checkin-field-note" className="font-semibold text-purple-100">
              Catatan Lapangan / Posisi ODP (Opsional)
            </label>
            <span className="font-mono text-[9.5px] text-slate-400">{fieldNotes.length}/120</span>
          </div>
          <input
            id="checkin-field-note"
            type="text"
            maxLength={120}
            value={fieldNotes}
            disabled={isSubmitting}
            onChange={e => setFieldNotes(e.target.value)}
            placeholder="Contoh: Pagar hijau No. 14, kabel drop optik masuk dari tiang depan..."
            className="w-full rounded-lg bg-[#16102B] border border-white/15 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
          />
        </div>

        {/* Primary Confirm CTA */}
        <button
          type="button"
          onClick={handleConfirmCheckIn}
          disabled={!canConfirmCheckIn}
          className="w-full min-h-[46px] rounded-xl bg-gradient-to-b from-[#9333EA] to-[#6B21A8] hover:from-[#A855F7] hover:to-[#7E22CE] disabled:opacity-45 disabled:cursor-not-allowed text-white font-display font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-2 shadow-[0_4px_0_#3B0764] active:translate-y-0.5 transition-all cursor-pointer"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{submitStepLabel || 'Menyimpan Check-In...'}</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4 stroke-[3]" />
              <span>
                {!capturedPhoto
                  ? 'Ambil Foto Rumah Terlebih Dahulu'
                  : !hasValidGps
                  ? 'Menunggu Koordinat GPS Terkunci...'
                  : 'KONFIRMASI CHECK-IN FOTO RUMAH'}
              </span>
            </>
          )}
        </button>

        <p className="text-[10px] text-center text-purple-200/80 leading-snug">
          Check-in otomatis memicu status <strong className="text-emerald-300">#PROGRESS</strong> dan tersinkron ke <strong className="text-white">Monitoring Maps Dispatch</strong> secara real-time.
        </p>
      </div>
    </div>
  );
};
