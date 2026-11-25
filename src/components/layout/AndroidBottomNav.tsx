import React from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { useHasOpenModal } from '../../hooks/useModalLayer';
import {
  LayoutDashboard,
  Ticket as TicketIcon,
  FileSpreadsheet,
  MessageCircle,
  Menu
} from 'lucide-react';

interface AndroidBottomNavProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
  onToggleMenu: () => void;
  isMenuOpen: boolean;
}

export const AndroidBottomNav: React.FC<AndroidBottomNavProps> = ({
  activeTab,
  onNavigate,
  onToggleMenu,
  isMenuOpen
}) => {
  const { scopedTickets, currentUser, totalLiveChatUnreadCount } = useApp();
  const unreadMessages = totalLiveChatUnreadCount;
  const { config } = useUIConfig();
  const hasOpenModal = useHasOpenModal();

  if (hasOpenModal) return null;

  const totalActiveTickets = scopedTickets.filter(t => !t.isArchived && !t.isDeleted).length;
  const isSuperOrDispatch = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';
  const canImportWO = currentUser.role === 'super_admin';

  const touchSizeClass =
    config.device?.android?.touchTargetSize === 'large'
      ? 'min-h-[64px] py-2 text-[10.5px]'
      : config.device?.android?.touchTargetSize === 'compact'
      ? 'min-h-[54px] py-1 text-[9.5px]'
      : 'min-h-[58px] py-1.5 text-[10px]';

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      data-testid="android-bottom-nav"
      className="fixed bottom-[max(0.65rem,env(safe-area-inset-bottom))] inset-x-0 z-40 px-3 pointer-events-none select-none"
    >
      <div
        className={`pointer-events-auto max-w-lg mx-auto mj-glass-capsule rounded-[28px] px-1.5 flex items-center justify-around gap-1 transition-all duration-200 ${touchSizeClass}`}
      >
        {/* Tab 1: Dashboard */}
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          aria-current={activeTab === 'dashboard' ? 'page' : undefined}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-[52px] min-h-[46px] px-1.5 rounded-full cursor-pointer relative ${
            activeTab === 'dashboard'
              ? 'mj-floating-nav-pill-active text-white font-extrabold'
              : 'mj-floating-nav-pill-idle font-medium'
          }`}
        >
          <LayoutDashboard className="w-[18px] h-[18px] shrink-0" />
          <span className="truncate text-[9.5px] leading-tight">Dashboard</span>
        </button>

        {/* Tab 2: Tickets with Badge */}
        <button
          type="button"
          onClick={() => onNavigate('tickets')}
          aria-current={activeTab === 'tickets' ? 'page' : undefined}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-[52px] min-h-[46px] px-1.5 relative rounded-full cursor-pointer ${
            activeTab === 'tickets'
              ? 'mj-floating-nav-pill-active text-white font-extrabold'
              : 'mj-floating-nav-pill-idle font-medium'
          }`}
        >
          <div className="relative">
            <TicketIcon className="w-[18px] h-[18px] shrink-0" />
            {totalActiveTickets > 0 && (
              <span
                className={`absolute -top-1.5 -right-2.5 px-1 py-0.2 min-w-[16px] text-center bg-[#D45B66] dark:bg-rose-500 text-white rounded-full text-[8.5px] font-mono font-bold leading-tight ring-2 ${
                  activeTab === 'tickets' ? 'ring-[#6657C8] dark:ring-[#6d28d9]' : 'ring-white dark:ring-[#160d33]'
                } tabular-nums`}
              >
                {totalActiveTickets > 99 ? '99+' : totalActiveTickets}
              </span>
            )}
          </div>
          <span className="truncate text-[9.5px] leading-tight">Tiket WO</span>
        </button>

        {/* Tab 3: Import WO / Report Data WO */}
        {canImportWO ? (
          <button
            type="button"
            onClick={() => onNavigate('import')}
            aria-current={activeTab === 'import' ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-[52px] min-h-[46px] px-1.5 rounded-full cursor-pointer relative ${
              activeTab === 'import'
                ? 'mj-floating-nav-pill-active text-white font-extrabold'
                : 'mj-floating-nav-pill-idle font-medium'
            }`}
          >
            <FileSpreadsheet className="w-[18px] h-[18px] shrink-0" />
            <span className="truncate text-[9.5px] leading-tight">Import WO</span>
          </button>
        ) : isSuperOrDispatch ? (
          <button
            type="button"
            onClick={() => onNavigate('report_data_wo')}
            aria-current={activeTab === 'report_data_wo' ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-[52px] min-h-[46px] px-1.5 rounded-full cursor-pointer relative ${
              activeTab === 'report_data_wo'
                ? 'mj-floating-nav-pill-active text-white font-extrabold'
                : 'mj-floating-nav-pill-idle font-medium'
            }`}
          >
            <FileSpreadsheet className="w-[18px] h-[18px] shrink-0" />
            <span className="truncate text-[9.5px] leading-tight">Report WO</span>
          </button>
        ) : null}

        {/* Tab 4: LiveChat */}
        <button
          type="button"
          onClick={() => onNavigate('contact_centre')}
          aria-current={activeTab === 'contact_centre' ? 'page' : undefined}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-[52px] min-h-[46px] px-1.5 rounded-full cursor-pointer relative ${
            activeTab === 'contact_centre'
              ? 'mj-floating-nav-pill-active text-white font-extrabold'
              : 'mj-floating-nav-pill-idle font-medium'
          }`}
        >
          <span className="relative">
            <MessageCircle className="w-[18px] h-[18px] shrink-0" />
            {unreadMessages > 0 && (
              <span
                className={`absolute -top-1.5 -right-2.5 min-w-[16px] rounded-full bg-[#218A63] dark:bg-emerald-500 px-1 text-center text-[8.5px] font-mono font-bold leading-4 text-white ring-2 ${
                  activeTab === 'contact_centre' ? 'ring-[#6657C8] dark:ring-[#6d28d9]' : 'ring-white dark:ring-[#160d33]'
                } tabular-nums`}
              >
                {unreadMessages > 99 ? '99+' : unreadMessages}
              </span>
            )}
          </span>
          <span className="truncate text-[9.5px] leading-tight">LiveChat</span>
        </button>

        {/* Tab 5: Menu Drawer & Search */}
        <button
          type="button"
          onClick={onToggleMenu}
          aria-expanded={isMenuOpen}
          data-testid="mobile-bottom-menu-toggle"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-[50px] min-h-[46px] px-1.5 rounded-full cursor-pointer relative ${
            isMenuOpen
              ? 'mj-floating-nav-pill-active text-white font-extrabold'
              : 'mj-floating-nav-pill-idle font-medium'
          }`}
        >
          <Menu className="w-[18px] h-[18px] shrink-0" />
          <span className="truncate text-[9.5px] leading-tight">Menu</span>
        </button>
      </div>
    </nav>
  );
};
