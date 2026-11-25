import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  createExpressApp,
  isLocalJsonModeAllowed,
  validateCsrfProtection
} from '../server.ts';
import { hashPasswordWithBcrypt } from '../server/customAuthService.ts';
import vercelHandler from '../server/vercelHandler.ts';
import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from '../server/supabaseClient.ts';

function createAuthMockSupabase(usersList: any[]) {
  const tables: Record<string, any[]> = {
    users: usersList.map(u => ({ ...u })),
    auth_sessions: [],
    refresh_tokens: [],
    login_attempts: [],
    audit_logs: [],
    app_settings: [],
    roles: [
      { code: 'super_admin', name: 'Super Admin', permissions: ['all'] },
      { code: 'dispatch', name: 'Dispatch', permissions: ['view_wo'] },
      { code: 'leader', name: 'Leader', permissions: ['assign_wo'] },
      { code: 'installer', name: 'Installer', permissions: ['update_wo'] }
    ],
    work_orders: [],
    contractors: [],
    coverage_areas: [],
    ticket_messages: [],
    wa_templates: [],
    email_notification_logs: []
  };

  function makeBuilder(table: string) {
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: any = null;
    const eqFilters: Array<[string, any]> = [];
    const inFilters: Array<[string, any[]]> = [];
    const ilikeFilters: Array<[string, string]> = [];
    const isFilters: Array<[string, any]> = [];
    let orExprs: string[] = [];
    let maxRows: number | null = null;
    let isSingle = false;
    let isMaybeSingle = false;

    const execute = async () => {
      const rows = tables[table] || (tables[table] = []);

      const matches = (row: any) => {
        for (const [k, v] of eqFilters) {
          if (row[k] !== v && row?.payload?.[k] !== v) return false;
        }
        for (const [k, vals] of inFilters) {
          const cur = row[k] ?? row?.payload?.[k];
          if (!vals.includes(cur)) return false;
        }
        for (const [k, pat] of ilikeFilters) {
          const cur = String(row[k] ?? row?.payload?.[k] ?? '').toLowerCase();
          const needle = String(pat)
            .replace(/%/g, '')
            .replace(/\\([_%\\])/g, '$1')
            .toLowerCase();
          if (!cur.includes(needle)) return false;
        }
        for (const [k, val] of isFilters) {
          const cur = row[k] ?? null;
          if (val === null && cur !== null && cur !== undefined) return false;
        }
        if (orExprs.length > 0) {
          const matchedAny = orExprs.some(expr => {
            const parts = expr.split(',');
            return parts.some(part => {
              const segs = part.split('.');
              if (segs.length >= 3) {
                const col = segs[0];
                const cmp = segs[1];
                const target = segs.slice(2).join('.');
                const val = String(row[col] ?? row?.payload?.[col] ?? '');
                if (cmp === 'ilike') return val.toLowerCase() === target.toLowerCase();
                if (cmp === 'eq') return val === target;
              }
              return false;
            });
          });
          if (!matchedAny) return false;
        }
        return true;
      };

      if (op === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map(item => ({ ...item }));
        rows.push(...items);
        const out = isSingle || isMaybeSingle ? items[0] || null : items;
        return { data: out, error: null };
      }

      if (op === 'upsert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map(item => ({ ...item }));
        for (const item of items) {
          const idx = rows.findIndex(r => r.id && item.id && r.id === item.id);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...item };
          else rows.push(item);
        }
        const out = isSingle || isMaybeSingle ? items[0] || null : items;
        return { data: out, error: null };
      }

      if (op === 'update') {
        const updated: any[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (matches(rows[i])) {
            rows[i] = { ...rows[i], ...payload };
            updated.push(rows[i]);
          }
        }
        const out = isSingle || isMaybeSingle ? updated[0] || null : updated;
        return { data: out, error: null };
      }

      if (op === 'delete') {
        const kept: any[] = [];
        const deleted: any[] = [];
        for (const r of rows) {
          if (matches(r)) deleted.push(r);
          else kept.push(r);
        }
        tables[table] = kept;
        return { data: deleted, error: null };
      }

      let selected = rows.filter(matches);
      if (maxRows !== null) selected = selected.slice(0, maxRows);
      if (isSingle || isMaybeSingle) {
        return { data: selected[0] || null, error: null };
      }
      return { data: selected, error: null, count: selected.length };
    };

    const builder: any = {
      select: () => builder,
      insert: (v: any) => {
        op = 'insert';
        payload = v;
        return builder;
      },
      upsert: (v: any) => {
        op = 'upsert';
        payload = v;
        return builder;
      },
      update: (v: any) => {
        op = 'update';
        payload = v;
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      eq: (k: string, v: any) => {
        eqFilters.push([k, v]);
        return builder;
      },
      neq: () => builder,
      in: (k: string, v: any[]) => {
        inFilters.push([k, v]);
        return builder;
      },
      ilike: (k: string, v: string) => {
        ilikeFilters.push([k, v]);
        return builder;
      },
      is: (k: string, v: any) => {
        isFilters.push([k, v]);
        return builder;
      },
      gte: () => builder,
      lte: () => builder,
      gt: () => builder,
      lt: () => builder,
      or: (expr: string) => {
        orExprs.push(expr);
        return builder;
      },
      order: () => builder,
      limit: (n: number) => {
        maxRows = n;
        return builder;
      },
      range: () => builder,
      single: () => {
        isSingle = true;
        return execute();
      },
      maybeSingle: () => {
        isMaybeSingle = true;
        return execute();
      },
      then: (resolve: any, reject: any) => execute().then(resolve, reject)
    };

    return builder;
  }

  return {
    from: (table: string) => makeBuilder(table),
    storage: {
      listBuckets: async () => ({ data: [{ name: 'morajaws-attachments' }], error: null })
    }
  } as any;
}

