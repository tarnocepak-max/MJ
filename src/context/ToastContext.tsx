import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { NotificationToast } from '../components/notification/NotificationToast';
import type { NotificationSoundCategory } from '../types';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'sync';

export interface ToastOptions {
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
  badge?: string;
  withSound?: boolean;
  soundCategory?: NotificationSoundCategory;
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
  exiting?: boolean;
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

const MAX_VISIBLE_TOASTS = 2;
const EXIT_ANIMATION_MS = 180;

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
      minute: '2-digit'
    });
  } catch {
    return 'Now';
  }
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, TimerTrack>>({});
  const exitTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queueRef = useRef<ToastItem[]>([]);
  const activeToastsRef = useRef<ToastItem[]>([]);
  const lastToastRef = useRef<{ message: string; type: string; timestamp: number } | null>(null);

  activeToastsRef.current = toasts;

  const scheduleAutoDismiss = useCallback(
    (id: string, duration: number, onExpire: (toastId: string) => void) => {
      if (duration <= 0) return;
      if (timersRef.current[id]?.timerId) {
        clearTimeout(timersRef.current[id].timerId!);
      }
      const timerId = setTimeout(() => {
        onExpire(id);
      }, duration);
      timersRef.current[id] = {
        timerId,
        remaining: duration,
        startedAt: Date.now(),
        paused: false
      };
    },
    []
  );

  const dismissToast = useCallback(
    (id: string) => {
      const track = timersRef.current[id];
      if (track?.timerId) {
        clearTimeout(track.timerId);
      }
      delete timersRef.current[id];

      if (exitTimersRef.current[id]) {
        return;
      }

      setToasts(prev => prev.map(t => (t.id === id ? { ...t, exiting: true } : t)));

      exitTimersRef.current[id] = setTimeout(() => {
        delete exitTimersRef.current[id];

        const nextRemainingCount = activeToastsRef.current.filter(t => t.id !== id).length;
        const nextQueued =
          nextRemainingCount < MAX_VISIBLE_TOASTS && queueRef.current.length > 0
            ? queueRef.current.shift()!
            : null;

        if (nextQueued && nextQueued.duration > 0) {
          scheduleAutoDismiss(nextQueued.id, nextQueued.duration, dismissToast);
        }

        setToasts(prev => {
          const remaining = prev.filter(t => t.id !== id);
          if (nextQueued && remaining.length < MAX_VISIBLE_TOASTS) {
            return [nextQueued, ...remaining].slice(0, MAX_VISIBLE_TOASTS);
          }
          return remaining;
        });
      }, EXIT_ANIMATION_MS);
    },
    [scheduleAutoDismiss]
  );

  const clearAllToasts = useCallback(() => {
    Object.values(timersRef.current).forEach(track => {
      if (track.timerId) clearTimeout(track.timerId);
    });
    Object.values(exitTimersRef.current).forEach(t => clearTimeout(t));
    timersRef.current = {};
    exitTimersRef.current = {};
    queueRef.current = [];
    setToasts([]);
  }, []);

  React.useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(track => {
        if (track.timerId) clearTimeout(track.timerId);
      });
      Object.values(exitTimersRef.current).forEach(t => clearTimeout(t));
    };
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
      const normalizedMsg = message.trim();
      const now = Date.now();

      if (
        lastToastRef.current &&
        lastToastRef.current.message === normalizedMsg &&
        lastToastRef.current.type === type &&
        now - lastToastRef.current.timestamp < 1500
      ) {
        return '';
      }

      const alreadyVisibleOrQueued =
        activeToastsRef.current.some(
          t => !t.exiting && t.message === normalizedMsg && t.type === type
        ) || queueRef.current.some(t => t.message === normalizedMsg && t.type === type);

      if (alreadyVisibleOrQueued) {
        return '';
      }

      lastToastRef.current = { message: normalizedMsg, type, timestamp: now };

      const opts = normalizeOptions(durationOrOptions);
      const duration = opts.duration !== undefined ? opts.duration : DEFAULT_DURATIONS[type];
      const id = `toast-${now}-${Math.random().toString(36).substring(2, 7)}`;

      const newToast: ToastItem = {
        id,
        type,
        title,
        message: normalizedMsg,
        duration,
        createdAt: now,
        timeLabel: formatNowTime(),
        actionLabel: opts.actionLabel,
        onAction: opts.onAction,
        secondaryLabel: opts.secondaryLabel,
        onSecondaryAction: opts.onSecondaryAction,
        badge: opts.badge,
        exiting: false
      };

      const activeCount = activeToastsRef.current.filter(t => !t.exiting).length;
      if (activeCount >= MAX_VISIBLE_TOASTS) {
        queueRef.current.push(newToast);
      } else {
        if (duration > 0) {
          scheduleAutoDismiss(id, duration, dismissToast);
        }
        setToasts(prev => [newToast, ...prev].slice(0, MAX_VISIBLE_TOASTS));
      }

      const shouldPlaySound =
        opts.withSound === true ||
        (opts.withSound !== false &&
          (type === 'success' ||
            type === 'warning' ||
            type === 'error' ||
            type === 'sync' ||
            (opts.soundCategory !== undefined && opts.soundCategory !== 'normal')));

      if (shouldPlaySound) {
        try {
          window.dispatchEvent(
            new CustomEvent('morajaws:toast-sound', {
              detail: {
                type,
                title: title || '',
                message: normalizedMsg,
                badge: opts.badge || '',
                soundCategory: opts.soundCategory
              }
            })
          );
        } catch {}
      }

      return id;
    },
    [dismissToast, scheduleAutoDismiss]
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

      {/* MoraJaws Mini iOS Style Floating Toast Stack */}
      <div
        aria-live="polite"
        className="fixed top-[calc(env(safe-area-inset-top,0px)+74px)] left-3 right-3 mx-auto w-[calc(100%-24px)] max-w-[360px] sm:left-auto sm:right-4 sm:mx-0 sm:top-[82px] sm:w-[324px] sm:max-w-[340px] z-[99999] flex flex-col gap-2 pointer-events-none"
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
