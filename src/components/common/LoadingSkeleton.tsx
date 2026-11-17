import React from 'react';

export interface LoadingSkeletonProps {
  rows?: number;
  variant?: 'table' | 'cards' | 'kpi';
  className?: string;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  rows = 5,
  variant = 'table',
  className = ''
}) => {
  if (variant === 'kpi') {
    return (
      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 ${className}`}>
        {Array.from({ length: Math.max(2, rows) }).map((_, idx) => (
          <div
            key={idx}
            className="bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#35105E] rounded-2xl p-4 animate-pulse space-y-2.5"
          >
            <div className="h-3 w-20 bg-[#E8DDFF] dark:bg-[#35105E] rounded" />
            <div className="h-7 w-16 bg-[#F3EAFF] dark:bg-[#261942] rounded-lg" />
            <div className="h-2.5 w-24 bg-[#F8F1FF] dark:bg-[#22123F] rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${className}`}>
        {Array.from({ length: rows }).map((_, idx) => (
          <div
            key={idx}
            className="bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#35105E] rounded-2xl p-4 animate-pulse space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="h-4 w-32 bg-[#E8DDFF] dark:bg-[#35105E] rounded" />
              <div className="h-5 w-20 bg-[#F3EAFF] dark:bg-[#261942] rounded-full" />
            </div>
            <div className="h-3.5 w-3/4 bg-[#F8F1FF] dark:bg-[#22123F] rounded" />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="h-3 w-full bg-[#F3EAFF] dark:bg-[#261942] rounded" />
              <div className="h-3 w-full bg-[#F3EAFF] dark:bg-[#261942] rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#35105E] rounded-2xl overflow-hidden ${className}`}
    >
      <div className="h-10 bg-[#F8F1FF] dark:bg-[#251545] border-b border-[#E8DDFF] dark:border-[#35105E] px-4 flex items-center gap-4">
        <div className="h-3 w-20 bg-[#E8DDFF] dark:bg-[#35105E] rounded animate-pulse" />
        <div className="h-3 w-32 bg-[#E8DDFF] dark:bg-[#35105E] rounded animate-pulse" />
        <div className="h-3 w-24 bg-[#E8DDFF] dark:bg-[#35105E] rounded animate-pulse hidden sm:block" />
      </div>
      <div className="divide-y divide-[#E8DDFF]/70 dark:divide-[#35105E]">
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="px-4 py-3.5 flex items-center justify-between gap-4 animate-pulse">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="h-4 w-24 bg-[#F3EAFF] dark:bg-[#261942] rounded shrink-0" />
              <div className="h-4 w-44 bg-[#F8F1FF] dark:bg-[#22123F] rounded" />
            </div>
            <div className="h-5 w-20 bg-[#E8DDFF] dark:bg-[#35105E] rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
};
