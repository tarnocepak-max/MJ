import React, { useState } from 'react';

export interface MoraRepublicRocketProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  orientation?: 'diagonal' | 'upright';
  withTrail?: boolean;
  className?: string;
}

const ROCKET_SIZES: Record<'xs' | 'sm' | 'md' | 'lg', { width: number; height: number }> = {
  xs: { width: 42, height: 32 },
  sm: { width: 64, height: 48 },
  md: { width: 96, height: 72 },
  lg: { width: 140, height: 105 }
};

export const MoraRepublicRocket: React.FC<MoraRepublicRocketProps> = ({
  size = 'md',
  orientation = 'diagonal',
  withTrail = true,
  className = ''
}) => {
  const uid = React.useId().replace(/:/g, '');
  const dims = ROCKET_SIZES[size];
  const rotateDeg = orientation === 'upright' ? -42 : 0;

  return (
    <svg
      viewBox="0 0 220 165"
      width={dims.width}
      height={dims.height}
      className={`select-none overflow-visible ${className}`}
      role="img"
      aria-label="MoraRepublic Rocket Emblem"
    >
      <defs>
        <linearGradient id={`mrHull-${uid}`} x1="70" y1="68" x2="180" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E2E8F0" />
          <stop offset="32%" stopColor="#FFFFFF" />
          <stop offset="75%" stopColor="#F8FAFC" />
          <stop offset="100%" stopColor="#CBD5E1" />
        </linearGradient>
        <linearGradient id={`mrViolet-${uid}`} x1="140" y1="20" x2="195" y2="75" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="55%" stopColor="#6D28D9" />
          <stop offset="100%" stopColor="#3B0764" />
        </linearGradient>
        <linearGradient id={`mrExhaust-${uid}`} x1="10" y1="145" x2="95" y2="95" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity="0" />
          <stop offset="35%" stopColor="#38BDF8" stopOpacity="0.45" />
          <stop offset="72%" stopColor="#C084FC" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.98" />
        </linearGradient>
        <linearGradient id={`mrPlasma-${uid}`} x1="0" y1="158" x2="92" y2="98" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EC4899" stopOpacity="0" />
          <stop offset="50%" stopColor="#EC4899" stopOpacity="0.48" />
          <stop offset="100%" stopColor="#FDE047" stopOpacity="0.9" />
        </linearGradient>
        <filter id={`mrBlur-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>

      <g transform={`rotate(${rotateDeg} 115 80)`}>
        {/* Neon Fiber Exhaust Trail */}
        {withTrail && (
          <g className="mj-fiber-pulse">
            <path
              d="M 86 98 C 60 116, 30 132, 4 148 C 34 138, 66 125, 96 108 Z"
              fill={`url(#mrExhaust-${uid})`}
              filter={`url(#mrBlur-${uid})`}
            />
            <path
              d="M 90 101 C 68 116, 44 127, 18 139 C 45 130, 72 119, 94 106 Z"
              fill={`url(#mrPlasma-${uid})`}
            />
            <path
              d="M 92 98 C 72 112, 48 124, 16 138"
              stroke="#67E8F9"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeOpacity="0.7"
              fill="none"
            />
          </g>
        )}

        {/* Top Wing Fin */}
        <path
          d="M 118 57 L 89 48 C 85 47, 84 51, 88 55 L 106 72 Z"
          fill={`url(#mrViolet-${uid})`}
          stroke="#E9D5FF"
          strokeWidth="0.8"
          strokeOpacity="0.45"
        />

        {/* Bottom Wing Fin */}
        <path
          d="M 136 90 L 122 122 C 120 126, 115 125, 114 120 L 114 96 Z"
          fill={`url(#mrViolet-${uid})`}
          stroke="#E9D5FF"
          strokeWidth="0.8"
          strokeOpacity="0.45"
        />

        {/* Thruster Nozzle Collar */}
        <path
          d="M 84 90 L 98 106 L 109 98 L 93 80 Z"
          fill="#4C1D95"
          stroke="#C4B5FD"
          strokeWidth="1"
        />
        <ellipse cx="90" cy="98" rx="6" ry="11" transform="rotate(-38 90 98)" fill="#F5D0FE" />

        {/* Metallic White Streamlined Hull */}
        <path
          d="M 91 83 C 115 57, 152 30, 198 18 C 194 45, 169 78, 111 102 Z"
          fill={`url(#mrHull-${uid})`}
          stroke="#C4B5FD"
          strokeWidth="1"
          strokeOpacity="0.75"
        />

        {/* Violet Nose Cone */}
        <path
          d="M 164 31 C 177 24, 189 20, 199 17 C 197 27, 192 38, 183 49 C 175 44, 169 38, 164 31 Z"
          fill={`url(#mrViolet-${uid})`}
        />
        <path
          d="M 166 32 C 174 28, 184 24, 192 21"
          stroke="#FFFFFF"
          strokeOpacity="0.5"
          strokeWidth="1.4"
          strokeLinecap="round"
        />

        {/* Center Spine Fin */}
        <path
          d="M 96 95 L 78 108 C 75 110, 77 112, 82 110 L 105 99 Z"
          fill="#7C3AED"
        />

        {/* Circular M Badge Near Nose */}
        <g transform="translate(159, 44) rotate(-32)">
          <circle cx="0" cy="0" r="10.5" fill="#1E1B4B" stroke="#38BDF8" strokeWidth="1.5" />
          <path
            d="M -5.5 4 L -4 -3.8 C -3.6 -4.6, -2.5 -4.8, -1.8 -3.8 L 0 -1 L 1.8 -3.8 C 2.5 -4.8, 3.6 -4.6, 4 -3.8 L 5.5 4 L 3.3 4 L 2.5 -0.2 L 0.5 2 C 0.2 2.4, -0.2 2.4, -0.5 2 L -2.5 -0.2 L -3.3 4 Z"
            fill="#FFFFFF"
          />
        </g>

        {/* MoraRepublic Hull Branding */}
        <text
          x="130"
          y="70"
          transform="rotate(-33 130 70)"
          fill="#311068"
          fontSize="9.2"
          fontWeight="800"
          fontFamily="Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
          textAnchor="middle"
          letterSpacing="-0.2"
        >
          MoraRepublic
        </text>
      </g>
    </svg>
  );
};

