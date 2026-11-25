import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from './supabaseClient.ts';
import {
  deleteWorkOrderFromSupabase,
  restoreWorkOrderInSupabase,
  getDeletedWorkOrdersFromSupabase,
  getWorkOrderByWoNumberFromSupabase
} from './supabaseAdapter.ts';

/**
 * Lightweight in-memory Supabase query builder mock for testing DAL behavior
 * (never performs real remote writes and explicitly fails if .delete() is invoked on work_orders).
 */
function createMockSupabaseClient(seed: {
  work_orders?: any[];
  assignment_history?: any[];
  ticket_messages?: any[];
  file_attachments?: any[];
}) {
  const tables: Record<string, any[]> = {
    work_orders: [...(seed.work_orders || [])],
    assignment_history: [...(seed.assignment_history || [])],
    ticket_messages: [...(seed.ticket_messages || [])],
    file_attachments: [...(seed.file_attachments || [])]
  };
  const operations: Array<{ table: string; op: string; payload?: any }> = [];

  const matchIlk = (val: any, pat: string) => {
    const clean = String(pat || '').replace(/%/g, '').toLowerCase();
    return String(val ?? '').toLowerCase() === clean || String(val ?? '').toLowerCase().includes(clean);
  };

  function makeBuilder(table: string) {
    let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
    let updatePayload: any = null;
    let insertPayload: any = null;
    const filters: Array<(row: any) => boolean> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitCount: number | null = null;

    const execute = async (): Promise<{ data: any; error: any }> => {
      const rows = tables[table] || [];
      if (op === 'delete') {
        operations.push({ table, op: 'delete' });
        if (table === 'work_orders') {
          throw new Error('PHYSICAL_DELETE_FORBIDDEN_ON_WORK_ORDERS');
        }
        return { data: [], error: null };
      }

      if (op === 'update') {
        operations.push({ table, op: 'update', payload: updatePayload });
        const updated: any[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (filters.every(fn => fn(rows[i]))) {
            rows[i] = { ...rows[i], ...updatePayload };
            updated.push(rows[i]);
          }
        }
        return { data: updated, error: null };
      }

      if (op === 'insert') {
        operations.push({ table, op: 'insert', payload: insertPayload });
        const items = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
        rows.push(...items);
        return { data: items, error: null };
      }

      let result = rows.filter(r => filters.every(fn => fn(r)));
      if (orderCol) {
        result = [...result].sort((a, b) => {
          const av = a[orderCol!] ?? '';
          const bv = b[orderCol!] ?? '';
          const cmp = String(av).localeCompare(String(bv));
          return orderAsc ? cmp : -cmp;
        });
      }
      if (limitCount !== null) {
        result = result.slice(0, limitCount);
      }
      return { data: result, error: null };
    };

    const builder: any = {
      select() {
        return builder;
      },
      update(payload: any) {
        op = 'update';
        updatePayload = payload;
        return builder;
      },
      insert(payload: any) {
        op = 'insert';
        insertPayload = payload;
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      eq(col: string, val: any) {
        filters.push(row => row?.[col] === val);
        return builder;
      },
      neq(col: string, val: any) {
        filters.push(row => row?.[col] !== val);
        return builder;
      },
      ilike(col: string, val: string) {
        filters.push(row => matchIlk(row?.[col], val));
        return builder;
      },
      or(expr: string) {
        const clauses = expr.split(',').map(s => s.trim()).filter(Boolean);
        filters.push(row =>
          clauses.some(cl => {
            const m = cl.match(/^([^.]+)\.ilike\.%(.*)%$/);
            if (!m) return false;
            return String(row?.[m[1]] ?? '').toLowerCase().includes(m[2].toLowerCase());
          })
        );
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
      async maybeSingle() {
        const res = await execute();
        return { data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data, error: res.error };
      },
      then(onFulfilled: any, onRejected: any) {
        return execute().then(onFulfilled, onRejected);
      }
    };
    return builder;
  }

  return {
    tables,
    operations,
    client: {
      from(table: string) {
        return makeBuilder(table);
      }
    }
  };
}

test('Supabase DAL Soft Delete & Restore preserves related records, blocks duplicate restore, and never calls physical DELETE', async () => {
  const mock = createMockSupabaseClient({
    work_orders: [
      {
        id: 'wo-dal-1',
        wo_number: 'WO-DAL-1001',
        customer_name: 'Pelanggan DAL 1',
        contractor_name: 'PT Alpha',
        contactor_name: 'PT Alpha',
        area: 'Jakarta Selatan',
        installer_name: 'Budi',
        installer_user_id: 'u-inst-1',
        is_deleted: false,
        is_archived: false,
        created_at: '2026-11-24T08:00:00.000Z',
        updated_at: '2026-11-24T08:00:00.000Z'
      }
    ],
    assignment_history: [
      { id: 'ah-1', work_order_id: 'wo-dal-1', installer_name: 'Budi', action: 'ASSIGN' }
    ],
    ticket_messages: [
      { id: 'msg-1', ticket_id: 'wo-dal-1', text: 'Mohon update progres lapangan' }
    ],
    file_attachments: [
      { id: 'att-1', ticket_id: 'wo-dal-1', file_name: 'foto.jpg' }
    ]
  });

  setSupabaseBackendClientForTesting(mock.client);
  try {
    // 1. Soft delete via Supabase adapter
    const delRes = await deleteWorkOrderFromSupabase('wo-dal-1', 'Duplikasi input vendor', 'Superadmin Uji');
    assert.equal(delRes.success, true);
    assert.equal(delRes.data?.isDeleted, true);
    assert.equal(delRes.data?.deletedBy, 'Superadmin Uji');
    assert.equal(delRes.data?.deletionReason, 'Duplikasi input vendor');
    assert.ok(delRes.data?.deletedAt);

    // Confirm ZERO .delete() calls were executed anywhere
    assert.equal(mock.operations.some(o => o.op === 'delete'), false);
    assert.equal(mock.tables.work_orders.length, 1);
    assert.equal(mock.tables.assignment_history.length, 1);
    assert.equal(mock.tables.ticket_messages.length, 1);
    assert.equal(mock.tables.file_attachments.length, 1);

    // 2. Active WO lookup excludes soft-deleted WO by default
    const activeLookup = await getWorkOrderByWoNumberFromSupabase('WO-DAL-1001');
    assert.equal(activeLookup.success, true);
    assert.equal(activeLookup.data, null);

    // 3. Deleted list returns the soft-deleted WO
    const deletedList = await getDeletedWorkOrdersFromSupabase({ search: 'WO-DAL-1001' });
    assert.equal(deletedList.success, true);
    assert.equal(deletedList.data?.length, 1);
    assert.equal(deletedList.data?.[0].id, 'wo-dal-1');

    // 4. Simulate re-import of the same WO number while old row is soft-deleted, then verify restore returns conflict
    mock.tables.work_orders.push({
      id: 'wo-dal-2',
      wo_number: 'WO-DAL-1001',
      customer_name: 'Pelanggan Reimport',
      is_deleted: false,
      is_archived: false,
      created_at: '2026-11-25T08:00:00.000Z',
      updated_at: '2026-11-25T08:00:00.000Z'
    });
    const conflictRestore = await restoreWorkOrderInSupabase('wo-dal-1', 'Superadmin Uji');
    assert.equal(conflictRestore.success, false);
    assert.equal(conflictRestore.error?.code, 'DUPLICATE_ACTIVE_WO');
    assert.equal(conflictRestore.error?.isDuplicate, true);

    // 5. Mark active conflict row soft-deleted and restore original wo-dal-1 cleanly
    mock.tables.work_orders[1].is_deleted = true;
    const restoreRes = await restoreWorkOrderInSupabase('wo-dal-1', 'Superadmin Uji');
    assert.equal(restoreRes.success, true);
    assert.equal(restoreRes.data?.isDeleted, false);
    assert.equal(restoreRes.data?.deletedAt, undefined);
    assert.equal(restoreRes.data?.deletedBy, undefined);
    assert.equal(restoreRes.data?.installerName, 'Budi');
    assert.equal(restoreRes.data?.area, 'Jakarta Selatan');

    const restoredLookup = await getWorkOrderByWoNumberFromSupabase('WO-DAL-1001');
    assert.equal(restoredLookup.success, true);
    assert.equal(restoredLookup.data?.id, 'wo-dal-1');
  } finally {
    resetSupabaseBackendClientForTesting();
  }
});

test('Migration 021 enforces partial unique index without CASCADE or destructive SQL', () => {
  const rawSql = fs.readFileSync(
    path.resolve('migrations/021_soft_delete_wo_number_partial_unique_index.sql'),
    'utf8'
  );
  // Strip SQL single-line comments before scanning executable DDL/DML
  const sql = rawSql
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
  assert.match(sql, /CREATE UNIQUE INDEX uq_work_orders_wo_number_normalized/i);
  assert.match(sql, /COALESCE\(is_deleted,\s*false\)\s*=\s*false/i);
  assert.match(sql, /morajaws_find_existing_wo_numbers/i);
  assert.match(sql, /morajaws_commit_import_batch_atomic/i);
  assert.equal(/ON\s+DELETE\s+CASCADE/i.test(sql), false, 'Must NEVER use ON DELETE CASCADE');
  assert.equal(/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(sql), false, 'Must NEVER contain destructive table drops/deletes');
});

test('End-to-End Soft Delete & Restore across all 8 mandatory scenarios + re-import conflict checks', async () => {
  const dataFile = path.resolve('data/morajaws_database.json');
  const hadDataFile = fs.existsSync(dataFile);
  const originalDataBytes = hadDataFile ? fs.readFileSync(dataFile) : null;

  resetSupabaseBackendClientForTesting();
  const serverMod = await import('../server.ts');
  const { createExpressApp, db, SERVER_SESSIONS } = serverMod;

  const mkUser = (
    id: string,
    name: string,
    role: 'super_admin' | 'dispatch' | 'leader' | 'installer',
    extra: Record<string, any> = {}
  ) => {
    let user = db.users.find((u: any) => u.id === id);
    if (!user) {
      user = {
        id,
        name,
        username: id,
        email: `${id}@test.local`,
        role,
        active: true,
        mustChangePassword: false,
        passwordHash: 'test-hash',
        createdAt: new Date().toISOString(),
        ...extra
      };
      db.users.push(user);
    }
    return user;
  };

  const superAdmin = mkUser('u-sd-sa', 'SuperAdmin SoftDel', 'super_admin');
  const dispatchUser = mkUser('u-sd-disp', 'Dispatch SoftDel', 'dispatch');
  const leaderUser = mkUser('u-sd-ldr', 'Leader SoftDel', 'leader', {
    contractor: 'PT Mitra Uji',
    area: 'Jakarta Selatan'
  });
  const installerUser = mkUser('u-sd-inst', 'Installer SoftDel', 'installer', {
    contractor: 'PT Mitra Uji',
    area: 'Jakarta Selatan'
  });

  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 3600_000).toISOString();
  const makeToken = (u: any) => {
    const token = `tok-${u.role}-${crypto.randomBytes(8).toString('hex')}`;
    SERVER_SESSIONS.push({
      sessionId: `sess-${u.id}-${Date.now()}`,
      token,
      userId: u.id,
      userName: u.name,
      role: u.role,
      contractor: u.contractor,
      area: u.area,
      sessionVersion: u.sessionVersion || 1,
      status: 'active',
      createdAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: expiresIso
    } as any);
    return token;
  };

  const saToken = makeToken(superAdmin);
  const dispToken = makeToken(dispatchUser);
  const ldrToken = makeToken(leaderUser);
  const instToken = makeToken(installerUser);

  const app = await createExpressApp({ skipVite: true, apiOnly: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const reqJson = (urlPath: string, token?: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) || {})
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${baseUrl}${urlPath}`, { ...init, headers });
  };

  try {
    const woNumber = `WO-SD-TEST-${Date.now()}`;
    const woId = `wo_sd_${Date.now()}`;

    // Seed WO via bulk import
    const impRes = await reqJson('/api/supabase/work-orders/bulk-import', saToken, {
      method: 'POST',
      body: JSON.stringify({
        batchId: 'batch-sd-1',
        tickets: [
          {
            id: woId,
            woNumber,
            customerId: '7788990',
            customerName: 'Pelanggan Uji Soft Delete',
            appointmentDate: '2026-11-25',
            contractor: 'PT Mitra Uji',
            contractorName: 'PT Mitra Uji',
            contactorName: 'PT Mitra Uji',
            area: 'Jakarta Selatan',
            leaderName: leaderUser.name,
            statusWOAgent: 'Pending',
            statusWOInstaller: 'Assigned',
            installerId: installerUser.id,
            installerUserId: installerUser.id,
            installerName: installerUser.name
          }
        ]
      })
    });
    assert.equal(impRes.status, 200);
    const createdTicket = db.tickets.find((t: any) => t.woNumber === woNumber);
    assert.ok(createdTicket, 'Seeded ticket must exist in store');
    const targetId = createdTicket.id;

    // Seed assignment_history and ticket_messages (LiveChat) referencing this WO
    const historyEntry = {
      id: `ah-sd-${Date.now()}`,
      workOrderId: targetId,
      ticketId: targetId,
      woNumber,
      action: 'ASSIGNED',
      previousInstallerName: '',
      newInstallerName: installerUser.name,
      newInstallerId: installerUser.id,
      changedBy: leaderUser.name,
      changedByRole: 'leader',
      reason: 'Penugasan awal lapangan',
      timestamp: nowIso
    };
    db.assignmentHistory.push(historyEntry);
    createdTicket.assignmentHistory = [historyEntry];

    const chatRes = await reqJson(`/api/tickets/${encodeURIComponent(targetId)}/messages`, instToken, {
      method: 'POST',
      body: JSON.stringify({
        text: 'Pesan LiveChat uji sebelum soft delete',
        category: 'PROGRESS'
      })
    });
    assert.ok(chatRes.status === 200 || chatRes.status === 201, `Pre-delete LiveChat message must succeed, got ${chatRes.status}`);

    // Scenario 8: Unauthorized delete & restore MUST be rejected with 401/403
    for (const [roleLabel, tok] of [
      ['unauthenticated', undefined],
      ['dispatch', dispToken],
      ['leader', ldrToken],
      ['installer', instToken]
    ] as const) {
      const denyDel = await reqJson(`/api/supabase/work-orders/${encodeURIComponent(targetId)}`, tok, {
        method: 'DELETE',
        body: JSON.stringify({ reason: 'Unauthorized delete try' })
      });
      assert.equal(denyDel.status, tok ? 403 : 401, `${roleLabel} DELETE supabase WO must be denied`);

      const denyLegacyDel = await reqJson(`/api/tickets/${encodeURIComponent(targetId)}?permanent=true`, tok, {
        method: 'DELETE',
        body: JSON.stringify({ reason: 'Unauthorized legacy delete try' })
      });
      assert.equal(denyLegacyDel.status, tok ? 403 : 401, `${roleLabel} DELETE /api/tickets must be denied`);

      const denyRestore = await reqJson(`/api/supabase/work-orders/${encodeURIComponent(targetId)}/restore`, tok, {
        method: 'POST',
        body: JSON.stringify({})
      });
      assert.equal(denyRestore.status, tok ? 403 : 401, `${roleLabel} restore must be denied`);

      const denyDeletedList = await reqJson('/api/supabase/work-orders/deleted', tok);
      assert.equal(denyDeletedList.status, tok ? 403 : 401, `${roleLabel} deleted list must be denied`);
    }

    // Scenarios 1 & 2: Superadmin soft delete with assignment_history + ticket_messages (even with spoofed deletedBy)
    const delRes = await reqJson(`/api/supabase/work-orders/${encodeURIComponent(targetId)}`, saToken, {
      method: 'DELETE',
      body: JSON.stringify({
        reason: 'Uji soft delete FK assignment_history dan ticket_messages',
        deletedBy: 'Spoofed Actor Name'
      })
    });
    assert.equal(delRes.status, 200);
    const delBody = await delRes.json();
    assert.equal(delBody.success, true);
    assert.equal(delBody.data?.isDeleted, true);
    assert.equal(delBody.data?.deletedBy, superAdmin.name, 'Backend must enforce authoritative req.user.name');
    assert.ok(delBody.data?.deletedAt);

    // Ensure physical row STILL exists in db.tickets with isDeleted = true
    const rawAfterDelete = db.tickets.find((t: any) => t.id === targetId);
    assert.ok(rawAfterDelete, 'WO row must NOT be physically deleted');
    assert.equal(rawAfterDelete.isDeleted, true);

    // Also verify legacy DELETE /api/tickets/:id?permanent=true never removes physically
    const legacyDelRes = await reqJson(`/api/tickets/${encodeURIComponent(targetId)}?permanent=true`, saToken, {
      method: 'DELETE',
      body: JSON.stringify({ reason: 'Verify permanent flag still soft-deletes only' })
    });
    assert.equal(legacyDelRes.status, 200);
    assert.ok(db.tickets.find((t: any) => t.id === targetId), 'Legacy permanent=true must NEVER splice row');

    // Scenario 3: Active dashboards/portals/APIs exclude deleted WO across ALL roles
    for (const [roleLabel, tok] of [
      ['super_admin', saToken],
      ['dispatch', dispToken],
      ['leader', ldrToken],
      ['installer', instToken]
    ] as const) {
      const bootRes = await reqJson('/api/bootstrap', tok);
      const bootBody = await bootRes.json();
      assert.equal(
        (bootBody.tickets || []).some((t: any) => t.id === targetId),
        false,
        `${roleLabel} /api/bootstrap must exclude soft-deleted WO`
      );

      const supaListRes = await reqJson('/api/supabase/work-orders', tok);
      const supaListBody = await supaListRes.json();
      assert.equal(
        (supaListBody.data || []).some((t: any) => t.id === targetId),
        false,
        `${roleLabel} /api/supabase/work-orders must exclude soft-deleted WO`
      );

      const ticketsListRes = await reqJson('/api/tickets', tok);
      const ticketsListBody = await ticketsListRes.json();
      const arr = Array.isArray(ticketsListBody) ? ticketsListBody : ticketsListBody.tickets || [];
      assert.equal(
        arr.some((t: any) => t.id === targetId),
        false,
        `${roleLabel} /api/tickets must exclude soft-deleted WO`
      );
    }

    // Delta sync reports deleted ID & excludes from active tickets array
    const deltaDeletedRes = await reqJson('/api/sync/delta?since=2020-01-01T00:00:00Z', saToken);
    const deltaDeletedBody = await deltaDeletedRes.json();
    assert.ok(deltaDeletedBody.deletedIds.includes(targetId), 'Delta sync must include deletedId');
    assert.equal(deltaDeletedBody.tickets.some((t: any) => t.id === targetId), false);

    // Block mutations & new chat posts against soft-deleted WO
    const blockedPatch = await reqJson(`/api/supabase/work-orders/${encodeURIComponent(targetId)}`, saToken, {
      method: 'PATCH',
      body: JSON.stringify({ customerName: 'Should Fail' })
    });
    assert.equal(blockedPatch.status, 409);

    const blockedChat = await reqJson(`/api/tickets/${encodeURIComponent(targetId)}/messages`, saToken, {
      method: 'POST',
      body: JSON.stringify({ text: 'Should fail on soft deleted WO' })
    });
    assert.equal(blockedChat.status, 409);

    // Scenario 4 & 5: assignment_history & ticket_messages remain intact and readable
    const ahRes = await reqJson(`/api/assignment-history?ticketId=${encodeURIComponent(targetId)}`, saToken);
    assert.equal(ahRes.status, 200);
    const ahBody = await ahRes.json();
    assert.ok(
      (ahBody.history || ahBody.data || []).some((h: any) => h.id === historyEntry.id),
      'assignment_history must stay intact after soft delete'
    );

    const msgRes = await reqJson(`/api/tickets/${encodeURIComponent(targetId)}/messages`, saToken);
    assert.equal(msgRes.status, 200);
    const msgBody = await msgRes.json();
    const messages = msgBody.messages || msgBody.data || [];
    assert.ok(
      messages.some((m: any) => m.text === 'Pesan LiveChat uji sebelum soft delete'),
      'LiveChat messages must stay intact after soft delete'
    );

    // Superadmin deleted-list endpoint finds it
    const deletedListRes = await reqJson(`/api/supabase/work-orders/deleted?search=${encodeURIComponent(woNumber)}`, saToken);
    assert.equal(deletedListRes.status, 200);
    const deletedListBody = await deletedListRes.json();
    assert.equal(deletedListBody.data?.length, 1);
    assert.equal(deletedListBody.data?.[0].id, targetId);

    // Scenario 6 & 7: Restore WO & verify it reappears across active portals & installer assignment remains intact
    const restoreRes = await reqJson(`/api/supabase/work-orders/${encodeURIComponent(targetId)}/restore`, saToken, {
      method: 'POST',
      body: JSON.stringify({})
    });
    assert.equal(restoreRes.status, 200);
    const restoreBody = await restoreRes.json();
    assert.equal(restoreBody.success, true);
    assert.equal(restoreBody.data?.isDeleted, false);
    assert.equal(restoreBody.data?.deletedAt, undefined);
    assert.equal(restoreBody.data?.deletedBy, undefined);
    assert.equal(restoreBody.data?.installerId, installerUser.id);

    const postRestoreDeletedListRes = await reqJson(`/api/supabase/work-orders/deleted?search=${encodeURIComponent(woNumber)}`, saToken);
    const postRestoreDeletedBody = await postRestoreDeletedListRes.json();
    assert.equal(postRestoreDeletedBody.data?.length, 0, 'Restored WO must leave deleted list');

    for (const [roleLabel, tok] of [
      ['super_admin', saToken],
      ['dispatch', dispToken],
      ['leader', ldrToken],
      ['installer', instToken]
    ] as const) {
      const bootRes = await reqJson('/api/bootstrap', tok);
      const bootBody = await bootRes.json();
      assert.equal(
        (bootBody.tickets || []).some((t: any) => t.id === targetId && !t.isDeleted),
        true,
        `${roleLabel} /api/bootstrap must show restored WO again`
      );
    }

    // Re-import test: soft delete again, re-import same WO number -> succeeds without overwriting old deleted record or breaking FK,
    // and verify restoring old deleted row returns 409 DUPLICATE_ACTIVE_WO conflict
    const secondDel = await reqJson(`/api/supabase/work-orders/${encodeURIComponent(targetId)}`, saToken, {
      method: 'DELETE',
      body: JSON.stringify({ reason: 'Uji re-import nomor WO sama' })
    });
    assert.equal(secondDel.status, 200);

    const reimportRes = await reqJson('/api/supabase/work-orders/bulk-import', saToken, {
      method: 'POST',
      body: JSON.stringify({
        batchId: 'batch-reimport-sd',
        tickets: [
          {
            woNumber,
            customerId: '7788990',
            customerName: 'Pelanggan Reimport Baru',
            appointmentDate: '2026-11-26',
            contractor: 'PT Mitra Uji',
            area: 'Jakarta Selatan'
          }
        ]
      })
    });
    assert.equal(reimportRes.status, 200);
    const reimportBody = await reimportRes.json();
    assert.equal(reimportBody.data?.imported, 1, 'Re-importing soft-deleted WO number must succeed');

    const conflictRestoreRes = await reqJson(`/api/supabase/work-orders/${encodeURIComponent(targetId)}/restore`, saToken, {
      method: 'POST',
      body: JSON.stringify({})
    });
    assert.equal(conflictRestoreRes.status, 409, 'Restoring soft-deleted WO when active WO with same number exists must return 409');
  } finally {
    server.close();
    if (hadDataFile && originalDataBytes) {
      fs.writeFileSync(dataFile, originalDataBytes);
    } else if (!hadDataFile && fs.existsSync(dataFile)) {
      fs.unlinkSync(dataFile);
    }
  }
});
