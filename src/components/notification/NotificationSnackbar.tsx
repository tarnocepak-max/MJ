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
    'bg-[#EAE8FF] text-[#5145A6] border-[#DCE3F2] dark:bg-[#341668] dark:text-[#DEC8FF] dark:border-[#8648F5]/50',
  warning:
    'bg-[#FFF2D9] text-[#C88735] border-[#F2CF95] dark:bg-amber-950/75 dark:text-amber-300 dark:border-amber-700/60',
  success:
    'bg-[#E4F5EC] text-[#218A63] border-[#B7E4CC] dark:bg-emerald-950/75 dark:text-emerald-300 dark:border-emerald-700/60',
  danger:
    'bg-[#FCE9EB] text-[#D45B66] border-[#F3C5CA] dark:bg-rose-950/75 dark:text-rose-300 dark:border-rose-700/60'
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
            <div className="text-xs font-extrabold text-[#26364A] dark:text-white truncate">
              {title}
            </div>
            {description && (
              <div className="text-[11px] text-[#52647A] dark:text-[#BFB2DC] truncate mt-0.5">
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
              className="w-7 h-7 rounded-[10px] bg-[#F8FAFD] dark:bg-white/10 hover:bg-[#EAE8FF] dark:hover:bg-white/20 text-[#8492A5] hover:text-[#26364A] dark:text-[#CFC3EC] dark:hover:text-white flex items-center justify-center cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
