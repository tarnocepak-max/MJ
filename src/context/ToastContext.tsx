import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  RefreshCw,
  Loader2,
  ArrowRight
} from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'sync';

export interface ToastOptions {
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
  badge?: string;
  withSound?: boolean;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration: number; // in ms, 0 = persistent
  createdAt: number;
  timeLabel: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
  badge?: string;
}

type DurationOrOptions = number | ToastOptions;

interface ToastContextType {
  toasts: ToastItem[];
  showToast: (
    message: string,
    type?: ToastType,
    title?: string,
    durationOrOptions?: DurationOrOptions
  ) => string;
  toast: {
    success: (message: string, title?: string, durationOrOptions?: DurationOrOptions) => string;
    error: (message: string, title?: string, durationOrOptions?: DurationOrOptions) => string;
    warning: (message: string, title?: string, durationOrOptions?: DurationOrOptions) => string;
    info: (message: string, title?: string, durationOrOptions?: DurationOrOptions) => string;
    loading: (message: string, title?: string, durationOrOptions?: DurationOrOptions) => string;
    sync: (message: string, title?: string, durationOrOptions?: DurationOrOptions) => string;
  };
  dismissToast: (id: string) => void;
  clearAllToasts: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3600,
  info: 4200,
  warning: 5200,
  error: 6800,
  sync: 3800,
  loading: 0
};

interface TimerTrack {
  timerId: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
  paused: boolean;
}

function normalizeOptions(durationOrOptions?: DurationOrOptions): ToastOptions {
  if (typeof durationOrOptions === 'number') {
    return { duration: durationOrOptions };
  }
  return durationOrOptions || {};
}

