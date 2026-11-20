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
      className={`bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs space-y-3 ${className}`}
    >
      {/* Top Row: Search + Mobile Filter Toggle + Right Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {onSearchChange && (
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchValue}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full pl-9 pr-10 py-2 min-h-[44px] sm:min-h-[40px] bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-[#2563EB] transition-all"
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Bersihkan pencarian"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white cursor-pointer"
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
              className={`lg:hidden inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl text-xs font-bold cursor-pointer shrink-0 border transition-colors ${
                activeFilterCount > 0
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-[#2563EB] text-[#2563EB] dark:text-[#38BDF8]'
                  : 'bg-slate-50 dark:bg-[#1E293B] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#2563EB] text-white text-[10px] font-mono tabular-nums">
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
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-bold cursor-pointer whitespace-nowrap"
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
          } grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2.5 pt-2.5 border-t border-slate-200 dark:border-slate-800`}
        >
          {children}
        </div>
      )}
    </div>
  );
};
