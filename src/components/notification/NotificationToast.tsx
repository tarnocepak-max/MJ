import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Info,
  Loader2,
  MessageCircle,
  Settings,
  X,
  XCircle
} from 'lucide-react';
import type { ToastItem } from '../../context/ToastContext';

interface NotificationToastProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
  onPauseTimer: (id: string) => void;
  onResumeTimer: (id: string) => void;
}

type VisualCategory =
  | 'success'
  | 'info'
  | 'warning'
  | 'error'
  | 'assignment'
  | 'chat'
  | 'system'
  | 'loading';

function resolveCategory(item: ToastItem): VisualCategory {
  if (item.type === 'error') return 'error';
  if (item.type === 'warning') return 'warning';
  if (item.type === 'loading') return 'loading';

  const haystack = `${item.badge || ''} ${item.title || ''} ${item.message}`.toLowerCase();

  if (/\b(live chat|chat|pesan baru|balasan)\b/.test(haystack)) {
    return 'chat';
  }
  if (/\b(assign|reassign|penugasan|ditugaskan)\b/.test(haystack)) {
    return 'assignment';
  }
  if (item.type === 'sync' || /\b(sistem|system|sinkron|sync)\b/.test(haystack)) {
    return 'system';
  }
  if (item.type === 'success') return 'success';
  return 'info';
}

function getDefaultTitle(category: VisualCategory): string {
  switch (category) {
    case 'assignment':
      return 'WO Assignment';
    case 'chat':
      return 'Live Chat';
    case 'success':
      return 'MoraJaws';
    case 'warning':
      return 'Peringatan';
    case 'error':
      return 'Notifikasi Error';
    case 'system':
      return 'Sistem';
    case 'loading':
      return 'Memproses';
    default:
      return 'MoraJaws';
  }
}

