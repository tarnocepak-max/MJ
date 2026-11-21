import React from 'react';
import { Bell, CheckCheck, Maximize2 } from 'lucide-react';
import {
  NotificationCategory,
  NotificationFilterState,
  NotificationItem
} from './notificationTypes';
import { NotificationTabs } from './NotificationTabs';
import { NotificationFilter } from './NotificationFilter';
import { NotificationCard } from './NotificationCard';
import { NotificationEmptyState } from './NotificationEmptyState';

interface NotificationDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onViewAll: () => void;
  items: NotificationItem[];
  counts: { all: number; unread: number; read: number };
  filters: NotificationFilterState;
  availableCategories: NotificationCategory[];
  isLoading: boolean;
  error: string | null;
  onChangeFilter: (next: Partial<NotificationFilterState>) => void;
  onResetFilters: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onSelectItem: (item: NotificationItem) => void;
  onRetry: () => void;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  isOpen,
  onClose,
  onViewAll,
  items,
  counts,
  filters,
  availableCategories,
  isLoading,
  error,
  onChangeFilter,
  onResetFilters,
  onMarkAllRead,
  onMarkRead,
  onSelectItem,
  onRetry
}) => {
  if (!isOpen) return null;

  const visibleItems = items.slice(0, 8);
  const hasFilterActive =
    filters.category !== 'all' ||
    filters.priority !== 'all' ||
    filters.search.trim().length > 0;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 z-40 bg-[#30104B]/10 dark:bg-black/35 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Floating Glassmorphism Notification Dropdown */}
      <div
        role="dialog"
        aria-label="Pusat Notifikasi"
        className="mj-notif-dropdown-enter mj-notif-glass-panel fixed sm:absolute right-3 sm:right-0 top-[68px] sm:top-auto sm:mt-3 w-[calc(100vw-1.5rem)] sm:w-[400px] max-w-[420px] rounded-[20px] z-50 overflow-hidden flex flex-col max-h-[min(78vh,620px)]"
      >
        {/* Purple Glass Header */}
        <div className="mj-notif-header-glass px-4 py-3.5 text-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-[12px] bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <Bell className="w-4 h-4 text-[#EEE5FF]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-sm font-extrabold tracking-tight leading-none">
                  Notification
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-white/18 border border-white/25 font-mono text-[10px] font-extrabold tabular-nums">
                  {counts.unread} Unread
                </span>
              </div>
              <p className="text-[10.5px] text-[#EEE5FF]/85 mt-0.5 truncate">
                Pembaruan WO, QC, Live Chat &amp; Sinkronisasi
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={counts.unread === 0}
            onClick={onMarkAllRead}
            title="Tandai semua sebagai sudah dibaca"
            className="mj-notif-btn-3d-glass px-2.5 py-1.5 rounded-[11px] text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span className="hidden xs:inline sm:inline">Mark All as Read</span>
          </button>
        </div>

        {/* Tabs + Compact Category & Priority Filter */}
        <div className="px-3.5 pt-3 pb-2.5 bg-white/60 dark:bg-[#190C30]/60 border-b border-[#EEE5FF] dark:border-[#3D1D72] space-y-2.5 shrink-0">
          <NotificationTabs
            activeTab={filters.tab}
            onChange={tab => onChangeFilter({ tab })}
            counts={counts}
            compact
          />
          <NotificationFilter
            filters={filters}
            onChange={onChangeFilter}
            onReset={onResetFilters}
            availableCategories={availableCategories}
            compact
          />
        </div>

        {/* Internal Scrolling List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#F7F4FC]/70 dark:bg-[#140929]/75">
          {isLoading ? (
            <NotificationEmptyState mode="loading" compact />
          ) : error && visibleItems.length === 0 ? (
            <NotificationEmptyState
              mode="error"
              errorMessage={error}
              onRetry={onRetry}
              compact
            />
          ) : visibleItems.length === 0 ? (
            <NotificationEmptyState
              mode="empty"
              activeTab={filters.tab}
              hasActiveFilter={hasFilterActive}
              onResetFilters={onResetFilters}
              compact
            />
          ) : (
            visibleItems.map(item => (
              <NotificationCard
                key={item.id}
                item={item}
                onSelect={selected => onSelectItem(selected)}
                onMarkRead={onMarkRead}
                compact
              />
            ))
          )}
        </div>

        {/* Footer CTA */}
        <div className="px-3.5 py-3 bg-white/85 dark:bg-[#1E0E3B]/90 border-t border-[#EEE5FF] dark:border-[#3D1D72] flex items-center justify-between gap-2 shrink-0">
          <span className="text-[10.5px] font-mono font-semibold text-[#756C86] dark:text-[#BFB2DC] tabular-nums">
            {items.length > visibleItems.length
              ? `Menampilkan ${visibleItems.length} dari ${items.length}`
              : `${items.length} notifikasi`}
          </span>

          <button
            type="button"
            onClick={onViewAll}
            className="mj-notif-btn-3d px-3.5 py-2 rounded-[13px] text-[11px] font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>View All Notifications</span>
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
};