export interface NeonFiberOpticTrailsProps {
  variant?: 'subtle' | 'hero';
  className?: string;
}

export const NeonFiberOpticTrails: React.FC<NeonFiberOpticTrailsProps> = ({
  variant = 'subtle',
  className = ''
}) => {
  const uid = React.useId().replace(/:/g, '');
  const opacityClass = variant === 'hero' ? 'opacity-80 dark:opacity-90' : 'opacity-35 dark:opacity-55';

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 320"
      preserveAspectRatio="none"
      className={`pointer-events-none select-none ${opacityClass} ${className}`}
    >
      <defs>
        <linearGradient id={`fiberCyan-${uid}`} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#EC4899" stopOpacity="0.1" />
          <stop offset="40%" stopColor="#22D3EE" stopOpacity="0.85" />
          <stop offset="75%" stopColor="#8B5CF6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#EC4899" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id={`fiberPurple-${uid}`} x1="0%" y1="80%" x2="100%" y2="10%">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.05" />
          <stop offset="45%" stopColor="#EC4899" stopOpacity="0.72" />
          <stop offset="85%" stopColor="#22D3EE" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* Primary Optical Fiber Stream */}
      <path
        d="M -40 295 C 210 285, 360 190, 590 195 C 805 200, 960 120, 1220 35"
        fill="none"
        stroke={`url(#fiberCyan-${uid})`}
        strokeWidth="2.4"
        className="mj-fiber-stream"
      />
      {/* Secondary Magenta-Violet Optical Strand */}
      <path
        d="M -30 312 C 240 260, 410 220, 640 205 C 860 190, 995 138, 1230 58"
        fill="none"
        stroke={`url(#fiberPurple-${uid})`}
        strokeWidth="1.8"
        className="mj-fiber-stream-slow"
      />
      {/* Delicate Upper Signal Arc */}
      <path
        d="M 80 280 C 310 240, 470 165, 710 175 C 905 182, 1040 105, 1220 22"
        fill="none"
        stroke={`url(#fiberCyan-${uid})`}
        strokeWidth="1.15"
        strokeDasharray="8 12"
        className="mj-fiber-flow"
      />

      {/* Luminous Optical Nodes */}
      <circle cx="315" cy="238" r="3" fill="#22D3EE" className="mj-fiber-node" />
      <circle cx="590" cy="195" r="3.4" fill="#A855F7" className="mj-fiber-node" />
      <circle cx="842" cy="168" r="2.8" fill="#EC4899" className="mj-fiber-node" />
      <circle cx="1048" cy="102" r="3.2" fill="#22D3EE" className="mj-fiber-node" />
    </svg>
  );
};

