import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSingleFlightRefresher,
  executeWithAuthRefreshRetry,
  isAuthExpiredResponse,
  isAuthSessionError,
  mergeRefreshedSessionStorage
} from './authSessionHelper';

test('isAuthExpiredResponse detects 401 and known token-expiry error codes', () => {
  assert.equal(isAuthExpiredResponse(401, null), true);
  assert.equal(isAuthExpiredResponse(200, { code: 'TOKEN_EXPIRED' }), true);
  assert.equal(isAuthExpiredResponse(403, { error: { code: 'SESSION_REVOKED' } }), true);
  assert.equal(isAuthExpiredResponse(404, { code: 'NOT_FOUND' }), false);
  assert.equal(isAuthExpiredResponse(503, { code: 'DATABASE_UNAVAILABLE' }), false);
});

test('isAuthSessionError detects HTTP 401, auth error codes, and Indonesian expiry message', () => {
  assert.equal(isAuthSessionError({ status: 401, message: 'Unauthorized' }), true);
  assert.equal(isAuthSessionError({ code: 'TOKEN_EXPIRED', message: 'Expired' }), true);
  assert.equal(
    isAuthSessionError(
      new Error('Sesi login telah kedaluwarsa. Silakan login kembali. [HTTP 401 | Code: TOKEN_EXPIRED | Tabel: app_settings | Operasi: SELECT]')
    ),
    true
  );
  assert.equal(isAuthSessionError(new Error('Network timeout')), false);
});

test('mergeRefreshedSessionStorage updates access/refresh tokens while preserving user identity fields', () => {
  const existing = JSON.stringify({
    userId: 'u-1',
    username: 'admin',
    name: 'Admin MoraJaws',
    role: 'super_admin',
    token: 'old_access',
    refreshToken: 'old_refresh'
  });

  const mergedRaw = mergeRefreshedSessionStorage(existing, {
    success: true,
    tokens: {
      accessToken: 'new_access',
      refreshToken: 'new_refresh',
      expiresAt: '2026-11-27T00:00:00.000Z'
    }
  });

  assert.ok(mergedRaw);
  const parsed = JSON.parse(mergedRaw);
  assert.equal(parsed.userId, 'u-1');
  assert.equal(parsed.username, 'admin');
  assert.equal(parsed.role, 'super_admin');
  assert.equal(parsed.token, 'new_access');
  assert.equal(parsed.accessToken, 'new_access');
  assert.equal(parsed.refreshToken, 'new_refresh');
  assert.equal(parsed.expiresAt, '2026-11-27T00:00:00.000Z');
});

test('createSingleFlightRefresher deduplicates concurrent refresh calls into one execution', async () => {
  let calls = 0;
  const refresh = createSingleFlightRefresher(async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    return true;
  });

  const results = await Promise.all([refresh(), refresh(), refresh(), refresh(), refresh()]);
  assert.deepEqual(results, [true, true, true, true, true]);
  assert.equal(calls, 1);

  // Subsequent call after completion starts a fresh refresh cycle
  const secondResult = await refresh();
  assert.equal(secondResult, true);
  assert.equal(calls, 2);
});

test('executeWithAuthRefreshRetry recovers from 401 by refreshing once and retrying request', async () => {
  let token = 'expired-token';
  let requestCount = 0;
  let refreshCount = 0;
  let expiredCallbackCount = 0;

  const result = await executeWithAuthRefreshRetry({
    performRequest: async () => {
      requestCount += 1;
      if (token === 'expired-token') {
        return { ok: false, status: 401, body: { code: 'TOKEN_EXPIRED' } };
      }
      return { ok: true, status: 200, body: { success: true } };
    },
    hasActiveSession: () => true,
    refreshSessionOnce: async () => {
      refreshCount += 1;
      token = 'fresh-token';
      return true;
    },
    readResponsePayload: async res => res.body,
    onSessionExpired: () => {
      expiredCallbackCount += 1;
    }
  });

  assert.equal(result.refreshed, true);
  assert.equal(result.sessionExpired, false);
  assert.equal(result.response.status, 200);
  assert.equal(requestCount, 2);
  assert.equal(refreshCount, 1);
  assert.equal(expiredCallbackCount, 0);
});

test('executeWithAuthRefreshRetry triggers onSessionExpired once without infinite loop when refresh fails', async () => {
  let requestCount = 0;
  let refreshCount = 0;
  let expiredCode: string | undefined;

  const result = await executeWithAuthRefreshRetry({
    performRequest: async () => {
      requestCount += 1;
      return { ok: false, status: 401, body: { code: 'TOKEN_EXPIRED' } };
    },
    hasActiveSession: () => true,
    refreshSessionOnce: async () => {
      refreshCount += 1;
      return false;
    },
    readResponsePayload: async res => res.body,
    onSessionExpired: (_status, payload) => {
      expiredCode = payload?.code;
    }
  });

  assert.equal(result.refreshed, false);
  assert.equal(result.sessionExpired, true);
  assert.equal(result.response.status, 401);
  assert.equal(requestCount, 1);
  assert.equal(refreshCount, 1);
  assert.equal(expiredCode, 'TOKEN_EXPIRED');
});

test('executeWithAuthRefreshRetry skips refresh when no active client session exists', async () => {
  let refreshCount = 0;
  let expiredCallbackCount = 0;

  const result = await executeWithAuthRefreshRetry({
    performRequest: async () => ({ ok: false, status: 401, body: { code: 'UNAUTHENTICATED' } }),
    hasActiveSession: () => false,
    refreshSessionOnce: async () => {
      refreshCount += 1;
      return true;
    },
    onSessionExpired: () => {
      expiredCallbackCount += 1;
    }
  });

  assert.equal(result.refreshed, false);
  assert.equal(result.sessionExpired, false);
  assert.equal(result.response.status, 401);
  assert.equal(refreshCount, 0);
  assert.equal(expiredCallbackCount, 0);
});
