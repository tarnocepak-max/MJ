import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createExpressApp } from '../../server.ts';
import { evaluatePhotoEvidenceCompleteness } from './photoEvidenceValidation.ts';

// Minimal valid 1x1 PNG buffer (68 bytes)
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function jsonReq(baseUrl: string, urlPath: string, opts: RequestInit & { cookie?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) || {})
  };
  if (opts.cookie) {
    headers['Cookie'] = opts.cookie;
  }
  const resp = await fetch(`${baseUrl}${urlPath}`, { ...opts, headers });
  const body = await resp.json().catch(() => null);
  const setCookie = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
  return { status: resp.status, body, setCookie };
}

async function loginAndActivate(baseUrl: string, identifier: string): Promise<string> {
  const loginRes = await jsonReq(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password: '12345678' })
  });
  assert.equal(loginRes.status, 200, `Login failed for ${identifier}: ${JSON.stringify(loginRes.body)}`);
  let cookie = loginRes.setCookie
    .map((c: string) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
  assert.ok(cookie.includes('mora_access_token='));

  if (loginRes.body?.user?.mustChangePassword) {
    const newPw = 'Mora@99!';
    const chgRes = await jsonReq(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        currentPassword: '12345678',
        newPassword: newPw,
        confirmPassword: newPw
      })
    });
    assert.equal(chgRes.status, 200, `Change password failed: ${JSON.stringify(chgRes.body)}`);
    const rotated = chgRes.setCookie
      .map((c: string) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
    if (rotated.includes('mora_access_token=')) {
      cookie = rotated;
    }
  }
  return cookie;
}

