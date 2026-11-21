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
      badgeTone: 'bg-[#58149C] dark:bg-[#7135B5] text-white'
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
      className="fixed bottom-0 inset-x-0 z-40 sm:pointer-events-none sm:px-4 sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="sm:pointer-events-auto max-w-2xl mx-auto bg-[#fbf6ff]/78 dark:bg-[#1a103c]/68 backdrop-blur-2xl border-t sm:border border-[#E8DDFF]/80 dark:border-white/[0.14] sm:rounded-2xl shadow-[0_-4px_18px_rgba(31,22,56,0.08)] sm:shadow-[0_12px_32px_rgba(31,22,56,0.16)] dark:shadow-[0_18px_40px_rgba(0,0,0,0.45)] px-1.5 py-1 sm:p-1.5 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:pb-1.5 grid grid-cols-5 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center py-1.5 px-1 rounded-xl min-h-[48px] transition-all cursor-pointer select-none group active:scale-95 ${
                isActive
                  ? 'bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_2px_6px_rgba(88,20,156,0.14)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_8px_rgba(0,0,0,0.45)]'
                  : 'text-[#4B4452] dark:text-[#CEC0E8] hover:bg-[#F8F1FF] dark:hover:bg-[#261942] hover:text-[#1F1638] dark:hover:text-white'
              }`}
            >
              {isActive && (
                <span className="absolute top-0 inset-x-3 h-[3px] bg-[#58149C] dark:bg-[#A380FE] rounded-b-full sm:hidden" />
              )}
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-[19px] h-[19px] transition-transform ${
                    isActive ? 'scale-105 text-[#58149C] dark:text-[#DAB9FF]' : 'text-current'
                  }`}
                />
                {tab.badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-3 px-1 min-w-[16px] h-[15px] rounded-full text-[8.5px] font-mono font-extrabold leading-none flex items-center justify-center ring-2 ring-[#fdf7ff] dark:ring-[#160D29] tabular-nums ${
                      tab.badgeTone || 'bg-[#58149C] text-white'
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
