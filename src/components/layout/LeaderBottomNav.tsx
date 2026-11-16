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
      id: 'progress_dashboard' as LeaderTabType,
      label: 'DASHBOARD PROGRESS',
      shortLabel: 'Progress',
      icon: BarChart3,
      badge: 'Live',
      badgeColor: 'bg-[#6a46c1] text-white font-bold',
      isCenterFab: false
    },
    {
      id: 'installer_mgmt' as LeaderTabType,
      label: 'TEKNISI',
      shortLabel: 'Teknisi',
      icon: UserPlus,
      badge: installersCount > 0 ? installersCount : undefined,
      badgeColor: 'bg-[#16A36A] text-white font-bold',
      isCenterFab: false
    },
    {
      id: 'wo_assignment' as LeaderTabType,
      label: 'ASSIGN WO',
      shortLabel: 'Assign WO',
      icon: UserCheck,
      badge: unassignedCount > 0 ? unassignedCount : undefined,
      badgeColor: 'bg-[#ba1a1a] text-white font-bold',
      isCenterFab: true
    },
    {
      id: 'contractor_recap' as LeaderTabType,
      label: 'REKAP TOTAL WO',
      shortLabel: 'Rekap WO',
      icon: FileText,
      isCenterFab: false
    },
    {
      id: 'quota_settings' as LeaderTabType,
      label: 'KUOTA & KOLOM',
      shortLabel: 'Kuota',
      icon: Sliders,
      isCenterFab: false
    }
  ];

  return (
    <nav
      aria-label="Navigasi Utama Leader"
      className="fixed bottom-0 inset-x-0 z-40 bg-[#342b4e]/98 dark:bg-[#160D29]/98 backdrop-blur-xl border-t border-[#4b3e6e]/70 dark:border-[#35105E] shadow-[0_-4px_12px_rgba(0,0,0,0.3)] pb-[env(safe-area-inset-bottom,0px)] transition-colors"
    >
      <div className="max-w-5xl mx-auto grid grid-cols-5 items-end">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          if (tab.isCenterFab) {
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className="relative flex flex-col items-center justify-end pb-2 pt-1 px-1 min-h-[60px] cursor-pointer group select-none"
              >
                <div
                  className={`relative w-12 h-12 rounded-full flex items-center justify-center -mt-6 transition-all duration-150 ${
                    isActive
                      ? 'bg-[#7135b5] text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.45),0_5px_0_#35105e,0_8px_18px_rgba(53,16,94,0.45)] ring-2 ring-[#dab9ff]/60'
                      : 'bg-[#7135b5] text-[#f5eeff] hover:bg-[#58149c] shadow-[inset_0_2px_0_rgba(255,255,255,0.35),0_5px_0_#35105e,0_8px_16px_rgba(53,16,94,0.4)]'
                  } group-active:translate-y-1 group-active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_0_#35105e]`}
                >
                  <Icon className="w-5 h-5" />
                  {tab.badge !== undefined && (
                    <span
                      className={`absolute -top-1 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[9.5px] font-mono leading-none flex items-center justify-center shadow-sm ring-2 ring-[#342b4e] dark:ring-[#160D29] tabular-nums ${
                        tab.badgeColor || 'bg-[#ba1a1a] text-white'
                      }`}
                    >
                      {typeof tab.badge === 'number' && tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] sm:text-[10.5px] font-extrabold tracking-tight text-center mt-1 leading-tight line-clamp-1 uppercase ${
                    isActive ? 'text-white' : 'text-[#dab9ff]'
                  }`}
                >
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.shortLabel}</span>
                </span>
              </button>
            );
          }

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center py-2 px-1 sm:px-2 min-h-[58px] transition-all cursor-pointer group select-none ${
                isActive ? 'text-white' : 'text-[#dab9ff]/80 hover:text-white'
              }`}
            >
              {isActive && (
                <div className="absolute top-0 inset-x-3 sm:inset-x-6 h-[3px] bg-[#dab9ff] rounded-b-full shadow-[0_0_10px_rgba(218,185,255,0.75)]" />
              )}

              <div
                className={`relative p-1.5 rounded-xl transition-all ${
                  isActive
                    ? 'bg-[#7135b5] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_3px_0_#35105e]'
                    : 'text-[#dab9ff]/85 group-hover:bg-white/10 group-hover:text-white'
                } group-active:translate-y-0.5`}
              >
                <Icon className="w-5 h-5" />

                {tab.badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-2 px-1.5 py-0.2 rounded-full text-[9px] font-mono leading-tight shadow-xs tabular-nums ${
                      tab.badgeColor || 'bg-[#7135b5] text-white'
                    }`}
                  >
                    {typeof tab.badge === 'number' && tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>

              <span
                className={`text-[10px] sm:text-[10.5px] font-bold tracking-tight text-center mt-1 leading-tight line-clamp-1 uppercase ${
                  isActive ? 'text-white font-extrabold' : 'text-[#dab9ff]/80'
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
