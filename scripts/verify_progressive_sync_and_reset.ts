import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// Isolate strictly from production Supabase
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.VITE_SUPABASE_URL;
process.env.ALLOW_LOCAL_JSON_MODE = 'true';
process.env.NODE_ENV = 'test';

const DB_FILE_PATH = path.join(process.cwd(), 'data', 'morajaws_database.json');
const hadExistingDbFile = fs.existsSync(DB_FILE_PATH);
const originalDbBackup = hadExistingDbFile ? fs.readFileSync(DB_FILE_PATH, 'utf-8') : null;

async function jsonReq(
  baseUrl: string,
  method: string,
  route: string,
  options?: { token?: string; body?: any }
): Promise<{ status: number; headers: Headers; body: any; rawText: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const rawText = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = rawText;
  }
  return { status: res.status, headers: res.headers, body, rawText };
}

async function runVerification() {
  const results: Array<{ name: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, status: 'PASS' });
      console.log(`✅ PASS: ${name}`);
    } catch (err: any) {
      results.push({ name, status: 'FAIL', detail: err?.message || String(err) });
      console.error(`❌ FAIL: ${name} ->`, err);
      throw err;
    }
  };

  let server: http.Server | null = null;
  try {
    const serverMod = await import('../server.ts');
    const authMod = await import('../server/customAuthService.ts');
    const { createExpressApp } = serverMod;
    const { hashPasswordWithBcrypt } = authMod;

    const app = await createExpressApp({ skipVite: true });
    const db = serverMod.db;
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind ephemeral HTTP port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Seed clean ephemeral test users across all 6 roles + today WOs
    const todayWIB = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    const strongInitPass = 'Mora2026';
    const strongHash = await hashPasswordWithBcrypt(strongInitPass);
    const nowIso = new Date().toISOString();

    db.users = ([
      {
        id: 'test-sa-1',
        name: 'Super Admin Test',
        username: 'test_superadmin',
        email: 'test_sa@morajaws.local',
        role: 'super_admin',
        active: true,
        passwordHash: strongHash,
        mustChangePassword: true,
        sessionVersion: 1,
        passwordHistoryHashes: [strongHash],
        createdAt: nowIso
      },
      {
        id: 'test-disp-1',
        name: 'Dispatch Test',
        username: 'test_dispatch',
        email: 'test_disp@morajaws.local',
        role: 'dispatch',
        active: true,
        passwordHash: strongHash,
        mustChangePassword: false,
        sessionVersion: 1,
        passwordHistoryHashes: [strongHash],
        createdAt: nowIso
      },
      {
        id: 'test-lead-1',
        name: 'Leader MJS Test',
        username: 'test_leader',
        email: 'test_leader@morajaws.local',
        role: 'leader',
        contractor: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        active: true,
        passwordHash: strongHash,
        mustChangePassword: false,
        sessionVersion: 1,
        passwordHistoryHashes: [strongHash],
        createdAt: nowIso
      },
      {
        id: 'test-inst-1',
        name: 'Budi Teknisi',
        username: 'test_installer',
        email: 'test_inst@morajaws.local',
        role: 'installer',
        contractor: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        active: true,
        passwordHash: strongHash,
        mustChangePassword: false,
        sessionVersion: 1,
        passwordHistoryHashes: [strongHash],
        createdAt: nowIso
      },
      {
        id: 'test-mgmt-1',
        name: 'Mgmt Data Test',
        username: 'test_mgmt',
        email: 'test_mgmt@morajaws.local',
        role: 'management_data',
        active: true,
        passwordHash: strongHash,
        mustChangePassword: false,
        sessionVersion: 1,
        passwordHistoryHashes: [strongHash],
        createdAt: nowIso
      },
      {
        id: 'test-it-1',
        name: 'IT Support Test',
        username: 'test_itsupport',
        email: 'test_it@morajaws.local',
        role: 'it_support',
        active: true,
        passwordHash: strongHash,
        mustChangePassword: false,
        sessionVersion: 1,
        passwordHistoryHashes: [strongHash],
        createdAt: nowIso
      }
    ] as any[]);

    db.tickets = [
      {
        id: 'wo-test-1',
        woNumber: 'WO-TEST-001',
        idCustomer: 'CUST-1001',
        customerName: 'Pelanggan Selatan Satu',
        appointmentDate: todayWIB,
        slotTime: '09:00-11:00',
        area: 'Jakarta Selatan',
        clusterName: 'Kemang Timur',
        contactorName: 'PT Mitra Jaringan Solusi',
        contractorName: 'PT Mitra Jaringan Solusi',
        leaderName: 'Leader MJS Test',
        installerName: 'Budi Teknisi',
        assignedTo: 'test-inst-1',
        statusWOAgent: 'In Progress',
        statusWOInstaller: 'On Site',
        statusWhatsApp: 'confirmed',
        approvalStatus: 'NONE',
        oltCode: 'OLT-JKS-01',
        fdtCode: 'FDT-01',
        fatCode: 'FAT-101',
        customerSignatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
        technicalReport: {
          workResult: 'DONE',
          deviceSerialNumber: 'SN-ONT-123456',
          photoBeforeUrl: 'data:image/png;base64,BEFORE_HEAVY_PAYLOAD',
          photoAfterUrl: 'data:image/png;base64,AFTER_HEAVY_PAYLOAD',
          photos: ['data:image/png;base64,EXTRA_HEAVY_1', 'data:image/png;base64,EXTRA_HEAVY_2']
        },
        createdAt: nowIso,
        updatedAt: nowIso
      },
      {
        id: 'wo-test-2',
        woNumber: 'WO-TEST-002',
        idCustomer: 'CUST-2002',
        customerName: 'Pelanggan Barat Dua',
        appointmentDate: todayWIB,
        slotTime: '13:00-15:00',
        area: 'Jakarta Barat',
        clusterName: 'Puri Indah',
        contactorName: 'PT Vendor Lain',
        contractorName: 'PT Vendor Lain',
        leaderName: 'Other Leader',
        installerName: 'Teknisi Lain',
        assignedTo: 'other-inst',
        statusWOAgent: 'Open',
        statusWOInstaller: 'Pending',
        statusWhatsApp: 'pending',
        approvalStatus: 'NONE',
        createdAt: nowIso,
        updatedAt: nowIso
      }
    ];

    db.ticketMessages = [
      {
        id: 'msg-test-1',
        ticketId: 'wo-test-1',
        senderId: 'test-inst-1',
        senderName: 'Budi Teknisi',
        senderRole: 'installer',
        message: 'Sudah tiba di lokasi pelanggan.',
        category: 'PROGRESS',
        timestamp: nowIso
      }
    ];
    db.auditLogs = [];

    let saToken = '';
    let dispToken = '';
    let leaderToken = '';
    let installerToken = '';
    let mgmtToken = '';
    let itToken = '';

    await check('1. Login with mustChangePassword=true blocks operational endpoints (403) and redacts critical bootstrap', async () => {
      const loginRes = await jsonReq(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'test_superadmin', password: strongInitPass }
      });
      assert.equal(loginRes.status, 200);
      assert.equal(loginRes.body.user.mustChangePassword, true);
      saToken = loginRes.body.accessToken || loginRes.body.token;
      assert.ok(saToken);

      const blockedTickets = await jsonReq(baseUrl, 'GET', '/api/tickets', { token: saToken });
      assert.equal(blockedTickets.status, 403);
      assert.equal(blockedTickets.body.code, 'PASSWORD_CHANGE_REQUIRED');

      const blockedProg = await jsonReq(baseUrl, 'GET', '/api/work-orders/progressive?phase=critical', { token: saToken });
      assert.equal(blockedProg.status, 403);
      assert.equal(blockedProg.body.code, 'PASSWORD_CHANGE_REQUIRED');

      const blockedDelta = await jsonReq(baseUrl, 'GET', '/api/sync/delta', { token: saToken });
      assert.equal(blockedDelta.status, 403);

      const bootRedacted = await jsonReq(baseUrl, 'GET', '/api/bootstrap?mode=critical', { token: saToken });
      assert.equal(bootRedacted.status, 200);
      assert.equal(bootRedacted.body.passwordChangeRequired, true);
      assert.equal(bootRedacted.body.currentUser?.mustChangePassword, true);
      assert.deepEqual(bootRedacted.body.tickets, []);
    });

    const newSaPass = 'Mora88!';
    await check('2. Password policy validation (4-8 chars max) & mandatory password change clears lock + rotates session', async () => {
      // Reject >8 char password
      const tooLong = await jsonReq(baseUrl, 'POST', '/api/auth/change-password', {
        token: saToken,
        body: { currentPassword: strongInitPass, newPassword: 'LongPass9' }
      });
      assert.equal(tooLong.status, 400);

      // Reject <4 char password
      const tooShort = await jsonReq(baseUrl, 'POST', '/api/auth/change-password', {
        token: saToken,
        body: { currentPassword: strongInitPass, newPassword: 'abc' }
      });
      assert.equal(tooShort.status, 400);

      // Reject username match
      const weakUser = await jsonReq(baseUrl, 'POST', '/api/auth/change-password', {
        token: saToken,
        body: { currentPassword: strongInitPass, newPassword: 'test_sa' }
      });
      assert.equal(weakUser.status, 400);

      // Reject reuse of current password
      const reuse = await jsonReq(baseUrl, 'POST', '/api/auth/change-password', {
        token: saToken,
        body: { currentPassword: strongInitPass, newPassword: strongInitPass }
      });
      assert.equal(reuse.status, 400);

      // Accept valid <=8 char password
      const oldToken = saToken;
      const okChange = await jsonReq(baseUrl, 'POST', '/api/auth/change-password', {
        token: oldToken,
        body: { currentPassword: strongInitPass, newPassword: newSaPass }
      });
      assert.equal(okChange.status, 200);
      assert.equal(okChange.body.success, true);
      assert.equal(okChange.body.user.mustChangePassword, false);
      saToken = okChange.body.accessToken || okChange.body.token;
      assert.ok(saToken);
      assert.notEqual(saToken, oldToken);

      // Old session token must be invalidated after sessionVersion increment
      const oldTokenCheck = await jsonReq(baseUrl, 'GET', '/api/work-orders/progressive?phase=critical', { token: oldToken });
      assert.equal(oldTokenCheck.status, 401);
    });

    await check('3. Critical bootstrap strips heavy photo arrays while keeping critical WO columns', async () => {
      const boot = await jsonReq(baseUrl, 'GET', '/api/bootstrap?mode=critical', { token: saToken });
      assert.equal(boot.status, 200);
      assert.equal(boot.body.isCriticalMode, true);
      assert.ok(Array.isArray(boot.body.tickets));
      assert.equal(boot.body.tickets.length, 2);
      const wo1 = boot.body.tickets.find((t: any) => t.id === 'wo-test-1');
      assert.ok(wo1);
      assert.equal(wo1._isCriticalPartial, true);
      assert.equal(wo1.woNumber, 'WO-TEST-001');
      assert.equal(wo1.technicalReport?.workResult, 'DONE');
      assert.equal(wo1.technicalReport?.photos, undefined);
      assert.equal(wo1.technicalReport?.photoBeforeUrl, undefined);
      assert.equal(wo1.technicalReport?.photoAfterUrl, undefined);
      assert.equal(wo1.customerSignatureUrl, undefined);
      assert.ok(!boot.body.auditLogs || boot.body.auditLogs.length === 0);
    });

    await check('4. Progressive WO endpoint & RBAC isolation across all 6 roles + single-WO hydration + delta sync', async () => {
      const loginRole = async (username: string) => {
        const res = await jsonReq(baseUrl, 'POST', '/api/auth/login', {
          body: { identifier: username, password: strongInitPass }
        });
        assert.equal(res.status, 200, `Login failed for ${username}`);
        return res.body.accessToken || res.body.token;
      };

      dispToken = await loginRole('test_dispatch');
      leaderToken = await loginRole('test_leader');
      installerToken = await loginRole('test_installer');
      mgmtToken = await loginRole('test_mgmt');
      itToken = await loginRole('test_itsupport');

      const saProg = await jsonReq(baseUrl, 'GET', '/api/work-orders/progressive?phase=critical&page=1&limit=10', { token: saToken });
      assert.equal(saProg.status, 200);
      assert.equal(saProg.body.tickets.length, 2);

      const dispProg = await jsonReq(baseUrl, 'GET', '/api/work-orders/progressive?phase=full&page=1&limit=10', { token: dispToken });
      assert.equal(dispProg.status, 200);
      assert.equal(dispProg.body.tickets.length, 2);

      const mgmtProg = await jsonReq(baseUrl, 'GET', '/api/work-orders/progressive?phase=critical', { token: mgmtToken });
      assert.equal(mgmtProg.status, 200);
      assert.equal(mgmtProg.body.tickets.length, 2);

      const itProg = await jsonReq(baseUrl, 'GET', '/api/work-orders/progressive?phase=critical', { token: itToken });
      assert.equal(itProg.status, 200);
      assert.equal(itProg.body.tickets.length, 2);

      // Leader sees only PT Mitra Jaringan Solusi / Jakarta Selatan
      const leaderProg = await jsonReq(baseUrl, 'GET', '/api/work-orders/progressive?phase=critical', { token: leaderToken });
      assert.equal(leaderProg.status, 200);
      assert.equal(leaderProg.body.tickets.length, 1);
      assert.equal(leaderProg.body.tickets[0].id, 'wo-test-1');

      // Installer sees only assigned WO (wo-test-1)
      const instProg = await jsonReq(baseUrl, 'GET', '/api/work-orders/progressive?phase=critical', { token: installerToken });
      assert.equal(instProg.status, 200);
      assert.equal(instProg.body.tickets.length, 1);
      assert.equal(instProg.body.tickets[0].id, 'wo-test-1');

      // Single-WO on-demand full hydration with messages & activities
      const singleWo = await jsonReq(baseUrl, 'GET', '/api/work-orders/wo-test-1?include=messages,activities', { token: saToken });
      assert.equal(singleWo.status, 200);
      assert.equal(singleWo.body.ticket.id, 'wo-test-1');
      assert.ok(singleWo.body.ticket.technicalReport);
      assert.equal(singleWo.body.ticket.technicalReport.photos.length, 2);
      assert.ok(Array.isArray(singleWo.body.messages));
      assert.equal(singleWo.body.messages.length, 1);

      // Delta sync returns scoped changed WOs + deletedIds + versions + serverTime
      const sinceIso = new Date(Date.now() - 60_000).toISOString();
      const deltaLeader = await jsonReq(baseUrl, 'GET', `/api/sync/delta?since=${encodeURIComponent(sinceIso)}`, { token: leaderToken });
      assert.equal(deltaLeader.status, 200);
      assert.equal(deltaLeader.body.tickets.length, 1);
      assert.equal(deltaLeader.body.tickets[0].id, 'wo-test-1');
      assert.ok(Array.isArray(deltaLeader.body.deletedIds));
      assert.ok(deltaLeader.body.serverTime);
    });

    await check('5. Mass Password Reset API RBAC, batch execution, idempotency, retry failed only, sanitized reports (zero plaintext), rollback', async () => {
      // Non-superadmin must get 403
      for (const nonSaToken of [dispToken, leaderToken, installerToken, mgmtToken, itToken]) {
        const forbidden = await jsonReq(baseUrl, 'POST', '/api/admin/password-reset/jobs', {
          token: nonSaToken,
          body: { targetScope: 'selected_users', userIds: ['test-disp-1'], resetMode: 'force_change_on_login', reason: 'audit' }
        });
        assert.equal(forbidden.status, 403);
      }

      const idempotencyKey = 'verify-batch-idem-001';
      const createJobRes = await jsonReq(baseUrl, 'POST', '/api/admin/password-reset/jobs', {
        token: saToken,
        body: {
          targetScope: 'selected_users',
          userIds: ['test-disp-1', 'test-lead-1'],
          resetMode: 'rotate_credential_and_force',
          batchSize: 1,
          reason: 'Security Compliance Audit',
          idempotencyKey,
          simulateFailureUserIds: ['test-lead-1']
        }
      });
      assert.equal(createJobRes.status, 201);
      const jobId = createJobRes.body.job.id;
      assert.ok(jobId);

      // Duplicate idempotency key returns same job without duplicating
      const dupJobRes = await jsonReq(baseUrl, 'POST', '/api/admin/password-reset/jobs', {
        token: saToken,
        body: {
          targetScope: 'selected_users',
          userIds: ['test-disp-1', 'test-lead-1'],
          resetMode: 'rotate_credential_and_force',
          batchSize: 1,
          reason: 'Security Compliance Audit',
          idempotencyKey
        }
      });
      assert.equal(dupJobRes.status, 200);
      assert.equal(dupJobRes.body.deduplicated, true);
      assert.equal(dupJobRes.body.job.id, jobId);

      // Poll until completed_with_errors
      let partialJob: any = null;
      for (let i = 0; i < 30; i++) {
        const poll = await jsonReq(baseUrl, 'GET', `/api/admin/password-reset/jobs/${jobId}`, { token: saToken });
        assert.equal(poll.status, 200);
        if (['completed', 'completed_with_errors', 'cancelled', 'rolled_back'].includes(poll.body.job.status)) {
          partialJob = poll.body.job;
          break;
        }
        await new Promise((r) => setTimeout(r, 60));
      }
      assert.ok(partialJob);
      assert.equal(partialJob.status, 'completed_with_errors');
      assert.equal(partialJob.completedCount, 1);
      assert.equal(partialJob.failedCount, 1);

      // Retry only failed items without duplicating completed test-disp-1 (attempts stays 1)
      const retryRes = await jsonReq(baseUrl, 'POST', `/api/admin/password-reset/jobs/${jobId}/retry`, { token: saToken });
      assert.equal(retryRes.status, 200);
      assert.equal(retryRes.body.retriedCount, 1);

      let finalJob: any = null;
      for (let i = 0; i < 30; i++) {
        const poll = await jsonReq(baseUrl, 'GET', `/api/admin/password-reset/jobs/${jobId}`, { token: saToken });
        assert.equal(poll.status, 200);
        if (poll.body.job.status === 'completed') {
          finalJob = poll.body.job;
          break;
        }
        await new Promise((r) => setTimeout(r, 60));
      }
      assert.ok(finalJob);
      assert.equal(finalJob.status, 'completed');
      assert.equal(finalJob.completedCount, 2);
      const dispItem = finalJob.items.find((it: any) => it.userId === 'test-disp-1');
      assert.equal(dispItem.attempts, 1);

      // Confirm target users have mustChangePassword=true and never '12345678'
      const dispUser = db.users.find((u: any) => u.id === 'test-disp-1');
      assert.equal(dispUser?.mustChangePassword, true);
      assert.notEqual(dispUser?.passwordHash, '12345678');

      // Sanitized CSV & JSON reports must contain zero plaintext passwords or hashes
      const csvReport = await jsonReq(baseUrl, 'GET', `/api/admin/password-reset/jobs/${jobId}/report?format=csv`, { token: saToken });
      assert.equal(csvReport.status, 200);
      assert.ok(csvReport.rawText.includes('test_dispatch'));
      assert.ok(!csvReport.rawText.includes('12345678'));
      assert.ok(!csvReport.rawText.includes('$2b$'));
      assert.ok(!csvReport.rawText.includes('pbkdf2:'));

      const jsonReport = await jsonReq(baseUrl, 'GET', `/api/admin/password-reset/jobs/${jobId}/report?format=json`, { token: saToken });
      assert.equal(jsonReport.status, 200);
      assert.equal(jsonReport.body.report.jobId, jobId);

      // Rollback restores prior hash & mustChangePassword state
      const rbRes = await jsonReq(baseUrl, 'POST', `/api/admin/password-reset/jobs/${jobId}/rollback`, { token: saToken });
      assert.equal(rbRes.status, 200);
      assert.equal(rbRes.body.job.status, 'rolled_back');
      assert.equal(db.users.find((u: any) => u.id === 'test-disp-1')?.mustChangePassword, false);
    });

    await check('6. Single-use expiring SHA-256 reset token issuance, validation, consumption, and replay rejection', async () => {
      const issueRes = await jsonReq(baseUrl, 'POST', '/api/admin/users/test-it-1/issue-reset-token', {
        token: saToken,
        body: { ttlMinutes: 30 }
      });
      assert.equal(issueRes.status, 200);
      const rawResetToken = issueRes.body.resetToken;
      assert.ok(rawResetToken && rawResetToken.length >= 24);
      assert.ok(issueRes.body.expiresAt);

      // Reject >8 char password with token
      const tooLongTokenUse = await jsonReq(baseUrl, 'POST', '/api/auth/reset-password-token', {
        body: { identifier: 'test_itsupport', token: rawResetToken, newPassword: 'OverEight9' }
      });
      assert.equal(tooLongTokenUse.status, 400);

      // Consume token with valid <=8 char password
      const newItPass = 'Kilo2026';
      const okTokenUse = await jsonReq(baseUrl, 'POST', '/api/auth/reset-password-token', {
        body: { identifier: 'test_itsupport', token: rawResetToken, newPassword: newItPass }
      });
      assert.equal(okTokenUse.status, 200);
      assert.equal(okTokenUse.body.success, true);

      // Replay of same token must fail
      const replayRes = await jsonReq(baseUrl, 'POST', '/api/auth/reset-password-token', {
        body: { identifier: 'test_itsupport', token: rawResetToken, newPassword: 'Kilo2027' }
      });
      assert.equal(replayRes.status, 400);

      // Login with new password succeeds
      const loginNew = await jsonReq(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'test_itsupport', password: newItPass }
      });
      assert.equal(loginNew.status, 200);
      assert.equal(loginNew.body.user.mustChangePassword, false);
    });

    console.log(`\n🎉 ALL ${results.length}/${results.length} AUTOMATED VERIFICATION CHECKS PASSED.`);
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    if (hadExistingDbFile && originalDbBackup !== null) {
      fs.writeFileSync(DB_FILE_PATH, originalDbBackup, 'utf-8');
    } else if (!hadExistingDbFile && fs.existsSync(DB_FILE_PATH)) {
      fs.unlinkSync(DB_FILE_PATH);
    }
  }
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
