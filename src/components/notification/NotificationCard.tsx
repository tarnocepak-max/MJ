import React from 'react';
import {
  Briefcase,
  AlertTriangle,
  MessageSquare,
  Database,
  CheckCircle2,
  ShieldAlert,
  ArrowUpRight,
  Clock
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  NotificationCategory,
  NotificationItem,
  NotificationPriority,
  PRIORITY_LABELS
} from './notificationTypes';

interface NotificationCardProps {
  item: NotificationItem;
  onSelect: (item: NotificationItem) => void;
  onMarkRead?: (id: string) => void;
  compact?: boolean;
}

const CATEGORY_STYLES: Record<
  NotificationCategory,
  {
    icon: React.ElementType;
    iconBoxClass: string;
    labelClass: string;
  }
> = {
  wo_assignment: {
    icon: Briefcase,
    iconBoxClass:
      'bg-[#EAE8FF] text-[#5145A6] border-[#DCE3F2] dark:bg-[#3A1772] dark:text-[#E1CEFF] dark:border-[#6A35C7]',
    labelClass: 'text-[#5145A6] dark:text-[#C9A8FF]'
  },
  overdue_warning: {
    icon: AlertTriangle,
    iconBoxClass:
      'bg-[#FFF2D9] text-[#C88735] border-[#F2CF95] dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-700/60',
    labelClass: 'text-[#C88735] dark:text-amber-300'
  },
  live_chat: {
    icon: MessageSquare,
    iconBoxClass:
      'bg-[#E7F1FB] text-[#3E81C6] border-[#C6DDF6] dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-700/60',
    labelClass: 'text-[#3E81C6] dark:text-blue-300'
  },
  system_database: {
    icon: Database,
    iconBoxClass:
      'bg-[#DDF4F4] text-[#2E7D8B] border-[#BDE4E8] dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-700/60',
    labelClass: 'text-[#2E7D8B] dark:text-indigo-300'
  },
  success: {
    icon: CheckCircle2,
    iconBoxClass:
      'bg-[#E4F5EC] text-[#218A63] border-[#B7E4CC] dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-700/60',
    labelClass: 'text-[#218A63] dark:text-emerald-300'
  },
  security: {
    icon: ShieldAlert,
    iconBoxClass:
      'bg-[#FCE9EB] text-[#D45B66] border-[#F3C5CA] dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-700/60',
    labelClass: 'text-[#D45B66] dark:text-rose-300'
  }
};

const PRIORITY_BADGES: Record<NotificationPriority, string> = {
  critical:
    'bg-[#FCE9EB] text-[#D45B66] border-[#F3C5CA] dark:bg-rose-950/75 dark:text-rose-200 dark:border-rose-700/70',
  high:
    'bg-[#FFF2D9] text-[#C88735] border-[#F2CF95] dark:bg-amber-950/75 dark:text-amber-200 dark:border-amber-700/70',
  normal:
    'bg-[#EAE8FF] text-[#5145A6] border-[#DCE3F2] dark:bg-[#341668] dark:text-[#DFCFFF] dark:border-[#5D30B5]',
  low:
    'bg-[#EDF3F8] text-[#52647A] border-[#DDE6F0] dark:bg-white/10 dark:text-[#BFB2DC] dark:border-white/15'
};

