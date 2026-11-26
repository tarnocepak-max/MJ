import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search, UserCheck, X } from 'lucide-react';
import {
  filterInstallersByQuery,
  formatInstallerCapacityLabel,
  resolveSelectedInstallerOption,
  type SearchableInstallerOption
} from '../../utils/installerSearch';

export type { SearchableInstallerOption };

interface SearchableInstallerSelectProps {
  value: string;
  options: SearchableInstallerOption[];
  onChange: (value: string, option?: SearchableInstallerOption) => void;
  valueKey?: 'name' | 'id';
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loadingText?: string;
  isLoading?: boolean;
  disabled?: boolean;
  allowEmptyOption?: boolean;
  emptyOptionLabel?: string;
  disableFullOptions?: boolean;
  compact?: boolean;
  ariaLabel?: string;
  title?: string;
  className?: string;
  triggerClassName?: string;
  testId?: string;
}

interface FloatingPopoverPos {
  left: number;
  width: number;
  maxHeight: number;
  openDirection: 'up' | 'down';
  top?: number;
  bottom?: number;
}

const EDGE_MARGIN = 10;
const MENU_GAP = 6;
const PREFERRED_HEIGHT = 290;
const MIN_SPACE_DOWN = 165;
const MOBILE_BOTTOM_NAV_CLEARANCE = 76;

