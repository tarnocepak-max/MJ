import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserCodeReader, BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import {
  Camera,
  Check,
  Flashlight,
  FlashlightOff,
  QrCode,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SwitchCamera,
  Upload,
  X
} from 'lucide-react';
import { useVisualViewportModal } from '../../hooks/useVisualViewportModal';

export interface ParsedBarcodePayload {
  serialNumber: string;
  macAddress?: string;
  rawText: string;
  formatLabel?: string;
  capturedImageDataUrl?: string;
  captureMethod?: 'camera' | 'gallery';
}

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  woNumber?: string;
  initialSerialNumber?: string;
  allowManualPhotoFallback?: boolean;
  onConfirmSerialNumber: (serialNumber: string, meta?: ParsedBarcodePayload) => void;
}

const SUPPORTED_BARCODE_FORMATS: BarcodeFormat[] = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
  BarcodeFormat.AZTEC
];

function createConfiguredReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, any>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_BARCODE_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 160,
    delayBetweenScanSuccess: 500
  });
}

export function parseDeviceBarcodePayload(rawInput: string, formatLabel?: string): ParsedBarcodePayload {
  const rawText = String(rawInput || '').trim();
  if (!rawText) {
    return { serialNumber: '', rawText: '', formatLabel };
  }

  let extractedSn = '';
  let extractedMac = '';

  // 1. JSON payload check (some smart Wi-Fi routers encode JSON in QR)
  if (rawText.startsWith('{') && rawText.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object') {
        const snCandidate =
          parsed.sn ??
          parsed.SN ??
          parsed.serial ??
          parsed.serialNumber ??
          parsed.serial_number ??
          parsed.gpon_sn ??
          parsed.ont_sn ??
          parsed.deviceSerialNumber;
        const macCandidate = parsed.mac ?? parsed.MAC ?? parsed.macAddress ?? parsed.ontMacAddress;
        if (typeof snCandidate === 'string' && snCandidate.trim()) {
          extractedSn = snCandidate.trim();
        }
        if (typeof macCandidate === 'string' && macCandidate.trim()) {
          extractedMac = macCandidate.trim().toUpperCase();
        }
      }
    } catch {
      // Fallback to regex parsing below
    }
  }

  // 2. Labeled key-value formats (e.g. "SN:ZTEGC1234567", "GPON S/N=HWTC1A2B3C4D;MAC=...")
  if (!extractedSn) {
    const snMatch = rawText.match(
      /(?:GPON\s*)?(?:DEVICE\s*)?(?:S\/?N|SERIAL(?:\s*NO)?|SN_ONT|ONT_SN)\s*[:=]\s*([A-Za-z0-9\-_]{4,40})/i
    );
    if (snMatch?.[1]) {
      extractedSn = snMatch[1].trim();
    }
  }

  if (!extractedMac) {
    const macMatch = rawText.match(/(?:MAC(?:\s*ADDR(?:ESS)?)?)\s*[:=]\s*([0-9A-Fa-f:-]{12,17})/i);
    if (macMatch?.[1]) {
      extractedMac = macMatch[1].trim().toUpperCase();
    }
  }

  // 3. URL query param fallback (e.g. https://.../?sn=ZTEG12345)
  if (!extractedSn && /^https?:\/\//i.test(rawText)) {
    try {
      const url = new URL(rawText);
      const qSn =
        url.searchParams.get('sn') ||
        url.searchParams.get('SN') ||
        url.searchParams.get('serial') ||
        url.searchParams.get('serialNumber');
      if (qSn && qSn.trim()) {
        extractedSn = qSn.trim();
      }
    } catch {
      // Ignore invalid URL
    }
  }

  // 4. Plain 1D/2D sticker value (single token or first non-empty line without labels)
  if (!extractedSn) {
    const firstCleanLine = rawText
      .split(/[\r\n;]+/)
      .map(part => part.trim())
      .find(Boolean);
    if (firstCleanLine) {
      extractedSn = firstCleanLine.replace(/^(?:SN|S\/N)\s+/i, '').replace(/\s+/g, '');
    }
  }

  const normalizedSn = extractedSn.replace(/\s+/g, '').toUpperCase();

  return {
    serialNumber: normalizedSn,
    macAddress: extractedMac || undefined,
    rawText,
    formatLabel
  };
}

function playScanSuccessBeep(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6 crisp scanner tone
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 250);
  } catch {
    // Audio feedback is purely optional
  }
}

