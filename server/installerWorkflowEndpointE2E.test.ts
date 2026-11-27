import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createExpressApp, SERVER_SESSIONS } from '../server.ts';
import {
  setSupabaseBackendClientForTesting,
  resetSupabaseBackendClientForTesting
} from '../server/supabaseClient.ts';
import { INITIAL_HIERARCHICAL_DROPLISTS } from '../src/constants/hierarchicalDroplists.ts';

function getTodayWibDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function createInMemorySupabaseMock() {
  const todayWib = getTodayWibDate();
  const installerUser = {
    id: 'inst-e2e-01',
    name: 'Rudi Pratama E2E',
    username: 'rudi_e2e',
    email: 'rudi_e2e@morajaws.local',
    role: 'installer',
    contractor: 'Mitra BDG-02',
    area: 'Bandung',
    active: true,
    is_deleted: false,
    created_at: '2026-01-01T00:00:00Z'
  };

  let woRow: any = {
    id: 'wo-e2e-100',
    wo_number: 'WO-E2E-20261128-100',
    customer_id: '1002345',
    customer_name: 'Bpk. Hendra Gunawan',
    customer_phone: '081234567890',
    address: 'Jl. Melati No. 14, Arcamanik, Bandung',
    contractor_id: 'c-bdg-02',
    contractor_name: 'Mitra BDG-02',
    contactor_name: 'Mitra BDG-02',
    area: 'Bandung',
    appointment_date: todayWib,
    slot_time: '09:00 - 11:00',
    installer_id: 'inst-e2e-01',
    installer_user_id: 'inst-e2e-01',
    installer_name: 'Rudi Pratama E2E',
    status_wo_installer: 'Assigned',
    status_wo_agent: 'In Progress',
    work_session_status: 'Belum Check-in',
    check_in_at: null,
    check_out_at: null,
    is_deleted: false,
    updated_at: new Date().toISOString(),
    payload: {
      id: 'wo-e2e-100',
      woNumber: 'WO-E2E-20261128-100',
      customerId: '1002345',
      customerName: 'Bpk. Hendra Gunawan',
      customerPhone: '081234567890',
      address: 'Jl. Melati No. 14, Arcamanik, Bandung',
      contractorId: 'c-bdg-02',
      contractorName: 'Mitra BDG-02',
      contactorName: 'Mitra BDG-02',
      area: 'Bandung',
      appointmentDate: todayWib,
      appointmentSlot: '09:00 - 11:00',
      installerId: 'inst-e2e-01',
      installerUserId: 'inst-e2e-01',
      installerName: 'Rudi Pratama E2E',
      statusWOInstaller: 'Assigned',
      statusWOAgent: 'In Progress',
      workSessionStatus: 'Belum Check-in',
      workSessions: [],
      progressReports: [],
      technicalReport: {
        photoSlots: [],
        photos: []
      }
    }
  };

  const ticketMessages: any[] = [];
  const photoEvidenceRows: any[] = [];
  const auditLogs: any[] = [];
  const notifications: any[] = [];

  const appSettingsRows: Record<string, any> = {
    hierarchical_droplists: {
      setting_key: 'hierarchical_droplists',
      setting_value: INITIAL_HIERARCHICAL_DROPLISTS,
      version: 1,
      updated_at: new Date().toISOString()
    },
    chat_categories: {
      setting_key: 'chat_categories',
      setting_value: [
        { id: 'cat-progress', name: 'PROGRESS', active: true },
        { id: 'cat-koordinasi', name: 'KOORDINASI', active: true },
        { id: 'cat-konfirmasi', name: 'KONFIRMASI', active: true }
      ],
      version: 1,
      updated_at: new Date().toISOString()
    }
  };

  function makeQuery(rowsProvider: () => any[]) {
    const filters: Array<(row: any) => boolean> = [];
    let isSingle = false;
    let isMaybeSingle = false;

    const execute = async () => {
      let data = rowsProvider().filter(r => filters.every(fn => fn(r)));
      if (isSingle) {
        return data.length > 0
          ? { data: { ...data[0] }, error: null }
          : { data: null, error: { message: 'Not found', code: 'PGRST116' } };
      }
      if (isMaybeSingle) {
        return { data: data.length > 0 ? { ...data[0] } : null, error: null };
      }
      return { data: data.map(r => ({ ...r })), error: null, count: data.length };
    };

    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => {
        filters.push(r => r && r[col] === val);
        return builder;
      },
      neq: (col: string, val: any) => {
        filters.push(r => r && r[col] !== val);
        return builder;
      },
      ilike: (col: string, val: any) => {
        const needle = String(val || '').toLowerCase();
        filters.push(r => r && String(r[col] || '').toLowerCase() === needle);
        return builder;
      },
      in: (col: string, vals: any[]) => {
        filters.push(r => r && (vals || []).includes(r[col]));
        return builder;
      },
      or: (expr: string) => {
        // Basic support for ticket_id.eq.X,wo_number.eq.X
        const parts = String(expr || '').split(',').map(p => p.trim());
        filters.push(r =>
          parts.some(p => {
            const m = p.match(/^([a-zA-Z0-9_]+)\.eq\.(.+)$/);
            if (!m) return true;
            return String(r?.[m[1]] || '') === m[2];
          })
        );
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      not: () => builder,
      is: (col: string, val: any) => {
        filters.push(r => (val === null ? r?.[col] == null : r?.[col] === val));
        return builder;
      },
      filter: () => builder,
      contains: (col: string, val: any) => {
        filters.push(r => {
          const target = r?.[col];
          if (!target || typeof target !== 'object') return false;
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.entries(val).every(([k, v]) => target[k] === v);
          }
          return false;
        });
        return builder;
      },
      gt: () => builder,
      gte: () => builder,
      lt: () => builder,
      lte: () => builder,
      single: async () => {
        isSingle = true;
        return execute();
      },
      maybeSingle: async () => {
        isMaybeSingle = true;
        return execute();
      },
      then: (resolve: (v: any) => any, reject?: (e: any) => any) => execute().then(resolve, reject)
    };
    return builder;
  }

  const client: any = {
    from: (table: string) => {
      if (table === 'work_orders') {
        return {
          select: () => makeQuery(() => [woRow]),
          update: (updates: any) => ({
            eq: (_col: string, _val: any) => {
              const applyUpdate = () => {
                const { payload: pUpd, ...direct } = updates || {};
                Object.assign(woRow, direct);
                if (pUpd) {
                  woRow.payload = { ...(woRow.payload || {}), ...pUpd };
                }
                return { ...woRow };
              };
              return {
                select: () => ({
                  single: async () => ({ data: applyUpdate(), error: null }),
                  maybeSingle: async () => ({ data: applyUpdate(), error: null })
                }),
                then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
                  Promise.resolve({ data: [applyUpdate()], error: null }).then(resolve, reject)
              };
            }
          })
        };
      }

      if (table === 'ticket_messages') {
        return {
          select: () => makeQuery(() => ticketMessages),
          insert: (rows: any[]) => {
            const inserted = (rows || []).map(r => ({ ...r }));
            ticketMessages.push(...inserted);
            return {
              select: () => ({
                maybeSingle: async () => ({ data: inserted[0] ? { ...inserted[0] } : null, error: null }),
                single: async () => ({ data: inserted[0] ? { ...inserted[0] } : null, error: null })
              }),
              then: (resolve: (v: any) => any) => Promise.resolve({ data: inserted, error: null }).then(resolve)
            };
          },
          update: (upd: any) => ({
            eq: (col: string, val: any) => {
              ticketMessages.forEach(m => {
                if (m[col] === val) Object.assign(m, upd);
              });
              return Promise.resolve({ data: [], error: null });
            }
          })
        };
      }

      if (table === 'wo_photo_evidence') {
        return {
          select: () => makeQuery(() => photoEvidenceRows),
          upsert: async (rows: any[]) => {
            for (const row of rows || []) {
              const idx = photoEvidenceRows.findIndex(
                p => p.ticket_id === row.ticket_id && p.slot_key === row.slot_key
              );
              if (idx >= 0) photoEvidenceRows[idx] = { ...row };
              else photoEvidenceRows.push({ ...row });
            }
            return { error: null };
          }
        };
      }

      if (table === 'app_settings') {
        return {
          select: () => makeQuery(() => Object.values(appSettingsRows)),
          upsert: async () => ({ error: null })
        };
      }

      if (table === 'users') {
        return {
          select: () => makeQuery(() => [installerUser])
        };
      }

      if (table === 'audit_logs') {
        return {
          insert: (rows: any[]) => {
            auditLogs.push(...(rows || []));
            return Promise.resolve({ data: rows, error: null });
          },
          select: () => makeQuery(() => auditLogs)
        };
      }

      if (table === 'notifications') {
        return {
          insert: (rows: any[]) => {
            notifications.push(...(rows || []));
            return Promise.resolve({ data: rows, error: null });
          },
          select: () => makeQuery(() => notifications)
        };
      }

      return {
        select: () => makeQuery(() => []),
        insert: () => Promise.resolve({ data: [], error: null }),
        update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        upsert: () => Promise.resolve({ error: null })
      };
    }
  };

  return {
    client,
    installerUser,
    getWoRow: () => woRow,
    setPhotoSlots: (slots: any[]) => {
      woRow.payload.technicalReport = {
        ...(woRow.payload.technicalReport || {}),
        photoSlots: slots,
        photos: slots.map(s => s.url)
      };
      photoEvidenceRows.length = 0;
      for (const s of slots) {
        photoEvidenceRows.push({
          id: s.id,
          ticket_id: woRow.id,
          wo_number: woRow.wo_number,
          slot_key: s.slotKey,
          slot_title: s.title,
          photo_url: s.url,
          storage_path: s.storagePath,
          capture_method: s.captureMethod || 'camera',
          latitude: s.latitude,
          longitude: s.longitude,
          geotag_status: s.geotagStatus || 'verified',
          captured_at: s.capturedAtIso || new Date().toISOString(),
          uploaded_at: s.uploadedAt || new Date().toISOString(),
          technician_id: installerUser.id,
          technician_name: installerUser.name,
          metadata: {}
        });
      }
    }
  };
}

