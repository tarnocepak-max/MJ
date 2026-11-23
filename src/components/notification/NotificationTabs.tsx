import React from 'react';
import { NotificationTab } from './notificationTypes';

interface NotificationTabsProps {
  activeTab: NotificationTab;
  onChange: (tab: NotificationTab) => void;
  counts: {
    all: number;
    unread: number;
    read: number;
  };
  compact?: boolean;
}

export const NotificationTabs: React.FC<NotificationTabsProps> = ({
  activeTab,
  onChange,
  counts,
  compact = false
}) => {
  const tabs: Array<{ key: NotificationTab; label: string; count: number }> = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'unread', label: 'Unread', count: counts.unread },
    { key: 'read', label: 'Read', count: counts.read }
  ];

  return (
    <div
      role="tablist"
      aria-label="Filter status notifikasi"
      className={`grid grid-cols-3 gap-1 p-1 rounded-[16px] bg-[#EDF3F8] dark:bg-[#190C30] border border-[#DDE6F0] dark:border-[#3D1D72] shadow-[inset_0_1px_3px_rgba(38,54,74,0.06)] dark:shadow-[inset_0_1px_3px_rgba(48,16,75,0.08)] ${
        compact ? 'text-[11px]' : 'text-xs'
      }`}
    >
      {tabs.map(t => {
        const isActive = activeTab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-[12px] font-bold transition-all duration-150 cursor-pointer whitespace-nowrap ${
              compact ? 'py-1.5 px-2' : 'py-2 px-2.5'
            } ${
              isActive
                ? 'bg-gradient-to-b from-[#7769D6] to-[#6657C8] dark:from-[#8648F5] dark:to-[#5424A8] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_2px_0_#5145A6,0_4px_10px_rgba(81,69,166,0.25)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_2px_0_#30104B,0_4px_10px_rgba(84,36,168,0.28)]'
                : 'text-[#52647A] dark:text-[#C8BAE6] hover:text-[#26364A] dark:hover:text-white hover:bg-white/80 dark:hover:bg-white/5'
            }`}
          >
            <span>{t.label}</span>
            <span
              className={`font-mono text-[10px] tabular-nums px-1.5 py-0.2 rounded-full ${
                isActive
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EAE8FF] dark:bg-[#2F155C] text-[#5145A6] dark:text-[#DDD0FF]'
              }`}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
};
