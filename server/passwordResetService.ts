import crypto from 'crypto';
import { getSupabaseBackendClient } from './supabaseClient.ts';
import {
  getUsersFromSupabase,
  getUserByIdFromSupabase,
  findUserInSupabaseDetailed,
  updateUserInSupabase,
  getAppSettingFromSupabase,
  saveAppSettingToSupabase
} from './supabaseAdapter.ts';
import {
  hashPasswordWithBcrypt,
  hashToken,
  revokeAllUserSessions,
  validatePasswordStrength,
  checkPasswordNotReused,
  checkPasswordEndpointRateLimit
} from './customAuthService.ts';
import { db, saveDatabaseToDisk, isLocalJsonModeAllowed, isServerlessRuntime, logServerAuditAsync, type ServerUser } from '../server.ts';

// ==============================================================================
// MORAJAWS ENTERPRISE PASSWORD RESET & MASS CREDENTIAL ROTATION SERVICE
// - Zero plaintext passwords stored, logged, returned, or exported in reports.
// - Small-batch resilient execution with idempotency, retry, cancel & rollback.
// - Single-use expiring SHA-256 reset tokens with timing-safe verification.
// ==============================================================================

export type MassResetMode = 'force_change_with_token' | 'rotate_credential_and_force';
export type MassResetJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'cancelled'
  | 'rolled_back';
export type MassResetItemStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolled_back';

export interface MassResetJobItem {
  id: string;
  jobId: string;
  userId: string;
  username: string;
  userName: string;
  userRole: string;
  status: MassResetItemStatus;
  mustChangePassword: boolean;
  sessionsRevoked: boolean;
  resetTokenExpiresAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  processedAt: string | null;
  // Server-only rollback state — strictly stripped before any API response or report
  _rollbackSnapshot?: {
    prevMustChangePassword: boolean;
    prevSessionVersion: number;
    prevPasswordHash?: string;
    prevResetTokenHash?: string | null;
    prevResetTokenExpiresAt?: string | null;
  };
}

export interface MassResetJob {
  id: string;
  idempotencyKey: string | null;
  createdById: string;
  createdByName: string;
  createdByRole: string;
  resetMode: MassResetMode;
  targetScope: 'all_active' | 'by_role' | 'selected_users';
  roleFilter: string | null;
  excludeSelf: boolean;
  invalidateSessions: boolean;
  tokenTtlHours: number;
  batchSize: number;
  reason: string | null;
  status: MassResetJobStatus;
  cancelRequested: boolean;
  totalTargets: number;
  pendingCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  mustChangePasswordCount: number;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: MassResetJobItem[];
}

export interface CreateMassResetJobInput {
  actor: ServerUser;
  resetMode?: MassResetMode;
  targetScope?: 'all_active' | 'by_role' | 'selected_users';
  roleFilter?: string;
  userIds?: string[];
  excludeSelf?: boolean;
  invalidateSessions?: boolean;
  tokenTtlHours?: number;
  batchSize?: number;
  idempotencyKey?: string;
  reason?: string;
  simulateFailureUserIds?: string[]; // Test-only hook for non-production failure simulation
}

const APP_SETTING_JOBS_KEY = 'password_reset_jobs_store';
const MEMORY_JOBS = new Map<string, MassResetJob>();
let jobsHydrated = false;

function isSupabaseAvailable(): boolean {
  return Boolean(getSupabaseBackendClient());
}

function recomputeJobCounts(job: MassResetJob): void {
  let pending = 0;
  let processing = 0;
  let completed = 0;
  let failed = 0;
  let mustChange = 0;
  for (const item of job.items) {
    if (item.status === 'pending') pending++;
    else if (item.status === 'processing') processing++;
    else if (item.status === 'completed') completed++;
    else if (item.status === 'failed') failed++;
    if (item.mustChangePassword) mustChange++;
  }
  job.totalTargets = job.items.length;
  job.pendingCount = pending;
  job.processingCount = processing;
  job.completedCount = completed;
  job.failedCount = failed;
  job.mustChangePasswordCount = mustChange;
  job.updatedAt = new Date().toISOString();
}

