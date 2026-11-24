import type { Ticket } from '../types/index.ts';

// Protected keys that must NEVER be auto-evicted during quota cleanup
const PROTECTED_KEYS = new Set([
  'morajaws_auth_session',
  'morajaws_logged_in',
  'morajaws_operational_date',
  'morajaws_tickets_v4',
  'morajaws_v4_migration_receipt'
]);

// Legacy/cache keys that are safe to evict when browser localStorage approaches quota
const EVICTABLE_PREFIXES = [
  'morajaws_users_v',
  'morajaws_tickets_v2',
  'morajaws_tickets_v3',
  'morajaws_contractors_v',
  'morajaws_coverage_areas_v',
  'morajaws_root_causes_v',
  'morajaws_messages_v',
  'morajaws_wa_templates_v',
  'morajaws_workflows_v',
  'morajaws_audit_logs_v',
  'morajaws_wa_logs_v',
  'morajaws_mappings_v',
  'morajaws_canonical_fields_v',
  'morajaws_sheets_config_v',
  'morajaws_report_dropdown_categories',
  'morajaws_chat_categories',
  'morajaws_hierarchical_droplists',
  'mj_checkout_draft_'
];

export interface SafeStorageWriteResult {
  ok: boolean;
  quotaExceeded?: boolean;
  evictedKeys?: string[];
  error?: string;
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014 ||
    String(e.message || '').toLowerCase().includes('quota')
  );
}

export function isDataUri(value: unknown): value is string {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('data:');
}

export function safeLocalStorageGet(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageRemove(key: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Evicts non-essential / redundant cache keys (never auth session, operational date,
 * or unmigrated morajaws_tickets_v4) to free browser localStorage quota.
 */
export function purgeNonEssentialLocalCaches(excludeKey?: string): string[] {
  const evicted: string[] = [];
  try {
    if (typeof window === 'undefined' || !window.localStorage) return evicted;
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) keys.push(k);
    }

    for (const k of keys) {
      if (k === excludeKey || PROTECTED_KEYS.has(k)) continue;
      if (EVICTABLE_PREFIXES.some(prefix => k.startsWith(prefix))) {
        try {
          window.localStorage.removeItem(k);
          evicted.push(k);
        } catch {
          // ignore per-key error
        }
      }
    }
  } catch {
    // ignore enumeration error
  }
  return evicted;
}

/**
 * Quota-safe localStorage writer.
 * - Rejects unexpectedly huge single-item payloads (> 512 KB) to prevent QuotaExceededError.
 * - On QuotaExceededError, purges non-essential cache keys and retries once safely.
 */
export function safeLocalStorageSet(
  key: string,
  value: string,
  options: { maxBytes?: number } = {}
): SafeStorageWriteResult {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false, error: 'localStorage unavailable' };
  }

  const maxBytes = options.maxBytes ?? 512 * 1024;
  if (value.length > maxBytes) {
    return {
      ok: false,
      quotaExceeded: true,
      error: `Payload for "${key}" (${value.length} chars) exceeds safe browser storage limit.`
    };
  }

  try {
    window.localStorage.setItem(key, value);
    return { ok: true };
  } catch (err: any) {
    if (!isQuotaExceededError(err)) {
      return { ok: false, error: err?.message || 'Storage write failed' };
    }

    // Attempt targeted cleanup of redundant caches while keeping auth/session & unmigrated data safe
    const evictedKeys = purgeNonEssentialLocalCaches(key);
    try {
      window.localStorage.setItem(key, value);
      return { ok: true, evictedKeys };
    } catch (retryErr: any) {
      return {
        ok: false,
        quotaExceeded: true,
        evictedKeys,
        error: retryErr?.message || 'Browser storage quota exceeded'
      };
    }
  }
}

export function safeSessionStorageSet(key: string, value: string): SafeStorageWriteResult {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return { ok: false, error: 'sessionStorage unavailable' };
  }
  try {
    window.sessionStorage.setItem(key, value);
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      quotaExceeded: isQuotaExceededError(err),
      error: err?.message || 'Session storage write failed'
    };
  }
}

