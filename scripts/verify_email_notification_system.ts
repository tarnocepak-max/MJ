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
import os from 'os';
import path from 'path';
import http from 'http';
import net from 'net';
import tls from 'tls';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

// Isolate test execution cleanly in memory/local mode without mutating Supabase
delete process.env.SUPABASE_URL;
delete process.env.VITE_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.VITE_SUPABASE_ANON_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_WEBHOOK_SECRET;
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_SECURE;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.EMAIL_FROM;
delete process.env.EMAIL_REPLY_TO;
delete process.env.SMTP_TEST_ALLOW_SELF_SIGNED;
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
  testSmtpProviderConnection,
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

    // Queue honesty without SMTP_USER/SMTP_PASS -> never marks sent
    const providerHealthCheck = await testResendProviderConnection();
    // Wait briefly for any fire-and-forget batch triggered by earlier calls to finish, then re-queue items
    await new Promise(r => setTimeout(r, 120));
    for (const q of localStore.emailNotificationQueue) {
      if (q.status === 'retry_pending' || q.status === 'queued' || q.status === 'failed') {
        q.status = 'queued';
        q.retryCount = 0;
        q.nextRetryAt = new Date(Date.now() - 1000).toISOString();
      }
    }
    const batchRes = await processEmailQueueBatch(20);
    const anyFalselySent = localStore.emailNotificationQueue.some(
      (q: any) => q.status === 'sent' || q.status === 'delivered'
    );
    assertCheck(
      'QueueIntegrity',
      'Missing SMTP_USER/SMTP_PASS fails honestly instead of faking sent',
      !providerHealthCheck.success &&
        batchRes.processed > 0 &&
        (batchRes.failed > 0 || batchRes.retryScheduled > 0) &&
        batchRes.sent === 0 &&
        !anyFalselySent,
      `processed=${batchRes.processed}, failed=${batchRes.failed}, retryScheduled=${batchRes.retryScheduled}, sent=${batchRes.sent}`
    );

    // Local STARTTLS SMTP server test for Test Connection self-email delivery
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morajaws-smtp-test-'));
    const keyFile = path.join(certDir, 'key.pem');
    const certFile = path.join(certDir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyFile, '-out', certFile,
        '-days', '1', '-subj', '/CN=127.0.0.1'
      ],
      { stdio: 'ignore' }
    );
    const tlsOptions = {
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile)
    };

    const capturedSmtpMail: { mailFrom?: string; rcptTo: string[]; data: string; upgradedTls: boolean; authed: boolean } = {
      rcptTo: [],
      data: '',
      upgradedTls: false,
      authed: false
    };

    const smtpServer = net.createServer(rawSocket => {
      let currentSocket: net.Socket | tls.TLSSocket = rawSocket;
      let buffer = '';
      let readingData = false;
      let authStep: 'none' | 'user' | 'pass' = 'none';

      const sendLine = (line: string) => {
        currentSocket.write(`${line}\r\n`);
      };

      const attachHandlers = (sock: net.Socket | tls.TLSSocket) => {
        sock.on('data', chunk => {
          buffer += chunk.toString('utf8');
          while (true) {
            if (readingData) {
              const endIdx = buffer.indexOf('\r\n.\r\n');
              if (endIdx === -1) break;
              capturedSmtpMail.data += buffer.slice(0, endIdx);
              buffer = buffer.slice(endIdx + 5);
              readingData = false;
              sendLine('250 2.0.0 OK id=local-smtp-test-msg');
              continue;
            }
            const nlIdx = buffer.indexOf('\r\n');
            if (nlIdx === -1) break;
            const line = buffer.slice(0, nlIdx);
            buffer = buffer.slice(nlIdx + 2);

            if (authStep === 'user') {
              authStep = 'pass';
              sendLine('334 UGFzc3dvcmQ6');
              continue;
            }
            if (authStep === 'pass') {
              authStep = 'none';
              capturedSmtpMail.authed = true;
              sendLine('235 2.7.0 Authentication successful');
              continue;
            }

            const upper = line.toUpperCase();
            if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
              sendLine('250-127.0.0.1 Hello');
              if (!capturedSmtpMail.upgradedTls) {
                sendLine('250-STARTTLS');
              }
              sendLine('250 AUTH PLAIN LOGIN');
            } else if (upper === 'STARTTLS') {
              sendLine('220 2.0.0 Ready to start TLS');
              const tlsSock = new tls.TLSSocket(rawSocket, {
                isServer: true,
                ...tlsOptions
              });
              capturedSmtpMail.upgradedTls = true;
              rawSocket.removeAllListeners('data');
              currentSocket = tlsSock;
              attachHandlers(tlsSock);
            } else if (upper.startsWith('AUTH PLAIN')) {
              capturedSmtpMail.authed = true;
              sendLine('235 2.7.0 Authentication successful');
            } else if (upper.startsWith('AUTH LOGIN')) {
              authStep = 'user';
              sendLine('334 VXNlcm5hbWU6');
            } else if (upper.startsWith('MAIL FROM:')) {
              capturedSmtpMail.mailFrom = line.slice(10).trim();
              sendLine('250 2.1.0 OK');
            } else if (upper.startsWith('RCPT TO:')) {
              capturedSmtpMail.rcptTo.push(line.slice(8).trim());
              sendLine('250 2.1.5 OK');
            } else if (upper === 'DATA') {
              readingData = true;
              sendLine('354 Start mail input; end with <CRLF>.<CRLF>');
            } else if (upper === 'QUIT') {
              sendLine('221 2.0.0 Bye');
              sock.end();
            } else if (upper === 'NOOP' || upper === 'RSET') {
              sendLine('250 2.0.0 OK');
            } else {
              sendLine('250 OK');
            }
          }
        });
      };

      attachHandlers(rawSocket);
      sendLine('220 127.0.0.1 ESMTP MoraJawsTest');
    });

    await new Promise<void>(resolve => smtpServer.listen(0, '127.0.0.1', () => resolve()));
    const smtpPort = (smtpServer.address() as { port: number }).port;

    try {
      process.env.SMTP_HOST = '127.0.0.1';
      process.env.SMTP_PORT = String(smtpPort);
      process.env.SMTP_SECURE = 'false';
      process.env.SMTP_USER = 'sender.morajaws@gmail.com';
      process.env.SMTP_PASS = 'test-app-password-secret-xyz';
      process.env.EMAIL_FROM = 'MoraJaws <sender.morajaws@gmail.com>';
      process.env.EMAIL_REPLY_TO = 'sender.morajaws@gmail.com';
      process.env.SMTP_TEST_ALLOW_SELF_SIGNED = '1';
      resetEmailServiceCachesForTesting();

      const testConnRes = await testSmtpProviderConnection({
        id: 'sa-1',
        name: 'Root Admin',
        role: 'super_admin'
      });

      const selfEmailLog = localStore.emailDeliveryLogs.find(
        (l: any) =>
          l.notificationType === 'test_email' &&
          l.recipientEmail === 'sender.morajaws@gmail.com' &&
          l.deliveryStatus === 'sent'
      );

      const unfoldedData = capturedSmtpMail.data
        .replace(/=\r?\n/g, '')
        .replace(/\r?\n[ \t]+/g, ' ');

      assertCheck(
        'TestConnection',
        'Verifies STARTTLS + auth and sends real verification email to sender own email address',
        testConnRes.success === true &&
          testConnRes.recipientEmail === 'sender.morajaws@gmail.com' &&
          Boolean(testConnRes.providerMessageId) &&
          capturedSmtpMail.upgradedTls &&
          capturedSmtpMail.authed &&
          capturedSmtpMail.rcptTo.some(r => r.includes('sender.morajaws@gmail.com')) &&
          unfoldedData.includes('Verifikasi Koneksi Gmail SMTP (Test Connection)') &&
          !capturedSmtpMail.data.includes('test-app-password-secret-xyz') &&
          Boolean(selfEmailLog),
        `recipient=${testConnRes.recipientEmail}, msgId=${testConnRes.providerMessageId}, tls=${capturedSmtpMail.upgradedTls}, authed=${capturedSmtpMail.authed}, hasBody=${unfoldedData.includes('Verifikasi Koneksi Gmail SMTP (Test Connection)')}, hasLog=${Boolean(selfEmailLog)}`
      );
    } finally {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_SECURE;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      delete process.env.EMAIL_FROM;
      delete process.env.EMAIL_REPLY_TO;
      delete process.env.SMTP_TEST_ALLOW_SELF_SIGNED;
      resetEmailServiceCachesForTesting();
      await new Promise<void>(resolve => smtpServer.close(() => resolve()));
      fs.rmSync(certDir, { recursive: true, force: true });
    }

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

      const unauthTestConn = await fetch(`${BASE_URL}/api/email-notifications/test-connection`, {
        method: 'POST'
      });
      const dpTestConn = await fetch(`${BASE_URL}/api/email-notifications/test-connection`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${dpTok}` }
      });
      const saTestConnNoSecrets = await fetch(`${BASE_URL}/api/email-notifications/test-connection`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${saTok}` }
      });
      const saTestConnNoSecretsJson = await saTestConnNoSecrets.json();

      assertCheck(
        'ExpressAPI',
        'Superadmin accesses config, save, templates, DEMO preview, logs, manual summary, and test-connection RBAC',
        saCfg.status === 200 &&
          saCfgJson.success === true &&
          saSaveCfg.status === 200 &&
          saTpl.status === 200 &&
          saTplJson.templates?.length === 7 &&
          saPrev.status === 200 &&
          String(saPrevJson.htmlBody || '').includes('DEMO') &&
          saLogs.status === 200 &&
          saManualSummary.status === 200 &&
          unauthTestConn.status === 401 &&
          dpTestConn.status === 403 &&
          saTestConnNoSecrets.status === 400 &&
          saTestConnNoSecretsJson.success === false &&
          !('smtpPass' in (saCfgJson.providerHealth || {})) &&
          !('pass' in (saCfgJson.providerHealth || {})),
        `cfg=${saCfg.status}, testConnUnauth=${unauthTestConn.status}, testConnDispatch=${dpTestConn.status}, testConnSaNoCreds=${saTestConnNoSecrets.status}`
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

      // ---------------------------------------------------------------------
      // 4. Staging HTTP End-to-End Scenarios A-F (Assign, Reassign, Idempotency)
      // ---------------------------------------------------------------------
      const certDir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'morajaws-smtp-e2e-'));
      const keyFile4 = path.join(certDir4, 'key.pem');
      const certFile4 = path.join(certDir4, 'cert.pem');
      execFileSync(
        'openssl',
        [
          'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
          '-keyout', keyFile4, '-out', certFile4,
          '-days', '1', '-subj', '/CN=127.0.0.1'
        ],
        { stdio: 'ignore' }
      );
      const tlsOpts4 = { key: fs.readFileSync(keyFile4), cert: fs.readFileSync(certFile4) };
      const receivedMails: Array<{ rcptTo: string[]; rawData: string; decodedData: string }> = [];

      const smtpServer4 = net.createServer(rawSocket => {
        let curSock: net.Socket | tls.TLSSocket = rawSocket;
        let buf = '';
        let inData = false;
        let authStage: 'none' | 'user' | 'pass' = 'none';
        let upgraded = false;
        let currentMail: { rcptTo: string[]; rawData: string } = { rcptTo: [], rawData: '' };

        const writeLine = (l: string) => curSock.write(`${l}\r\n`);
        const bind = (sock: net.Socket | tls.TLSSocket) => {
          sock.on('data', chunk => {
            buf += chunk.toString('utf8');
            while (true) {
              if (inData) {
                const idx = buf.indexOf('\r\n.\r\n');
                if (idx === -1) break;
                currentMail.rawData += buf.slice(0, idx);
                buf = buf.slice(idx + 5);
                inData = false;
                const decodedData = currentMail.rawData
                  .replace(/=\r?\n/g, '')
                  .replace(/\r?\n[ \t]+/g, ' ');
                receivedMails.push({ ...currentMail, decodedData });
                writeLine(`250 2.0.0 OK id=e2e-msg-${receivedMails.length}`);
                continue;
              }
              const nl = buf.indexOf('\r\n');
              if (nl === -1) break;
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 2);
              if (authStage === 'user') {
                authStage = 'pass';
                writeLine('334 UGFzc3dvcmQ6');
                continue;
              }
              if (authStage === 'pass') {
                authStage = 'none';
                writeLine('235 2.7.0 Authentication successful');
                continue;
              }
              const u = line.toUpperCase();
              if (u.startsWith('EHLO') || u.startsWith('HELO')) {
                writeLine('250-127.0.0.1 Hello');
                if (!upgraded) writeLine('250-STARTTLS');
                writeLine('250 AUTH PLAIN LOGIN');
              } else if (u === 'STARTTLS') {
                writeLine('220 2.0.0 Ready to start TLS');
                const tlsSock = new tls.TLSSocket(rawSocket, { isServer: true, ...tlsOpts4 });
                upgraded = true;
                rawSocket.removeAllListeners('data');
                curSock = tlsSock;
                bind(tlsSock);
              } else if (u.startsWith('AUTH PLAIN')) {
                writeLine('235 2.7.0 Authentication successful');
              } else if (u.startsWith('AUTH LOGIN')) {
                authStage = 'user';
                writeLine('334 VXNlcm5hbWU6');
              } else if (u.startsWith('MAIL FROM:')) {
                currentMail = { rcptTo: [], rawData: '' };
                writeLine('250 2.1.0 OK');
              } else if (u.startsWith('RCPT TO:')) {
                currentMail.rcptTo.push(line.slice(8).trim());
                writeLine('250 2.1.5 OK');
              } else if (u === 'DATA') {
                inData = true;
                writeLine('354 Start mail input; end with <CRLF>.<CRLF>');
              } else if (u === 'QUIT') {
                writeLine('221 2.0.0 Bye');
                sock.end();
              } else {
                writeLine('250 OK');
              }
            }
          });
        };
        bind(rawSocket);
        writeLine('220 127.0.0.1 ESMTP MoraJawsE2E');
      });

      await new Promise<void>(resolve => smtpServer4.listen(0, '127.0.0.1', () => resolve()));
      const smtpPort4 = (smtpServer4.address() as { port: number }).port;

      const waitForEmails = async (expectedCount: number, timeoutMs = 2500) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (receivedMails.length >= expectedCount) {
            await new Promise(r => setTimeout(r, 80));
            return;
          }
          await new Promise(r => setTimeout(r, 40));
        }
      };

      try {
        process.env.SMTP_HOST = '127.0.0.1';
        process.env.SMTP_PORT = String(smtpPort4);
        process.env.SMTP_SECURE = 'false';
        process.env.SMTP_USER = 'sender.morajaws@gmail.com';
        process.env.SMTP_PASS = 'staging-app-secret-999';
        process.env.EMAIL_FROM = 'MoraJaws <sender.morajaws@gmail.com>';
        process.env.EMAIL_REPLY_TO = 'sender.morajaws@gmail.com';
        process.env.SMTP_TEST_ALLOW_SELF_SIGNED = '1';

        // Reset local email store & test default auto-enable when SMTP secrets exist
        delete serverDb.emailNotificationConfig;
        if (serverDb.appSettings) delete serverDb.appSettings.email_notification_settings;
        serverDb.emailNotificationQueue = [];
        serverDb.emailDeliveryLogs = [];
        resetEmailServiceCachesForTesting();

        // Seed staging WOs and installers cleanly in memory
        serverDb.users.push(
          {
            id: 'inst-staging-noemail',
            username: 'inst_noemail_staging',
            name: 'Teknisi Tanpa Email Staging',
            passwordHash: 'test_hash_unused',
            role: 'installer',
            contractor: 'PT Mitra Jaringan Solusi',
            contractorId: 'c-mjs',
            area: 'Jakarta Selatan',
            email: '',
            active: true,
            isDeleted: false,
            createdAt: nowIso
          },
          {
            id: 'inst-staging-b',
            username: 'inst_b_staging',
            name: 'Budi Staging',
            passwordHash: 'test_hash_unused',
            role: 'installer',
            contractor: 'PT Mitra Jaringan Solusi',
            contractorId: 'c-mjs',
            area: 'Jakarta Selatan',
            email: 'budi.staging@installer.morajaws.net',
            active: true,
            isDeleted: false,
            createdAt: nowIso
          }
        );
        const stagingWoA = {
          id: 'wo-staging-001',
          woNumber: 'WO-STG-001',
          customerId: '7778889',
          idCustomer: '7778889',
          customerName: 'Pelanggan Staging Alpha',
          streetName: 'Jl. Kemang Selatan No. 88',
          area: 'Jakarta Selatan',
          contactorName: 'PT Mitra Jaringan Solusi',
          contractorName: 'PT Mitra Jaringan Solusi',
          appointmentDate: opDate,
          slotTime: '10:00 - 12:00',
          statusWOAgent: 'Open',
          statusWOInstaller: 'Unassigned',
          distributionStatus: 'distributed'
        };
        const stagingWoUnassignedReassign = {
          id: 'wo-staging-002',
          woNumber: 'WO-STG-002',
          customerId: '7778890',
          idCustomer: '7778890',
          customerName: 'Pelanggan Staging Unassigned',
          streetName: 'Jl. Antasari No. 12',
          area: 'Jakarta Selatan',
          contactorName: 'PT Mitra Jaringan Solusi',
          contractorName: 'PT Mitra Jaringan Solusi',
          appointmentDate: opDate,
          slotTime: '13:00 - 15:00',
          statusWOAgent: 'Open',
          statusWOInstaller: 'Unassigned',
          distributionStatus: 'distributed'
        };
        serverDb.tickets.push(stagingWoA, stagingWoUnassignedReassign);

        const instAUser = serverDb.users.find((u: any) => u.id === 'u-installer-1');
        if (instAUser) {
          instAUser.email = instAUser.email || 'andi@installer.morajaws.net';
          instAUser.contractor = 'PT Mitra Jaringan Solusi';
          instAUser.area = 'Jakarta Selatan';
        }

        // Scenario A: Leader assigns WO to Installer A (using installerId only, testing no .trim() crash + auto-enabled SMTP)
        const assignARes = await fetch(`${BASE_URL}/api/tickets/assign`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ldTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId: 'wo-staging-001', installerId: 'u-installer-1' })
        });
        await waitForEmails(1);
        const mailA = receivedMails[0];
        const logsAfterA = (serverDb.emailDeliveryLogs || []).filter(
          (l: any) => l.relatedWoNumber === 'WO-STG-001' && l.deliveryStatus === 'sent'
        );
        assertCheck(
          'ScenarioA_Assign',
          'Leader Assign WO sends WO_ASSIGNED HTML email to Installer A with full WO & CTA details',
          assignARes.status === 200 &&
            receivedMails.length === 1 &&
            Boolean(mailA?.rcptTo.some(r => r.includes(instAUser.email))) &&
            mailA.decodedData.includes('WO-STG-001') &&
            mailA.decodedData.includes('7778889') &&
            mailA.decodedData.includes('Pelanggan Staging Alpha') &&
            mailA.decodedData.includes('Jakarta Selatan') &&
            mailA.decodedData.includes('10:00 - 12:00') &&
            mailA.decodedData.includes('PT Mitra Jaringan Solusi') &&
            mailA.decodedData.includes('Hendra Gunawan') &&
            mailA.decodedData.includes('Open WO di MoraJaws') &&
            !mailA.rawData.includes('staging-app-secret-999') &&
            logsAfterA.length === 1 &&
            logsAfterA[0]?.metadata?.eventTypeLabel === 'WO_ASSIGNED',
          `status=${assignARes.status}, mails=${receivedMails.length}, logs=${logsAfterA.length}`
        );

        // Scenario C (before reassign): Re-assigning same Installer A sends 0 emails
        const countBeforeSame = receivedMails.length;
        const assignSameRes = await fetch(`${BASE_URL}/api/tickets/assign`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ldTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId: 'wo-staging-001', installerId: 'u-installer-1' })
        });
        await new Promise(r => setTimeout(r, 150));
        assertCheck(
          'ScenarioC_DuplicateGuard',
          'Re-assigning identical Installer A produces 0 duplicate emails',
          assignSameRes.status === 200 && receivedMails.length === countBeforeSame,
          `mailsBefore=${countBeforeSame}, mailsAfter=${receivedMails.length}`
        );

        // Scenario B: Reassign Installer A -> Installer B (using newInstallerId only)
        const countBeforeReassign = receivedMails.length;
        const reassignABRes = await fetch(`${BASE_URL}/api/tickets/reassign`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ldTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId: 'wo-staging-001',
            newInstallerId: 'inst-staging-b',
            reason: 'Teknisi sebelumnya overload di cluster lain'
          })
        });
        await waitForEmails(countBeforeReassign + 2);
        const reassignMails = receivedMails.slice(countBeforeReassign);
        const prevMail = reassignMails.find(m => m.rcptTo.some(r => r.includes(instAUser.email)));
        const newMail = reassignMails.find(m => m.rcptTo.some(r => r.includes('budi.staging@installer.morajaws.net')));
        const reassignLogs = (serverDb.emailDeliveryLogs || []).filter(
          (l: any) =>
            l.relatedWoNumber === 'WO-STG-001' &&
            l.notificationType === 'wo_reassigned' &&
            l.deliveryStatus === 'sent'
        );

        // Edge case B2: Reassigning an UNASSIGNED WO must act as NEW ASSIGNMENT (WO_ASSIGNED, 1 email)
        const countBeforeUnassignedReassign = receivedMails.length;
        const unassignedReassignRes = await fetch(`${BASE_URL}/api/tickets/reassign`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ldTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId: 'wo-staging-002',
            newInstallerId: 'inst-staging-b',
            reason: 'Penugasan awal via modal reassign'
          })
        });
        await waitForEmails(countBeforeUnassignedReassign + 1);
        const unassignedMailCount = receivedMails.length - countBeforeUnassignedReassign;
        const unassignedLog = (serverDb.emailDeliveryLogs || []).find(
          (l: any) => l.relatedWoNumber === 'WO-STG-002' && l.deliveryStatus === 'sent'
        );

        // Edge case B3: Switching Installer via /api/work-orders/:id/assign sends WO_REASSIGNED (2 emails)
        const countBeforeAssignSwitch = receivedMails.length;
        const switchViaAssignRes = await fetch(`${BASE_URL}/api/work-orders/wo-staging-001/assign`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ldTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ installerId: 'u-installer-1' })
        });
        await waitForEmails(countBeforeAssignSwitch + 2);
        const switchCount = receivedMails.length - countBeforeAssignSwitch;

        assertCheck(
          'ScenarioB_Reassign',
          'Reassign notifies prev & new Installer; unassigned reassign treats as WO_ASSIGNED; /assign switch emits WO_REASSIGNED',
          reassignABRes.status === 200 &&
            reassignMails.length === 2 &&
            Boolean(prevMail) &&
            prevMail!.decodedData.includes('Budi Staging') &&
            Boolean(newMail) &&
            newMail!.decodedData.includes('Andi Saputra') &&
            newMail!.decodedData.includes('Hendra Gunawan') &&
            reassignLogs.length >= 2 &&
            reassignLogs.some((l: any) => l.metadata?.previousInstaller === 'Andi Saputra' && l.metadata?.newInstaller === 'Budi Staging') &&
            unassignedReassignRes.status === 200 &&
            unassignedMailCount === 1 &&
            unassignedLog?.notificationType === 'wo_assigned_installer' &&
            switchViaAssignRes.status === 200 &&
            switchCount === 2,
          `reassignMails=${reassignMails.length}, unassignedMails=${unassignedMailCount}, switchAssignMails=${switchCount}`
        );

        // Scenario D: Installer with missing email -> assignment succeeds, delivery log skipped
        const countBeforeNoEmail = receivedMails.length;
        const noEmailAssignRes = await fetch(`${BASE_URL}/api/tickets/reassign`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ldTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId: 'wo-staging-002',
            newInstallerId: 'inst-staging-noemail',
            reason: 'Uji teknisi tanpa email valid'
          })
        });
        await waitForEmails(countBeforeNoEmail + 1);
        const skippedLogNoEmail = (serverDb.emailDeliveryLogs || []).find(
          (l: any) =>
            l.relatedWoNumber === 'WO-STG-002' &&
            l.recipientUserId === 'inst-staging-noemail' &&
            l.deliveryStatus === 'skipped'
        );
        assertCheck(
          'ScenarioD_InvalidEmail',
          'Assignment succeeds when Installer lacks email and delivery log records skipped status',
          noEmailAssignRes.status === 200 && Boolean(skippedLogNoEmail),
          `http=${noEmailAssignRes.status}, skippedReason=${skippedLogNoEmail?.errorMessage}`
        );

        // Scenario E: Provider outage -> assignment succeeds, notification marked retry_pending
        process.env.SMTP_PORT = '1';
        resetEmailServiceCachesForTesting();
        const outageRes = await fetch(`${BASE_URL}/api/tickets/reassign`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ldTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId: 'wo-staging-002',
            newInstallerId: 'u-installer-1',
            reason: 'Uji retry saat SMTP provider down'
          })
        });
        await new Promise(r => setTimeout(r, 350));
        const retryQueueItem = (serverDb.emailNotificationQueue || []).find(
          (q: any) =>
            q.relatedWoNumber === 'WO-STG-002' &&
            q.recipientUserId === 'u-installer-1' &&
            q.status === 'retry_pending'
        );
        const retryLogItem = (serverDb.emailDeliveryLogs || []).find(
          (l: any) =>
            l.relatedWoNumber === 'WO-STG-002' &&
            l.recipientUserId === 'u-installer-1' &&
            l.deliveryStatus === 'retry_pending'
        );
        assertCheck(
          'ScenarioE_ProviderOutage',
          'WO assignment succeeds on SMTP outage while email queue schedules retry_pending cleanly without secret leak',
          outageRes.status === 200 &&
            Boolean(retryQueueItem) &&
            retryQueueItem.retryCount === 1 &&
            Boolean(retryLogItem) &&
            !String(retryLogItem.errorMessage || '').includes('staging-app-secret-999'),
          `http=${outageRes.status}, queueStatus=${retryQueueItem?.status}, retryCount=${retryQueueItem?.retryCount}`
        );

        // Scenario F: Test Connection / Test Notification still works via HTTP
        process.env.SMTP_PORT = String(smtpPort4);
        resetEmailServiceCachesForTesting();
        const testConnHttp = await fetch(`${BASE_URL}/api/email-notifications/test-connection`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${saTok}` }
        });
        const testConnHttpJson = await testConnHttp.json();
        assertCheck(
          'ScenarioF_TestNotification',
          'Test Connection HTTP endpoint still succeeds and delivers self-email',
          testConnHttp.status === 200 && testConnHttpJson.success === true && Boolean(testConnHttpJson.providerMessageId),
          `http=${testConnHttp.status}, msgId=${testConnHttpJson.providerMessageId}`
        );
      } finally {
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_PORT;
        delete process.env.SMTP_SECURE;
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;
        delete process.env.EMAIL_FROM;
        delete process.env.EMAIL_REPLY_TO;
        delete process.env.SMTP_TEST_ALLOW_SELF_SIGNED;
        resetEmailServiceCachesForTesting();
        await new Promise<void>(resolve => smtpServer4.close(() => resolve()));
        fs.rmSync(certDir4, { recursive: true, force: true });
      }
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