export function formatRelativeNotificationTime(isoString: string): string {
  const ts = Date.parse(isoString);
  if (!Number.isFinite(ts)) return '-';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  try {
    return new Date(ts).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return `${Math.floor(diffHour / 24)} hr lalu`;
  }
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  item,
  onSelect,
  onMarkRead,
  compact = false
}) => {
  const style = CATEGORY_STYLES[item.category];
  const Icon = style.icon;
  const isUnread = !item.isRead;
  const isPriorityLiveChat = item.category === 'live_chat' && isUnread;

  return (
    <div
      className={`group relative rounded-[18px] border transition-all duration-150 ${
        isPriorityLiveChat
          ? 'bg-gradient-to-br from-white via-white to-[#E7F1FB]/75 dark:from-[#231245] dark:via-[#211548] dark:to-[#16234B] border-[#9EC5EC] dark:border-blue-500/55 shadow-[0_10px_24px_-10px_rgba(62,129,198,0.22),inset_0_1px_0_rgba(255,255,255,0.95)] dark:shadow-[0_10px_24px_-10px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.14)]'
          : isUnread
          ? 'bg-white dark:bg-[#231245] border-[#CFDCE8] dark:border-[#8648F5]/55 shadow-[0_8px_22px_-10px_rgba(81,69,166,0.16),inset_0_1px_0_rgba(255,255,255,0.95)] dark:shadow-[0_10px_24px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]'
          : 'bg-[#F8FAFD]/90 dark:bg-[#190D33]/85 border-[#DDE6F0] dark:border-white/10 opacity-85 hover:opacity-100'
      } hover:-translate-y-[1px] hover:border-[#6657C8]/60 dark:hover:border-[#8648F5]/70 active:translate-y-[0.5px]`}
    >
      {/* Left accent stripe for unread notifications */}
      {isUnread && (
        <span
          aria-hidden="true"
          className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${
            isPriorityLiveChat
              ? 'bg-gradient-to-b from-[#3E81C6] via-[#6657C8] to-[#5145A6] dark:from-blue-500 dark:via-[#8648F5] dark:to-[#5424A8]'
              : 'bg-gradient-to-b from-[#65B8C4] via-[#6657C8] to-[#5145A6] dark:from-[#8648F5] dark:to-[#5424A8]'
          }`}
        />
      )}

      <button
        type="button"
        onClick={() => onSelect(item)}
        className={`w-full text-left flex items-start gap-3 cursor-pointer ${
          compact ? 'p-3 pl-3.5' : 'p-3.5 pl-4'
        }`}
      >
        {/* Semantic Category Icon Tile */}
        <div
          className={`relative w-9 h-9 rounded-[13px] border flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:shadow-none ${style.iconBoxClass}`}
        >
          <Icon className="w-4 h-4" />
          {isPriorityLiveChat && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#3E81C6] dark:bg-blue-500 ring-2 ring-white dark:ring-[#231245]"
            />
          )}
        </div>

        {/* Main Hierarchy: Category + Priority, Title, Short Description, Timestamp */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`text-[10px] font-extrabold uppercase tracking-wider truncate ${style.labelClass}`}>
                {CATEGORY_LABELS[item.category]}
              </span>
              {isPriorityLiveChat && (
                <span className="px-1.5 py-0.5 rounded-[6px] bg-[#E7F1FB] dark:bg-blue-950/80 text-[#3E81C6] dark:text-blue-300 border border-[#C6DDF6] dark:border-blue-700/70 text-[9px] font-extrabold uppercase tracking-wide leading-none shrink-0">
                  Prioritas
                </span>
              )}
              {item.woNumber && (
                <span className="font-mono text-[10px] font-bold text-[#8492A5] dark:text-[#BFB2DC] truncate">
                  · {item.woNumber}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`px-1.5 py-0.5 rounded-md border text-[9.5px] font-extrabold uppercase tracking-wide leading-none ${PRIORITY_BADGES[item.priority]}`}
              >
                {PRIORITY_LABELS[item.priority]}
              </span>
              {isUnread && (
                <span
                  title="Belum dibaca"
                  className={`w-2 h-2 rounded-full ring-2 ring-[#EAE8FF] dark:ring-[#30104B] shrink-0 ${
                    isPriorityLiveChat ? 'bg-[#3E81C6] dark:bg-blue-500' : 'bg-[#6657C8] dark:bg-[#8648F5]'
                  }`}
                />
              )}
            </div>
          </div>

          <div className="flex items-start justify-between gap-2">
            <h4
              className={`text-xs font-extrabold leading-snug line-clamp-2 ${
                isUnread
                  ? 'text-[#26364A] dark:text-white'
                  : 'text-[#52647A] dark:text-[#D5C9EE]'
              }`}
            >
              {item.title}
            </h4>
            {item.target && (
              <ArrowUpRight className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#BFB2DC] group-hover:text-[#5145A6] dark:group-hover:text-[#C9A8FF] shrink-0 mt-0.5 transition-colors" />
            )}
          </div>

          <p className="text-[11px] text-[#52647A] dark:text-[#BFB2DC] leading-relaxed line-clamp-2">
            {item.description}
          </p>

          <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] font-medium text-[#8492A5] dark:text-[#A99BC8]">
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <Clock className="w-3 h-3" />
              <span>{formatRelativeNotificationTime(item.timestamp)}</span>
              {item.metaLabel ? <span>· {item.metaLabel}</span> : null}
            </span>

            {isUnread && onMarkRead && (
              <span
                role="button"
                tabIndex={0}
                onClick={e => {
                  e.stopPropagation();
                  onMarkRead(item.id);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onMarkRead(item.id);
                  }
                }}
                className="text-[10px] font-bold text-[#5145A6] dark:text-[#C9A8FF] hover:underline px-1.5 py-0.5 rounded-md hover:bg-[#EAE8FF]/70 dark:hover:bg-[#3A1772]"
              >
                Tandai dibaca
              </span>
            )}
          </div>
        </div>
      </button>
    </div>
  );
};
