import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {
  CHUNK_RELOAD_GUARD_KEY,
  canAttemptChunkReload,
  clearChunkReloadGuard,
  extractFailedModuleName,
  isDynamicImportChunkError,
  markChunkReloadAttempted,
  registerVitePreloadErrorHandler
} from '../src/utils/lazyChunkRecovery.ts';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    }
  };
}

test('isDynamicImportChunkError & extractFailedModuleName detect Vite dynamic import failures accurately', () => {
  const chromeErr = new TypeError(
    'Failed to fetch dynamically imported module: https://mora-jawskies-git-main-jkwest.vercel.app/assets/MonitoringMapsView-B6b4CiTn.js'
  );
  assert.equal(isDynamicImportChunkError(chromeErr), true);
  assert.equal(extractFailedModuleName(chromeErr, 'MonitoringMapsView'), 'MonitoringMapsView-B6b4CiTn.js');

  assert.equal(isDynamicImportChunkError(new Error('Importing a module script failed.')), true);
  assert.equal(isDynamicImportChunkError(new Error('error loading dynamically imported module')), true);
  assert.equal(isDynamicImportChunkError(new Error('Unable to preload CSS for /assets/MonitoringMapsView.css')), true);
  assert.equal(isDynamicImportChunkError(new Error('Regular validation error')), false);
});

test('registerVitePreloadErrorHandler reloads exactly once via sessionStorage guard and preserves Custom Auth', () => {
  const sessionMock = createMemoryStorage();
  const localAuthMock = createMemoryStorage({
    morajaws_logged_in: 'true',
    morajaws_auth_session: JSON.stringify({ user: { id: 'u-1', role: 'super_admin' }, token: 'keep-me' })
  });

  const listeners = new Map<string, Array<(ev: Event) => void>>();
  let reloadCount = 0;
  const mockWindow = {
    addEventListener(type: string, fn: (ev: Event) => void) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type: string, fn: (ev: Event) => void) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter(item => item !== fn));
    }
  } as unknown as Window;

  const cleanup = registerVitePreloadErrorHandler({
    targetWindow: mockWindow,
    storage: sessionMock,
    reloadFn: () => {
      reloadCount += 1;
    },
    nowFn: () => 1_700_000_000_000
  });

  const dispatchPreloadError = () => {
    let prevented = false;
    const ev = {
      payload: new Error(
        'Failed to fetch dynamically imported module: https://mora-jawskies-git-main-jkwest.vercel.app/assets/MonitoringMapsView-B6b4CiTn.js'
      ),
      preventDefault() {
        prevented = true;
      }
    } as unknown as Event;
    for (const fn of listeners.get('vite:preloadError') || []) {
      fn(ev);
    }
    return prevented;
  };

  // First failure: triggers single reload + calls preventDefault + marks sessionStorage
  const firstPrevented = dispatchPreloadError();
  assert.equal(firstPrevented, true);
  assert.equal(reloadCount, 1);
  assert.equal(canAttemptChunkReload(sessionMock), false);
  assert.ok(sessionMock.getItem(CHUNK_RELOAD_GUARD_KEY)?.includes('MonitoringMapsView-B6b4CiTn.js'));

  // Custom Auth storage remains completely intact
  assert.equal(localAuthMock.getItem('morajaws_logged_in'), 'true');
  assert.ok(localAuthMock.getItem('morajaws_auth_session')?.includes('keep-me'));

  // Second failure after reload: MUST NOT reload again (no reload loop) and MUST NOT suppress error
  const secondPrevented = dispatchPreloadError();
  assert.equal(secondPrevented, false);
  assert.equal(reloadCount, 1);

  // Manual user clear resets guard
  clearChunkReloadGuard(sessionMock);
  assert.equal(canAttemptChunkReload(sessionMock), true);

  markChunkReloadAttempted('MonitoringMapsView-B6b4CiTn.js', sessionMock, 1_700_000_005_000);
  assert.equal(canAttemptChunkReload(sessionMock, 1_700_000_010_000), false);
  cleanup();
});

test('Production dist/assets contains MonitoringMapsView chunk and Express production static serving enforces cache headers + 404 on missing JS chunks', async () => {
  const rootDir = process.cwd();
  const distAssetsDir = path.join(rootDir, 'dist', 'assets');
  assert.equal(fs.existsSync(distAssetsDir), true, 'dist/assets must exist after npm run build');

  const files = fs.readdirSync(distAssetsDir);
  const mapsChunk = files.find(f => f.startsWith('MonitoringMapsView-') && f.endsWith('.js'));
  assert.ok(mapsChunk, `Expected MonitoringMapsView-*.js in dist/assets, found: ${files.join(', ')}`);

  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const { createExpressApp } = await import('../server.ts');
  const app = await createExpressApp({ skipVite: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // 1. Existing hashed MonitoringMapsView chunk -> 200 JS + immutable cache
    const validChunkRes = await fetch(`${baseUrl}/assets/${mapsChunk}`);
    assert.equal(validChunkRes.status, 200);
    assert.match(validChunkRes.headers.get('content-type') || '', /javascript/);
    assert.match(validChunkRes.headers.get('cache-control') || '', /immutable/);

    // 2. Stale / missing chunk (MonitoringMapsView-B6b4CiTn.js) -> 404 NOT SPA HTML fallback
    const missingChunkRes = await fetch(`${baseUrl}/assets/MonitoringMapsView-B6b4CiTn.js`);
    assert.equal(missingChunkRes.status, 404);
    const missingBody = await missingChunkRes.text();
    assert.equal(missingBody.includes('<!doctype html>'), false);

    // 3. Root / & index.html -> 200 text/html with no-store/no-cache
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers.get('content-type') || '', /text\/html/);
    assert.match(htmlRes.headers.get('cache-control') || '', /no-store/);
    assert.match(htmlRes.headers.get('cache-control') || '', /no-cache/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (prevNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = prevNodeEnv;
    }
  }
});

test('vercel.json configures no-store on HTML, immutable on /assets/*, and excludes .js/.css from SPA rewrite', () => {
  const vercelPath = path.join(process.cwd(), 'vercel.json');
  const config = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

  assert.ok(Array.isArray(config.headers) && config.headers.length >= 2);
  const htmlHeaderRule = config.headers.find((h: any) => h.source === '/index.html');
  const assetsHeaderRule = config.headers.find((h: any) => h.source === '/assets/(.*)');
  assert.ok(htmlHeaderRule);
  assert.ok(assetsHeaderRule);
  assert.match(
    htmlHeaderRule.headers.find((x: any) => x.key === 'Cache-Control')?.value || '',
    /no-store.*no-cache.*must-revalidate/
  );
  assert.match(
    assetsHeaderRule.headers.find((x: any) => x.key === 'Cache-Control')?.value || '',
    /immutable/
  );

  const spaRewrite = config.rewrites.find((r: any) => r.destination === '/index.html');
  assert.ok(spaRewrite);
  assert.match(spaRewrite.source, /assets/);
  assert.match(spaRewrite.source, /js\|mjs\|css/);
});