function makeEvidenceSlot(slotKey: string, captureMethod: 'camera' | 'gallery' = 'camera') {
  const nowIso = new Date().toISOString();
  return {
    id: `evd_${slotKey}_${Date.now()}`,
    slotKey,
    title: slotKey,
    url: `/api/storage/public/wo_photo_evidence/wo-e2e-100/${slotKey}.jpg`,
    storagePath: `wo_photo_evidence/wo-e2e-100/${slotKey}.jpg`,
    capturedAt: '10:15:00',
    capturedAtIso: nowIso,
    uploadedAt: nowIso,
    uploadStatus: 'uploaded',
    captureMethod,
    latitude: -6.9175,
    longitude: 107.6191,
    gpsAccuracyMeters: 8,
    geotagStatus: 'verified',
    clientCaptureId: `cap_${slotKey}_001`
  };
}

test('End-to-End Express API: Check-In decoupling, Camera+GPS check-in, 4-photo Unsuccess vs 3-photo Complete, and L1/L2 parent-child validation', async () => {
  const mock = createInMemorySupabaseMock();
  setSupabaseBackendClientForTesting(mock.client);

  const sessionToken = 'e2e_inst_tok_' + Date.now();
  const nowIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  SERVER_SESSIONS.push({
    sessionId: 'sess_e2e_inst_01',
    token: sessionToken,
    userId: mock.installerUser.id,
    username: mock.installerUser.username,
    name: mock.installerUser.name,
    role: 'installer',
    contractor: mock.installerUser.contractor,
    contractorId: 'c-bdg-02',
    area: mock.installerUser.area,
    sessionVersion: 1,
    loginAt: nowIso,
    lastActivityAt: nowIso,
    expiresAt: futureIso,
    status: 'active',
    ipAddress: '127.0.0.1',
    userAgent: 'EndpointE2ETest',
    deviceType: 'mobile'
  } as any);

  const app = await createExpressApp({ deferVite: true });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const apiCall = async (method: string, route: string, body?: any) => {
    const res = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  try {
    // 1. LiveChat PROGRESS does NOT check in WO
    const chatRes = await apiCall('POST', '/api/tickets/wo-e2e-100/messages', {
      text: 'Sedang koordinasi menuju lokasi pelanggan',
      category: 'PROGRESS',
      clientMessageId: 'cli_msg_progress_1'
    });
    assert.equal(chatRes.status, 200);
    assert.equal(chatRes.json.success, true);
    assert.equal(chatRes.json.checkInTriggered, false);
    assert.equal(chatRes.json.checkedIn, false);
    assert.equal(chatRes.json.hasProgressTrigger, false);
    assert.equal(Boolean(chatRes.json.message?.isCheckIn), false);
    assert.equal(mock.getWoRow().check_in_at, null);
    assert.equal((mock.getWoRow().payload.workSessions || []).length, 0);

    // 2. Submitting report before Check-In must fail with 400 CHECK_IN_REQUIRED
    const preCheckInReport = await apiCall('POST', '/api/tickets/wo-e2e-100/progress-report', {
      reportStatusId: 'hs-complete',
      reportStatusLabel: 'COMPLETE',
      reasonReportId: 'hr-c1',
      reasonReportLabel: 'Instalasi & Aktivasi Sukses (Online)',
      remarks: 'Attempt before check-in'
    });
    assert.equal(preCheckInReport.status, 400);
    assert.equal(preCheckInReport.json.code, 'CHECK_IN_REQUIRED');

    // 3. Check-In without customer_house photo fails with 400 CHECKIN_PHOTO_REQUIRED
    const checkInNoPhoto = await apiCall('POST', '/api/tickets/wo-e2e-100/check-in', {
      latitude: -6.9175,
      longitude: 107.6191
    });
    assert.equal(checkInNoPhoto.status, 400);
    assert.equal(checkInNoPhoto.json.code, 'CHECKIN_PHOTO_REQUIRED');

    // 4. Check-In with gallery photo fails with 400 GALLERY_FORBIDDEN_FOR_CHECKIN
    mock.setPhotoSlots([makeEvidenceSlot('customer_house', 'gallery')]);
    const checkInGallery = await apiCall('POST', '/api/tickets/wo-e2e-100/check-in', {
      latitude: -6.9175,
      longitude: 107.6191
    });
    assert.equal(checkInGallery.status, 400);
    assert.equal(checkInGallery.json.code, 'GALLERY_FORBIDDEN_FOR_CHECKIN');

    // 5. Real Camera + GPS Check-In succeeds
    const houseCamSlot = makeEvidenceSlot('customer_house', 'camera');
    mock.setPhotoSlots([houseCamSlot]);
    const checkInOk = await apiCall('POST', '/api/tickets/wo-e2e-100/check-in', {
      latitude: -6.9175,
      longitude: 107.6191,
      accuracyMeters: 8,
      clientCaptureId: houseCamSlot.clientCaptureId,
      photoSlotId: houseCamSlot.id
    });
    assert.equal(checkInOk.status, 200);
    assert.equal(checkInOk.json.success, true);
    assert.ok(checkInOk.json.checkInAt, 'checkInAt must be set');
    assert.equal(checkInOk.json.workSessionStatus, 'Sedang Dikerjakan');
    assert.equal(checkInOk.json.workSessions.length, 1);

    // 6. Set 3 mandatory photos -> Unsuccess MUST FAIL (requires 4), Complete MUST PASS (requires 3)
    mock.setPhotoSlots([
      houseCamSlot,
      makeEvidenceSlot('fat_pole'),
      makeEvidenceSlot('fat_attenuation')
    ]);

    for (const [statusId, statusLabel, reasonId, reasonLabel] of [
      ['hs-pending', 'PENDING', 'hr-p1', 'Kendala Redaman Tinggi / LOS'],
      ['hs-enroute', 'RESCHEDULE', 'hr-er1', 'Teknisi Sedang Menuju Lokasi'],
      ['hs-cancel', 'CANCEL', 'hr-can1', 'Pelanggan Berhenti Berlangganan']
    ]) {
      const failUnsuccess = await apiCall('POST', '/api/tickets/wo-e2e-100/progress-report', {
        reportStatusId: statusId,
        reportStatusLabel: statusLabel,
        reasonReportId: reasonId,
        reasonReportLabel: reasonLabel,
        remarks: `Test 3 photos ${statusLabel}`
      });
      assert.equal(failUnsuccess.status, 400, `${statusLabel} with 3 photos must return 400`);
      assert.equal(failUnsuccess.json.code, 'PHOTO_EVIDENCE_INCOMPLETE');
      assert.equal(failUnsuccess.json.requiredCount, 4);
      assert.equal(failUnsuccess.json.verifiedTotalCount, 3);
    }

    // 7. Mismatched parent-child L1/L2 fails with INVALID_REASON_PARENT_CHILD
    const mismatchRes = await apiCall('POST', '/api/tickets/wo-e2e-100/progress-report', {
      reportStatusId: 'hs-complete',
      reportStatusLabel: 'COMPLETE',
      reasonReportId: 'hr-p1',
      reasonReportLabel: 'Kendala Redaman Tinggi / LOS',
      remarks: 'Cross-category mismatch'
    });
    assert.equal(mismatchRes.status, 400);
    assert.equal(mismatchRes.json.code, 'INVALID_REASON_PARENT_CHILD');

    // 8. Inactive L1 status fails with INACTIVE_REPORT_STATUS
    const inactiveRes = await apiCall('POST', '/api/tickets/wo-e2e-100/progress-report', {
      reportStatusId: 'hs-onsite',
      reasonReportId: 'hr-os1',
      remarks: 'Inactive status'
    });
    assert.equal(inactiveRes.status, 400);
    assert.equal(inactiveRes.json.code, 'INACTIVE_REPORT_STATUS');

    // 9. COMPLETE with 3 mandatory photos succeeds
    const completeRes = await apiCall('POST', '/api/tickets/wo-e2e-100/progress-report', {
      reportStatusId: 'hs-complete',
      reportStatusLabel: 'COMPLETE',
      reasonReportId: 'hr-c1',
      reasonReportLabel: 'Instalasi & Aktivasi Sukses (Online)',
      remarks: 'Aktivasi lancar redaman -18.4 dBm'
    });
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.json.success, true);

    // 10. PENDING with 3 mandatory + 1 optional (4 photos) succeeds
    mock.setPhotoSlots([
      houseCamSlot,
      makeEvidenceSlot('fat_pole'),
      makeEvidenceSlot('fat_attenuation'),
      makeEvidenceSlot('opm')
    ]);
    const pending4Res = await apiCall('POST', '/api/tickets/wo-e2e-100/progress-report', {
      reportStatusId: 'hs-pending',
      reportStatusLabel: 'PENDING',
      reasonReportId: 'hr-p1',
      reasonReportLabel: 'Kendala Redaman Tinggi / LOS',
      remarks: 'Redaman FAT melebihi batas SOP (-28 dBm)'
    });
    assert.equal(pending4Res.status, 200);
    assert.equal(pending4Res.json.success, true);
    assert.equal(pending4Res.json.ticket?.statusWOInstaller, 'Pending Technical');
  } finally {
    const idx = SERVER_SESSIONS.findIndex(s => s.token === sessionToken);
    if (idx >= 0) SERVER_SESSIONS.splice(idx, 1);
    resetSupabaseBackendClientForTesting();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
