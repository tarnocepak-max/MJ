import http from 'node:http';
import bcrypt from 'bcryptjs';
import { createExpressApp } from '../server.ts';
import { setSupabaseBackendClientForTesting } from '../server/supabaseClient.ts';
import { INITIAL_HIERARCHICAL_DROPLISTS } from '../src/constants/hierarchicalDroplists.ts';

function getTodayWibDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

const todayWib = getTodayWibDate();
const nowIso = new Date().toISOString();
const checkInIso = new Date(Date.now() - 20 * 60_000).toISOString();

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
  is_archived: false,
  session_version: 1,
  account_status: 'active',
  failed_login_count: 0,
  password_hash: bcrypt.hashSync('TestPass123!', 4),
  payload: { id: 'inst-e2e-01', name: 'Rudi Pratama E2E', role: 'installer', contractor: 'Mitra BDG-02', area: 'Bandung' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: nowIso
};

function makeSlot(slotKey: string, title: string, woId: string) {
  return {
    id: `evd_${woId}_${slotKey}`,
    slotKey,
    title,
    url: `/api/storage/public/wo_photo_evidence/${woId}/${slotKey}.jpg`,
    storagePath: `wo_photo_evidence/${woId}/${slotKey}.jpg`,
    capturedAt: '09:30:00',
    capturedAtIso: checkInIso,
    uploadedAt: checkInIso,
    uploadStatus: 'uploaded',
    captureMethod: 'camera',
    latitude: -6.9175,
    longitude: 107.6191,
    gpsAccuracyMeters: 6,
    geotagStatus: 'verified'
  };
}

const wo1Slots: any[] = [];
const wo2Slots = [
  makeSlot('customer_house', 'Foto Rumah Pelanggan', 'wo-e2e-chk-002'),
  makeSlot('fat_pole', 'Foto Tiang FAT', 'wo-e2e-chk-002'),
  makeSlot('fat_attenuation', 'Foto Redaman FAT', 'wo-e2e-chk-002')
];
const wo3Slots = [
  makeSlot('customer_house', 'Foto Rumah Pelanggan', 'wo-e2e-4photo-003'),
  makeSlot('fat_pole', 'Foto Tiang FAT', 'wo-e2e-4photo-003'),
  makeSlot('fat_attenuation', 'Foto Redaman FAT', 'wo-e2e-4photo-003'),
  makeSlot('opm', 'Foto Redaman OPM', 'wo-e2e-4photo-003')
];

