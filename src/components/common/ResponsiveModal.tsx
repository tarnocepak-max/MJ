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
  const isDarkPurple = variant === 'dark_purple';

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
          isDarkPurple
            ? 'bg-[#160D29] text-white border-[#D8B4FE]/40'
            : 'bg-white dark:bg-[#1E1238] border-[#E8DDFF] dark:border-[#35105E]'
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
            <div className={`w-10 h-1 rounded-full ${isDarkPurple ? 'bg-[#D8B4FE]/40' : 'bg-[#CEC3D4] dark:bg-[#4B386B]'}`} />
          </div>
        )}

        {(title || headerExtra) && (
          <div
            className={`px-4 sm:px-5 py-3.5 border-b flex items-start justify-between gap-3 shrink-0 ${
              isDarkPurple
                ? 'border-[#35105E] bg-[#1E0F3D]'
                : 'border-[#E8DDFF] dark:border-[#35105E] bg-[#F8F1FF]/70 dark:bg-[#160D29]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isDarkPurple
                      ? 'bg-[#35105E] text-[#D8B4FE] border border-[#7135B5]/50'
                      : 'bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
                  }`}
                >
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2
                    className={`font-display font-bold text-sm sm:text-base truncate ${
                      isDarkPurple ? 'text-white' : 'text-[#1F1638] dark:text-white'
                    }`}
                  >
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p
                    className={`text-[11px] truncate mt-0.5 ${
                      isDarkPurple ? 'text-[#D8B4FE]/80' : 'text-[#7D7484] dark:text-[#CEC0E8]'
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
                className={`min-w-[40px] min-h-[40px] sm:w-8 sm:h-8 sm:min-w-[32px] sm:min-h-[32px] rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
                  isDarkPurple
                    ? 'bg-[#35105E]/60 hover:bg-[#35105E] text-[#D8B4FE] hover:text-white border border-[#D8B4FE]/20'
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
              isDarkPurple
                ? 'border-[#35105E] bg-[#160D29]'
                : 'border-[#E8DDFF] dark:border-[#35105E] bg-[#F8F1FF]/80 dark:bg-[#160D29]'
            }`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
