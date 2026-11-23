import React from 'react';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryAction?: React.ReactNode;
  compact?: boolean;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryAction,
  compact = false,
  className = ''
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center bg-white/88 backdrop-blur-md dark:backdrop-blur-none dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] rounded-2xl ${
        compact ? 'px-4 py-8' : 'px-6 py-12'
      } ${className}`}
    >
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#DDF4F4] to-[#EAE8FF] dark:from-[#261942] dark:to-[#261942] border border-[#CFDCE8] dark:border-[#4B386B] text-[#6657C8] dark:text-[#DAB9FF] flex items-center justify-center mb-3 shadow-xs">
        {icon || <Inbox className="w-6 h-6" />}
      </div>
      <h3 className="text-sm font-bold text-[#26364A] dark:text-white">{title}</h3>
      {description && (
        <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] max-w-md mt-1 leading-relaxed">
          {description}
        </p>
      )}
      {(actionLabel || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="btn-3d-primary px-4 py-2 min-h-[40px] rounded-xl text-xs cursor-pointer"
            >
              {actionLabel}
            </button>
          )}
          {secondaryAction}
        </div>
      )}
    </div>
  );
};
