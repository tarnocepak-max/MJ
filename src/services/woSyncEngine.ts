import type { Ticket } from '../types/index.ts';

// ============================================================================
// MORAJAWS SMART PROGRESSIVE SYNC & STALE-WHILE-REVALIDATE (SWR) ENGINE
// - Request deduplication across simultaneous mounts/tabs/focus events
// - Scoped SWR snapshot cache with freshness tracking
// - Active-edit protection so background sync/SSE never overwrites open edits
// - Non-destructive delta merge preserving scroll and local form state
// ============================================================================

export interface WoCacheEntry<T = any> {
  key: string;
  data: T;
  storedAt: number;
  serverWatermark: string;
}

const inFlightRequests = new Map<string, Promise<any>>();
const swrCache = new Map<string, WoCacheEntry>();
const editingTicketIds = new Set<string>();
const lastViewRevalidateAt = new Map<string, number>();

export function dedupedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = Promise.resolve()
    .then(fetcher)
    .finally(() => {
      inFlightRequests.delete(key);
    });
  inFlightRequests.set(key, promise);
  return promise;
}

export function getWoCache<T = any>(key: string): WoCacheEntry<T> | null {
  return (swrCache.get(key) as WoCacheEntry<T>) || null;
}

export function setWoCache<T = any>(key: string, data: T, serverWatermark?: string): void {
  swrCache.set(key, {
    key,
    data,
    storedAt: Date.now(),
    serverWatermark: serverWatermark || new Date().toISOString()
  });
}

export function isWoCacheFresh(key: string, maxAgeMs: number = 15_000): boolean {
  const entry = swrCache.get(key);
  if (!entry) return false;
  return Date.now() - entry.storedAt <= maxAgeMs;
}

export function invalidateWoCache(prefix?: string): void {
  if (!prefix) {
    swrCache.clear();
    lastViewRevalidateAt.clear();
    return;
  }
  for (const k of swrCache.keys()) {
    if (k.startsWith(prefix)) {
      swrCache.delete(k);
    }
  }
}

export function shouldThrottleViewRevalidation(viewKey: string, cooldownMs: number = 6_000): boolean {
  const now = Date.now();
  const prev = lastViewRevalidateAt.get(viewKey) || 0;
  if (now - prev < cooldownMs) {
    return true;
  }
  lastViewRevalidateAt.set(viewKey, now);
  return false;
}

export function markTicketEditingState(ticketId: string | null | undefined, isEditing: boolean): void {
  const cleanId = String(ticketId || '').trim();
  if (!cleanId) return;
  if (isEditing) {
    editingTicketIds.add(cleanId);
  } else {
    editingTicketIds.delete(cleanId);
  }
}

export function isTicketBeingEdited(ticketId: string | null | undefined): boolean {
  const cleanId = String(ticketId || '').trim();
  if (!cleanId) return false;
  return editingTicketIds.has(cleanId);
}

export function getEditingTicketIds(): Set<string> {
  return new Set(editingTicketIds);
}

export interface MergeDeltaResult {
  tickets: Ticket[];
  changedCount: number;
  skippedEditedIds: string[];
}

/**
 * Merges updated & soft-deleted tickets into the existing array without clobbering
 * rows currently being edited in a form or modal. Preserves object identity for
 * untouched tickets to minimize React table re-renders.
 */
export function mergeDeltaTickets(
  existing: Ticket[],
  updatedList: Ticket[],
  deletedIds: string[] = [],
  protectedIds: Set<string> = editingTicketIds
): MergeDeltaResult {
  const deletedSet = new Set(deletedIds.map(String));
  const existingMap = new Map<string, Ticket>();
  const orderedIds: string[] = [];

  for (const t of existing) {
    if (!t || !t.id) continue;
    if (deletedSet.has(String(t.id)) && !protectedIds.has(String(t.id))) {
      continue;
    }
    existingMap.set(String(t.id), t);
    orderedIds.push(String(t.id));
  }

  let changedCount = deletedIds.length > 0 ? 1 : 0;
  const skippedEditedIds: string[] = [];

  for (const upd of updatedList) {
    if (!upd || !upd.id) continue;
    const idStr = String(upd.id);

    if (protectedIds.has(idStr)) {
      skippedEditedIds.push(idStr);
      continue;
    }

    if (upd.isDeleted || deletedSet.has(idStr)) {
      if (existingMap.has(idStr)) {
        existingMap.delete(idStr);
        changedCount++;
      }
      continue;
    }

    const prev = existingMap.get(idStr);
    if (!prev) {
      existingMap.set(idStr, upd);
      orderedIds.unshift(idStr);
      changedCount++;
    } else {
      // Preserve full secondary fields (especially technicalReport.photoSlots) if incoming update is partial critical snapshot
      const merged: Ticket =
        (upd as any)._isCriticalPartial && !(prev as any)._isCriticalPartial
          ? ({
              ...prev,
              ...upd,
              technicalReport:
                prev.technicalReport || upd.technicalReport
                  ? ({
                      ...(prev.technicalReport || {}),
                      ...(upd.technicalReport || {}),
                      photoSlots:
                        Array.isArray(upd.technicalReport?.photoSlots) && upd.technicalReport!.photoSlots!.length > 0
                          ? upd.technicalReport!.photoSlots
                          : prev.technicalReport?.photoSlots,
                      photos:
                        Array.isArray(upd.technicalReport?.photos) && upd.technicalReport!.photos!.length > 0
                          ? upd.technicalReport!.photos
                          : prev.technicalReport?.photos
                    } as Ticket['technicalReport'])
                  : undefined,
              workSessions: prev.workSessions,
              progressReports:
                Array.isArray(prev.progressReports) && prev.progressReports.length > (upd.progressReports?.length || 0)
                  ? prev.progressReports
                  : upd.progressReports,
              _isCriticalPartial: false
            } as Ticket)
          : upd;
      existingMap.set(idStr, merged);
      changedCount++;
    }
  }

  const nextTickets: Ticket[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = existingMap.get(id);
    if (item) nextTickets.push(item);
  }

  return {
    tickets: nextTickets,
    changedCount,
    skippedEditedIds
  };
}

/**
 * Merges Phase 2 full ticket payloads on top of Phase 1 critical partial snapshots
 * while safeguarding actively edited rows and preserving any previously loaded rows
 * not included in a partial chunk/page response.
 */
export function mergeProgressiveHydration(
  current: Ticket[],
  fullTickets: Ticket[],
  protectedIds: Set<string> = editingTicketIds
): Ticket[] {
  if (!Array.isArray(fullTickets) || fullTickets.length === 0) {
    return Array.isArray(current) ? current : [];
  }
  if (!Array.isArray(current) || current.length === 0) {
    return fullTickets;
  }

  const nextMap = new Map<string, Ticket>();
  const orderedIds: string[] = [];

  for (const t of current) {
    if (!t?.id) continue;
    const idStr = String(t.id);
    if (!nextMap.has(idStr)) {
      orderedIds.push(idStr);
    }
    nextMap.set(idStr, t);
  }

  for (const ft of fullTickets) {
    if (!ft?.id) continue;
    const idStr = String(ft.id);
    if (protectedIds.has(idStr) && nextMap.has(idStr)) {
      continue;
    }
    if (!nextMap.has(idStr)) {
      orderedIds.push(idStr);
    }
    nextMap.set(idStr, ft);
  }

  return orderedIds
    .map(id => nextMap.get(id))
    .filter((t): t is Ticket => Boolean(t));
}
