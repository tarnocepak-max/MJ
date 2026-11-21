import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type InlineNotificationVariant = 'info' | 'warning' | 'error' | 'success';

interface NotificationInlineProps {
  variant?: InlineNotificationVariant;
  message: string;
  detail?: string;
  onDismiss?: () => void;
  className?: string;
}

const INLINE_STYLES: Record<
  InlineNotificationVariant,
  { wrap: string; iconColor: string; text: string }
> = {
  info: {
    wrap: 'bg-[#EEE5FF]/70 dark:bg-[#2A1352]/80 border-[#D8C5FF] dark:border-[#8648F5]/45',
    iconColor: 'text-[#5424A8] dark:text-[#C9A8FF]',
    text: 'text-[#28203A] dark:text-[#EEE5FF]'
  },
  warning: {
    wrap: 'bg-amber-50/90 dark:bg-amber-950/45 border-amber-200 dark:border-amber-700/60',
    iconColor: 'text-amber-600 dark:text-amber-300',
    text: 'text-amber-950 dark:text-amber-100'
  },
  error: {
    wrap: 'bg-rose-50/90 dark:bg-rose-950/45 border-rose-200 dark:border-rose-700/60',
    iconColor: 'text-rose-600 dark:text-rose-300',
    text: 'text-rose-950 dark:text-rose-100'
  },
  success: {
    wrap: 'bg-emerald-50/90 dark:bg-emerald-950/45 border-emerald-200 dark:border-emerald-700/60',
    iconColor: 'text-emerald-600 dark:text-emerald-300',
    text: 'text-emerald-950 dark:text-emerald-100'
  }
};

export const NotificationInline: React.FC<NotificationInlineProps> = ({
  variant = 'info',
  message,
  detail,
  onDismiss,
  className = ''
}) => {
  const s = INLINE_STYLES[variant];
  const Icon =
    variant === 'error'
      ? AlertCircle
      : variant === 'warning'
      ? AlertTriangle
      : variant === 'success'
      ? CheckCircle2
      : Info;

  return (
    <div
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={`rounded-[16px] border px-3 py-2.5 flex items-start justify-between gap-2.5 text-xs ${s.wrap} ${className}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${s.iconColor}`} />
        <div className="min-w-0">
          <div className={`font-bold leading-snug ${s.text}`}>{message}</div>
          {detail && (
            <div className="text-[11px] text-[#756C86] dark:text-[#BFB2DC] mt-0.5 leading-snug">
              {detail}
            </div>
          )}
        </div>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Tutup pesan"
          className="p-0.5 rounded-lg text-[#756C86] hover:text-[#28203A] dark:text-[#BFB2DC] dark:hover:text-white cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
