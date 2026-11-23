import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X
} from 'lucide-react';

export type NotificationBannerVariant = 'critical' | 'warning' | 'success' | 'info';

export interface NotificationBannerProps {
  variant?: NotificationBannerVariant;
  badge?: string;
  title: string;
  description?: string;
  metricBadge?: string;
  progressPercent?: number;
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  className?: string;
}

const BANNER_STYLES: Record<
  NotificationBannerVariant,
  {
    shell: string;
    rail: string;
    iconBox: string;
    badgeCls: string;
    titleCls: string;
    descCls: string;
    primaryBtn: string;
    barBg: string;
    barFill: string;
  }
> = {
  critical: {
    shell:
      'bg-gradient-to-br from-[#FFF6F7] to-[#FCE9EB]/70 dark:from-[#2C0E19] dark:to-[#1F0A12] border-[#F3C5CA] dark:border-rose-500/40 shadow-[0_14px_30px_-12px_rgba(212,91,102,0.18),inset_0_1px_0_rgba(255,255,255,0.88)] dark:shadow-[0_12px_28px_rgba(186,26,26,0.28)]',
    rail: 'bg-gradient-to-b from-[#E06D77] to-[#D45B66] dark:from-rose-500 dark:to-rose-700',
    iconBox:
      'bg-white dark:bg-rose-950/90 text-[#D45B66] dark:text-rose-300 border-[#F3C5CA] dark:border-rose-500/40',
    badgeCls: 'text-[#D45B66] dark:text-rose-300',
    titleCls: 'text-[#26364A] dark:text-rose-50',
    descCls: 'text-[#52647A] dark:text-rose-200/90',
    primaryBtn: 'btn-3d-danger',
    barBg: 'bg-[#F9D9DD] dark:bg-rose-950',
    barFill: 'bg-[#D45B66] dark:bg-rose-600'
  },
  warning: {
    shell:
      'bg-gradient-to-br from-[#FFFBF2] to-[#FFF2D9]/65 dark:from-[#2B1D0B] dark:to-[#1E1307] border-[#F2CF95] dark:border-amber-500/40 shadow-[0_14px_30px_-12px_rgba(200,135,53,0.16),inset_0_1px_0_rgba(255,255,255,0.88)] dark:shadow-[0_12px_28px_rgba(217,119,6,0.22)]',
    rail: 'bg-gradient-to-b from-[#DA9A46] to-[#C88735] dark:from-amber-400 dark:to-amber-600',
    iconBox:
      'bg-white dark:bg-amber-950/90 text-[#C88735] dark:text-amber-300 border-[#F2CF95] dark:border-amber-500/40',
    badgeCls: 'text-[#C88735] dark:text-amber-300',
    titleCls: 'text-[#26364A] dark:text-amber-50',
    descCls: 'text-[#52647A] dark:text-amber-200/90',
    primaryBtn: 'btn-3d-warning',
    barBg: 'bg-[#F7E0B5] dark:bg-amber-950',
    barFill: 'bg-[#C88735] dark:bg-amber-500'
  },
  success: {
    shell:
      'bg-gradient-to-br from-[#F4FCF8] to-[#E4F5EC]/70 dark:from-[#0E281E] dark:to-[#091D16] border-[#B7E4CC] dark:border-emerald-500/40 shadow-[0_14px_30px_-12px_rgba(33,138,99,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_12px_28px_rgba(16,185,129,0.22)]',
    rail: 'bg-gradient-to-b from-[#27A074] to-[#218A63] dark:from-emerald-400 dark:to-emerald-600',
    iconBox:
      'bg-white dark:bg-emerald-950/90 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-500/40',
    badgeCls: 'text-[#218A63] dark:text-emerald-300',
    titleCls: 'text-[#26364A] dark:text-emerald-50',
    descCls: 'text-[#52647A] dark:text-emerald-200/90',
    primaryBtn: 'btn-3d-success',
    barBg: 'bg-[#CBEBD9] dark:bg-emerald-950',
    barFill: 'bg-[#218A63] dark:bg-emerald-500'
  },
  info: {
    shell:
      'bg-gradient-to-br from-white/95 to-[#F4F7FB]/90 dark:from-[#231245] dark:to-[#180B32] border-[#DDE6F0] dark:border-[#8648F5]/45 shadow-[0_16px_34px_-12px_rgba(81,69,166,0.16),inset_0_1px_0_rgba(255,255,255,0.95)] dark:shadow-[0_14px_30px_rgba(10,4,24,0.65)]',
    rail: 'bg-gradient-to-b from-[#65B8C4] via-[#6657C8] to-[#5145A6] dark:from-[#8648F5] dark:to-[#5424A8]',
    iconBox:
      'bg-[#EAE8FF] dark:bg-[#341668] text-[#5145A6] dark:text-[#DEC8FF] border-[#DCE3F2] dark:border-[#8648F5]/50',
    badgeCls: 'text-[#5145A6] dark:text-[#C9A8FF]',
    titleCls: 'text-[#26364A] dark:text-white',
    descCls: 'text-[#52647A] dark:text-[#DFD5F5]',
    primaryBtn: 'mj-notif-btn-3d',
    barBg: 'bg-[#EAE8FF] dark:bg-[#30104B]',
    barFill: 'bg-gradient-to-r from-[#65B8C4] to-[#6657C8] dark:from-[#8648F5] dark:to-[#5424A8]'
  }
};

