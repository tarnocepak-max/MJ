import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, MessageSquare, SlidersHorizontal, Trash2, X } from 'lucide-react';
import {
  NotificationCategory,
  NotificationFilterState,
  NotificationItem
} from './notificationTypes';
import { NotificationTabs } from './NotificationTabs';
import { NotificationFilter } from './NotificationFilter';
import { NotificationCard } from './NotificationCard';
import { NotificationEmptyState } from './NotificationEmptyState';
import { NotificationSettings } from './NotificationSettings';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: NotificationItem[];
  counts: {
    all: number;
    unread: number;
    read: number;
    liveChatUnread?: number;
    liveChatTotal?: number;
  };
  filters: NotificationFilterState;
  availableCategories: NotificationCategory[];
  isLoading: boolean;
  error: string | null;
  onChangeFilter: (next: Partial<NotificationFilterState>) => void;
  onResetFilters: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onClearRead: () => void;
  onSelectItem: (item: NotificationItem) => void;
  onRetry: () => void;
  onOpenSoundSettings?: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
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
  onClearRead,
  onSelectItem,
  onRetry,
  onOpenSoundSettings
}) => {
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const liveChatUnreadCount = counts.liveChatUnread ?? 0;
  const isLiveChatFilterActive = filters.category === 'live_chat';
  const showGroupedSections = filters.category === 'all';
  const liveChatItems = showGroupedSections
    ? items.filter(item => item.category === 'live_chat')
    : [];
  const otherItems = showGroupedSections
    ? items.filter(item => item.category !== 'live_chat')
    : items;

  const hasFilterActive =
    filters.category !== 'all' ||
    filters.priority !== 'all' ||
    filters.dateRange !== 'all' ||
    filters.search.trim().length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end">
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-[#30104B]/35 dark:bg-black/60 backdrop-blur-[3px] transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Floating Right Drawer (Desktop) / Responsive Near-Fullscreen Sheet (Mobile) */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Full Notification Drawer"
        className="mj-notif-drawer-enter mj-notif-glass-panel relative z-10 m-2.5 sm:m-3.5 mb-[84px] sm:mb-3.5 w-[calc(100vw-1.25rem)] sm:w-[460px] max-w-[480px] rounded-[22px] overflow-hidden flex flex-col"
      >
        {/* Purple Glass Header */}
        <div className="mj-notif-header-glass px-4 sm:px-5 py-4 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[14px] bg-white/16 border border-white/25 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] shrink-0">
              <Bell className="w-5 h-5 text-[#EEE5FF]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-extrabold tracking-tight leading-none truncate">
                  Notification Center
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-white/18 border border-white/25 font-mono text-[10px] font-extrabold tabular-nums shrink-0">
                  {counts.unread} Unread
                </span>
              </div>
              <p className="text-[11px] text-[#EEE5FF]/85 mt-1 truncate">
                Prioritas Live Chat &amp; antrean notifikasi operasional MoraJaws
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowSettings(s => !s)}
              aria-pressed={showSettings}
              aria-label="Pengaturan suara notifikasi"
              title="Pengaturan Audio Notifikasi"
              className={`mj-notif-btn-3d-glass w-9 h-9 rounded-[12px] flex items-center justify-center cursor-pointer ${
                showSettings ? 'ring-2 ring-white/50' : ''
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup Notification Drawer"
              title="Tutup"
              className="mj-notif-btn-3d-glass w-9 h-9 rounded-[12px] flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sticky Filter & Controls Area */}
        <div className="p-3.5 sm:p-4 bg-white/75 dark:bg-[#190C30]/80 border-b border-[#EEE5FF] dark:border-[#3D1D72] space-y-3 shrink-0">
          {showSettings && (
            <NotificationSettings
              onOpenFullAudioEngine={
                onOpenSoundSettings
                  ? () => {
                      onClose();
                      onOpenSoundSettings();
                    }
                  : undefined
              }
            />
          )}

          <NotificationTabs
            activeTab={filters.tab}
            onChange={tab => onChangeFilter({ tab })}
            counts={counts}
          />

          {(liveChatUnreadCount > 0 || isLiveChatFilterActive) && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-[13px] bg-blue-50/90 dark:bg-blue-950/45 border border-blue-200/80 dark:border-blue-700/50">
              <div className="flex items-center gap-2 min-w-0">
                <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11.5px] font-extrabold text-blue-900 dark:text-blue-100 truncate">
                    {liveChatUnreadCount > 0
                      ? `Prioritas Live Chat · ${liveChatUnreadCount} WO belum dibaca`
                      : 'Filter Aktif: Live Chat'}
                  </p>
                  <p className="text-[10px] text-blue-700/85 dark:text-blue-300/85 truncate">
                    Pesan Live Chat selalu ditampilkan di urutan paling atas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onChangeFilter({
                    category: isLiveChatFilterActive ? 'all' : 'live_chat'
                  })
                }
                className={`px-2.5 py-1.5 rounded-[10px] text-[10.5px] font-extrabold cursor-pointer transition-colors shrink-0 ${
                  isLiveChatFilterActive
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-white dark:bg-[#231245] text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-700/70 hover:bg-blue-100/70'
                }`}
              >
                {isLiveChatFilterActive ? 'Semua Kategori' : 'Hanya Live Chat'}
              </button>
            </div>
          )}

          <NotificationFilter
            filters={filters}
            onChange={onChangeFilter}
            onReset={onResetFilters}
            availableCategories={availableCategories}
          />

          {/* Quick Bulk Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              disabled={counts.unread === 0}
              onClick={onMarkAllRead}
              className="mj-notif-btn-3d px-3 py-1.5 rounded-[12px] text-[11px] font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark All as Read</span>
            </button>

            <button
              type="button"
              disabled={counts.read === 0}
              onClick={onClearRead}
              className="mj-notif-btn-3d-soft px-3 py-1.5 rounded-[12px] text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Read ({counts.read})</span>
            </button>
          </div>
        </div>

        {/* Scrollable Notification Feed Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-2.5 bg-[#F7F4FC] dark:bg-[#140929]">
          {isLoading ? (
            <NotificationEmptyState mode="loading" />
          ) : error && items.length === 0 ? (
            <NotificationEmptyState
              mode="error"
              errorMessage={error}
              onRetry={onRetry}
            />
          ) : items.length === 0 ? (
            <NotificationEmptyState
              mode="empty"
              activeTab={filters.tab}
              hasActiveFilter={hasFilterActive}
              onResetFilters={onResetFilters}
            />
          ) : showGroupedSections && liveChatItems.length > 0 ? (
            <>
              <div className="flex items-center justify-between px-1 pt-0.5 pb-1">
                <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Prioritas Live Chat</span>
                </span>
                <span className="font-mono text-[10.5px] font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                  {liveChatItems.length}
                </span>
              </div>
              {liveChatItems.map(item => (
                <NotificationCard
                  key={item.id}
                  item={item}
                  onSelect={selected => onSelectItem(selected)}
                  onMarkRead={onMarkRead}
                />
              ))}
              {otherItems.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-1 pt-2.5 pb-1">
                    <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#756C86] dark:text-[#BFB2DC]">
                      Notifikasi Operasional Lainnya
                    </span>
                    <span className="font-mono text-[10.5px] font-bold text-[#756C86] dark:text-[#BFB2DC] tabular-nums">
                      {otherItems.length}
                    </span>
                  </div>
                  {otherItems.map(item => (
                    <NotificationCard
                      key={item.id}
                      item={item}
                      onSelect={selected => onSelectItem(selected)}
                      onMarkRead={onMarkRead}
                    />
                  ))}
                </>
              )}
            </>
          ) : (
            items.map(item => (
              <NotificationCard
                key={item.id}
                item={item}
                onSelect={selected => onSelectItem(selected)}
                onMarkRead={onMarkRead}
              />
            ))
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
};
