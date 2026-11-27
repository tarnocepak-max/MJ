import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { HierarchicalReason } from '../../../types/index.ts';
import { getDynamicPopoverZIndex } from '../../../utils/modalStack';

export type SearchableReasonAccentTone = 'emerald' | 'amber' | 'blue' | 'red' | 'violet';

export interface SearchableReasonDropdownProps {
  reasons: HierarchicalReason[];
  selectedReasonId: string;
  selectedReasonName?: string;
  onSelectReason: (reason: HierarchicalReason) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyOptionsMessage?: string;
  emptyFilterMessage?: string;
  disabled?: boolean;
  accentTone?: SearchableReasonAccentTone;
  dataTestId?: string;
}

const TONE_CLASSES: Record<
  SearchableReasonAccentTone,
  {
    triggerSelected: string;
    focusRing: string;
    optionSelected: string;
    checkIcon: string;
    badge: string;
  }
> = {
  emerald: {
    triggerSelected:
      'border-[#27A074] dark:border-emerald-500 bg-[#E4F5EC]/70 dark:bg-emerald-950/35 text-[#1B6B4D] dark:text-emerald-100',
    focusRing: 'focus:ring-2 focus:ring-[#27A074] dark:focus:ring-emerald-500',
    optionSelected:
      'bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#1B6B4D] dark:text-emerald-100 border-[#27A074]/50 dark:border-emerald-600/60',
    checkIcon: 'text-[#218A63] dark:text-emerald-400',
    badge:
      'bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-700'
  },
  amber: {
    triggerSelected:
      'border-[#D4933E] dark:border-amber-500 bg-[#FFF2D9]/75 dark:bg-amber-950/35 text-[#9D661F] dark:text-amber-100',
    focusRing: 'focus:ring-2 focus:ring-[#C88735] dark:focus:ring-amber-500',
    optionSelected:
      'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-100 border-[#D4933E]/50 dark:border-amber-600/60',
    checkIcon: 'text-[#C88735] dark:text-amber-400',
    badge:
      'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-300 border-[#F2CF95] dark:border-amber-700'
  },
  blue: {
    triggerSelected:
      'border-[#3E81C6] dark:border-blue-500 bg-[#E7F1FB]/80 dark:bg-blue-950/35 text-[#1E4F8A] dark:text-blue-100',
    focusRing: 'focus:ring-2 focus:ring-[#3E81C6] dark:focus:ring-blue-500',
    optionSelected:
      'bg-[#E7F1FB] dark:bg-blue-950/60 text-[#1E4F8A] dark:text-blue-100 border-[#3E81C6]/50 dark:border-blue-600/60',
    checkIcon: 'text-[#3E81C6] dark:text-blue-400',
    badge:
      'bg-[#E7F1FB] dark:bg-blue-950/60 text-[#1E4F8A] dark:text-blue-300 border-[#B6D4F4] dark:border-blue-700'
  },
  red: {
    triggerSelected:
      'border-[#9B2C37] dark:border-rose-500 bg-[#FCE9EB]/80 dark:bg-rose-950/40 text-[#7F1D27] dark:text-rose-100',
    focusRing: 'focus:ring-2 focus:ring-[#9B2C37] dark:focus:ring-rose-500',
    optionSelected:
      'bg-[#FCE9EB] dark:bg-rose-950/65 text-[#7F1D27] dark:text-rose-100 border-[#9B2C37]/50 dark:border-rose-600/60',
    checkIcon: 'text-[#9B2C37] dark:text-rose-400',
    badge:
      'bg-[#FCE9EB] dark:bg-rose-950/65 text-[#9B2C37] dark:text-rose-300 border-[#F2BCC2] dark:border-rose-700'
  },
  violet: {
    triggerSelected:
      'border-[#6657C8] dark:border-[#8648F5] bg-[#F0EDFF]/80 dark:bg-[#2A194B] text-[#5145A6] dark:text-[#EEE5FF]',
    focusRing: 'focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#8648F5]',
    optionSelected:
      'bg-[#F0EDFF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#EEE5FF] border-[#6657C8]/50 dark:border-[#8648F5]/60',
    checkIcon: 'text-[#5145A6] dark:text-[#DAB9FF]',
    badge:
      'bg-[#F0EDFF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] border-[#D4CEFA] dark:border-[#4B386B]'
  }
};

