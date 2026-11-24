import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getSupabaseBackendClient, isSupabaseConfigured } from './supabaseClient.ts';
import {
  findUserInSupabaseDetailed,
  getUsersFromSupabase,
  insertUserToSupabase,
  updateUserInSupabase,
  insertUserSessionToSupabase,
  revokeUserSessionInSupabase,
  postgresRowToUser,
  userToPostgresRow,
  classifySupabaseError
} from './supabaseAdapter.ts';
import type { ServerUser, ServerSession } from '../server.ts';
import { sessionStore } from './sessionStore.ts';
import { db, saveDatabaseToDisk, isLocalJsonModeAllowed, logServerAuditAsync, hashPasswordLegacy } from '../server.ts';

// ==============================================================================
// MORAJAWS CUSTOM AUTHENTICATION SERVICE
// Internal authentication engine for MoraJaws using Supabase PostgreSQL as MAIN DB.
// - Password hashing: bcrypt (10 rounds) with automated legacy upgrade.
// - Cryptographically secure access tokens & refresh tokens with rotation.
// - Database-backed session management (auth_sessions, refresh_tokens, login_attempts).
// - Brute-force protection & temporary account lockout (5 attempts in 15 mins).
// - Strict RBAC: Superadmin-exclusive user management and password resets.
// - Zero dependency on Supabase Auth (auth.users) or Firebase Auth.
// ==============================================================================

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
}

export interface CustomAuthResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface StoredAuthSession {
  id: string;
  userId: string;
  sessionIdHash: string;
  tokenHash: string;
  expiresAt: string;
  lastActivityAt: string;
  sessionVersion?: number;
  revokedAt?: string | null;
  ipAddress?: string;
  userAgent?: string;
  deviceType?: string;
  createdAt: string;
}

export interface StoredRefreshToken {
  id: string;
  userId: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string | null;
  replacedByTokenHash?: string | null;
  createdAt: string;
}

export interface StoredLoginAttempt {
  id: string;
  identifier: string;
  ipAddress?: string;
  success: boolean;
  reason?: string;
  attemptedAt: string;
}

// In-memory fallback stores (used when local dev mode is permitted)
export const LOCAL_AUTH_SESSIONS: StoredAuthSession[] = [];
export const LOCAL_REFRESH_TOKENS: StoredRefreshToken[] = [];
export const LOCAL_LOGIN_ATTEMPTS: StoredLoginAttempt[] = [];

// Rate limiting & lockout tracker (in-memory fast cache, backed by login_attempts table)
interface LockoutTracker {
  attempts: number;
  lastAttemptAt: number;
  lockedUntil?: number;
}
const MEMORY_RATE_LIMITER = new Map<string, LockoutTracker>();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes window
const ACCESS_TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ------------------------------------------------------------------------------
// PASSWORD HASHING & COMPLEXITY (ENTERPRISE POLICY)
// ------------------------------------------------------------------------------

const COMMON_WEAK_PASSWORDS = new Set([
  '1234',
  '12345',
  '123456',
  '1234567',
  '12345678',
  '87654321',
  '0000',
  '000000',
  '00000000',
  'password',
  'qwerty',
  'qwertyui',
  'admin123',
  'abcdef',
  'abcdefgh',
  'letmein',
  'welcome'
]);

const WEAK_SUBSTRINGS = ['123456', '654321', 'qwerty', 'password', 'asdfgh', 'zxcvbn'];

export interface PasswordStrengthContext {
  username?: string;
  email?: string;
  name?: string;
}

/**
 * Validates password policy:
 * - Minimum 4 characters, maximum 8 characters
 * - No spaces or trivial repeated characters
 * - Rejects common weak passwords
 * - Rejects exact match to username or email local-part
 */
export function validatePasswordStrength(
  password: string,
  context?: PasswordStrengthContext
): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Kata sandi wajib diisi.' };
  }
  if (/\s/.test(password)) {
    return { valid: false, error: 'Kata sandi tidak boleh mengandung spasi.' };
  }
  if (password.length < 4) {
    return { valid: false, error: 'Kata sandi minimal 4 karakter.' };
  }
  if (password.length > 8) {
    return { valid: false, error: 'Kata sandi maksimal 8 karakter.' };
  }
  if (/(.)\1{3,}/.test(password)) {
    return { valid: false, error: 'Kata sandi tidak boleh menggunakan pengulangan karakter yang sama.' };
  }

  const lower = password.toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(lower)) {
    return { valid: false, error: 'Kata sandi terlalu umum dan mudah ditebak. Gunakan kombinasi yang lebih unik.' };
  }
  for (const seq of WEAK_SUBSTRINGS) {
    if (lower.includes(seq)) {
      return { valid: false, error: 'Kata sandi tidak boleh mengandung pola umum atau urutan karakter sederhana.' };
    }
  }

  if (context) {
    const cleanUsername = String(context.username || '').trim().toLowerCase();
    if (cleanUsername.length >= 3 && lower === cleanUsername) {
      return { valid: false, error: 'Kata sandi tidak boleh sama dengan username Anda.' };
    }
    const emailLocal = String(context.email || '').trim().toLowerCase().split('@')[0];
    if (emailLocal && emailLocal.length >= 3 && lower === emailLocal) {
      return { valid: false, error: 'Kata sandi tidak boleh sama dengan nama akun email Anda.' };
    }
  }

  return { valid: true };
}

/**
 * Checks whether candidate password matches the current hash or any historical password hashes.
 */
export async function checkPasswordNotReused(
  candidatePassword: string,
  currentHash?: string,
  historyHashes?: string[]
): Promise<{ reused: boolean }> {
  const hashesToCheck: string[] = [];
  if (currentHash && typeof currentHash === 'string') {
    hashesToCheck.push(currentHash);
  }
  if (Array.isArray(historyHashes)) {
    for (const h of historyHashes) {
      if (typeof h === 'string' && h && !hashesToCheck.includes(h)) {
        hashesToCheck.push(h);
      }
    }
  }
  for (const h of hashesToCheck) {
    const res = await verifyUserPasswordEx(candidatePassword, h);
    if (res.valid) {
      return { reused: true };
    }
  }
  return { reused: false };
}

// Sliding-window rate limiter specifically for password reset & password change endpoints
const PASSWORD_ENDPOINT_LIMITER = new Map<string, number[]>();

export function checkPasswordEndpointRateLimit(
  key: string,
  maxRequests: number = 10,
  windowMs: number = 15 * 60 * 1000
): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const cleanKey = String(key || 'unknown').trim().toLowerCase();
  const timestamps = (PASSWORD_ENDPOINT_LIMITER.get(cleanKey) || []).filter(ts => now - ts < windowMs);
  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0] || now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    PASSWORD_ENDPOINT_LIMITER.set(cleanKey, timestamps);
    return { allowed: false, retryAfterSeconds };
  }
  timestamps.push(now);
  PASSWORD_ENDPOINT_LIMITER.set(cleanKey, timestamps);
  return { allowed: true };
}

