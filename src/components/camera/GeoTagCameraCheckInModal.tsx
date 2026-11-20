import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Crosshair,
  FileText,
  Grid3x3,
  HelpCircle,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Satellite,
  Save,
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
const ZOOM_PRESETS = ['0.5x', '1.0x', '2.0x', '3.0x'] as const;
type ZoomPreset = (typeof ZOOM_PRESETS)[number];

const FAST_NOTE_TAGS = ['Tiang Depan', 'Drop Cable', 'Rumah Hook', 'Pagar Dikunci'] as const;

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
  const [zoomMode, setZoomMode] = useState<ZoomPreset>('1.0x');
  const [hardwareZoomRange, setHardwareZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [showHelpTip, setShowHelpTip] = useState<boolean>(false);
  const [isNotesSheetOpen, setIsNotesSheetOpen] = useState<boolean>(false);
  const [captureFlashActive, setCaptureFlashActive] = useState<boolean>(false);
  const [captureToastVisible, setCaptureToastVisible] = useState<boolean>(false);

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
    setHardwareZoomRange(null);
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
            if (caps?.zoom && typeof caps.zoom.min === 'number' && typeof caps.zoom.max === 'number') {
              setHardwareZoomRange({ min: caps.zoom.min, max: caps.zoom.max });
            } else {
              setHardwareZoomRange(null);
            }
          } catch {
            setTorchSupported(false);
            setHardwareZoomRange(null);
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
      setIsNotesSheetOpen(false);
      setCaptureFlashActive(false);
      setCaptureToastVisible(false);
      setZoomMode('1.0x');
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
    if (!track || !torchSupported) {
      toast.info('Lampu flash kamera tidak didukung oleh perangkat/browser ini.', 'Flash Kamera');
      return;
    }
    const next = !torchEnabled;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorchEnabled(next);
    } catch {
      toast.warning('Lampu flash kamera tidak merespons pada perangkat ini.', 'Flash Kamera');
    }
  };

  const handleSelectZoom = async (preset: ZoomPreset) => {
    setZoomMode(preset);
    const numericZoom = parseFloat(preset.replace('x', ''));
    const track = streamRef.current?.getVideoTracks()[0];
    if (track && hardwareZoomRange) {
      const clamped = Math.max(hardwareZoomRange.min, Math.min(hardwareZoomRange.max, numericZoom));
      try {
        await track.applyConstraints({ advanced: [{ zoom: clamped } as any] });
      } catch {
        // Digital CSS preview fallback handles zoom smoothly
      }
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

    setCaptureFlashActive(true);
    window.setTimeout(() => setCaptureFlashActive(false), 140);

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
    const zoomNumeric = parseFloat(zoomMode.replace('x', ''));
    const cropFactor = !hardwareZoomRange && zoomNumeric > 1 ? zoomNumeric : 1;
    const cropW = srcW / cropFactor;
    const cropH = srcH / cropFactor;
    const cropX = (srcW - cropW) / 2;
    const cropY = (srcH - cropH) / 2;

    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(cropW, cropH));
    const outW = Math.max(320, Math.round(cropW * scale));
    const outH = Math.max(240, Math.round(cropH * scale));

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = outW;
    cleanCanvas.height = outH;
    const ctx = cleanCanvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      ctx.save();
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
      ctx.restore();
    } else {
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
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

    setCaptureToastVisible(true);
    window.setTimeout(() => setCaptureToastVisible(false), 2200);
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    setCaptureToastVisible(false);
    if (cameraState !== 'ready') {
      startCamera(facingMode);
    }
  };

  const handleAppendTag = (tagLabel: string) => {
    setFieldNotes(prev => {
      const trimmed = prev.trim();
      if (trimmed.toLowerCase().includes(tagLabel.toLowerCase())) return prev;
      const next = trimmed ? `${trimmed}, ${tagLabel}` : tagLabel;
      return next.length <= 120 ? next : prev;
    });
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

  const canConfirmCheckIn = Boolean(capturedPhoto && hasValidGps && !isSubmitting);

  const handleConfirmCheckIn = async () => {
    if (!capturedPhoto || isSubmitting) return;
    if (!hasValidGps || !activeGps) {
      toast.error(
        'Koordinat GPS belum terkunci. Tekan "Lock Ulang" pada telemetry GPS atau pastikan izin lokasi aktif sebelum konfirmasi check-in.',
        'GPS Diperlukan'
      );
      setIsNotesSheetOpen(true);
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

  const currentTimeWib = `${formatJakartaTimeOnly(capturedPhoto?.capturedAtIso || nowIso)} WIB`;

  const gpsChipMeta = (() => {
    if (hasValidGps && activeGps) {
      const weak = activeGps.accuracyMeters > GEOFENCE_SOP_LIMIT_METERS;
      return {
        dotCls: weak ? 'bg-amber-400 animate-pulse' : 'bg-[#40efb7] animate-pulse',
        textCls: weak ? 'text-amber-300' : 'text-[#40efb7]',
        label: weak ? 'SINYAL LEMAH' : 'GPS LOCKED',
        accuracyLabel: `±${Math.round(activeGps.accuracyMeters)}m`
      };
    }
    if (gpsState === 'PERMISSION_DENIED') {
      return {
        dotCls: 'bg-rose-400',
        textCls: 'text-rose-300',
        label: 'IZIN GPS DITOLAK',
        accuracyLabel: '—'
      };
    }
    if (gpsState === 'GPS_UNAVAILABLE') {
      return {
        dotCls: 'bg-rose-400',
        textCls: 'text-rose-300',
        label: 'GPS OFF',
        accuracyLabel: '—'
      };
    }
    return {
      dotCls: 'bg-amber-400 animate-ping',
      textCls: 'text-amber-200',
      label: 'MENGUNCI GPS',
      accuracyLabel: '...'
    };
  })();

  const displayAddress =
    [ticket.streetName || ticket.address, ticket.clusterName, ticket.area].filter(Boolean).join(', ') ||
    'Alamat pelanggan belum tercatat';

  const zoomScaleClass =
    !hardwareZoomRange && zoomMode === '2.0x'
      ? 'scale-[1.35]'
      : !hardwareZoomRange && zoomMode === '3.0x'
      ? 'scale-[1.7]'
      : zoomMode === '0.5x'
      ? 'scale-100'
      : 'scale-[1.03]';

  return (
    <div
      className="fixed inset-0 z-[110] bg-[#141121] text-[#e6dff7] flex flex-col overflow-hidden select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Check-In Foto Rumah WO ${ticket.woNumber}`}
    >
      {/* 1. FULLSCREEN LIVE CAMERA VIEWPORT + AMBIENT HUD LAYERS */}
      <div className="relative flex-1 w-full h-full overflow-hidden flex flex-col justify-between bg-[#0f0c1c]">
        {/* Live Camera Video or Captured Image Preview */}
        {!capturedPhoto ? (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`absolute inset-0 w-full h-full object-cover transition-transform duration-200 ${
              facingMode === 'user' ? '-scale-x-100' : ''
            } ${zoomScaleClass}`}
          />
        ) : (
          <img
            src={capturedPhoto.watermarkedDataUrl}
            alt="Preview Foto Rumah Check-In"
            className="absolute inset-0 w-full h-full object-contain bg-[#0f0c1c]"
          />
        )}

        {/* Ambient Cyberpunk Shadow Scrims (High Contrast HUD Readability) */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-[#141121]/85 via-[#141121]/35 to-transparent pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[#141121] via-[#141121]/65 to-transparent pointer-events-none"
        />

        {/* Rule of Thirds Grid Overlay */}
        {!capturedPhoto && cameraState === 'ready' && (
          <div
            aria-hidden="true"
            className={`absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none transition-opacity duration-300 ${
              showGrid ? 'opacity-60' : 'opacity-0'
            }`}
          >
            <div className="border-r border-b border-[#d0bcff]/15" />
            <div className="border-r border-b border-[#d0bcff]/15" />
            <div className="border-b border-[#d0bcff]/15" />
            <div className="border-r border-b border-[#d0bcff]/15" />
            <div className="border-r border-b border-[#d0bcff]/15" />
            <div className="border-b border-[#d0bcff]/15" />
            <div className="border-r border-[#d0bcff]/15" />
            <div className="border-r border-[#d0bcff]/15" />
            <div />
          </div>
        )}

        {/* Holographic Center AR Target Reticle */}
        {!capturedPhoto && cameraState === 'ready' && (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center pointer-events-none px-6"
          >
            <div className="relative w-56 h-52 sm:w-64 sm:h-56 flex items-center justify-center">
              {/* Mint Corner Brackets */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-[#40efb7] rounded-tl-sm shadow-[0_0_8px_rgba(64,239,183,0.5)]" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-[#40efb7] rounded-tr-sm shadow-[0_0_8px_rgba(64,239,183,0.5)]" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-[#40efb7] rounded-bl-sm shadow-[0_0_8px_rgba(64,239,183,0.5)]" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-[#40efb7] rounded-br-sm shadow-[0_0_8px_rgba(64,239,183,0.5)]" />

              {/* Center Crosshair Target */}
              <div className="w-12 h-12 rounded-full border border-[#d0bcff]/45 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-[#40efb7] shadow-[0_0_10px_#40efb7]" />
              </div>

              {/* Live AR Target Readout */}
              <div className="absolute -top-8 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0f0c1c]/75 backdrop-blur-md border border-white/10">
                <Crosshair className="w-3 h-3 text-[#40efb7] shrink-0" />
                <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e6dff7] uppercase">
                  {checkGpsLocked && activeGps
                    ? `FOKUS RUMAH • ±${Math.round(activeGps.accuracyMeters)}m`
                    : 'FOKUS RUMAH & PAGAR'}
                </span>
              </div>

              <div className="absolute -bottom-7 flex items-center justify-between w-full px-1 font-mono text-[10px] text-[#d0bcff]/85">
                <span>
                  DIST:{' '}
                  {distanceToRegisteredMeters !== null
                    ? formatDistanceMetersLabel(distanceToRegisteredMeters)
                    : 'BASELINE'}
                </span>
                <span>
                  ALT:{' '}
                  {typeof activeGps?.altitudeMeters === 'number'
                    ? `${Math.round(activeGps.altitudeMeters)}m`
                    : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Camera Loading / Error State (Zero Gallery Bypass) */}
        {!capturedPhoto && cameraState !== 'ready' && (
          <div className="absolute inset-0 bg-[#141121]/95 flex flex-col items-center justify-center p-6 text-center z-10 space-y-3.5">
            {cameraState === 'initializing' ? (
              <>
                <div className="w-14 h-14 rounded-2xl bg-[#2b2839] border border-[#d0bcff]/25 flex items-center justify-center shadow-lg">
                  <Loader2 className="w-7 h-7 text-[#d0bcff] animate-spin" />
                </div>
                <div className="space-y-1">
                  <p className="font-display text-sm font-semibold text-[#e6dff7]">
                    Membuka Kamera Hardware Langsung...
                  </p>
                  <p className="text-[11px] font-mono text-[#cbc3d7]">
                    MoraJaws LiveSecure™ Anti-Galeri Verification
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-[#93000a]/40 border border-[#ffb4ab]/40 text-[#ffb4ab] flex items-center justify-center">
                  <TriangleAlert className="w-7 h-7" />
                </div>
                <div className="max-w-xs space-y-1.5">
                  <div className="font-display font-bold text-base text-[#e6dff7]">
                    Kamera Langsung Diperlukan
                  </div>
                  <p className="text-xs text-[#ffdad6] leading-relaxed">{cameraErrorMsg}</p>
                </div>
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="px-4 py-2.5 rounded-xl bg-[#d0bcff] hover:bg-[#e9ddff] text-[#3c0091] text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg active:scale-95 transition-transform"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Coba Buka Kamera Lagi</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* 2. FLOATING MINIMALIST TOP HEADER */}
        <header className="relative z-20 pt-[max(0.75rem,env(safe-area-inset-top))] px-3.5 sm:px-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            {/* Back Button */}
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Kembali"
              className="w-11 h-11 rounded-full bg-[#2b2839]/80 backdrop-blur-xl border border-white/10 flex items-center justify-center text-[#e6dff7] shadow-md active:scale-95 transition-transform shrink-0 cursor-pointer disabled:opacity-50"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {/* Customer & WO Core Metadata Card */}
            <div className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-[#2b2839]/80 backdrop-blur-xl border border-white/10 flex flex-col justify-center shadow-md">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[#40efb7] shadow-[0_0_6px_#40efb7] shrink-0" />
                <span className="font-mono text-[11.5px] text-[#d0bcff] font-bold tracking-wider truncate">
                  {ticket.woNumber}
                </span>
              </div>
              <p className="font-display text-[16px] sm:text-[17px] font-semibold text-[#e6dff7] leading-tight truncate">
                {ticket.customerName || 'Pelanggan'}
              </p>
              <span className="text-[11px] text-[#cbc3d7] truncate">
                {ticket.ticketCategory || ticket.appointmentType || 'FTTH'} •{' '}
                {ticket.area || ticket.clusterName || 'Lokasi Order'}
              </span>
            </div>

            {/* Header Actions: Flash, Grid & SOP Help */}
            <div className="flex items-center gap-1 bg-[#2b2839]/80 backdrop-blur-xl border border-white/10 p-1 rounded-full shadow-md shrink-0">
              <button
                type="button"
                onClick={handleToggleTorch}
                title={torchSupported ? 'Toggle Lampu Flash' : 'Flash Kamera'}
                aria-label="Toggle Flash"
                className={`w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-all cursor-pointer ${
                  torchEnabled
                    ? 'bg-[#40efb7]/20 text-[#40efb7]'
                    : 'text-[#e6dff7] hover:text-[#40efb7]'
                }`}
              >
                <Zap className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowGrid(v => !v)}
                title="Garis Bantu Komposisi (Rule of Thirds)"
                aria-label="Toggle Grid"
                className={`w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-all cursor-pointer ${
                  showGrid
                    ? 'bg-[#d0bcff]/20 text-[#d0bcff]'
                    : 'text-[#cbc3d7] hover:text-[#e6dff7]'
                }`}
              >
                <Grid3x3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowHelpTip(v => !v)}
                title="Panduan SOP Foto Rumah"
                aria-label="Panduan SOP"
                className={`w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-all cursor-pointer ${
                  showHelpTip
                    ? 'bg-[#d0bcff] text-[#3c0091]'
                    : 'text-[#cbc3d7] hover:text-[#e6dff7]'
                }`}
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 3. FLOATING COMPACT TELEMETRY & SOP BADGES */}
          <div className="flex items-center justify-between gap-2">
            {/* Left Chip: GPS Telemetry Trigger -> Opens Telemetry & Notes Bottom Sheet */}
            <button
              type="button"
              onClick={() => setIsNotesSheetOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#0f0c1c]/82 backdrop-blur-lg border border-white/10 shadow-sm hover:bg-[#2b2839] transition-colors cursor-pointer min-w-0"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${gpsChipMeta.dotCls}`} />
              <span className={`font-mono text-[10px] font-semibold tracking-wider truncate ${gpsChipMeta.textCls}`}>
                {gpsChipMeta.label}
              </span>
              <span className="text-[#cbc3d7] font-mono text-[10px] shrink-0">
                {gpsChipMeta.accuracyLabel}
              </span>
              <span className="text-[#cbc3d7]/40 font-mono text-[10px]">|</span>
              <span className="font-mono text-[10px] text-[#e6dff7] shrink-0">{currentTimeWib}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#cbc3d7] shrink-0" />
            </button>

            {/* Right Chip: SOP Validation Pill */}
            <button
              type="button"
              onClick={() => setIsNotesSheetOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full backdrop-blur-lg border shadow-sm shrink-0 cursor-pointer transition-colors ${
                sopPassedCount === 3
                  ? 'bg-[#00d29c]/20 border-[#40efb7]/35 text-[#40efb7]'
                  : 'bg-amber-500/20 border-amber-400/35 text-amber-300'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono text-[10px] font-bold tracking-wider uppercase">
                {sopPassedCount}/3 SOP {sopPassedCount === 3 ? 'READY' : 'CHECK'}
              </span>
            </button>
          </div>

          {/* Anti-Gallery LiveSecure Watermark Stamp (Aligned cleanly without colliding) */}
          <div className="flex justify-end pointer-events-none">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0f0c1c]/75 backdrop-blur-md border border-white/10 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#40efb7] animate-ping" />
              <span className="font-mono text-[9.5px] text-[#40efb7] tracking-widest uppercase">
                MoraJaws LiveSecure™ • Anti-Galeri
              </span>
            </div>
          </div>

          {/* Inline SOP Guide Popover */}
          {showHelpTip && (
            <div className="rounded-2xl bg-[#211d2e]/95 backdrop-blur-xl border border-[#d0bcff]/30 px-3.5 py-2.5 text-[11px] text-[#e6dff7] flex items-start justify-between gap-3 shadow-xl">
              <div className="space-y-1">
                <div className="font-display font-bold text-xs text-[#e6dff7]">
                  Panduan Check-In Foto Rumah GPS
                </div>
                <p className="text-[#cbc3d7] leading-relaxed">
                  Ambil foto tampak depan rumah/pagar pelanggan menggunakan kamera langsung. Upload galeri diblokir otomatis demi validasi GPS &amp; anti-spoof. Setelah konfirmasi, bukti foto dan pesan LiveChat{' '}
                  <span className="font-mono font-bold text-[#40efb7]">#PROGRESS</span> langsung tersinkron ke Dispatch.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpTip(false)}
                className="p-1 text-[#cbc3d7] hover:text-white cursor-pointer shrink-0"
                aria-label="Tutup panduan"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </header>

        {/* Middle Spacer */}
        <div className="flex-1 pointer-events-none" />

        {/* 4. ERGONOMIC BOTTOM CAMERA CONTROLS (Thumb Arc) */}
        <div className="relative z-20 flex flex-col items-center gap-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {!capturedPhoto ? (
            <>
              {/* Zoom Preset Pill Strip */}
              <div className="flex items-center p-1 rounded-full bg-[#0f0c1c]/85 backdrop-blur-xl border border-white/10 shadow-lg">
                {ZOOM_PRESETS.map(preset => {
                  const active = zoomMode === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={cameraState !== 'ready'}
                      onClick={() => handleSelectZoom(preset)}
                      className={`px-3 py-1 rounded-full font-mono text-[10.5px] transition-all cursor-pointer disabled:opacity-40 ${
                        active
                          ? 'bg-[#d0bcff] text-[#3c0091] font-bold shadow-md'
                          : 'text-[#cbc3d7] hover:text-[#e6dff7]'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>

              {/* Main Action Floating Command Bar */}
              <div className="w-full max-w-md flex items-center justify-between px-3 sm:px-5">
                {/* Left Thumb Button: Field Notes & Telemetry Sheet */}
                <button
                  type="button"
                  onClick={() => setIsNotesSheetOpen(true)}
                  className="relative flex flex-col items-center justify-center w-14 h-14 rounded-2xl bg-[#2b2839]/85 backdrop-blur-xl border border-white/10 shadow-md active:scale-95 transition-transform cursor-pointer"
                >
                  <FileText className="w-5 h-5 text-[#d0bcff]" />
                  <span className="font-mono text-[9.5px] text-[#cbc3d7] mt-1">Catatan</span>
                  <span
                    className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-[#141121] ${
                      fieldNotes.trim() ? 'bg-[#40efb7]' : 'bg-[#d0bcff]'
                    }`}
                  />
                </button>

                {/* Center Shutter Button: Futuristic Concentric Core */}
                <button
                  type="button"
                  onClick={handleCaptureShutter}
                  disabled={cameraState !== 'ready'}
                  aria-label="Ambil Foto Rumah Check-In"
                  className="group relative flex items-center justify-center w-20 h-20 rounded-full bg-[#363244]/65 backdrop-blur-xl shadow-[0_0_30px_rgba(208,188,255,0.3)] active:scale-90 transition-transform disabled:opacity-45 cursor-pointer"
                >
                  <div className="absolute inset-1 rounded-full border-2 border-[#d0bcff]/55 group-hover:border-[#40efb7] transition-colors" />
                  <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-[#d0bcff] to-[#40efb7] flex items-center justify-center shadow-lg group-hover:opacity-95">
                    <Camera className="w-7 h-7 text-[#141121]" />
                  </div>
                </button>

                {/* Right Thumb Button: Lens Switch */}
                <button
                  type="button"
                  onClick={() => setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'))}
                  className="flex flex-col items-center justify-center w-14 h-14 rounded-2xl bg-[#2b2839]/85 backdrop-blur-xl border border-white/10 shadow-md active:scale-95 transition-transform text-[#e6dff7] cursor-pointer"
                >
                  <SwitchCamera className="w-5 h-5" />
                  <span className="font-mono text-[9.5px] text-[#cbc3d7] mt-1">Lensa</span>
                </button>
              </div>
            </>
          ) : (
            /* Post-Capture Review & Production Check-In Confirmation Dock */
            <div className="w-full max-w-md rounded-2xl bg-[#2b2839]/92 backdrop-blur-2xl border border-white/15 p-3.5 space-y-3 shadow-2xl">
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4.5 h-4.5 text-[#40efb7] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#e6dff7] truncate">
                      Foto Rumah Terambil (Kamera Langsung)
                    </div>
                    <div className="font-mono text-[10px] text-[#cbc3d7] truncate">
                      {hasValidGps && activeGps
                        ? `${formatCoordinates(activeGps.latitude, activeGps.longitude)} • ±${Math.round(
                            activeGps.accuracyMeters
                          )}m`
                        : 'Koordinat GPS belum terkunci'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsNotesSheetOpen(true)}
                    disabled={isSubmitting}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0f0c1c]/80 hover:bg-[#363244] border border-white/10 text-[11px] font-semibold text-[#d0bcff] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{fieldNotes.trim() ? 'Edit Catatan' : 'Catatan'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRetake}
                    disabled={isSubmitting}
                    className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-bold text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Ulangi</span>
                  </button>
                </div>
              </div>

              {!hasValidGps && (
                <div className="rounded-xl bg-amber-500/15 border border-amber-400/35 px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-amber-200">
                  <span className="truncate">GPS wajib terkunci sebelum konfirmasi check-in.</span>
                  <button
                    type="button"
                    onClick={handleRefreshGps}
                    disabled={isRefreshingGps}
                    className="px-2 py-1 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 font-mono text-[10px] font-bold text-amber-200 flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshingGps ? 'animate-spin' : ''}`} />
                    <span>Kunci GPS</span>
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleConfirmCheckIn}
                disabled={!canConfirmCheckIn}
                className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-[#d0bcff] to-[#40efb7] hover:opacity-95 disabled:opacity-45 disabled:cursor-not-allowed text-[#141121] font-display font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-2 shadow-lg active:scale-[0.99] transition-all cursor-pointer"
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
                      {!hasValidGps
                        ? 'Menunggu Koordinat GPS Terkunci...'
                        : 'KONFIRMASI CHECK-IN FOTO RUMAH'}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Quick Safety SOP Micro-Audit Legend */}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[#cbc3d7] font-mono text-[10px] opacity-85 text-center">
            <span className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  checkGeofenceOk ? 'bg-[#40efb7]' : 'bg-amber-400'
                }`}
              />
              {distanceToRegisteredMeters !== null
                ? `Geofence ${formatDistanceMetersLabel(distanceToRegisteredMeters)} ${
                    distanceToRegisteredMeters <= GEOFENCE_SOP_LIMIT_METERS ? '≤ 50m' : '> 50m'
                  }`
                : 'Geofence Baseline Baru'}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  checkCameraOk ? 'bg-[#40efb7]' : 'bg-amber-400'
                }`}
              />
              {checkCameraOk ? 'Hardware Sensor Ready' : 'Menunggu Sensor Kamera'}
            </span>
          </div>
        </div>

        {/* Capture Flash Micro-Interaction Overlay */}
        <div
          aria-hidden="true"
          className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-150 z-40 ${
            captureFlashActive ? 'opacity-80' : 'opacity-0'
          }`}
        />

        {/* Capture Toast Confirmation Notice */}
        <div
          aria-live="polite"
          className={`fixed top-14 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 pointer-events-none flex items-center gap-2 px-4 py-2 rounded-full bg-[#00d29c] text-[#00543d] shadow-xl ${
            captureToastVisible ? 'translate-y-0 opacity-100' : '-translate-y-16 opacity-0'
          }`}
        >
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span className="font-mono text-[11px] font-bold tracking-wide uppercase">
            FOTO RUMAH TERAMBIL
          </span>
        </div>
      </div>

      {/* 5. INTERACTIVE EXPANDABLE BOTTOM SHEET: Field Notes, Sensor Telemetry & SOP Drawer */}
      {isNotesSheetOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
          onClick={() => setIsNotesSheetOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`fixed inset-x-0 bottom-0 z-50 transform transition-transform duration-300 ease-out flex flex-col bg-[#2b2839]/96 backdrop-blur-2xl rounded-t-3xl border-t border-white/15 shadow-2xl ${
          isNotesSheetOpen ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        aria-hidden={!isNotesSheetOpen}
      >
        {/* Drag Handle Area */}
        <button
          type="button"
          onClick={() => setIsNotesSheetOpen(false)}
          aria-label="Tutup panel catatan lapangan"
          className="w-full flex flex-col items-center pt-3 pb-2 cursor-pointer"
        >
          <span className="w-10 h-1 rounded-full bg-[#494454]" />
        </button>

        {/* Sheet Content Container */}
        <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col gap-3.5 max-h-[78dvh] overflow-y-auto">
          {/* Header Row with Dismiss */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-5 h-5 text-[#40efb7] shrink-0" />
              <h3 className="font-display text-base font-semibold text-[#e6dff7] truncate">
                Catatan Lapangan &amp; Posisi ODP
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setIsNotesSheetOpen(false)}
              aria-label="Tutup"
              className="w-8 h-8 rounded-full bg-[#363244] flex items-center justify-center text-[#cbc3d7] hover:text-white active:scale-95 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Telemetry Diagnostics Readout Box */}
          <div className="p-3 rounded-xl bg-[#0f0c1c]/85 border border-white/10 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-[#d0bcff] tracking-wider font-semibold uppercase">
                SENSOR TELEMETRY
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`font-mono text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    hasValidGps
                      ? 'text-[#40efb7] bg-[#00d29c]/20'
                      : 'text-amber-300 bg-amber-500/20'
                  }`}
                >
                  {hasValidGps ? 'CHECK-IN VALID' : 'MENUNGGU GPS'}
                </span>
                <button
                  type="button"
                  onClick={handleRefreshGps}
                  disabled={isRefreshingGps || Boolean(capturedPhoto)}
                  className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 border border-white/10 font-mono text-[10px] font-bold text-[#e6dff7] flex items-center gap-1 cursor-pointer disabled:opacity-45"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshingGps ? 'animate-spin' : ''}`} />
                  <span>{hasValidGps ? 'Lock Ulang' : 'Kunci GPS'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-[#e6dff7]">
              <div className="flex flex-col">
                <span className="text-[#cbc3d7] font-mono text-[10px]">Latitude / Longitude</span>
                <span className="font-mono text-xs text-[#e6dff7] mt-0.5 tabular-nums">
                  {hasValidGps && activeGps
                    ? formatCoordinates(activeGps.latitude, activeGps.longitude)
                    : '—'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[#cbc3d7] font-mono text-[10px]">Radius Check-In</span>
                <span
                  className={`font-mono text-xs mt-0.5 tabular-nums ${
                    checkGeofenceOk ? 'text-[#40efb7]' : 'text-amber-300'
                  }`}
                >
                  {distanceToRegisteredMeters !== null
                    ? `${formatDistanceMetersLabel(distanceToRegisteredMeters)} (Maks 50m)`
                    : hasValidGps
                    ? 'Baseline Baru'
                    : 'Menunggu GPS'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[#cbc3d7] font-mono text-[10px]">Elevasi / Alt</span>
                <span className="font-mono text-xs text-[#e6dff7] mt-0.5 tabular-nums">
                  {typeof activeGps?.altitudeMeters === 'number'
                    ? `${activeGps.altitudeMeters.toFixed(1)} m ASL`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[#cbc3d7] font-mono text-[10px]">Akurasi &amp; Heading</span>
                <span className="font-mono text-xs text-[#e6dff7] mt-0.5 tabular-nums">
                  {hasValidGps && activeGps
                    ? `±${Math.round(activeGps.accuracyMeters)}m${
                        typeof activeGps.headingDeg === 'number'
                          ? ` / ${Math.round(activeGps.headingDeg)}°`
                          : ''
                      }`
                    : '—'}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-white/10 text-[11px] text-[#cbc3d7] flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#d0bcff] shrink-0 mt-0.5" />
              <span className="leading-snug">Target: {displayAddress}</span>
            </div>

            {gpsErrorMsg && (
              <div className="rounded-lg bg-[#93000a]/60 border border-[#ffb4ab]/40 px-2.5 py-1.5 text-[11px] text-[#ffdad6] flex items-center gap-1.5">
                <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-[#ffb4ab]" />
                <span className="leading-snug">{gpsErrorMsg}</span>
              </div>
            )}

            {/* 3-Step SOP Validation Breakdown */}
            <div className="pt-2 border-t border-white/10 space-y-1 text-[11px]">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`w-3.5 h-3.5 shrink-0 ${
                    checkCameraOk ? 'text-[#40efb7]' : 'text-[#958ea0]'
                  }`}
                />
                <span className={checkCameraOk ? 'text-[#e6dff7]' : 'text-[#958ea0]'}>
                  Kamera Hardware Langsung Aktif (Anti-Galeri)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {checkGpsLocked ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#40efb7]" />
                ) : (
                  <Satellite className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                )}
                <span className={checkGpsLocked ? 'text-[#e6dff7]' : 'text-amber-200'}>
                  {checkGpsLocked && activeGps
                    ? `GPS Terkunci Akurat (±${Math.round(activeGps.accuracyMeters)}m ≤ 50m)`
                    : hasValidGps && activeGps
                    ? `GPS Akurasi Lemah (±${Math.round(activeGps.accuracyMeters)}m)`
                    : 'Menunggu Penguncian Koordinat GPS'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {checkGeofenceOk ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#40efb7]" />
                ) : (
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                )}
                <span className={checkGeofenceOk ? 'text-[#e6dff7]' : 'text-amber-200'}>
                  {distanceToRegisteredMeters !== null
                    ? distanceToRegisteredMeters <= GEOFENCE_SOP_LIMIT_METERS
                      ? `Radius Sesuai GIS Target (${formatDistanceMetersLabel(distanceToRegisteredMeters)})`
                      : `Deviasi Jarak ${formatDistanceMetersLabel(distanceToRegisteredMeters)} (> 50m)`
                    : hasValidGps
                    ? 'Koordinat Check-In dicatat sebagai lokasi rumah'
                    : 'Validasi Geofence menunggu GPS'}
                </span>
              </div>
            </div>
          </div>

          {/* Quick ODP Identification Form Field */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="odp-notes-input" className="font-mono text-[11px] text-[#cbc3d7]">
                Deskripsi Fisik &amp; Posisi ODP Induk (Opsional)
              </label>
              <span className="font-mono text-[10.5px] text-[#d0bcff] tabular-nums">
                {fieldNotes.length} / 120
              </span>
            </div>
            <textarea
              id="odp-notes-input"
              rows={3}
              maxLength={120}
              value={fieldNotes}
              disabled={isSubmitting}
              onChange={e => setFieldNotes(e.target.value)}
              placeholder="Contoh: Pagar hitam No. 42B, kabel drop optik dari tiang depan kiri..."
              className="w-full bg-[#0f0c1c] text-[#e6dff7] p-3 rounded-xl text-xs sm:text-sm placeholder:text-[#958ea0]/60 border border-white/10 focus:outline-none focus:ring-1 focus:ring-[#d0bcff] resize-none transition-all shadow-inner"
            />
          </div>

          {/* Fast Tag Suggestions */}
          <div className="flex flex-wrap gap-1.5">
            {FAST_NOTE_TAGS.map(tag => (
              <button
                key={tag}
                type="button"
                disabled={isSubmitting}
                onClick={() => handleAppendTag(tag)}
                className="px-2.5 py-1 rounded-full bg-[#363244] hover:bg-[#d0bcff] hover:text-[#3c0091] text-[#cbc3d7] font-mono text-[10px] active:scale-95 transition-colors cursor-pointer disabled:opacity-50"
              >
                + {tag}
              </button>
            ))}
          </div>

          {/* Action Confirmation Button */}
          <button
            type="button"
            onClick={() => setIsNotesSheetOpen(false)}
            className="w-full py-3.5 rounded-xl bg-[#d0bcff] hover:bg-[#e9ddff] text-[#3c0091] font-display text-sm font-bold flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-transform cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Simpan Catatan Check-In</span>
          </button>
        </div>
      </div>
    </div>
  );
};
