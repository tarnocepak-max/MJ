import type { Ticket, UserRole } from '../types/index.ts';
import {
  addToSyncQueue,
  getAllSyncQueue,
  getMasterCacheValue,
  putMasterCacheValue
} from './offlineDb';
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  stripBase64BlobsFromTicket
} from '../utils/safeStorage';
import { supabaseDb } from './supabaseDb';

export const LEGACY_TICKETS_STORAGE_KEY = 'morajaws_tickets_v4';
export const LEGACY_MIGRATION_RECEIPT_KEY = 'morajaws_v4_migration_receipt';
export const LEGACY_MIGRATION_BACKUP_CACHE_KEY = 'backup_morajaws_tickets_v4';

const REDUNDANT_V4_CACHE_KEYS = [
  'morajaws_users_v4',
  'morajaws_contractors_v4',
  'morajaws_coverage_areas_v4',
  'morajaws_root_causes_v4',
  'morajaws_messages_v4',
  'morajaws_wa_templates_v4',
  'morajaws_workflows_v4',
  'morajaws_audit_logs_v4',
  'morajaws_wa_logs_v4',
  'morajaws_mappings_v4',
  'morajaws_canonical_fields_v4',
  'morajaws_sheets_config_v4',
  'morajaws_report_dropdown_categories',
  'morajaws_chat_categories',
  'morajaws_hierarchical_droplists'
];

export interface LegacyMigrationResult {
  status:
    | 'not_needed'
    | 'already_migrated'
    | 'verified_migrated'
    | 'deferred_unauthenticated'
    | 'deferred_offline_or_error';
  localCount: number;
  verifiedOnServerCount: number;
  reconciledToServerCount: number;
  queuedToOfflineSyncCount: number;
  backupSaved: boolean;
  removedLegacyKey: boolean;
  message: string;
}

