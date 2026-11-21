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
      'bg-gradient-to-br from-[#FFF5F6] to-[#FEF2F2] dark:from-[#2C0E19] dark:to-[#1F0A12] border-rose-200 dark:border-rose-500/40 shadow-[0_14px_30px_-12px_rgba(186,26,26,0.18),inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-[0_12px_28px_rgba(186,26,26,0.28)]',
    rail: 'bg-gradient-to-b from-rose-500 to-rose-700',
    iconBox:
      'bg-white dark:bg-rose-950/90 text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-500/40',
    badgeCls: 'text-rose-700 dark:text-rose-300',
    titleCls: 'text-[#28203A] dark:text-rose-50',
    descCls: 'text-[#756C86] dark:text-rose-200/90',
    primaryBtn:
      'bg-gradient-to-b from-rose-500 to-rose-700 hover:brightness-105 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_3px_0_#7F1D1D]',
    barBg: 'bg-rose-200/80 dark:bg-rose-950',
    barFill: 'bg-rose-600'
  },
  warning: {
    shell:
      'bg-gradient-to-br from-[#FFFDF5] to-[#FFFBEB] dark:from-[#2B1D0B] dark:to-[#1E1307] border-amber-200 dark:border-amber-500/40 shadow-[0_14px_30px_-12px_rgba(217,119,6,0.16),inset_0_1px_0_rgba(255,255,255,0.88)] dark:shadow-[0_12px_28px_rgba(217,119,6,0.22)]',
    rail: 'bg-gradient-to-b from-amber-400 to-amber-600',
    iconBox:
      'bg-white dark:bg-amber-950/90 text-amber-600 dark:text-amber-300 border-amber-200 dark:border-amber-500/40',
    badgeCls: 'text-amber-700 dark:text-amber-300',
    titleCls: 'text-[#28203A] dark:text-amber-50',
    descCls: 'text-[#756C86] dark:text-amber-200/90',
    primaryBtn:
      'bg-gradient-to-b from-amber-500 to-amber-700 hover:brightness-105 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_3px_0_#92400E]',
    barBg: 'bg-amber-200/80 dark:bg-amber-950',
    barFill: 'bg-amber-500'
  },
  success: {
    shell:
      'bg-gradient-to-br from-[#F4FDF8] to-[#ECFDF5] dark:from-[#0E281E] dark:to-[#091D16] border-emerald-200 dark:border-emerald-500/40 shadow-[0_14px_30px_-12px_rgba(16,185,129,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_12px_28px_rgba(16,185,129,0.22)]',
    rail: 'bg-gradient-to-b from-emerald-400 to-emerald-600',
    iconBox:
      'bg-white dark:bg-emerald-950/90 text-emerald-600 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/40',
    badgeCls: 'text-emerald-700 dark:text-emerald-300',
    titleCls: 'text-[#28203A] dark:text-emerald-50',
    descCls: 'text-[#756C86] dark:text-emerald-200/90',
    primaryBtn:
      'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:brightness-105 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_3px_0_#065F46]',
    barBg: 'bg-emerald-200/80 dark:bg-emerald-950',
    barFill: 'bg-emerald-500'
  },
  info: {
    shell:
      'bg-gradient-to-br from-[#FFFFFF] to-[#F7F4FC] dark:from-[#231245] dark:to-[#180B32] border-[#DFD0FA] dark:border-[#8648F5]/45 shadow-[0_16px_34px_-12px_rgba(84,36,168,0.2),inset_0_1px_0_rgba(255,255,255,0.95)] dark:shadow-[0_14px_30px_rgba(10,4,24,0.65)]',
    rail: 'bg-gradient-to-b from-[#8648F5] to-[#5424A8]',
    iconBox:
      'bg-[#EEE5FF] dark:bg-[#341668] text-[#5424A8] dark:text-[#DEC8FF] border-[#D8C5FF] dark:border-[#8648F5]/50',
    badgeCls: 'text-[#5424A8] dark:text-[#C9A8FF]',
    titleCls: 'text-[#28203A] dark:text-white',
    descCls: 'text-[#756C86] dark:text-[#DFD5F5]',
    primaryBtn: 'mj-notif-btn-3d',
    barBg: 'bg-[#EEE5FF] dark:bg-[#30104B]',
    barFill: 'bg-gradient-to-r from-[#8648F5] to-[#5424A8]'
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
                <span className="font-mono text-[10px] font-bold text-[#756C86] dark:text-[#BFB2DC] tabular-nums">
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
                className="w-7 h-7 rounded-[10px] bg-white/75 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 text-[#756C86] hover:text-[#28203A] dark:text-[#BFB2DC] dark:hover:text-white border border-black/5 dark:border-white/15 flex items-center justify-center transition-colors cursor-pointer"
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