const workOrders: any[] = [
  {
    id: 'wo-e2e-pre-001',
    wo_number: 'WO-E2E-PRE-001',
    customer_id: '1002341',
    customer_name: 'Ibu Sinta Mariana',
    customer_phone: '081211112222',
    address: 'Jl. Cisaranten Kulon No. 08, Bandung',
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
    updated_at: nowIso,
    payload: {
      id: 'wo-e2e-pre-001',
      woNumber: 'WO-E2E-PRE-001',
      customerId: '1002341',
      customerName: 'Ibu Sinta Mariana',
      customerPhone: '081211112222',
      address: 'Jl. Cisaranten Kulon No. 08, Bandung',
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
      technicalReport: { photoSlots: wo1Slots, photos: [] }
    }
  },
  {
    id: 'wo-e2e-chk-002',
    wo_number: 'WO-E2E-CHK-002',
    customer_id: '1002342',
    customer_name: 'Dr. Anton Wijaya',
    customer_phone: '081233334444',
    address: 'Komp. Arcamanik Endah B3, Bandung',
    contractor_id: 'c-bdg-02',
    contractor_name: 'Mitra BDG-02',
    contactor_name: 'Mitra BDG-02',
    area: 'Bandung',
    appointment_date: todayWib,
    slot_time: '11:00 - 13:00',
    installer_id: 'inst-e2e-01',
    installer_user_id: 'inst-e2e-01',
    installer_name: 'Rudi Pratama E2E',
    status_wo_installer: 'On Progress',
    status_wo_agent: 'In Progress',
    work_session_status: 'Sedang Dikerjakan',
    check_in_at: checkInIso,
    check_out_at: null,
    is_deleted: false,
    updated_at: nowIso,
    payload: {
      id: 'wo-e2e-chk-002',
      woNumber: 'WO-E2E-CHK-002',
      customerId: '1002342',
      customerName: 'Dr. Anton Wijaya',
      customerPhone: '081233334444',
      address: 'Komp. Arcamanik Endah B3, Bandung',
      contractorId: 'c-bdg-02',
      contractorName: 'Mitra BDG-02',
      contactorName: 'Mitra BDG-02',
      area: 'Bandung',
      appointmentDate: todayWib,
      appointmentSlot: '11:00 - 13:00',
      installerId: 'inst-e2e-01',
      installerUserId: 'inst-e2e-01',
      installerName: 'Rudi Pratama E2E',
      statusWOInstaller: 'On Progress',
      statusWOAgent: 'In Progress',
      workSessionStatus: 'Sedang Dikerjakan',
      checkInAt: checkInIso,
      workSessions: [
        {
          sessionId: 'ws_e2e_2',
          checkInAt: checkInIso,
          status: 'Sedang Dikerjakan'
        }
      ],
      progressReports: [
        {
          id: 'prog_hist_1',
          versionNumber: 1,
          timestamp: checkInIso,
          submittedBy: 'Rudi Pratama E2E',
          reportStatusLabel: 'PENDING',
          reasonReportLabel: 'Kendala Redaman Tinggi / LOS',
          remarksReport: 'Pengecekan awal port FAT',
          approvalStatus: 'REVISION'
        }
      ],
      technicalReport: {
        photoSlots: wo2Slots,
        photos: wo2Slots.map(s => s.url)
      }
    }
  },
  {
    id: 'wo-e2e-4photo-003',
    wo_number: 'WO-E2E-4PHOTO-003',
    customer_id: '1002343',
    customer_name: 'Bpk. Rahmat Fauzi',
    customer_phone: '081255556666',
    address: 'Jl. Antapani Lama 42, Bandung',
    contractor_id: 'c-bdg-02',
    contractor_name: 'Mitra BDG-02',
    contactor_name: 'Mitra BDG-02',
    area: 'Bandung',
    appointment_date: todayWib,
    slot_time: '13:00 - 15:00',
    installer_id: 'inst-e2e-01',
    installer_user_id: 'inst-e2e-01',
    installer_name: 'Rudi Pratama E2E',
    status_wo_installer: 'On Progress',
    status_wo_agent: 'In Progress',
    work_session_status: 'Sedang Dikerjakan',
    check_in_at: checkInIso,
    check_out_at: null,
    is_deleted: false,
    updated_at: nowIso,
    payload: {
      id: 'wo-e2e-4photo-003',
      woNumber: 'WO-E2E-4PHOTO-003',
      customerId: '1002343',
      customerName: 'Bpk. Rahmat Fauzi',
      customerPhone: '081255556666',
      address: 'Jl. Antapani Lama 42, Bandung',
      contractorId: 'c-bdg-02',
      contractorName: 'Mitra BDG-02',
      contactorName: 'Mitra BDG-02',
      area: 'Bandung',
      appointmentDate: todayWib,
      appointmentSlot: '13:00 - 15:00',
      installerId: 'inst-e2e-01',
      installerUserId: 'inst-e2e-01',
      installerName: 'Rudi Pratama E2E',
      statusWOInstaller: 'On Progress',
      statusWOAgent: 'In Progress',
      workSessionStatus: 'Sedang Dikerjakan',
      checkInAt: checkInIso,
      workSessions: [{ sessionId: 'ws_e2e_3', checkInAt: checkInIso, status: 'Sedang Dikerjakan' }],
      progressReports: [],
      technicalReport: {
        photoSlots: wo3Slots,
        photos: wo3Slots.map(s => s.url)
      }
    }
  }
];

const ticketMessages: any[] = [
  {
    id: 'msg_hist_prog_1',
    ticket_id: 'wo-e2e-pre-001',
    wo_number: 'WO-E2E-PRE-001',
    sender_id: 'inst-e2e-01',
    sender_name: 'Rudi Pratama E2E',
    sender_role: 'installer',
    message_text: 'Pesan historis #PROGRESS sebelum refactor',
    attachments: [],
    payload: { category: 'PROGRESS', readBy: ['inst-e2e-01'], deliveredTo: ['inst-e2e-01'] },
    created_at: checkInIso
  }
];

const photoEvidenceRows: any[] = [...wo2Slots, ...wo3Slots].map(s => ({
  id: s.id,
  ticket_id: s.id.includes('chk-002') ? 'wo-e2e-chk-002' : 'wo-e2e-4photo-003',
  wo_number: s.id.includes('chk-002') ? 'WO-E2E-CHK-002' : 'WO-E2E-4PHOTO-003',
  slot_key: s.slotKey,
  slot_title: s.title,
  photo_url: s.url,
  storage_path: s.storagePath,
  capture_method: 'camera',
  latitude: -6.9175,
  longitude: 107.6191,
  geotag_status: 'verified',
  captured_at: checkInIso,
  uploaded_at: checkInIso,
  technician_id: 'inst-e2e-01',
  technician_name: 'Rudi Pratama E2E',
  metadata: {}
}));

const appSettingsRows: Record<string, any> = {
  hierarchical_droplists: {
    setting_key: 'hierarchical_droplists',
    setting_value: INITIAL_HIERARCHICAL_DROPLISTS,
    version: 1,
    updated_at: nowIso
  },
  chat_categories: {
    setting_key: 'chat_categories',
    setting_value: [
      { id: 'cat-progress', name: 'PROGRESS', active: true },
      { id: 'cat-koordinasi', name: 'KOORDINASI', active: true },
      { id: 'cat-konfirmasi', name: 'KONFIRMASI', active: true }
    ],
    version: 1,
    updated_at: nowIso
  }
};

