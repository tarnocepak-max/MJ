import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, ArrowUpDown, CheckSquare, Square } from 'lucide-react';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { ActionDropdownMenu, DropdownActionItem } from './ActionDropdownMenu';
import { EmptyState, EmptyStateProps } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PaginationBar, PaginationBarProps } from './PaginationBar';

export interface ResponsiveColumn<T> {
  key: string;
  label: string;
  /** Renders cell in Desktop/Tablet table */
  render: (row: T, index: number) => React.ReactNode;
  /** Optional mobile card rendering override (falls back to `render`) */
  renderMobile?: (row: T, index: number) => React.ReactNode;
  /** Primary fields appear on top of mobile priority card; secondary move into expandable detail */
  priority?: 'primary' | 'secondary' | 'hidden_mobile';
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  thClassName?: string;
  tdClassName?: string;
  /** Applied cleanly inside desktop table without breaking mobile */
  widthClass?: string;
  numeric?: boolean;
}

export interface ResponsiveDataTableProps<T> {
  data: T[];
  columns: ResponsiveColumn<T>[];
  getRowKey: (row: T, index: number) => string;
  /** Loading state */
  isLoading?: boolean;
  /** Empty state configuration */
  emptyState?: Omit<EmptyStateProps, 'compact'>;
  /** Sorting */
  sortKey?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
  onSort?: (key: string) => void;
  /** Selection */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  onToggleSelectAll?: () => void;
  /** Mobile Priority Card configuration */
  mobileTitle: (row: T) => React.ReactNode;
  mobileSubtitle?: (row: T) => React.ReactNode;
  mobileStatus?: (row: T) => React.ReactNode;
  /** Row interaction & actions */
  onRowClick?: (row: T) => void;
  getRowActions?: (row: T) => DropdownActionItem[];
  renderDesktopActions?: (row: T) => React.ReactNode;
  desktopActionHeader?: string;
  /** Desktop sticky header & max-height scroll container */
  stickyHeader?: boolean;
  maxTableHeightClass?: string;
  /** Pagination bar below table/cards */
  pagination?: PaginationBarProps;
  /** Row className override */
  getRowClassName?: (row: T, index: number) => string;
  /** Force cards or table regardless of breakpoint */
  layoutMode?: 'auto' | 'table' | 'cards';
  className?: string;
}