/**
 * Generates a standard bcrypt hash (10 salt rounds).
 */
export async function hashPasswordWithBcrypt(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Verifies a candidate password against stored password hash.
 * Supports:
 * 1. Standard bcrypt hash ($2a$, $2b$, $2y$)
 * 2. Legacy PBKDF2 hash (pbkdf2:sha256:...)
 * 3. Legacy FNV-1a hash
 * If verified via a legacy algorithm, returns `needsRehash: true` so the caller
 * can automatically upgrade the stored hash to bcrypt.
 */
export async function verifyUserPasswordEx(
  password?: string,
  storedHash?: string
): Promise<{ valid: boolean; needsRehash?: boolean }> {
  if (!password || !storedHash || typeof password !== 'string' || typeof storedHash !== 'string') {
    return { valid: false };
  }

  const trimmedHash = storedHash.trim();

  // 1. Check bcrypt ($2a$, $2b$, $2y$)
  if (trimmedHash.startsWith('$2a$') || trimmedHash.startsWith('$2b$') || trimmedHash.startsWith('$2y$')) {
    try {
      const match = await bcrypt.compare(password, trimmedHash);
      return { valid: match, needsRehash: false };
    } catch {
      return { valid: false };
    }
  }

  // 2. Check PBKDF2-SHA256 format: pbkdf2:sha256:<iterations>:<salt>:<hex>
  // Keep strong PBKDF2 (>= 100k iterations) untouched so existing database hashes are never mutated unexpectedly.
  if (trimmedHash.startsWith('pbkdf2:sha256:')) {
    const parts = trimmedHash.split(':');
    if (parts.length === 5) {
      const iterations = parseInt(parts[2], 10);
      const salt = parts[3];
      const originalHash = parts[4].toLowerCase();
      if (!isNaN(iterations) && iterations > 0 && salt && /^[0-9a-f]+$/i.test(originalHash) && originalHash.length % 2 === 0) {
        try {
          const keyLen = Math.max(16, Math.floor(originalHash.length / 2));
          const derivedKeyHex = crypto.pbkdf2Sync(password, salt, iterations, keyLen, 'sha256').toString('hex').toLowerCase();
          if (derivedKeyHex.length === originalHash.length) {
            const isValid = crypto.timingSafeEqual(
              Buffer.from(derivedKeyHex, 'utf8'),
              Buffer.from(originalHash, 'utf8')
            );
            return { valid: isValid, needsRehash: isValid && iterations < 100000 };
          }
        } catch {}
      }
    }
  }

  // 3. Check salted SHA-256 legacy format (64 hex chars matching client hashPassword helper)
  if (/^[0-9a-f]{64}$/i.test(trimmedHash)) {
    try {
      const sha256Attempt = crypto
        .createHash('sha256')
        .update(`morajaws_secure_salt_2026:${password}`)
        .digest('hex')
        .toLowerCase();
      const targetHex = trimmedHash.toLowerCase();
      if (crypto.timingSafeEqual(Buffer.from(sha256Attempt, 'utf8'), Buffer.from(targetHex, 'utf8'))) {
        return { valid: true, needsRehash: true };
      }
    } catch {}
  }

  // 4. Check legacy FNV hash (e.g., initial seed hash '28232849')
  const legacyAttempt = hashPasswordLegacy(password);
  if (legacyAttempt.length === trimmedHash.length) {
    try {
      const match = crypto.timingSafeEqual(Buffer.from(legacyAttempt), Buffer.from(trimmedHash));
      if (match) return { valid: true, needsRehash: true };
    } catch {}
  }
  if (legacyAttempt === trimmedHash) {
    return { valid: true, needsRehash: true };
  }

  return { valid: false };
}

// ------------------------------------------------------------------------------
// TOKEN GENERATION & HASHING
// ------------------------------------------------------------------------------

/**
 * Generates cryptographically secure random access token tied to sessionVersion.
 */
export function generateSecureAccessToken(sessionVersion: number = 1): string {
  const v = Math.max(1, typeof sessionVersion === 'number' ? sessionVersion : 1);
  return `mora_at_v${v}_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Generates cryptographically secure random refresh token tied to sessionVersion.
 */
export function generateSecureRefreshToken(sessionVersion: number = 1): string {
  const v = Math.max(1, typeof sessionVersion === 'number' ? sessionVersion : 1);
  return `mora_rt_v${v}_${crypto.randomBytes(48).toString('hex')}`;
}

/**
 * Computes SHA-256 hash of a token for secure database indexing and storage.
 * Raw tokens are never stored plaintext in the database.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

// ------------------------------------------------------------------------------
// RATE LIMITING & LOCKOUT MANAGEMENT
// ------------------------------------------------------------------------------

/**
 * Evaluates whether an identifier or IP is currently locked out due to excessive failed attempts.
 */
export async function checkRateLimitAndLockout(
  identifier: string,
  ipAddress?: string
): Promise<{ isLocked: boolean; remainingSeconds?: number; message?: string }> {
  const now = Date.now();
  const cleanId = (identifier || '').trim().toLowerCase();
  const key = `${cleanId}_${ipAddress || 'unknown'}`;

  // 1. Fast in-memory check
  const memTracker = MEMORY_RATE_LIMITER.get(key) || MEMORY_RATE_LIMITER.get(cleanId);
  if (memTracker && memTracker.lockedUntil && memTracker.lockedUntil > now) {
    const remainingSeconds = Math.ceil((memTracker.lockedUntil - now) / 1000);
    return {
      isLocked: true,
      remainingSeconds,
      message: `Terlalu banyak percobaan login gagal. Akun dikunci sementara. Silakan coba kembali dalam ${remainingSeconds} detik.`
    };
  }

  // 2. Authoritative check in Supabase PostgreSQL login_attempts
  const client = getSupabaseBackendClient();
  if (client) {
    try {
      const windowStart = new Date(now - ATTEMPT_WINDOW_MS).toISOString();
      const { data, error } = await client
        .from('login_attempts')
        .select('success, attempted_at')
        .eq('identifier', cleanId)
        .gte('attempted_at', windowStart)
        .order('attempted_at', { ascending: false })
        .limit(10);

      if (!error && Array.isArray(data)) {
        let consecutiveFailures = 0;
        let lastFailureTime = now;
        for (const row of data) {
          if (!row.success) {
            consecutiveFailures++;
            lastFailureTime = new Date(row.attempted_at).getTime();
          } else {
            break; // Stop at most recent success
          }
        }

        if (consecutiveFailures >= MAX_FAILED_ATTEMPTS) {
          const lockExpires = lastFailureTime + LOCKOUT_DURATION_MS;
          if (lockExpires > now) {
            const remainingSeconds = Math.ceil((lockExpires - now) / 1000);
            MEMORY_RATE_LIMITER.set(cleanId, {
              attempts: consecutiveFailures,
              lastAttemptAt: now,
              lockedUntil: lockExpires
            });
            return {
              isLocked: true,
              remainingSeconds,
              message: `Terlalu banyak percobaan login gagal. Akun dikunci sementara. Silakan coba kembali dalam ${remainingSeconds} detik.`
            };
          }
        }
      }
    } catch (err) {
      console.warn('[RateLimiter] Database query check warning:', err);
    }
  }

  return { isLocked: false };
}

/**
 * Records a login attempt into Supabase PostgreSQL login_attempts table and in-memory tracker.
 */
export async function recordLoginAttempt(params: {
  identifier: string;
  ipAddress?: string;
  success: boolean;
  reason?: string;
}): Promise<void> {
  const { identifier, ipAddress, success, reason } = params;
  const cleanId = (identifier || '').trim().toLowerCase();
  const now = Date.now();
  const attemptId = `att_${now}_${crypto.randomBytes(6).toString('hex')}`;
  const nowIso = new Date(now).toISOString();

  // Update in-memory tracker
  const key = `${cleanId}_${ipAddress || 'unknown'}`;
  const current = MEMORY_RATE_LIMITER.get(key) || { attempts: 0, lastAttemptAt: now };
  if (success) {
    MEMORY_RATE_LIMITER.delete(key);
    MEMORY_RATE_LIMITER.delete(cleanId);
  } else {
    current.attempts += 1;
    current.lastAttemptAt = now;
    if (current.attempts >= MAX_FAILED_ATTEMPTS) {
      current.lockedUntil = now + LOCKOUT_DURATION_MS;
    }
    MEMORY_RATE_LIMITER.set(key, current);
    MEMORY_RATE_LIMITER.set(cleanId, current);
  }

  // Persist to Supabase PostgreSQL login_attempts table
  const client = getSupabaseBackendClient();
  if (client) {
    try {
      await client.from('login_attempts').insert([
        {
          id: attemptId,
          identifier: cleanId,
          ip_address: ipAddress || null,
          success,
          reason: reason || null,
          attempted_at: nowIso
        }
      ]);
    } catch (err: any) {
      // Table might not be created yet, fallback gracefully
      console.warn('[CustomAuth] Record login attempt warning:', err?.message || err);
    }
  }

  if (isLocalJsonModeAllowed()) {
    LOCAL_LOGIN_ATTEMPTS.unshift({
      id: attemptId,
      identifier: cleanId,
      ipAddress,
      success,
      reason,
      attemptedAt: nowIso
    });
    if (LOCAL_LOGIN_ATTEMPTS.length > 500) LOCAL_LOGIN_ATTEMPTS.pop();
  }
}

// ------------------------------------------------------------------------------
// DATABASE SESSION & TOKEN OPERATIONS (SUPABASE POSTGRESQL AUTHORITATIVE)
// ------------------------------------------------------------------------------

/**
 * Creates an authoritative auth session and associated initial refresh token in Supabase PostgreSQL.
 */
export async function persistNewAuthSession(params: {
  userId: string;
  username?: string;
  name?: string;
  role?: ServerUser['role'];
  contractor?: string;
  accessToken: string;
  refreshToken: string;
  ipAddress?: string;
  userAgent?: string;
  sessionVersion?: number;
}): Promise<{ sessionId: string; expiresAt: string }> {
  const {
    userId,
    username = '',
    name = '',
    role = 'installer',
    contractor,
    accessToken,
    refreshToken,
    ipAddress,
    userAgent,
    sessionVersion = 1
  } = params;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + ACCESS_TOKEN_TTL_MS).toISOString();
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS).toISOString();

  const sessionId = `sess_${now}_${crypto.randomBytes(8).toString('hex')}`;
  const rtId = `rt_${now}_${crypto.randomBytes(8).toString('hex')}`;

  const sessionHash = hashToken(accessToken);
  const rtHash = hashToken(refreshToken);
  const deviceType: 'mobile' | 'desktop' = userAgent && /mobile|android|iphone/i.test(userAgent) ? 'mobile' : 'desktop';

  const sessionRecord: StoredAuthSession = {
    id: sessionId,
    userId,
    sessionIdHash: sessionHash,
    tokenHash: sessionHash,
    expiresAt,
    lastActivityAt: nowIso,
    sessionVersion,
    revokedAt: null,
    ipAddress,
    userAgent,
    deviceType,
    createdAt: nowIso
  };

  const rtRecord: StoredRefreshToken = {
    id: rtId,
    userId,
    sessionId,
    tokenHash: rtHash,
    expiresAt: refreshExpiresAt,
    revokedAt: null,
    replacedByTokenHash: null,
    createdAt: nowIso
  };

  const isMissingColumnError = (err: any): boolean => {
    const code = String(err?.code || '').toUpperCase();
    const msg = String(err?.message || '').toLowerCase();
    return code === '42703' || code === 'PGRST204' || msg.includes('session_version');
  };

  const client = getSupabaseBackendClient();
  if (client) {
    const baseSessRow = {
      id: sessionId,
      user_id: userId,
      session_id_hash: sessionHash,
      token_hash: sessionHash,
      expires_at: expiresAt,
      last_activity_at: nowIso,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      device_type: deviceType,
      created_at: nowIso
    };

    let { error: sessErr } = await client.from('auth_sessions').insert([
      { ...baseSessRow, session_version: sessionVersion }
    ]);
    if (sessErr && isMissingColumnError(sessErr)) {
      ({ error: sessErr } = await client.from('auth_sessions').insert([baseSessRow]));
    }
    if (sessErr) {
      console.error('[CustomAuth] Failed to persist auth_sessions row:', sessErr.message);
      throw new Error(`DATABASE_UNAVAILABLE: Gagal menyimpan auth_sessions ke Supabase (${sessErr.message}).`);
    }

    const baseRtRow = {
      id: rtId,
      user_id: userId,
      session_id: sessionId,
      token_hash: rtHash,
      expires_at: refreshExpiresAt,
      created_at: nowIso
    };
    let { error: rtErr } = await client.from('refresh_tokens').insert([
      { ...baseRtRow, session_version: sessionVersion }
    ]);
    if (rtErr && isMissingColumnError(rtErr)) {
      ({ error: rtErr } = await client.from('refresh_tokens').insert([baseRtRow]));
    }
    if (rtErr) {
      console.error('[CustomAuth] Failed to persist refresh_tokens row:', rtErr.message);
      // Roll back orphaned auth_session best-effort
      try {
        await client.from('auth_sessions').delete().eq('id', sessionId);
      } catch {}
      throw new Error(`DATABASE_UNAVAILABLE: Gagal menyimpan refresh_tokens ke Supabase (${rtErr.message}).`);
    }

    // Best-effort sync to public.user_sessions for Superadmin Session Management visibility
    await insertUserSessionToSupabase({
      sessionId,
      userId,
      username,
      name,
      role,
      contractor,
      loginAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt,
      status: 'active',
      ipAddress,
      userAgent,
      deviceType,
      tokenFingerprint: sessionHash
    });
  } else if (!isLocalJsonModeAllowed()) {
    throw new Error('DATABASE_UNAVAILABLE: Database authoritative Supabase tidak tersedia untuk menyimpan sesi.');
  }

  // Always store in memory / sessionStore for immediate local inspection and dev mode
  LOCAL_AUTH_SESSIONS.push(sessionRecord);
  LOCAL_REFRESH_TOKENS.push(rtRecord);

  const serverSess: ServerSession = {
    sessionId,
    token: accessToken,
    userId,
    username,
    name,
    role,
    contractor,
    sessionVersion,
    loginAt: nowIso,
    lastActivityAt: nowIso,
    expiresAt,
    status: 'active',
    ipAddress,
    userAgent,
    deviceType
  };
  try {
    await sessionStore.addSession(serverSess);
  } catch {}
  if (db.sessions) {
    const existingSessIdx = db.sessions.findIndex((s: any) => s.sessionId === sessionId);
    if (existingSessIdx >= 0) {
      db.sessions[existingSessIdx] = serverSess;
    } else {
      db.sessions.push(serverSess);
    }
  }

  return { sessionId, expiresAt };
}

/**
 * Verifies access token against Supabase PostgreSQL auth_sessions table and authoritative user status.
 */
export async function verifyAccessToken(
  token: string
): Promise<CustomAuthResult<{ user: ServerUser; session: StoredAuthSession }>> {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return {
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Token otentikasi tidak ditemukan.' }
    };
  }

  const cleanToken = token.trim();
  const tokenHash = hashToken(cleanToken);
  const now = Date.now();
  const client = getSupabaseBackendClient();

  let matchedSession: StoredAuthSession | null = null;

  // 1. Check Supabase PostgreSQL auth_sessions
  if (client) {
    try {
      const { data: sessRows, error } = await client
        .from('auth_sessions')
        .select('*')
        .or(`session_id_hash.eq.${tokenHash},token_hash.eq.${tokenHash}`)
        .limit(5);

      if (error) {
        if (!isLocalJsonModeAllowed()) {
          return {
            success: false,
            error: {
              code: 'DATABASE_UNAVAILABLE',
              message: `Database Supabase gagal memverifikasi sesi: ${error.message}`
            }
          };
        }
      } else if (Array.isArray(sessRows) && sessRows.length > 0) {
        const data = sessRows.find(r => !r.revoked_at) || sessRows[0];
        matchedSession = {
          id: data.id,
          userId: data.user_id,
          sessionIdHash: data.session_id_hash,
          tokenHash: data.token_hash || data.session_id_hash,
          expiresAt: data.expires_at,
          lastActivityAt: data.last_activity_at,
          sessionVersion: typeof data.session_version === 'number' ? data.session_version : undefined,
          revokedAt: data.revoked_at,
          ipAddress: data.ip_address,
          userAgent: data.user_agent,
          deviceType: data.device_type,
          createdAt: data.created_at
        };
      }
    } catch (err: any) {
      if (!isLocalJsonModeAllowed()) {
        return {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: `Koneksi ke database Supabase gagal saat memverifikasi sesi: ${err?.message || 'Unknown error'}`
          }
        };
      }
      console.warn('[CustomAuth] DB verify session warning:', err);
    }
  }

  if (!client && !isLocalJsonModeAllowed()) {
    return {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database authoritative Supabase tidak tersedia dan mode lokal JSON dinonaktifkan.'
      }
    };
  }

  // Fallback to local session store ONLY in local JSON dev mode
  if (!matchedSession && isLocalJsonModeAllowed()) {
    const found = LOCAL_AUTH_SESSIONS.find(
      s => s.sessionIdHash === tokenHash || s.tokenHash === tokenHash
    );
    if (found) {
      matchedSession = found;
    }
  }

  // Also check SERVER_SESSIONS / sessionStore in local dev mode if token matches
  if (!matchedSession && isLocalJsonModeAllowed()) {
    const sSess = db.sessions?.find((s: any) => s.token === cleanToken);
    if (sSess) {
      matchedSession = {
        id: sSess.sessionId,
        userId: sSess.userId,
        sessionIdHash: tokenHash,
        tokenHash,
        expiresAt: sSess.expiresAt,
        lastActivityAt: sSess.lastActivityAt,
        sessionVersion: sSess.sessionVersion,
        revokedAt: sSess.status === 'revoked' ? new Date().toISOString() : null,
        ipAddress: sSess.ipAddress,
        userAgent: sSess.userAgent,
        createdAt: sSess.loginAt
      };
    }
  }

  if (!matchedSession) {
    return {
      success: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'Sesi login tidak valid atau tidak ditemukan.' }
    };
  }

  // Check revocation
  if (matchedSession.revokedAt) {
    return {
      success: false,
      error: { code: 'SESSION_REVOKED', message: 'Sesi login telah dicabut atau Anda telah logout.' }
    };
  }

  // Check expiration
  if (new Date(matchedSession.expiresAt).getTime() < now) {
    return {
      success: false,
      error: { code: 'TOKEN_EXPIRED', message: 'Sesi login telah kedaluwarsa. Silakan login kembali.' }
    };
  }

  // 2. Fetch authoritative user from Supabase PostgreSQL users table
  let authoritativeUser: ServerUser | null = null;
  if (client) {
    try {
      const userRes = await findUserInSupabaseDetailed(matchedSession.userId);
      if (userRes.success && userRes.data) {
        authoritativeUser = userRes.data;
      }
    } catch (err) {
      console.warn('[CustomAuth] Fetch user detail exception:', err);
    }
  }

  if (!authoritativeUser && isLocalJsonModeAllowed()) {
    authoritativeUser = db.users.find((u: any) => u.id === matchedSession!.userId) || null;
  }

  if (!authoritativeUser) {
    return {
      success: false,
      error: { code: 'USER_NOT_FOUND', message: 'Akun staf terdaftar tidak ditemukan dalam sistem.' }
    };
  }

  // Check user active and soft-deleted status
  if (authoritativeUser.isDeleted) {
    matchedSession.revokedAt = new Date().toISOString();
    return {
      success: false,
      error: { code: 'ACCOUNT_DELETED', message: 'Akun staf telah dihapus dari sistem.' }
    };
  }

  if (!authoritativeUser.active) {
    matchedSession.revokedAt = new Date().toISOString();
    return {
      success: false,
      error: { code: 'ACCOUNT_DISABLED', message: 'Akun Anda sedang dinonaktifkan oleh Administrator.' }
    };
  }

  // Authoritative Session Version Check
  const authoritativeVersion = authoritativeUser.sessionVersion || 1;
  const tokenVersionMatch = cleanToken.match(/^mora_at_v(\d+)_/);
  const tokenSessionVersion = tokenVersionMatch ? parseInt(tokenVersionMatch[1], 10) : undefined;
  const sessionStoredVersion = matchedSession.sessionVersion;

  if (
    (tokenSessionVersion !== undefined && tokenSessionVersion !== authoritativeVersion) ||
    (sessionStoredVersion !== undefined && sessionStoredVersion !== authoritativeVersion)
  ) {
    matchedSession.revokedAt = new Date().toISOString();
    if (client) {
      Promise.resolve(
        client
          .from('auth_sessions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', matchedSession.id)
      ).catch(() => {});
    }
    return {
      success: false,
      error: {
        code: 'SESSION_REVOKED',
        message: 'Sesi login telah dicabut karena perubahan kata sandi atau pembaruan akun. Silakan login kembali.'
      }
    };
  }

  // Extend last activity timestamp in database asynchronously
  if (client) {
    Promise.resolve(
      client
        .from('auth_sessions')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', matchedSession.id)
    ).catch(() => {});
  }
  matchedSession.lastActivityAt = new Date().toISOString();

  return {
    success: true,
    data: {
      user: authoritativeUser,
      session: matchedSession
    }
  };
}

/**
 * Rotates a refresh token:
 * 1. Validates refresh token in Supabase PostgreSQL refresh_tokens table.
 * 2. Revokes the old refresh token (prevents replay attacks).
 * 3. Issues a new cryptographically secure access token and refresh token.
 * 4. Extends the parent session.
 */
export async function rotateRefreshToken(
  rawRefreshToken: string,
  ipAddress?: string,
  userAgent?: string
): Promise<CustomAuthResult<{ tokens: AuthTokens; user: Omit<ServerUser, 'passwordHash'> }>> {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string' || !rawRefreshToken.trim()) {
    return {
      success: false,
      error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token wajib disertakan.' }
    };
  }

  const cleanRt = rawRefreshToken.trim();
  const rtHash = hashToken(cleanRt);
  const now = Date.now();
  const client = getSupabaseBackendClient();

  let matchedRt: StoredRefreshToken | null = null;

  // 1. Look up in Supabase PostgreSQL refresh_tokens table
  if (client) {
    try {
      const { data: rtRows, error } = await client
        .from('refresh_tokens')
        .select('*')
        .eq('token_hash', rtHash)
        .limit(1);

      if (error) {
        if (!isLocalJsonModeAllowed()) {
          return {
            success: false,
            error: {
              code: 'DATABASE_UNAVAILABLE',
              message: `Database Supabase gagal membaca refresh token: ${error.message}`
            }
          };
        }
      } else if (Array.isArray(rtRows) && rtRows[0]) {
        const data = rtRows[0];
        matchedRt = {
          id: data.id,
          userId: data.user_id,
          sessionId: data.session_id,
          tokenHash: data.token_hash,
          expiresAt: data.expires_at,
          revokedAt: data.revoked_at,
          replacedByTokenHash: data.replaced_by_token_hash,
          createdAt: data.created_at
        };
      }
    } catch (err: any) {
      if (!isLocalJsonModeAllowed()) {
        return {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: `Koneksi ke database Supabase gagal saat refresh token: ${err?.message || 'Unknown error'}`
          }
        };
      }
      console.warn('[CustomAuth] DB query refresh token warning:', err);
    }
  }

  if (!client && !isLocalJsonModeAllowed()) {
    return {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database authoritative Supabase tidak tersedia dan mode lokal JSON dinonaktifkan.'
      }
    };
  }

  // Fallback to local store ONLY in local dev mode
  if (!matchedRt && isLocalJsonModeAllowed()) {
    matchedRt = LOCAL_REFRESH_TOKENS.find(r => r.tokenHash === rtHash) || null;
  }

  if (!matchedRt) {
    return {
      success: false,
      error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token tidak valid atau tidak ditemukan.' }
    };
  }

  // Check revocation — replay of a revoked refresh token revokes the entire session token family
  if (matchedRt.revokedAt) {
    const revokeTs = new Date(now).toISOString();
    console.warn(`[CustomAuth][Security] Refresh token replay detected for session ${matchedRt.sessionId}. Revoking entire session family.`);
    if (client && matchedRt.sessionId) {
      try {
        await client
          .from('refresh_tokens')
          .update({ revoked_at: revokeTs })
          .eq('session_id', matchedRt.sessionId)
          .is('revoked_at', null);
        await client
          .from('auth_sessions')
          .update({ revoked_at: revokeTs })
          .eq('id', matchedRt.sessionId)
          .is('revoked_at', null);
        await revokeUserSessionInSupabase(matchedRt.sessionId);
      } catch {}
    }
    LOCAL_REFRESH_TOKENS.forEach(r => {
      if (r.sessionId === matchedRt!.sessionId && !r.revokedAt) {
        r.revokedAt = revokeTs;
      }
    });
    LOCAL_AUTH_SESSIONS.forEach(s => {
      if (s.id === matchedRt!.sessionId && !s.revokedAt) {
        s.revokedAt = revokeTs;
      }
    });
    return {
      success: false,
      error: {
        code: 'REFRESH_TOKEN_REVOKED',
        message: 'Refresh token telah dicabut (reuse terdeteksi, seluruh sesi dihentikan). Silakan login kembali.'
      }
    };
  }

  // Check parent auth_sessions row is still active and not revoked
  if (client && matchedRt.sessionId) {
    try {
      const { data: parentRows, error: parentErr } = await client
        .from('auth_sessions')
        .select('id, revoked_at, expires_at, session_version')
        .eq('id', matchedRt.sessionId)
        .limit(1);

      if (parentErr) {
        if (!isLocalJsonModeAllowed()) {
          return {
            success: false,
            error: {
              code: 'DATABASE_UNAVAILABLE',
              message: `Database gagal memvalidasi sesi induk: ${parentErr.message}`
            }
          };
        }
      } else {
        const parentSess = Array.isArray(parentRows) ? parentRows[0] : null;
        if (!parentSess || parentSess.revoked_at) {
          const revokeTs = new Date(now).toISOString();
          try {
            await client.from('refresh_tokens').update({ revoked_at: revokeTs }).eq('id', matchedRt.id);
          } catch {}
          return {
            success: false,
            error: {
              code: 'REFRESH_TOKEN_REVOKED',
              message: 'Sesi login terkait telah dicabut atau logout. Silakan login kembali.'
            }
          };
        }
      }
    } catch {}
  } else if (isLocalJsonModeAllowed() && matchedRt.sessionId) {
    const localParent = LOCAL_AUTH_SESSIONS.find(s => s.id === matchedRt!.sessionId);
    if (localParent?.revokedAt) {
      return {
        success: false,
        error: {
          code: 'REFRESH_TOKEN_REVOKED',
          message: 'Sesi login terkait telah dicabut atau logout. Silakan login kembali.'
        }
      };
    }
  }

  // Check expiration
  if (new Date(matchedRt.expiresAt).getTime() < now) {
    return {
      success: false,
      error: { code: 'REFRESH_TOKEN_EXPIRED', message: 'Refresh token telah kedaluwarsa. Silakan login kembali.' }
    };
  }

  // 2. Fetch authoritative user
  let user: ServerUser | null = null;
  if (client) {
    const userRes = await findUserInSupabaseDetailed(matchedRt.userId);
    if (!userRes.success) {
      return {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database Supabase gagal memuat akun saat memperbarui sesi.'
        }
      };
    }
    user = userRes.data;
  }
  if (!user && isLocalJsonModeAllowed()) {
    user = db.users.find((u: any) => u.id === matchedRt!.userId) || null;
  }

  const effectiveStatus = (user as any)?.accountStatus || (user as any)?.account_status || 'active';
  if (!user || user.isDeleted || !user.active || effectiveStatus === 'inactive' || effectiveStatus === 'locked') {
    return {
      success: false,
      error: { code: 'ACCOUNT_DISABLED', message: 'Akun Anda telah dinonaktifkan atau dihapus.' }
    };
  }

  // Authoritative Session Version Check on Refresh Token
  const authoritativeVersion = user.sessionVersion || 1;
  const rtVersionMatch = cleanRt.match(/^mora_rt_v(\d+)_/);
  const rtTokenVersion = rtVersionMatch ? parseInt(rtVersionMatch[1], 10) : undefined;

  if (rtTokenVersion !== undefined && rtTokenVersion !== authoritativeVersion) {
    matchedRt.revokedAt = new Date().toISOString();
    if (client) {
      await client.from('refresh_tokens').update({ revoked_at: matchedRt.revokedAt }).eq('id', matchedRt.id);
    }
    return {
      success: false,
      error: { code: 'REFRESH_TOKEN_REVOKED', message: 'Refresh token tidak valid karena perubahan kredensial akun.' }
    };
  }

  // 3. Issue new tokens with rotation tied to current sessionVersion
  const newAccessToken = generateSecureAccessToken(authoritativeVersion);
  const newRefreshToken = generateSecureRefreshToken(authoritativeVersion);
  const newSessionHash = hashToken(newAccessToken);
  const newRtHash = hashToken(newRefreshToken);

  const newExpiresAt = new Date(now + ACCESS_TOKEN_TTL_MS).toISOString();
  const newRtExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS).toISOString();
  const nowIso = new Date(now).toISOString();

  // Revoke old refresh token & mark replaced
  matchedRt.revokedAt = nowIso;
  matchedRt.replacedByTokenHash = newRtHash;

  const newRtRecord: StoredRefreshToken = {
    id: `rt_${now}_${crypto.randomBytes(8).toString('hex')}`,
    userId: user.id,
    sessionId: matchedRt.sessionId,
    tokenHash: newRtHash,
    expiresAt: newRtExpiresAt,
    revokedAt: null,
    replacedByTokenHash: null,
    createdAt: nowIso
  };
  LOCAL_REFRESH_TOKENS.push(newRtRecord);

  // Update Supabase PostgreSQL
  if (client) {
    const isMissingColumnError = (err: any): boolean => {
      const code = String(err?.code || '').toUpperCase();
      const msg = String(err?.message || '').toLowerCase();
      return code === '42703' || code === 'PGRST204' || msg.includes('session_version');
    };

    try {
      const { error: revOldErr } = await client
        .from('refresh_tokens')
        .update({ revoked_at: nowIso, replaced_by_token_hash: newRtHash })
        .eq('id', matchedRt.id);
      if (revOldErr) {
        throw new Error(revOldErr.message);
      }

      const baseNewRt = {
        id: newRtRecord.id,
        user_id: user.id,
        session_id: matchedRt.sessionId,
        token_hash: newRtHash,
        expires_at: newRtExpiresAt,
        created_at: nowIso
      };
      let { error: insRtErr } = await client
        .from('refresh_tokens')
        .insert([{ ...baseNewRt, session_version: authoritativeVersion }]);
      if (insRtErr && isMissingColumnError(insRtErr)) {
        ({ error: insRtErr } = await client.from('refresh_tokens').insert([baseNewRt]));
      }
      if (insRtErr) {
        throw new Error(insRtErr.message);
      }

      const { error: updSessErr } = await client
        .from('auth_sessions')
        .update({
          session_id_hash: newSessionHash,
          token_hash: newSessionHash,
          expires_at: newExpiresAt,
          last_activity_at: nowIso
        })
        .eq('id', matchedRt.sessionId);
      if (updSessErr) {
        throw new Error(updSessErr.message);
      }

      await client
        .from('user_sessions')
        .update({
          last_activity_at: nowIso,
          expires_at: newExpiresAt,
          token_fingerprint: newSessionHash
        })
        .eq('session_id', matchedRt.sessionId);
    } catch (err: any) {
      if (!isLocalJsonModeAllowed()) {
        return {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: `Database Supabase gagal memperbarui rotasi token: ${err?.message || 'Unknown error'}`
          }
        };
      }
      console.warn('[CustomAuth] DB token rotation warning:', err?.message || err);
    }
  }

  // Update local session
  const localSess = LOCAL_AUTH_SESSIONS.find(s => s.id === matchedRt!.sessionId);
  if (localSess) {
    localSess.sessionIdHash = newSessionHash;
    localSess.tokenHash = newSessionHash;
    localSess.expiresAt = newExpiresAt;
    localSess.lastActivityAt = nowIso;
  }
  try {
    await sessionStore.updateSession(matchedRt.sessionId, {
      token: newAccessToken,
      expiresAt: newExpiresAt,
      lastActivityAt: nowIso
    });
  } catch {}

  const { passwordHash: _, ...safeUser } = user;

  return {
    success: true,
    data: {
      tokens: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        tokenType: 'bearer',
        expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        expiresAt: newExpiresAt
      },
      user: safeUser
    }
  };
}

/**
 * Revokes all sessions and refresh tokens for a specified user in Supabase PostgreSQL.
 * Increments user.session_version to instantly invalidate any cached tokens.
 */
export async function revokeAllUserSessions(
  userId: string,
  revokedByUserId?: string,
  options?: { skipVersionIncrement?: boolean }
): Promise<CustomAuthResult<boolean>> {
  if (!userId) {
    return { success: false, error: { code: 'INVALID_ID', message: 'User ID wajib diisi.' } };
  }

  const nowIso = new Date().toISOString();
  const client = getSupabaseBackendClient();

  // 1. Revoke in Supabase PostgreSQL
  if (client) {
    try {
      await client
        .from('auth_sessions')
        .update({ revoked_at: nowIso })
        .eq('user_id', userId)
        .is('revoked_at', null);

      await client
        .from('refresh_tokens')
        .update({ revoked_at: nowIso })
        .eq('user_id', userId)
        .is('revoked_at', null);

      await client
        .from('user_sessions')
        .update({ status: 'revoked', last_activity_at: nowIso })
        .eq('user_id', userId)
        .eq('status', 'active');

      if (!options?.skipVersionIncrement) {
        const { data: userData } = await client.from('users').select('session_version').eq('id', userId).single();
        const currentVer = typeof userData?.session_version === 'number' ? userData.session_version : 1;
        await client
          .from('users')
          .update({ session_version: currentVer + 1, updated_at: nowIso })
          .eq('id', userId);
      }
    } catch (err: any) {
      console.warn('[CustomAuth] DB revoke sessions warning:', err?.message || err);
    }
  }

  // 2. Revoke in local memory stores
  LOCAL_AUTH_SESSIONS.forEach(s => {
    if (s.userId === userId) s.revokedAt = nowIso;
  });
  LOCAL_REFRESH_TOKENS.forEach(r => {
    if (r.userId === userId) r.revokedAt = nowIso;
  });
  try {
    await sessionStore.revokeUserSessions(userId);
  } catch {}

  if (db.sessions) {
    db.sessions.forEach((s: any) => {
      if (s.userId === userId) s.status = 'revoked';
    });
  }

  if (!options?.skipVersionIncrement) {
    const localUser = db.users.find((u: any) => u.id === userId);
    if (localUser) {
      localUser.sessionVersion = (localUser.sessionVersion || 1) + 1;
      saveDatabaseToDisk();
    }
  }

  return { success: true, data: true };
}

/**
 * Issues a clean new authenticated session after the user finishes changing their password,
 * revoking all prior sessions without double-incrementing session_version.
 */
export async function createSessionForUserAfterPasswordChange(params: {
  user: ServerUser;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ tokens: AuthTokens; sessionId: string }> {
  const { user, ipAddress, userAgent } = params;
  await revokeAllUserSessions(user.id, user.id, { skipVersionIncrement: true });

  const sessionVersion = Math.max(1, user.sessionVersion || 1);
  const accessToken = generateSecureAccessToken(sessionVersion);
  const refreshToken = generateSecureRefreshToken(sessionVersion);

  const { sessionId, expiresAt } = await persistNewAuthSession({
    userId: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    contractor: user.contractor,
    accessToken,
    refreshToken,
    ipAddress,
    userAgent,
    sessionVersion
  });

  return {
    sessionId,
    tokens: {
      accessToken,
      refreshToken,
      tokenType: 'bearer',
      expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      expiresAt
    }
  };
}

/**
 * Revokes a single session by access token, refresh token, or session ID,
 * ensuring linked refresh_tokens and public.user_sessions rows are revoked atomically.
 */
export async function revokeSingleSession(tokenOrSessionId: string): Promise<boolean> {
  if (!tokenOrSessionId || typeof tokenOrSessionId !== 'string') return false;
  const cleanInput = tokenOrSessionId.trim();
  if (!cleanInput) return false;

  const tokenHash = hashToken(cleanInput);
  const nowIso = new Date().toISOString();
  const client = getSupabaseBackendClient();
  const isSafeSessionId = /^[a-zA-Z0-9_-]{4,128}$/.test(cleanInput);
  const affectedSessionIds = new Set<string>();
  if (isSafeSessionId) {
    affectedSessionIds.add(cleanInput);
  }

  LOCAL_AUTH_SESSIONS.forEach(s => {
    if (s.id === cleanInput || s.sessionIdHash === tokenHash || s.tokenHash === tokenHash) {
      affectedSessionIds.add(s.id);
      s.revokedAt = nowIso;
    }
  });
  LOCAL_REFRESH_TOKENS.forEach(r => {
    if (r.tokenHash === tokenHash && r.sessionId) {
      affectedSessionIds.add(r.sessionId);
    }
    if (r.tokenHash === tokenHash || affectedSessionIds.has(r.sessionId)) {
      r.revokedAt = nowIso;
    }
  });

  if (client) {
    try {
      const { data: matchedSessRows } = await client
        .from('auth_sessions')
        .select('id')
        .or(`session_id_hash.eq.${tokenHash},token_hash.eq.${tokenHash}`)
        .limit(10);

      if (Array.isArray(matchedSessRows)) {
        matchedSessRows.forEach((r: any) => {
          if (r?.id) affectedSessionIds.add(r.id);
        });
      }

      const { data: matchedRtRows } = await client
        .from('refresh_tokens')
        .select('session_id')
        .eq('token_hash', tokenHash)
        .limit(10);

      if (Array.isArray(matchedRtRows)) {
        matchedRtRows.forEach((r: any) => {
          if (r?.session_id) affectedSessionIds.add(r.session_id);
        });
      }

      await client
        .from('auth_sessions')
        .update({ revoked_at: nowIso })
        .or(`session_id_hash.eq.${tokenHash},token_hash.eq.${tokenHash}`)
        .is('revoked_at', null);

      await client
        .from('refresh_tokens')
        .update({ revoked_at: nowIso })
        .eq('token_hash', tokenHash)
        .is('revoked_at', null);

      for (const sid of affectedSessionIds) {
        await client
          .from('auth_sessions')
          .update({ revoked_at: nowIso })
          .eq('id', sid)
          .is('revoked_at', null);

        await client
          .from('refresh_tokens')
          .update({ revoked_at: nowIso })
          .eq('session_id', sid)
          .is('revoked_at', null);

        await revokeUserSessionInSupabase(sid);
      }
    } catch {}
  }

  for (const sid of affectedSessionIds) {
    try {
      await sessionStore.revokeSession(sid);
    } catch {}
    LOCAL_AUTH_SESSIONS.forEach(s => {
      if (s.id === sid) s.revokedAt = nowIso;
    });
    LOCAL_REFRESH_TOKENS.forEach(r => {
      if (r.sessionId === sid) r.revokedAt = nowIso;
    });
  }
  try {
    await sessionStore.revokeSession(cleanInput);
  } catch {}

  return true;
}

// ------------------------------------------------------------------------------
// CORE LOGIN ENGINE (USERNAME OR EMAIL + PASSWORD)
// ------------------------------------------------------------------------------

export async function loginWithCustomAuth(params: {
  identifier: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<CustomAuthResult<{ user: Omit<ServerUser, 'passwordHash'>; tokens: AuthTokens; sessionId: string }>> {
  const { identifier, password, ipAddress, userAgent } = params;

  const cleanIdent = (identifier || '').trim().toLowerCase();
  if (!cleanIdent || !password) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Nama pengguna atau email dan kata sandi wajib diisi.' }
    };
  }

  // 1. Rate limiting & Temporary account lockout check
  const rateLimitCheck = await checkRateLimitAndLockout(cleanIdent, ipAddress);
  if (rateLimitCheck.isLocked) {
    await recordLoginAttempt({
      identifier: cleanIdent,
      ipAddress,
      success: false,
      reason: 'ACCOUNT_TEMPORARILY_LOCKED'
    });
    return {
      success: false,
      error: {
        code: 'ACCOUNT_LOCKED',
        message: rateLimitCheck.message || 'Terlalu banyak percobaan login gagal. Akun dikunci sementara.'
      }
    };
  }

  // 2. Authoritative User Lookup in Supabase PostgreSQL
  let user: ServerUser | null = null;
  const client = getSupabaseBackendClient();

  if (client) {
    const userRes = await findUserInSupabaseDetailed(cleanIdent);
    if (!userRes.success) {
      return {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database PostgreSQL tidak dapat diakses saat memverifikasi identitas pengguna.'
        }
      };
    }
    user = userRes.data;
  }

  if (!client && !isLocalJsonModeAllowed()) {
    return {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database authoritative Supabase tidak tersedia dan mode lokal JSON dinonaktifkan.'
      }
    };
  }

  // Fallback to local store if Supabase not configured in local development
  if (!user && isLocalJsonModeAllowed()) {
    user = db.users.find(
      (u: any) =>
        !u.isDeleted &&
        (u.username.toLowerCase() === cleanIdent ||
          u.email.toLowerCase() === cleanIdent ||
          (u.altEmail &&
            String(u.altEmail)
              .split(',')
              .map((e: string) => e.trim().toLowerCase())
              .filter(Boolean)
              .includes(cleanIdent)))
    ) || null;
  }

  // User not found in directory
  if (!user) {
    await recordLoginAttempt({
      identifier: cleanIdent,
      ipAddress,
      success: false,
      reason: 'USER_NOT_FOUND'
    });
    return {
      success: false,
      error: {
        code: 'ACCOUNT_NOT_FOUND',
        message: 'Nama pengguna atau email tidak ditemukan. Hubungi Superadmin untuk mendapatkan akses MoraJaws.'
      }
    };
  }

  // Check account deleted
  if (user.isDeleted) {
    await recordLoginAttempt({
      identifier: cleanIdent,
      ipAddress,
      success: false,
      reason: 'ACCOUNT_DELETED'
    });
    return {
      success: false,
      error: {
        code: 'ACCOUNT_DELETED',
        message: 'Akun Anda telah dihapus dari sistem MoraJaws. Hubungi Superadmin.'
      }
    };
  }

  // Check account active status (supports both camelCase from mapper and snake_case fallback)
  const effectiveStatus = (user as any).accountStatus || (user as any).account_status || 'active';
  if (!user.active || effectiveStatus === 'inactive' || effectiveStatus === 'locked') {
    await recordLoginAttempt({
      identifier: cleanIdent,
      ipAddress,
      success: false,
      reason: 'ACCOUNT_DISABLED'
    });
    return {
      success: false,
      error: {
        code: 'ACCOUNT_DISABLED',
        message: 'Akun Anda sedang dinonaktifkan oleh Administrator. Hubungi Superadmin untuk mendapatkan akses MoraJaws.'
      }
    };
  }

  // Check locked until timestamp
  const lockedUntilRaw = (user as any).lockedUntil || (user as any).locked_until;
  if (lockedUntilRaw && new Date(lockedUntilRaw).getTime() > Date.now()) {
    const rem = Math.ceil((new Date(lockedUntilRaw).getTime() - Date.now()) / 1000);
    return {
      success: false,
      error: {
        code: 'ACCOUNT_LOCKED',
        message: `Akun Anda sedang dikunci sementara. Silakan coba kembali dalam ${rem} detik atau hubungi Superadmin.`
      }
    };
  }

  // 3. Verify Password (bcrypt + legacy upgrade fallback)
  const passwordCheck = await verifyUserPasswordEx(password, user.passwordHash);
  if (!passwordCheck.valid) {
    await recordLoginAttempt({
      identifier: cleanIdent,
      ipAddress,
      success: false,
      reason: 'WRONG_PASSWORD'
    });

    // Increment failed login count on user record
    if (client) {
      const prevFailures = typeof (user as any).failedLoginCount === 'number'
        ? (user as any).failedLoginCount
        : ((user as any).failed_login_count || 0);
      const currentFailures = prevFailures + 1;
      const updates: any = { failed_login_count: currentFailures, updated_at: new Date().toISOString() };
      if (currentFailures >= MAX_FAILED_ATTEMPTS) {
        updates.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
        updates.account_status = 'locked';
      }
      Promise.resolve(
        client.from('users').update(updates).eq('id', user.id)
      ).catch(() => {});
    }

    return {
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Nama pengguna atau kata sandi tidak cocok. Pastikan kredensial yang Anda masukkan benar.'
      }
    };
  }

  // 4. Password valid -> Rehash if needed
  if (passwordCheck.needsRehash) {
    try {
      const newBcryptHash = await hashPasswordWithBcrypt(password);
      user.passwordHash = newBcryptHash;
      if (client) {
        await client
          .from('users')
          .update({
            password_hash: newBcryptHash,
            payload: { ...(user as any).payload, passwordHash: newBcryptHash },
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);
      }
      if (isLocalJsonModeAllowed()) {
        const lu = db.users.find((u: any) => u.id === user!.id);
        if (lu) {
          lu.passwordHash = newBcryptHash;
          saveDatabaseToDisk();
        }
      }
    } catch (rehashErr) {
      console.warn('[CustomAuth] Automatic rehash warning:', rehashErr);
    }
  }

  // 5. Generate Access Token & Refresh Token tied to current sessionVersion
  const currentVersion = user.sessionVersion || 1;
  const accessToken = generateSecureAccessToken(currentVersion);
  const refreshToken = generateSecureRefreshToken(currentVersion);

  // 6. Persist Session into Supabase PostgreSQL (fail closed if Supabase persistence fails)
  let sessionId = '';
  let expiresAt = '';
  try {
    const persisted = await persistNewAuthSession({
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      contractor: user.contractor,
      accessToken,
      refreshToken,
      ipAddress,
      userAgent,
      sessionVersion: currentVersion
    });
    sessionId = persisted.sessionId;
    expiresAt = persisted.expiresAt;
  } catch (persistErr: any) {
    return {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: persistErr?.message || 'Gagal menyimpan sesi autentikasi ke database PostgreSQL.'
      }
    };
  }

  // 7. Update User login stats & reset failed login count in Supabase PostgreSQL
  const nowIso = new Date().toISOString();
  if (client) {
    try {
      await client
        .from('users')
        .update({
          last_login_at: nowIso,
          login_count: (user.loginCount || 0) + 1,
          failed_login_count: 0,
          locked_until: null,
          account_status: 'active',
          updated_at: nowIso
        })
        .eq('id', user.id);
    } catch {}
  }

  if (isLocalJsonModeAllowed()) {
    const lu = db.users.find((u: any) => u.id === user!.id);
    if (lu) {
      lu.lastLoginAt = nowIso;
      lu.loginCount = (lu.loginCount || 0) + 1;
      saveDatabaseToDisk();
    }
  }

  // 8. Record successful login attempt
  await recordLoginAttempt({
    identifier: cleanIdent,
    ipAddress,
    success: true
  });

  // 9. Record Audit Log
  await logServerAuditAsync(
    'USER_LOGIN_SUCCESS',
    'auth',
    user.id,
    `Pengguna ${user.name} (${user.role}) berhasil login via Custom Authentication MoraJaws.`,
    user,
    { ipAddress, userAgent, level: 'informational' }
  );

  const { passwordHash: _, ...safeUser } = user;

  return {
    success: true,
    data: {
      user: safeUser,
      tokens: {
        accessToken,
        refreshToken,
        tokenType: 'bearer',
        expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        expiresAt
      },
      sessionId
    }
  };
}
