import { useEffect, useState } from 'react';

export interface VisualViewportMetrics {
  viewportHeight: number;
  viewportTop: number;
  keyboardInset: number;
  isKeyboardOpen: boolean;
}

/**
 * Tracks browser visualViewport metrics so modals & dropups remain fully visible
 * above Android soft keyboards and never get clipped off-screen.
 */
export function useVisualViewportModal(enabled: boolean): VisualViewportMetrics {
  const readMetrics = (): VisualViewportMetrics => {
    if (typeof window === 'undefined') {
      return {
        viewportHeight: 800,
        viewportTop: 0,
        keyboardInset: 0,
        isKeyboardOpen: false
      };
    }
    const vv = window.visualViewport;
    const innerH = window.innerHeight || 800;
    const vvH = vv ? vv.height : innerH;
    const vvTop = vv ? vv.offsetTop : 0;
    const keyboardInset = Math.max(0, Math.round(innerH - vvH - vvTop));
    return {
      viewportHeight: Math.round(vvH),
      viewportTop: Math.round(vvTop),
      keyboardInset,
      isKeyboardOpen: keyboardInset > 100
    };
  };

  const [metrics, setMetrics] = useState<VisualViewportMetrics>(readMetrics);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const update = () => {
      setMetrics(readMetrics());
    };
    update();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [enabled]);

  return metrics;
}
