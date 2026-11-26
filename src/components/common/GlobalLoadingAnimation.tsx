import React from 'react';
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
      className={`relative z-10 flex flex-col items-center justify-center text-center p-6 sm:p-8 rounded-2xl bg-white/94 dark:bg-[#120C2F]/92 backdrop-blur-2xl border border-[#D8CCF3] dark:border-purple-400/35 shadow-[0_24px_60px_-14px_rgba(79,70,229,0.22)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.55)] max-w-sm sm:max-w-md w-full mx-4 overflow-hidden select-none animate-in fade-in zoom-in-95 duration-200 ${className}`}
    >
      {/* Top Neon Fiber Accent Border */}
      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#22D3EE] via-[#8B5CF6] to-[#EC4899]" />

      {/* Ambient Neon Fiber Trails & Glows */}
      <NeonFiberOpticTrails variant="subtle" className="absolute inset-x-0 bottom-0 h-28" />
      <div className="absolute -top-12 -right-12 w-40 h-40 bg-cyan-400/18 dark:bg-purple-600/25 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-purple-500/18 dark:bg-indigo-600/25 rounded-full blur-2xl pointer-events-none" />

      {/* Floating Lilac Star Particles */}
      <span
        aria-hidden="true"
        className="mj-rocket-star-particle absolute top-8 left-12 w-2 h-2 rounded-full bg-[#C084FC] shadow-[0_0_8px_rgba(192,132,252,0.8)]"
      />
      <span
        aria-hidden="true"
        className="mj-rocket-star-particle-delay absolute top-14 right-14 w-1.5 h-1.5 rounded-full bg-[#22D3EE] shadow-[0_0_8px_rgba(34,211,238,0.85)]"
      />
      <span
        aria-hidden="true"
        className="mj-rocket-star-particle absolute bottom-24 left-16 w-1.5 h-1.5 rounded-full bg-[#D8B4FE]"
      />

      {/* Central MoraJaws Rocket Launch Hero */}
      <div className="relative flex flex-col items-center justify-center my-2">
        {/* Launchpad Purple + Aqua Ambient Halo */}
        <div
          className="absolute inset-0 rounded-full blur-xl opacity-80 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(139, 92, 246, 0.42) 0%, rgba(34, 211, 238, 0.24) 55%, transparent 74%)',
            transform: 'scale(1.45)'
          }}
        />

        {/* Orbital Launch Ring */}
        <div className="relative w-28 h-28 flex items-center justify-center">
          <svg
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 112 112"
            style={{ animation: 'morajaws-spin-clockwise 4.5s linear infinite' }}
          >
            <circle
              cx="56"
              cy="56"
              r="50"
              fill="none"
              stroke="rgba(139, 92, 246, 0.16)"
              strokeWidth="2"
              strokeDasharray="6 6"
            />
            <circle
              cx="56"
              cy="56"
              r="50"
              fill="none"
              stroke="url(#rocketLaunchRingGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="72 242"
            />
            <defs>
              <linearGradient id="rocketLaunchRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#22D3EE" />
                <stop offset="50%" stopColor="#8B5CF6" />
                <stop offset="100%" stopColor="#EC4899" />
              </linearGradient>
            </defs>
          </svg>

          {/* Animated Ascending Rocket + Exhaust Thruster Glow */}
          <div className="mj-rocket-launch-emblem relative flex items-center justify-center">
            <MoraRepublicRocket size="md" orientation="upright" withTrail={true} />
            <div
              aria-hidden="true"
              className="mj-rocket-exhaust-glow absolute -bottom-3 left-1/2 -translate-x-1/2 w-8 h-5 rounded-full blur-md pointer-events-none"
            />
          </div>
        </div>
      </div>

      {/* Brand Wordmark + Title */}
      <div className="relative z-10 mt-2 space-y-1 flex flex-col items-center">
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

      {/* Neon Fiber Optic Rocket Trajectory Progress Bar */}
      <div className="relative z-10 w-full mt-5">
        <div className="h-2 w-full bg-[#EDF3F8] dark:bg-black/50 rounded-full overflow-hidden border border-[#DDE6F0] dark:border-purple-500/30 relative">
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
        <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6] animate-pulse" />
        <span className="text-[9.5px] font-bold tracking-wider uppercase text-[#6657C8] dark:text-purple-300/80">
          Powered by MoraRepublic Rocket Engine
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