test('End-to-end Evidence & Check-Out API flow enforces 3 mandatory photos, F5 persistence, optional separation, failure rejection, and idempotency', async () => {
  const dbPath = path.resolve(process.cwd(), 'data', 'morajaws_database.json');
  const hadDbFile = fs.existsSync(dbPath);
  const originalDbContent = hadDbFile ? fs.readFileSync(dbPath) : null;
  const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads', 'technical-reports');
  const hadUploadsDir = fs.existsSync(uploadsDir);

  process.env.LOCAL_DEVELOPMENT = 'true';
  const app = await createExpressApp({ skipVite: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 0. Login as leadermjs and ensure t-seed-1 is formally assigned by ID to u-installer-1
    const leaderCookie = await loginAndActivate(baseUrl, 'leadermjs');

    const assignRes = await jsonReq(baseUrl, '/api/work-orders/t-seed-1/assign', {
      method: 'POST',
      cookie: leaderCookie,
      body: JSON.stringify({ installerId: 'u-installer-1', installerName: 'Andi Saputra' })
    });
    assert.equal(assignRes.status, 200, `Expected assign 200, got ${assignRes.status}: ${JSON.stringify(assignRes.body)}`);
    const targetTicket = assignRes.body?.ticket || assignRes.body?.workOrder;
    assert.ok(targetTicket?.id, 'Expected valid target ticket assigned to installer1');

    // 1. Login as installer1
    const cookieHeader = await loginAndActivate(baseUrl, 'installer1');

    // 2. Fetch installer's assigned tickets via bootstrap
    const bootRes = await jsonReq(baseUrl, '/api/bootstrap', { cookie: cookieHeader });
    assert.equal(bootRes.status, 200);
    const tickets = bootRes.body?.tickets || [];
    assert.ok(tickets.length > 0, 'Expected at least 1 assigned ticket for installer1');

    const ticket = tickets.find((t: any) => t.id === targetTicket.id) || tickets[0];
    const ticketId = ticket.id;

    // Reset any pre-existing photoSlots on this test ticket in local memory via clean state? Wait: verify current state
    // Ensure ticket has PROGRESS LiveChat + check-in
    const chatRes = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        text: 'Teknisi tiba di lokasi pelanggan untuk Check-In',
        category: 'PROGRESS',
        woNumber: ticket.woNumber
      })
    });
    assert.equal(chatRes.status, 200);

    // Scenario 8: Failed / invalid image upload must be rejected (400) and NOT counted
    const badUpload = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/photo-evidence`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        slotKey: 'customer_house',
        title: 'Foto Lokasi Rumah',
        fileData: 'data:image/png;base64,AAAA', // invalid/too small
        fileName: 'bad.png',
        mimeType: 'image/png',
        capturedAt: new Date().toISOString(),
        clientCaptureId: 'bad_1',
        woNumber: ticket.woNumber
      })
    });
    assert.equal(badUpload.status, 400);
    assert.equal(badUpload.body?.success, false);

    // Upload Mandatory #1 (customer_house)
    const up1 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/photo-evidence`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        slotKey: 'customer_house',
        title: 'Foto Lokasi Rumah',
        fileData: `data:image/png;base64,${VALID_PNG_BASE64}`,
        fileName: 'house.png',
        mimeType: 'image/png',
        capturedAt: new Date().toISOString(),
        latitude: -6.2088,
        longitude: 106.8456,
        gpsAccuracyMeters: 12,
        clientCaptureId: 'cap_house_1',
        woNumber: ticket.woNumber
      })
    });
    assert.equal(up1.status, 200);
    assert.ok(up1.body?.photoSlot?.url?.startsWith('/api/storage/adapter/download'));
    assert.equal(evaluatePhotoEvidenceCompleteness(up1.body?.ticket?.technicalReport?.photoSlots).mandatoryCount, 1);

    // Scenario 1: Check-Out after only Mandatory #1 -> must be rejected (400)
    const co1 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/progress-report`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        status: 'Completed',
        reportStatusLabel: 'COMPLETE',
        reasonReportLabel: 'Instalasi Selesai',
        remarks: 'Tes checkout 1 foto',
        idempotencyKey: 'co_fail_1'
      })
    });
    assert.equal(co1.status, 400);
    assert.equal(co1.body?.code, 'PHOTO_EVIDENCE_INCOMPLETE');
    assert.equal(co1.body?.mandatoryCount, 1);

    // Upload Mandatory #2 (fat_pole)
    const up2 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/photo-evidence`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        slotKey: 'fat_pole',
        title: 'Foto Lokasi FAT',
        fileData: `data:image/png;base64,${VALID_PNG_BASE64}`,
        fileName: 'fat_pole.png',
        mimeType: 'image/png',
        capturedAt: new Date().toISOString(),
        clientCaptureId: 'cap_fat_2',
        woNumber: ticket.woNumber
      })
    });
    assert.equal(up2.status, 200);
    assert.equal(evaluatePhotoEvidenceCompleteness(up2.body?.ticket?.technicalReport?.photoSlots).mandatoryCount, 2);

    // Upload Optional #4 (fat_port) & #7 (opm) while Mandatory #3 is STILL missing
    const upOpt1 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/photo-evidence`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        slotKey: 'fat_port',
        title: 'Foto Port FAT',
        fileData: `data:image/png;base64,${VALID_PNG_BASE64}`,
        fileName: 'fat_port.png',
        mimeType: 'image/png',
        capturedAt: new Date().toISOString(),
        clientCaptureId: 'cap_opt_4',
        woNumber: ticket.woNumber
      })
    });
    assert.equal(upOpt1.status, 200);

    // Scenario 4b: Even with 2 mandatory + 1 optional (3 total), mandatory MUST stay 2/3 and Check-Out MUST reject naming slot #3!
    const evalBefore3 = evaluatePhotoEvidenceCompleteness(upOpt1.body?.ticket?.technicalReport?.photoSlots);
    assert.equal(evalBefore3.mandatoryCount, 2);
    assert.equal(evalBefore3.verifiedTotalCount, 3);
    assert.equal(evalBefore3.isMandatoryComplete, false);

    const co2 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/progress-report`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        status: 'Completed',
        reportStatusLabel: 'COMPLETE',
        reasonReportLabel: 'Instalasi Selesai',
        remarks: 'Tes checkout kurang wajib #3',
        idempotencyKey: 'co_fail_2'
      })
    });
    assert.equal(co2.status, 400);
    assert.equal(co2.body?.code, 'PHOTO_EVIDENCE_INCOMPLETE');
    assert.equal(co2.body?.mandatoryCount, 2);
    assert.match(co2.body?.error || '', /No\. 3|Foto Redaman FAT/i);

    // Scenario 3: Upload Mandatory #3 (fat_attenuation)
    const up3 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/photo-evidence`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        slotKey: 'fat_attenuation',
        title: 'Foto Redaman FAT',
        fileData: `data:image/png;base64,${VALID_PNG_BASE64}`,
        fileName: 'fat_att.png',
        mimeType: 'image/png',
        capturedAt: new Date().toISOString(),
        latitude: -6.2091,
        longitude: 106.8461,
        gpsAccuracyMeters: 15,
        clientCaptureId: 'cap_fat_att_3',
        woNumber: ticket.woNumber
      })
    });
    assert.equal(up3.status, 200);
    const evalReady = evaluatePhotoEvidenceCompleteness(up3.body?.ticket?.technicalReport?.photoSlots);
    assert.equal(evalReady.mandatoryCount, 3);
    assert.equal(evalReady.verifiedTotalCount, 4);
    assert.equal(evalReady.isMandatoryComplete, true);

    // Scenario 4a: Upload another optional photo (#7 opm) AFTER 3/3 mandatory -> mandatory stays 3/3, total becomes 5/7
    const upOpt2 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/photo-evidence`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify({
        slotKey: 'opm',
        title: 'Foto Hasil OPM',
        fileData: `data:image/png;base64,${VALID_PNG_BASE64}`,
        fileName: 'opm.png',
        mimeType: 'image/png',
        capturedAt: new Date().toISOString(),
        clientCaptureId: 'cap_opt_7',
        woNumber: ticket.woNumber
      })
    });
    assert.equal(upOpt2.status, 200);
    const evalAfterOpt2 = evaluatePhotoEvidenceCompleteness(upOpt2.body?.ticket?.technicalReport?.photoSlots);
    assert.equal(evalAfterOpt2.mandatoryCount, 3);
    assert.equal(evalAfterOpt2.verifiedTotalCount, 5);
    assert.equal(evalAfterOpt2.isMandatoryComplete, true);

    // Scenarios 5 & 6: Simulate F5 refresh + re-open WO detail via GET /api/work-orders/:id
    const detailRes = await jsonReq(baseUrl, `/api/work-orders/${encodeURIComponent(ticketId)}?include=messages`, {
      cookie: cookieHeader
    });
    assert.equal(detailRes.status, 200);
    const hydratedEval = evaluatePhotoEvidenceCompleteness(detailRes.body?.ticket?.technicalReport?.photoSlots);
    assert.equal(hydratedEval.mandatoryCount, 3);
    assert.equal(hydratedEval.verifiedTotalCount, 5);
    assert.equal(hydratedEval.isMandatoryComplete, true);

    // Scenarios 7 & 10: Check-Out succeeds AND repeated rapid/idempotent Check-Out creates only ONE report entry
    const coPayload = {
      status: 'Completed',
      reportStatusLabel: 'COMPLETE',
      reasonReportLabel: 'Instalasi Selesai',
      remarks: 'Instalasi FTTH selesai & OPM pass',
      idempotencyKey: 'co_final_key_1',
      technicalTelemetry: {
        opticalPowerDbm: '-18.5 dBm',
        photoSlots: hydratedEval.verifiedSlots
      }
    };

    const coSuccess1 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/progress-report`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify(coPayload)
    });
    assert.equal(coSuccess1.status, 200);
    assert.equal(coSuccess1.body?.success, true);
    const reportCountAfterFirst = coSuccess1.body?.ticket?.progressReports?.length || 0;
    assert.ok(reportCountAfterFirst >= 1);

    // Repeat submission with same idempotencyKey (double-click / retry)
    const coSuccess2 = await jsonReq(baseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/progress-report`, {
      method: 'POST',
      cookie: cookieHeader,
      body: JSON.stringify(coPayload)
    });
    assert.equal(coSuccess2.status, 200);
    assert.equal(coSuccess2.body?.success, true);
    assert.equal(coSuccess2.body?.deduplicated, true);
    assert.equal(coSuccess2.body?.ticket?.progressReports?.length, reportCountAfterFirst);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    // Restore original database.json state cleanly
    if (hadDbFile && originalDbContent) {
      fs.writeFileSync(dbPath, originalDbContent);
    } else if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (!hadUploadsDir && fs.existsSync(uploadsDir)) {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }
  }
});
