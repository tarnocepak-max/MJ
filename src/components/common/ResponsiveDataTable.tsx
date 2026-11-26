import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, ArrowUpDown, CheckSquare, Square } from 'lucide-react';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { ActionDropdownMenu, DropdownActionItem } from './ActionDropdownMenu';
import { EmptyState, EmptyStateProps } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { PaginationBar, PaginationBarProps } from './PaginationBar';
import {
  CategoryOptionItem,
  HeaderCategoryDropdown,
  HeaderDateSortFilterPopover,
  HeaderSearchPopover,
  HeaderSortButton,
  TableResetFilterButton
} from './InteractiveTableHeader';

export type ResponsiveColumnHeaderControl =
  | {
      kind: 'search';
      value: string;
      onChange: (val: string) => void;
      placeholder?: string;
      testId?: string;
    }
  | {
      kind: 'select';
      value: string;
      defaultValue?: string;
      allLabel?: string;
      options: CategoryOptionItem[];
      onChange: (val: string) => void;
      testId?: string;
    }
  | {
      kind: 'date';
      exactDate: string;
      dateFrom: string;
      dateTo: string;
      onChangeDates: (next: { exactDate: string; dateFrom: string; dateTo: string }) => void;
      supportsExactDate?: boolean;
      testId?: string;
    }
  | {
      kind: 'custom';
      render: () => React.ReactNode;
    };

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
  /** Embedded header search / category dropdown / date popover */
  headerControl?: ResponsiveColumnHeaderControl;
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
  /** Contextual selection toolbar shown when >= 1 rows selected */
  selectionToolbar?: React.ReactNode;
  /** Compact reset filter control */
  activeFilterCount?: number;
  onResetFilters?: () => void;
  resetLabel?: string;
  /** Optional extra top-right inline action slot (e.g. Export button) */
  headerActions?: React.ReactNode;
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
  selectionToolbar,
  activeFilterCount = 0,
  onResetFilters,
  resetLabel = 'Reset Search/Filter',
  headerActions,
  mobileTitle,
  mobileSubtitle,
  mobileStatus,
  onRowClick,
  getRowActions,
  renderDesktopActions,
  desktopActionHeader = 'ACTION',
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

  const renderColumnHeader = (col: ResponsiveColumn<T>) => {
    const isSorted = sortKey === col.key && Boolean(sortDirection);
    const activeDir = isSorted && sortDirection ? sortDirection : null;
    const cycleSort = col.sortable && onSort ? () => onSort(col.key) : undefined;
    const ctrl = col.headerControl;

    if (ctrl) {
      if (ctrl.kind === 'search') {
        return (
          <HeaderSearchPopover
            label={col.label}
            value={ctrl.value}
            onChange={ctrl.onChange}
            placeholder={ctrl.placeholder}
            testId={ctrl.testId}
            sortActive={isSorted}
            sortDir={activeDir}
            onCycleSort={cycleSort}
          />
        );
      }
      if (ctrl.kind === 'select') {
        return (
          <HeaderCategoryDropdown
            label={col.label}
            value={ctrl.value}
            defaultValue={ctrl.defaultValue}
            allLabel={ctrl.allLabel}
            options={ctrl.options}
            onChange={ctrl.onChange}
            testId={ctrl.testId}
            sortActive={isSorted}
            sortDir={activeDir}
            onCycleSort={cycleSort}
          />
        );
      }
      if (ctrl.kind === 'date') {
        return (
          <HeaderDateSortFilterPopover
            label={col.label}
            sortActive={isSorted}
            sortDir={activeDir}
            onCycleSort={cycleSort || (() => {})}
            exactDate={ctrl.exactDate}
            dateFrom={ctrl.dateFrom}
            dateTo={ctrl.dateTo}
            onChangeDates={ctrl.onChangeDates}
            supportsExactDate={ctrl.supportsExactDate}
            testId={ctrl.testId}
          />
        );
      }
      if (ctrl.kind === 'custom') {
        return ctrl.render();
      }
    }

    if (cycleSort) {
      return (
        <HeaderSortButton
          label={col.label}
          sortActive={isSorted}
          sortDir={activeDir}
          onCycleSort={cycleSort}
        />
      );
    }

    return <span>{col.label}</span>;
  };

  if (isLoading) {
    return <LoadingSkeleton variant={useCardLayout ? 'cards' : 'table'} rows={5} className={className} />;
  }

  const interactiveCols = columns.filter(c => Boolean(c.headerControl) || (c.sortable && Boolean(onSort)));
  const primaryColumns = columns.filter(c => c.priority === 'primary');
  const secondaryColumns = columns.filter(c => c.priority !== 'primary' && c.priority !== 'hidden_mobile');
  const hasActionsColumn = Boolean(renderDesktopActions || getRowActions);
  const allSelected =
    selectable && selectedKeys && data.length > 0 && data.every((row, idx) => selectedKeys.has(getRowKey(row, idx)));

  const hasTopBar = Boolean(selectionToolbar || (onResetFilters && activeFilterCount > 0) || headerActions);

  return (
    <div className={`space-y-2.5 ${className}`}>
      {hasTopBar && (
        <div className="space-y-2">
          {((onResetFilters && activeFilterCount > 0) || headerActions) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {onResetFilters && (
                  <TableResetFilterButton
                    activeCount={activeFilterCount}
                    onReset={onResetFilters}
                    label={resetLabel}
                  />
                )}
              </div>
              {headerActions && <div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
            </div>
          )}
          {selectionToolbar}
        </div>
      )}

      <div className="bg-white/88 dark:bg-[#0F172A] backdrop-blur-xl border border-[#DDE6F0] dark:border-slate-800 rounded-2xl shadow-[0_12px_28px_-10px_rgba(38,54,74,0.08)] dark:shadow-xs overflow-hidden">
        {useCardLayout ? (
          /* MOBILE PRIORITY CARDS WITH HEADER FILTER/SORT STRIP & EXPANDABLE DETAILS */
          <div className="p-3 space-y-2.5 bg-[#F4F7FB]/80 dark:bg-[#0B1220]">
            {interactiveCols.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {interactiveCols.map(col => (
                  <div
                    key={col.key}
                    className="shrink-0 inline-flex items-center px-2 py-1 rounded-xl bg-white/95 dark:bg-[#0F172A] border border-[#DDE6F0] dark:border-slate-800 text-[10.5px] font-bold text-[#52647A] dark:text-slate-300"
                  >
                    {renderColumnHeader(col)}
                  </div>
                ))}
              </div>
            )}

            {selectable && onToggleSelectAll && data.length > 0 && (
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#0F172A] border border-[#DDE6F0] dark:border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={onToggleSelectAll}
                  className="inline-flex items-center gap-2 font-bold text-[#6657C8] dark:text-[#38BDF8] min-h-[40px] px-1 cursor-pointer"
                >
                  {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 opacity-70" />}
                  <span>{allSelected ? 'Batalkan Pilih Semua' : 'Pilih Semua Halaman Ini'}</span>
                </button>
                <span className="font-mono text-[11px] font-bold text-[#52647A] dark:text-slate-400 tabular-nums">
                  {selectedKeys?.size || 0} dipilih
                </span>
              </div>
            )}

            {data.length === 0 ? (
              <EmptyState
                compact
                title={emptyState?.title || 'Belum ada data ditemukan'}
                description={emptyState?.description || 'Ubah filter pada header atau reset pencarian untuk melihat data.'}
                actionLabel={emptyState?.actionLabel || (onResetFilters && activeFilterCount > 0 ? resetLabel : undefined)}
                onAction={emptyState?.onAction || (onResetFilters && activeFilterCount > 0 ? onResetFilters : undefined)}
                secondaryAction={emptyState?.secondaryAction}
                icon={emptyState?.icon}
              />
            ) : (
              data.map((row, index) => {
                const key = getRowKey(row, index);
                const isSelected = Boolean(selectedKeys?.has(key));
                const isExpanded = Boolean(expandedKeys[key]);
                const actions = getRowActions ? getRowActions(row) : [];

                return (
                  <article
                    key={key}
                    onClick={() => onRowClick?.(row)}
                    className={`bg-white/95 dark:bg-[#0F172A] rounded-xl border p-3.5 transition-all space-y-3 ${
                      isSelected
                        ? 'border-[#6657C8] dark:border-[#2563EB] ring-2 ring-[#6657C8]/20 dark:ring-[#2563EB]/20'
                        : 'border-[#DDE6F0] dark:border-slate-800'
                    } ${onRowClick ? 'cursor-pointer active:scale-[0.995]' : ''}`}
                  >
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
                            className="min-w-[44px] min-h-[44px] -ml-1.5 -mt-1.5 flex items-center justify-center text-[#6657C8] dark:text-[#38BDF8] cursor-pointer shrink-0"
                          >
                            {isSelected ? <CheckSquare className="w-4.5 h-4.5" /> : <Square className="w-4.5 h-4.5 opacity-60" />}
                          </button>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="font-bold text-xs sm:text-sm text-[#26364A] dark:text-white leading-snug break-words">
                            {mobileTitle(row)}
                          </div>
                          {mobileSubtitle && (
                            <div className="text-[11px] text-[#52647A] dark:text-slate-400 leading-snug break-words">
                              {mobileSubtitle(row)}
                            </div>
                          )}
                          {mobileStatus && <div className="pt-0.5 flex flex-wrap gap-1.5">{mobileStatus(row)}</div>}
                        </div>
                      </div>

                      {actions.length > 0 && <ActionDropdownMenu actions={actions} size="md" />}
                    </div>

                    {primaryColumns.length > 0 && (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2 border-t border-[#DDE6F0] dark:border-slate-800 text-xs">
                        {primaryColumns.map(col => (
                          <div key={col.key} className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-slate-400">
                              {col.label}
                            </div>
                            <div className={`mt-0.5 text-[#26364A] dark:text-slate-100 font-medium break-words ${col.numeric ? 'font-mono tabular-nums' : ''}`}>
                              {col.renderMobile ? col.renderMobile(row, index) : col.render(row, index)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {secondaryColumns.length > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            toggleExpand(key);
                          }}
                          aria-expanded={isExpanded}
                          className="w-full min-h-[42px] px-3 py-1.5 rounded-lg bg-[#F8FAFD] dark:bg-[#1E293B] hover:bg-[#F0EDFF] dark:hover:bg-slate-800 border border-[#DDE6F0] dark:border-slate-700 flex items-center justify-between text-[11px] font-bold text-[#5145A6] dark:text-[#38BDF8] cursor-pointer transition-colors"
                        >
                          <span>{isExpanded ? 'Tutup Detail Tambahan' : `Lihat ${secondaryColumns.length} Detail Lainnya`}</span>
                          {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                        </button>

                        {isExpanded && (
                          <div className="mt-2.5 pt-2.5 border-t border-dashed border-[#DDE6F0] dark:border-slate-800 grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
                            {secondaryColumns.map(col => (
                              <div key={col.key} className="min-w-0">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-slate-400">
                                  {col.label}
                                </div>
                                <div className={`mt-0.5 text-[#26364A] dark:text-slate-100 break-words ${col.numeric ? 'font-mono tabular-nums' : ''}`}>
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
              })
            )}
          </div>
        ) : (
          /* DESKTOP & TABLET STICKY-HEADER INTERACTIVE TABLE */
          <div className={`overflow-x-auto ${maxTableHeightClass}`}>
            <table className="w-full text-left border-collapse text-xs mj-zebra-table">
              <thead
                className={`${
                  stickyHeader ? 'sticky top-0 z-10' : ''
                } bg-[#EDF3F8] dark:bg-[#1E293B] text-[11px] font-bold text-[#52647A] dark:text-slate-300 uppercase tracking-wide border-b border-[#DDE6F0] dark:border-slate-800`}
              >
                <tr>
                  {selectable && (
                    <th className="py-2.5 px-3 w-10 text-center">
                      <button
                        type="button"
                        onClick={onToggleSelectAll}
                        aria-label="Pilih semua baris"
                        className="text-[#6657C8] dark:text-[#38BDF8] cursor-pointer inline-flex items-center justify-center"
                      >
                        {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 opacity-70" />}
                      </button>
                    </th>
                  )}
                  {columns.map(col => {
                    const alignClass =
                      col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left';

                    return (
                      <th
                        key={col.key}
                        className={`py-2.5 px-3 whitespace-nowrap ${alignClass} ${col.widthClass || ''} ${col.thClassName || ''}`}
                      >
                        {renderColumnHeader(col)}
                      </th>
                    );
                  })}
                  {hasActionsColumn && (
                    <th className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 z-20 bg-[#EDF3F8] dark:bg-[#1E293B] shadow-[-4px_0_6px_-2px_rgba(38,54,74,0.05)] dark:shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.04)]">
                      {desktopActionHeader}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDE6F0] dark:divide-slate-800">
                {data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + (selectable ? 1 : 0) + (hasActionsColumn ? 1 : 0)}
                      className="p-6"
                    >
                      <EmptyState
                        compact
                        title={emptyState?.title || 'Belum ada data ditemukan'}
                        description={emptyState?.description || 'Ubah filter pada header kolom atau reset pencarian.'}
                        actionLabel={
                          emptyState?.actionLabel || (onResetFilters && activeFilterCount > 0 ? resetLabel : undefined)
                        }
                        onAction={
                          emptyState?.onAction || (onResetFilters && activeFilterCount > 0 ? onResetFilters : undefined)
                        }
                        secondaryAction={emptyState?.secondaryAction}
                        icon={emptyState?.icon}
                      />
                    </td>
                  </tr>
                ) : (
                  data.map((row, index) => {
                    const key = getRowKey(row, index);
                    const isSelected = Boolean(selectedKeys?.has(key));
                    const actions = getRowActions ? getRowActions(row) : [];

                    return (
                      <tr
                        key={key}
                        onClick={() => onRowClick?.(row)}
                        className={`transition-colors hover:bg-[#F0EDFF]/65 dark:hover:bg-[#1E293B]/70 ${
                          isSelected
                            ? 'bg-[#EAE8FF]/70 dark:bg-blue-950/30'
                            : 'bg-white odd:bg-white even:bg-[#F8FAFD] dark:bg-[#0F172A] dark:odd:bg-[#0F172A] dark:even:bg-[#0F172A]'
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
                              className="text-[#6657C8] dark:text-[#38BDF8] cursor-pointer inline-flex items-center justify-center"
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
                            className="py-2.5 px-3 text-right whitespace-nowrap sticky right-0 z-10 bg-inherit shadow-[-4px_0_6px_-2px_rgba(38,54,74,0.04)] dark:shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.03)]"
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
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {pagination && <PaginationBar {...pagination} />}
      </div>
    </div>
  );
}
