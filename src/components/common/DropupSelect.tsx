import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronUp, Tag } from 'lucide-react';

export interface DropupSelectOption {
  value: string;
  label: string;
  badgeText?: string;
  description?: string;
}

interface DropupSelectProps {
  value: string;
  options: DropupSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
  testId?: string;
}

interface FloatingMenuPosition {
  left: number;
  width: number;
  maxHeight: number;
  openDirection: 'up' | 'down';
  bottom?: number;
  top?: number;
}

const MIN_MENU_HEIGHT_UP = 112;
const PREFERRED_MENU_HEIGHT = 260;
const EDGE_MARGIN = 10;
const MENU_GAP = 8;

export const DropupSelect: React.FC<DropupSelectProps> = ({
  value,
  options,
  placeholder = 'Pilih Kategori...',
  disabled = false,
  onChange,
  ariaLabel = 'Pilih Kategori Chat',
  className = '',
  triggerClassName = '',
  testId = 'dropup-select'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<FloatingMenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedOption = options.find(
    opt => opt.value === value || opt.value.toUpperCase() === String(value || '').trim().toUpperCase()
  );

  const computeMenuPosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl || typeof window === 'undefined') return;

    const rect = triggerEl.getBoundingClientRect();
    const vv = window.visualViewport;
    const vvTop = vv ? vv.offsetTop : 0;
    const vvHeight = vv ? vv.height : window.innerHeight;
    const vvLeft = vv ? vv.offsetLeft : 0;
    const vvWidth = vv ? vv.width : window.innerWidth;
    const vvBottom = vvTop + vvHeight;

    const spaceAbove = Math.max(0, rect.top - vvTop - EDGE_MARGIN - MENU_GAP);
    const spaceBelow = Math.max(0, vvBottom - rect.bottom - EDGE_MARGIN - MENU_GAP);

    // Strictly prefer opening UPWARD whenever sufficient top viewport space exists
    const openUpward = spaceAbove >= MIN_MENU_HEIGHT_UP || spaceAbove >= spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(96, Math.min(PREFERRED_MENU_HEIGHT, Math.floor(availableSpace)));

    const desiredWidth = Math.max(rect.width, 200);
    const clampedWidth = Math.min(desiredWidth, Math.max(180, vvWidth - EDGE_MARGIN * 2));
    const maxLeft = vvLeft + vvWidth - clampedWidth - EDGE_MARGIN;
    const clampedLeft = Math.max(vvLeft + EDGE_MARGIN, Math.min(rect.left, maxLeft));

    if (openUpward) {
      const bottomOffset = Math.max(EDGE_MARGIN, window.innerHeight - rect.top + MENU_GAP);
      setMenuPos({
        left: clampedLeft,
        width: clampedWidth,
        maxHeight,
        openDirection: 'up',
        bottom: bottomOffset
      });
    } else {
      const topOffset = Math.max(vvTop + EDGE_MARGIN, rect.bottom + MENU_GAP);
      setMenuPos({
        left: clampedLeft,
        width: clampedWidth,
        maxHeight,
        openDirection: 'down',
        top: topOffset
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    computeMenuPosition();
  }, [isOpen, options.length, computeMenuPosition]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    const handleReposition = () => computeMenuPosition();
    const handlePointerDown = (evt: MouseEvent | TouchEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const vv = window.visualViewport;
    vv?.addEventListener('resize', handleReposition);
    vv?.addEventListener('scroll', handleReposition);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      vv?.removeEventListener('resize', handleReposition);
      vv?.removeEventListener('scroll', handleReposition);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, computeMenuPosition]);

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen(prev => !prev);
  };

  const handleSelect = (optValue: string) => {
    onChange(optValue);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} data-testid={testId}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={handleToggle}
        className={`w-full min-h-[44px] h-[44px] sm:h-[38px] sm:min-h-[38px] px-3 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed ${
          isOpen
            ? 'border-[#6657C8] dark:border-[#9E7DF5] ring-2 ring-[#6657C8]/20 dark:ring-[#7135b5]/25 bg-white dark:bg-[#1E1238]'
            : 'border-[#DDE6F0] dark:border-[#3D1D72] bg-white dark:bg-[#160D29] text-[#26364A] dark:text-[#f5eeff] hover:border-[#9E95DE] dark:hover:border-[#6A3CC7]'
        } ${triggerClassName}`}
      >
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <Tag className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
          <span
            className={`text-xs font-bold truncate ${
              selectedOption
                ? 'text-[#26364A] dark:text-[#f5eeff]'
                : 'text-[#8492A5] dark:text-[#A79BC0]'
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>
        <ChevronUp
          className={`w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : 'rotate-0'
          }`}
        />
      </button>

      {isOpen &&
        menuPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            data-dropup-direction={menuPos.openDirection}
            style={{
              position: 'fixed',
              left: `${menuPos.left}px`,
              width: `${menuPos.width}px`,
              maxHeight: `${menuPos.maxHeight}px`,
              ...(menuPos.openDirection === 'up'
                ? { bottom: `${menuPos.bottom}px` }
                : { top: `${menuPos.top}px` }),
              zIndex: 10050
            }}
            className={`rounded-xl border border-[#DCE3F2] dark:border-[#3D1D72] bg-white/98 dark:bg-[#190C30]/98 backdrop-blur-xl shadow-[0_14px_38px_-8px_rgba(38,54,74,0.24)] dark:shadow-[0_18px_42px_rgba(8,3,20,0.72)] overflow-y-auto overscroll-contain p-1.5 space-y-1 transition-all duration-150 ${
              menuPos.openDirection === 'up'
                ? 'origin-bottom animate-in fade-in slide-in-from-bottom-2 duration-150'
                : 'origin-top animate-in fade-in slide-in-from-top-2 duration-150'
            }`}
          >
            {options.length === 0 ? (
              <div className="px-3 py-3 text-center text-[11px] text-[#8492A5] dark:text-[#C5B3DF]">
                Tidak ada kategori aktif.
              </div>
            ) : (
              options.map(opt => {
                const isSelected =
                  opt.value === value ||
                  opt.value.toUpperCase() === String(value || '').trim().toUpperCase();
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full min-h-[42px] px-3 py-2 rounded-lg text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#EEE5FF] border border-[#C5BEEF] dark:border-[#8648F5]/50 font-bold'
                        : 'text-[#26364A] dark:text-[#E8DDFF] hover:bg-[#F3F8FC] dark:hover:bg-[#241145] border border-transparent font-medium'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs truncate">{opt.label}</div>
                      {opt.description && (
                        <div className="text-[10px] text-[#52647A] dark:text-[#B6A5D8] truncate mt-0.5">
                          {opt.description}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
