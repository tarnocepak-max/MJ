import React from 'react';
import { X } from 'lucide-react';

export type SnackbarVariant = 'violet' | 'warning' | 'success' | 'danger';

interface NotificationSnackbarProps {
  visible: boolean;
  icon: React.ReactNode;
  title: string;
  description?: string;
  variant?: SnackbarVariant;
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  className?: string;
}

const SNACKBAR_ICON_BOX: Record<SnackbarVariant, string> = {
  violet:
    'bg-[#EEE5FF] text-[#5424A8] border-[#D8C5FF] dark:bg-[#341668] dark:text-[#DEC8FF] dark:border-[#8648F5]/50',
  warning:
    'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/75 dark:text-amber-300 dark:border-amber-700/60',
  success:
    'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/75 dark:text-emerald-300 dark:border-emerald-700/60',
  danger:
    'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/75 dark:text-rose-300 dark:border-rose-700/60'
};

export const NotificationSnackbar: React.FC<NotificationSnackbarProps> = ({
  visible,
  icon,
  title,
  description,
  variant = 'violet',
  action,
  secondaryAction,
  onDismiss,
  className = ''
}) => {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-24 sm:bottom-5 inset-x-3 sm:inset-x-auto sm:right-5 z-[45] sm:max-w-md mj-notif-snackbar-enter ${className}`}
    >
      <div className="mj-notif-glass-panel rounded-[18px] px-3.5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={`w-9 h-9 rounded-[12px] border flex items-center justify-center shrink-0 ${SNACKBAR_ICON_BOX[variant]}`}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-[#28203A] dark:text-white truncate">
              {title}
            </div>
            {description && (
              <div className="text-[11px] text-[#756C86] dark:text-[#BFB2DC] truncate mt-0.5">
                {description}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="mj-notif-btn-3d-soft px-2.5 py-1.5 rounded-[11px] text-[11px] font-bold cursor-pointer"
            >
              {secondaryAction.label}
            </button>
          )}
          {action && (
            <button
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
              className="mj-notif-btn-3d px-3 py-1.5 rounded-[11px] text-[11px] font-extrabold cursor-pointer whitespace-nowrap"
            >
              {action.label}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Tutup snackbar"
              className="w-7 h-7 rounded-[10px] bg-[#F7F4FC] dark:bg-white/10 hover:bg-[#EEE5FF] dark:hover:bg-white/20 text-[#756C86] hover:text-[#28203A] dark:text-[#CFC3EC] dark:hover:text-white flex items-center justify-center cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
