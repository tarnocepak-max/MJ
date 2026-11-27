import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseDeletionApiResponse,
  fetchDeletionCategoriesSummary,
  fetchDeletionFacets,
  fetchDeletionItems,
  inspectRecordDependencies,
  executeCentralizedSoftDelete,
  executeCentralizedRestore,
  fetchDeletionHistory
} from '../src/services/deletionManagementService.ts';
import { reconcileFullTicketSnapshot } from '../src/services/woSyncEngine.ts';
import {
  listDeletionItems,
  inspectWoDependencies,
  type LocalStoreBridge
} from './centralizedDeletionService.ts';
import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from './supabaseClient.ts';

const WARMUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Starting Server...</title></head>
<body><h1>Please wait while your application starts...</h1></body>
</html>`;

test('parseDeletionApiResponse rejects warmup HTML, generic HTML, non-JSON, and malformed JSON without leaking raw HTML', async () => {
  const warmupRes = new Response(WARMUP_HTML, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Request-Id': 'req-warmup-1' }
  });
  const parsedWarmup = await parseDeletionApiResponse(warmupRes, '/api/deletion/items');
  assert.equal(parsedWarmup.ok, false);
  assert.equal(parsedWarmup.isHtml, true);
  assert.equal(parsedWarmup.isWarmupHtml, true);
  assert.equal(parsedWarmup.code, 'HTML_WARMUP_RESPONSE');
  assert.equal(parsedWarmup.requestId, 'req-warmup-1');
  assert.ok(parsedWarmup.error);
  assert.equal(parsedWarmup.error!.includes('<'), false, 'Sanitized error must NEVER contain raw HTML tags');

  const spaHtmlRes = new Response('<!doctype html><html><body><div>SPA Fallback</div></body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' }
  });
  const parsedSpa = await parseDeletionApiResponse(spaHtmlRes, '/api/deletion/items');
  assert.equal(parsedSpa.ok, false);
  assert.equal(parsedSpa.isHtml, true);
  assert.equal(parsedSpa.code, 'HTML_RESPONSE');
  assert.equal(parsedSpa.error!.includes('<'), false);

  const plainRes = new Response('502 Bad Gateway', {
    status: 502,
    headers: { 'Content-Type': 'text/plain' }
  });
  const parsedPlain = await parseDeletionApiResponse(plainRes, '/api/deletion/items');
  assert.equal(parsedPlain.ok, false);
  assert.equal(parsedPlain.code, 'NON_JSON_RESPONSE');

  const malformedJsonRes = new Response('{"success": true, broken', {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const parsedMalformed = await parseDeletionApiResponse(malformedJsonRes, '/api/deletion/items');
  assert.equal(parsedMalformed.ok, false);
  assert.equal(parsedMalformed.code, 'INVALID_JSON_RESPONSE');

  const err503Json = new Response(
    JSON.stringify({ success: false, code: 'DATABASE_UNAVAILABLE', error: 'Supabase offline', requestId: 'req-db-503' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
  const parsed503 = await parseDeletionApiResponse(err503Json, '/api/deletion/items');
  assert.equal(parsed503.ok, false);
  assert.equal(parsed503.code, 'DATABASE_UNAVAILABLE');
  assert.equal(parsed503.requestId, 'req-db-503');

  const validRes = new Response(
    JSON.stringify({ success: true, items: [], total: 0, page: 1, pageSize: 25, totalPages: 1, requestId: 'req-ok-1' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
  const parsedOk = await parseDeletionApiResponse<any>(validRes, '/api/deletion/items');
  assert.equal(parsedOk.ok, true);
  assert.equal(parsedOk.requestId, 'req-ok-1');
  assert.equal(parsedOk.data.success, true);
});

test('All Data Deletion client fetch wrappers catch warmup HTML, network errors, and timeouts cleanly without throwing', async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 1. Mock fetch returning warmup HTML for every endpoint
    globalThis.fetch = (async () =>
      new Response(WARMUP_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html', 'X-Request-Id': 'req-html-mock' }
      })) as any;

    const sumRes = await fetchDeletionCategoriesSummary();
    assert.equal(sumRes.success, false);
    assert.equal(sumRes.code, 'HTML_WARMUP_RESPONSE');
    assert.equal(sumRes.error?.includes('<'), false);

    const facRes = await fetchDeletionFacets('work_orders');
    assert.equal(facRes.success, false);
    assert.equal(facRes.code, 'HTML_WARMUP_RESPONSE');

    const itemsRes = await fetchDeletionItems({ category: 'work_orders', mode: 'soft_delete' });
    assert.equal(itemsRes.success, false);
    assert.equal(itemsRes.code, 'HTML_WARMUP_RESPONSE');
    assert.deepEqual(itemsRes.items, []);

    const depsRes = await inspectRecordDependencies('work_orders', 'wo-1');
    assert.equal(depsRes.success, false);
    assert.equal(depsRes.code, 'HTML_WARMUP_RESPONSE');

    const sdRes = await executeCentralizedSoftDelete({
      targets: [{ category: 'work_orders', recordId: 'wo-1' }],
      reason: 'Alasan uji warmup HTML'
    });
    assert.equal(sdRes.success, false);
    assert.equal(sdRes.code, 'HTML_WARMUP_RESPONSE');

    const restoreRes = await executeCentralizedRestore({
      targets: [{ category: 'work_orders', recordId: 'wo-1' }],
      reason: 'Alasan restore uji'
    });
    assert.equal(restoreRes.success, false);
    assert.equal(restoreRes.code, 'HTML_WARMUP_RESPONSE');

    const histRes = await fetchDeletionHistory({ page: 1, pageSize: 25 });
    assert.equal(histRes.success, false);
    assert.equal(histRes.code, 'HTML_WARMUP_RESPONSE');

    // 2. Mock fetch rejecting with AbortError (timeout)
    globalThis.fetch = (async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as any;

    const timeoutRes = await fetchDeletionItems({ category: 'work_orders', mode: 'soft_delete' });
    assert.equal(timeoutRes.success, false);
    assert.equal(timeoutRes.code, 'REQUEST_TIMEOUT');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase schema fallback in listDeletionItems & inspectWoDependencies prevents 503 on legacy columns/missing tables', async () => {
  const schemaClient = {
    from(table: string) {
      let selectedCols = '*';
      let isCountHead = false;
      const exec = async (): Promise<any> => {
        if (table === 'work_orders') {
          if (selectedCols.includes('payload') || selectedCols.includes('deletion_reason')) {
            return {
              data: null,
              error: { code: '42703', message: 'column work_orders.deletion_reason does not exist' }
            };
          }
          if (isCountHead) return { data: null, count: 1, error: null };
          return {
            data: [
              {
                id: 'wo-schema-1',
                wo_number: 'WO-SCH-001',
                customer_id: '1234567',
                customer_name: 'Pelanggan Schema Fallback',
                appointment_date: '2026-11-26',
                contractor_name: 'PT Alpha',
                area: 'Jakarta',
                installer_name: 'Teknisi 1',
                is_deleted: false,
                is_archived: false,
                created_at: '2026-11-26T01:00:00Z',
                updated_at: '2026-11-26T01:00:00Z'
              }
            ],
            error: null
          };
        }

        if (table === 'assignment_history') {
          // Simulate legacy schema where `assigned_at` does not exist, only `created_at`
          if (selectedCols.includes('assigned_at')) {
            return {
              data: null,
              error: { code: '42703', message: 'column assignment_history.assigned_at does not exist' }
            };
          }
          if (isCountHead) return { data: null, count: 2, error: null };
          return {
            data: [
              {
                id: 'ah-leg-1',
                work_order_id: 'wo-schema-1',
                wo_number: 'WO-SCH-001',
                new_installer_name: 'Teknisi 1',
                performed_by: 'Leader Uji',
                created_at: '2026-11-26T02:00:00Z'
              }
            ],
            error: null
          };
        }

        if (table === 'technical_reports') {
          // Simulate schema using technical_description & submitted_by instead of notes & installer_name
          if (selectedCols.includes('notes') || selectedCols.includes('submitted_at')) {
            return {
              data: null,
              error: { code: '42703', message: 'column technical_reports.notes does not exist' }
            };
          }
          if (isCountHead) return { data: null, count: 1, error: null };
          return {
            data: [
              {
                id: 'tr-leg-1',
                work_order_id: 'wo-schema-1',
                wo_number: 'WO-SCH-001',
                technical_description: 'Instalasi selesai',
                submitted_by: 'Teknisi 1',
                created_at: '2026-11-26T03:00:00Z'
              }
            ],
            error: null
          };
        }

        if (table === 'import_history' || table === 'file_attachments' || table === 'attachments') {
          return {
            data: null,
            error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }
          };
        }

        if (table === 'import_jobs') {
          return { data: [], error: null };
        }

        if (isCountHead) return { data: null, count: 0, error: null };
        return { data: [], error: null };
      };

      const builder: any = {
        select(cols = '*', opts?: any) {
          selectedCols = String(cols || '*');
          isCountHead = Boolean(opts?.head);
          return builder;
        },
        eq() {
          return builder;
        },
        or() {
          return builder;
        },
        ilike() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        range() {
          return builder;
        },
        async maybeSingle() {
          const res = await exec();
          return { data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data, error: res.error };
        },
        then(onFulfilled: any, onRejected: any) {
          return exec().then(onFulfilled, onRejected);
        }
      };
      return builder;
    }
  };

  const bridge: LocalStoreBridge = {
    db: {},
    saveDatabaseToDisk: () => {},
    logServerAuditAsync: async () => {},
    broadcastSupabaseChange: () => {},
    revokeUserSessions: () => {},
    isSupabaseMode: () => true,
    isLocalJsonModeAllowed: () => false
  };

  setSupabaseBackendClientForTesting(schemaClient);
  try {
    const woRes = await listDeletionItems(bridge, {
      actorRole: 'super_admin',
      category: 'work_orders',
      mode: 'soft_delete'
    });
    assert.equal(woRes.items.length, 1);
    assert.equal(woRes.items[0].woNumber, 'WO-SCH-001');

    const ahRes = await listDeletionItems(bridge, {
      actorRole: 'super_admin',
      category: 'assignment_history',
      mode: 'soft_delete'
    });
    assert.equal(ahRes.items.length, 1);
    assert.equal(ahRes.items[0].assignedBy, 'Leader Uji');

    const trRes = await listDeletionItems(bridge, {
      actorRole: 'super_admin',
      category: 'technical_reports',
      mode: 'soft_delete'
    });
    assert.equal(trRes.items.length, 1);
    assert.equal(trRes.items[0].notes, 'Instalasi selesai');

    // Missing table returns empty cleanly instead of throwing 503
    const impHistRes = await listDeletionItems(bridge, {
      actorRole: 'super_admin',
      category: 'import_history',
      mode: 'soft_delete'
    });
    assert.equal(impHistRes.items.length, 0);

    // Dependency inspection tolerates missing attachments table without failing
    const deps = await inspectWoDependencies(bridge, 'wo-schema-1');
    assert.equal(deps.found, true);
    assert.equal(deps.counts.assignment_history, 2);
    assert.equal(deps.counts.technical_reports, 1);
    assert.equal(deps.counts.attachments, 0);
  } finally {
    resetSupabaseBackendClientForTesting();
  }
});

test('reconcileFullTicketSnapshot prunes stale deleted WOs (232 cached -> 2 active) while preserving open edits', () => {
  const cachedTickets: any[] = [];
  for (let i = 1; i <= 232; i++) {
    cachedTickets.push({
      id: `wo-${i}`,
      woNumber: `WO-${i}`,
      isDeleted: false
    });
  }
  const authoritativeActive: any[] = [
    { id: 'wo-1', woNumber: 'WO-1', customerName: 'Fresh Server 1', isDeleted: false },
    { id: 'wo-2', woNumber: 'WO-2', customerName: 'Fresh Server 2', isDeleted: false }
  ];

  // Without open edits: stale 230 rows pruned down to authoritative 2
  const reconciled = reconcileFullTicketSnapshot(cachedTickets, authoritativeActive, new Set());
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[0].customerName, 'Fresh Server 1');

  // With wo-1 currently open for editing: preserve local edit buffer for wo-1
  cachedTickets[0].customerName = 'Edited Locally';
  const reconciledWithEdit = reconcileFullTicketSnapshot(cachedTickets, authoritativeActive, new Set(['wo-1']));
  assert.equal(reconciledWithEdit.length, 2);
  assert.equal(reconciledWithEdit[0].customerName, 'Edited Locally');
  assert.equal(reconciledWithEdit[1].customerName, 'Fresh Server 2');
});

test('/api/deletion/* HTTP endpoints always return JSON with X-Request-Id and requestId and never leak HTML', async () => {
  const dataFile = path.resolve('data/morajaws_database.json');
  const hadDataFile = fs.existsSync(dataFile);
  const originalDataBytes = hadDataFile ? fs.readFileSync(dataFile) : null;

  resetSupabaseBackendClientForTesting();
  const serverMod = await import('../server.ts');
  const { createExpressApp, db, SERVER_SESSIONS } = serverMod;

  const app = await createExpressApp({ skipVite: true, apiOnly: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  let saUser = db.users.find((u: any) => u.id === 'u-del-resilience-sa');
  if (!saUser) {
    saUser = {
      id: 'u-del-resilience-sa',
      name: 'SuperAdmin Deletion Test',
      username: 'u-del-resilience-sa',
      email: 'sa-del-resilience@test.local',
      role: 'super_admin',
      active: true,
      mustChangePassword: false,
      passwordHash: 'test',
      createdAt: new Date().toISOString()
    };
    db.users.push(saUser);
  }

  const token = `tok-del-${crypto.randomBytes(8).toString('hex')}`;
  SERVER_SESSIONS.push({
    sessionId: `sess-del-${Date.now()}`,
    token,
    userId: saUser.id,
    userName: saUser.name,
    role: saUser.role,
    sessionVersion: saUser.sessionVersion || 1,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString()
  } as any);

  try {
    // 1. Unauthenticated returns 401 JSON with X-Request-Id
    const unauth = await fetch(`${baseUrl}/api/deletion/items?category=work_orders`);
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get('content-type') || '', /application\/json/i);
    assert.ok(unauth.headers.get('x-request-id'));
    const unauthJson = await unauth.json();
    assert.equal(unauthJson.code, 'UNAUTHENTICATED');
    assert.ok(unauthJson.error);

    // 2. Summary, Facets, Items, History all return 200 JSON with X-Request-Id
    for (const urlPath of [
      '/api/deletion/categories-summary',
      '/api/deletion/facets?category=work_orders',
      '/api/deletion/items?category=work_orders&mode=soft_delete&page=1&pageSize=25',
      '/api/deletion/history?page=1&pageSize=25'
    ]) {
      const res = await fetch(`${baseUrl}${urlPath}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const rawText = await res.text();
      assert.equal(res.status, 200, `${urlPath} must return 200, got ${res.status}: ${rawText}`);
      assert.match(res.headers.get('content-type') || '', /application\/json/i);
      const reqIdHeader = res.headers.get('x-request-id');
      assert.ok(reqIdHeader, `${urlPath} must set X-Request-Id`);
      const body = JSON.parse(rawText);
      assert.equal(body.success, true);
      assert.equal(body.requestId, reqIdHeader);
    }

    // 3. Invalid category returns 400 JSON (never 503)
    const invalidCat = await fetch(`${baseUrl}/api/deletion/items?category=nonexistent_cat`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(invalidCat.status, 400);
    const invalidCatBody = await invalidCat.json();
    assert.equal(invalidCatBody.code, 'INVALID_CATEGORY');
    assert.ok(invalidCatBody.requestId);
  } finally {
    server.close();
    if (hadDataFile && originalDataBytes) {
      fs.writeFileSync(dataFile, originalDataBytes);
    } else if (!hadDataFile && fs.existsSync(dataFile)) {
      fs.unlinkSync(dataFile);
    }
  }
});
