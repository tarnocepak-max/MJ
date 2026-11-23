import React from 'react';
import { BarChart3, UserCheck, ArrowRightLeft, FileText, MapPin } from 'lucide-react';

export type LeaderTabType =
  | 'progress_dashboard'
  | 'wo_assignment'
  | 'reassign_wo'
  | 'contractor_recap'
  | 'monitoring_maps';

interface LeaderBottomNavProps {
  activeTab: LeaderTabType;
  onTabChange: (tab: LeaderTabType) => void;
  unassignedCount?: number;
}

export const LeaderBottomNav: React.FC<LeaderBottomNavProps> = ({
  activeTab,
  onTabChange,
  unassignedCount = 0
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
      id: 'progress_dashboard',
      label: 'Progress',
      desktopLabel: 'Progress WO',
      icon: BarChart3,
      badge: 'LIVE',
      badgeTone: 'bg-[#218A63] dark:bg-[#16A36A] text-white'
    },
    {
      id: 'wo_assignment',
      label: 'Assign',
      desktopLabel: 'Assign WO',
      icon: UserCheck,
      badge: unassignedCount > 0 ? unassignedCount : undefined,
      badgeTone: 'bg-[#D45B66] dark:bg-[#ba1a1a] text-white'
    },
    {
      id: 'reassign_wo',
      label: 'Reassign',
      desktopLabel: 'Reassign WO',
      icon: ArrowRightLeft
    },
    {
      id: 'contractor_recap',
      label: 'Rekap',
      desktopLabel: 'Rekap WO',
      icon: FileText
    },
    {
      id: 'monitoring_maps',
      label: 'Maps',
      desktopLabel: 'Maps',
      icon: MapPin
    }
  ];

  return (
    <nav
      aria-label="Navigasi Utama Leader"
      className="fixed bottom-[max(0.65rem,env(safe-area-inset-bottom))] inset-x-0 z-40 px-3 sm:px-4 pointer-events-none select-none"
    >
      <div className="pointer-events-auto max-w-xl mx-auto mj-glass-capsule rounded-[28px] p-1.5 grid grid-cols-5 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center py-1.5 px-1 rounded-full min-h-[48px] cursor-pointer select-none group ${
                isActive
                  ? 'mj-floating-nav-pill-active text-white'
                  : 'mj-floating-nav-pill-idle'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-[18px] h-[18px] transition-transform ${
                    isActive ? 'scale-105 text-white' : 'text-current'
                  }`}
                />
                {tab.badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-3 px-1 min-w-[16px] h-[15px] rounded-full text-[8.5px] font-mono font-extrabold leading-none flex items-center justify-center ring-2 ${
                      isActive ? 'ring-[#6657C8] dark:ring-[#6d28d9]' : 'ring-[#F4F7FB] dark:ring-[#160d33]'
                    } tabular-nums ${tab.badge === 'LIVE' ? 'mj-glow-dot ' : ''}${
                      tab.badgeTone || 'bg-[#6657C8] dark:bg-[#58149C] text-white'
                    }`}
                  >
                    {typeof tab.badge === 'number' && tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>

              <span
                className={`mt-0.5 text-[10px] leading-tight text-center truncate max-w-full ${
                  isActive ? 'font-extrabold tracking-tight text-white' : 'font-semibold'
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