function makeQuery(rowsProvider: () => any[]) {
  const filters: Array<(row: any) => boolean> = [];
  let isSingle = false;
  let isMaybeSingle = false;

  const execute = async () => {
    const data = rowsProvider().filter(r => filters.every(fn => fn(r)));
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
      const needle = String(val || '').replace(/\\([_%])/g, '$1').toLowerCase();
      filters.push(r => r && String(r[col] || '').toLowerCase() === needle);
      return builder;
    },
    in: (col: string, vals: any[]) => {
      filters.push(r => r && (vals || []).includes(r[col]));
      return builder;
    },
    or: (expr: string) => {
      const parts = String(expr || '').split(',').map(p => p.trim());
      filters.push(r =>
        parts.some(p => {
          const m = p.match(/^([a-zA-Z0-9_]+)\.(eq|ilike)\.(.+)$/);
          if (!m) return true;
          if (m[2] === 'ilike') return String(r?.[m[1]] || '').toLowerCase() === m[3].replace(/\\([_%])/g, '$1').toLowerCase();
          return String(r?.[m[1]] || '') === m[3];
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

const authSessions: any[] = [];
const refreshTokens: any[] = [];
const loginAttempts: any[] = [];

const mockClient: any = {
  from: (table: string) => {
    if (table === 'auth_sessions') {
      return {
        select: () => makeQuery(() => authSessions),
        insert: (rows: any[]) => {
          authSessions.push(...(rows || []).map(r => ({ ...r })));
          return Promise.resolve({ data: rows, error: null });
        },
        update: (upd: any) => ({
          eq: (col: string, val: any) => {
            authSessions.forEach(r => { if (r[col] === val) Object.assign(r, upd); });
            return Promise.resolve({ data: [], error: null });
          }
        })
      };
    }
    if (table === 'refresh_tokens') {
      return {
        select: () => makeQuery(() => refreshTokens),
        insert: (rows: any[]) => {
          refreshTokens.push(...(rows || []).map(r => ({ ...r })));
          return Promise.resolve({ data: rows, error: null });
        },
        update: (upd: any) => ({
          eq: (col: string, val: any) => {
            refreshTokens.forEach(r => { if (r[col] === val) Object.assign(r, upd); });
            return Promise.resolve({ data: [], error: null });
          }
        })
      };
    }
    if (table === 'login_attempts') {
      return {
        select: () => makeQuery(() => loginAttempts),
        insert: (rows: any[]) => {
          loginAttempts.push(...(rows || []).map(r => ({ ...r })));
          return Promise.resolve({ data: rows, error: null });
        }
      };
    }
    if (table === 'work_orders') {
      return {
        select: () => makeQuery(() => workOrders),
        update: (updates: any) => ({
          eq: (col: string, val: any) => {
            const applyUpdate = () => {
              const idx = workOrders.findIndex(w => w[col] === val);
              if (idx < 0) return null;
              const { payload: pUpd, ...direct } = updates || {};
              Object.assign(workOrders[idx], direct);
              if (pUpd) {
                workOrders[idx].payload = { ...(workOrders[idx].payload || {}), ...pUpd };
              }
              return { ...workOrders[idx] };
            };
            return {
              select: () => ({
                single: async () => ({ data: applyUpdate(), error: null }),
                maybeSingle: async () => ({ data: applyUpdate(), error: null })
              }),
              then: (resolve: (v: any) => any) => Promise.resolve({ data: [applyUpdate()].filter(Boolean), error: null }).then(resolve)
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
        update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) })
      };
    }
    if (table === 'wo_photo_evidence') {
      return {
        select: () => makeQuery(() => photoEvidenceRows),
        upsert: async () => ({ error: null })
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
        select: () => makeQuery(() => [installerUser]),
        update: () => ({ eq: () => Promise.resolve({ data: [installerUser], error: null }) })
      };
    }
    if (table === 'contractors') {
      return {
        select: () => makeQuery(() => [{ id: 'c-bdg-02', name: 'Mitra BDG-02', code: 'BDG02', coverage_areas: ['Bandung'], active: true, is_archived: false }])
      };
    }
    if (table === 'coverage_areas') {
      return {
        select: () => makeQuery(() => [{ id: 'area-bdg', name: 'Bandung', clusters: ['Arcamanik'], active: true }])
      };
    }
    const chainableNoop = () => {
      const b: any = {
        eq: () => b,
        neq: () => b,
        is: () => b,
        select: () => b,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: any) => any) => Promise.resolve({ data: [], error: null }).then(resolve)
      };
      return b;
    };
    return {
      select: () => makeQuery(() => []),
      insert: () => chainableNoop(),
      update: () => chainableNoop(),
      upsert: () => chainableNoop()
    };
  }
};

setSupabaseBackendClientForTesting(mockClient);

async function main() {
  const httpServer = http.createServer();
  const app = await createExpressApp({ httpServer, deferVite: false });
  httpServer.on('request', app);
  await new Promise<void>(resolve => httpServer.listen(3102, '127.0.0.1', () => resolve()));
  console.log('[E2E_HARNESS_READY] http://127.0.0.1:3102');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