async function startTempServer(handler: http.RequestListener): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

function extractCookiePairs(setCookieHeaders: string[]): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const raw of setCookieHeaders) {
    const first = raw.split(';')[0];
    const eqIdx = first.indexOf('=');
    if (eqIdx > 0) {
      jar[first.slice(0, eqIdx).trim()] = first.slice(eqIdx + 1).trim();
    }
  }
  return jar;
}

test('Vercel serverless runtime strictly disables local JSON fallback even outside NODE_ENV=production', () => {
  const prevVercel = process.env.VERCEL;
  const prevNodeEnv = process.env.NODE_ENV;
  try {
    process.env.VERCEL = '1';
    process.env.NODE_ENV = 'development';
    assert.equal(isLocalJsonModeAllowed(), false);
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
});

test('Vercel handler normalizes ?__vercel_path, returns 404 JSON on bare /api and unknown API routes, and handles invalid JSON', async () => {
  const prevVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  const { server, baseUrl } = await startTempServer((req, res) => {
    void vercelHandler(req, res);
  });

  try {
    const healthRes = await fetch(`${baseUrl}/api/index?__vercel_path=health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.authentication?.sessionFallbackAvailable, false);

    const bareApiRes = await fetch(`${baseUrl}/api/index?__vercel_path=`);
    assert.equal(bareApiRes.status, 404);
    const bareApiJson = await bareApiRes.json();
    assert.equal(bareApiJson.code, 'NOT_FOUND');

    const missingRouteRes = await fetch(`${baseUrl}/api/index?__vercel_path=does-not-exist`);
    assert.equal(missingRouteRes.status, 404);
    const missingJson = await missingRouteRes.json();
    assert.equal(missingJson.code, 'NOT_FOUND');

    const badJsonRes = await fetch(`${baseUrl}/api/index?__vercel_path=auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl
      },
      body: '{"broken_json": '
    });
    assert.equal(badJsonRes.status, 400);
    const badJsonBody = await badJsonRes.json();
    assert.equal(badJsonBody.code, 'INVALID_JSON');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  }
});

