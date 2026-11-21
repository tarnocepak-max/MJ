import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  X
} from 'lucide-react';
import type { ToastItem } from '../../context/ToastContext';

interface NotificationToastProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
  onPauseTimer: (id: string) => void;
  onResumeTimer: (id: string) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  item,
  onDismiss,
  onPauseTimer,
  onResumeTimer
}) => {
  const isSuccess = item.type === 'success';
  const isError = item.type === 'error';
  const isWarning = item.type === 'warning';
  const isLoading = item.type === 'loading';
  const isSync = item.type === 'sync';

  const defaultBadge = isSuccess
    ? 'BERHASIL'
    : isError
    ? 'KESALAHAN'
    : isWarning
    ? 'PERINGATAN'
    : isSync
    ? 'AUTO-SYNC RELAY'
    : isLoading
    ? 'MEMPROSES'
    : 'INFORMASI';

  const badgeLabel = item.badge || defaultBadge;

  const badgeColor = isSuccess
    ? 'text-emerald-700 dark:text-emerald-300'
    : isError
    ? 'text-rose-700 dark:text-rose-300'
    : isWarning
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-[#5424A8] dark:text-[#C9A8FF]';

  const accentStripe = isSuccess
    ? 'bg-emerald-500'
    : isError
    ? 'bg-rose-600'
    : isWarning
    ? 'bg-amber-500'
    : 'bg-gradient-to-b from-[#8648F5] to-[#5424A8]';

  const progressBg = isSuccess
    ? 'bg-emerald-500'
    : isError
    ? 'bg-rose-600'
    : isWarning
    ? 'bg-amber-500'
    : 'bg-gradient-to-r from-[#8648F5] to-[#5424A8]';

  return (
    <div
      role="status"
      onMouseEnter={() => onPauseTimer(item.id)}
      onMouseLeave={() => onResumeTimer(item.id)}
      className="mj-toast-card mj-notif-toast-enter mj-notif-glass-panel pointer-events-auto relative overflow-hidden rounded-[18px] text-[#28203A] dark:text-[#F5EEFF]"
    >
      {/* Left 3D Semantic Accent Bar */}
      <div className={`absolute inset-y-0 left-0 w-1.5 ${accentStripe}`} />

      <div className="flex items-start gap-3 pl-4 pr-3 py-3.5">
        {/* Semantic Icon Container */}
        <div className="shrink-0 mt-0.5">
          {isSuccess && (
            <div className="w-9 h-9 rounded-[12px] bg-emerald-50 dark:bg-emerald-950/75 border border-emerald-200 dark:border-emerald-500/40 flex items-center justify-center">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-300" />
            </div>
          )}
          {isError && (
            <div className="w-9 h-9 rounded-[12px] bg-rose-50 dark:bg-rose-950/75 border border-rose-200 dark:border-rose-500/40 flex items-center justify-center">
              <AlertCircle className="w-4.5 h-4.5 text-rose-600 dark:text-rose-300" />
            </div>
          )}
          {isWarning && (
            <div className="w-9 h-9 rounded-[12px] bg-amber-50 dark:bg-amber-950/75 border border-amber-200 dark:border-amber-500/40 flex items-center justify-center">
              <AlertTriangle className="w-4.5 h-4.5 text-amber-600 dark:text-amber-300" />
            </div>
          )}
          {item.type === 'info' && (
            <div className="w-9 h-9 rounded-[12px] bg-[#EEE5FF] dark:bg-[#341668] border border-[#D8C5FF] dark:border-[#8648F5]/45 flex items-center justify-center">
              <Info className="w-4.5 h-4.5 text-[#5424A8] dark:text-[#D9C7FF]" />
            </div>
          )}
          {isSync && (
            <div className="w-9 h-9 rounded-[12px] bg-[#EEE5FF] dark:bg-[#341668] border border-[#D8C5FF] dark:border-[#8648F5]/55 flex items-center justify-center">
              <RefreshCw
                className="w-4.5 h-4.5 text-[#5424A8] dark:text-[#D9C7FF] animate-spin"
                style={{ animationDuration: '2.4s' }}
              />
            </div>
          )}
          {isLoading && (
            <div className="w-9 h-9 rounded-[12px] bg-[#EEE5FF] dark:bg-[#341668] border border-[#D8C5FF] dark:border-[#8648F5]/55 flex items-center justify-center">
              <Loader2 className="w-4.5 h-4.5 text-[#5424A8] dark:text-[#D9C7FF] animate-spin" />
            </div>
          )}
        </div>

        {/* Content & Optional 3D Action Buttons */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] font-extrabold uppercase tracking-wider ${badgeColor}`}>
              {badgeLabel}
            </span>
            <span className="font-mono text-[10px] text-[#756C86] dark:text-[#BFB2DC] tabular-nums shrink-0">
              {item.timeLabel}
            </span>
          </div>

          {item.title && (
            <div className="font-display text-[13px] font-extrabold text-[#28203A] dark:text-white leading-snug mt-0.5">
              {item.title}
            </div>
          )}

          <div className="text-[12px] text-[#756C86] dark:text-[#DFD5F5] mt-0.5 leading-snug break-words">
            {item.message}
          </div>

          {(item.actionLabel || item.secondaryLabel) && (
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              {item.actionLabel && item.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      item.onAction?.();
                    } finally {
                      onDismiss(item.id);
                    }
                  }}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-[11px] text-[11px] font-bold text-white cursor-pointer transition-all active:translate-y-0.5 ${
                    isError
                      ? 'bg-gradient-to-b from-rose-500 to-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2.5px_0_#7F1D1D]'
                      : isWarning
                      ? 'bg-gradient-to-b from-amber-500 to-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2.5px_0_#92400E]'
                      : isSuccess
                      ? 'bg-gradient-to-b from-emerald-500 to-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2.5px_0_#065F46]'
                      : 'mj-notif-btn-3d'
                  }`}
                >
                  <span>{item.actionLabel}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
              {item.secondaryLabel && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      item.onSecondaryAction?.();
                    } finally {
                      onDismiss(item.id);
                    }
                  }}
                  className="mj-notif-btn-3d-soft px-2.5 py-1 rounded-[11px] text-[11px] font-bold cursor-pointer"
                >
                  {item.secondaryLabel}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 3D Close Button */}
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          className="shrink-0 w-7 h-7 rounded-[10px] bg-[#F7F4FC] dark:bg-white/10 hover:bg-[#EEE5FF] dark:hover:bg-white/20 text-[#756C86] hover:text-[#28203A] dark:text-[#CFC3EC] dark:hover:text-white border border-[#EEE5FF] dark:border-white/15 flex items-center justify-center transition-all cursor-pointer active:translate-y-[1px]"
          aria-label="Tutup notifikasi"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Countdown Progress Bar (pauses on hover) */}
      {item.duration > 0 && (
        <div className="h-[3px] w-full bg-[#EEE5FF] dark:bg-white/10 overflow-hidden">
          <div
            className={`mj-toast-progress-bar h-full ${progressBg}`}
            style={{
              animation: `morajaws-progress-countdown ${item.duration}ms linear forwards`
            }}
          />
        </div>
      )}
    </div>
  );
};
