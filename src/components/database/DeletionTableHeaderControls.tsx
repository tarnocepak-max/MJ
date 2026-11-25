import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Calendar,
  X,
  Check
} from 'lucide-react';

interface PopoverAnchorState {
  top: number;
  left: number;
  width: number;
}

function computeClampedPopoverPosition(
  anchorEl: HTMLElement | null,
  desiredWidth: number,
  estimatedHeight = 220
): PopoverAnchorState {
  if (!anchorEl || typeof window === 'undefined') {
    return { top: 120, left: 16, width: desiredWidth };
  }
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxWidth = Math.min(desiredWidth, vw - 16);
  let left = rect.left;
  if (left + maxWidth > vw - 8) {
    left = vw - maxWidth - 8;
  }
  if (left < 8) left = 8;

  let top = rect.bottom + 6;
  if (top + estimatedHeight > vh - 12 && rect.top - estimatedHeight - 6 > 8) {
    top = rect.top - estimatedHeight - 6;
  }
  return { top, left, width: maxWidth };
}

function useHeaderPopover(desiredWidth: number, estimatedHeight = 220) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PopoverAnchorState>({ top: 0, left: 0, width: desiredWidth });

  const updatePos = useCallback(() => {
    setPos(computeClampedPopoverPosition(triggerRef.current, desiredWidth, estimatedHeight));
  }, [desiredWidth, estimatedHeight]);

  useEffect(() => {
    if (!open) return;
    updatePos();

    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    const handleViewportChange = () => updatePos();

    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePos]);

  return { open, setOpen, triggerRef, popoverRef, pos };
}

export interface HeaderSearchPopoverProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  testId?: string;
}