export function sanitizeJobForClient(job: MassResetJob, includeItems = true): Omit<MassResetJob, 'items'> & { items?: Omit<MassResetJobItem, '_rollbackSnapshot'>[] } {
  const { items, ...rest } = job;
  if (!includeItems) {
    return rest;
  }
  return {
    ...rest,
    items: items.map(({ _rollbackSnapshot: _hidden, ...safeItem }) => safeItem)
  };
}

async function loadJobsStore(forceReload = false): Promise<void> {
  const shouldReloadFromSupabase = isSupabaseAvailable() && (forceReload || isServerlessRuntime());
  if (jobsHydrated && !shouldReloadFromSupabase) return;
  jobsHydrated = true;

  if (isSupabaseAvailable()) {
    try {
      const res = await getAppSettingFromSupabase(APP_SETTING_JOBS_KEY);
      if (res.success && Array.isArray(res.data)) {
        for (const j of res.data) {
          if (j && j.id) {
            const existing = MEMORY_JOBS.get(j.id);
            if (existing && Array.isArray(j.items)) {
              const snapByItemId = new Map(existing.items.map(it => [it.id, it._rollbackSnapshot]));
              for (const item of j.items) {
                if (!item._rollbackSnapshot && snapByItemId.has(item.id)) {
                  item._rollbackSnapshot = snapByItemId.get(item.id);
                }
              }
            }
            MEMORY_JOBS.set(j.id, j);
          }
        }
        return;
      }
    } catch {}
  }

  const localList = db.appSettings?.[APP_SETTING_JOBS_KEY];
  if (Array.isArray(localList)) {
    for (const j of localList) {
      if (j && j.id) MEMORY_JOBS.set(j.id, j);
    }
  }
}

async function persistJobsStore(): Promise<void> {
  const serialized = Array.from(MEMORY_JOBS.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50)
    .map(job => ({
      ...job,
      // Persist jobs cleanly without sensitive secrets (only hashes/metadata for rollback)
      items: job.items.map(item => ({ ...item }))
    }));

  db.appSettings = db.appSettings || {};
  db.appSettings[APP_SETTING_JOBS_KEY] = serialized;
  if (isLocalJsonModeAllowed()) {
    saveDatabaseToDisk();
  }

  if (isSupabaseAvailable()) {
    try {
      await saveAppSettingToSupabase(
        APP_SETTING_JOBS_KEY,
        serialized,
        'Mass password reset orchestration metadata (no plaintext passwords)'
      );
    } catch {}
  }
}

async function fetchAuthoritativeUsers(includeDeleted = false): Promise<ServerUser[]> {
  if (isSupabaseAvailable()) {
    const res = await getUsersFromSupabase(includeDeleted);
    if (res.success && Array.isArray(res.data)) {
      return res.data;
    }
    if (!isLocalJsonModeAllowed()) {
      throw new Error(res.error?.message || 'Database Supabase tidak tersedia saat mengambil daftar pengguna.');
    }
  }
  return (db.users || []).filter(u => (includeDeleted ? true : !u.isDeleted));
}

async function fetchAuthoritativeUserById(userId: string): Promise<ServerUser | null> {
  if (isSupabaseAvailable()) {
    const res = await getUserByIdFromSupabase(userId);
    if (res.success && res.data) return res.data;
    if (!res.success && !isLocalJsonModeAllowed()) {
      throw new Error(res.error?.message || 'Database Supabase gagal diakses.');
    }
  }
  return (db.users || []).find(u => u.id === userId) || null;
}

async function persistUserCredentialUpdate(userId: string, updates: Partial<ServerUser> & Record<string, any>): Promise<boolean> {
  if (isSupabaseAvailable()) {
    const res = await updateUserInSupabase(userId, updates);
    if (!res.success) {
      throw new Error(res.error?.message || 'Gagal memperbarui kredensial user di Supabase.');
    }
  }
  const localUser = (db.users || []).find(u => u.id === userId) as any;
  if (localUser) {
    Object.assign(localUser, updates);
    if (isLocalJsonModeAllowed()) {
      saveDatabaseToDisk();
    }
  }
  return true;
}

