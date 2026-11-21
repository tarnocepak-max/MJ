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
      badgeColor: 'bg-amber-500 text-white font-bold',
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
      badgeColor: 'bg-rose-500 text-white font-bold',
      showDot: false
    }
  ];

  return (
    <nav
      aria-label="Navigasi Bawah Teknisi"
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md pointer-events-none select-none"
    >
      <div className="pointer-events-auto h-16 px-1.5 rounded-full bg-white/82 dark:bg-[#1a103c]/68 backdrop-blur-2xl border border-[#e8ddff]/90 dark:border-white/[0.16] shadow-[0_16px_32px_-6px_rgba(31,22,56,0.18),0_4px_12px_rgba(88,20,156,0.08),inset_0_1px_1px_rgba(255,255,255,0.9)] dark:shadow-[0_20px_44px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.16)] grid grid-cols-4 items-center gap-1 transition-colors">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.isActive;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && window.navigator?.vibrate) {
                  try {
                    window.navigator.vibrate(15);
                  } catch {
                    // ignore unsupported vibrate errors
                  }
                }
                onTabChange(tab.id);
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center h-12 min-h-[48px] px-1 rounded-full transition-all duration-200 cursor-pointer group active:scale-95 ${
                isActive
                  ? 'bg-gradient-to-b from-[#58149c] to-[#7135b5] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.38),0_6px_14px_-2px_rgba(88,20,156,0.42)] -translate-y-[2px]'
                  : 'text-[#4b4452] dark:text-[#cec0e8]/80 hover:text-[#58149c] dark:hover:text-[#DAB9FF] hover:bg-[#f3eaff]/70 dark:hover:bg-[#2a1647]/70'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  strokeWidth={isActive ? 2.3 : 1.9}
                  className={`w-[19px] h-[19px] transition-transform group-active:scale-95 ${
                    isActive
                      ? 'text-white'
                      : 'text-[#4b4452] dark:text-[#cec0e8]/80 group-hover:text-[#58149c] dark:group-hover:text-[#DAB9FF]'
                  }`}
                />

                {tab.badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 flex items-center justify-center text-[9.5px] leading-none rounded-full ring-2 ${
                      isActive ? 'ring-[#58149c]' : 'ring-white dark:ring-[#1E1238]'
                    } tabular-nums shadow-xs ${tab.badgeColor}`}
                  >
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}

                {tab.showDot && (
                  <span
                    aria-label="Ada konfirmasi WhatsApp tertunda"
                    className={`absolute -top-0.5 -right-1.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ${
                      isActive ? 'ring-[#58149c]' : 'ring-white dark:ring-[#1E1238]'
                    }`}
                  />
                )}
              </div>

              <span
                className={`mt-0.5 text-[10px] leading-none tracking-tight truncate max-w-[78px] text-center ${
                  isActive
                    ? 'font-bold text-white'
                    : 'font-semibold text-[#4b4452] dark:text-[#cec0e8]/80'
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
