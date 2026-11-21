import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { NotificationToast } from '../components/notification/NotificationToast';

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

      {/* MoraJaws Floating Glassmorphism Toast Stack */}
      <div
        aria-live="polite"
        className="fixed top-3 left-3 right-3 sm:left-auto sm:right-5 sm:top-5 z-[99999] flex flex-col gap-2.5 sm:w-[400px] max-w-full pointer-events-none"
      >
        {toasts.map(item => (
          <NotificationToast
            key={item.id}
            item={item}
            onDismiss={dismissToast}
            onPauseTimer={pauseToastTimer}
            onResumeTimer={resumeToastTimer}
          />
        ))}
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
