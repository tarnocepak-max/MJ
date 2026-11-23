import React from 'react';
import { MoraJawsLogo } from './MoraJawsLogo';
import { MoraRepublicRocket, NeonFiberOpticTrails } from './MoraRepublicBrandVisuals';

export interface GlobalLoadingAnimationProps {
  fullScreen?: boolean;
  title?: string;
  subtitle?: string;
  progressPercent?: number; // Optional 0-100
  className?: string;
}

export const GlobalLoadingAnimation: React.FC<GlobalLoadingAnimationProps> = ({
  fullScreen = false,
  title = 'LOADING APPLICATION...',
  subtitle = 'Synchronizing your workspace',
  progressPercent,
  className = ''
}) => {
  const content = (
    <div
      role="status"
      aria-live="polite"
      className={`relative z-10 flex flex-col items-center justify-center text-center p-6 sm:p-8 rounded-2xl bg-white/92 dark:bg-[#120C2F]/90 backdrop-blur-2xl border border-[#D8CCF3] dark:border-purple-400/35 shadow-[0_24px_60px_-14px_rgba(79,70,229,0.22)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.55)] max-w-sm sm:max-w-md w-full mx-4 overflow-hidden select-none animate-in fade-in zoom-in-95 duration-200 ${className}`}
    >
      {/* Top Neon Fiber Accent Border */}
      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#22D3EE] via-[#8B5CF6] to-[#EC4899]" />

      {/* Ambient Neon Fiber Trails & Glows */}
      <NeonFiberOpticTrails variant="subtle" className="absolute inset-x-0 bottom-0 h-28" />
      <div className="absolute -top-12 -right-12 w-40 h-40 bg-cyan-400/15 dark:bg-purple-600/25 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-purple-500/15 dark:bg-indigo-600/25 rounded-full blur-2xl pointer-events-none" />

      {/* Central Rotating Futuristic MoraJaws Symbol + Orbital Ring */}
      <div className="relative flex items-center justify-center my-3">
        <div
          className="absolute inset-0 rounded-full blur-md opacity-70 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(139, 92, 246, 0.35) 0%, rgba(34, 211, 238, 0.20) 52%, transparent 72%)',
            transform: 'scale(1.35)'
          }}
        />

        <svg
          className="absolute w-24 h-24 -inset-2 pointer-events-none"
          viewBox="0 0 100 100"
          style={{ animation: 'morajaws-spin-clockwise 3.4s linear infinite' }}
        >
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="rgba(139, 92, 246, 0.18)"
            strokeWidth="2.5"
          />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="url(#loadingRingGrad)"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeDasharray="78 200"
          />
          <defs>
            <linearGradient id="loadingRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22D3EE" />
              <stop offset="50%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#EC4899" />
            </linearGradient>
          </defs>
        </svg>

        <MoraJawsLogo variant="symbol" size="lg" isRotating={true} withGlow={false} />
      </div>

      {/* Brand Wordmark + Title */}
      <div className="relative z-10 mt-4 space-y-1 flex flex-col items-center">
        <div className="font-display font-extrabold text-base tracking-tight">
          <span className="text-[#1E1B3A] dark:text-white">Mora</span>
          <span className="bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9] dark:from-[#C084FC] dark:to-[#8B5CF6] bg-clip-text text-transparent">
            Jaws
          </span>
        </div>
        <h4 className="text-xs sm:text-sm font-bold tracking-wider text-[#5145A6] dark:text-purple-200 uppercase">
          {title}
        </h4>
        <p className="text-[11px] text-[#52647A] dark:text-purple-200/80 font-medium tracking-wide">
          {subtitle}
        </p>
      </div>

      {/* Neon Fiber Optic Progress Bar */}
      <div className="relative z-10 w-full mt-5">
        <div className="h-1.5 w-full bg-[#EDF3F8] dark:bg-black/50 rounded-full overflow-hidden border border-[#DDE6F0] dark:border-purple-500/30 relative">
          {progressPercent !== undefined ? (
            <div
              className="h-full bg-gradient-to-r from-[#22D3EE] via-[#8B5CF6] to-[#EC4899] transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
            />
          ) : (
            <div className="absolute inset-0 w-full h-full mj-shimmer bg-gradient-to-r from-[#22D3EE] via-[#8B5CF6] to-[#EC4899] rounded-full" />
          )}
        </div>

        {progressPercent !== undefined && (
          <span className="text-[10px] font-mono text-[#5145A6] dark:text-purple-300/90 mt-1 block font-semibold">
            {Math.round(progressPercent)}%
          </span>
        )}
      </div>

      {/* Subtle MoraRepublic Ecosystem Footer */}
      <div className="relative z-10 mt-4 pt-3 border-t border-[#DDE6F0]/80 dark:border-white/10 w-full flex items-center justify-center gap-2">
        <MoraRepublicRocket size="xs" withTrail={false} />
        <span className="text-[9.5px] font-bold tracking-wider uppercase text-[#6657C8] dark:text-purple-300/80">
          Powered by MoraRepublic Technology
        </span>
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div
        className="fixed inset-0 z-[9998] flex items-center justify-center bg-[#F4F7FB]/80 dark:bg-[#070B24]/85 backdrop-blur-md animate-in fade-in duration-200"
        aria-busy="true"
      >
        {content}
      </div>
    );
  }

  return content;
};