export const NotificationBanner: React.FC<NotificationBannerProps> = ({
  variant = 'info',
  badge,
  title,
  description,
  metricBadge,
  progressPercent,
  primaryAction,
  secondaryAction,
  onDismiss,
  className = ''
}) => {
  const styles = BANNER_STYLES[variant];

  const IconComp =
    variant === 'critical'
      ? AlertTriangle
      : variant === 'warning'
      ? AlertCircle
      : variant === 'success'
      ? CheckCircle2
      : Info;

  return (
    <div
      role={variant === 'critical' || variant === 'warning' ? 'alert' : 'status'}
      className={`relative overflow-hidden rounded-[18px] border backdrop-blur-md p-3.5 sm:p-4 transition-all ${styles.shell} ${className}`}
    >
      {/* Left Accent Rail */}
      <div className={`absolute inset-y-0 left-0 w-1.5 ${styles.rail}`} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pl-2.5">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={`w-9 h-9 rounded-[12px] border flex items-center justify-center shrink-0 ${styles.iconBox}`}
          >
            <IconComp className="w-4.5 h-4.5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {badge && (
                <span className={`text-[10px] font-extrabold uppercase tracking-wider ${styles.badgeCls}`}>
                  {badge}
                </span>
              )}
              {metricBadge && (
                <span className="font-mono text-[10px] font-bold text-[#8492A5] dark:text-[#BFB2DC] tabular-nums">
                  · {metricBadge}
                </span>
              )}
            </div>

            <div className={`font-display text-xs sm:text-[13px] font-extrabold leading-snug mt-0.5 ${styles.titleCls}`}>
              {title}
            </div>

            {description && (
              <p className={`text-[11.5px] leading-relaxed mt-0.5 ${styles.descCls}`}>
                {description}
              </p>
            )}

            {typeof progressPercent === 'number' && (
              <div className="mt-2.5 flex items-center gap-2.5 max-w-sm">
                <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${styles.barBg}`}>
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${styles.barFill}`}
                    style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
                  />
                </div>
                <span className={`font-mono text-[10.5px] font-bold tabular-nums ${styles.badgeCls}`}>
                  {Math.round(progressPercent)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {(primaryAction || secondaryAction || onDismiss) && (
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            {secondaryAction && (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="mj-notif-btn-3d-soft px-3 py-1.5 rounded-[12px] text-[11px] font-bold cursor-pointer"
              >
                {secondaryAction.label}
              </button>
            )}

            {primaryAction && (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[12px] text-[11px] font-extrabold cursor-pointer transition-all active:translate-y-0.5 ${styles.primaryBtn}`}
              >
                {primaryAction.icon}
                <span>{primaryAction.label}</span>
              </button>
            )}

            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="w-7 h-7 rounded-[10px] bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 text-[#8492A5] hover:text-[#26364A] dark:text-[#BFB2DC] dark:hover:text-white border border-[#DDE6F0] dark:border-white/15 flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Tutup pemberitahuan"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
