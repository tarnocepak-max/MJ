import { useState, useEffect } from 'react';
import { useUIConfig } from '../context/UIConfigContext';

export interface ResponsiveViewportState {
  width: number;
  /** Viewport <= 767px */
  isMobileViewport: boolean;
  /** Viewport 768px - 1023px */
  isTabletViewport: boolean;
  /** Viewport >= 1024px */
  isDesktopViewport: boolean;
  /** True when user explicitly selected Mobile Mode OR viewport <= 767px (or Installer role) */
  isCompactUI: boolean;
  /** True when Mobile Mode/Viewport OR Tablet < 1024px */
  isDrawerViewport: boolean;
}

export function useResponsiveViewport(): ResponsiveViewportState {
  const { isMobileView } = useUIConfig();
  const [width, setWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isMobileViewport = width <= 767;
  const isTabletViewport = width >= 768 && width <= 1023;
  const isDesktopViewport = width >= 1024;
  const isCompactUI = isMobileView || isMobileViewport;
  const isDrawerViewport = isCompactUI || isTabletViewport;

  return {
    width,
    isMobileViewport,
    isTabletViewport,
    isDesktopViewport,
    isCompactUI,
    isDrawerViewport
  };
}
