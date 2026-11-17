import React, { useState } from 'react';
import { Search, SlidersHorizontal, X, RotateCcw, ChevronDown } from 'lucide-react';

export interface FilterToolbarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  activeFilterCount?: number;
  onResetFilters?: () => void;
  /** Primary action buttons (e.g. Export, Tambah, Bulk Actions) */
  actions?: React.ReactNode;
  /** Filter inputs (dropdowns, date pickers, status chips) */
  children?: React.ReactNode;
  /** Default collapsed on mobile when many filters exist */
  defaultMobileFiltersOpen?: boolean;
  className?: string;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Cari data...',
  activeFilterCount = 0,
  onResetFilters,
  actions,
  children,
  defaultMobileFiltersOpen = false,
  className = ''
}) => {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(defaultMobileFiltersOpen);
  const hasFiltersSlot = Boolean(children);

  return (
    <div
      className={`bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#35105E] rounded-2xl p-3 sm:p-4 shadow-xs space-y-3 ${className}`}
    >
      {/* Top Row: Search + Mobile Filter Toggle + Right Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {onSearchChange && (
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-[#7D7484] dark:text-[#A78BFA] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchValue}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full pl-9 pr-9 py-2 min-h-[42px] sm:min-h-[38px] bg-[#F8F1FF] dark:bg-[#160D29] border border-[#CEC3D4] dark:border-[#4B386B] rounded-xl text-xs text-[#1F1638] dark:text-white placeholder:text-[#7D7484] focus:outline-none focus:ring-2 focus:ring-[#7135B5]/40 focus:border-[#7135B5] transition-all"
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Bersihkan pencarian"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#7D7484] hover:text-[#1F1638] dark:hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {hasFiltersSlot && (
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(prev => !prev)}
              aria-expanded={mobileFiltersOpen}
              className={`lg:hidden btn-3d-secondary inline-flex items-center gap-1.5 px-3 min-h-[42px] rounded-xl text-xs font-bold cursor-pointer shrink-0 ${
                activeFilterCount > 0 ? 'border-[#7135B5] text-[#58149C] dark:text-[#DAB9FF]' : ''
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#58149C] text-white text-[10px] font-mono tabular-nums">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>

        {(actions || (onResetFilters && activeFilterCount > 0)) && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onResetFilters && activeFilterCount > 0 && (
              <button
                type="button"
                onClick={onResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl bg-rose-50 hover:bg-rose-100 text-[#BA1A1A] dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset ({activeFilterCount})</span>
              </button>
            )}
            {actions}
          </div>
        )}
      </div>

      {/* Filters Grid: Always visible on Desktop (>=1024px), toggleable on Mobile/Tablet */}
      {hasFiltersSlot && (
        <div
          className={`${
            mobileFiltersOpen ? 'grid' : 'hidden lg:grid'
          } grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2.5 pt-2.5 border-t border-[#E8DDFF] dark:border-[#35105E]`}
        >
          {children}
        </div>
      )}
    </div>
  );
};
