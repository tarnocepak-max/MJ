import React from 'react';

export type MoraJawsLogoVariant = 'full' | 'symbol' | 'monochrome';
export type MoraJawsLogoTheme = 'auto' | 'light' | 'dark';
export type MoraJawsLogoTone = 'default' | 'light' | 'dark';

export interface MoraJawsLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  variant?: MoraJawsLogoVariant;
  theme?: MoraJawsLogoTheme;
  tone?: MoraJawsLogoTone;
  showText?: boolean;
  showSubtitle?: boolean;
  textSubtitle?: string;
  showPoweredBy?: boolean;
  isRotating?: boolean;
  animated?: boolean;
  withGlow?: boolean;
  layout?: 'horizontal' | 'stacked';
  className?: string;
}

const SIZE_MAP: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number> = {
  xs: 22,
  sm: 30,
  md: 42,
  lg: 60,
  xl: 76
};

export const MoraJawsLogo: React.FC<MoraJawsLogoProps> = ({
  size = 'md',
  variant,
  theme = 'auto',
  tone = 'default',
  showText = false,
  showSubtitle = false,
  textSubtitle,
  showPoweredBy = false,
  isRotating = false,
  animated = false,
  withGlow = true,
  layout = 'horizontal',
  className = ''
}) => {
  const uniqueId = React.useId().replace(/:/g, '');
  const resolvedVariant: MoraJawsLogoVariant = variant ?? (showText ? 'full' : 'symbol');
  const symbolSize = typeof size === 'number' ? size : SIZE_MAP[size] ?? 42;
  const shouldShowWordmark = resolvedVariant === 'full' || (resolvedVariant === 'monochrome' && showText);
  const isMono = resolvedVariant === 'monochrome';

  const monoColor =
    tone === 'light'
      ? '#FFFFFF'
      : tone === 'dark'
      ? '#26364A'
      : theme === 'dark'
      ? '#FFFFFF'
      : theme === 'light'
      ? '#4C1D95'
      : 'currentColor';

  const moraTextColorClass = isMono
    ? ''
    : theme === 'dark'
    ? 'text-white'
    : theme === 'light'
    ? 'text-[#1E1B3A]'
    : 'text-[#1E1B3A] dark:text-white';

  const subtitleTextColorClass = isMono
    ? 'opacity-80'
    : theme === 'dark'
    ? 'text-[#CBD5E1]'
    : theme === 'light'
    ? 'text-[#52647A]'
    : 'text-[#52647A] dark:text-[#CBD5E1]';

  const jawsGradientStyle: React.CSSProperties = isMono
    ? {}
    : theme === 'dark'
    ? {
        backgroundImage: 'linear-gradient(135deg, #C084FC 0%, #9333EA 52%, #7C3AED 100%)'
      }
    : {
        backgroundImage: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 60%, #4C1D95 100%)'
      };

  const wordmarkSizeClass =
    symbolSize >= 70
      ? 'text-3xl sm:text-[34px]'
      : symbolSize >= 56
      ? 'text-2xl sm:text-[28px]'
      : symbolSize >= 38
      ? 'text-lg sm:text-xl'
      : 'text-sm sm:text-base';

  const subtitleSizeClass =
    symbolSize >= 56 ? 'text-[11px] sm:text-xs tracking-[0.14em]' : 'text-[9.5px] tracking-[0.12em]';

  const renderSymbolSvg = () => (
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{
        width: symbolSize,
        height: symbolSize
      }}
    >
      {/* Subtle Ambient Electric Violet & Cyan Aura */}
      {withGlow && !isMono && (
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full blur-md opacity-70 pointer-events-none transition-opacity duration-300"
          style={{
            background:
              'radial-gradient(circle, rgba(139, 92, 246, 0.42) 0%, rgba(34, 211, 238, 0.18) 52%, transparent 74%)',
            transform: 'scale(1.22)'
          }}
        />
      )}

      <svg
        viewBox="0 0 120 110"
        width={symbolSize}
        height={symbolSize}
        className="relative z-10 overflow-visible"
        role="img"
        aria-label="MoraJaws Emblem"
      >
        <defs>
          <linearGradient id={`mjMGrad-${uniqueId}`} x1="18" y1="88" x2="96" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9333EA" />
            <stop offset="48%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#C084FC" />
          </linearGradient>
          <linearGradient id={`mjMHighlight-${uniqueId}`} x1="20" y1="28" x2="88" y2="85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.65" />
            <stop offset="45%" stopColor="#E9D5FF" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#5B21B6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`mjSwooshGrad-${uniqueId}`} x1="8" y1="95" x2="108" y2="14" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6D28D9" />
            <stop offset="50%" stopColor="#9333EA" />
            <stop offset="100%" stopColor="#C084FC" />
          </linearGradient>
          <filter id={`mjGlow-${uniqueId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodColor="#4C1D95" floodOpacity="0.32" />
          </filter>
        </defs>

        {/* Orbital Motion Container (Rotates cleanly during active loading/sync states) */}
        <g
          style={{
            transformOrigin: '60px 55px',
            animation: isRotating
              ? 'morajaws-spin-clockwise 2.8s linear infinite'
              : animated
              ? 'morajaws-fiber-pulse 3.6s ease-in-out infinite'
              : undefined
          }}
        >
          {/* Sweeping Futuristic Orbital Swoosh */}
          <path
            d="M 22 92 C 5 73, 14 35, 58 17 C 75 10, 91 9, 100 12 C 85 16, 65 24, 46 37 C 21 53, 15 76, 32 87 C 46 95, 69 91, 90 80 C 68 97, 36 105, 22 92 Z"
            fill={isMono ? monoColor : `url(#mjSwooshGrad-${uniqueId})`}
            filter={isMono ? undefined : `url(#mjGlow-${uniqueId})`}
          />

          {/* 4-Point Sparkle Star at Top-Right Arc */}
          <path
            d="M 101 2 L 104 10 L 112 13 L 104 16 L 101 24 L 98 16 L 90 13 L 98 10 Z"
            fill={isMono ? monoColor : '#A855F7'}
          />
          {!isMono && (
            <path
              d="M 101 6 L 102.6 11.4 L 108 13 L 102.6 14.6 L 101 20 L 99.4 14.6 L 94 13 L 99.4 11.4 Z"
              fill="#F5D0FE"
            />
          )}
        </g>

        {/* Primary Futuristic Tilted Geometric M */}
        <g filter={isMono ? undefined : `url(#mjGlow-${uniqueId})`}>
          <path
            d="M 25 84 L 36.5 39 C 38.2 32.5, 45.2 30.8, 50 36 L 61.5 50.5 L 74.8 36 C 79.5 30.8, 86.8 32.5, 88.4 39 L 98.5 84 C 99.3 87.8, 96.2 91, 92.2 91 L 83.4 91 C 80.1 91, 77.3 88.8, 76.6 85.5 L 72.1 62 L 64.2 71.2 C 62 73.8, 58.2 73.8, 56 71.2 L 48.8 62 L 43.8 85.5 C 43.1 88.8, 40.3 91, 37 91 L 31.2 91 C 27.3 91, 24.1 87.8, 25 84 Z"
            fill={isMono ? monoColor : `url(#mjMGrad-${uniqueId})`}
          />
          {!isMono && (
            <path
              d="M 25 84 L 36.5 39 C 38.2 32.5, 45.2 30.8, 50 36 L 61.5 50.5 L 74.8 36 C 79.5 30.8, 86.8 32.5, 88.4 39 L 98.5 84 C 99.3 87.8, 96.2 91, 92.2 91 L 83.4 91 C 80.1 91, 77.3 88.8, 76.6 85.5 L 72.1 62 L 64.2 71.2 C 62 73.8, 58.2 73.8, 56 71.2 L 48.8 62 L 43.8 85.5 C 43.1 88.8, 40.3 91, 37 91 L 31.2 91 C 27.3 91, 24.1 87.8, 25 84 Z"
              fill={`url(#mjMHighlight-${uniqueId})`}
            />
          )}
        </g>
      </svg>
    </div>
  );

  const resolvedSubtitle = textSubtitle || (showSubtitle ? 'Dispatch Management System' : '');

  return (
    <div
      className={`inline-flex ${
        layout === 'stacked' ? 'flex-col text-center' : 'flex-row items-center text-left'
      } items-center justify-center select-none ${
        layout === 'stacked' ? 'gap-2' : 'gap-2.5 sm:gap-3'
      } ${className}`}
    >
      {renderSymbolSvg()}

      {shouldShowWordmark && (
        <div
          className={`flex flex-col ${
            layout === 'stacked' ? 'items-center' : 'items-start'
          } leading-none`}
        >
          <div className={`font-display font-extrabold tracking-tight flex items-baseline ${wordmarkSizeClass}`}>
            <span
              className={moraTextColorClass}
              style={isMono ? { color: monoColor } : undefined}
            >
              Mora
            </span>
            <span
              className={isMono ? '' : 'bg-clip-text text-transparent'}
              style={isMono ? { color: monoColor, opacity: 0.9 } : jawsGradientStyle}
            >
              Jaws
            </span>
          </div>

          {resolvedSubtitle && (
            <div
              className={`mt-1.5 flex items-center gap-2 font-medium ${subtitleSizeClass} ${subtitleTextColorClass}`}
              style={isMono ? { color: monoColor } : undefined}
            >
              <span aria-hidden="true" className="w-3 sm:w-4 h-px bg-current opacity-40" />
              <span className="whitespace-nowrap">{resolvedSubtitle}</span>
              <span aria-hidden="true" className="w-3 sm:w-4 h-px bg-current opacity-40" />
            </div>
          )}

          {showPoweredBy && (
            <span
              className={`mt-1 text-[9.5px] font-semibold tracking-wider uppercase opacity-75 ${subtitleTextColorClass}`}
              style={isMono ? { color: monoColor } : undefined}
            >
              Powered by MoraRepublic Technology Ecosystem
            </span>
          )}
        </div>
      )}
    </div>
  );
};