export interface ThemeBrandBackgroundProps {
  variant?: 'workspace' | 'login' | 'loading';
  className?: string;
}

export const ThemeBrandBackground: React.FC<ThemeBrandBackgroundProps> = ({
  variant = 'workspace',
  className = ''
}) => {
  const [lightImgError, setLightImgError] = useState(false);
  const [darkImgError, setDarkImgError] = useState(false);

  const isLogin = variant === 'login';
  const isLoading = variant === 'loading';

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none select-none fixed inset-0 z-0 overflow-hidden ${className}`}
    >
      {/* 1. Always-ready Atmospheric Fallback Gradient (Light + Dark) */}
      <div
        className="absolute inset-0 block dark:hidden"
        style={{
          background:
            'radial-gradient(circle at 82% 18%, rgba(34,211,238,0.16) 0%, transparent 45%), radial-gradient(circle at 18% 85%, rgba(139,92,246,0.18) 0%, transparent 50%), linear-gradient(145deg, #F5F7FC 0%, #ECE9FE 52%, #E4F0F8 100%)'
        }}
      />
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background:
            'radial-gradient(circle at 82% 20%, rgba(139,92,246,0.28) 0%, transparent 48%), radial-gradient(circle at 16% 88%, rgba(34,211,238,0.16) 0%, transparent 50%), linear-gradient(145deg, #070B24 0%, #110C32 52%, #05081E 100%)'
        }}
      />

      {/* 2. Light Mode Official Visual Reference Wallpaper (Desktop + Mobile responsive art direction) */}
      {!lightImgError && (
        <picture className="block dark:hidden w-full h-full">
          <source media="(max-width: 767px)" srcSet="/assets/brand/bg-light-mobile.webp" />
          <img
            src="/assets/brand/bg-light-desktop.webp"
            alt=""
            decoding="async"
            loading={isLogin ? 'eager' : 'lazy'}
            onError={() => setLightImgError(true)}
            className={`w-full h-full object-cover object-right-bottom transition-opacity duration-500 ${
              isLogin ? 'opacity-95' : isLoading ? 'opacity-85' : 'opacity-50'
            }`}
          />
        </picture>
      )}

      {/* 3. Dark Mode Official Visual Reference Wallpaper (Desktop + Mobile responsive art direction) */}
      {!darkImgError && (
        <picture className="hidden dark:block w-full h-full">
          <source media="(max-width: 767px)" srcSet="/assets/brand/bg-dark-mobile.webp" />
          <img
            src="/assets/brand/bg-dark-desktop.webp"
            alt=""
            decoding="async"
            loading={isLogin ? 'eager' : 'lazy'}
            onError={() => setDarkImgError(true)}
            className={`w-full h-full object-cover object-right-bottom transition-opacity duration-500 ${
              isLogin ? 'opacity-90' : isLoading ? 'opacity-80' : 'opacity-48'
            }`}
          />
        </picture>
      )}

      {/* 4. Calibrated Contrast-Safe Scrims (Light Mode Soft Crystal Mist | Dark Mode Midnight Space) */}
      {isLogin ? (
        <>
          <div className="block dark:hidden absolute inset-0 bg-gradient-to-br from-[#F6F8FC]/65 via-[#F4F2FE]/42 to-transparent" />
          <div className="hidden dark:block absolute inset-0 bg-gradient-to-br from-[#070B24]/65 via-[#0F0B30]/48 to-[#070A22]/35" />
        </>
      ) : (
        <>
          <div className="block dark:hidden absolute inset-0 bg-gradient-to-br from-[#F4F7FB]/88 via-[#F4F7FB]/74 to-[#F0EDFF]/46" />
          <div className="hidden dark:block absolute inset-0 bg-gradient-to-br from-[#0A0D28]/88 via-[#110D33]/82 to-[#140D2D]/70" />
        </>
      )}

      {/* 5. Subtle Animated Neon Fiber Optic Vector Accent (Login & Loading only for maximum workspace FPS) */}
      {(isLogin || isLoading) && (
        <NeonFiberOpticTrails
          variant={isLogin ? 'hero' : 'subtle'}
          className="absolute inset-x-0 bottom-0 w-full h-44 sm:h-64"
        />
      )}
    </div>
  );
};
