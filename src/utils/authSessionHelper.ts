export const AUTH_EXPIRED_ERROR_CODES = new Set([
  'TOKEN_EXPIRED',
  'SESSION_REVOKED',
  'UNAUTHENTICATED',
  'REFRESH_FAILED',
  'SESSION_EXPIRED'
]);

export function extractAuthErrorCode(payload: any): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const raw =
    payload.code ??
    (payload.error && typeof payload.error === 'object' ? payload.error.code : undefined);
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : undefined;
}

export function isAuthExpiredResponse(status: number, payload?: any): boolean {
  if (status === 401) return true;
  const code = extractAuthErrorCode(payload);
  return Boolean(code && AUTH_EXPIRED_ERROR_CODES.has(code));
}

export function isAuthSessionError(err: any): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const status = Number(err.status ?? err.httpStatus ?? 0);
    if (status === 401) return true;
    const code = extractAuthErrorCode(err);
    if (code && AUTH_EXPIRED_ERROR_CODES.has(code)) return true;
    if (err.isAuthError === true) return true;
  }
  const msg = typeof err === 'string' ? err : typeof err?.message === 'string' ? err.message : '';
  if (!msg) return false;
  return (
    msg.includes('TOKEN_EXPIRED') ||
    msg.includes('SESSION_REVOKED') ||
    msg.includes('UNAUTHENTICATED') ||
    msg.includes('HTTP 401') ||
    /sesi login telah kedaluwarsa/i.test(msg)
  );
}

export function mergeRefreshedSessionStorage(
  existingRaw: string | null,
  refreshData: any
): string | null {
  let existing: Record<string, any> = {};
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (parsed && typeof parsed === 'object') {
        existing = parsed;
      }
    } catch {
      existing = {};
    }
  }

  const tokens = refreshData?.tokens;
  const nextAccessToken = tokens?.accessToken || refreshData?.token;
  const nextRefreshToken = tokens?.refreshToken || existing.refreshToken;
  const nextExpiresAt = tokens?.expiresAt || existing.expiresAt;

  if (!nextAccessToken && !refreshData?.user) {
    return existingRaw;
  }

  const user = refreshData?.user;
  const merged: Record<string, any> = {
    ...existing,
    ...(user
      ? {
          userId: user.id ?? existing.userId,
          username: user.username ?? existing.username,
          name: user.name ?? existing.name,
          role: user.role ?? existing.role,
          contractor: user.contractor ?? existing.contractor,
          contractorId: user.contractorId ?? existing.contractorId,
          area: user.area ?? existing.area,
          email: user.email ?? existing.email,
          phone: user.phone ?? existing.phone,
          active: user.active !== undefined ? user.active : existing.active
        }
      : {}),
    ...(nextAccessToken
      ? {
          token: nextAccessToken,
          accessToken: nextAccessToken
        }
      : {}),
    ...(nextRefreshToken ? { refreshToken: nextRefreshToken } : {}),
    ...(nextExpiresAt ? { expiresAt: nextExpiresAt } : {})
  };

  return JSON.stringify(merged);
}

export function createSingleFlightRefresher(
  doRefresh: () => Promise<boolean>
): () => Promise<boolean> {
  let inFlightPromise: Promise<boolean> | null = null;

  return () => {
    if (inFlightPromise) {
      return inFlightPromise;
    }
    inFlightPromise = (async () => {
      try {
        return await doRefresh();
      } catch {
        return false;
      } finally {
        inFlightPromise = null;
      }
    })();
    return inFlightPromise;
  };
}

export interface RetryableResponse {
  status: number;
  ok: boolean;
}

export async function executeWithAuthRefreshRetry<T extends RetryableResponse>(options: {
  performRequest: () => Promise<T>;
  hasActiveSession: () => boolean;
  refreshSessionOnce: () => Promise<boolean>;
  readResponsePayload?: (res: T) => Promise<any>;
  onSessionExpired?: (status: number, payload: any) => void;
}): Promise<{ response: T; refreshed: boolean; sessionExpired: boolean }> {
  const firstRes = await options.performRequest();
  if (firstRes.status !== 401) {
    return { response: firstRes, refreshed: false, sessionExpired: false };
  }

  if (!options.hasActiveSession()) {
    return { response: firstRes, refreshed: false, sessionExpired: false };
  }

  const refreshed = await options.refreshSessionOnce();
  if (refreshed) {
    const retryRes = await options.performRequest();
    if (retryRes.status !== 401) {
      return { response: retryRes, refreshed: true, sessionExpired: false };
    }
    const retryPayload = options.readResponsePayload
      ? await options.readResponsePayload(retryRes).catch(() => null)
      : null;
    options.onSessionExpired?.(retryRes.status, retryPayload);
    return { response: retryRes, refreshed: true, sessionExpired: true };
  }

  const firstPayload = options.readResponsePayload
    ? await options.readResponsePayload(firstRes).catch(() => null)
    : null;
  options.onSessionExpired?.(firstRes.status, firstPayload);
  return { response: firstRes, refreshed: false, sessionExpired: true };
}