export function safeSessionStorageRemove(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

/**
 * Strips inline Base64 data URIs from ticket objects before storing in local IndexedDB cache.
 * Preserves remote/backend storage URLs (/api/storage/..., https://...) and all operational fields.
 */
export function stripBase64BlobsFromTicket<T extends Partial<Ticket>>(ticket: T): T {
  if (!ticket || typeof ticket !== 'object') return ticket;
  const copy: any = { ...ticket };

  if (isDataUri(copy.customerSignatureUrl)) {
    copy.customerSignatureUrl = undefined;
  }

  if (copy.technicalReport && typeof copy.technicalReport === 'object') {
    const tr = { ...copy.technicalReport };
    if (isDataUri(tr.customerSignatureUrl)) tr.customerSignatureUrl = undefined;
    if (isDataUri(tr.photoBeforeUrl)) tr.photoBeforeUrl = undefined;
    if (isDataUri(tr.photoAfterUrl)) tr.photoAfterUrl = undefined;
    if (Array.isArray(tr.photos)) {
      tr.photos = tr.photos.filter((p: unknown) => typeof p === 'string' && !isDataUri(p));
    }
    if (Array.isArray(tr.photoSlots)) {
      tr.photoSlots = tr.photoSlots.map((slot: any) => {
        if (!slot || typeof slot !== 'object') return slot;
        if (isDataUri(slot.url)) {
          return {
            ...slot,
            url: slot.storagePath ? `/api/storage/adapter/download?storagePath=${encodeURIComponent(slot.storagePath)}` : ''
          };
        }
        return slot;
      });
    }
    copy.technicalReport = tr;
  }

  if (Array.isArray(copy.kendalaReports)) {
    copy.kendalaReports = copy.kendalaReports.map((k: any) => {
      if (!k || typeof k !== 'object') return k;
      if (isDataUri(k.photoUrl)) {
        return {
          ...k,
          photoUrl: k.storagePath ? `/api/storage/adapter/download?storagePath=${encodeURIComponent(k.storagePath)}` : ''
        };
      }
      return k;
    });
  }

  if (copy.houseLocation && typeof copy.houseLocation === 'object' && isDataUri(copy.houseLocation.photoUrl)) {
    copy.houseLocation = {
      ...copy.houseLocation,
      photoUrl: copy.houseLocation.storagePath
        ? `/api/storage/adapter/download?storagePath=${encodeURIComponent(copy.houseLocation.storagePath)}`
        : undefined
    };
  }

  if (copy.fatLocation && typeof copy.fatLocation === 'object' && isDataUri(copy.fatLocation.photoUrl)) {
    copy.fatLocation = {
      ...copy.fatLocation,
      photoUrl: copy.fatLocation.storagePath
        ? `/api/storage/adapter/download?storagePath=${encodeURIComponent(copy.fatLocation.storagePath)}`
        : undefined
    };
  }

  return copy as T;
}

/**
 * Strips inline Base64 data URIs from checkout draft objects before writing to localStorage.
 * Heavy binary/Base64 assets belong in Supabase Storage or IndexedDB offline drafts.
 */
export function sanitizeCheckoutDraftForLocalStorage(draft: Record<string, any>): Record<string, any> {
  const sanitizedPhotoSlots: Record<string, any> = {};
  if (draft.photoSlots && typeof draft.photoSlots === 'object') {
    for (const [k, slot] of Object.entries(draft.photoSlots)) {
      if (!slot || typeof slot !== 'object') continue;
      const s = slot as Record<string, any>;
      // Only store lightweight metadata or remote URLs in localStorage, never Base64 image blobs
      if (isDataUri(s.url)) continue;
      sanitizedPhotoSlots[k] = s;
    }
  }
  return {
    ...draft,
    photoSlots: sanitizedPhotoSlots,
    customerSignatureUrl: isDataUri(draft.customerSignatureUrl) ? '' : (draft.customerSignatureUrl || '')
  };
}
