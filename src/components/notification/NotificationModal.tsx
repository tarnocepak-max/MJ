import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  variant?: 'violet' | 'danger' | 'warning' | 'success';
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClass?: string;
}

const MODAL_HEADER_GRADIENT: Record<NonNullable<NotificationModalProps['variant']>, string> = {
  violet: 'mj-notif-header-glass',
  danger: 'bg-gradient-to-r from-[#D45B66] via-[#E06D77] to-[#AC3C47] dark:from-[#480123] dark:via-[#93000A] dark:to-[#BA1A1A]',
  warning: 'bg-gradient-to-r from-[#C88735] via-[#DA9A46] to-[#9D661F] dark:from-[#78350F] dark:via-[#B45309] dark:to-[#D97706]',
  success: 'bg-gradient-to-r from-[#218A63] via-[#27A074] to-[#17694B] dark:from-[#064E3B] dark:via-[#047857] dark:to-[#10B981]'
};

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  variant = 'violet',
  children,
  footer,
  maxWidthClass = 'max-w-md'
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#26364A]/35 dark:bg-black/70 backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className={`w-full ${maxWidthClass} max-h-[92dvh] flex flex-col mj-notif-glass-panel rounded-t-[24px] sm:rounded-[22px] overflow-hidden text-[#26364A] dark:text-white animate-in fade-in zoom-in-95 duration-200`}
      >
        {/* Header */}
        <div className={`px-5 py-4 text-white flex items-center justify-between gap-3 shrink-0 ${MODAL_HEADER_GRADIENT[variant]}`}>
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-10 h-10 rounded-[14px] bg-white/16 border border-white/25 flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="font-display text-sm sm:text-base font-extrabold leading-tight truncate">
                {title}
              </h3>
              {subtitle && (
                <p className="text-[11px] text-white/85 dark:text-white/80 mt-0.5 truncate">{subtitle}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="mj-notif-btn-3d-glass w-11 h-11 min-w-[44px] min-h-[44px] sm:w-8 sm:h-8 sm:min-w-0 sm:min-h-0 rounded-[11px] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 bg-white/85 dark:bg-[#190C30]/85">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-[#EDF3F8]/85 dark:bg-[#140929] border-t border-[#DDE6F0] dark:border-[#3D1D72] flex flex-wrap items-center justify-end gap-2.5 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
