import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { useVisualViewportModal } from '../../hooks/useVisualViewportModal';
import { useModalLayer } from '../../hooks/useModalLayer';
import type { ModalLayerTier } from '../../utils/modalStack';

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
  layerTier?: ModalLayerTier;
  hidesBottomNav?: boolean;
  variant?: 'default' | 'dark_purple';
  bodyClassName?: string;
  dialogClassName?: string;
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
  zIndexClass,
  layerTier = 'modal',
  hidesBottomNav = true,
  variant = 'default',
  bodyClassName,
  dialogClassName = ''
}) => {
  const { isCompactUI } = useResponsiveViewport();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const vvMetrics = useVisualViewportModal(isOpen, dialogRef);
  const layerZ = useModalLayer(isOpen, { tier: layerTier, hidesBottomNav });

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

  const modalHeightStyle: React.CSSProperties | undefined = vvMetrics.isKeyboardOpen
    ? {
        maxHeight: `${Math.max(260, vvMetrics.viewportHeight - (isFullscreenMobile ? 0 : 12))}px`
      }
    : undefined;

  const content = (
    <div
      style={{
        ...(zIndexClass ? {} : { zIndex: layerZ }),
        ...(vvMetrics.keyboardInset > 0 ? { paddingBottom: `${vvMetrics.keyboardInset}px` } : {})
      }}
      className={`fixed inset-0 ${zIndexClass || ''} flex ${
        isSheetMobile
          ? 'items-end justify-center p-0'
          : isFullscreenMobile
          ? 'items-stretch justify-center p-0'
          : 'items-center justify-center p-3 sm:p-5'
      } bg-[#26364A]/35 dark:bg-black/70 backdrop-blur-[4px] transition-opacity`}
      onClick={() => {
        if (closeOnBackdropClick) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={modalHeightStyle}
        onClick={e => e.stopPropagation()}
        className={`relative w-full border shadow-2xl flex flex-col overflow-hidden ${
          isDarkTech
            ? 'bg-white/95 dark:bg-[#160D29] text-[#26364A] dark:text-white border-[#DDE6F0] dark:border-[#8648F5]/35 shadow-[0_24px_56px_-12px_rgba(38,54,74,0.22)] dark:shadow-[0_24px_56px_rgba(8,3,20,0.72)]'
            : 'bg-white/95 dark:bg-[#190C30]/95 backdrop-blur-xl border-[#DDE6F0] dark:border-[#8648F5]/30 shadow-[0_24px_56px_-12px_rgba(38,54,74,0.22)] dark:shadow-[0_24px_56px_rgba(0,0,0,0.72)]'
        } ${
          isFullscreenMobile
            ? 'h-dvh rounded-none'
            : isSheetMobile
            ? 'max-h-[92dvh] rounded-t-[22px] mj-sheet-enter'
            : `${SIZE_MAX_WIDTH[size]} max-h-[92dvh] rounded-[20px] ${dialogClassName}`
        }`}
      >
        {isSheetMobile && (
          <div className="pt-2.5 pb-1 flex justify-center shrink-0">
            <div className={`w-10 h-1 rounded-full ${isDarkTech ? 'bg-[#CFDCE8] dark:bg-[#8648F5]' : 'bg-[#CFDCE8] dark:bg-[#5424A8]'}`} />
          </div>
        )}

        {(title || headerExtra) && (
          <div
            className={`px-4 sm:px-5 py-3.5 border-b flex items-start justify-between gap-3 shrink-0 ${
              isDarkTech
                ? 'border-[#DDE6F0] dark:border-[#3D1D72] bg-gradient-to-r from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#30104B] dark:via-[#5424A8] dark:to-[#30104B] text-[#26364A] dark:text-white'
                : 'border-[#DDE6F0] dark:border-[#3D1D72] bg-[#F8FAFD]/95 dark:bg-[#1E0E3B]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <div
                  className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 ${
                    isDarkTech
                      ? 'bg-white text-[#5145A6] border border-[#C5BEEF] dark:bg-white/15 dark:text-[#EEE5FF] dark:border-white/25'
                      : 'bg-[#DDF4F4] dark:bg-[#341668] text-[#5145A6] dark:text-[#DEC8FF] border border-[#DDE6F0] dark:border-[#8648F5]/45'
                  }`}
                >
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2 className="font-display font-extrabold text-sm sm:text-base truncate text-[#26364A] dark:text-white">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p
                    className={`text-[11px] truncate mt-0.5 ${
                      isDarkTech ? 'text-[#52647A] dark:text-[#EEE5FF]/85' : 'text-[#52647A] dark:text-[#BFB2DC]'
                    }`}
                  >
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {headerExtra}
              {isDarkTech ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Tutup dialog"
                    className="min-w-[44px] min-h-[44px] sm:w-9 sm:h-9 sm:min-w-[36px] sm:min-h-[36px] rounded-[12px] flex dark:hidden items-center justify-center cursor-pointer transition-all mj-notif-btn-3d-soft"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Tutup dialog"
                    className="min-w-[44px] min-h-[44px] sm:w-9 sm:h-9 sm:min-w-[36px] sm:min-h-[36px] rounded-[12px] hidden dark:flex items-center justify-center cursor-pointer transition-all mj-notif-btn-3d-glass"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Tutup dialog"
                  className="min-w-[44px] min-h-[44px] sm:w-9 sm:h-9 sm:min-w-[36px] sm:min-h-[36px] rounded-[12px] flex items-center justify-center cursor-pointer transition-all mj-notif-btn-3d-soft"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className={bodyClassName || 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5'}>
          {children}
        </div>

        {footer && (
          <div
            className="px-4 sm:px-5 py-3 border-t flex flex-col-reverse sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-end gap-2 shrink-0 pb-[max(0.85rem,env(safe-area-inset-bottom))] border-[#DDE6F0] bg-[#F8FAFD]/95 dark:border-[#3D1D72] dark:bg-[#190C30]"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
};
