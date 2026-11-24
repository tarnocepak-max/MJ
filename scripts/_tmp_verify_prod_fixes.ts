import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

async function main() {
  // Ensure clean test isolation for local-dev store
  const dataFile = path.resolve('data/morajaws_database.json');
  const hadDataFile = fs.existsSync(dataFile);
  const originalDataBytes = hadDataFile ? fs.readFileSync(dataFile) : null;

  // Dynamic imports after reading baseline
  const serverMod = await import('../server.ts');
  const { createExpressApp, db, SERVER_SESSIONS } = serverMod;

  // Ensure an active installer user exists in db.users for RBAC & role-scope tests
  let installerUser = db.users.find((u: any) => u.role === 'installer' && u.active !== false);
  if (!installerUser) {
    installerUser = {
      id: 'u-test-inst-1',
      name: 'Installer Test Satu',
      username: 'inst_test_1',
      email: 'inst1@test.local',
      role: 'installer',
      contractor: 'PT Test Contractor',
      area: 'Jakarta Selatan',
      active: true,
      passwordHash: 'test-hash',
      createdAt: new Date().toISOString()
    };
    db.users.push(installerUser);
  }

  let superAdminUser = db.users.find((u: any) => u.role === 'super_admin' && u.active !== false && !u.mustChangePassword);
  if (!superAdminUser) {
    superAdminUser = {
      id: 'u-test-sa-1',
      name: 'SuperAdmin Test',
      username: 'sa_test_1',
      email: 'sa1@test.local',
      role: 'super_admin',
      active: true,
      mustChangePassword: false,
      passwordHash: 'test-hash',
      createdAt: new Date().toISOString()
    };
    db.users.push(superAdminUser);
  }

  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 3600_000).toISOString();
  const saToken = 'test-sa-' + crypto.randomBytes(12).toString('hex');
  const instToken = 'test-inst-' + crypto.randomBytes(12).toString('hex');

  SERVER_SESSIONS.push(
    {
      sessionId: 'sess-sa-test',
      token: saToken,
      userId: superAdminUser.id,
      userName: superAdminUser.name,
      role: superAdminUser.role,
      sessionVersion: superAdminUser.sessionVersion || 1,
      status: 'active',
      createdAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: expiresIso
    } as any,
    {
      sessionId: 'sess-inst-test',
      token: instToken,
      userId: installerUser.id,
      userName: installerUser.name,
      role: installerUser.role,
      contractor: installerUser.contractor,
      sessionVersion: installerUser.sessionVersion || 1,
      status: 'active',
      createdAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: expiresIso
    } as any
  );

  const app = await createExpressApp({ skipVite: true, apiOnly: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const authFetch = (urlPath: string, token?: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) || {})
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${baseUrl}${urlPath}`, { ...init, headers });
  };

  try {
    console.log('--- TEST 0: Security / Auth & RBAC ---');
    const unauthRes = await authFetch('/api/supabase/work-orders/bulk-import', undefined, {
      method: 'POST',
      body: JSON.stringify({ tickets: [{ woNumber: 'WO-UNAUTH-01' }] })
    });
    assert.equal(unauthRes.status, 401, 'Unauthenticated bulk-import must return 401');

    const instRes = await authFetch('/api/supabase/work-orders/bulk-import', instToken, {
      method: 'POST',
      body: JSON.stringify({ tickets: [{ woNumber: 'WO-INST-DENIED' }] })
    });
    assert.equal(instRes.status, 403, 'Installer bulk-import must return 403');
    console.log('PASS: Unauthenticated -> 401, Installer RBAC -> 403');

    console.log('--- TEST 1: Single WO Import & Persistence Across Refresh/Re-login ---');
    const singleWo = `WO-TEST-SINGLE-${Date.now()}`;
    const res1 = await authFetch('/api/supabase/work-orders/bulk-import', saToken, {
      method: 'POST',
      body: JSON.stringify({
        batchId: 'batch-single-1',
        tickets: [
          {
            woNumber: singleWo,
            customerId: '1234567',
            customerName: 'Pelanggan Single Uji',
            appointmentDate: '2026-11-25',
            contractor: 'PT Test Contractor',
            area: 'Jakarta Selatan',
            status: 'Pending',
            installerUserId: installerUser.id
          }
        ]
      })
    });
    const body1 = await res1.json();
    assert.equal(res1.status, 200);
    assert.equal(body1.success, true);
    assert.equal(body1.data?.imported, 1);
    assert.deepEqual(body1.data?.importedWoNumbers, [singleWo]);

    // Simulate page refresh / re-login via fresh GET /api/bootstrap & GET /api/sync/delta
    const bootRes = await authFetch('/api/bootstrap', saToken);
    const bootBody = await bootRes.json();
    assert.equal(bootRes.status, 200);
    assert.ok(
      (bootBody.tickets || []).some((t: any) => t.woNumber === singleWo && t.customerName === 'Pelanggan Single Uji'),
      'Imported WO must persist in bootstrap after refresh'
    );
    console.log('PASS: Single WO imported and persisted across bootstrap reload');

    console.log('--- TEST 2: Multiple WOs + In-file & Existing DB Duplicates (No Overwrite) ---');
    const multiWoA = `WO-TEST-MULTI-A-${Date.now()}`;
    const multiWoB = `WO-TEST-MULTI-B-${Date.now()}`;
    const res2 = await authFetch('/api/supabase/work-orders/bulk-import', saToken, {
      method: 'POST',
      body: JSON.stringify({
        batchId: 'batch-multi-1',
        tickets: [
          { woNumber: singleWo, customerName: 'SHOULD NOT OVERWRITE EXISTING', appointmentDate: '2026-11-25' },
          { woNumber: multiWoA, customerId: '7654321', customerName: 'Pelanggan Multi A', appointmentDate: '2026-11-26' },
          { woNumber: ` ${multiWoA.toLowerCase()} `, customerName: 'In-File Duplicate', appointmentDate: '2026-11-26' },
          { woNumber: multiWoB, customerId: '2345678', customerName: 'Pelanggan Multi B', appointmentDate: '2026-11-27' }
        ]
      })
    });
    const body2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(body2.success, true);
    assert.equal(body2.data?.imported, 2);
    assert.equal(body2.data?.skippedDuplicates, 2);
    assert.ok(body2.data?.duplicateExistingWoNumbers.includes(singleWo));
    assert.ok(body2.data?.duplicateInFileWoNumbers.includes(multiWoA));
    const existingSingle = db.tickets.find((t: any) => t.woNumber === singleWo);
    assert.equal(existingSingle.customerName, 'Pelanggan Single Uji', 'Existing WO must NOT be overwritten');
    console.log('PASS: Multi-WO import + in-file/DB duplicate detection without overwriting old WOs');

    console.log('--- TEST 3: Invalid Data Rejection (Empty, Null, Invalid Date, Numeric WO, Empty Array) ---');
    const emptyArrRes = await authFetch('/api/supabase/work-orders/bulk-import', saToken, {
      method: 'POST',
      body: JSON.stringify({ tickets: [] })
    });
    assert.equal(emptyArrRes.status, 400);

    const invalidDateOnlyRes = await authFetch('/api/supabase/work-orders/bulk-import', saToken, {
      method: 'POST',
      body: JSON.stringify({
        tickets: [
          { woNumber: 'WO-BAD-DATE-1', customerName: 'Bad Date', appointmentDate: '2026-02-31' },
          { woNumber: '', customerName: 'Empty WO' },
          null
        ]
      })
    });
    const invalidDateBody = await invalidDateOnlyRes.json();
    assert.equal(invalidDateOnlyRes.status, 400);
    assert.equal(invalidDateBody.success, false);
    assert.equal(invalidDateBody.data?.imported, 0);
    assert.equal(invalidDateBody.data?.invalidCount, 3);

    // Numeric WO coercion should normalize cleanly to string WO
    const numWo = String(99887766 + (Date.now() % 10000));
    const numRes = await authFetch('/api/supabase/work-orders/bulk-import', saToken, {
      method: 'POST',
      body: JSON.stringify({
        tickets: [{ woNumber: Number(numWo), customerName: 'Numeric WO', appointmentDate: '2026-11-28' }]
      })
    });
    const numBody = await numRes.json();
    assert.equal(numRes.status, 200);
    assert.deepEqual(numBody.data?.importedWoNumbers, [numWo]);
    console.log('PASS: Invalid payloads rejected cleanly with 400; numeric WO normalized');

    console.log('--- TEST 4: Client supabaseDb.batchCreateWorkOrders Chunking & Partial Chunk Failure ---');
    // Minimal browser shims for testing src/services/supabaseDb.ts directly in Node
    const storageMap = new Map<string, string>();
    (globalThis as any).window = Object.assign(globalThis, {
      addEventListener: () => {},
      removeEventListener: () => {}
    });
    (globalThis as any).localStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, String(v)),
      removeItem: (k: string) => storageMap.delete(k)
    };
    storageMap.set('morajaws_auth_session', JSON.stringify({ token: saToken }));

    const realFetch = globalThis.fetch;
    let callIdx = 0;
    const partialWoOk = `WO-CHUNK-OK-${Date.now()}`;
    const partialWoFail = `WO-CHUNK-FAIL-${Date.now()}`;
    (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/supabase/work-orders/bulk-import')) {
        callIdx++;
        if (callIdx === 2) {
          return new Response(JSON.stringify({ success: false, error: 'Simulated chunk 2 DB timeout' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return realFetch(`${baseUrl}${url}`, init);
      }
      return realFetch(url.startsWith('http') ? url : `${baseUrl}${url}`, init);
    };

    const { supabaseDb } = await import('../src/services/supabaseDb.ts');
    // Force chunkSize=10 minimum (clamp is 10..100), so send 12 tickets -> chunk 1 (10 WOs) succeeds, chunk 2 (2 WOs) fails
    const chunk1Tickets = Array.from({ length: 10 }, (_, idx) => ({
      id: `id-c1-${idx}`,
      woNumber: `${partialWoOk}-${idx}`,
      customerName: `Chunk1 User ${idx}`,
      appointmentDate: '2026-11-29'
    }));
    const chunk2Tickets = [
      { id: 'id-c2-0', woNumber: `${partialWoFail}-0`, customerName: 'Chunk2 Fail 0', appointmentDate: '2026-11-29' },
      { id: 'id-c2-1', woNumber: `${partialWoFail}-1`, customerName: 'Chunk2 Fail 1', appointmentDate: '2026-11-29' }
    ];
    const batchRes = await supabaseDb.batchCreateWorkOrders(
      [...chunk1Tickets, ...chunk2Tickets] as any,
      'batch-partial-test',
      false,
      { chunkSize: 10 }
    );
    (globalThis as any).fetch = realFetch;

    assert.equal(batchRes.partialSuccess, true, 'Must flag partialSuccess when chunk 1 succeeds and chunk 2 fails');
    assert.equal(batchRes.success, false, 'Overall success must be false when chunk 2 fails');
    assert.equal(batchRes.data?.imported, 10, 'All 10 chunk-1 WOs must remain counted as imported');
    assert.equal(batchRes.data?.failedCount, 2, 'Both chunk-2 WOs must be reported as failedCount');
    assert.equal(batchRes.data?.importedWoNumbers.length, 10);
    assert.deepEqual(batchRes.data?.failedWoNumbers, [`${partialWoFail}-0`, `${partialWoFail}-1`]);
    assert.ok(db.tickets.some((t: any) => t.woNumber === `${partialWoOk}-0`), 'Succeeded chunk 1 WOs must persist in store');
    assert.ok(!db.tickets.some((t: any) => t.woNumber === `${partialWoFail}-0`), 'Failed chunk 2 WOs must not falsely exist');
    console.log('PASS: Chunked batchCreateWorkOrders preserves chunk 1 on chunk 2 failure & reports exact failedWoNumbers');

    console.log('--- TEST 5: Vercel Serverless Realtime Mode & Delta Sync Role Scoping ---');
    const prevVercel = process.env.VERCEL;
    process.env.VERCEL = '1';

    const statusRes = await authFetch('/api/realtime/status', saToken);
    const statusBody = await statusRes.json();
    assert.equal(statusRes.status, 200);
    assert.equal(statusBody.runtimeMode, 'serverless');
    assert.equal(statusBody.sseSupported, false);
    assert.equal(statusBody.recommendedTransport, 'delta_polling');
    assert.equal(statusBody.recommendedPollMs, 15000);

    // Also verify client supabaseDb.subscribeToChanges negotiates delta_polling without opening EventSource loop
    (globalThis as any).fetch = (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      return realFetch(url.startsWith('http') ? url : `${baseUrl}${url}`, init);
    };
    let receivedEvents = 0;
    const unsubRt = supabaseDb.subscribeToChanges({
      table: 'work_orders',
      onPayload: () => {
        receivedEvents++;
      }
    });
    await new Promise(r => setTimeout(r, 200));
    const rtInfo = supabaseDb.getRealtimeStatus();
    assert.equal(rtInfo.transport, 'delta_polling', 'Client realtime must stay in delta_polling mode under Vercel serverless');
    assert.equal(rtInfo.state, 'connected', 'Delta polling fallback state must be connected');
    supabaseDb.dispatchExternalRealtimeEvent({
      table: 'work_orders',
      eventType: 'UPDATE',
      record: { woNumber: singleWo }
    });
    assert.equal(receivedEvents, 1, 'External delta sync event must trigger subscribeToChanges onPayload listeners');
    supabaseDb.setDeltaPollingSyncOutcome(false, { error: 'Transient 503', attempt: 1 });
    assert.equal(supabaseDb.getRealtimeStatus().state, 'reconnecting');
    supabaseDb.setDeltaPollingSyncOutcome(true);
    assert.equal(supabaseDb.getRealtimeStatus().state, 'connected');
    unsubRt();
    (globalThis as any).fetch = realFetch;

    const streamStart = Date.now();
    const streamRes = await authFetch('/api/supabase/realtime/stream', saToken);
    const streamText = await streamRes.text();
    const streamElapsed = Date.now() - streamStart;
    assert.equal(streamRes.status, 200);
    assert.ok(streamElapsed < 1500, `Serverless SSE endpoint must end immediately (<1500ms), took ${streamElapsed}ms`);
    assert.ok(streamText.includes('SERVERLESS_DELTA_MODE'), 'Stream must instruct client to use delta polling');

    // Delta sync as super_admin vs installer role scope check
    const deltaSaRes = await authFetch('/api/sync/delta?since=2020-01-01T00:00:00Z', saToken);
    const deltaSaBody = await deltaSaRes.json();
    assert.equal(deltaSaRes.status, 200);
    assert.equal(deltaSaBody.realtimeTransport, 'delta_polling');
    assert.equal(deltaSaBody.sseSupported, false);
    assert.ok(deltaSaBody.tickets.some((t: any) => t.woNumber === singleWo));
    assert.ok(deltaSaBody.tickets.some((t: any) => t.woNumber === multiWoA));

    const deltaInstRes = await authFetch('/api/sync/delta?since=2020-01-01T00:00:00Z', instToken);
    const deltaInstBody = await deltaInstRes.json();
    assert.equal(deltaInstRes.status, 200);
    assert.ok(
      deltaInstBody.tickets.some((t: any) => t.woNumber === singleWo),
      'Installer must see WO assigned to their installerUserId'
    );
    assert.ok(
      !deltaInstBody.tickets.some((t: any) => t.woNumber === multiWoA),
      'Installer must NOT receive unassigned / other WOs via delta sync'
    );

    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    console.log(`PASS: Vercel serverless realtime closed in ${streamElapsed}ms with delta_polling + scoped delta sync verified`);

    console.log('--- TEST 6: Vercel Bundled Entrypoint Import Sanity (api/_server.mjs) ---');
    const bundledMod = await import('../api/_server.mjs');
    assert.equal(typeof bundledMod.default, 'function', 'api/_server.mjs must export default Vercel handler');
    console.log('PASS: api/_server.mjs imports cleanly in Node without vite/missing module errors');

    console.log('\nALL VERIFICATION TESTS PASSED!');
  } finally {
    server.close();
    // Restore original data/morajaws_database.json state cleanly
    if (hadDataFile && originalDataBytes) {
      fs.writeFileSync(dataFile, originalDataBytes);
    } else if (!hadDataFile && fs.existsSync(dataFile)) {
      fs.unlinkSync(dataFile);
    }
  }
}

main().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