function formatNowTime(): string {
  try {
    return new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return 'LIVE';
  }
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, TimerTrack>>({});
  const lastToastRef = useRef<{ message: string; type: string; timestamp: number } | null>(null);

  const dismissToast = useCallback((id: string) => {
    const track = timersRef.current[id];
    if (track?.timerId) {
      clearTimeout(track.timerId);
    }
    delete timersRef.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    Object.values(timersRef.current).forEach(track => {
      if (track.timerId) clearTimeout(track.timerId);
    });
    timersRef.current = {};
    setToasts([]);
  }, []);

  const pauseToastTimer = useCallback((id: string) => {
    const track = timersRef.current[id];
    if (!track || track.paused || track.remaining <= 0) return;
    if (track.timerId) {
      clearTimeout(track.timerId);
      track.timerId = null;
    }
    const elapsed = Date.now() - track.startedAt;
    track.remaining = Math.max(250, track.remaining - elapsed);
    track.paused = true;
  }, []);

  const resumeToastTimer = useCallback(
    (id: string) => {
      const track = timersRef.current[id];
      if (!track || !track.paused || track.remaining <= 0) return;
      track.paused = false;
      track.startedAt = Date.now();
      track.timerId = setTimeout(() => {
        dismissToast(id);
      }, track.remaining);
    },
    [dismissToast]
  );

  const showToast = useCallback(
    (
      message: string,
      type: ToastType = 'info',
      title?: string,
      durationOrOptions?: DurationOrOptions
    ): string => {
      const now = Date.now();
      if (
        lastToastRef.current &&
        lastToastRef.current.message === message &&
        lastToastRef.current.type === type &&
        now - lastToastRef.current.timestamp < 1100
      ) {
        return '';
      }
      lastToastRef.current = { message, type, timestamp: now };

      const opts = normalizeOptions(durationOrOptions);
      const duration = opts.duration !== undefined ? opts.duration : DEFAULT_DURATIONS[type];
      const id = `toast-${now}-${Math.random().toString(36).substring(2, 7)}`;

      const newToast: ToastItem = {
        id,
        type,
        title,
        message,
        duration,
        createdAt: now,
        timeLabel: formatNowTime(),
        actionLabel: opts.actionLabel,
        onAction: opts.onAction,
        secondaryLabel: opts.secondaryLabel,
        onSecondaryAction: opts.onSecondaryAction,
        badge: opts.badge
      };

      // Maximum 3 active toasts stacked cleanly
      setToasts(prev => [newToast, ...prev].slice(0, 3));

      if (duration > 0) {
        const timerId = setTimeout(() => {
          dismissToast(id);
        }, duration);
        timersRef.current[id] = {
          timerId,
          remaining: duration,
          startedAt: now,
          paused: false
        };
      }

      if (opts.withSound) {
        try {
          window.dispatchEvent(
            new CustomEvent('morajaws:toast-sound', {
              detail: { type }
            })
          );
        } catch {}
      }

      return id;
    },
    [dismissToast]
  );

  const toast = {
    success: useCallback(
      (msg: string, title?: string, durationOrOptions?: DurationOrOptions) =>
        showToast(msg, 'success', title, durationOrOptions),
      [showToast]
    ),
    error: useCallback(
      (msg: string, title?: string, durationOrOptions?: DurationOrOptions) =>
        showToast(msg, 'error', title, durationOrOptions),
      [showToast]
    ),
    warning: useCallback(
      (msg: string, title?: string, durationOrOptions?: DurationOrOptions) =>
        showToast(msg, 'warning', title, durationOrOptions),
      [showToast]
    ),
    info: useCallback(
      (msg: string, title?: string, durationOrOptions?: DurationOrOptions) =>
        showToast(msg, 'info', title, durationOrOptions),
      [showToast]
    ),
    loading: useCallback(
      (msg: string, title?: string, durationOrOptions?: DurationOrOptions) =>
        showToast(msg, 'loading', title, durationOrOptions),
      [showToast]
    ),
    sync: useCallback(
      (msg: string, title?: string, durationOrOptions?: DurationOrOptions) =>
        showToast(msg, 'sync', title, durationOrOptions),
      [showToast]
    )
  };

  return (
    <ToastContext.Provider value={{ toasts, showToast, toast, dismissToast, clearAllToasts }}>
      {children}

      {/* Stitch AI Floating Tactile Toast Stack */}
      <div
        aria-live="polite"
        className="fixed top-3 left-3 right-3 sm:left-auto sm:right-5 sm:top-5 z-[99999] flex flex-col gap-2.5 sm:w-[400px] max-w-full pointer-events-none"
      >
        {toasts.map(item => {
          const isSuccess = item.type === 'success';
          const isError = item.type === 'error';
          const isWarning = item.type === 'warning';
          const isSync = item.type === 'sync';
          const isLoading = item.type === 'loading';

          const accentStripe = isSuccess
            ? 'bg-emerald-500'
            : isError
            ? 'bg-[#BA1A1A]'
            : isWarning
            ? 'bg-amber-500'
            : isSync
            ? 'bg-[#7135B5]'
            : 'bg-[#58149C]';

          const cardBevel = isError
            ? 'border-rose-200 dark:border-rose-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_0_rgba(186,26,26,0.22),0_14px_28px_rgba(31,22,56,0.14)] dark:shadow-[0_10px_28px_rgba(186,26,26,0.28)]'
            : isWarning
            ? 'border-amber-200 dark:border-amber-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_0_rgba(217,119,6,0.2),0_14px_28px_rgba(31,22,56,0.12)] dark:shadow-[0_10px_28px_rgba(217,119,6,0.22)]'
            : isSuccess
            ? 'border-emerald-200 dark:border-emerald-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_0_rgba(16,185,129,0.22),0_14px_28px_rgba(31,22,56,0.12)] dark:shadow-[0_10px_28px_rgba(16,185,129,0.22)]'
            : 'border-[#E8DDFF] dark:border-[#7135B5]/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_4px_0_#CEC3D4,0_14px_28px_rgba(88,20,156,0.14)] dark:shadow-[0_10px_28px_rgba(22,13,41,0.75)]';

          const progressBg = isSuccess
            ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
            : isError
            ? 'bg-gradient-to-r from-[#BA1A1A] to-rose-400'
            : isWarning
            ? 'bg-gradient-to-r from-amber-500 to-amber-400'
            : 'bg-gradient-to-r from-[#58149C] via-[#7135B5] to-[#A380FE]';

          const badgeLabel =
            item.badge ||
            (isSync
              ? 'TELEMETRY SYNC'
              : isLoading
              ? 'MEMPROSES'
              : isError
              ? 'PERINGATAN KRITIS'
              : isWarning
              ? 'PERHATIAN'
              : isSuccess
              ? 'TERKONFIRMASI'
              : 'INFO SISTEM');

          const badgeColor = isError
            ? 'text-[#BA1A1A] dark:text-rose-300'
            : isWarning
            ? 'text-amber-700 dark:text-amber-300'
            : isSuccess
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-[#58149C] dark:text-[#DAB9FF]';

          return (
            <div
              key={item.id}
              role="status"
              onMouseEnter={() => pauseToastTimer(item.id)}
              onMouseLeave={() => resumeToastTimer(item.id)}
              className={`mj-toast-card mj-toast-enter pointer-events-auto relative overflow-hidden rounded-2xl border bg-white dark:bg-[#1E1238] text-[#1F1638] dark:text-[#F5EEFF] ${cardBevel}`}
            >
              {/* Left 3D Tactile Semantic Rail */}
              <div className={`absolute inset-y-0 left-0 w-1.5 ${accentStripe}`} />

              <div className="flex items-start gap-3 pl-4 pr-3 py-3">
                {/* 3D Tactile Icon Container */}
                <div className="shrink-0 mt-0.5">
                  {isSuccess && (
                    <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-500/40 flex items-center justify-center shadow-[0_2px_0_rgba(16,185,129,0.2)]">
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-300" />
                    </div>
                  )}
                  {isError && (
                    <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-500/40 flex items-center justify-center shadow-[0_2px_0_rgba(186,26,26,0.2)]">
                      <AlertCircle className="w-4.5 h-4.5 text-[#BA1A1A] dark:text-rose-300" />
                    </div>
                  )}
                  {isWarning && (
                    <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-500/40 flex items-center justify-center shadow-[0_2px_0_rgba(217,119,6,0.2)]">
                      <AlertTriangle className="w-4.5 h-4.5 text-amber-600 dark:text-amber-300" />
                    </div>
                  )}
                  {item.type === 'info' && (
                    <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#35105E] border border-[#E8DDFF] dark:border-[#7135B5]/50 flex items-center justify-center shadow-[0_2px_0_#CEC3D4] dark:shadow-none">
                      <Info className="w-4.5 h-4.5 text-[#58149C] dark:text-[#DAB9FF]" />
                    </div>
                  )}
                  {isSync && (
                    <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#35105E] border border-[#DAB9FF] dark:border-[#7135B5]/60 flex items-center justify-center shadow-[0_2px_0_#CEC3D4] dark:shadow-none">
                      <RefreshCw
                        className="w-4.5 h-4.5 text-[#58149C] dark:text-[#DAB9FF] animate-spin"
                        style={{ animationDuration: '2.4s' }}
                      />
                    </div>
                  )}
                  {isLoading && (
                    <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#35105E] border border-[#DAB9FF] dark:border-[#7135B5]/60 flex items-center justify-center">
                      <Loader2 className="w-4.5 h-4.5 text-[#58149C] dark:text-[#DAB9FF] animate-spin" />
                    </div>
                  )}
                </div>

                {/* Toast Text & Optional Actions */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-extrabold uppercase tracking-wider ${badgeColor}`}>
                      {badgeLabel}
                    </span>
                    <span className="font-mono text-[10px] text-[#7D7484] dark:text-[#CEC0E8]/70 tabular-nums shrink-0">
                      {item.timeLabel}
                    </span>
                  </div>

                  {item.title && (
                    <div className="font-display text-[13px] font-bold text-[#1F1638] dark:text-white leading-snug mt-0.5">
                      {item.title}
                    </div>
                  )}

                  <div className="text-[12px] text-[#4B4452] dark:text-[#E9D5FF]/90 mt-0.5 leading-snug break-words">
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
                              dismissToast(item.id);
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-white cursor-pointer transition-all active:translate-y-0.5 ${
                            isError
                              ? 'bg-[#BA1A1A] hover:bg-[#93000A] shadow-[0_2px_0_#7F1D1D]'
                              : isWarning
                              ? 'bg-amber-600 hover:bg-amber-700 shadow-[0_2px_0_#92400E]'
                              : isSuccess
                              ? 'bg-emerald-600 hover:bg-emerald-700 shadow-[0_2px_0_#065F46]'
                              : 'bg-[#58149C] hover:bg-[#7135B5] shadow-[0_2px_0_#2A0053]'
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
                              dismissToast(item.id);
                            }
                          }}
                          className="tactile-btn-secondary px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F8F1FF] dark:bg-[#261942] text-[#4B4452] dark:text-[#E9D5FF] border border-[#E8DDFF] dark:border-[#4B386B] cursor-pointer"
                        >
                          {item.secondaryLabel}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => dismissToast(item.id)}
                  className="shrink-0 p-1 rounded-lg text-[#7D7484] hover:text-[#1F1638] dark:text-[#CEC0E8]/70 dark:hover:text-white hover:bg-[#F3EAFF] dark:hover:bg-white/10 transition-colors cursor-pointer"
                  aria-label="Tutup notifikasi"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Countdown Progress Bar (pauses on hover via CSS + JS timer) */}
              {item.duration > 0 && (
                <div className="h-[3px] w-full bg-[#F3EAFF] dark:bg-white/10 overflow-hidden">
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
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
