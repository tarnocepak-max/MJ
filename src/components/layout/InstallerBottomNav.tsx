import React from 'react';
import { LayoutDashboard, ClipboardList, MessageSquare, MessageCircle } from 'lucide-react';

interface InstallerBottomNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  pendingTasksCount?: number;
  unreadMessagesCount?: number;
  waPendingCount?: number;
}

export const InstallerBottomNav: React.FC<InstallerBottomNavProps> = ({
  activeTab,
  onTabChange,
  pendingTasksCount = 0,
  unreadMessagesCount = 0,
  waPendingCount = 0
}) => {
  const isDashboardActive = activeTab === 'installer_dashboard';
  const isTasksActive =
    activeTab === 'installer_portal' ||
    activeTab === 'installer_tasks' ||
    activeTab === 'installer_progress' ||
    activeTab === 'installer_history';
  const isWhatsAppActive = activeTab === 'installer_whatsapp' || activeTab === 'whatsapp';
  const isLiveChatActive =
    activeTab === 'installer_chat' || activeTab === 'contact_centre' || activeTab === 'live_chat';

  const tabs = [
    {
      id: 'installer_dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      isActive: isDashboardActive,
      badge: undefined as number | undefined,
      badgeColor: '',
      showDot: false
    },
    {
      id: 'installer_tasks',
      label: 'Tugas Saya',
      icon: ClipboardList,
      isActive: isTasksActive,
      badge: pendingTasksCount > 0 ? pendingTasksCount : undefined,
      badgeColor: 'bg-[#E59A27] text-white font-bold',
      showDot: false
    },
    {
      id: 'installer_whatsapp',
      label: 'WhatsApp',
      icon: MessageSquare,
      isActive: isWhatsAppActive,
      badge: undefined as number | undefined,
      badgeColor: '',
      showDot: waPendingCount > 0
    },
    {
      id: 'installer_chat',
      label: 'Live Chat',
      icon: MessageCircle,
      isActive: isLiveChatActive,
      badge: unreadMessagesCount > 0 ? unreadMessagesCount : undefined,
      badgeColor: 'bg-[#DC4C5A] text-white font-bold',
      showDot: false
    }
  ];

  return (
    <nav
      aria-label="Navigasi Bawah Teknisi"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#160D29]/95 backdrop-blur-xl border-t border-[#E9E5F0] dark:border-[#35105E] shadow-[0_-4px_20px_rgba(33,26,46,0.06)] pb-[env(safe-area-inset-bottom,0px)] transition-colors select-none"
    >
      <div className="max-w-3xl mx-auto grid grid-cols-4 items-center px-1 sm:px-4 h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.isActive;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center h-full min-h-[48px] px-1 transition-colors cursor-pointer group ${
                isActive
                  ? 'text-[#431599] dark:text-[#D8B4FE]'
                  : 'text-[#766B83] dark:text-[#CEC0E8]/75 hover:text-[#431599] dark:hover:text-[#D8B4FE]'
              }`}
            >
              {isActive && (
                <span className="absolute top-0 w-10 h-[3px] bg-[#431599] dark:bg-[#A78BFA] rounded-b-full" />
              )}

              <div className="relative flex items-center justify-center p-1">
                <Icon
                  strokeWidth={isActive ? 2.3 : 1.9}
                  className={`w-5 h-5 transition-transform group-active:scale-95 ${
                    isActive
                      ? 'text-[#431599] dark:text-[#D8B4FE]'
                      : 'text-[#766B83] dark:text-[#CEC0E8]/75 group-hover:text-[#431599]'
                  }`}
                />

                {tab.badge !== undefined && (
                  <span
                    className={`absolute -top-1 -right-2 min-w-[17px] h-[17px] px-1 flex items-center justify-center text-[10px] leading-none rounded-full ring-2 ring-white dark:ring-[#160D29] tabular-nums ${tab.badgeColor}`}
                  >
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}

                {tab.showDot && (
                  <span
                    aria-label="Ada konfirmasi WhatsApp tertunda"
                    className="absolute -top-0.5 -right-1 w-2.5 h-2.5 rounded-full bg-[#16A36A] ring-2 ring-white dark:ring-[#160D29]"
                  />
                )}
              </div>

              <span
                className={`mt-0.5 text-[10.5px] sm:text-[11px] tracking-tight truncate max-w-[84px] sm:max-w-none text-center ${
                  isActive
                    ? 'font-bold text-[#431599] dark:text-[#D8B4FE]'
                    : 'font-medium text-[#766B83] dark:text-[#CEC0E8]/75'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