export const HeaderSearchPopover: React.FC<HeaderSearchPopoverProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Cari...',
  testId
}) => {
  const { open, setOpen, triggerRef, popoverRef, pos } = useHeaderPopover(256, 130);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isActive = value.trim().length > 0;

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  return (
    <div className="inline-flex items-center gap-1 min-w-0">
      <span className="truncate">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId ? `${testId}-trigger` : undefined}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`Cari ${label}`}
        title={isActive ? `Filter aktif: ${value}` : `Cari ${label}`}
        className={`relative inline-flex items-center justify-center w-[22px] h-[22px] rounded-md transition-all cursor-pointer shrink-0 border ${
          isActive || open
            ? 'bg-[#EAE8FF] border-[#8B7FE8] text-[#5145A6] dark:bg-[#4A2580] dark:border-[#9353D3] dark:text-white shadow-xs'
            : 'bg-white/75 border-[#D6E3EE] text-[#64748B] hover:text-[#5145A6] hover:border-[#A89FE8] dark:bg-[#1E1038]/80 dark:border-[#3D1D6E] dark:text-[#C4B5FD] dark:hover:text-white'
        }`}
      >
        <Search className="w-3 h-3" />
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#6657C8] dark:bg-[#38BDF8] ring-2 ring-white dark:ring-[#22123F]"
          />
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={`Pencarian kolom ${label}`}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[90] p-3 rounded-2xl bg-white/95 backdrop-blur-xl border border-[#C5BEEF] shadow-xl dark:bg-[#1C0E35]/98 dark:border-[#5B289B] text-xs normal-case tracking-normal font-normal"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <label
                htmlFor={`hdr-search-${testId || label}`}
                className="font-bold text-[11px] text-[#26394E] dark:text-[#E8DDFF] uppercase tracking-wider"
              >
                Cari {label}
              </label>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={`Tutup pencarian ${label}`}
                className="p-1 rounded-lg text-[#64748B] hover:text-[#26394E] dark:text-[#A78BFA] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A78BFA] absolute left-2.5 pointer-events-none" />
              <input
                ref={inputRef}
                id={`hdr-search-${testId || label}`}
                data-testid={testId ? `${testId}-input` : undefined}
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') setOpen(false);
                }}
                placeholder={placeholder}
                className="tactile-debossed-input w-full pl-8 pr-7 py-2 rounded-xl text-xs text-[#26394E] dark:text-white"
              />
              {isActive && (
                <button
                  type="button"
                  data-testid={testId ? `${testId}-clear` : undefined}
                  onClick={() => onChange('')}
                  aria-label={`Hapus pencarian ${label}`}
                  className="absolute right-2 p-0.5 rounded text-[#64748B] hover:text-rose-600 dark:text-[#C4B5FD] dark:hover:text-rose-300 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px] text-[#64748B] dark:text-[#A78BFA]">
              <span>Partial match · A/a</span>
              {isActive && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="font-bold text-rose-600 dark:text-rose-300 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export interface CategoryOptionItem {
  value: string;
  label: string;
}

export interface HeaderCategoryDropdownProps {
  label: string;
  value: string;
  defaultValue?: string;
  allLabel?: string;
  options: CategoryOptionItem[];
  onChange: (val: string) => void;
  testId?: string;
}

export const HeaderCategoryDropdown: React.FC<HeaderCategoryDropdownProps> = ({
  label,
  value,
  defaultValue = 'all',
  allLabel = 'Semua',
  options,
  onChange,
  testId
}) => {
  const { open, setOpen, triggerRef, popoverRef, pos } = useHeaderPopover(240, 260);
  const [optionQuery, setOptionQuery] = useState('');
  const isActive = value !== defaultValue;

  useEffect(() => {
    if (!open) setOptionQuery('');
  }, [open]);

  const filteredOptions = optionQuery.trim()
    ? options.filter(o => o.label.toLowerCase().includes(optionQuery.trim().toLowerCase()))
    : options;

  return (
    <div className="inline-flex items-center gap-1 min-w-0">
      <span className="truncate">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId ? `${testId}-trigger` : undefined}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`Filter ${label}`}
        title={isActive ? `Filter aktif: ${options.find(o => o.value === value)?.label || value}` : `Pilih ${label}`}
        className={`relative inline-flex items-center justify-center w-[22px] h-[22px] rounded-md transition-all cursor-pointer shrink-0 border ${
          isActive || open
            ? 'bg-[#D8F0F0] border-[#6EB5B5] text-[#1D5C63] dark:bg-[#4A2580] dark:border-[#9353D3] dark:text-white shadow-xs'
            : 'bg-white/75 border-[#D6E3EE] text-[#64748B] hover:text-[#5145A6] hover:border-[#A89FE8] dark:bg-[#1E1038]/80 dark:border-[#3D1D6E] dark:text-[#C4B5FD] dark:hover:text-white'
        }`}
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#0D9488] dark:bg-[#38BDF8] ring-2 ring-white dark:ring-[#22123F]"
          />
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={`Pilihan filter ${label}`}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[90] p-2.5 rounded-2xl bg-white/95 backdrop-blur-xl border border-[#C5BEEF] shadow-xl dark:bg-[#1C0E35]/98 dark:border-[#5B289B] text-xs normal-case tracking-normal font-normal"
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-2 border-b border-[#E6EEF6] dark:border-[#35105E]">
              <span className="font-bold text-[11px] text-[#26394E] dark:text-[#E8DDFF] uppercase tracking-wider">
                {label}
              </span>
              {isActive && (
                <button
                  type="button"
                  data-testid={testId ? `${testId}-clear` : undefined}
                  onClick={() => {
                    onChange(defaultValue);
                    setOpen(false);
                  }}
                  className="text-[10.5px] font-bold text-rose-600 dark:text-rose-300 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {options.length > 8 && (
              <div className="pt-2 pb-1">
                <input
                  type="text"
                  value={optionQuery}
                  onChange={e => setOptionQuery(e.target.value)}
                  placeholder={`Saring opsi ${label}...`}
                  aria-label={`Saring opsi ${label}`}
                  className="tactile-debossed-input w-full px-2.5 py-1.5 rounded-xl text-[11px] text-[#26394E] dark:text-white"
                />
              </div>
            )}

            <div className="mt-1.5 max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
              {defaultValue === 'all' && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('all');
                    setOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-xl text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    value === 'all'
                      ? 'bg-[#EAE8FF] text-[#5145A6] font-bold dark:bg-[#4A2580] dark:text-white'
                      : 'text-[#26394E] dark:text-[#D9CCF2] hover:bg-[#F3F8FC] dark:hover:bg-[#2A174B]'
                  }`}
                >
                  <span className="truncate">{allLabel}</span>
                  {value === 'all' && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )}

              {filteredOptions.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-[#64748B] dark:text-[#A78BFA]">
                  Tidak ada opsi tersedia
                </div>
              ) : (
                filteredOptions.map(opt => {
                  const selected = value === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-xl text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#EAE8FF] text-[#5145A6] font-bold dark:bg-[#4A2580] dark:text-white'
                          : 'text-[#26394E] dark:text-[#D9CCF2] hover:bg-[#F3F8FC] dark:hover:bg-[#2A174B]'
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
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

export interface HeaderDateSortFilterPopoverProps {
  label: string;
  sortActive: boolean;
  sortDir: 'asc' | 'desc';
  onCycleSort: () => void;
  exactDate: string;
  dateFrom: string;
  dateTo: string;
  onChangeDates: (next: { exactDate: string; dateFrom: string; dateTo: string }) => void;
  supportsExactDate?: boolean;
  testId?: string;
}

export const HeaderDateSortFilterPopover: React.FC<HeaderDateSortFilterPopoverProps> = ({
  label,
  sortActive,
  sortDir,
  onCycleSort,
  exactDate,
  dateFrom,
  dateTo,
  onChangeDates,
  supportsExactDate = true,
  testId
}) => {
  const { open, setOpen, triggerRef, popoverRef, pos } = useHeaderPopover(276, 230);
  const [rangeMode, setRangeMode] = useState<'exact' | 'range'>(() =>
    !supportsExactDate || dateFrom || dateTo ? 'range' : 'exact'
  );

  useEffect(() => {
    if (!supportsExactDate) setRangeMode('range');
    else if (dateFrom || dateTo) setRangeMode('range');
  }, [supportsExactDate, dateFrom, dateTo]);

  const hasDateFilter = Boolean(exactDate || dateFrom || dateTo);

  const sortTitle = !sortActive
    ? `Urutkan ${label} (Default — klik untuk Naik)`
    : sortDir === 'asc'
    ? `Urutan ${label}: Ascending (Terlama → Terbaru)`
    : `Urutan ${label}: Descending (Terbaru → Terlama)`;

  return (
    <div className="inline-flex items-center gap-1 min-w-0">
      <button
        type="button"
        data-testid={testId ? `${testId}-sort` : undefined}
        onClick={onCycleSort}
        aria-label={sortTitle}
        title={sortTitle}
        className={`inline-flex items-center gap-1 px-1 py-0.5 -ml-1 rounded-lg transition-colors cursor-pointer uppercase tracking-tight font-extrabold text-[10.5px] ${
          sortActive
            ? 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#4A2580] dark:text-white'
            : 'hover:bg-white/70 dark:hover:bg-[#2E1954] text-inherit'
        }`}
      >
        <span className="truncate">{label}</span>
        {!sortActive ? (
          <ArrowUpDown className="w-3 h-3 opacity-60 shrink-0" />
        ) : sortDir === 'asc' ? (
          <ArrowUp className="w-3 h-3 text-[#5145A6] dark:text-[#38BDF8] shrink-0" />
        ) : (
          <ArrowDown className="w-3 h-3 text-[#5145A6] dark:text-[#38BDF8] shrink-0" />
        )}
      </button>

      <button
        ref={triggerRef}
        type="button"
        data-testid={testId ? `${testId}-date-trigger` : undefined}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`Filter tanggal ${label}`}
        title={hasDateFilter ? `Filter tanggal aktif` : `Filter tanggal ${label}`}
        className={`relative inline-flex items-center justify-center w-[22px] h-[22px] rounded-md transition-all cursor-pointer shrink-0 border ${
          hasDateFilter || open
            ? 'bg-[#D8F0F0] border-[#6EB5B5] text-[#1D5C63] dark:bg-[#4A2580] dark:border-[#9353D3] dark:text-white shadow-xs'
            : 'bg-white/75 border-[#D6E3EE] text-[#64748B] hover:text-[#5145A6] hover:border-[#A89FE8] dark:bg-[#1E1038]/80 dark:border-[#3D1D6E] dark:text-[#C4B5FD] dark:hover:text-white'
        }`}
      >
        <Calendar className="w-3 h-3" />
        {hasDateFilter && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#0D9488] dark:bg-[#38BDF8] ring-2 ring-white dark:ring-[#22123F]"
          />
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={`Filter tanggal ${label}`}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[90] p-3 rounded-2xl bg-white/95 backdrop-blur-xl border border-[#C5BEEF] shadow-xl dark:bg-[#1C0E35]/98 dark:border-[#5B289B] text-xs normal-case tracking-normal font-normal space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[11px] text-[#26394E] dark:text-[#E8DDFF] uppercase tracking-wider">
                Filter {label}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={`Tutup filter tanggal ${label}`}
                className="p-1 rounded-lg text-[#64748B] hover:text-[#26394E] dark:text-[#A78BFA] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {supportsExactDate && (
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#EDF3F8] dark:bg-[#160D29]">
                <button
                  type="button"
                  onClick={() => {
                    setRangeMode('exact');
                    onChangeDates({ exactDate, dateFrom: '', dateTo: '' });
                  }}
                  className={`py-1 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                    rangeMode === 'exact'
                      ? 'bg-white text-[#5145A6] shadow-xs dark:bg-[#4A2580] dark:text-white'
                      : 'text-[#64748B] dark:text-[#A78BFA]'
                  }`}
                >
                  Tanggal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRangeMode('range');
                    onChangeDates({ exactDate: '', dateFrom, dateTo });
                  }}
                  className={`py-1 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                    rangeMode === 'range'
                      ? 'bg-white text-[#5145A6] shadow-xs dark:bg-[#4A2580] dark:text-white'
                      : 'text-[#64748B] dark:text-[#A78BFA]'
                  }`}
                >
                  Rentang
                </button>
              </div>
            )}

            {rangeMode === 'exact' && supportsExactDate ? (
              <div>
                <label
                  htmlFor={`hdr-date-exact-${testId || label}`}
                  className="block text-[10.5px] font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1"
                >
                  Pilih Tanggal
                </label>
                <input
                  id={`hdr-date-exact-${testId || label}`}
                  data-testid={testId ? `${testId}-exact-input` : undefined}
                  type="date"
                  value={exactDate}
                  onChange={e => onChangeDates({ exactDate: e.target.value, dateFrom: '', dateTo: '' })}
                  className="tactile-debossed-input w-full px-2.5 py-1.5 rounded-xl text-xs text-[#26394E] dark:text-white font-mono"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <label
                    htmlFor={`hdr-date-from-${testId || label}`}
                    className="block text-[10.5px] font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1"
                  >
                    Dari Tanggal
                  </label>
                  <input
                    id={`hdr-date-from-${testId || label}`}
                    data-testid={testId ? `${testId}-from-input` : undefined}
                    type="date"
                    value={dateFrom}
                    onChange={e => onChangeDates({ exactDate: '', dateFrom: e.target.value, dateTo })}
                    className="tactile-debossed-input w-full px-2.5 py-1.5 rounded-xl text-xs text-[#26394E] dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`hdr-date-to-${testId || label}`}
                    className="block text-[10.5px] font-semibold text-[#52647A] dark:text-[#CEC0E8] mb-1"
                  >
                    Sampai Tanggal
                  </label>
                  <input
                    id={`hdr-date-to-${testId || label}`}
                    data-testid={testId ? `${testId}-to-input` : undefined}
                    type="date"
                    value={dateTo}
                    onChange={e => onChangeDates({ exactDate: '', dateFrom, dateTo: e.target.value })}
                    className="tactile-debossed-input w-full px-2.5 py-1.5 rounded-xl text-xs text-[#26394E] dark:text-white font-mono"
                  />
                </div>
              </div>
            )}

            <div className="pt-1 flex items-center justify-between gap-2 text-[10.5px]">
              <span className="text-[#64748B] dark:text-[#A78BFA]">
                {sortActive ? `Sort: ${sortDir.toUpperCase()} (NULL akhir)` : 'Klik judul untuk sort'}
              </span>
              {hasDateFilter && (
                <button
                  type="button"
                  data-testid={testId ? `${testId}-clear` : undefined}
                  onClick={() => {
                    onChangeDates({ exactDate: '', dateFrom: '', dateTo: '' });
                    setOpen(false);
                  }}
                  className="font-bold text-rose-600 dark:text-rose-300 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
