import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationBarProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize?: number | 'ALL';
  pageSizeOptions?: Array<number | 'ALL'>;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number | 'ALL') => void;
  itemLabel?: string;
  className?: string;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange,
  onPageSizeChange,
  itemLabel = 'data',
  className = ''
}) => {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, currentPage), safeTotalPages);

  const numericSize = typeof pageSize === 'number' ? pageSize : totalItems;
  const startItem = totalItems === 0 ? 0 : (safePage - 1) * numericSize + 1;
  const endItem =
    totalItems === 0
      ? 0
      : pageSize === 'ALL'
      ? totalItems
      : Math.min(safePage * numericSize, totalItems);

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 px-4 py-3 bg-[#EDF3F8]/85 dark:bg-[#160D29] border-t border-[#DDE6F0] dark:border-[#35105E] text-xs ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2.5 text-[#52647A] dark:text-[#CEC0E8]">
        <span className="tabular-nums font-medium">
          Menampilkan <strong className="text-[#26364A] dark:text-white">{startItem}</strong>–
          <strong className="text-[#26364A] dark:text-white">{endItem}</strong> dari{' '}
          <strong className="text-[#5145A6] dark:text-[#DAB9FF]">{totalItems}</strong> {itemLabel}
        </span>

        {onPageSizeChange && pageSize !== undefined && (
          <label className="inline-flex items-center gap-1.5">
            <span className="text-[11px] text-[#8492A5] dark:text-[#A78BFA]">Baris:</span>
            <select
              value={String(pageSize)}
              onChange={e => {
                const raw = e.target.value;
                onPageSizeChange(raw === 'ALL' ? 'ALL' : Number(raw));
              }}
              className="px-2 py-1 min-h-[34px] rounded-lg bg-white dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#4B386B] text-xs font-semibold text-[#26364A] dark:text-white cursor-pointer"
            >
              {pageSizeOptions.map(opt => (
                <option key={String(opt)} value={String(opt)}>
                  {opt === 'ALL' ? 'Semua' : opt}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          aria-label="Halaman Sebelumnya"
          className="btn-3d-secondary inline-flex items-center gap-1 px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Prev</span>
        </button>

        <span className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E] font-mono text-[11px] font-bold text-[#26364A] dark:text-[#F5EEFF] tabular-nums whitespace-nowrap">
          Hal {safePage} / {safeTotalPages}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(Math.min(safeTotalPages, safePage + 1))}
          disabled={safePage >= safeTotalPages}
          aria-label="Halaman Berikutnya"
          className="btn-3d-secondary inline-flex items-center gap-1 px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
