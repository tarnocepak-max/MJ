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
      className="fixed bottom-0 inset-x-0 z-35 bg-[#fdf7ff]/95 dark:bg-[#160D29]/95 backdrop-blur-xl border-t border-[#E8DDFF] dark:border-[#35105E] shadow-[0_-4px_18px_rgba(53,16,94,0.08)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.45)] transition-all duration-200 pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className={`max-w-4xl mx-auto flex items-center justify-around px-2 gap-1 ${touchSizeClass}`}>
        {/* Tab 1: Dashboard */}
        <button
          type="button"
          onClick={() => onNavigate(currentUser.role === 'management_data' ? 'management_data_portal' : 'dashboard')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all min-w-[52px] min-h-[44px] rounded-xl cursor-pointer relative active:scale-95 ${
            activeTab === 'dashboard' || activeTab === 'management_data_portal'
              ? 'bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-none'
              : 'text-[#4B4452] dark:text-[#CEC0E8] hover:text-[#58149C] dark:hover:text-[#DAB9FF] hover:bg-[#F8F1FF] dark:hover:bg-[#251545]/80'
          }`}
        >
          {(activeTab === 'dashboard' || activeTab === 'management_data_portal') && (
            <div className="absolute top-0 inset-x-3 h-[3px] bg-gradient-to-r from-[#7135B5] to-[#58149C] dark:from-[#DAB9FF] dark:to-[#A380FE] rounded-b-full" />
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
              ? 'bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-none'
              : 'text-[#4B4452] dark:text-[#CEC0E8] hover:text-[#58149C] dark:hover:text-[#DAB9FF] hover:bg-[#F8F1FF] dark:hover:bg-[#251545]/80'
          }`}
        >
          {activeTab === 'tickets' && (
            <div className="absolute top-0 inset-x-3 h-[3px] bg-gradient-to-r from-[#7135B5] to-[#58149C] dark:from-[#DAB9FF] dark:to-[#A380FE] rounded-b-full" />
          )}
          <div className="relative">
            <TicketIcon className="w-5 h-5 shrink-0" />
            {totalActiveTickets > 0 && (
              <span className="absolute -top-1.5 -right-2 px-1 py-0.2 min-w-[16px] text-center bg-[#BA1A1A] text-white rounded-full text-[9px] font-bold leading-tight shadow-xs tabular-nums">
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
                ? 'bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-none'
                : 'text-[#4B4452] dark:text-[#CEC0E8] hover:text-[#58149C] dark:hover:text-[#DAB9FF] hover:bg-[#F8F1FF] dark:hover:bg-[#251545]/80'
            }`}
          >
            {activeTab === 'import' && (
              <div className="absolute top-0 inset-x-3 h-[3px] bg-gradient-to-r from-[#7135B5] to-[#58149C] dark:from-[#DAB9FF] dark:to-[#A380FE] rounded-b-full" />
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
                ? 'bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-none'
                : 'text-[#4B4452] dark:text-[#CEC0E8] hover:text-[#58149C] dark:hover:text-[#DAB9FF] hover:bg-[#F8F1FF] dark:hover:bg-[#251545]/80'
            }`}
          >
            {activeTab === 'report_data_wo' && (
              <div className="absolute top-0 inset-x-3 h-[3px] bg-gradient-to-r from-[#7135B5] to-[#58149C] dark:from-[#DAB9FF] dark:to-[#A380FE] rounded-b-full" />
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
              ? 'bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-none'
              : 'text-[#4B4452] dark:text-[#CEC0E8] hover:text-[#58149C] dark:hover:text-[#DAB9FF] hover:bg-[#F8F1FF] dark:hover:bg-[#251545]/80'
          }`}
        >
          {activeTab === 'contact_centre' && (
            <div className="absolute top-0 inset-x-3 h-[3px] bg-gradient-to-r from-[#7135B5] to-[#58149C] dark:from-[#DAB9FF] dark:to-[#A380FE] rounded-b-full" />
          )}
          <span className="relative">
            <MessageCircle className="w-5 h-5 shrink-0" />
            {unreadMessages > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[16px] rounded-full bg-[#BA1A1A] px-1 text-center text-[9px] font-bold leading-4 text-white tabular-nums">
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
              ? 'bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-none'
              : 'text-[#4B4452] dark:text-[#CEC0E8] hover:text-[#58149C] dark:hover:text-[#DAB9FF] hover:bg-[#F8F1FF] dark:hover:bg-[#251545]/80'
          }`}
        >
          {isMenuOpen && (
            <div className="absolute top-0 inset-x-3 h-[3px] bg-gradient-to-r from-[#7135B5] to-[#58149C] dark:from-[#DAB9FF] dark:to-[#A380FE] rounded-b-full" />
          )}
          <Menu className="w-5 h-5 shrink-0" />
          <span className="truncate text-[10px]">Menu</span>
        </button>
      </div>
    </nav>
  );
};
