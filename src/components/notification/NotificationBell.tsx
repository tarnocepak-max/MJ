import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import { Ticket } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { NotificationBadge } from './NotificationBadge';
import { NotificationDropdown } from './NotificationDropdown';
import { NotificationDrawer } from './NotificationDrawer';
import { useNotificationCenter } from './useNotificationCenter';

interface NotificationBellProps {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenMenu?: () => void;
  buttonClassName?: string;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  onNavigate,
  onSelectTicket,
  onOpenMenu,
  buttonClassName
}) => {
  const { currentUser } = useApp();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const {
    filteredNotifications,
    counts,
    filters,
    availableCategories,
    isLoading,
    error,
    updateFilters,
    resetFilters,
    markAsRead,
    markAllAsRead,
    clearReadNotifications,
    handleSelectNotification,
    retrySync
  } = useNotificationCenter({
    onNavigate,
    onSelectTicket
  });

  const canOpenSoundSettings =
    currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          onOpenMenu?.();
          setDropdownOpen(prev => !prev);
        }}
        aria-label={`Notifikasi Operasional (${counts.unread} belum dibaca)`}
        aria-expanded={dropdownOpen}
        title="Pusat Notifikasi MoraJaws"
        className={
          buttonClassName ||
          'relative w-9 h-9 rounded-full mj-floating-nav-pill-idle flex items-center justify-center cursor-pointer transition-transform active:scale-95'
        }
      >
        <Bell className="w-4 h-4" />
        <NotificationBadge
          count={counts.unread}
          hasCritical={counts.hasCriticalUnread}
          className="absolute -top-1 -right-1"
        />
      </button>

      <NotificationDropdown
        isOpen={dropdownOpen}
        onClose={() => setDropdownOpen(false)}
        onViewAll={() => {
          setDropdownOpen(false);
          setDrawerOpen(true);
        }}
        items={filteredNotifications}
        counts={counts}
        filters={filters}
        availableCategories={availableCategories}
        isLoading={isLoading}
        error={error}
        onChangeFilter={updateFilters}
        onResetFilters={resetFilters}
        onMarkAllRead={markAllAsRead}
        onMarkRead={markAsRead}
        onSelectItem={item =>
          handleSelectNotification(item, () => {
            setDropdownOpen(false);
          })
        }
        onRetry={retrySync}
      />

      <NotificationDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={filteredNotifications}
        counts={counts}
        filters={filters}
        availableCategories={availableCategories}
        isLoading={isLoading}
        error={error}
        onChangeFilter={updateFilters}
        onResetFilters={resetFilters}
        onMarkAllRead={markAllAsRead}
        onMarkRead={markAsRead}
        onClearRead={clearReadNotifications}
        onSelectItem={item =>
          handleSelectNotification(item, () => {
            setDrawerOpen(false);
          })
        }
        onRetry={retrySync}
        onOpenSoundSettings={
          canOpenSoundSettings ? () => onNavigate('sound_settings') : undefined
        }
      />
    </div>
  );
};
