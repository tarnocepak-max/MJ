import { useEffect, useId, useSyncExternalStore } from 'react';
import {
  ModalLayerTier,
  registerModalLayer,
  shouldHideBottomNavigation,
  getDynamicPopoverZIndex,
  getLayerZIndex,
  getOpenModalCount,
  subscribeModalStack
} from '../utils/modalStack';

export function useHasOpenModal(): boolean {
  return useSyncExternalStore(
    subscribeModalStack,
    shouldHideBottomNavigation,
    () => false
  );
}

export function useOpenModalCount(): number {
  return useSyncExternalStore(
    subscribeModalStack,
    getOpenModalCount,
    () => 0
  );
}

export function useModalPopoverZIndex(): number {
  return useSyncExternalStore(
    subscribeModalStack,
    getDynamicPopoverZIndex,
    () => 55
  );
}

export interface UseModalLayerOptions {
  tier?: ModalLayerTier;
  hidesBottomNav?: boolean;
  lockScroll?: boolean;
}

/**
 * Registers an open modal / drawer / lightbox in the global stack
 * and returns its deterministic z-index.
 */
export function useModalLayer(
  isOpen: boolean,
  options: UseModalLayerOptions = {}
): number {
  const reactId = useId();
  const layerId = `layer-${reactId}`;
  const tier = options.tier ?? 'modal';
  const hidesBottomNav = options.hidesBottomNav ?? true;
  const lockScroll = options.lockScroll ?? true;

  useEffect(() => {
    if (!isOpen) return;
    return registerModalLayer(layerId, {
      tier,
      hidesBottomNav,
      lockScroll
    });
  }, [isOpen, layerId, tier, hidesBottomNav, lockScroll]);

  return useSyncExternalStore(
    subscribeModalStack,
    () => getLayerZIndex(isOpen ? layerId : null, tier),
    () => getLayerZIndex(null, tier)
  );
}
