import React from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
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

  const totalActiveTickets = scopedTickets.filter(t => !t.isArchived && !t.isDeleted).length;
  const isSuperOrDispatch = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';
  const canImportWO = currentUser.role === 'super_admin' || currentUser.role === 'management_data';

  const touchSizeClass =
    config.device?.android?.touchTargetSize === 'large'
      ? 'h-16 py-2.5 text-[11px]'
      : config.device?.android?.touchTargetSize === 'compact'
      ? 'h-13 py-1 text-[10px]'
      : 'h-14 py-1.5 text-[10.5px]';

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      data-testid="android-bottom-nav"
      className="fixed bottom-0 inset-x-0 z-35 bg-white/95 dark:bg-[#0B1220]/95 backdrop-blur-xl border-t border-slate-200 dark:border-slate-800 shadow-[0_-2px_12px_rgba(15,23,42,0.06)] transition-all duration-200 pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className={`max-w-4xl mx-auto flex items-center justify-around px-2 gap-1 ${touchSizeClass}`}>
        {/* Tab 1: Dashboard */}
        <button
          type="button"
          onClick={() => onNavigate(currentUser.role === 'management_data' ? 'management_data_portal' : 'dashboard')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all min-w-[52px] min-h-[44px] rounded-xl cursor-pointer relative active:scale-95 ${
            activeTab === 'dashboard' || activeTab === 'management_data_portal'
              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-sky-400 font-extrabold'
              : 'text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800/70'
          }`}
        >
          {(activeTab === 'dashboard' || activeTab === 'management_data_portal') && (
            <div className="absolute top-0 inset-x-3 h-[3px] bg-blue-600 dark:bg-sky-400 rounded-b-full" />
          )}
          <LayoutDashboard className="w-5 h-5 shrink-0" />
          <span className="truncate text-[10px]">Dashboard</span>
        </button>

        {/* Tab 2: Tickets with Badge */}
        <button
          type="button"
          onClick={() => onNavigate('tickets')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all min-w-[52px] min-h-[44px] relative rounded-xl cursor-pointer active:scale-95 ${
            activeTab === 'tickets'
              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-sky-400 font-extrabold'
              : 'text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800/70'
          }`}
        >
          {activeTab === 'tickets' && (
            <div className="absolute top-0 inset-x-3 h-[3px] bg-blue-600 dark:bg-sky-400 rounded-b-full" />
          )}
          <div className="relative">
            <TicketIcon className="w-5 h-5 shrink-0" />
            {totalActiveTickets > 0 && (
              <span className="absolute -top-1.5 -right-2 px-1 py-0.2 min-w-[16px] text-center bg-rose-600 text-white rounded-full text-[9px] font-bold leading-tight shadow-xs tabular-nums">
                {totalActiveTickets > 99 ? '99+' : totalActiveTickets}
              </span>
            )}
          </div>
          <span className="truncate text-[10px]">Tiket WO</span>
        </button>

        {/* Tab 3: Import WO / Report Data WO */}
        {canImportWO ? (
          <button
            type="button"
            onClick={() => onNavigate('import')}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all min-w-[52px] min-h-[44px] rounded-xl cursor-pointer relative active:scale-95 ${
              activeTab === 'import'
                ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-sky-400 font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800/70'
            }`}
          >
            {activeTab === 'import' && (
              <div className="absolute top-0 inset-x-3 h-[3px] bg-blue-600 dark:bg-sky-400 rounded-b-full" />
            )}
            <FileSpreadsheet className="w-5 h-5 shrink-0" />
            <span className="truncate text-[10px]">Import WO</span>
          </button>
        ) : isSuperOrDispatch ? (
          <button
            type="button"
            onClick={() => onNavigate('report_data_wo')}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all min-w-[52px] min-h-[44px] rounded-xl cursor-pointer relative active:scale-95 ${
              activeTab === 'report_data_wo'
                ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-sky-400 font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800/70'
            }`}
          >
            {activeTab === 'report_data_wo' && (
              <div className="absolute top-0 inset-x-3 h-[3px] bg-blue-600 dark:bg-sky-400 rounded-b-full" />
            )}
            <FileSpreadsheet className="w-5 h-5 shrink-0" />
            <span className="truncate text-[10px]">Report WO</span>
          </button>
        ) : null}

        {/* Tab 4: LiveChat */}
        <button
          type="button"
          onClick={() => onNavigate('contact_centre')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all min-w-[52px] min-h-[44px] rounded-xl cursor-pointer relative active:scale-95 ${
            activeTab === 'contact_centre'
              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-sky-400 font-extrabold'
              : 'text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800/70'
          }`}
        >
          {activeTab === 'contact_centre' && (
            <div className="absolute top-0 inset-x-3 h-[3px] bg-blue-600 dark:bg-sky-400 rounded-b-full" />
          )}
          <span className="relative">
            <MessageCircle className="w-5 h-5 shrink-0" />
            {unreadMessages > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[16px] rounded-full bg-rose-600 px-1 text-center text-[9px] font-bold leading-4 text-white tabular-nums">
                {unreadMessages > 99 ? '99+' : unreadMessages}
              </span>
            )}
          </span>
          <span className="truncate text-[10px]">LiveChat</span>
        </button>

        {/* Tab 5: Menu Drawer & Search */}
        <button
          type="button"
          onClick={onToggleMenu}
          aria-expanded={isMenuOpen}
          data-testid="mobile-bottom-menu-toggle"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all min-w-[52px] min-h-[44px] rounded-xl cursor-pointer relative active:scale-95 ${
            isMenuOpen
              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-sky-400 font-extrabold'
              : 'text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800/70'
          }`}
        >
          {isMenuOpen && (
            <div className="absolute top-0 inset-x-3 h-[3px] bg-blue-600 dark:bg-sky-400 rounded-b-full" />
          )}
          <Menu className="w-5 h-5 shrink-0" />
          <span className="truncate text-[10px]">Menu</span>
        </button>
      </div>
    </nav>
  );
};
