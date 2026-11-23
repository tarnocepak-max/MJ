import React from 'react';
import { Search, X, Filter, Calendar, RotateCcw } from 'lucide-react';
import {
  CATEGORY_LABELS,
  NotificationCategory,
  NotificationDateFilter,
  NotificationFilterState,
  NotificationPriority,
  PRIORITY_LABELS
} from './notificationTypes';

interface NotificationFilterProps {
  filters: NotificationFilterState;
  onChange: (next: Partial<NotificationFilterState>) => void;
  onReset: () => void;
  availableCategories: NotificationCategory[];
  compact?: boolean;
}

export const NotificationFilter: React.FC<NotificationFilterProps> = ({
  filters,
  onChange,
  onReset,
  availableCategories,
  compact = false
}) => {
  const hasFilterActive =
    filters.category !== 'all' ||
    filters.priority !== 'all' ||
    filters.dateRange !== 'all' ||
    filters.search.trim().length > 0;

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#BFB2DC]">
            <Filter className="w-3 h-3 text-[#6657C8] dark:text-[#C59CFF]" />
            <span>Kategori &amp; Prioritas</span>
          </div>
          {hasFilterActive && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 text-[10.5px] font-bold text-[#5145A6] dark:text-[#C59CFF] hover:underline cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Reset</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <select
            aria-label="Filter kategori notifikasi"
            value={filters.category}
            onChange={e => onChange({ category: e.target.value as NotificationFilterState['category'] })}
            className="flex-1 min-w-[130px] px-2.5 py-1.5 rounded-[12px] text-[11px] font-semibold bg-[#F8FAFD] dark:bg-[#190C30] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#492588] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/30 dark:focus:ring-[#8648F5]/40 cursor-pointer"
          >
            <option value="all">Semua Kategori</option>
            {availableCategories.map(cat => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter prioritas notifikasi"
            value={filters.priority}
            onChange={e => onChange({ priority: e.target.value as NotificationFilterState['priority'] })}
            className="flex-1 min-w-[115px] px-2.5 py-1.5 rounded-[12px] text-[11px] font-semibold bg-[#F8FAFD] dark:bg-[#190C30] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#492588] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/30 dark:focus:ring-[#8648F5]/40 cursor-pointer"
          >
            <option value="all">Semua Prioritas</option>
            {(['critical', 'high', 'normal', 'low'] as NotificationPriority[]).map(prio => (
              <option key={prio} value={prio}>
                {PRIORITY_LABELS[prio]}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Search Notification Input */}
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-[#8492A5] dark:text-[#BBAEE0] absolute left-3 pointer-events-none" />
        <input
          type="text"
          value={filters.search}
          onChange={e => onChange({ search: e.target.value })}
          placeholder="Cari nomor WO, pelanggan, pesan, atau kategori..."
          aria-label="Cari notifikasi"
          className="w-full pl-9 pr-9 py-2 rounded-[14px] text-xs font-medium bg-white dark:bg-[#190C30] text-[#26364A] dark:text-white placeholder:text-[#8492A5] dark:placeholder:text-[#9686BA] border border-[#DDE6F0] dark:border-[#492588] shadow-[inset_0_1px_3px_rgba(38,54,74,0.05)] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/30 dark:focus:ring-[#8648F5]/45 transition-all"
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => onChange({ search: '' })}
            aria-label="Bersihkan pencarian notifikasi"
            className="absolute right-2.5 p-1 rounded-full text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Category, Priority, Date Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select
          aria-label="Filter kategori notifikasi"
          value={filters.category}
          onChange={e => onChange({ category: e.target.value as NotificationFilterState['category'] })}
          className="px-2.5 py-2 rounded-[12px] text-[11px] font-semibold bg-white dark:bg-[#190C30] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#492588] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/30 dark:focus:ring-[#8648F5]/40 cursor-pointer"
        >
          <option value="all">Kategori: Semua</option>
          {availableCategories.map(cat => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter prioritas notifikasi"
          value={filters.priority}
          onChange={e => onChange({ priority: e.target.value as NotificationFilterState['priority'] })}
          className="px-2.5 py-2 rounded-[12px] text-[11px] font-semibold bg-white dark:bg-[#190C30] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#492588] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/30 dark:focus:ring-[#8648F5]/40 cursor-pointer"
        >
          <option value="all">Prioritas: Semua</option>
          {(['critical', 'high', 'normal', 'low'] as NotificationPriority[]).map(prio => (
            <option key={prio} value={prio}>
              Prioritas: {PRIORITY_LABELS[prio]}
            </option>
          ))}
        </select>

        <div className="relative flex items-center">
          <Calendar className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#C59CFF] absolute left-2.5 pointer-events-none" />
          <select
            aria-label="Filter tanggal notifikasi"
            value={filters.dateRange}
            onChange={e => onChange({ dateRange: e.target.value as NotificationDateFilter })}
            className="w-full pl-8 pr-2.5 py-2 rounded-[12px] text-[11px] font-semibold bg-white dark:bg-[#190C30] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#492588] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/30 dark:focus:ring-[#8648F5]/40 cursor-pointer"
          >
            <option value="all">Semua Tanggal</option>
            <option value="today">Hari Ini (WIB)</option>
            <option value="last_7_days">7 Hari Terakhir</option>
          </select>
        </div>
      </div>

      {hasFilterActive && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#5145A6] dark:text-[#C59CFF] hover:underline cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Semua Filter</span>
          </button>
        </div>
      )}
    </div>
  );
};
