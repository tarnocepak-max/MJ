import React from 'react';
import { UserCheck, BarChart3, FileText, Sliders, Users } from 'lucide-react';

export type LeaderTabType =
  | 'wo_assignment'
  | 'progress_dashboard'
  | 'installer_mgmt'
  | 'contractor_recap'
  | 'quota_settings';

interface LeaderBottomNavProps {
  activeTab: LeaderTabType;
  onTabChange: (tab: LeaderTabType) => void;
  unassignedCount?: number;
  installersCount?: number;
}

export const LeaderBottomNav: React.FC<LeaderBottomNavProps> = ({
  activeTab,
  onTabChange,
  unassignedCount = 0,
  installersCount = 0
}) => {
  const tabs: {
    id: LeaderTabType;
    label: string;
    desktopLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number | string;
    badgeTone?: string;
  }[] = [
    {
      id: 'wo_assignment',
      label: 'Assign',
      desktopLabel: 'Assign WO',
      icon: UserCheck,
      badge: unassignedCount > 0 ? unassignedCount : undefined,
      badgeTone: 'bg-[#ba1a1a] text-white'
    },
    {
      id: 'progress_dashboard',
      label: 'Progress',
      desktopLabel: 'Progress WO',
      icon: BarChart3,
      badge: 'LIVE',
      badgeTone: 'bg-[#16A36A] text-white'
    },
    {
      id: 'installer_mgmt',
      label: 'Teknisi',
      desktopLabel: 'Tim Teknisi',
      icon: Users,
      badge: installersCount > 0 ? installersCount : undefined,
      badgeTone: 'bg-[#58149c] text-white'
    },
    {
      id: 'contractor_recap',
      label: 'Rekap',
      desktopLabel: 'Rekap WO',
      icon: FileText
    },
    {
      id: 'quota_settings',
      label: 'Kuota',
      desktopLabel: 'Kuota & Kolom',
      icon: Sliders
    }
  ];

  return (
    <nav
      aria-label="Navigasi Utama Leader"
      className="fixed bottom-0 inset-x-0 z-40 pointer-events-none pb-[env(safe-area-inset-bottom,0px)] px-2 sm:px-4 pb-2"
    >
      <div className="pointer-events-auto max-w-2xl mx-auto bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-xl border border-[#e8ddff] dark:border-[#35105E] rounded-2xl shadow-[0_10px_30px_rgba(31,22,56,0.12)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.45)] p-1.5 grid grid-cols-5 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center py-1.5 px-1 rounded-xl min-h-[50px] transition-all cursor-pointer select-none group ${
                isActive
                  ? 'bg-[#eedbff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_2px_0_#d0bcff] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_0_#160d29]'
                  : 'text-[#7d7484] dark:text-[#CEC0E8]/75 hover:bg-[#f8f1ff] dark:hover:bg-[#261942] hover:text-[#1f1638] dark:hover:text-white'
              } active:translate-y-0.5`}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-[19px] h-[19px] transition-transform ${
                    isActive ? 'scale-105 text-[#58149c] dark:text-[#dab9ff]' : 'text-current'
                  }`}
                />
                {tab.badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-3 px-1 min-w-[16px] h-[15px] rounded-full text-[8.5px] font-mono font-extrabold leading-none flex items-center justify-center ring-2 ring-white dark:ring-[#1A0E2E] tabular-nums ${
                      tab.badgeTone || 'bg-[#58149c] text-white'
                    }`}
                  >
                    {typeof tab.badge === 'number' && tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>

              <span
                className={`mt-1 text-[10.5px] leading-tight text-center truncate max-w-full ${
                  isActive ? 'font-extrabold tracking-tight' : 'font-semibold'
                }`}
              >
                <span className="hidden sm:inline">{tab.desktopLabel}</span>
                <span className="sm:hidden">{tab.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
