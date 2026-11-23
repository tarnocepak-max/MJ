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
    wrap: 'bg-[#EAE8FF]/75 dark:bg-[#2A1352]/80 border-[#DCE3F2] dark:border-[#8648F5]/45',
    iconColor: 'text-[#5145A6] dark:text-[#C9A8FF]',
    text: 'text-[#26364A] dark:text-[#EEE5FF]'
  },
  warning: {
    wrap: 'bg-[#FFF2D9]/85 dark:bg-amber-950/45 border-[#F2CF95] dark:border-amber-700/60',
    iconColor: 'text-[#C88735] dark:text-amber-300',
    text: 'text-[#26364A] dark:text-amber-100'
  },
  error: {
    wrap: 'bg-[#FCE9EB]/85 dark:bg-rose-950/45 border-[#F3C5CA] dark:border-rose-700/60',
    iconColor: 'text-[#D45B66] dark:text-rose-300',
    text: 'text-[#26364A] dark:text-rose-100'
  },
  success: {
    wrap: 'bg-[#E4F5EC]/85 dark:bg-emerald-950/45 border-[#B7E4CC] dark:border-emerald-700/60',
    iconColor: 'text-[#218A63] dark:text-emerald-300',
    text: 'text-[#26364A] dark:text-emerald-100'
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
            <div className="text-[11px] text-[#52647A] dark:text-[#BFB2DC] mt-0.5 leading-snug">
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
          className="p-0.5 rounded-lg text-[#8492A5] hover:text-[#26364A] dark:text-[#BFB2DC] dark:hover:text-white cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