/**
 * Generates a unique cryptographically high-entropy password hash without
 * ever storing, logging, or returning the underlying secret.
 */
export async function generateUniqueCryptographicPlaceholderHash(): Promise<string> {
  const highEntropySecret = `MoraRst!${crypto.randomBytes(24).toString('base64url')}#9`;
  return hashPasswordWithBcrypt(highEntropySecret);
}

/**
 * Generates a raw single-use reset token and its SHA-256 hash.
 */
export function generateSingleUseResetTokenPair(ttlHours = 24): {
  rawToken: string;
  tokenHash: string;
  issuedAt: string;
  expiresAt: string;
} {
  const rawToken = `mora_rst_${crypto.randomBytes(24).toString('base64url')}`;
  const clampedHours = Math.max(1, Math.min(168, Number(ttlHours) || 24));
  const now = Date.now();
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + clampedHours * 3600 * 1000).toISOString()
  };
}

async function processJobBatches(
  jobId: string,
  simulateFailureUserIds?: Set<string>
): Promise<void> {
  const job = MEMORY_JOBS.get(jobId);
  if (!job) return;

  job.status = 'running';
  if (!job.startedAt) job.startedAt = new Date().toISOString();
  recomputeJobCounts(job);
  await persistJobsStore();

  const batchSize = Math.max(1, Math.min(25, job.batchSize || 5));

  while (true) {
    if (job.cancelRequested) {
      const nowIso = new Date().toISOString();
      for (const item of job.items) {
        if (item.status === 'pending') {
          item.status = 'cancelled';
          item.processedAt = nowIso;
        }
      }
      job.status = 'cancelled';
      job.cancelledAt = nowIso;
      recomputeJobCounts(job);
      await persistJobsStore();
      return;
    }

    const nextBatch = job.items.filter(i => i.status === 'pending').slice(0, batchSize);
    if (nextBatch.length === 0) break;

    for (const item of nextBatch) {
      if (job.cancelRequested) break;
      item.status = 'processing';
      item.attempts += 1;
    }
    recomputeJobCounts(job);

    for (const item of nextBatch) {
      if (job.cancelRequested) {
        if (item.status === 'processing') {
          item.status = 'pending';
        }
        break;
      }

      const nowIso = new Date().toISOString();
      try {
        if (simulateFailureUserIds && simulateFailureUserIds.has(item.userId)) {
          throw new Error('Simulasi kegagalan pembaruan akun untuk pengujian retry batch.');
        }

        const authoritative = await fetchAuthoritativeUserById(item.userId);
        if (!authoritative || authoritative.isDeleted) {
          throw new Error('Akun pengguna tidak ditemukan atau sudah dihapus.');
        }

        const prevSnapshot = {
          prevMustChangePassword: Boolean(authoritative.mustChangePassword),
          prevSessionVersion: authoritative.sessionVersion || 1,
          prevPasswordHash: job.resetMode === 'rotate_credential_and_force' ? authoritative.passwordHash : undefined,
          prevResetTokenHash: (authoritative as any).resetTokenHash ?? null,
          prevResetTokenExpiresAt: (authoritative as any).resetTokenExpiresAt ?? null
        };
        item._rollbackSnapshot = prevSnapshot;

        const { tokenHash } = generateSingleUseResetTokenPair();
        const ttlHours = Math.max(1, Math.min(168, job.tokenTtlHours || 24));
        const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
        const nextVersion = (authoritative.sessionVersion || 1) + 1;

        const updates: Partial<ServerUser> & Record<string, any> = {
          mustChangePassword: true,
          sessionVersion: nextVersion,
          resetTokenHash: tokenHash,
          resetTokenExpiresAt: expiresAt,
          resetTokenIssuedAt: nowIso,
          resetTokenUsedAt: null
        };

        if (job.resetMode === 'rotate_credential_and_force') {
          updates.passwordHash = await generateUniqueCryptographicPlaceholderHash();
          updates.passwordChangedAt = nowIso;
        }

        await persistUserCredentialUpdate(authoritative.id, updates);

        if (job.invalidateSessions) {
          await revokeAllUserSessions(authoritative.id, job.createdById, { skipVersionIncrement: true });
        }

        item.status = 'completed';
        item.mustChangePassword = true;
        item.sessionsRevoked = Boolean(job.invalidateSessions);
        item.resetTokenExpiresAt = expiresAt;
        item.errorCode = null;
        item.errorMessage = null;
        item.processedAt = nowIso;
      } catch (err: any) {
        item.status = 'failed';
        item.errorCode = 'ITEM_RESET_FAILED';
        item.errorMessage = err?.message || 'Gagal memproses reset sandi untuk akun ini.';
        item.processedAt = nowIso;
      }
    }

    recomputeJobCounts(job);
    await persistJobsStore();

    // Yield event loop cleanly between small batches so operational API remains responsive
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  if (job.cancelRequested) {
    const nowIso = new Date().toISOString();
    for (const item of job.items) {
      if (item.status === 'pending') {
        item.status = 'cancelled';
        item.processedAt = nowIso;
      }
    }
    job.status = 'cancelled';
    job.cancelledAt = nowIso;
  } else {
    job.completedAt = new Date().toISOString();
    job.status = job.failedCount > 0 ? 'completed_with_errors' : 'completed';
  }
  recomputeJobCounts(job);
  await persistJobsStore();

  await logServerAuditAsync(
    'MASS_PASSWORD_RESET_COMPLETED',
    'auth',
    job.id,
    `Batch reset password ${job.id} selesai (${job.completedCount}/${job.totalTargets} berhasil, ${job.failedCount} gagal, mode=${job.resetMode}).`,
    { id: job.createdById, name: job.createdByName, role: job.createdByRole } as any,
    { level: 'critical', metadata: { jobId: job.id, status: job.status, total: job.totalTargets, completed: job.completedCount, failed: job.failedCount } }
  );
}

/**
 * Creates & executes a Superadmin-exclusive mass password reset job.
 * Idempotent when `idempotencyKey` is provided.
 */
export async function createAndStartMassResetJob(input: CreateMassResetJobInput): Promise<{
  job: MassResetJob;
  deduplicated: boolean;
}> {
  await loadJobsStore();

  const cleanIdempotency = input.idempotencyKey ? String(input.idempotencyKey).trim() : null;
  if (cleanIdempotency) {
    for (const existing of MEMORY_JOBS.values()) {
      if (existing.idempotencyKey === cleanIdempotency) {
        return { job: existing, deduplicated: true };
      }
    }
  }

  const allUsers = await fetchAuthoritativeUsers(false);
  const scope = input.targetScope || 'all_active';
  const excludeSelf = input.excludeSelf !== false;

  const targetUsers = allUsers.filter(u => {
    if (!u || u.isDeleted) return false;
    if (!u.active) return false;
    if (excludeSelf && u.id === input.actor.id) return false;
    if (scope === 'by_role' && input.roleFilter) {
      return u.role === input.roleFilter;
    }
    if (scope === 'selected_users' && Array.isArray(input.userIds)) {
      return input.userIds.includes(u.id);
    }
    return true;
  });

  const nowIso = new Date().toISOString();
  const jobId = `pwjob_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const job: MassResetJob = {
    id: jobId,
    idempotencyKey: cleanIdempotency,
    createdById: input.actor.id,
    createdByName: input.actor.name,
    createdByRole: input.actor.role,
    resetMode: input.resetMode || 'force_change_with_token',
    targetScope: scope,
    roleFilter: input.roleFilter || null,
    excludeSelf,
    invalidateSessions: input.invalidateSessions !== false,
    tokenTtlHours: Math.max(1, Math.min(168, Number(input.tokenTtlHours) || 24)),
    batchSize: Math.max(1, Math.min(25, Number(input.batchSize) || 5)),
    reason: input.reason ? String(input.reason).trim().slice(0, 240) : null,
    status: 'queued',
    cancelRequested: false,
    totalTargets: targetUsers.length,
    pendingCount: targetUsers.length,
    processingCount: 0,
    completedCount: 0,
    failedCount: 0,
    mustChangePasswordCount: 0,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    rolledBackAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    items: targetUsers.map(u => ({
      id: `pwitem_${jobId}_${u.id}`,
      jobId,
      userId: u.id,
      username: u.username,
      userName: u.name,
      userRole: u.role,
      status: 'pending',
      mustChangePassword: false,
      sessionsRevoked: false,
      resetTokenExpiresAt: null,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      processedAt: null
    }))
  };

  MEMORY_JOBS.set(job.id, job);
  await persistJobsStore();

  await logServerAuditAsync(
    'MASS_PASSWORD_RESET_STARTED',
    'auth',
    job.id,
    `Superadmin ${input.actor.name} memulai batch reset password ${job.id} untuk ${job.totalTargets} akun (mode=${job.resetMode}).`,
    input.actor,
    { level: 'critical', metadata: { jobId: job.id, targetCount: job.totalTargets, scope } }
  );

  const simFailSet = Array.isArray(input.simulateFailureUserIds) && input.simulateFailureUserIds.length > 0
    ? new Set(input.simulateFailureUserIds)
    : undefined;

  if (targetUsers.length === 0) {
    job.status = 'completed';
    job.startedAt = nowIso;
    job.completedAt = nowIso;
    await persistJobsStore();
    return { job, deduplicated: false };
  }

  if (isServerlessRuntime()) {
    await processJobBatches(job.id, simFailSet);
  } else {
    // Run batch processing asynchronously on persistent Node servers for live progress polling
    void processJobBatches(job.id, simFailSet);
  }

  return { job, deduplicated: false };
}

export async function listMassResetJobs(): Promise<MassResetJob[]> {
  await loadJobsStore();
  return Array.from(MEMORY_JOBS.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getMassResetJob(jobId: string): Promise<MassResetJob | null> {
  await loadJobsStore();
  return MEMORY_JOBS.get(jobId) || null;
}

/**
 * Retries ONLY failed items in an existing batch job without duplicating completed resets.
 */
export async function retryFailedJobItems(
  jobId: string,
  actor: ServerUser
): Promise<{ success: boolean; job?: MassResetJob; retriedCount?: number; error?: string }> {
  await loadJobsStore();
  const job = MEMORY_JOBS.get(jobId);
  if (!job) return { success: false, error: 'Job reset sandi tidak ditemukan.' };
  if (job.status === 'running') {
    return { success: false, error: 'Job sedang berjalan. Tunggu hingga batch saat ini selesai.' };
  }
  if (job.status === 'rolled_back') {
    return { success: false, error: 'Job yang telah di-rollback tidak dapat di-retry.' };
  }

  const failedItems = job.items.filter(i => i.status === 'failed');
  if (failedItems.length === 0) {
    return { success: false, error: 'Tidak ada item gagal untuk di-retry pada job ini.' };
  }

  job.cancelRequested = false;
  job.completedAt = null;
  for (const item of failedItems) {
    item.status = 'pending';
    item.errorCode = null;
    item.errorMessage = null;
  }
  recomputeJobCounts(job);
  await persistJobsStore();

  await logServerAuditAsync(
    'MASS_PASSWORD_RESET_RETRY',
    'auth',
    job.id,
    `Superadmin ${actor.name} me-retry ${failedItems.length} item gagal pada batch ${job.id}.`,
    actor,
    { level: 'critical' }
  );

  if (isServerlessRuntime()) {
    await processJobBatches(job.id);
  } else {
    void processJobBatches(job.id);
  }
  return { success: true, job, retriedCount: failedItems.length };
}

/**
 * Cancels remaining pending items on an active/queued batch job.
 */
export async function cancelMassResetJob(
  jobId: string,
  actor: ServerUser
): Promise<{ success: boolean; job?: MassResetJob; error?: string }> {
  await loadJobsStore();
  const job = MEMORY_JOBS.get(jobId);
  if (!job) return { success: false, error: 'Job reset sandi tidak ditemukan.' };
  if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'rolled_back') {
    return { success: false, error: `Job sudah berstatus ${job.status}.` };
  }

  job.cancelRequested = true;
  const nowIso = new Date().toISOString();
  for (const item of job.items) {
    if (item.status === 'pending') {
      item.status = 'cancelled';
      item.processedAt = nowIso;
    }
  }
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.cancelledAt = nowIso;
  }
  recomputeJobCounts(job);
  await persistJobsStore();

  await logServerAuditAsync(
    'MASS_PASSWORD_RESET_CANCELLED',
    'auth',
    job.id,
    `Superadmin ${actor.name} membatalkan sisa antrean batch reset sandi ${job.id}.`,
    actor,
    { level: 'critical' }
  );

  return { success: true, job };
}

/**
 * Safely rolls back completed items in a batch job using pre-job metadata.
 */
export async function rollbackMassResetJob(
  jobId: string,
  actor: ServerUser
): Promise<{ success: boolean; job?: MassResetJob; rolledBackCount?: number; error?: string }> {
  await loadJobsStore();
  const job = MEMORY_JOBS.get(jobId);
  if (!job) return { success: false, error: 'Job reset sandi tidak ditemukan.' };
  if (job.status === 'running') {
    return { success: false, error: 'Batalkan atau tunggu job selesai sebelum melakukan rollback.' };
  }
  if (job.status === 'rolled_back') {
    return { success: false, error: 'Job ini sudah di-rollback sebelumnya.' };
  }

  let rolledBackCount = 0;
  const nowIso = new Date().toISOString();
  for (const item of job.items) {
    if (item.status !== 'completed' || !item._rollbackSnapshot) continue;
    try {
      const snap = item._rollbackSnapshot;
      const updates: Partial<ServerUser> & Record<string, any> = {
        mustChangePassword: snap.prevMustChangePassword,
        sessionVersion: snap.prevSessionVersion + 1,
        resetTokenHash: snap.prevResetTokenHash ?? null,
        resetTokenExpiresAt: snap.prevResetTokenExpiresAt ?? null
      };
      if (snap.prevPasswordHash) {
        updates.passwordHash = snap.prevPasswordHash;
      }
      await persistUserCredentialUpdate(item.userId, updates);
      item.status = 'rolled_back';
      item.mustChangePassword = snap.prevMustChangePassword;
      item.processedAt = nowIso;
      rolledBackCount++;
    } catch (err: any) {
      item.errorCode = 'ROLLBACK_FAILED';
      item.errorMessage = err?.message || 'Gagal melakukan rollback akun.';
    }
  }

  job.status = 'rolled_back';
  job.rolledBackAt = nowIso;
  recomputeJobCounts(job);
  await persistJobsStore();

  await logServerAuditAsync(
    'MASS_PASSWORD_RESET_ROLLBACK',
    'auth',
    job.id,
    `Superadmin ${actor.name} melakukan rollback pada batch ${job.id} (${rolledBackCount} akun dipulihkan).`,
    actor,
    { level: 'critical' }
  );

  return { success: true, job, rolledBackCount };
}

/**
 * Generates a sanitized, non-sensitive summary report for download or display.
 * Strictly NEVER contains passwords, hashes, or raw reset tokens.
 */
export function buildSanitizedJobReport(job: MassResetJob) {
  return {
    reportGeneratedAt: new Date().toISOString(),
    securityNotice: 'Laporan ini bebas dari kata sandi plaintext, hash kredensial, dan token mentah.',
    jobId: job.id,
    status: job.status,
    resetMode: job.resetMode,
    targetScope: job.targetScope,
    roleFilter: job.roleFilter,
    reason: job.reason,
    initiatedBy: {
      id: job.createdById,
      name: job.createdByName,
      role: job.createdByRole
    },
    timestamps: {
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      cancelledAt: job.cancelledAt,
      rolledBackAt: job.rolledBackAt
    },
    summaryCounts: {
      totalTargets: job.totalTargets,
      pending: job.pendingCount,
      processing: job.processingCount,
      completed: job.completedCount,
      failed: job.failedCount,
      mustChangePassword: job.mustChangePasswordCount
    },
    items: job.items.map(i => ({
      userId: i.userId,
      username: i.username,
      userName: i.userName,
      userRole: i.userRole,
      status: i.status,
      mustChangePassword: i.mustChangePassword,
      sessionsRevoked: i.sessionsRevoked,
      resetTokenExpiresAt: i.resetTokenExpiresAt,
      attempts: i.attempts,
      errorCode: i.errorCode,
      errorMessage: i.errorMessage,
      processedAt: i.processedAt
    }))
  };
}

/**
 * Issues a single-use expiring reset token for a single user (Superadmin-only).
 * Stores ONLY SHA-256 hash in database and sets must_change_password = true.
 */
export async function issueSingleUseResetTokenForUser(params: {
  targetUserId: string;
  actor: ServerUser;
  ttlMinutes?: number;
  invalidatePassword?: boolean;
}): Promise<{
  success: boolean;
  resetToken?: string;
  expiresAt?: string;
  targetUser?: { id: string; username: string; name: string; role: string };
  error?: string;
  code?: string;
}> {
  const user = await fetchAuthoritativeUserById(params.targetUserId);
  if (!user || user.isDeleted) {
    return { success: false, code: 'USER_NOT_FOUND', error: 'Pengguna yang dituju tidak ditemukan.' };
  }

  const ttlMinutes = Math.max(5, Math.min(4320, Number(params.ttlMinutes) || 60 * 24));
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const { rawToken, tokenHash } = generateSingleUseResetTokenPair();
  const nextVersion = (user.sessionVersion || 1) + 1;

  const updates: Partial<ServerUser> & Record<string, any> = {
    mustChangePassword: true,
    sessionVersion: nextVersion,
    resetTokenHash: tokenHash,
    resetTokenExpiresAt: expiresAt,
    resetTokenIssuedAt: nowIso,
    resetTokenUsedAt: null
  };
  if (params.invalidatePassword) {
    updates.passwordHash = await generateUniqueCryptographicPlaceholderHash();
  }

  await persistUserCredentialUpdate(user.id, updates);
  await revokeAllUserSessions(user.id, params.actor.id, { skipVersionIncrement: true });

  await logServerAuditAsync(
    'SINGLE_USE_RESET_TOKEN_ISSUED',
    'auth',
    user.id,
    `Superadmin ${params.actor.name} menerbitkan token reset sandi satu-kali (berlaku hingga ${expiresAt}) untuk @${user.username}.`,
    params.actor,
    { targetUserId: user.id, level: 'critical' }
  );

  return {
    success: true,
    resetToken: rawToken,
    expiresAt,
    targetUser: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  };
}

/**
 * Verifies and consumes a single-use expiring reset token to set a strong new password.
 * Rate-limited and non-enumerating on invalid credentials/tokens.
 */
export async function consumeResetTokenAndSetPassword(params: {
  identifier: string;
  token: string;
  newPassword: string;
  confirmPassword?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{
  success: boolean;
  code?: string;
  error?: string;
  retryAfterSeconds?: number;
}> {
  const cleanIdent = String(params.identifier || '').trim().toLowerCase();
  const cleanToken = String(params.token || '').trim();

  const rateRes = checkPasswordEndpointRateLimit(
    `reset_token:${params.ipAddress || 'unknown'}:${cleanIdent || 'anon'}`,
    8,
    15 * 60 * 1000
  );
  if (!rateRes.allowed) {
    return {
      success: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds: rateRes.retryAfterSeconds,
      error: `Terlalu banyak percobaan reset kata sandi. Silakan coba lagi dalam ${rateRes.retryAfterSeconds} detik.`
    };
  }

  if (!cleanIdent || !cleanToken || !params.newPassword) {
    return {
      success: false,
      code: 'INVALID_INPUT',
      error: 'Username/email, token reset, dan kata sandi baru wajib diisi.'
    };
  }

  if (params.confirmPassword !== undefined && params.newPassword !== params.confirmPassword) {
    return {
      success: false,
      code: 'PASSWORDS_DO_NOT_MATCH',
      error: 'Konfirmasi kata sandi tidak cocok dengan kata sandi baru.'
    };
  }

  // Uniform generic failure message to prevent user enumeration
  const genericTokenError = {
    success: false,
    code: 'INVALID_OR_EXPIRED_TOKEN',
    error: 'Token reset sandi tidak valid, sudah digunakan, atau telah kedaluwarsa.'
  };

  let targetUser: ServerUser | null = null;
  if (isSupabaseAvailable()) {
    const res = await findUserInSupabaseDetailed(cleanIdent);
    if (res.success && res.data) {
      targetUser = res.data;
    }
  }
  if (!targetUser && isLocalJsonModeAllowed()) {
    targetUser =
      (db.users || []).find(
        u =>
          !u.isDeleted &&
          (u.username.toLowerCase() === cleanIdent || u.email.toLowerCase() === cleanIdent)
      ) || null;
  }

  if (!targetUser || targetUser.isDeleted || !targetUser.active) {
    return genericTokenError;
  }

  const storedHash = String((targetUser as any).resetTokenHash || '');
  const expiresAt = (targetUser as any).resetTokenExpiresAt;
  const usedAt = (targetUser as any).resetTokenUsedAt;
  if (!storedHash || !expiresAt || usedAt) {
    return genericTokenError;
  }
  if (new Date(expiresAt).getTime() <= Date.now()) {
    return genericTokenError;
  }

  const candidateHash = hashToken(cleanToken);
  if (candidateHash.length !== storedHash.length) {
    return genericTokenError;
  }
  let tokenMatch = false;
  try {
    tokenMatch = crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(storedHash));
  } catch {
    tokenMatch = false;
  }
  if (!tokenMatch) {
    return genericTokenError;
  }

  const strength = validatePasswordStrength(params.newPassword, {
    username: targetUser.username,
    email: targetUser.email,
    name: targetUser.name
  });
  if (!strength.valid) {
    return {
      success: false,
      code: 'WEAK_PASSWORD',
      error: strength.error || 'Kata sandi baru belum memenuhi kebijakan keamanan.'
    };
  }

  const reuseCheck = await checkPasswordNotReused(
    params.newPassword,
    targetUser.passwordHash,
    (targetUser as any).passwordHistoryHashes
  );
  if (reuseCheck.reused) {
    return {
      success: false,
      code: 'PASSWORD_CANNOT_BE_REUSED',
      error: 'Kata sandi baru tidak boleh sama dengan kata sandi sebelumnya.'
    };
  }

  const newHash = await hashPasswordWithBcrypt(params.newPassword);
  const nowIso = new Date().toISOString();
  const nextVersion = (targetUser.sessionVersion || 1) + 1;
  const prevHistory = Array.isArray((targetUser as any).passwordHistoryHashes)
    ? (targetUser as any).passwordHistoryHashes
    : [];
  const updatedHistory = [
    ...(targetUser.passwordHash ? [targetUser.passwordHash] : []),
    ...prevHistory
  ].slice(0, 5);

  await persistUserCredentialUpdate(targetUser.id, {
    passwordHash: newHash,
    passwordChangedAt: nowIso,
    mustChangePassword: false,
    sessionVersion: nextVersion,
    accountStatus: 'active',
    failedLoginCount: 0,
    lockedUntil: null,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    resetTokenUsedAt: nowIso,
    passwordHistoryHashes: updatedHistory
  });

  await revokeAllUserSessions(targetUser.id, targetUser.id, { skipVersionIncrement: true });

  await logServerAuditAsync(
    'USER_PASSWORD_RESET_BY_TOKEN',
    'auth',
    targetUser.id,
    `Pengguna @${targetUser.username} menyelesaikan reset kata sandi menggunakan token satu-kali.`,
    targetUser,
    { ipAddress: params.ipAddress, userAgent: params.userAgent, level: 'critical' }
  );

  return { success: true };
}