test('AUTH_COOKIE_ONLY_MODE=true login, cookie bootstrap, cookie refresh, CSRF block, and Cron Bearer guard', async () => {
  const password = 'SuperSecurePassword!2026';
  const passwordHash = await hashPasswordWithBcrypt(password);
  const mockSupabase = createAuthMockSupabase([
    {
      id: 'usr_super_vercel_01',
      username: 'vercel_admin',
      email: 'vercel_admin@morajaws.test',
      name: 'Vercel Superadmin',
      role: 'super_admin',
      active: true,
      account_status: 'active',
      password_hash: passwordHash,
      session_version: 1,
      failed_login_count: 0,
      payload: {
        id: 'usr_super_vercel_01',
        username: 'vercel_admin',
        email: 'vercel_admin@morajaws.test',
        name: 'Vercel Superadmin',
        role: 'super_admin',
        active: true,
        accountStatus: 'active',
        passwordHash,
        sessionVersion: 1
      }
    }
  ]);

  const prevVercel = process.env.VERCEL;
  const prevCookieOnly = process.env.AUTH_COOKIE_ONLY_MODE;
  const prevCronSecret = process.env.CRON_SECRET;

  process.env.VERCEL = '1';
  process.env.AUTH_COOKIE_ONLY_MODE = 'true';
  process.env.CRON_SECRET = 'test_vercel_cron_secret_32bytes_ok';
  setSupabaseBackendClientForTesting(mockSupabase);

  const app = await createExpressApp({ skipVite: true, apiOnly: true });
  const { server, baseUrl } = await startTempServer(app);

  try {
    // 1. Login in AUTH_COOKIE_ONLY_MODE=true: sets HttpOnly cookies and omits tokens from JSON
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl
      },
      body: JSON.stringify({ identifier: 'vercel_admin', password })
    });
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert.equal(loginJson.success, true);
    assert.equal(loginJson.cookieAuth, true);
    assert.equal(loginJson.tokens, undefined);
    assert.equal(loginJson.token, undefined);

    const setCookies = typeof (loginRes.headers as any).getSetCookie === 'function'
      ? (loginRes.headers as any).getSetCookie()
      : [];
    assert.ok(setCookies.some((c: string) => c.startsWith('mora_access_token=') && c.includes('HttpOnly')));
    assert.ok(setCookies.some((c: string) => c.startsWith('mora_refresh_token=') && c.includes('HttpOnly')));
    const jar = extractCookiePairs(setCookies);
    assert.ok(jar.mora_access_token);
    assert.ok(jar.mora_refresh_token);

    // 2. Cookie-only authenticated request to /api/bootstrap?mode=critical
    const bootRes = await fetch(`${baseUrl}/api/bootstrap?mode=critical`, {
      headers: {
        Cookie: `mora_access_token=${jar.mora_access_token}`
      }
    });
    assert.equal(bootRes.status, 200);
    const bootJson = await bootRes.json();
    assert.equal(bootJson.isAuthenticated, true);
    assert.equal(bootJson.currentUser?.id, 'usr_super_vercel_01');
    assert.equal(bootJson.currentUser?.role, 'super_admin');

    // 3. Cookie-only refresh without body refreshToken
    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        Cookie: `mora_refresh_token=${jar.mora_refresh_token}`
      },
      body: JSON.stringify({})
    });
    assert.equal(refreshRes.status, 200);
    const refreshJson = await refreshRes.json();
    assert.equal(refreshJson.success, true);
    assert.equal(refreshJson.cookieAuth, true);
    assert.equal(refreshJson.tokens, undefined);

    // 4. CSRF protection rejects cross-origin untrusted POST
    const csrfRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil-attacker.example.com',
        Cookie: `mora_access_token=${jar.mora_access_token}`
      }
    });
    assert.equal(csrfRes.status, 403);
    assert.equal(
      validateCsrfProtection({
        method: 'POST',
        path: '/api/cron/daily-maintenance',
        headers: {}
      }).valid,
      true
    );

    // 5. Cron endpoint enforces CRON_SECRET
    const unauthCron = await fetch(`${baseUrl}/api/cron/daily-maintenance`);
    assert.equal(unauthCron.status, 401);

    const wrongCron = await fetch(`${baseUrl}/api/cron/daily-maintenance`, {
      headers: { Authorization: 'Bearer wrong-secret' }
    });
    assert.equal(wrongCron.status, 401);

    const validCron = await fetch(`${baseUrl}/api/cron/daily-maintenance`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }
    });
    assert.equal(validCron.status, 200);
    const validCronJson = await validCron.json();
    assert.equal(validCronJson.success, true);
    assert.ok(validCronJson.operationalDateWIB);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    resetSupabaseBackendClientForTesting();
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    if (prevCookieOnly === undefined) delete process.env.AUTH_COOKIE_ONLY_MODE;
    else process.env.AUTH_COOKIE_ONLY_MODE = prevCookieOnly;
    if (prevCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCronSecret;
  }
});

test('Static deployment hygiene: no public aistudio leaks, no spoofable x-user-* headers, no /proc scans, valid vercel.json', () => {
  const root = process.cwd();

  const aistudioDir = path.join(root, 'public', 'assets', 'aistudio');
  if (fs.existsSync(aistudioDir)) {
    const entries = fs.readdirSync(aistudioDir);
    assert.deepEqual(entries, ['.gitkeep']);
  }

  const vercelJson = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(
    Array.isArray(vercelJson.rewrites) &&
      vercelJson.rewrites.some((r: any) => r.source === '/api' && String(r.destination).includes('__vercel_path='))
  );
  assert.ok(
    Array.isArray(vercelJson.crons) &&
      vercelJson.crons.some((c: any) => c.path === '/api/cron/daily-maintenance' && c.schedule === '5 17 * * *')
  );

  // Check zero active x-user-id / x-user-role / x-username header assignments in src/
  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(full);
    }
  };
  walk(path.join(root, 'src'));
  for (const file of srcFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
      assert.equal(
        /['"]x-user-(id|role|username)['"]\s*:/.test(line),
        false,
        `Found spoofable header in ${file}: ${trimmed}`
      );
    }
  }

  // Check zero active /proc/*/environ reads in scripts/
  const scriptFiles = fs
    .readdirSync(path.join(root, 'scripts'))
    .filter(
      f =>
        (f.endsWith('.ts') || f.endsWith('.mjs')) &&
        f !== 'execute_phase14r_integration_tests.ts' &&
        f !== 'verify_phase14r_fail_closed.ts'
    );
  for (const file of scriptFiles) {
    const content = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
    const hasProcRead = content.includes('/proc/') && (content.includes('readFile') || content.includes('environ'));
    assert.equal(hasProcRead, false, `Found /proc/ scan in scripts/${file}`);
  }
});
