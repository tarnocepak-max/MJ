import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';

export interface ResponsiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /** Bottom sheet look vs full-viewport on mobile */
  mobileVariant?: 'sheet' | 'fullscreen';
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  closeOnBackdropClick?: boolean;
  zIndexClass?: string;
  variant?: 'default' | 'dark_purple';
}

const SIZE_MAX_WIDTH: Record<NonNullable<ResponsiveModalProps['size']>, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
  '2xl': 'sm:max-w-7xl',
  full: 'sm:max-w-[96vw]'
};

export const ResponsiveModal: React.FC<ResponsiveModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  size = 'lg',
  mobileVariant = 'sheet',
  headerExtra,
  footer,
  children,
  closeOnBackdropClick = true,
  zIndexClass = 'z-60',
  variant = 'default'
}) => {
  const { isCompactUI } = useResponsiveViewport();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isSheetMobile = isCompactUI && mobileVariant === 'sheet';
  const isFullscreenMobile = isCompactUI && mobileVariant === 'fullscreen';
  const isDarkTech = variant === 'dark_purple';

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex ${
        isSheetMobile
          ? 'items-end justify-center p-0'
          : isFullscreenMobile
          ? 'items-stretch justify-center p-0'
          : 'items-center justify-center p-3 sm:p-5'
      } bg-[#160D29]/75 backdrop-blur-sm transition-opacity`}
      onClick={() => {
        if (closeOnBackdropClick) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className={`relative w-full border shadow-2xl flex flex-col overflow-hidden ${
          isDarkTech
            ? 'bg-[#160D29] text-white border-[#4B386B] shadow-[0_8px_0_#0D061A,0_24px_48px_rgba(13,6,26,0.65)]'
            : 'bg-white dark:bg-[#160D29] border-[#E8DDFF] dark:border-[#3B1D78] shadow-[0_6px_0_#E8DDFF,0_24px_48px_-12px_rgba(53,16,94,0.28)] dark:shadow-[0_6px_0_#0D061A,0_24px_48px_rgba(0,0,0,0.65)]'
        } ${
          isFullscreenMobile
            ? 'h-dvh rounded-none'
            : isSheetMobile
            ? 'max-h-[92dvh] rounded-t-2xl mj-sheet-enter'
            : `${SIZE_MAX_WIDTH[size]} max-h-[92dvh] rounded-2xl`
        }`}
      >
        {isSheetMobile && (
          <div className="pt-2.5 pb-1 flex justify-center shrink-0">
            <div className={`w-10 h-1 rounded-full ${isDarkTech ? 'bg-[#5B35B1]' : 'bg-[#D8CCF3] dark:bg-[#5B35B1]'}`} />
          </div>
        )}

        {(title || headerExtra) && (
          <div
            className={`px-4 sm:px-5 py-3.5 border-b flex items-start justify-between gap-3 shrink-0 ${
              isDarkTech
                ? 'border-[#35105E] bg-gradient-to-r from-[#160D29] via-[#27104A] to-[#1A0D36]'
                : 'border-[#E8DDFF] dark:border-[#35105E] bg-[#F8F1FF]/95 dark:bg-[#1E1238]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isDarkTech
                      ? 'bg-[#35105E] text-[#D8B4FE] border border-[#5B35B1]'
                      : 'bg-[#F3EAFF] dark:bg-[#27104A] text-[#58149C] dark:text-[#D8B4FE] border border-[#DFC7FF] dark:border-[#5B35B1]'
                  }`}
                >
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2
                    className={`font-display font-bold text-sm sm:text-base truncate ${
                      isDarkTech ? 'text-white' : 'text-[#1F1638] dark:text-white'
                    }`}
                  >
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p
                    className={`text-[11px] truncate mt-0.5 ${
                      isDarkTech ? 'text-[#C5B3DF]' : 'text-[#7D7484] dark:text-[#C5B3DF]'
                    }`}
                  >
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {headerExtra}
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup dialog"
                className={`min-w-[44px] min-h-[44px] sm:w-9 sm:h-9 sm:min-w-[36px] sm:min-h-[36px] rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
                  isDarkTech
                    ? 'bg-[#27104A] hover:bg-[#35105E] text-[#D8B4FE] hover:text-white border border-[#5B35B1]'
                    : 'btn-3d-icon'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {children}
        </div>

        {footer && (
          <div
            className={`px-4 sm:px-5 py-3 border-t flex flex-wrap items-center justify-end gap-2 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
              isDarkTech
                ? 'border-[#35105E] bg-[#1E1238]'
                : 'border-[#E8DDFF] dark:border-[#35105E] bg-[#F8F1FF]/90 dark:bg-[#1E1238]'
            }`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