export function ResponsiveDataTable<T>({
  data,
  columns,
  getRowKey,
  isLoading = false,
  emptyState,
  sortKey,
  sortDirection,
  onSort,
  selectable = false,
  selectedKeys,
  onToggleSelect,
  onToggleSelectAll,
  mobileTitle,
  mobileSubtitle,
  mobileStatus,
  onRowClick,
  getRowActions,
  renderDesktopActions,
  desktopActionHeader = 'Aksi',
  stickyHeader = true,
  maxTableHeightClass = 'max-h-[600px]',
  pagination,
  getRowClassName,
  layoutMode = 'auto',
  className = ''
}: ResponsiveDataTableProps<T>) {
  const { isCompactUI } = useResponsiveViewport();
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const useCardLayout = layoutMode === 'cards' || (layoutMode === 'auto' && isCompactUI);

  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (isLoading) {
    return <LoadingSkeleton variant={useCardLayout ? 'cards' : 'table'} rows={5} className={className} />;
  }

  if (data.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          title={emptyState?.title || 'Belum ada data ditemukan'}
          description={emptyState?.description || 'Ubah filter pencarian atau tambahkan data baru.'}
          actionLabel={emptyState?.actionLabel}
          onAction={emptyState?.onAction}
          secondaryAction={emptyState?.secondaryAction}
          icon={emptyState?.icon}
        />
      </div>
    );
  }

  const primaryColumns = columns.filter(c => c.priority === 'primary');
  const secondaryColumns = columns.filter(c => c.priority !== 'primary' && c.priority !== 'hidden_mobile');
  const hasActionsColumn = Boolean(renderDesktopActions || getRowActions);
  const allSelected =
    selectable && selectedKeys && data.length > 0 && data.every((row, idx) => selectedKeys.has(getRowKey(row, idx)));

  return (
    <div
      className={`bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden ${className}`}
    >
      {useCardLayout ? (
        /* MOBILE PRIORITY CARDS WITH EXPANDABLE DETAILS & DROPDOWN ACTIONS */
        <div className="p-3 space-y-2.5 bg-slate-50 dark:bg-[#0B1220]">
          {selectable && onToggleSelectAll && (
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 text-xs">
              <button
                type="button"
                onClick={onToggleSelectAll}
                className="inline-flex items-center gap-2 font-bold text-[#2563EB] dark:text-[#38BDF8] min-h-[42px] px-1 cursor-pointer"
              >
                {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 opacity-70" />}
                <span>{allSelected ? 'Batalkan Pilih Semua' : 'Pilih Semua Halaman Ini'}</span>
              </button>
              <span className="font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                {selectedKeys?.size || 0} dipilih
              </span>
            </div>
          )}

          {data.map((row, index) => {
            const key = getRowKey(row, index);
            const isSelected = Boolean(selectedKeys?.has(key));
            const isExpanded = Boolean(expandedKeys[key]);
            const actions = getRowActions ? getRowActions(row) : [];

            return (
              <article
                key={key}
                onClick={() => onRowClick?.(row)}
                className={`bg-white dark:bg-[#0F172A] rounded-xl border p-3.5 transition-all space-y-3 ${
                  isSelected
                    ? 'border-[#2563EB] ring-2 ring-[#2563EB]/20'
                    : 'border-slate-200 dark:border-slate-800'
                } ${onRowClick ? 'cursor-pointer active:scale-[0.995]' : ''}`}
              >
                {/* Card Header Row: Checkbox + Title/Subtitle + Status + Action Dropdown */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {selectable && onToggleSelect && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onToggleSelect(key);
                        }}
                        aria-label="Pilih item"
                        className="min-w-[44px] min-h-[44px] -ml-1.5 -mt-1.5 flex items-center justify-center text-[#2563EB] dark:text-[#38BDF8] cursor-pointer shrink-0"
                      >
                        {isSelected ? <CheckSquare className="w-4.5 h-4.5" /> : <Square className="w-4.5 h-4.5 opacity-60" />}
                      </button>
                    )}

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white leading-snug break-words">
                        {mobileTitle(row)}
                      </div>
                      {mobileSubtitle && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug break-words">
                          {mobileSubtitle(row)}
                        </div>
                      )}
                      {mobileStatus && <div className="pt-0.5 flex flex-wrap gap-1.5">{mobileStatus(row)}</div>}
                    </div>
                  </div>

                  {actions.length > 0 && <ActionDropdownMenu actions={actions} size="md" />}
                </div>

                {/* Primary Highlights Grid */}
                {primaryColumns.length > 0 && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                    {primaryColumns.map(col => (
                      <div key={col.key} className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {col.label}
                        </div>
                        <div className={`mt-0.5 text-slate-900 dark:text-slate-100 font-medium break-words ${col.numeric ? 'font-mono tabular-nums' : ''}`}>
                          {col.renderMobile ? col.renderMobile(row, index) : col.render(row, index)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Secondary Columns inside Expandable Accordion */}
                {secondaryColumns.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        toggleExpand(key);
                      }}
                      aria-expanded={isExpanded}
                      className="w-full min-h-[42px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#1E293B] hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px] font-bold text-[#2563EB] dark:text-[#38BDF8] cursor-pointer transition-colors"
                    >
                      <span>{isExpanded ? 'Tutup Detail Tambahan' : `Lihat ${secondaryColumns.length} Detail Lainnya`}</span>
                      {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                    </button>

                    {isExpanded && (
                      <div className="mt-2.5 pt-2.5 border-t border-dashed border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
                        {secondaryColumns.map(col => (
                          <div key={col.key} className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              {col.label}
                            </div>
                            <div className={`mt-0.5 text-slate-900 dark:text-slate-100 break-words ${col.numeric ? 'font-mono tabular-nums' : ''}`}>
                              {col.renderMobile ? col.renderMobile(row, index) : col.render(row, index)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        /* DESKTOP & TABLET STICKY-HEADER RESPONSIVE TABLE */
        <div className={`overflow-x-auto ${maxTableHeightClass}`}>
          <table className="w-full text-left border-collapse text-xs">
            <thead
              className={`${
                stickyHeader ? 'sticky top-0 z-10' : ''
              } bg-slate-50 dark:bg-[#1E293B] text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide border-b border-slate-200 dark:border-slate-800`}
            >
              <tr>
                {selectable && (
                  <th className="py-2.5 px-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={onToggleSelectAll}
                      aria-label="Pilih semua baris"
                      className="text-[#2563EB] dark:text-[#38BDF8] cursor-pointer inline-flex items-center justify-center"
                    >
                      {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 opacity-70" />}
                    </button>
                  </th>
                )}
                {columns.map(col => {
                  const isSorted = sortKey === col.key && Boolean(sortDirection);
                  const alignClass =
                    col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left';

                  return (
                    <th
                      key={col.key}
                      className={`py-2.5 px-3 whitespace-nowrap ${alignClass} ${col.widthClass || ''} ${col.thClassName || ''}`}
                    >
                      {col.sortable && onSort ? (
                        <button
                          type="button"
                          onClick={() => onSort(col.key)}
                          className={`inline-flex items-center gap-1 cursor-pointer hover:text-[#2563EB] dark:hover:text-white transition-colors ${
                            isSorted ? 'text-[#2563EB] dark:text-[#38BDF8] font-extrabold' : ''
                          }`}
                        >
                          <span>{col.label}</span>
                          {isSorted && sortDirection === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5" />
                          ) : isSorted && sortDirection === 'desc' ? (
                            <ArrowDown className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-50" />
                          )}
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  );
                })}
                {hasActionsColumn && (
                  <th className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 z-20 bg-slate-50 dark:bg-[#1E293B] shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.04)]">
                    {desktopActionHeader}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((row, index) => {
                const key = getRowKey(row, index);
                const isSelected = Boolean(selectedKeys?.has(key));
                const actions = getRowActions ? getRowActions(row) : [];

                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick?.(row)}
                    className={`transition-colors hover:bg-slate-50/90 dark:hover:bg-[#1E293B]/70 ${
                      isSelected ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'bg-white dark:bg-[#0F172A]'
                    } ${onRowClick ? 'cursor-pointer' : ''} ${getRowClassName ? getRowClassName(row, index) : ''}`}
                  >
                    {selectable && (
                      <td
                        className="py-2.5 px-3 text-center"
                        onClick={e => {
                          e.stopPropagation();
                          onToggleSelect?.(key);
                        }}
                      >
                        <button
                          type="button"
                          aria-label="Pilih baris"
                          className="text-[#2563EB] dark:text-[#38BDF8] cursor-pointer inline-flex items-center justify-center"
                        >
                          {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 opacity-60" />}
                        </button>
                      </td>
                    )}
                    {columns.map(col => {
                      const alignClass =
                        col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left';
                      return (
                        <td
                          key={col.key}
                          className={`py-2.5 px-3 ${alignClass} ${col.numeric ? 'font-mono tabular-nums' : ''} ${
                            col.tdClassName || ''
                          }`}
                        >
                          {col.render(row, index)}
                        </td>
                      );
                    })}
                    {hasActionsColumn && (
                      <td
                        className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 z-10 bg-inherit shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.03)]"
                        onClick={e => e.stopPropagation()}
                      >
                        {renderDesktopActions ? (
                          renderDesktopActions(row)
                        ) : (
                          <ActionDropdownMenu actions={actions} size="sm" />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <PaginationBar {...pagination} />}
    </div>
  );
}
