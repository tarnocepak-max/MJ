import React, { useState } from 'react';
import { ErrorDetails, sanitizeErrorMessage } from '../../services/errorSystem';
import {
  AlertTriangle,
  X,
  RotateCcw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Terminal
} from 'lucide-react';
import { MoraJawsLogo } from './MoraJawsLogo';

export interface GlobalErrorAlertProps {
  error: ErrorDetails | null;
  isOpen: boolean;
  onClose: () => void;
}

export const GlobalErrorAlert: React.FC<GlobalErrorAlertProps> = ({
  error,
  isOpen,
  onClose
}) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  if (!isOpen || !error) return null;

  const sanitizedTechnical = sanitizeErrorMessage(error.technicalDetails || error.description);

  const handleCopyCode = async () => {
    try {
      const copyPayload = `[MORAJAWS SYSTEM ALERT]\nError Code: ${error.errorCode}\nModule: ${error.module}\nOperation: ${error.operation}\nMessage: ${error.description}\nTechnical Details: ${sanitizedTechnical}\nTimestamp: ${new Date().toISOString()}`;
      await navigator.clipboard.writeText(copyPayload);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch {
      // Fallback
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    }
  };

  const handleRetry = async () => {
    if (error.onRetry) {
      setIsRetrying(true);
      try {
        await Promise.resolve(error.onRetry());
        onClose();
      } catch (e) {
        console.warn('Retry attempt failed:', e);
      } finally {
        setIsRetrying(false);
      }
    } else {
      onClose();
    }
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-dialog-title"
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-5 bg-[#30104B]/65 backdrop-blur-[6px] animate-in fade-in duration-200"
    >
      {/* Click outside backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Main Imperial Violet Floating Glassmorphism Card */}
      <div
        className="relative z-10 w-full max-w-lg max-h-[92dvh] flex flex-col rounded-t-[24px] sm:rounded-[22px] bg-gradient-to-br from-[#30104B]/95 via-[#250E40]/95 to-[#160829]/95 border border-[#8648F5]/45 shadow-[0_28px_64px_-12px_rgba(16,4,36,0.78),inset_0_1px_0_rgba(255,255,255,0.22)] text-white overflow-hidden"
        style={{
          animation: 'morajaws-scale-up 0.25s cubic-bezier(0.16, 1, 0.3, 1), morajaws-shake 0.4s ease-in-out'
        }}
      >
        {/* Subtle Ambient Violet Glow in background */}
        <div className="absolute -top-16 -right-16 w-48 h-48 bg-[#8648F5]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-[#5424A8]/25 rounded-full blur-3xl pointer-events-none" />

        {/* Header Bar */}
        <div className="px-5 pt-5 pb-4 sm:px-7 sm:pt-6 border-b border-white/15 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <MoraJawsLogo size="xs" withGlow={false} />
            <div className="min-w-0">
              <span className="text-[10.5px] font-mono tracking-widest text-[#EEE5FF] uppercase font-bold block truncate">
                MORAJAWS SYSTEM ALERT
              </span>
              <span className="text-[10px] text-[#C5B3DF] font-mono block truncate">
                Security & Operation Incident Guard
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mj-notif-btn-3d-glass w-11 h-11 min-w-[44px] min-h-[44px] sm:w-8 sm:h-8 sm:min-w-0 sm:min-h-0 rounded-[11px] flex items-center justify-center cursor-pointer shrink-0"
            title="Tutup Alert"
            aria-label="Tutup Alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-7 space-y-4">
          {/* Hero Alert Body */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            {/* 3D Glossy Warning Icon */}
            <div className="relative shrink-0 flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-700 via-indigo-900 to-slate-950 border border-purple-300/40 shadow-lg shadow-purple-900/50">
              <div className="absolute inset-0 rounded-2xl bg-purple-400/10 blur-xs pointer-events-none" />
              <AlertTriangle className="w-7 h-7 text-purple-200 drop-shadow-[0_0_8px_rgba(216,180,254,0.6)] animate-pulse" />
            </div>

            <div className="flex-1 text-center sm:text-left space-y-1">
              <h4
                id="alert-dialog-title"
                className="text-base sm:text-lg font-black tracking-tight text-white uppercase"
              >
                OOPS! SOMETHING WENT WRONG
              </h4>
              <p className="text-xs sm:text-sm text-purple-200/90 leading-relaxed font-normal">
                {error.description || 'Terjadi gangguan tak terduga pada sistem.'}
              </p>
            </div>
          </div>

          {/* Structured Diagnostics Grid */}
          <div className="rounded-xl bg-black/40 border border-purple-500/25 p-3.5 space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between gap-2">
              <span className="text-purple-300/70 text-[11px]">Error Code:</span>
              <span className="font-bold text-amber-300 px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/30">
                {error.errorCode}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-purple-300/70 text-[11px]">Module:</span>
              <span className="text-purple-200 font-semibold text-right break-all">{error.module}</span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-purple-300/70 text-[11px]">Operation:</span>
              <span className="text-slate-300 text-right break-all">{error.operation}</span>
            </div>

            {error.backendErrorCode && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-purple-300/70 text-[11px]">Backend Code:</span>
                <span className="text-purple-300">{error.backendErrorCode}</span>
              </div>
            )}
          </div>

          {/* Technical Details Accordion */}
          <div>
            <button
              type="button"
              onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
              className="w-full min-h-[40px] flex items-center justify-between text-[11px] font-semibold text-purple-300 hover:text-purple-100 py-1 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                <span>{showTechnicalDetails ? 'SEMBUNYIKAN DETAIL TEKNIS' : 'LIHAT DETAIL TEKNIS'}</span>
              </span>
              {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showTechnicalDetails && (
              <div className="mt-2 p-3 rounded-lg bg-slate-950/90 border border-purple-500/20 text-[11px] font-mono text-purple-200/80 max-h-36 overflow-y-auto whitespace-pre-wrap break-all leading-snug">
                {sanitizedTechnical}
              </div>
            )}
          </div>
        </div>

        {/* Action Button Group */}
        <div className="px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-7 sm:pb-6 border-t border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
          {/* Retry Button */}
          {error.onRetry ? (
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="mj-notif-btn-3d min-h-[44px] sm:min-h-0 py-2.5 px-3 font-extrabold text-xs rounded-[13px] flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
              <span>COBA LAGI</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="mj-notif-btn-3d min-h-[44px] sm:min-h-0 py-2.5 px-3 font-extrabold text-xs rounded-[13px] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>MENGERTI</span>
            </button>
          )}

          {/* Toggle Details */}
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="mj-notif-btn-3d-glass min-h-[44px] sm:min-h-0 py-2.5 px-3 font-bold text-xs rounded-[13px] flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>DETAIL</span>
          </button>

          {/* Copy Error Code */}
          <button
            type="button"
            onClick={handleCopyCode}
            className="mj-notif-btn-3d-glass min-h-[44px] sm:min-h-0 py-2.5 px-3 font-bold text-xs rounded-[13px] flex items-center justify-center gap-1.5 cursor-pointer"
            title="Salin rincian kode error"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{isCopied ? 'TERSALIN' : 'SALIN KODE'}</span>
          </button>

          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            className="mj-notif-btn-3d-glass min-h-[44px] sm:min-h-0 py-2.5 px-3 font-bold text-xs rounded-[13px] flex items-center justify-center cursor-pointer"
          >
            <span>TUTUP</span>
          </button>
        </div>
      </div>
    </div>
  );
};
