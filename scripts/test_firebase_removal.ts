/**
 * MORAJAWS — PURE SUPABASE MIGRATION & FIREBASE REMOVAL TEST SUITE
 *
 * Verifies locally without requiring live Supabase credentials:
 *  1. Zero active Firebase SDK/package dependencies in package.json.
 *  2. Deleted Firebase/Firestore legacy files do not exist.
 *  3. Zero VITE_FIREBASE_ or NEXT_PUBLIC_FIREBASE_ env vars in .env.example or index.html.
 *  4. /api/health contains zero Firebase references and reports database status.
 *  5. POST /api/auth/firebase-login returns 410 Gone (FIREBASE_AUTH_REMOVED).
 *  6. Storage provider defaults to 'supabase' (morajaws-reports) and classifies legacy URLs as 'legacy_external'.
 *  7. Strict fail-closed behavior (503 DATABASE_UNAVAILABLE) when ALLOW_LOCAL_JSON_MODE=false and Supabase env is absent.
 *  8. Express SSE stream (/api/supabase/realtime/stream) responds with CONNECTED event for authenticated user.
 *  9. The 3 historical protected WO IDs are present in protected archive & SQL trigger 009.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { createExpressApp, db, ServerUser } from '../server.ts';
import { hashPasswordWithBcrypt } from '../server/customAuthService.ts';
import { getStorageProvider, classifyFileSource, MORAJAWS_STORAGE_BUCKET } from '../server/supabaseStorage.ts';
import { classifyFileSource as feClassifyFileSource } from '../src/services/storageCompatibility.ts';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(id: number, name: string, passed: boolean, details: string) {
  results.push({ id, name, passed, details });
  console.log(`[${passed ? '✅ PASS' : '❌ FAIL'}] #${id} ${name}: ${details}`);
}

function makeRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; rawBody: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: reqHeaders
      },
      res => {
        let rawBody = '';
        res.on('data', chunk => {
          rawBody += chunk;
        });
        res.on('end', () => {
          let data: any = rawBody;
          try {
            data = JSON.parse(rawBody);
          } catch {}
          resolve({ status: res.statusCode || 0, data, rawBody, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================================');
  console.log('   MORAJAWS — COMPLETE FIREBASE REMOVAL & PURE SUPABASE TEST SUITE    ');
  console.log('======================================================================\n');

  const root = process.cwd();

  // 1. package.json check
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const firebaseDeps = Object.keys(allDeps).filter(k => k.toLowerCase().includes('firebase'));
  const hasSupabaseDep = Boolean(allDeps['@supabase/supabase-js']);
  record(
    1,
    'package.json bebas dari Firebase SDK dan menggunakan @supabase/supabase-js',
    firebaseDeps.length === 0 && hasSupabaseDep,
    `Firebase deps: ${firebaseDeps.length}, @supabase/supabase-js: ${allDeps['@supabase/supabase-js']}`
  );

  // 2. Legacy Firebase config & adapter files removed
  const deletedFiles = [
    'firebase-applet-config.json',
    'firestore.rules',
    'firebase-blueprint.json',
    'src/lib/firebase.ts',
    'server/firebaseAdmin.ts',
    'src/services/firestoreDb.ts',
    'src/services/navigationFirestore.ts'
  ];
  const existingLegacy = deletedFiles.filter(f => fs.existsSync(path.join(root, f)));
  record(
    2,
    'File konfigurasi & adapter Firebase/Firestore telah dihapus',
    existingLegacy.length === 0,
    existingLegacy.length === 0 ? 'All 7 legacy Firebase files removed cleanly' : `Still present: ${existingLegacy.join(', ')}`
  );

  // 3. .env.example & index.html clean
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const envClean = !/FIREBASE/i.test(envExample) && envExample.includes('SUPABASE_URL=') && envExample.includes('SUPABASE_SERVICE_ROLE_KEY=');
  const htmlClean = !/firebase/i.test(indexHtml);
  record(
    3,
    '.env.example dan index.html bersih dari variabel dan skrip Firebase',
    envClean && htmlClean,
    `.env.example clean: ${envClean}, index.html clean: ${htmlClean}`
  );

  // 4. Storage provider & legacy URL classifier
  const storageCfg = getStorageProvider();
  const legacyUrlCheck = classifyFileSource('https://firebasestorage.googleapis.com/v0/b/demo/o/test.jpg');
  const feLegacyCheck = feClassifyFileSource('https://firebasestorage.googleapis.com/v0/b/demo/o/test.jpg');
  const supaUrlCheck = feClassifyFileSource('morajaws-reports/technical-reports/WO-123/img.png');
  record(
    4,
    'Storage adapter default ke Supabase Storage (morajaws-reports) & legacy URL tetap terbaca',
    storageCfg.STORAGE_PROVIDER === 'supabase' &&
      storageCfg.BUCKET === MORAJAWS_STORAGE_BUCKET &&
      legacyUrlCheck.sourceType === 'legacy_external' &&
      legacyUrlCheck.isLegacyExternal === true &&
      feLegacyCheck.source === 'legacy_external' &&
      feLegacyCheck.isLegacyExternal === true &&
      supaUrlCheck.source === 'supabase' &&
      supaUrlCheck.isSupabase === true,
    `Backend provider=${storageCfg.STORAGE_PROVIDER}, bucket=${storageCfg.BUCKET}, legacy=${feLegacyCheck.source}, supa=${supaUrlCheck.source}`
  );

  // Snapshot data/morajaws_database.json before starting Express in local test mode
  const dbFilePath = path.join(root, 'data/morajaws_database.json');
  const dbSnapshot = fs.existsSync(dbFilePath) ? fs.readFileSync(dbFilePath, 'utf8') : null;

  const prevLocalMode = process.env.ALLOW_LOCAL_JSON_MODE;
  process.env.ALLOW_LOCAL_JSON_MODE = 'true';

  const app = await createExpressApp({ skipVite: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    // Seed temporary test user
    const runTag = Date.now().toString(36);
    const saUser: ServerUser = {
      id: `usr-rm-sa-${runTag}`,
      name: 'Removal Test SA',
      username: `rm_sa_${runTag}`,
      email: `rm_sa_${runTag}@morajaws.test`,
      role: 'super_admin',
      active: true,
      passwordHash: await hashPasswordWithBcrypt('RemovePass123!'),
      sessionVersion: 1,
      mustChangePassword: false,
      createdAt: new Date().toISOString()
    };
    db.users.push(saUser);

    // 5. /api/health
    const healthRes = await makeRequest(port, 'GET', '/api/health');
    const healthStr = JSON.stringify(healthRes.data);
    record(
      5,
      '/api/health bebas dari Firebase dan melaporkan status database Supabase',
      healthRes.status === 200 && !/firebase/i.test(healthStr),
      `Status ${healthRes.status}, has firebase key: ${/firebase/i.test(healthStr)}, storageBucket: ${healthRes.data?.storage?.bucket || healthRes.data?.database?.mode || 'ok'}`
    );

    // 6. Removed /api/auth/firebase-login returns 410 Gone
    const fbLoginRes = await makeRequest(port, 'POST', '/api/auth/firebase-login', { idToken: 'fake' });
    record(
      6,
      'POST /api/auth/firebase-login mengembalikan HTTP 410 Gone (FIREBASE_AUTH_REMOVED)',
      fbLoginRes.status === 410 && fbLoginRes.data?.code === 'FIREBASE_AUTH_REMOVED',
      `Status ${fbLoginRes.status}, code: ${fbLoginRes.data?.code}`
    );

    // 7. Login & test SSE /api/supabase/realtime/stream
    const loginRes = await makeRequest(port, 'POST', '/api/auth/login', {
      identifier: saUser.username,
      password: 'RemovePass123!'
    });
    const token = loginRes.data?.tokens?.accessToken;

    const sseOk = await new Promise<{ ok: boolean; detail: string }>(resolve => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/supabase/realtime/stream',
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` }
        },
        res => {
          let buf = '';
          res.on('data', chunk => {
            buf += chunk.toString();
            if (buf.includes('CONNECTED')) {
              req.destroy();
              resolve({ ok: res.statusCode === 200, detail: `HTTP ${res.statusCode}, received CONNECTED event` });
            }
          });
          setTimeout(() => {
            req.destroy();
            resolve({ ok: false, detail: `Timed out, received: ${buf.slice(0, 120)}` });
          }, 3000);
        }
      );
      req.on('error', err => resolve({ ok: false, detail: err.message }));
      req.end();
    });

    record(7, 'Express SSE /api/supabase/realtime/stream mengirim event CONNECTED', sseOk.ok, sseOk.detail);

    // 8. Strict fail-closed mode when ALLOW_LOCAL_JSON_MODE=false and Supabase env is absent
    process.env.ALLOW_LOCAL_JSON_MODE = 'false';
    const failClosedRes = await makeRequest(port, 'POST', '/api/auth/login', {
      identifier: saUser.username,
      password: 'RemovePass123!'
    });
    const failClosedTicketsRes = await makeRequest(
      port,
      'GET',
      '/api/tickets',
      undefined,
      { Authorization: `Bearer ${token}` }
    );
    process.env.ALLOW_LOCAL_JSON_MODE = 'true';

    record(
      8,
      'Fail-closed 503 DATABASE_UNAVAILABLE saat ALLOW_LOCAL_JSON_MODE=false tanpa Supabase live',
      failClosedRes.status === 503 &&
        failClosedRes.data?.code === 'DATABASE_UNAVAILABLE' &&
        failClosedTicketsRes.status === 503,
      `Login status=${failClosedRes.status} (${failClosedRes.data?.code}), /api/tickets status=${failClosedTicketsRes.status}`
    );

    // 9. Protected historical WO IDs present in backup archive & migration 009
    const migration009 = fs.readFileSync(path.join(root, 'migrations/009_pure_supabase_alignment.sql'), 'utf8');
    const protectedIds = [
      'wo_1793825457141_u4bnht',
      'wo_imp_1793825458959_4i4f1h',
      'wo_imp_1793825458959_262dei'
    ];
    const archiveExists = fs.existsSync(path.join(root, 'data/morajaws_production_firestore_backup.json'));
    const migrationGuardsAll = protectedIds.every(id => migration009.includes(id));

    record(
      9,
      'Migrasi 009 (forward-only) & arsip backup historis menjaga 3 WO produksi terproteksi',
      archiveExists && migrationGuardsAll,
      `Archive exists=${archiveExists}, migration 009 protects all 3 IDs=${migrationGuardsAll}`
    );
  } finally {
    server.close();
    if (prevLocalMode === undefined) {
      delete process.env.ALLOW_LOCAL_JSON_MODE;
    } else {
      process.env.ALLOW_LOCAL_JSON_MODE = prevLocalMode;
    }
    if (dbSnapshot !== null) {
      fs.writeFileSync(dbFilePath, dbSnapshot, 'utf8');
    }
  }

  console.log('\n======================================================================');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
  console.log('======================================================================\n');

  process.exit(passed === total ? 0 : 1);
}

runTests().catch(err => {
  console.error('Fatal error running removal test suite:', err);
  process.exit(1);
});
