/**
 * Automated Verification Suite — MoraJaws Automated Email Notification System
 *
 * Tests:
 * 1. Template rendering (all 7 templates), XSS escaping/sanitization, HTTPS URL enforcement,
 *    omission of empty WO detail fields, and DEMO preview banner.
 * 2. Missing/invalid email handling -> logged as `skipped`, never crashes batch.
 * 3. Trigger A (Daily Reset): blocked if resetCompleted=false; strict Contractor & Installer scoping;
 *    max 1 notification per recipient per operational date WIB.
 * 4. Trigger B (New WO Leader): fires ONLY for distributed WOs with mapped Leader; ignores unmapped/exception;
 *    deduplicates identical (woNumber, leaderId).
 * 5. Trigger C (WO Assignment): targets ONLY assigned Installer.
 * 6. Trigger D (WO Reassignment): skips if installer unchanged; notifies previous & new Installer when changed.
 * 7. Trigger E (Daily Summary): computes fresh metrics directly from persisted tickets.
 * 8. Queue retry / failure honesty when RESEND_API_KEY is missing (never falsely marks `sent`).
 * 9. Resend Webhook HMAC-SHA256 verification + delivery status update.
 * 10. Express API RBAC enforcement (401 unauth, 403 non-superadmin, 200 superadmin) & webhook HTTP verification.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';

// Isolate test execution cleanly in memory/local mode without mutating Supabase
delete process.env.SUPABASE_URL;
delete process.env.VITE_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.VITE_SUPABASE_ANON_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_WEBHOOK_SECRET;
process.env.NODE_ENV = 'development';
process.env.ALLOW_LOCAL_JSON_MODE = 'true';

import {
  EmailTemplateKey,
  getDefaultEmailTemplates,
  getDemoContextForTemplate,
  renderEmailTemplate,
  sanitizeTemplateText,
  sanitizeHttpsUrl
} from '../server/emailTemplateRenderer.ts';
import {
  isValidEmailAddress,
  processEmailQueueBatch,
  registerEmailNotificationPersistenceHooks,
  resetEmailServiceCachesForTesting,
  saveEmailNotificationConfig,
  testResendProviderConnection,
  triggerDailyResetNotifications,
  triggerDailySummaryNotifications,
  triggerNewWoLeaderNotifications,
  triggerWoAssignedInstallerNotification,
  triggerWoReassignedNotifications,
  verifyResendWebhookSignature,
  handleResendWebhookEvent,
  listEmailDeliveryLogs
} from '../server/emailNotificationService.ts';

interface CheckResult {
  category: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
function assertCheck(category: string, name: string, passed: boolean, detail?: string) {
  results.push({ category, name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] [${category}] ${name}${detail ? ` -> ${detail}` : ''}`);
}

const REQUIRED_TEMPLATE_KEYS: EmailTemplateKey[] = [
  'daily_reset_leader',
  'daily_reset_installer',
  'new_wo_leader',
  'wo_assigned_installer',
  'wo_reassigned_prev_installer',
  'wo_reassigned_new_installer',
  'daily_summary'
];

async function run() {
  const dbPath = path.resolve(process.cwd(), 'data', 'morajaws_database.json');
  const hadDbFile = fs.existsSync(dbPath);
  const originalDbBytes = hadDbFile ? fs.readFileSync(dbPath) : null;

  try {
    // -----------------------------------------------------------------------
    // 1. Template Renderer, XSS Sanitization, Empty Omission & DEMO Preview
    // -----------------------------------------------------------------------
    const defaults = getDefaultEmailTemplates();
    assertCheck(
      'Templates',
      'All 7 required template keys exist',
      REQUIRED_TEMPLATE_KEYS.every(k => Boolean(defaults[k])),
      `count=${Object.keys(defaults).length}`
    );

    const xssSanitized = sanitizeTemplateText(
      '<p onclick="alert(1)">Halo</p><script>evil()</script>javascript:steal()'
    );
    assertCheck(
      'Security',
      'Template sanitizer strips HTML tags, scripts, event handlers, and javascript: schemes',
      !xssSanitized.includes('<script') &&
        !xssSanitized.includes('<p') &&
        !xssSanitized.includes('onclick=') &&
        !xssSanitized.toLowerCase().includes('javascript:'),
      xssSanitized
    );

    assertCheck(
      'Security',
      'URL sanitizer blocks http:// and javascript: CTA targets and preserves https://',
      sanitizeHttpsUrl('http://insecure.local/x').startsWith('https://') &&
        sanitizeHttpsUrl('javascript:alert(1)').startsWith('https://') &&
        sanitizeHttpsUrl('https://morajaws.example.com/wo') === 'https://morajaws.example.com/wo'
    );

    const demoRendered = renderEmailTemplate(defaults.wo_assigned_installer, {
      ...getDemoContextForTemplate('wo_assigned_installer'),
      customerName: '<img src=x onerror=alert(9)>Budi',
      customerContact: '',
      isDemoPreview: true
    });
    assertCheck(
      'Templates',
      'Interpolated values are HTML-escaped, empty field omitted, DEMO banner included',
      !demoRendered.htmlBody.includes('<img src=x onerror') &&
        demoRendered.htmlBody.includes('&lt;img src=x onerror=alert(9)&gt;Budi') &&
        !demoRendered.htmlBody.includes('Kontak Pelanggan') &&
        demoRendered.htmlBody.includes('DEMO'),
      `subject=${demoRendered.subject}`
    );

    // -----------------------------------------------------------------------
    // 2. Email Validation & Scoped Event Triggers (Isolated Mock Store)
    // -----------------------------------------------------------------------
    resetEmailServiceCachesForTesting();
    const mockUsers = [
      { id: 'sa-1', name: 'Root Admin', role: 'super_admin', email: 'superadmin@morajaws.test', active: true },
      { id: 'ldr-a', name: 'Leader Alpha', role: 'leader', email: 'leader.alpha@morajaws.test', contractor: 'PT Alpha Fiber', area: 'Jakarta Selatan', active: true },
      { id: 'ldr-b', name: 'Leader Beta', role: 'leader', email: 'leader.beta@morajaws.test', contractor: 'PT Beta Net', area: 'Bandung', active: true },
      { id: 'inst-1', name: 'Teknisi Satu', role: 'installer', email: 'teknisi1@morajaws.test', contractor: 'PT Alpha Fiber', active: true },
      { id: 'inst-2', name: 'Teknisi Dua', role: 'installer', email: 'teknisi2@morajaws.test', contractor: 'PT Alpha Fiber', active: true },
      { id: 'inst-noemail', name: 'Teknisi Tanpa Email', role: 'installer', email: '', contractor: 'PT Alpha Fiber', active: true }
    ];

    const opDate = '2026-11-23';
    const mockTickets: any[] = [
      {
        id: 't-1',
        woNumber: 'WO-2026-001',
        customerId: '1234567',
        customerName: 'Pelanggan 1',
        streetName: 'Jl. Kemang Raya No. 1',
        area: 'Jakarta Selatan',
        contactorName: 'PT Alpha Fiber',
        leaderId: 'ldr-a',
        distributionStatus: 'distributed',
        appointmentDate: opDate,
        slotTime: '09:00-11:00',
        installerId: 'inst-1',
        installerName: 'Teknisi Satu',
        statusWOInstaller: 'In Progress',
        statusWOAgent: 'Open'
      },
      {
        id: 't-2',
        woNumber: 'WO-2026-002',
        customerId: '7654321',
        customerName: 'Pelanggan 2',
        area: 'Jakarta Selatan',
        contactorName: 'PT Alpha Fiber',
        leaderId: 'ldr-a',
        distributionStatus: 'distributed',
        appointmentDate: opDate,
        slotTime: '13:00-15:00',
        statusWOInstaller: 'Completed',
        statusWOAgent: 'Closed'
      },
      {
        id: 't-3',
        woNumber: 'WO-2026-003',
        customerId: '1112223',
        customerName: 'Pelanggan Beta',
        area: 'Bandung',
        contactorName: 'PT Beta Net',
        leaderId: 'ldr-b',
        distributionStatus: 'distributed',
        appointmentDate: opDate,
        slotTime: '10:00-12:00',
        installerId: 'inst-2',
        installerName: 'Teknisi Dua',
        statusWOInstaller: 'Pending'
      },
      {
        id: 't-4',
        woNumber: 'WO-2026-UNMAPPED',
        customerId: '9998887',
        customerName: 'Pelanggan Exception',
        area: 'Unknown',
        contactorName: 'Unknown Vendor',
        distributionStatus: 'unmapped_leader',
        appointmentDate: opDate
      }
    ];

    const localStore: any = {
      appSettings: {},
      emailNotificationQueue: [],
      emailDeliveryLogs: []
    };

    registerEmailNotificationPersistenceHooks({
      getUsers: async () => mockUsers,
      getTickets: async () => mockTickets,
      getOperationalDateWIB: () => opDate,
      isLocalJsonAllowed: () => false,
      getLocalStore: () => localStore,
      saveLocalStore: () => {},
      writeAuditLog: async () => {}
    });

    await saveEmailNotificationConfig(
      {
        enabled: true,
        senderName: 'MoraJaws Ops',
        senderEmail: 'noreply@morajaws.test',
        rules: {
          dailyReset: { enabled: true, scheduleTime: '00:05' },
          newWoLeader: { enabled: true },
          woAssignedInstaller: { enabled: true },
          woReassigned: { enabled: true },
          dailySummary: { enabled: true, scheduleTime: '18:00' }
        }
      },
      { id: 'sa-1', name: 'Root Admin', role: 'super_admin' }
    );

    assertCheck(
      'Validation',
      'Email validator rejects header injection & malformed addresses',
      !isValidEmailAddress('') &&
        !isValidEmailAddress('not-an-email') &&
        !isValidEmailAddress('evil@x.com\r\nBcc:leak@x.com') &&
        isValidEmailAddress('ops.leader@morajaws.test')
    );

    // Trigger A: Daily Reset blocked when resetCompleted=false
    const resetBlocked = await triggerDailyResetNotifications({
      operationalDateWIB: opDate,
      resetCompleted: false
    });
    assertCheck(
      'DailyReset',
      'Does not fire when resetCompleted=false',
      resetBlocked.queued === 0 && resetBlocked.deduped === 0
    );

    // Trigger A: Daily Reset when resetCompleted=true -> fires once per recipient, scoped
    const resetOk = await triggerDailyResetNotifications({
      operationalDateWIB: opDate,
      resetCompleted: true
    });
    const resetAgain = await triggerDailyResetNotifications({
      operationalDateWIB: opDate,
      resetCompleted: true
    });
    const leaderAlphaResetItem = localStore.emailNotificationQueue.find(
      (q: any) => q.eventType === 'daily_reset' && q.recipientUserId === 'ldr-a'
    );
    const noEmailSkippedLog = localStore.emailDeliveryLogs.find(
      (l: any) => l.recipientUserId === 'inst-noemail' && l.deliveryStatus === 'skipped'
    );
    assertCheck(
      'DailyReset',
      'Fires once per recipient per operationalDateWIB, skips missing email cleanly, scopes data',
      resetOk.queued === 4 && // ldr-a, ldr-b, inst-1, inst-2
        resetOk.skipped === 1 && // inst-noemail
        resetAgain.queued === 0 &&
        resetAgain.deduped === 5 && // all 5 active Leader/Installer keys deduped on repeat
        Boolean(leaderAlphaResetItem) &&
        !leaderAlphaResetItem.htmlBody.includes('PT Beta Net') &&
        Boolean(noEmailSkippedLog),
      `queued=${resetOk.queued}, skipped=${resetOk.skipped}, deduped=${resetAgain.deduped}`
    );

    // Trigger B: New WO Leader -> skips unmapped_leader, deduplicates distributed
    const newWoRes = await triggerNewWoLeaderNotifications({
      tickets: mockTickets,
      users: mockUsers
    });
    const newWoResDup = await triggerNewWoLeaderNotifications({
      tickets: mockTickets,
      users: mockUsers
    });
    assertCheck(
      'NewWoLeader',
      'Fires ONLY for distributed WOs with mapped Leader and deduplicates repeats',
      newWoRes.queued === 3 &&
        newWoRes.skipped === 1 &&
        newWoResDup.queued === 0 &&
        newWoResDup.deduped === 3 &&
        !localStore.emailNotificationQueue.some((q: any) => q.relatedWoNumber === 'WO-2026-UNMAPPED'),
      `queued=${newWoRes.queued}, skipped=${newWoRes.skipped}`
    );

    // Trigger C: WO Assignment -> only assigned Installer
    const assignRes = await triggerWoAssignedInstallerNotification({
      ticket: mockTickets[0],
      installerUser: mockUsers[3],
      leaderName: 'Leader Alpha',
      assignmentEventId: 'evt-assign-1',
      users: mockUsers
    });
    assertCheck(
      'WoAssigned',
      'Notifies assigned Installer with WO and customer info',
      assignRes.enqueued === true &&
        localStore.emailNotificationQueue.some(
          (q: any) =>
            q.eventType === 'wo_assigned_installer' &&
            q.recipientUserId === 'inst-1' &&
            q.relatedWoNumber === 'WO-2026-001'
        )
    );

    // Trigger D: Reassignment -> skip unchanged, notify both when changed
    const reassignUnchanged = await triggerWoReassignedNotifications({
      ticket: mockTickets[0],
      previousInstallerId: 'inst-1',
      previousInstallerName: 'Teknisi Satu',
      newInstallerUser: mockUsers[3],
      leaderName: 'Leader Alpha',
      reassignEventId: 'evt-noop',
      users: mockUsers
    });
    const reassignChanged = await triggerWoReassignedNotifications({
      ticket: { ...mockTickets[0], installerId: 'inst-2', installerName: 'Teknisi Dua' },
      previousInstallerId: 'inst-1',
      previousInstallerName: 'Teknisi Satu',
      newInstallerUser: mockUsers[4],
      leaderName: 'Leader Alpha',
      reason: 'Teknisi sebelumnya overload',
      reassignEventId: 'evt-reassign-1',
      users: mockUsers
    });
    assertCheck(
      'WoReassigned',
      'Skips unchanged installer; notifies previous & new Installer when changed',
      reassignUnchanged.unchangedSkipped === true &&
        reassignChanged.prevEnqueued === true &&
        reassignChanged.newEnqueued === true
    );

    // Trigger E: Daily Summary
    const summaryRes = await triggerDailySummaryNotifications({
      operationalDateWIB: opDate
    });
    const saSummaryItem = localStore.emailNotificationQueue.find(
      (q: any) => q.eventType === 'daily_summary' && q.recipientUserId === 'sa-1'
    );
    assertCheck(
      'DailySummary',
      'Computes summary metrics from DB and queues to Superadmin + Leaders',
      summaryRes.queued === 3 && Boolean(saSummaryItem) && saSummaryItem.htmlBody.includes('Total WO')
    );

    // Queue honesty without RESEND_API_KEY -> never marks sent
    const providerHealthCheck = await testResendProviderConnection();
    // Wait briefly for any fire-and-forget batch triggered by earlier calls to finish, then re-queue due items
    await new Promise(r => setTimeout(r, 80));
    for (const q of localStore.emailNotificationQueue) {
      if (q.status === 'retry_pending' || q.status === 'queued') {
        q.status = 'queued';
        q.nextRetryAt = new Date(Date.now() - 1000).toISOString();
      }
    }
    const batchRes = await processEmailQueueBatch(20);
    const anyFalselySent = localStore.emailNotificationQueue.some(
      (q: any) => q.status === 'sent' || q.status === 'delivered'
    );
    assertCheck(
      'QueueIntegrity',
      'Missing RESEND_API_KEY fails honestly & schedules retry instead of faking sent',
      !providerHealthCheck.success &&
        batchRes.processed > 0 &&
        batchRes.retryScheduled > 0 &&
        batchRes.sent === 0 &&
        !anyFalselySent,
      `processed=${batchRes.processed}, retryScheduled=${batchRes.retryScheduled}, sent=${batchRes.sent}`
    );

    // Webhook signature + local delivery status update
    const testSecretRaw = Buffer.from('super-secret-resend-webhook-key').toString('base64');
    const webhookSecret = `whsec_${testSecretRaw}`;
    const webhookPayload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 're_msg_9999' }
    });
    localStore.emailNotificationQueue.push({
      id: 'eq_webhook_test',
      eventKey: 'test:webhook:9999',
      eventType: 'wo_assigned_installer',
      templateKey: 'wo_assigned_installer',
      recipientEmail: 'teknisi1@morajaws.test',
      recipientName: 'Teknisi Satu',
      recipientRole: 'installer',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
      textBody: 'Test',
      payload: {},
      status: 'sent',
      retryCount: 0,
      maxRetries: 3,
      providerMessageId: 're_msg_9999',
      createdAt: new Date().toISOString()
    });
    const tsNow = String(Math.floor(Date.now() / 1000));
    const svixId = 'msg_12345';
    const expectedHmac = crypto
      .createHmac('sha256', Buffer.from(testSecretRaw, 'base64'))
      .update(`${svixId}.${tsNow}.${webhookPayload}`, 'utf8')
      .digest('base64');

    const sigValid = verifyResendWebhookSignature({
      rawBody: webhookPayload,
      svixId,
      svixTimestamp: tsNow,
      svixSignature: `v1,${expectedHmac}`,
      secret: webhookSecret
    });
    const sigInvalid = verifyResendWebhookSignature({
      rawBody: webhookPayload,
      svixId,
      svixTimestamp: tsNow,
      svixSignature: 'v1,tampered_sig',
      secret: webhookSecret
    });
    const webhookHandled = await handleResendWebhookEvent(JSON.parse(webhookPayload));
    const logsAfterWebhook = await listEmailDeliveryLogs({ status: 'delivered' });
    assertCheck(
      'Webhook',
      'Validates Svix HMAC signature & updates status to delivered',
      sigValid &&
        !sigInvalid &&
        webhookHandled &&
        logsAfterWebhook.logs.some(l => l.providerMessageId === 're_msg_9999')
    );

    // -----------------------------------------------------------------------
    // 3. Express HTTP RBAC & Routes Integration Test
    // -----------------------------------------------------------------------
    resetEmailServiceCachesForTesting();
    const serverModule = await import('../server.ts');
    const { createExpressApp, SERVER_SESSIONS, db: serverDb } = serverModule;

    const app = await createExpressApp({ skipVite: true });
    for (const uid of ['u-1', 'u-dispatch-1', 'u-leader-1', 'u-installer-1']) {
      const found = (serverDb.users || []).find((u: any) => u.id === uid);
      if (found) found.mustChangePassword = false;
    }
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    const BASE_URL = `http://127.0.0.1:${port}`;

    const nowIso = new Date().toISOString();
    const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
    const saTok = `email_tok_sa_${Date.now()}`;
    const dpTok = `email_tok_dp_${Date.now()}`;
    const ldTok = `email_tok_ld_${Date.now()}`;
    const inTok = `email_tok_in_${Date.now()}`;

    SERVER_SESSIONS.push(
      {
        sessionId: 'sess_email_sa',
        token: saTok,
        userId: 'u-1',
        username: 'superadmin',
        name: 'Alamsyah (Super Admin)',
        role: 'super_admin',
        sessionVersion: 1,
        loginAt: nowIso,
        lastActivityAt: nowIso,
        expiresAt: futureIso,
        status: 'active'
      },
      {
        sessionId: 'sess_email_dp',
        token: dpTok,
        userId: 'u-dispatch-1',
        username: 'dispatch',
        name: 'Siti Rahma',
        role: 'dispatch',
        sessionVersion: 1,
        loginAt: nowIso,
        lastActivityAt: nowIso,
        expiresAt: futureIso,
        status: 'active'
      },
      {
        sessionId: 'sess_email_ld',
        token: ldTok,
        userId: 'u-leader-1',
        username: 'leadermjs',
        name: 'Hendra Gunawan',
        role: 'leader',
        contractor: 'PT Mitra Jaringan Solusi',
        sessionVersion: 1,
        loginAt: nowIso,
        lastActivityAt: nowIso,
        expiresAt: futureIso,
        status: 'active'
      },
      {
        sessionId: 'sess_email_in',
        token: inTok,
        userId: 'u-installer-1',
        username: 'installer1',
        name: 'Andi Saputra',
        role: 'installer',
        contractor: 'PT Mitra Jaringan Solusi',
        sessionVersion: 1,
        loginAt: nowIso,
        lastActivityAt: nowIso,
        expiresAt: futureIso,
        status: 'active'
      }
    );

    try {
      const unauthRes = await fetch(`${BASE_URL}/api/email-notifications/config`);
      assertCheck('RBAC', 'Unauthenticated request blocked with 401', unauthRes.status === 401);

      const dpRes = await fetch(`${BASE_URL}/api/email-notifications/config`, {
        headers: { Authorization: `Bearer ${dpTok}` }
      });
      const ldRes = await fetch(`${BASE_URL}/api/email-notifications/templates`, {
        headers: { Authorization: `Bearer ${ldTok}` }
      });
      const inRes = await fetch(`${BASE_URL}/api/email-notifications/logs`, {
        headers: { Authorization: `Bearer ${inTok}` }
      });
      assertCheck(
        'RBAC',
        'Dispatch, Leader, and Installer blocked with 403 on email settings/templates/logs',
        dpRes.status === 403 && ldRes.status === 403 && inRes.status === 403,
        `dispatch=${dpRes.status}, leader=${ldRes.status}, installer=${inRes.status}`
      );

      const saCfg = await fetch(`${BASE_URL}/api/email-notifications/config`, {
        headers: { Authorization: `Bearer ${saTok}` }
      });
      const saCfgJson = await saCfg.json();

      const saSaveCfg = await fetch(`${BASE_URL}/api/email-notifications/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${saTok}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          enabled: true,
          senderName: 'MoraJaws Ops Control',
          senderEmail: 'ops@morajaws.example.com'
        })
      });

      const saTpl = await fetch(`${BASE_URL}/api/email-notifications/templates`, {
        headers: { Authorization: `Bearer ${saTok}` }
      });
      const saTplJson = await saTpl.json();

      const saPrev = await fetch(`${BASE_URL}/api/email-notifications/preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${saTok}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ templateKey: 'wo_reassigned_new_installer' })
      });
      const saPrevJson = await saPrev.json();

      const saLogs = await fetch(`${BASE_URL}/api/email-notifications/logs`, {
        headers: { Authorization: `Bearer ${saTok}` }
      });

      const saManualSummary = await fetch(`${BASE_URL}/api/email-notifications/trigger-daily-summary`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${saTok}` }
      });

      assertCheck(
        'ExpressAPI',
        'Superadmin accesses config, save, templates, DEMO preview, logs, and manual summary trigger',
        saCfg.status === 200 &&
          saCfgJson.success === true &&
          saSaveCfg.status === 200 &&
          saTpl.status === 200 &&
          saTplJson.templates?.length === 7 &&
          saPrev.status === 200 &&
          String(saPrevJson.htmlBody || '').includes('DEMO') &&
          saLogs.status === 200 &&
          saManualSummary.status === 200,
        `cfg=${saCfg.status}(${saCfgJson?.code || ''}), save=${saSaveCfg.status}, tpl=${saTpl.status}, prev=${saPrev.status}, logs=${saLogs.status}, summary=${saManualSummary.status}`
      );

      // Test live HTTP webhook signature check when RESEND_WEBHOOK_SECRET is configured
      process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
      const badHook = await fetch(`${BASE_URL}/api/webhooks/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': tsNow,
          'svix-signature': 'v1,invalid_hmac'
        },
        body: webhookPayload
      });
      const goodHook = await fetch(`${BASE_URL}/api/webhooks/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': tsNow,
          'svix-signature': `v1,${expectedHmac}`
        },
        body: webhookPayload
      });
      delete process.env.RESEND_WEBHOOK_SECRET;
      assertCheck(
        'WebhookHTTP',
        'HTTP /api/webhooks/resend rejects invalid signature (401) and accepts valid HMAC (200)',
        badHook.status === 401 && goodHook.status === 200,
        `bad=${badHook.status}, good=${goodHook.status}`
      );
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } finally {
    if (hadDbFile && originalDbBytes) {
      fs.writeFileSync(dbPath, originalDbBytes);
    }
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
