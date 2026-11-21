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
      className={`grid grid-cols-3 gap-1 p-1 rounded-[16px] bg-[#F7F4FC] dark:bg-[#190C30] border border-[#EEE5FF] dark:border-[#3D1D72] shadow-[inset_0_1px_3px_rgba(48,16,75,0.08)] ${
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
                ? 'bg-gradient-to-b from-[#8648F5] to-[#5424A8] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_2px_0_#30104B,0_4px_10px_rgba(84,36,168,0.28)]'
                : 'text-[#756C86] dark:text-[#C8BAE6] hover:text-[#28203A] dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/5'
            }`}
          >
            <span>{t.label}</span>
            <span
              className={`font-mono text-[10px] tabular-nums px-1.5 py-0.2 rounded-full ${
                isActive
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EEE5FF] dark:bg-[#2F155C] text-[#5424A8] dark:text-[#DDD0FF]'
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
