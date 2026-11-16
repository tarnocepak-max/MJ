import React from 'react';
import { UserCheck, BarChart3, FileText, Sliders, UserPlus } from 'lucide-react';

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
  const tabs = [
    {
      id: 'wo_assignment' as LeaderTabType,
      label: 'ASSIGN WO',
      shortLabel: 'Assign WO',
      icon: UserCheck,
      badge: unassignedCount > 0 ? unassignedCount : undefined,
      badgeColor: 'bg-[#6D28D9] text-white font-bold'
    },
    {
      id: 'progress_dashboard' as LeaderTabType,
      label: 'DASHBOARD PROGRESS',
      shortLabel: 'Progress',
      icon: BarChart3,
      badge: 'Live',
      badgeColor: 'bg-[#4C1D95] text-white font-bold'
    },
    {
      id: 'installer_mgmt' as LeaderTabType,
      label: 'TEKNISI',
      shortLabel: 'Teknisi',
      icon: UserPlus,
      badge: installersCount > 0 ? installersCount : undefined,
      badgeColor: 'bg-emerald-600 text-white font-bold'
    },
    {
      id: 'contractor_recap' as LeaderTabType,
      label: 'REKAP TOTAL WO',
      shortLabel: 'Rekap WO',
      icon: FileText
    },
    {
      id: 'quota_settings' as LeaderTabType,
      label: 'KUOTA & KOLOM',
      shortLabel: 'Kuota',
      icon: Sliders
    }
  ];

  return (
    <nav
      aria-label="Navigasi Utama Leader"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#160D29]/95 backdrop-blur-xl border-t border-[#E9E5F0] dark:border-[#35105E] shadow-[0_-4px_20px_rgba(27,18,48,0.06)] pb-[env(safe-area-inset-bottom,0px)] transition-colors"
    >
      <div className="max-w-5xl mx-auto grid grid-cols-5 items-center">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center py-2 px-1 sm:px-2 min-h-[58px] transition-all cursor-pointer group select-none ${
                isActive
                  ? 'text-[#431599] dark:text-[#D8B4FE]'
                  : 'text-[#766B83] dark:text-[#CEC0E8]/75 hover:text-[#431599] dark:hover:text-[#D8B4FE]'
              }`}
            >
              {/* Active Indicator Bar on top */}
              {isActive && (
                <div className="absolute top-0 inset-x-3 sm:inset-x-6 h-[3px] bg-[#431599] dark:bg-[#A78BFA] rounded-b-full shadow-[0_0_10px_rgba(216,180,254,0.65)]" />
              )}

              {/* Icon Container with subtle background badge */}
              <div
                className={`relative p-1.5 rounded-xl transition-all ${
                  isActive
                    ? 'bg-[#F5F1FF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] scale-105 shadow-xs'
                    : 'text-[#766B83] dark:text-[#CEC0E8]/75 group-hover:scale-105 group-hover:text-[#431599] dark:group-hover:text-[#D8B4FE]'
                }`}
              >
                <Icon className={`w-5 h-5 sm:w-5.5 sm:h-5.5 ${isActive ? 'text-[#431599] dark:text-[#D8B4FE]' : 'text-[#766B83] dark:text-[#CEC0E8]/75'}`} />

                {/* Badge Indicator */}
                {tab.badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-2 px-1.5 py-0.2 rounded-full text-[9px] font-mono leading-tight shadow-xs tabular-nums ${
                      tab.badgeColor || 'bg-[#431599] text-white'
                    }`}
                  >
                    {typeof tab.badge === 'number' && tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>

              {/* Label */}
              <span
                className={`text-[10px] sm:text-[10.5px] font-bold tracking-tight text-center mt-1 leading-tight line-clamp-1 uppercase ${
                  isActive
                    ? 'text-[#431599] dark:text-[#D8B4FE] font-extrabold'
                    : 'text-[#766B83] dark:text-[#CEC0E8]/75'
                }`}
              >
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
