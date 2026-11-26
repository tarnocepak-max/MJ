import React from 'react';
import { MoraRepublicRocket } from './MoraRepublicBrandVisuals';
import { Sparkles } from 'lucide-react';

export interface GlobalRefreshAnimationProps {
  isVisible: boolean;
  message?: string;
  subMessage?: string;
}

export const GlobalRefreshAnimation: React.FC<GlobalRefreshAnimationProps> = ({
  isVisible,
  message = 'MEMPERBARUI DATA...',
  subMessage = 'Menyelaraskan data Work Order & Schedule'
}) => {
  if (!isVisible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[9997] flex items-center justify-center p-4 bg-[#F4F7FB]/65 dark:bg-[#070B24]/70 backdrop-blur-sm pointer-events-none transition-opacity duration-200 animate-in fade-in"
    >
      <div className="relative overflow-hidden flex flex-col items-center justify-center text-center p-6 sm:p-7 rounded-2xl bg-white/95 dark:bg-[#120C2F]/92 border border-[#D8CCF3] dark:border-purple-400/35 shadow-[0_24px_56px_-12px_rgba(79,70,229,0.22)] dark:shadow-2xl max-w-xs sm:max-w-sm w-full mx-auto select-none pointer-events-auto transform animate-in zoom-in-95 duration-200">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#22D3EE] via-[#8B5CF6] to-[#EC4899]" />

        {/* Subtle Purple + Lilac Star Particles */}
        <span
          aria-hidden="true"
          className="mj-rocket-star-particle absolute top-6 left-10 w-1.5 h-1.5 rounded-full bg-[#C084FC]"
        />
        <span
          aria-hidden="true"
          className="mj-rocket-star-particle-delay absolute top-10 right-10 w-1.5 h-1.5 rounded-full bg-[#22D3EE]"
        />

        {/* Animated Rocket Launch Emblem */}
        <div className="relative flex items-center justify-center my-1">
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full blur-lg opacity-75 pointer-events-none"
            style={{
              background:
                'radial-gradient(circle, rgba(139, 92, 246, 0.38) 0%, rgba(34, 211, 238, 0.18) 58%, transparent 75%)',
              transform: 'scale(1.35)'
            }}
          />
          <div className="mj-rocket-launch-emblem relative flex items-center justify-center">
            <MoraRepublicRocket size="sm" orientation="upright" withTrail={true} />
            <div
              aria-hidden="true"
              className="mj-rocket-exhaust-glow absolute -bottom-2 left-1/2 -translate-x-1/2 w-6 h-4 rounded-full blur-sm pointer-events-none"
            />
          </div>
        </div>

        {/* Brand Text */}
        <div className="mt-2.5 space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-[#6D28D9] dark:text-cyan-300 text-[10.5px] font-mono tracking-widest uppercase font-bold">
            <Sparkles className="w-3 h-3 text-[#0891B2] dark:text-cyan-300 animate-pulse" />
            <span>MORAJAWS ROCKET SYNC</span>
          </div>
          <h4 className="text-xs sm:text-sm font-black tracking-wider text-[#1E1B3A] dark:text-white uppercase">
            {message}
          </h4>
          <p className="text-[11px] text-[#52647A] dark:text-purple-200/80 font-medium">
            {subMessage}
          </p>
        </div>

        {/* Neon Fiber Optic Sweep Bar */}
        <div className="w-full mt-4 h-1.5 bg-[#EDF3F8] dark:bg-black/40 rounded-full overflow-hidden border border-[#DDE6F0] dark:border-purple-500/30">
          <div className="w-full h-full mj-shimmer bg-gradient-to-r from-[#22D3EE] via-[#8B5CF6] to-[#EC4899] rounded-full" />
        </div>

        <div className="mt-3 flex items-center justify-center gap-1.5 opacity-85">
          <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6] animate-pulse" />
          <span className="text-[9px] font-bold tracking-wider uppercase text-[#6657C8] dark:text-purple-300">
            MoraRepublic Rocket Sync Engine
          </span>
        </div>
      </div>
    </div>
  );
};