export const SearchableInstallerSelect: React.FC<SearchableInstallerSelectProps> = ({
  value,
  options,
  onChange,
  valueKey = 'name',
  placeholder = 'Pilih Teknisi...',
  searchPlaceholder = 'Cari nama atau username installer...',
  emptyMessage = 'Installer tidak ditemukan',
  loadingText = 'Memuat daftar installer...',
  isLoading = false,
  disabled = false,
  allowEmptyOption = false,
  emptyOptionLabel = '-- Pilih Teknisi --',
  disableFullOptions = false,
  compact = false,
  ariaLabel = 'Pilih Installer',
  title,
  className = '',
  triggerClassName = '',
  testId = 'searchable-installer-select'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cachedSelected, setCachedSelected] = useState<SearchableInstallerOption | null>(null);
  const [popoverPos, setPopoverPos] = useState<FloatingPopoverPos | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Cache the resolved selection so temporary refreshes of `options` never lose the selected label
  useEffect(() => {
    if (!value) {
      setCachedSelected(null);
      return;
    }
    const matched = resolveSelectedInstallerOption(options, value, valueKey, cachedSelected);
    if (matched) {
      setCachedSelected(matched);
    }
  }, [options, value, valueKey]);

  const resolvedSelected = useMemo(
    () => resolveSelectedInstallerOption(options, value, valueKey, cachedSelected),
    [options, value, valueKey, cachedSelected]
  );

  const filteredOptions = useMemo(
    () => filterInstallersByQuery(options, searchQuery),
    [options, searchQuery]
  );

  const computePopoverPosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl || typeof window === 'undefined') return;

    const rect = triggerEl.getBoundingClientRect();
    const vv = window.visualViewport;
    const vvTop = vv ? vv.offsetTop : 0;
    const vvHeight = vv ? vv.height : window.innerHeight;
    const vvLeft = vv ? vv.offsetLeft : 0;
    const vvWidth = vv ? vv.width : window.innerWidth;
    const vvBottom = vvTop + vvHeight;

    const isMobileViewport = window.innerWidth < 768;
    // Reserve bottom navigation clearance on mobile only when the keyboard isn't already shrinking visualViewport
    const keyboardOpen = vv ? vv.height < window.innerHeight * 0.78 : false;
    const effectiveBottomInset = isMobileViewport && !keyboardOpen ? MOBILE_BOTTOM_NAV_CLEARANCE : EDGE_MARGIN;

    const spaceBelow = Math.max(0, vvBottom - rect.bottom - effectiveBottomInset - MENU_GAP);
    const spaceAbove = Math.max(0, rect.top - vvTop - EDGE_MARGIN - MENU_GAP);

    const openUpward = spaceBelow < MIN_SPACE_DOWN && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(140, Math.min(PREFERRED_HEIGHT, Math.floor(availableSpace)));

    const minWidth = compact ? 236 : 256;
    const desiredWidth = Math.max(rect.width, minWidth);
    const clampedWidth = Math.min(desiredWidth, Math.max(200, vvWidth - EDGE_MARGIN * 2));
    const maxLeft = vvLeft + vvWidth - clampedWidth - EDGE_MARGIN;
    const clampedLeft = Math.max(vvLeft + EDGE_MARGIN, Math.min(rect.left, maxLeft));

    if (openUpward) {
      const bottomOffset = Math.max(EDGE_MARGIN, window.innerHeight - rect.top + MENU_GAP);
      setPopoverPos({
        left: clampedLeft,
        width: clampedWidth,
        maxHeight,
        openDirection: 'up',
        bottom: bottomOffset
      });
    } else {
      const topOffset = Math.max(vvTop + EDGE_MARGIN, rect.bottom + MENU_GAP);
      setPopoverPos({
        left: clampedLeft,
        width: clampedWidth,
        maxHeight,
        openDirection: 'down',
        top: topOffset
      });
    }
  }, [compact]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    computePopoverPosition();
  }, [isOpen, filteredOptions.length, isLoading, computePopoverPosition]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    const rafId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });

    const handleReposition = () => computePopoverPosition();
    const handlePointerDown = (evt: MouseEvent | TouchEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        evt.stopPropagation();
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
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      vv?.removeEventListener('resize', handleReposition);
      vv?.removeEventListener('scroll', handleReposition);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, computePopoverPosition]);

  // Clear transient search text when closing, never altering the committed `value`
  useEffect(() => {
    if (!isOpen && searchQuery) {
      setSearchQuery('');
    }
  }, [isOpen, searchQuery]);

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen(prev => !prev);
  };

  const handleSelectOption = (opt: SearchableInstallerOption | null) => {
    if (!opt) {
      setCachedSelected(null);
      onChange('', undefined);
      setIsOpen(false);
      return;
    }
    const isOptDisabled = Boolean(opt.disabled || (disableFullOptions && opt.isFull));
    if (isOptDisabled) return;

    const nextVal = valueKey === 'id' ? opt.id : opt.name;
    setCachedSelected(opt);
    onChange(nextVal, opt);
    setIsOpen(false);
  };

  const displayLabel = resolvedSelected
    ? formatInstallerCapacityLabel(resolvedSelected)
    : value
    ? value
    : placeholder;

  const isPlaceholderShown = !resolvedSelected && !value;

  const defaultTriggerClasses = compact
    ? 'w-full px-2.5 py-1.5 min-h-[34px] text-xs rounded-lg border border-[#DDE6F0] dark:border-[#4B386B] bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white'
    : 'tactile-debossed-input w-full px-3 py-2 min-h-[42px] text-xs rounded-xl border border-[#DDE6F0] dark:border-[#4B386B] bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white';

  return (
    <div className={`relative ${className}`} data-testid={testId}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        onClick={handleToggle}
        className={`flex items-center justify-between gap-2 font-medium text-left transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#6657C8]/40 dark:focus:ring-[#58149C]/50 ${
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
        } ${triggerClassName || defaultTriggerClasses}`}
      >
        <span className={`truncate flex-1 ${isPlaceholderShown ? 'text-[#8492A5] dark:text-[#A79BC0]' : ''}`}>
          {displayLabel}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#5145A6] dark:text-[#DAB9FF]" />}
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#8492A5] dark:text-[#C4B5FD] transition-transform duration-150 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </span>
      </button>

      {isOpen &&
        popoverPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            data-testid={`${testId}-popover`}
            style={{
              position: 'fixed',
              left: popoverPos.left,
              width: popoverPos.width,
              ...(popoverPos.openDirection === 'up'
                ? { bottom: popoverPos.bottom }
                : { top: popoverPos.top }),
              zIndex: 10060
            }}
            className="rounded-2xl border border-[#C9D8EA] bg-white/98 backdrop-blur-md shadow-[0_14px_34px_rgba(38,57,78,0.18)] dark:border-[#4B2D7A] dark:bg-[#190C30] dark:shadow-[0_14px_38px_rgba(0,0,0,0.65)] overflow-hidden flex flex-col"
          >
            {/* Search Input Header */}
            <div className="p-2 border-b border-[#E4EDF5] dark:border-[#35105E] bg-[#F7FAFE] dark:bg-[#130826] shrink-0">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[#7B8FA6] dark:text-[#B89EFF] absolute left-2.5 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label="Cari Installer"
                  data-testid={`${testId}-search`}
                  className="w-full pl-8 pr-7 py-1.5 text-sm sm:text-xs rounded-xl bg-white dark:bg-[#1E1238] border border-[#D4E1EE] dark:border-[#4B386B] text-[#26364A] dark:text-white placeholder:text-[#8492A5] dark:placeholder:text-[#9A8BB8] focus:outline-hidden focus:ring-2 focus:ring-[#6657C8]/35 dark:focus:ring-[#7135B5]/50"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Hapus pencarian"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-2 p-0.5 rounded-full text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Option List */}
            <div
              style={{ maxHeight: Math.max(100, popoverPos.maxHeight - 54) }}
              className="overflow-y-auto overscroll-contain p-1.5 space-y-0.5"
            >
              {isLoading ? (
                <div className="px-3 py-5 flex items-center justify-center gap-2 text-xs font-medium text-[#52647A] dark:text-[#CEC0E8]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#5145A6] dark:text-[#DAB9FF]" />
                  <span>{loadingText}</span>
                </div>
              ) : (
                <>
                  {allowEmptyOption && !searchQuery.trim() && (
                    <button
                      type="button"
                      role="option"
                      aria-selected={!value}
                      onClick={() => handleSelectOption(null)}
                      className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                        !value
                          ? 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1B59] dark:text-white'
                          : 'text-[#52647A] hover:bg-[#F3F8FC] dark:text-[#CEC0E8] dark:hover:bg-[#241345]'
                      }`}
                    >
                      {emptyOptionLabel}
                    </button>
                  )}

                  {filteredOptions.length === 0 ? (
                    <div
                      data-testid={`${testId}-empty`}
                      className="px-3 py-5 text-center text-xs font-semibold text-[#64748B] dark:text-[#CEC0E8]"
                    >
                      {emptyMessage}
                    </div>
                  ) : (
                    filteredOptions.map(opt => {
                      const isSelected = Boolean(
                        value &&
                          (valueKey === 'id'
                            ? String(opt.id) === String(value)
                            : opt.name.toLowerCase().trim() === String(value).toLowerCase().trim() ||
                              String(opt.id) === String(value))
                      );
                      const isOptDisabled = Boolean(opt.disabled || (disableFullOptions && opt.isFull));
                      const hasCapacity =
                        typeof opt.assignedCount === 'number' && typeof opt.maxLimit === 'number';

                      return (
                        <button
                          key={opt.id || opt.name}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={isOptDisabled}
                          data-testid={`${testId}-option-${opt.id || opt.name}`}
                          onClick={() => handleSelectOption(opt)}
                          className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 transition-colors ${
                            isOptDisabled
                              ? 'opacity-55 cursor-not-allowed text-[#64748B] dark:text-[#9A8BB8]'
                              : isSelected
                              ? 'bg-[#EAE8FF] text-[#3E328D] dark:bg-[#351768] dark:text-white cursor-pointer'
                              : 'text-[#26364A] hover:bg-[#F1F7FC] dark:text-[#F3EEFF] dark:hover:bg-[#271549] cursor-pointer'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <UserCheck
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  isSelected
                                    ? 'text-[#5145A6] dark:text-[#DAB9FF]'
                                    : 'text-[#7B8FA6] dark:text-[#A78BFA]'
                                }`}
                              />
                              <span className="font-bold text-xs truncate">{opt.name}</span>
                            </div>
                            {(opt.username || opt.area) && (
                              <div className="text-[10.5px] text-[#64748B] dark:text-[#B89EFF] pl-5 truncate">
                                {opt.username ? `@${opt.username}` : ''}
                                {opt.username && opt.area ? ' · ' : ''}
                                {opt.area || ''}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {hasCapacity && (
                              <span
                                className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold tabular-nums ${
                                  opt.isFull
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                    : 'bg-[#E4F0F6] text-[#26394E] dark:bg-[#22123F] dark:text-[#DAB9FF]'
                                }`}
                              >
                                {opt.assignedCount}/{opt.maxLimit}
                                {opt.isFull ? ' PENUH' : ''}
                              </span>
                            )}
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