export const SearchableReasonDropdown: React.FC<SearchableReasonDropdownProps> = ({
  reasons,
  selectedReasonId,
  selectedReasonName,
  onSelectReason,
  placeholder = '-- Pilih Alasan / Kategori Pekerjaan (Level 2) --',
  searchPlaceholder = 'Cari alasan atau kategori pekerjaan...',
  emptyOptionsMessage = 'Belum ada alasan aktif yang tersedia.',
  emptyFilterMessage = 'Tidak ada alasan yang cocok dengan pencarian.',
  disabled = false,
  accentTone = 'violet',
  dataTestId = 'searchable-reason-dropdown'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    openUpward: boolean;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const tone = TONE_CLASSES[accentTone] || TONE_CLASSES.violet;

  const selectedReason = useMemo(() => {
    if (!reasons.length) return null;
    if (selectedReasonId) {
      const byId = reasons.find(r => r.id === selectedReasonId);
      if (byId) return byId;
    }
    if (selectedReasonName) {
      const norm = selectedReasonName.trim().toLowerCase();
      return reasons.find(r => r.name.trim().toLowerCase() === norm) || null;
    }
    return null;
  }, [reasons, selectedReasonId, selectedReasonName]);

  const filteredReasons = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return reasons;
    return reasons.filter(reason => {
      const name = String(reason.name || '').toLowerCase();
      const code = String(reason.code || '').toLowerCase();
      const desc = String((reason as { description?: string }).description || '').toLowerCase();
      return name.includes(q) || code.includes(q) || desc.includes(q);
    });
  }, [reasons, searchQuery]);

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewportHeight = vv ? vv.height : window.innerHeight;
    const viewportWidth = vv ? vv.width : window.innerWidth;

    const safeMargin = 10;
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - safeMargin);
    const spaceAbove = Math.max(0, rect.top - safeMargin);
    const openUpward = spaceBelow < 210 && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(150, Math.min(280, availableSpace - 8));

    const width = Math.min(rect.width, viewportWidth - 20);
    const left = Math.max(10, Math.min(rect.left, viewportWidth - width - 10));
    const top = openUpward
      ? Math.max(safeMargin, rect.top - Math.min(maxHeight, availableSpace) - 6)
      : Math.min(viewportHeight - safeMargin - 120, rect.bottom + 6);

    setMenuStyle({
      left,
      top,
      width,
      maxHeight,
      openUpward
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();

    const selectedIdx = selectedReason
      ? filteredReasons.findIndex(r => r.id === selectedReason.id)
      : 0;
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 25);

    const handleReposition = () => updateMenuPosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    window.visualViewport?.addEventListener('resize', handleReposition);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      window.visualViewport?.removeEventListener('resize', handleReposition);
    };
  }, [isOpen]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery, reasons.length]);

  // Close when clicking outside trigger & portal menu without losing selectedReason
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen]);

  // Capture Escape before parent ResponsiveModal closes
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen]);

  const commitSelection = (reason: HierarchicalReason) => {
    onSelectReason(reason);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredReasons.length > 0) {
        setHighlightedIndex(prev => (prev + 1) % filteredReasons.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredReasons.length > 0) {
        setHighlightedIndex(prev => (prev - 1 + filteredReasons.length) % filteredReasons.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredReasons[highlightedIndex];
      if (target) {
        commitSelection(target);
      }
    }
  };

  const displayLabel = selectedReason?.name || selectedReasonName || '';
  const popoverZ = getDynamicPopoverZIndex() + 30;

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || reasons.length === 0}
        onClick={() => {
          if (disabled || reasons.length === 0) return;
          setIsOpen(prev => !prev);
        }}
        data-testid={`${dataTestId}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border text-left text-xs flex items-center justify-between gap-2 transition-all cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed ${tone.focusRing} ${
          selectedReason || displayLabel
            ? tone.triggerSelected
            : 'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#C4B5D6]'
        }`}
      >
        <div className="min-w-0 flex-1">
          {displayLabel ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold truncate">{displayLabel}</span>
              {selectedReason?.code && (
                <span className={`px-1.5 py-0.5 rounded border font-mono text-[9.5px] font-bold shrink-0 ${tone.badge}`}>
                  {selectedReason.code}
                </span>
              )}
            </div>
          ) : (
            <span className="truncate block">{reasons.length === 0 ? emptyOptionsMessage : placeholder}</span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen &&
        menuStyle &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: `${menuStyle.left}px`,
              top: `${menuStyle.top}px`,
              width: `${menuStyle.width}px`,
              zIndex: popoverZ
            }}
            data-testid={`${dataTestId}-menu`}
            onClick={e => e.stopPropagation()}
            className="rounded-2xl border border-[#DDE6F0] dark:border-[#4B386B] bg-white dark:bg-[#190C30] shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Search Box */}
            <div className="p-2.5 border-b border-[#DDE6F0] dark:border-[#35105E] bg-[#F8FAFD] dark:bg-[#160D29] shrink-0">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A79BC0] absolute left-3 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  data-testid={`${dataTestId}-search`}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className={`w-full pl-8 pr-8 py-2 rounded-xl bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none ${tone.focusRing}`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    data-testid={`${dataTestId}-clear`}
                    aria-label="Hapus kata kunci pencarian"
                    className="absolute right-2 p-1 rounded-full text-[#8492A5] hover:text-[#26364A] dark:text-[#A79BC0] dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Filtered Options List */}
            <div
              role="listbox"
              style={{ maxHeight: `${Math.max(120, menuStyle.maxHeight - 58)}px` }}
              className="overflow-y-auto overscroll-contain p-1.5 space-y-1"
            >
              {filteredReasons.length === 0 ? (
                <div
                  data-testid={`${dataTestId}-empty`}
                  className="px-3 py-5 text-center text-xs text-[#8492A5] dark:text-[#A79BC0]"
                >
                  {emptyFilterMessage}
                </div>
              ) : (
                filteredReasons.map((reason, idx) => {
                  const isSelected = selectedReason?.id === reason.id;
                  const isHighlighted = idx === highlightedIndex;
                  const desc = (reason as { description?: string }).description;
                  const metaLine =
                    desc ||
                    (reason.remarks && reason.remarks.length > 0
                      ? `${reason.remarks.length} template catatan tersedia`
                      : reason.code
                      ? `Kode: ${reason.code}`
                      : '');

                  return (
                    <button
                      key={reason.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-testid={`${dataTestId}-option-${reason.id}`}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => commitSelection(reason)}
                      className={`w-full min-h-[44px] px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                        isSelected
                          ? tone.optionSelected
                          : isHighlighted
                          ? 'bg-[#F3F7FB] dark:bg-[#241343] border-[#DCE6F2] dark:border-[#4B386B] text-[#26364A] dark:text-[#f5eeff]'
                          : 'border-transparent text-[#26364A] dark:text-[#E8DDFF] hover:bg-[#F8FAFD] dark:hover:bg-[#241343]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold leading-snug break-words">{reason.name}</div>
                        {metaLine && (
                          <div className="text-[10.5px] opacity-80 truncate mt-0.5">{metaLine}</div>
                        )}
                      </div>
                      {isSelected && <Check className={`w-4 h-4 shrink-0 ${tone.checkIcon}`} />}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