function formatRelativeTime(createdAt: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - createdAt) / 1000));
  if (diffSec < 60) return 'Now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h`;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  item,
  onDismiss,
  onPauseTimer,
  onResumeTimer
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const category = resolveCategory(item);
  const displayTitle = (item.title || '').trim() || getDefaultTitle(category);
  const relativeTime = formatRelativeTime(item.createdAt, nowMs);
  const hasAction = Boolean(item.onAction);

  const iconConfig: Record<
    VisualCategory,
    { boxClass: string; icon: React.ReactNode }
  > = {
    success: {
      boxClass:
        'bg-emerald-500/12 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20',
      icon: <CheckCircle2 className="w-4 h-4" strokeWidth={2.2} />
    },
    info: {
      boxClass:
        'bg-sky-500/12 dark:bg-sky-400/15 text-sky-600 dark:text-sky-300 border border-sky-500/20',
      icon: <Info className="w-4 h-4" strokeWidth={2.2} />
    },
    warning: {
      boxClass:
        'bg-amber-500/14 dark:bg-amber-400/15 text-amber-600 dark:text-amber-300 border border-amber-500/25',
      icon: <AlertTriangle className="w-4 h-4" strokeWidth={2.2} />
    },
    error: {
      boxClass:
        'bg-rose-500/12 dark:bg-rose-400/15 text-rose-600 dark:text-rose-300 border border-rose-500/20',
      icon: <XCircle className="w-4 h-4" strokeWidth={2.2} />
    },
    assignment: {
      boxClass:
        'bg-[#F0EDFF] dark:bg-[#8648F5]/25 text-[#5145A6] dark:text-[#D9C7FF] border border-[#DCE3F2] dark:border-[#8648F5]/25',
      icon: <ClipboardCheck className="w-4 h-4" strokeWidth={2.2} />
    },
    chat: {
      boxClass:
        'bg-[#E7F1FB] dark:bg-blue-400/15 text-[#3E81C6] dark:text-blue-300 border border-[#C6DDF6] dark:border-blue-500/20',
      icon: <MessageCircle className="w-4 h-4" strokeWidth={2.2} />
    },
    system: {
      boxClass:
        'bg-[#DDF4F4] dark:bg-[#8648F5]/25 text-[#2E7D8B] dark:text-[#D9C7FF] border border-[#BDE4E8] dark:border-[#8648F5]/25',
      icon: <Settings className="w-4 h-4" strokeWidth={2.2} />
    },
    loading: {
      boxClass:
        'bg-[#F0EDFF] dark:bg-[#8648F5]/25 text-[#6657C8] dark:text-[#D9C7FF] border border-[#DCE3F2] dark:border-[#8648F5]/25',
      icon: <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.2} />
    }
  };

  const currentIcon = iconConfig[category];

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setIsDragging(true);
    onPauseTimer(item.id);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rawDx = touch.clientX - touchStartRef.current.x;
    const rawDy = touch.clientY - touchStartRef.current.y;

    if (Math.abs(rawDy) >= Math.abs(rawDx)) {
      const clampedY = rawDy < 0 ? rawDy : Math.min(rawDy * 0.2, 8);
      setDragOffset({ x: 0, y: clampedY });
    } else {
      setDragOffset({ x: rawDx, y: 0 });
    }
  };

  const handleTouchEnd = () => {
    if (!touchStartRef.current) return;
    const { x, y } = dragOffset;
    touchStartRef.current = null;
    setIsDragging(false);

    if (y < -28 || Math.abs(x) > 60) {
      onDismiss(item.id);
      return;
    }
    setDragOffset({ x: 0, y: 0 });
    onResumeTimer(item.id);
  };

  const handleToastClick = () => {
    if (!hasAction) return;
    try {
      item.onAction?.();
    } finally {
      onDismiss(item.id);
    }
  };

  const dragDistance = Math.max(Math.abs(dragOffset.x), Math.abs(dragOffset.y));
  const dragOpacity = isDragging ? Math.max(0.35, 1 - dragDistance / 110) : undefined;

  return (
    <div
      role="status"
      onClick={handleToastClick}
      onMouseEnter={() => onPauseTimer(item.id)}
      onMouseLeave={() => onResumeTimer(item.id)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={
        isDragging || dragOffset.x !== 0 || dragOffset.y !== 0
          ? {
              transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
              opacity: dragOpacity,
              transition: isDragging ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out'
            }
          : undefined
      }
      className={`mj-ios-toast ${
        item.exiting ? 'mj-ios-toast-exit' : 'mj-ios-toast-enter'
      } group pointer-events-auto relative rounded-[15px] px-3 py-2.5 text-[#26364A] dark:text-[#F5EEFF] select-none ${
        hasAction ? 'cursor-pointer active:scale-[0.985] transition-transform' : ''
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Compact 32px App / Category Icon */}
        <div
          className={`w-8 h-8 rounded-[10px] shrink-0 flex items-center justify-center mt-0.5 ${currentIcon.boxClass}`}
          aria-hidden="true"
        >
          {currentIcon.icon}
        </div>

        {/* Minimal Horizontal iOS Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-bold leading-tight text-[#26364A] dark:text-white truncate">
              {displayTitle}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10.5px] font-medium text-[#8492A5] dark:text-[#BFB2DC] leading-none tabular-nums">
                {relativeTime}
              </span>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onDismiss(item.id);
                }}
                aria-label="Tutup notifikasi"
                className="w-4 h-4 -mr-0.5 rounded-full flex items-center justify-center text-[#8492A5] hover:text-[#26364A] hover:bg-[#EAE8FF] dark:text-[#BFB2DC]/75 dark:hover:text-white dark:hover:bg-white/15 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" strokeWidth={2.2} />
              </button>
            </div>
          </div>

          <p className="text-[11.5px] leading-[1.35] text-[#52647A] dark:text-[#DDD4F2] line-clamp-2 break-words mt-0.5">
            {item.message}
          </p>

          {item.actionLabel && item.onAction && (
            <div className="mt-0.5 flex items-center gap-3">
              <span className="text-[11px] font-semibold text-[#5145A6] dark:text-[#C9A8FF] hover:underline">
                {item.actionLabel}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
