/**
 * Centralized Global Modal & Overlay Layer Manager
 *
 * Ensures deterministic stacking across the entire MoraJaws app:
 * - Page content:         z-0..z-30
 * - Bottom navigation:    z-40 (automatically hidden when a primary modal/drawer is open)
 * - Page-level popovers:  z-55
 * - Drawers / sidebars:   z-60
 * - Primary modals/sheet: z-70+
 * - Nested modals/lightboxes: z-90+
 * - Popovers inside modals:   z-120+ (automatically elevated above any open modal)
 * - Confirm / conflict dialogs: z-1000+
 * - Critical alerts:      z-10000+
 * - Floating Mini Toast:  z-99999
 *
 * Also manages ref-counted document scroll locking so multiple / nested / repeated modals
 * never leave scroll stuck disabled or unlocked prematurely.
 */

export type ModalLayerTier = 'drawer' | 'modal' | 'nested' | 'confirm' | 'critical';

export interface ModalLayerEntry {
  id: string;
  tier: ModalLayerTier;
  hidesBottomNav: boolean;
  lockScroll: boolean;
  order: number;
}

const TIER_BASE_Z: Record<ModalLayerTier, number> = {
  drawer: 60,
  modal: 70,
  nested: 90,
  confirm: 1000,
  critical: 10000
};

let seq = 0;
let entries: ModalLayerEntry[] = [];
const listeners = new Set<() => void>();

let savedHtmlOverflow: string | null = null;
let savedBodyOverflow: string | null = null;
let savedBodyOverscroll: string | null = null;
let scrollLockActive = false;

function syncDocumentScrollLock(): void {
  if (typeof document === 'undefined') return;
  const shouldLock = entries.some(entry => entry.lockScroll);

  if (shouldLock && !scrollLockActive) {
    savedHtmlOverflow = document.documentElement.style.overflow;
    savedBodyOverflow = document.body.style.overflow;
    savedBodyOverscroll = document.body.style.overscrollBehavior;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';
    scrollLockActive = true;
  } else if (!shouldLock && scrollLockActive) {
    document.documentElement.style.overflow = savedHtmlOverflow ?? '';
    document.body.style.overflow = savedBodyOverflow ?? '';
    document.body.style.overscrollBehavior = savedBodyOverscroll ?? '';
    savedHtmlOverflow = null;
    savedBodyOverflow = null;
    savedBodyOverscroll = null;
    scrollLockActive = false;
  }
}

function notify(): void {
  syncDocumentScrollLock();
  listeners.forEach(listener => {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  });
}

export interface RegisterModalOptions {
  tier?: ModalLayerTier;
  hidesBottomNav?: boolean;
  lockScroll?: boolean;
}

export function registerModalLayer(
  id: string,
  options: RegisterModalOptions = {}
): () => void {
  const tier = options.tier ?? 'modal';
  const hidesBottomNav = options.hidesBottomNav ?? true;
  const lockScroll = options.lockScroll ?? true;

  // Replace existing entry with same ID if already registered (idempotent re-register)
  entries = entries.filter(e => e.id !== id);
  entries = [
    ...entries,
    {
      id,
      tier,
      hidesBottomNav,
      lockScroll,
      order: ++seq
    }
  ];
  notify();

  return () => {
    const next = entries.filter(e => e.id !== id);
    if (next.length !== entries.length) {
      entries = next;
      notify();
    }
  };
}

export function getModalStackSnapshot(): readonly ModalLayerEntry[] {
  return entries;
}

export function getOpenModalCount(): number {
  return entries.length;
}

export function shouldHideBottomNavigation(): boolean {
  return entries.some(entry => entry.hidesBottomNav);
}

export function getLayerZIndex(
  id: string | null,
  fallbackTier: ModalLayerTier = 'modal'
): number {
  if (!id) return TIER_BASE_Z[fallbackTier];
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return TIER_BASE_Z[fallbackTier];
  const entry = entries[idx];
  const sameTierBefore = entries
    .slice(0, idx)
    .filter(e => e.tier === entry.tier).length;
  return TIER_BASE_Z[entry.tier] + sameTierBefore * 2;
}

export function getHighestActiveLayerZIndex(): number {
  if (entries.length === 0) return 0;
  let maxZ = 0;
  for (const entry of entries) {
    const z = getLayerZIndex(entry.id, entry.tier);
    if (z > maxZ) maxZ = z;
  }
  return maxZ;
}

/**
 * Returns safe z-index for dropdowns/popovers/datepickers:
 * - Page level (no modal open): 55 (above BottomNav z-40 & sticky table headers z-20)
 * - Inside a modal/drawer/nested modal: at least 120 and always above highest non-confirm modal,
 *   unless a confirm/critical modal is open, in which case floats cleanly above that active layer.
 */
export function getDynamicPopoverZIndex(): number {
  if (entries.length === 0) return 55;
  const topModalZ = getHighestActiveLayerZIndex();
  return Math.max(120, topModalZ + 20);
}

export function subscribeModalStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test-only helper to reset global stack cleanly.
 */
export function __resetModalStackForTests(): void {
  entries = [];
  seq = 0;
  notify();
}
