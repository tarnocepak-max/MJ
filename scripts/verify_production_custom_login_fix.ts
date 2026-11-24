import assert from 'assert';
import crypto from 'crypto';
import http from 'http';
import { setSupabaseBackendClientForTesting, resetSupabaseBackendClientForTesting } from '../server/supabaseClient.ts';
import handler from '../api/index.ts';

function buildPbkdf2Hash(password: string, iterations = 310000): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2:sha256:${iterations}:${salt}:${derived}`;
}

interface TableStore {
  [table: string]: any[];
}

function parseOrCondition(expr: string, row: any): boolean {
  const clauses = expr.split(',').map(s => s.trim()).filter(Boolean);
  return clauses.some(c => {
    const eqIdx = c.indexOf('.eq.');
    if (eqIdx > 0) {
      const col = c.slice(0, eqIdx);
      const val = c.slice(eqIdx + 4);
      return String(row?.[col] ?? '') === val;
    }
    return false;
  });
}

function createMockSupabaseClient(store: TableStore) {
  const createQuery = (table: string) => {
    if (!store[table]) store[table] = [];
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    let upsertConflictCol: string = 'id';
    let filters: Array<(row: any) => boolean> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitCount: number | null = null;
    let isHead = false;
    let wantsCount = false;

    const execute = async (): Promise<{ data: any; error: any; count?: number }> => {
      const rows = store[table];

      if (op === 'insert') {
        const items = Array.isArray(payload) ? payload : [payload];
        const inserted = items.map(item => ({ ...item }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }

      if (op === 'upsert') {
        const items = Array.isArray(payload) ? payload : [payload];
        const upserted: any[] = [];
        for (const item of items) {
          const conflictKey = item?.[upsertConflictCol];
          const existingIdx = conflictKey !== undefined
            ? rows.findIndex(r => r?.[upsertConflictCol] === conflictKey)
            : -1;
          if (existingIdx >= 0) {
            rows[existingIdx] = { ...rows[existingIdx], ...item };
            upserted.push({ ...rows[existingIdx] });
          } else {
            const copy = { ...item };
            rows.push(copy);
            upserted.push({ ...copy });
          }
        }
        return { data: upserted, error: null };
      }

      if (op === 'update') {
        const matched: any[] = [];
        for (const r of rows) {
          if (filters.every(fn => fn(r))) {
            Object.assign(r, payload);
            matched.push({ ...r });
          }
        }
        return { data: matched, error: null };
      }

      if (op === 'delete') {
        const kept: any[] = [];
        const deleted: any[] = [];
        for (const r of rows) {
          if (filters.every(fn => fn(r))) {
            deleted.push(r);
          } else {
            kept.push(r);
          }
        }
        store[table] = kept;
        return { data: deleted, error: null };
      }

      // SELECT
      let result = rows.filter(r => filters.every(fn => fn(r))).map(r => ({ ...r }));
      if (orderCol) {
        const col = orderCol;
        result.sort((a, b) => {
          const av = a[col] ?? '';
          const bv = b[col] ?? '';
          if (av < bv) return orderAsc ? -1 : 1;
          if (av > bv) return orderAsc ? 1 : -1;
          return 0;
        });
      }
      const totalMatched = result.length;
      if (limitCount !== null) {
        result = result.slice(0, limitCount);
      }
      return {
        data: isHead ? null : result,
        error: null,
        count: wantsCount ? totalMatched : undefined
      };
    };

    const builder: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op === 'select') {
          isHead = Boolean(opts?.head);
          wantsCount = opts?.count === 'exact';
        }
        return builder;
      },
      insert(rowsData: any) {
        op = 'insert';
        payload = rowsData;
        return builder;
      },
      upsert(rowsData: any, opts?: { onConflict?: string }) {
        op = 'upsert';
        payload = rowsData;
        if (opts?.onConflict) {
          upsertConflictCol = opts.onConflict.split(',')[0].trim();
        }
        return builder;
      },
      update(patch: any) {
        op = 'update';
        payload = patch;
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      eq(col: string, val: any) {
        filters.push(r => r?.[col] === val);
        return builder;
      },
      neq(col: string, val: any) {
        filters.push(r => r?.[col] !== val);
        return builder;
      },
      is(col: string, val: any) {
        filters.push(r => (val === null ? r?.[col] == null : r?.[col] === val));
        return builder;
      },
      in(col: string, vals: any[]) {
        filters.push(r => vals.includes(r?.[col]));
        return builder;
      },
      gte(col: string, val: any) {
        filters.push(r => String(r?.[col] ?? '') >= String(val));
        return builder;
      },
      ilike(col: string, pattern: string) {
        const cleanPat = String(pattern || '');
        if (cleanPat.startsWith('%') && cleanPat.endsWith('%')) {
          const needle = cleanPat.slice(1, -1).replace(/\\/g, '').toLowerCase();
          filters.push(r => String(r?.[col] ?? '').toLowerCase().includes(needle));
        } else {
          const exact = cleanPat.replace(/\\/g, '').toLowerCase();
          filters.push(r => String(r?.[col] ?? '').toLowerCase() === exact);
        }
        return builder;
      },
      or(expr: string) {
        filters.push(r => parseOrCondition(expr, r));
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      limit(n: number) {
        limitCount = n;
        return builder;
      },
      async single() {
        const res = await execute();
        if (res.error) return res;
        const first = Array.isArray(res.data) ? res.data[0] : res.data;
        if (!first) {
          return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
        }
        return { data: first, error: null };
      },
      async maybeSingle() {
        const res = await execute();
        if (res.error) return res;
        const first = Array.isArray(res.data) ? (res.data[0] || null) : res.data;
        return { data: first, error: null };
      },
      then(onFulfilled: any, onRejected: any) {
        return execute().then(onFulfilled, onRejected);
      }
    };

    return builder;
  };

  return {
    from(table: string) {
      return createQuery(table);
    }
  };
}

function parseSetCookies(setCookieHeaders: string[] | undefined): Record<string, { value: string; raw: string }> {
  const jar: Record<string, { value: string; raw: string }> = {};
  if (!Array.isArray(setCookieHeaders)) return jar;
  for (const header of setCookieHeaders) {
    const firstPart = header.split(';')[0] || '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const value = decodeURIComponent(firstPart.slice(eqIdx + 1).trim());
      jar[name] = { value, raw: header };
    }
  }
  return jar;
}

async function run() {
  // Configure Vercel production environment simulation
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.APP_ENV = 'production';
  process.env.SUPABASE_URL = 'https://wiahuupjgpadxqiiarzi.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_mock_production_verification_key_123456';
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_mock_production_anon_key_123456';

  const raysPasswordPlain = 'Mora#99';
  const raysOriginalHash = buildPbkdf2Hash(raysPasswordPlain, 310000);
  const inactivePasswordHash = buildPbkdf2Hash('Tech#12', 310000);

  const dbStore: TableStore = {
    roles: [{ code: 'super_admin', name: 'Super Admin' }],
    users: [
      {
        id: 'u-ray',
        username: 'rays',
        name: 'Ray Superadmin',
        email: 'rays@morajaws.id',
        role: 'super_admin',
        active: true,
        account_status: 'active',
        is_archived: false,
        is_deleted: false,
        password_hash: raysOriginalHash,
        failed_login_count: 0,
        locked_until: null,
        session_version: 1,
        login_count: 12,
        must_change_password: false,
        permissions: ['*'],
        created_at: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'u-inactive',
        username: 'inactive_tech',
        name: 'Inactive Technician',
        email: 'inactive@morajaws.id',
        role: 'installer',
        active: false,
        account_status: 'inactive',
        is_archived: false,
        is_deleted: false,
        password_hash: inactivePasswordHash,
        failed_login_count: 0,
        locked_until: null,
        session_version: 1,
        must_change_password: false,
        permissions: [],
        created_at: '2026-01-01T00:00:00.000Z'
      }
    ],
    auth_sessions: [],
    refresh_tokens: [],
    user_sessions: [],
    login_attempts: [],
    audit_logs: [],
    work_orders: [],
    contractors: [],
    coverage_areas: [],
    wa_templates: [],
    app_settings: []
  };

  setSupabaseBackendClientForTesting(createMockSupabaseClient(dbStore));

  // Wrap Vercel serverless entrypoint (api/index.ts) in a real loopback HTTP server simulating vercel.json rewrites
  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || '/';
    if (rawUrl.startsWith('/api/')) {
      const parsed = new URL(rawUrl, 'http://localhost');
      const subpath = parsed.pathname.replace(/^\/api\//, '');
      parsed.searchParams.set('__vercel_path', subpath);
      req.url = `/api/index?${parsed.searchParams.toString()}`;
    }
    await handler(req, res);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const vercelOrigin = 'https://mora-jawskies.vercel.app';

  const request = async (
    path: string,
    opts: { method?: string; body?: any; cookies?: Record<string, string>; bearer?: string } = {}
  ) => {
    const headers: Record<string, string> = {
      Origin: vercelOrigin,
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'mora-jawskies.vercel.app'
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opts.bearer) {
      headers['Authorization'] = `Bearer ${opts.bearer}`;
    }
    if (opts.cookies && Object.keys(opts.cookies).length > 0) {
      headers['Cookie'] = Object.entries(opts.cookies)
        .filter(([, v]) => Boolean(v))
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('; ');
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    const setCookies = typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : [];
    return { status: res.status, headers: res.headers, json, text, setCookies };
  };

  try {
    console.log('1) Testing valid login for rays (including whitespace & case normalization)...');
    const loginRes = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: '  RaYs  ', password: raysPasswordPlain }
    });
    assert.strictEqual(loginRes.status, 200, `Expected 200 on login, got ${loginRes.status}: ${loginRes.text}`);
    assert.strictEqual(loginRes.json?.success, true);
    assert.strictEqual(loginRes.json?.user?.id, 'u-ray');
    assert.strictEqual(loginRes.json?.user?.username, 'rays');
    assert.strictEqual(loginRes.json?.user?.role, 'super_admin');
    assert.strictEqual(loginRes.headers.get('access-control-allow-origin'), vercelOrigin);

    const rayDbRow = dbStore.users.find(u => u.id === 'u-ray')!;
    assert.strictEqual(rayDbRow.password_hash, raysOriginalHash, 'u-ray password_hash MUST NOT be altered on login');
    assert.strictEqual(dbStore.auth_sessions.length, 1, 'auth_sessions must record 1 active session');
    assert.strictEqual(dbStore.refresh_tokens.length, 1, 'refresh_tokens must record 1 active refresh token');
    assert.strictEqual(dbStore.user_sessions.length, 1, 'user_sessions must record 1 active session');

    const cookies = parseSetCookies(loginRes.setCookies);
    assert.ok(cookies.mora_access_token?.value, 'mora_access_token cookie must be set');
    assert.ok(cookies.mora_refresh_token?.value, 'mora_refresh_token cookie must be set');
    assert.ok(cookies.mora_access_token.raw.toLowerCase().includes('httponly'), 'access cookie must be HttpOnly');
    assert.ok(cookies.mora_access_token.raw.toLowerCase().includes('secure'), 'access cookie must be Secure on Vercel');

    const cookieJar: Record<string, string> = {
      mora_access_token: cookies.mora_access_token.value,
      mora_refresh_token: cookies.mora_refresh_token.value
    };

    console.log('2) Testing unknown username...');
    const notFoundRes = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'nonexistent_user_999', password: 'AnyPassword' }
    });
    assert.strictEqual(notFoundRes.status, 404);
    assert.strictEqual(notFoundRes.json?.code, 'ACCOUNT_NOT_FOUND');

    console.log('3) Testing wrong password...');
    const wrongPwRes = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'rays', password: 'WrongPassword123' }
    });
    assert.strictEqual(wrongPwRes.status, 401);
    assert.strictEqual(wrongPwRes.json?.code, 'INVALID_CREDENTIALS');
    assert.strictEqual(rayDbRow.failed_login_count, 1, 'failed_login_count should increment cleanly');

    console.log('4) Testing inactive account...');
    const inactiveRes = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'inactive_tech', password: 'Tech#12' }
    });
    assert.strictEqual(inactiveRes.status, 403);
    assert.strictEqual(inactiveRes.json?.code, 'ACCOUNT_DISABLED');

    console.log('5) Testing session stays active across F5 refresh & Superadmin dashboard access...');
    const sessRes = await request('/api/auth/session', { cookies: cookieJar });
    assert.strictEqual(sessRes.status, 200);
    assert.strictEqual(sessRes.json?.authenticated, true);
    assert.strictEqual(sessRes.json?.user?.id, 'u-ray');

    const bootCritRes = await request('/api/bootstrap?mode=critical', { cookies: cookieJar });
    assert.strictEqual(bootCritRes.status, 200);
    assert.strictEqual(bootCritRes.json?.isAuthenticated, true);
    assert.strictEqual(bootCritRes.json?.currentUser?.id, 'u-ray');

    // Simulate F5 after access token expiry while refresh token is still valid
    dbStore.auth_sessions[0].expires_at = new Date(Date.now() - 60_000).toISOString();
    const expiredBootRes = await request('/api/bootstrap?mode=critical', { cookies: cookieJar });
    assert.strictEqual(expiredBootRes.status, 401);
    assert.strictEqual(expiredBootRes.json?.code, 'TOKEN_EXPIRED');

    console.log('6) Testing refresh token rotation (even while expired mora_access_token cookie is still in jar)...');
    const oldAccess = cookieJar.mora_access_token;
    const oldRefresh = cookieJar.mora_refresh_token;
    const refreshRes = await request('/api/auth/refresh', {
      method: 'POST',
      cookies: cookieJar,
      body: {}
    });
    assert.strictEqual(refreshRes.status, 200, `Expected 200 on refresh, got ${refreshRes.status}: ${refreshRes.text}`);
    assert.strictEqual(refreshRes.json?.success, true);
    assert.strictEqual(refreshRes.json?.user?.id, 'u-ray');

    const newCookies = parseSetCookies(refreshRes.setCookies);
    assert.ok(newCookies.mora_access_token?.value && newCookies.mora_access_token.value !== oldAccess, 'access token must rotate');
    assert.ok(newCookies.mora_refresh_token?.value && newCookies.mora_refresh_token.value !== oldRefresh, 'refresh token must rotate');
    assert.strictEqual(dbStore.refresh_tokens.length, 2, 'should have 1 revoked + 1 active refresh token');
    assert.ok(dbStore.refresh_tokens[0].revoked_at, 'old refresh token must be revoked');
    assert.ok(dbStore.refresh_tokens[0].replaced_by_token_hash, 'old refresh token must link replaced_by_token_hash');

    cookieJar.mora_access_token = newCookies.mora_access_token.value;
    cookieJar.mora_refresh_token = newCookies.mora_refresh_token.value;

    const retryBootRes = await request('/api/bootstrap?mode=critical', { cookies: cookieJar });
    assert.strictEqual(retryBootRes.status, 200);
    assert.strictEqual(retryBootRes.json?.isAuthenticated, true);

    console.log('8) Testing Superadmin dashboard endpoints with rotated session...');
    const [sessionsListRes, usersListRes, auditRes, healthRes] = await Promise.all([
      request('/api/sessions', { cookies: cookieJar }),
      request('/api/users', { cookies: cookieJar }),
      request('/api/audit-logs', { cookies: cookieJar }),
      request('/api/health', { cookies: cookieJar })
    ]);
    assert.strictEqual(sessionsListRes.status, 200, `GET /api/sessions failed: ${sessionsListRes.text}`);
    assert.ok(Array.isArray(sessionsListRes.json?.sessions) && sessionsListRes.json.sessions.length >= 1);
    assert.strictEqual(usersListRes.status, 200, `GET /api/users failed: ${usersListRes.text}`);
    assert.strictEqual(auditRes.status, 200, `GET /api/audit-logs failed: ${auditRes.text}`);
    assert.strictEqual(healthRes.status, 200, `GET /api/health failed: ${healthRes.text}`);
    assert.strictEqual(healthRes.json?.activeDatabase, 'SUPABASE_CONNECTED');
    assert.strictEqual(healthRes.json?.database?.status, 'SUPABASE_CONNECTED');

    console.log('6b) Testing refresh token replay protection revokes session family...');
    const replayRes = await request('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: oldRefresh }
    });
    assert.strictEqual(replayRes.status, 401);
    assert.strictEqual(replayRes.json?.code, 'REFRESH_TOKEN_REVOKED');
    assert.ok(dbStore.auth_sessions[0].revoked_at, 'session family must be revoked after replay detection');
    assert.strictEqual(dbStore.user_sessions[0].status, 'revoked', 'user_sessions row must be revoked after replay detection');

    console.log('7) Testing login -> logout revokes auth_sessions, refresh_tokens, user_sessions & clears cookies...');
    const login2Res = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'rays', password: raysPasswordPlain }
    });
    assert.strictEqual(login2Res.status, 200);
    const jar2Raw = parseSetCookies(login2Res.setCookies);
    const jar2 = {
      mora_access_token: jar2Raw.mora_access_token.value,
      mora_refresh_token: jar2Raw.mora_refresh_token.value
    };
    const logoutRes = await request('/api/auth/logout', {
      method: 'POST',
      cookies: jar2
    });
    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual(logoutRes.json?.success, true);

    const activeSessionsAfterLogout = dbStore.auth_sessions.filter(s => !s.revoked_at);
    const activeRefreshAfterLogout = dbStore.refresh_tokens.filter(r => !r.revoked_at);
    const activeUserSessionsAfterLogout = dbStore.user_sessions.filter(s => s.status === 'active');
    assert.strictEqual(activeSessionsAfterLogout.length, 0, 'all auth_sessions must be revoked');
    assert.strictEqual(activeRefreshAfterLogout.length, 0, 'all refresh_tokens must be revoked');
    assert.strictEqual(activeUserSessionsAfterLogout.length, 0, 'all user_sessions must be revoked');

    const postLogoutBoot = await request('/api/bootstrap?mode=critical', { cookies: jar2 });
    assert.strictEqual(postLogoutBoot.status, 401);
    assert.strictEqual(postLogoutBoot.json?.code, 'SESSION_REVOKED');

    const postLogoutRefresh = await request('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: jar2.mora_refresh_token }
    });
    assert.strictEqual(postLogoutRefresh.status, 401);
    assert.strictEqual(postLogoutRefresh.json?.code, 'REFRESH_TOKEN_REVOKED');

    assert.strictEqual(rayDbRow.id, 'u-ray', 'u-ray id must stay unchanged');
    assert.strictEqual(rayDbRow.password_hash, raysOriginalHash, 'u-ray password_hash must stay untouched');

    console.log('ALL 8 VERCEL + CUSTOM AUTH VERIFICATION CHECKS PASSED.');
  } finally {
    resetSupabaseBackendClientForTesting();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
