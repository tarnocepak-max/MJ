import React, { lazy } from 'react';

export const CHUNK_RELOAD_GUARD_KEY = 'morajaws_chunk_preload_reload_guard';
export const DEFAULT_CHUNK_RELOAD_COOLDOWN_MS = 60_000;

export interface ChunkReloadGuardRecord {
  attempts: number;
  lastAttemptAt: number;
  failedModule?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function isDynamicImportChunkError(err: unknown): boolean {
  if (!err) return false;
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
      ? `${err.name || ''} ${err.message || ''}`
      : typeof (err as any)?.message === 'string'
      ? String((err as any).message)
      : String(err);

  const normalized = message.toLowerCase();
  return (
    normalized.includes('failed to fetch dynamically imported module') ||
    normalized.includes('importing a module script failed') ||
    normalized.includes('error loading dynamically imported module') ||
    normalized.includes('unable to preload css') ||
    normalized.includes('chunkloaderror') ||
    normalized.includes('loading chunk') ||
    normalized.includes('loading css chunk')
  );
}

export function extractFailedModuleName(err: unknown, fallbackName = 'UnknownModule'): string {
  const message =
    err instanceof Error ? `${err.message} ${err.stack || ''}` : String(err || '');
  const assetMatch = message.match(/([A-Za-z0-9_.-]+\.(?:js|mjs|css))/i);
  if (assetMatch) return assetMatch[1];
  return fallbackName;
}

function getSafeSessionStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Ignore storage restriction errors (e.g. private browsing)
  }
  return null;
}

export function readChunkReloadGuard(
  storage: StorageLike | null = getSafeSessionStorage()
): ChunkReloadGuardRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CHUNK_RELOAD_GUARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.attempts === 'number' &&
      typeof parsed.lastAttemptAt === 'number'
    ) {
      return parsed as ChunkReloadGuardRecord;
    }
  } catch {
    // Malformed guard data -> treat as absent
  }
  return null;
}

/**
 * Allows at most ONE automatic page reload per session/cooldown window when a
 * stale Vite chunk triggers vite:preloadError or dynamic import failure.
 * Never touches Custom Auth localStorage keys or session cookies.
 */
export function canAttemptChunkReload(
  storage: StorageLike | null = getSafeSessionStorage(),
  now: number = Date.now(),
  cooldownMs: number = DEFAULT_CHUNK_RELOAD_COOLDOWN_MS
): boolean {
  if (!storage) return false;
  const record = readChunkReloadGuard(storage);
  if (!record) return true;
  if (record.attempts < 1) return true;
  // Once reloaded once within cooldown window, never auto-reload again so loops cannot occur
  if (now - record.lastAttemptAt < cooldownMs) {
    return false;
  }
  // Even after cooldown, require explicit user recovery instead of infinite background reloads
  return false;
}

export function markChunkReloadAttempted(
  failedModule?: string,
  storage: StorageLike | null = getSafeSessionStorage(),
  now: number = Date.now()
): ChunkReloadGuardRecord {
  const prev = readChunkReloadGuard(storage);
  const next: ChunkReloadGuardRecord = {
    attempts: (prev?.attempts || 0) + 1,
    lastAttemptAt: now,
    failedModule: failedModule || prev?.failedModule
  };
  if (storage) {
    try {
      storage.setItem(CHUNK_RELOAD_GUARD_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

export function clearChunkReloadGuard(
  storage: StorageLike | null = getSafeSessionStorage()
): void {
  if (!storage) return;
  try {
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(CHUNK_RELOAD_GUARD_KEY);
    } else {
      storage.setItem(CHUNK_RELOAD_GUARD_KEY, JSON.stringify({ attempts: 0, lastAttemptAt: 0 }));
    }
  } catch {
    // Ignore storage restriction errors
  }
}

export interface PreloadHandlerOptions {
  targetWindow?: Window;
  storage?: StorageLike | null;
  reloadFn?: () => void;
  nowFn?: () => number;
}

/**
 * Registers Vite's `vite:preloadError` listener at application entry.
 * On first dynamic-import chunk failure, performs a single automatic reload
 * (guarded by sessionStorage) while preserving Custom Auth session state.
 * If a second failure occurs after reload, prevents reload looping so React's
 * ErrorBoundary renders a clean recovery UI.
 */
export function registerVitePreloadErrorHandler(
  options: PreloadHandlerOptions = {}
): () => void {
  const win = options.targetWindow ?? (typeof window !== 'undefined' ? window : undefined);
  if (!win || typeof win.addEventListener !== 'function') {
    return () => {};
  }

  const listener = (event: Event) => {
    const payload = (event as CustomEvent)?.detail ?? (event as any)?.payload ?? event;
    const failedModule = extractFailedModuleName(payload, 'vite-preload-chunk');
    const storage = options.storage !== undefined ? options.storage : getSafeSessionStorage();
    const now = options.nowFn ? options.nowFn() : Date.now();

    if (canAttemptChunkReload(storage, now)) {
      markChunkReloadAttempted(failedModule, storage, now);
      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      console.warn(
        `[MoraJaws Chunk Guard] Terdeteksi pembaruan aset deployment (${failedModule}). Memuat ulang aplikasi satu kali untuk mengambil build terbaru...`
      );
      if (options.reloadFn) {
        options.reloadFn();
      } else {
        win.location.reload();
      }
      return;
    }

    // Reload has already been attempted once in this session.
    // Do NOT suppress the error silently and do NOT reload again; let the route
    // ErrorBoundary display an informative retry fallback while preserving auth.
    console.error(
      `[MoraJaws Chunk Guard] Reload otomatis sudah dilakukan sebelumnya untuk ${failedModule}. Menampilkan fallback manual agar tidak terjadi reload loop.`
    );
  };

  win.addEventListener('vite:preloadError', listener);
  return () => {
    win.removeEventListener('vite:preloadError', listener);
  };
}

/**
 * Wraps React.lazy dynamic imports so chunk fetch errors trigger the single
 * sessionStorage-guarded reload if vite:preloadError did not already handle it,
 * and otherwise clear the failed lazy cache and throw a clean error caught by
 * the route-level ErrorBoundary (allowing "Coba Muat Ulang" in-place retries).
 */
export function lazyWithChunkRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  moduleLabel: string
): React.FC<React.ComponentProps<T>> {
  let cachedLazy: React.LazyExoticComponent<T> | null = null;

  const createLazy = () =>
    lazy(async () => {
      try {
        return await importer();
      } catch (err) {
        if (isDynamicImportChunkError(err)) {
          const storage = getSafeSessionStorage();
          const failedName = extractFailedModuleName(err, moduleLabel);
          if (canAttemptChunkReload(storage)) {
            markChunkReloadAttempted(failedName, storage);
            console.warn(
              `[MoraJaws Lazy Retry] Gagal memuat modul ${failedName}. Melakukan reload satu kali untuk menyinkronkan versi deployment...`
            );
            if (typeof window !== 'undefined' && window.location) {
              window.location.reload();
              await new Promise<never>(() => {});
            }
          }
        }
        // Reset failed lazy wrapper so explicit user retry runs importer() again
        cachedLazy = null;
        throw err;
      }
    });

  const RetryableLazyView: React.FC<React.ComponentProps<T>> = (props) => {
    if (!cachedLazy) {
      cachedLazy = createLazy();
    }
    return React.createElement(cachedLazy, props);
  };
  RetryableLazyView.displayName = `Lazy(${moduleLabel})`;
  return RetryableLazyView;
}
