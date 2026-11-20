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
      } bg-[#0B1220]/75 backdrop-blur-sm transition-opacity`}
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
            ? 'bg-[#0F172A] text-white border-slate-700'
            : 'bg-white dark:bg-[#0F172A] border-slate-200 dark:border-slate-800'
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
            <div className={`w-10 h-1 rounded-full ${isDarkTech ? 'bg-slate-600' : 'bg-slate-300 dark:bg-slate-600'}`} />
          </div>
        )}

        {(title || headerExtra) && (
          <div
            className={`px-4 sm:px-5 py-3.5 border-b flex items-start justify-between gap-3 shrink-0 ${
              isDarkTech
                ? 'border-slate-800 bg-[#0B1220]'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-[#0B1220]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isDarkTech
                      ? 'bg-[#1E293B] text-[#38BDF8] border border-slate-700'
                      : 'bg-blue-50 dark:bg-blue-950/60 text-[#2563EB] dark:text-[#38BDF8] border border-blue-100 dark:border-blue-900/50'
                  }`}
                >
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2
                    className={`font-display font-bold text-sm sm:text-base truncate ${
                      isDarkTech ? 'text-white' : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p
                    className={`text-[11px] truncate mt-0.5 ${
                      isDarkTech ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'
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
                    ? 'bg-[#1E293B] hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                    : 'bg-slate-100 dark:bg-[#1E293B] hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
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
                ? 'border-slate-800 bg-[#0B1220]'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-[#0B1220]'
            }`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
