import React from 'react';
import { CheckSquare, X } from 'lucide-react';

export interface TableSelectionToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  label?: string;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Contextual Bulk Selection Bar.
 * Strictly renders ONLY when selectedCount > 0 on the active page.
 */
export const TableSelectionToolbar: React.FC<TableSelectionToolbarProps> = ({
  selectedCount,
  onClearSelection,
  label = 'item terpilih',
  children,
  className = '',
  testId
}) => {
  if (selectedCount <= 0) return null;

  return (
    <div
      data-testid={testId || 'table-selection-toolbar'}
      className={`flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-2xl bg-[#EAE8F8]/95 border border-[#C5BEEF] text-[#26394E] shadow-xs dark:bg-[#231144]/95 dark:border-[#5B289B] dark:text-[#EEE5FF] animate-in fade-in duration-150 ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/90 dark:bg-[#351768] border border-[#D4CCF2] dark:border-[#6F3BBF] text-xs font-extrabold text-[#5145A6] dark:text-white tabular-nums shrink-0">
          <CheckSquare className="w-3.5 h-3.5 shrink-0" />
          <span>{selectedCount}</span>
        </span>
        <span className="text-xs font-semibold truncate">{label}</span>
        <button
          type="button"
          onClick={onClearSelection}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-[#52647A] hover:text-[#26394E] hover:bg-white/70 dark:text-[#C4B5FD] dark:hover:text-white dark:hover:bg-white/10 cursor-pointer transition-colors"
        >
          <X className="w-3 h-3" />
          <span>Batal Pilih</span>
        </button>
      </div>

      {children && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {children}
        </div>
      )}
    </div>
  );
};
