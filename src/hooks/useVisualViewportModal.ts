import { useEffect, useState, RefObject } from 'react';

export interface VisualViewportMetrics {
  viewportHeight: number;
  viewportTop: number;
  keyboardInset: number;
  isKeyboardOpen: boolean;
}

/**
 * Tracks browser visualViewport metrics so modals & dropups remain fully visible
 * above Android soft keyboards and never get clipped off-screen.
 * When `containerRef` is provided, focused inputs/textareas/selects inside the modal
 * automatically scroll smoothly into view when the soft keyboard opens.
 */
export function useVisualViewportModal(
  enabled: boolean,
  containerRef?: RefObject<HTMLElement | null>
): VisualViewportMetrics {
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
    let scrollTimer: number | null = null;

    const scrollActiveFieldIntoView = () => {
      const container = containerRef?.current;
      const activeEl = document.activeElement as HTMLElement | null;
      if (!container || !activeEl) return;
      if (!container.contains(activeEl)) return;
      const tag = activeEl.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !activeEl.isContentEditable) {
        return;
      }
      if (scrollTimer !== null) {
        window.clearTimeout(scrollTimer);
      }
      scrollTimer = window.setTimeout(() => {
        try {
          activeEl.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        } catch {
          activeEl.scrollIntoView({ block: 'center' });
        }
      }, 90);
    };

    const update = () => {
      const next = readMetrics();
      setMetrics(next);
      if (next.isKeyboardOpen) {
        scrollActiveFieldIntoView();
      }
    };
    update();

    const handleFocusIn = (e: FocusEvent) => {
      const container = containerRef?.current;
      const target = e.target as HTMLElement | null;
      if (!container || !target || !container.contains(target)) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
        scrollActiveFieldIntoView();
      }
    };

    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [enabled, containerRef]);

  return metrics;
}
