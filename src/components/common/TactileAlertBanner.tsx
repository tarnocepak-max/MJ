import React from 'react';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  X
} from 'lucide-react';

export type TactileAlertVariant = 'critical' | 'warning' | 'success' | 'info';

interface TactileAlertBannerProps {
  variant?: TactileAlertVariant;
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

const VARIANT_STYLES: Record<
  TactileAlertVariant,
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
      'bg-[#FEF2F2] dark:bg-[#2A0E17] border-[#FCA5A5] dark:border-rose-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_3.5px_0_rgba(186,26,26,0.22),0_10px_22px_rgba(186,26,26,0.1)] dark:shadow-[0_6px_20px_rgba(186,26,26,0.25)]',
    rail: 'bg-[#BA1A1A]',
    iconBox:
      'bg-white dark:bg-rose-950/90 text-[#BA1A1A] dark:text-rose-300 border-rose-200 dark:border-rose-500/40 shadow-[0_2px_0_rgba(186,26,26,0.2)]',
    badgeCls: 'text-[#BA1A1A] dark:text-rose-300',
    titleCls: 'text-[#7F1D1D] dark:text-rose-100',
    descCls: 'text-[#991B1B] dark:text-rose-200/90',
    primaryBtn:
      'bg-[#BA1A1A] hover:bg-[#93000A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2.5px_0_#7F1D1D]',
    barBg: 'bg-rose-200/80 dark:bg-rose-950',
    barFill: 'bg-[#BA1A1A]'
  },
  warning: {
    shell:
      'bg-[#FFFBEB] dark:bg-[#291C0B] border-amber-300 dark:border-amber-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_3.5px_0_rgba(217,119,6,0.2),0_10px_22px_rgba(217,119,6,0.08)] dark:shadow-[0_6px_20px_rgba(217,119,6,0.2)]',
    rail: 'bg-amber-500',
    iconBox:
      'bg-white dark:bg-amber-950/90 text-amber-600 dark:text-amber-300 border-amber-200 dark:border-amber-500/40 shadow-[0_2px_0_rgba(217,119,6,0.2)]',
    badgeCls: 'text-amber-700 dark:text-amber-300',
    titleCls: 'text-amber-950 dark:text-amber-100',
    descCls: 'text-amber-900/90 dark:text-amber-200/90',
    primaryBtn:
      'bg-amber-600 hover:bg-amber-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2.5px_0_#92400E]',
    barBg: 'bg-amber-200/80 dark:bg-amber-950',
    barFill: 'bg-amber-500'
  },
  success: {
    shell:
      'bg-emerald-50 dark:bg-[#0D261D] border-emerald-200 dark:border-emerald-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_3.5px_0_rgba(16,185,129,0.2),0_10px_22px_rgba(16,185,129,0.08)] dark:shadow-[0_6px_20px_rgba(16,185,129,0.2)]',
    rail: 'bg-emerald-500',
    iconBox:
      'bg-white dark:bg-emerald-950/90 text-emerald-600 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/40 shadow-[0_2px_0_rgba(16,185,129,0.2)]',
    badgeCls: 'text-emerald-700 dark:text-emerald-300',
    titleCls: 'text-emerald-950 dark:text-emerald-100',
    descCls: 'text-emerald-900/90 dark:text-emerald-200/90',
    primaryBtn:
      'bg-emerald-600 hover:bg-emerald-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2.5px_0_#065F46]',
    barBg: 'bg-emerald-200/80 dark:bg-emerald-950',
    barFill: 'bg-emerald-500'
  },
  info: {
    shell:
      'bg-[#F8F1FF] dark:bg-[#1E1238] border-[#E8DDFF] dark:border-[#7135B5]/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_3.5px_0_#CEC3D4,0_10px_22px_rgba(88,20,156,0.08)] dark:shadow-[0_6px_20px_rgba(22,13,41,0.6)]',
    rail: 'bg-[#58149C]',
    iconBox:
      'bg-white dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] border-[#E8DDFF] dark:border-[#7135B5]/50 shadow-[0_2px_0_#CEC3D4] dark:shadow-none',
    badgeCls: 'text-[#58149C] dark:text-[#DAB9FF]',
    titleCls: 'text-[#1F1638] dark:text-white',
    descCls: 'text-[#4B4452] dark:text-[#E9D5FF]/90',
    primaryBtn:
      'bg-[#58149C] hover:bg-[#7135B5] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2.5px_0_#2A0053]',
    barBg: 'bg-[#E8DDFF] dark:bg-[#35105E]',
    barFill: 'bg-[#58149C]'
  }
};

export const TactileAlertBanner: React.FC<TactileAlertBannerProps> = ({
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
  const styles = VARIANT_STYLES[variant];

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
      className={`relative overflow-hidden rounded-2xl border p-3.5 sm:p-4 transition-all ${styles.shell} ${className}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1.5 ${styles.rail}`} />

      <div className="flex items-start gap-3 pl-2">
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${styles.iconBox}`}
        >
          <IconComp className="w-4.5 h-4.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              {badge && (
                <span className={`text-[10px] font-extrabold uppercase tracking-wider ${styles.badgeCls}`}>
                  {badge}
                </span>
              )}
              {metricBadge && (
                <span className="px-2 py-0.5 rounded-md font-mono text-[10.5px] font-bold bg-white/90 dark:bg-black/30 border border-black/10 dark:border-white/15 text-[#1F1638] dark:text-white tabular-nums">
                  {metricBadge}
                </span>
              )}
            </div>

            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="p-1 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer shrink-0"
                aria-label="Tutup peringatan"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className={`font-display font-bold text-[13.5px] sm:text-[14px] leading-snug mt-0.5 ${styles.titleCls}`}>
            {title}
          </div>

          {description && (
            <p className={`text-[12px] mt-1 leading-relaxed ${styles.descCls}`}>
              {description}
            </p>
          )}

          {typeof progressPercent === 'number' && (
            <div className={`mt-2.5 h-1.5 w-full rounded-full overflow-hidden ${styles.barBg}`}>
              <div
                className={`h-full rounded-full transition-all duration-300 ${styles.barFill}`}
                style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }}
              />
            </div>
          )}

          {(primaryAction || secondaryAction) && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {primaryAction && (
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-xl text-[12px] font-bold transition-all active:translate-y-0.5 cursor-pointer ${styles.primaryBtn}`}
                >
                  {primaryAction.icon}
                  <span>{primaryAction.label}</span>
                </button>
              )}
              {secondaryAction && (
                <button
                  type="button"
                  onClick={secondaryAction.onClick}
                  className="tactile-btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-xl text-[12px] font-bold bg-white dark:bg-[#22123F] text-[#4B4452] dark:text-[#E9D5FF] border border-[#CEC3D4] dark:border-[#4B386B] cursor-pointer"
                >
                  <span>{secondaryAction.label}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