function captureVideoFrameDataUrl(videoEl: HTMLVideoElement | null): string | undefined {
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return undefined;
  try {
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(videoEl.videoWidth, videoEl.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(videoEl.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(videoEl.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return undefined;
  }
}

async function fileToResizedDataUrl(file: File): Promise<string | undefined> {
  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objectUrl;
      });
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.width || 800) * scale));
      canvas.height = Math.max(1, Math.round((img.height || 600) * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return undefined;
  }
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  title = 'Scan Barcode / QR SN Perangkat',
  subtitle = 'Arahkan kamera ke stiker barcode SN ONT atau perangkat Wi-Fi',
  woNumber,
  initialSerialNumber,
  allowManualPhotoFallback = true,
  onConfirmSerialNumber
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scanHandledRef = useRef(false);
  const vv = useVisualViewportModal(isOpen);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'initializing' | 'scanning' | 'detected' | 'error'>(
    'initializing'
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const [detectedPayload, setDetectedPayload] = useState<ParsedBarcodePayload | null>(null);
  const [editableSn, setEditableSn] = useState('');
  const [isDecodingImage, setIsDecodingImage] = useState(false);

  const reader = useMemo(() => createConfiguredReader(), []);

  const stopScannerResources = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {}
      controlsRef.current = null;
    }

    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {}
      });
      activeStreamRef.current = null;
    }

    if (videoRef.current) {
      const currentStream = videoRef.current.srcObject as MediaStream | null;
      if (currentStream) {
        currentStream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch {}
        });
      }
      videoRef.current.srcObject = null;
    }

    try {
      BrowserCodeReader.releaseAllStreams();
    } catch {}

    setTorchSupported(false);
    setTorchEnabled(false);
  }, []);

  const handleDecodedRawText = useCallback(
    (
      rawText: string,
      formatLabel?: string,
      preCapturedImageUrl?: string,
      captureMethod: 'camera' | 'gallery' = 'camera'
    ) => {
      if (scanHandledRef.current) return;
      const parsed = parseDeviceBarcodePayload(rawText, formatLabel);
      if (!parsed.serialNumber) return;

      const capturedImageDataUrl = preCapturedImageUrl || captureVideoFrameDataUrl(videoRef.current);
      scanHandledRef.current = true;
      playScanSuccessBeep();
      setDetectedPayload({
        ...parsed,
        capturedImageDataUrl,
        captureMethod
      });
      setEditableSn(parsed.serialNumber);
      setCameraState('detected');
      stopScannerResources();
    },
    [stopScannerResources]
  );

  const startLiveScanner = useCallback(
    async (targetFacing: 'environment' | 'user') => {
      stopScannerResources();
      scanHandledRef.current = false;
      setDetectedPayload(null);
      setErrorMessage('');
      setCameraState('initializing');

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraState('error');
        setErrorMessage(
          'Browser tidak mendukung akses kamera langsung. Gunakan tombol Upload / Foto Stiker Barcode di bawah.'
        );
        return;
      }

      const videoEl = videoRef.current;
      if (!videoEl) return;

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      try {
        const controls = await reader.decodeFromConstraints(
          constraints,
          videoEl,
          (result, _err) => {
            if (result && !scanHandledRef.current) {
              const rawText = result.getText();
              const fmt = result.getBarcodeFormat?.();
              const fmtLabel = fmt !== undefined ? BarcodeFormat[fmt] : undefined;
              handleDecodedRawText(rawText, fmtLabel);
            }
          }
        );

        controlsRef.current = controls;
        const stream = videoEl.srcObject as MediaStream | null;
        activeStreamRef.current = stream;

        if (stream) {
          const videoTrack = stream.getVideoTracks()[0];
          const caps = (videoTrack?.getCapabilities?.() as any) || {};
          setTorchSupported(Boolean(caps?.torch) || BrowserCodeReader.mediaStreamIsTorchCompatible(stream));
        }

        setCameraState('scanning');
      } catch (err: any) {
        let msg = 'Kamera barcode tidak dapat dibuka.';
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          msg =
            'Izin kamera ditolak oleh browser/perangkat. Izinkan akses kamera atau ambil foto stiker barcode melalui tombol fallback.';
        } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          msg = 'Kamera tidak terdeteksi pada perangkat ini. Gunakan upload foto stiker barcode.';
        } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
          msg = 'Kamera sedang digunakan oleh aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.';
        } else if (err?.message) {
          msg = `Gagal memulai scanner kamera: ${err.message}`;
        }
        stopScannerResources();
        setCameraState('error');
        setErrorMessage(msg);
      }
    },
    [handleDecodedRawText, reader, stopScannerResources]
  );

  useEffect(() => {
    if (!isOpen) {
      stopScannerResources();
      scanHandledRef.current = false;
      setDetectedPayload(null);
      setEditableSn('');
      setErrorMessage('');
      return;
    }

    const startTimer = setTimeout(() => {
      startLiveScanner(facingMode);
    }, 60);

    return () => {
      clearTimeout(startTimer);
      stopScannerResources();
    };
  }, [isOpen, facingMode, startLiveScanner, stopScannerResources]);

  const handleToggleTorch = async () => {
    const nextTorch = !torchEnabled;
    if (controlsRef.current?.switchTorch) {
      try {
        await controlsRef.current.switchTorch(nextTorch);
        setTorchEnabled(nextTorch);
        return;
      } catch {}
    }

    const track = activeStreamRef.current?.getVideoTracks()?.[0];
    if (track) {
      try {
        await BrowserCodeReader.mediaStreamSetTorch(track, nextTorch);
        setTorchEnabled(nextTorch);
      } catch {
        setTorchSupported(false);
      }
    }
  };

  const handleSwitchCamera = () => {
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleRescan = () => {
    startLiveScanner(facingMode);
  };

  const handleConfirm = () => {
    const finalSn = editableSn.trim().toUpperCase();
    if (!finalSn) return;
    stopScannerResources();
    onConfirmSerialNumber(
      finalSn,
      detectedPayload
        ? { ...detectedPayload, serialNumber: finalSn }
        : { serialNumber: finalSn, rawText: finalSn }
    );
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsDecodingImage(true);
    setErrorMessage('');
    const objectUrl = URL.createObjectURL(file);
    const resizedPhotoUrl = await fileToResizedDataUrl(file);

    try {
      const result = await reader.decodeFromImageUrl(objectUrl);
      const rawText = result.getText();
      const fmt = result.getBarcodeFormat?.();
      const fmtLabel = fmt !== undefined ? BarcodeFormat[fmt] : undefined;
      scanHandledRef.current = false;
      handleDecodedRawText(rawText, fmtLabel, resizedPhotoUrl, 'gallery');
    } catch {
      if (allowManualPhotoFallback && resizedPhotoUrl) {
        scanHandledRef.current = true;
        const fallbackSn = String(initialSerialNumber || '').trim().toUpperCase();
        setDetectedPayload({
          serialNumber: fallbackSn,
          rawText: fallbackSn,
          formatLabel: 'MANUAL',
          capturedImageDataUrl: resizedPhotoUrl,
          captureMethod: 'gallery'
        });
        setEditableSn(fallbackSn);
        setCameraState('detected');
        setErrorMessage(
          'Barcode tidak terbaca otomatis dari foto, tetapi foto stiker tersimpan. Ketik Serial Number secara manual pada kolom di bawah.'
        );
        stopScannerResources();
      } else {
        setErrorMessage(
          'Barcode atau QR Code tidak terbaca jelas dari foto tersebut. Pastikan fokus tajam pada stiker SN dan pencahayaan cukup.'
        );
        if (cameraState !== 'scanning') {
          setCameraState('error');
        }
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
      setIsDecodingImage(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-scanner-modal-title"
      style={vv.keyboardInset > 0 ? { paddingBottom: `${vv.keyboardInset}px` } : undefined}
      className="fixed inset-0 z-[105] flex items-end sm:items-center justify-center bg-[#0B0617]/90 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        style={vv.isKeyboardOpen ? { maxHeight: `${Math.max(280, vv.viewportHeight - 16)}px` } : undefined}
        className="relative w-full sm:max-w-lg bg-[#160D29] text-white rounded-t-[24px] sm:rounded-2xl border border-[#35105E] shadow-2xl overflow-hidden flex flex-col max-h-[94dvh]"
      >
        {/* Mobile Handle */}
        <div className="flex justify-center pt-2 pb-1 sm:hidden shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/25" />
        </div>

        {/* Header */}
        <header className="px-4 py-3 border-b border-[#35105E] flex items-start justify-between gap-3 shrink-0 bg-[#1B1033]">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#58149C] border border-[#A380FE]/40 text-[#EEDBFF] flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2
                  id="barcode-scanner-modal-title"
                  className="font-display font-bold text-sm sm:text-base text-white truncate"
                >
                  {title}
                </h2>
                {woNumber && (
                  <span className="px-2 py-0.5 rounded bg-[#2D115B] border border-[#58149C] font-mono text-[10px] font-bold text-[#DAB9FF]">
                    {woNumber}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#C4B5D6] leading-snug mt-0.5">
                {subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopScannerResources();
              onClose();
            }}
            aria-label="Tutup kamera scanner barcode"
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Camera Viewport / Result Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3.5">
          {/* Live Video Frame */}
          <div className="relative rounded-2xl overflow-hidden bg-black border border-[#35105E] aspect-[4/3] w-full flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`w-full h-full object-cover ${
                cameraState === 'detected' || cameraState === 'error' ? 'opacity-25' : 'opacity-100'
              }`}
            />

            {/* Reticle Overlay while scanning */}
            {(cameraState === 'scanning' || cameraState === 'initializing') && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
                <div className="relative w-full max-w-[280px] h-36 sm:h-40 rounded-xl border-2 border-[#DAB9FF]/70 shadow-[0_0_0_9999px_rgba(11,6,23,0.48)]">
                  {/* Corner Brackets */}
                  <span className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-[#A380FE] rounded-tl-md" />
                  <span className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-[#A380FE] rounded-tr-md" />
                  <span className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-[#A380FE] rounded-bl-md" />
                  <span className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-[#A380FE] rounded-br-md" />
                  {/* Scan Laser Line */}
                  <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_10px_rgba(52,211,153,0.9)] motion-safe:animate-pulse" />
                </div>

                <span className="mt-4 px-3 py-1 rounded-full bg-[#160D29]/85 border border-[#58149C]/60 font-mono text-[10.5px] font-semibold text-[#EEDBFF]">
                  {cameraState === 'initializing'
                    ? 'Mengaktifkan kamera...'
                    : 'Posisikan Barcode 1D / QR Code di dalam kotak'}
                </span>
              </div>
            )}

            {/* Live Camera Controls Overlay */}
            {cameraState === 'scanning' && (
              <div className="absolute top-2.5 right-2.5 flex items-center gap-2">
                {torchSupported && (
                  <button
                    type="button"
                    onClick={handleToggleTorch}
                    aria-label={torchEnabled ? 'Matikan Flash' : 'Nyalakan Flash'}
                    title={torchEnabled ? 'Matikan Senter' : 'Nyalakan Senter'}
                    className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                      torchEnabled
                        ? 'bg-amber-400 text-[#160D29] border-amber-300'
                        : 'bg-[#160D29]/85 text-white border-white/20 hover:bg-[#2D115B]'
                    }`}
                  >
                    {torchEnabled ? (
                      <FlashlightOff className="w-5 h-5" />
                    ) : (
                      <Flashlight className="w-5 h-5" />
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  aria-label="Ganti kamera depan atau belakang"
                  title="Ganti Kamera"
                  className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[#160D29]/85 border border-white/20 text-white hover:bg-[#2D115B] flex items-center justify-center cursor-pointer transition-colors"
                >
                  <SwitchCamera className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Detected Success Overlay */}
            {cameraState === 'detected' && detectedPayload && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center bg-[#160D29]/80">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 flex items-center justify-center mb-2.5">
                  <Check className="w-6 h-6" />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider font-bold text-emerald-300">
                  {detectedPayload.formatLabel
                    ? `TERDETEKSI (${detectedPayload.formatLabel})`
                    : 'BARCODE / QR TERDETEKSI'}
                </span>
                <div className="mt-1 font-mono text-lg sm:text-xl font-extrabold text-white tracking-wider break-all max-w-full px-2">
                  {editableSn || detectedPayload.serialNumber}
                </div>
                {detectedPayload.rawText !== detectedPayload.serialNumber && (
                  <p className="mt-1.5 text-[10.5px] font-mono text-[#C4B5D6] line-clamp-2 max-w-xs">
                    Payload asli: {detectedPayload.rawText}
                  </p>
                )}
              </div>
            )}

            {/* Camera Error Overlay */}
            {cameraState === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center bg-[#160D29]/90 space-y-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-400/40 text-rose-300 flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <p className="text-xs text-rose-200 max-w-xs leading-relaxed">
                  {errorMessage}
                </p>
                <button
                  type="button"
                  onClick={handleRescan}
                  className="px-4 min-h-[44px] rounded-xl bg-[#58149C] hover:bg-[#7135B5] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Coba Buka Kamera Lagi</span>
                </button>
              </div>
            )}
          </div>

          {/* Detected SN Confirmation & Manual Correction Box */}
          {detectedPayload && (
            <div className="rounded-xl bg-[#22143E] border border-[#58149C]/70 p-3.5 space-y-2.5">
              {detectedPayload.capturedImageDataUrl && (
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[#160D29] border border-[#4B386B]">
                  <img
                    src={detectedPayload.capturedImageDataUrl}
                    alt="Foto Stiker Barcode SN"
                    className="w-16 h-12 rounded object-cover border border-[#58149C]/50 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-emerald-300">
                      Foto stiker barcode siap disimpan ke Slot 06
                    </div>
                    <div className="text-[10px] text-[#C4B5D6] truncate">
                      {detectedPayload.formatLabel === 'MANUAL'
                        ? 'Foto tersimpan · Lengkapi SN secara manual di bawah'
                        : 'Otomatis mengisi SN ONT & foto bukti Slot 06'}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="scanned-sn-preview"
                  className="text-xs font-bold text-[#EEDBFF]"
                >
                  Serial Number (SN) {detectedPayload.formatLabel === 'MANUAL' ? 'Manual' : 'Terdeteksi'}
                </label>
                {detectedPayload.macAddress && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#160D29] border border-[#4B386B] text-[#DAB9FF]">
                    MAC: {detectedPayload.macAddress}
                  </span>
                )}
              </div>

              <input
                id="scanned-sn-preview"
                type="text"
                value={editableSn}
                onChange={e => setEditableSn(e.target.value.toUpperCase())}
                placeholder="SN Perangkat"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#160D29] border border-[#4B386B] font-mono font-bold text-sm text-white uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-[#A380FE]"
              />

              <p className="text-[11px] text-[#C4B5D6] leading-snug">
                Pastikan nilai di atas sesuai stiker GPON SN / SN perangkat Wi-Fi (bukan MAC atau Part No.). Anda bisa mengedit langsung atau Scan Ulang.
              </p>
            </div>
          )}

          {/* Error Notice while scanning */}
          {cameraState !== 'error' && errorMessage && (
            <div className="rounded-xl bg-rose-950/60 border border-rose-700/60 px-3 py-2.5 text-xs text-rose-200 leading-snug">
              {errorMessage}
            </div>
          )}

          {/* Fallback Upload / Native Camera Image Decode */}
          <div className="rounded-xl bg-[#1E1238] border border-[#35105E] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white">
                Barcode sulit fokus atau kamera diblokir?
              </div>
              <div className="text-[11px] text-[#C4B5D6]">
                {initialSerialNumber
                  ? `SN tersimpan saat ini: ${initialSerialNumber}`
                  : 'Ambil foto stiker barcode atau pilih gambar dari galeri perangkat.'}
              </div>
            </div>

            <button
              type="button"
              disabled={isDecodingImage}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] px-3.5 rounded-xl bg-[#2D115B] hover:bg-[#3E187C] border border-[#58149C] text-[#EEDBFF] text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60"
            >
              {isDecodingImage ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span>{isDecodingImage ? 'Membaca...' : 'Foto / Galeri Barcode'}</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageFileChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <footer className="px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] border-t border-[#35105E] bg-[#1B1033] flex items-center gap-2.5 shrink-0">
          {detectedPayload ? (
            <>
              <button
                type="button"
                onClick={handleRescan}
                className="min-h-[46px] px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Scan Ulang</span>
              </button>
              <button
                type="button"
                disabled={!editableSn.trim()}
                onClick={handleConfirm}
                className="mj-btn-installer-primary flex-1 min-h-[46px] px-4 text-xs sm:text-sm font-extrabold gap-2 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-4 h-4 shrink-0" />
                <span>Gunakan SN Ini</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  stopScannerResources();
                  onClose();
                }}
                className="min-h-[46px] px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold cursor-pointer shrink-0"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isDecodingImage}
                className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#58149C] hover:bg-[#7135B5] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Ambil Foto Stiker Barcode</span>
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
};