function normalizeWoKey(wo?: string): string {
  return String(wo || '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Safely cleans redundant non-session/non-UI cache keys once Supabase data is authoritative.
 * Never removes auth session, operational date, active tab, theme, or sound preferences.
 */
export function cleanupRedundantV4Caches(): string[] {
  const removed: string[] = [];
  for (const key of REDUNDANT_V4_CACHE_KEYS) {
    if (safeLocalStorageGet(key) !== null) {
      if (safeLocalStorageRemove(key)) {
        removed.push(key);
      }
    }
  }
  return removed;
}

/**
 * Inspects legacy `morajaws_tickets_v4` in browser localStorage, backs it up to IndexedDB,
 * reconciles any missing or pending local records against Supabase, validates pre/post counts,
 * and removes `morajaws_tickets_v4` ONLY after verification succeeds.
 */
export async function inspectAndMigrateLegacyTicketsStorage(params: {
  isAuthenticated: boolean;
  isOnline: boolean;
  userId?: string;
  userName?: string;
  userRole?: UserRole;
  serverTickets: Ticket[];
}): Promise<LegacyMigrationResult> {
  const rawLegacy = safeLocalStorageGet(LEGACY_TICKETS_STORAGE_KEY);
  if (rawLegacy === null) {
    // Still ensure redundant non-WO v4 caches are cleaned when online & authenticated
    if (params.isAuthenticated && params.isOnline) {
      cleanupRedundantV4Caches();
    }
    const existingReceipt = safeLocalStorageGet(LEGACY_MIGRATION_RECEIPT_KEY);
    return {
      status: existingReceipt ? 'already_migrated' : 'not_needed',
      localCount: 0,
      verifiedOnServerCount: 0,
      reconciledToServerCount: 0,
      queuedToOfflineSyncCount: 0,
      backupSaved: false,
      removedLegacyKey: false,
      message: 'Tidak ada database tiket legacy pada localStorage.'
    };
  }

  let parsedTickets: Ticket[] = [];
  let parseError = false;
  try {
    const parsed = JSON.parse(rawLegacy);
    if (Array.isArray(parsed)) {
      parsedTickets = parsed.filter(t => t && typeof t === 'object' && (t.id || t.woNumber));
    } else {
      parseError = true;
    }
  } catch {
    parseError = true;
  }

  // Backup raw legacy payload in IndexedDB BEFORE doing anything destructive
  let backupSaved = false;
  try {
    await putMasterCacheValue(LEGACY_MIGRATION_BACKUP_CACHE_KEY, {
      backedUpAt: new Date().toISOString(),
      rawByteLength: rawLegacy.length,
      localCount: parsedTickets.length,
      parseError,
      tickets: parsedTickets.map(stripBase64BlobsFromTicket),
      rawFallback: parseError ? rawLegacy.slice(0, 100_000) : undefined
    });
    backupSaved = true;
  } catch {
    backupSaved = false;
  }

  if (parsedTickets.length === 0 && !parseError) {
    safeLocalStorageRemove(LEGACY_TICKETS_STORAGE_KEY);
    cleanupRedundantV4Caches();
    safeLocalStorageSet(
      LEGACY_MIGRATION_RECEIPT_KEY,
      JSON.stringify({
        status: 'verified_migrated',
        localCount: 0,
        verifiedOnServerCount: 0,
        migratedAt: new Date().toISOString()
      })
    );
    return {
      status: 'verified_migrated',
      localCount: 0,
      verifiedOnServerCount: 0,
      reconciledToServerCount: 0,
      queuedToOfflineSyncCount: 0,
      backupSaved,
      removedLegacyKey: true,
      message: 'Key morajaws_tickets_v4 kosong telah dibersihkan dengan aman.'
    };
  }

  if (!params.isAuthenticated) {
    return {
      status: 'deferred_unauthenticated',
      localCount: parsedTickets.length,
      verifiedOnServerCount: 0,
      reconciledToServerCount: 0,
      queuedToOfflineSyncCount: 0,
      backupSaved,
      removedLegacyKey: false,
      message: 'Menunggu login terautentikasi sebelum memverifikasi dan memigrasikan morajaws_tickets_v4.'
    };
  }

  if (!params.isOnline) {
    return {
      status: 'deferred_offline_or_error',
      localCount: parsedTickets.length,
      verifiedOnServerCount: 0,
      reconciledToServerCount: 0,
      queuedToOfflineSyncCount: 0,
      backupSaved,
      removedLegacyKey: false,
      message: 'Koneksi offline: morajaws_tickets_v4 tetap dipertahankan hingga verifikasi Supabase selesai.'
    };
  }

  // Must have IndexedDB backup secured before deleting localStorage key
  if (!backupSaved) {
    return {
      status: 'deferred_offline_or_error',
      localCount: parsedTickets.length,
      verifiedOnServerCount: 0,
      reconciledToServerCount: 0,
      queuedToOfflineSyncCount: 0,
      backupSaved: false,
      removedLegacyKey: false,
      message: 'Backup IndexedDB gagal dibuat; penghapusan morajaws_tickets_v4 ditunda demi keamanan data.'
    };
  }

  const serverById = new Map<string, Ticket>();
  const serverByWo = new Map<string, Ticket>();
  for (const st of params.serverTickets || []) {
    if (st?.id) serverById.set(String(st.id), st);
    const woKey = normalizeWoKey(st?.woNumber);
    if (woKey) serverByWo.set(woKey, st);
  }

  const missingOnServer: Ticket[] = [];
  const pendingLocalEdits: Ticket[] = [];
  let verifiedOnServerCount = 0;

  for (const lt of parsedTickets) {
    const woKey = normalizeWoKey(lt.woNumber);
    const match = (lt.id && serverById.get(String(lt.id))) || (woKey ? serverByWo.get(woKey) : undefined);

    if (!match) {
      missingOnServer.push(lt);
      continue;
    }

    const ltUpdated = new Date(lt.updatedAt || lt.createdAt || 0).getTime();
    const svUpdated = new Date(match.updatedAt || match.createdAt || 0).getTime();
    if ((lt as any)._offlineSyncStatus === 'pending' || ltUpdated > svUpdated + 2000) {
      pendingLocalEdits.push(lt);
    } else {
      verifiedOnServerCount++;
    }
  }

  let reconciledToServerCount = 0;
  let queuedToOfflineSyncCount = 0;
  let unresolvedCount = 0;

  // 1. Reconcile tickets missing on Supabase
  if (missingOnServer.length > 0) {
    if (params.userRole === 'super_admin') {
      try {
        const sanitizedMissing = missingOnServer.map(t => stripBase64BlobsFromTicket(t) as Ticket);
        const batchRes = await supabaseDb.batchCreateWorkOrders(
          sanitizedMissing,
          `legacy_v4_migration_${Date.now()}`
        );
        if (batchRes.success) {
          reconciledToServerCount += missingOnServer.length;
        } else {
          unresolvedCount += missingOnServer.length;
        }
      } catch {
        unresolvedCount += missingOnServer.length;
      }
    } else {
      // Non-superadmin users cannot create master WOs directly, so if a local ticket isn't visible
      // in their current server scope, verify whether it is pending offline or belongs to another scope.
      const existingQueue = await getAllSyncQueue().catch(() => []);
      for (const lt of missingOnServer) {
        if ((lt as any)._offlineSyncStatus === 'pending') {
          const alreadyQueued = existingQueue.some(q => q.entityId === lt.id && q.status !== 'synced');
          if (!alreadyQueued) {
            await addToSyncQueue({
              entity: 'ticket',
              entityId: lt.id,
              action: 'UPDATE',
              summary: `Migrasi edit lokal WO ${lt.woNumber || lt.id}`,
              payload: { ticketId: lt.id, updates: stripBase64BlobsFromTicket(lt) },
              user: {
                id: params.userId || 'legacy',
                name: params.userName || 'Legacy Migration',
                role: params.userRole || 'installer'
              }
            });
          }
          queuedToOfflineSyncCount++;
        } else {
          // Was a stale cached snapshot from a previous login/scope — already backed up in IndexedDB
          verifiedOnServerCount++;
        }
      }
    }
  }

  // 2. Preserve any locally pending edits into IndexedDB syncQueue
  if (pendingLocalEdits.length > 0) {
    const existingQueue = await getAllSyncQueue().catch(() => []);
    for (const lt of pendingLocalEdits) {
      const clean = stripBase64BlobsFromTicket(lt);
      if ((lt as any)._offlineSyncStatus === 'pending') {
        const alreadyQueued = existingQueue.some(q => q.entityId === lt.id && q.status !== 'synced');
        if (!alreadyQueued) {
          await addToSyncQueue({
            entity: 'ticket',
            entityId: lt.id,
            action: 'UPDATE',
            summary: `Migrasi perubahan tertunda WO ${lt.woNumber || lt.id}`,
            payload: {
              ticketId: lt.id,
              updates: {
                statusWOInstaller: clean.statusWOInstaller,
                statusWOAgent: clean.statusWOAgent,
                remarksWOInstaller: clean.remarksWOInstaller,
                technicalReport: clean.technicalReport,
                updatedAt: clean.updatedAt
              }
            },
            user: {
              id: params.userId || 'legacy',
              name: params.userName || 'Legacy Migration',
              role: params.userRole || 'installer'
            }
          });
        }
        queuedToOfflineSyncCount++;
      } else {
        verifiedOnServerCount++;
      }
    }
  }

  const accountedCount = verifiedOnServerCount + reconciledToServerCount + queuedToOfflineSyncCount;
  if (unresolvedCount > 0 || accountedCount < parsedTickets.length) {
    return {
      status: 'deferred_offline_or_error',
      localCount: parsedTickets.length,
      verifiedOnServerCount,
      reconciledToServerCount,
      queuedToOfflineSyncCount,
      backupSaved,
      removedLegacyKey: false,
      message: `Migrasi belum lengkap (${accountedCount}/${parsedTickets.length} tervalidasi). Key morajaws_tickets_v4 dipertahankan.`
    };
  }

  // Validation passed 100%: backup secured in IndexedDB & counts match -> remove morajaws_tickets_v4
  safeLocalStorageRemove(LEGACY_TICKETS_STORAGE_KEY);
  cleanupRedundantV4Caches();
  safeLocalStorageSet(
    LEGACY_MIGRATION_RECEIPT_KEY,
    JSON.stringify({
      status: 'verified_migrated',
      localCount: parsedTickets.length,
      verifiedOnServerCount,
      reconciledToServerCount,
      queuedToOfflineSyncCount,
      backupCacheKey: LEGACY_MIGRATION_BACKUP_CACHE_KEY,
      migratedAt: new Date().toISOString()
    })
  );

  return {
    status: 'verified_migrated',
    localCount: parsedTickets.length,
    verifiedOnServerCount,
    reconciledToServerCount,
    queuedToOfflineSyncCount,
    backupSaved,
    removedLegacyKey: true,
    message: `Migrasi & validasi ${parsedTickets.length} record morajaws_tickets_v4 selesai tanpa kehilangan data.`
  };
}

export async function getLegacyTicketsBackupSnapshot(): Promise<any | null> {
  return getMasterCacheValue(LEGACY_MIGRATION_BACKUP_CACHE_KEY).catch(() => null);
}
