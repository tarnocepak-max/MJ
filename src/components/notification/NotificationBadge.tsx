import React from 'react';

interface NotificationBadgeProps {
  count: number;
  hasCritical?: boolean;
  className?: string;
}

export const NotificationBadge: React.FC<NotificationBadgeProps> = ({
  count,
  hasCritical = false,
  className = ''
}) => {
  if (count <= 0) return null;

  const display = count > 99 ? '99+' : count > 9 ? '9+' : String(count);

  return (
    <span
      aria-label={`${count} notifikasi belum dibaca`}
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-extrabold tabular-nums text-white ring-2 ring-white dark:ring-[#160D29] shadow-[0_3px_8px_rgba(38,54,74,0.28)] dark:shadow-[0_3px_8px_rgba(48,16,75,0.45)] ${
        hasCritical
          ? 'bg-gradient-to-b from-[#E06D77] to-[#D45B66] dark:from-[#EF4444] dark:to-[#DC2626] mj-notif-badge-critical'
          : 'bg-gradient-to-b from-[#7769D6] to-[#6657C8] dark:from-[#8648F5] dark:to-[#5424A8]'
      } ${className}`}
    >
      {display}
    </span>
  );
};
