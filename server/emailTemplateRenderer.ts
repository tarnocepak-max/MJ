/**
 * MoraJaws HTML Email Template Renderer & Sanitizer
 *
 * - Pure table-based layout with 100% inline CSS (Gmail Android/iOS/Desktop & Outlook compatible)
 * - MoraJaws / MoraRepublic Dark Violet + Deep Purple + Neon Fiber Optic visual identity
 * - Zero external image/CSS/JS dependency; crisp fallback text
 * - Strict XSS sanitization & HTTPS-only CTA links
 */

export type EmailNotificationEventType =
  | 'daily_reset'
  | 'new_wo_leader'
  | 'wo_assigned_installer'
  | 'wo_reassigned'
  | 'daily_summary';

export type EmailTemplateKey =
  | 'daily_reset_leader'
  | 'daily_reset_installer'
  | 'new_wo_leader'
  | 'wo_assigned_installer'
  | 'wo_reassigned_prev_installer'
  | 'wo_reassigned_new_installer'
  | 'daily_summary';

export interface EmailTemplateConfig {
  templateKey: EmailTemplateKey;
  eventType: EmailNotificationEventType;
  label: string;
  description: string;
  enabled: boolean;
  subject: string;
  greeting: string;
  bodyIntro: string;
  footerText: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface EmailTemplateRenderContext {
  recipientName?: string;
  recipientRole?: string;
  woNumber?: string;
  customerId?: string;
  customerName?: string;
  customerAddress?: string;
  customerContact?: string;
  area?: string;
  contractorName?: string;
  appointmentDate?: string;
  appointmentSlot?: string;
  leaderName?: string;
  installerName?: string;
  previousInstallerName?: string;
  newInstallerName?: string;
  reassignmentReason?: string;
  changedAt?: string;
  woStatus?: string;
  operationalDate?: string;
  morajawsUrl?: string;
  woDetailUrl?: string;
  // Daily Reset / Daily Summary KPI numbers
  newCount?: number;
  activeCount?: number;
  pendingCount?: number;
  completedCount?: number;
  totalWo?: number;
  assignedCount?: number;
  unworkedCount?: number;
  issueCount?: number;
  // Optional list of top WOs for summary tables
  highlightItems?: Array<{
    woNumber: string;
    customerName?: string;
    area?: string;
    slotTime?: string;
    status?: string;
    installerName?: string;
  }>;
  isDemoPreview?: boolean;
}

export const AVAILABLE_EMAIL_PLACEHOLDERS: Array<{ token: string; label: string; example: string }> = [
  { token: '{{recipient_name}}', label: 'Nama Penerima', example: 'Hendra Gunawan' },
  { token: '{{wo_number}}', label: 'WO Number', example: 'WO-2026-88412' },
  { token: '{{customer_id}}', label: 'Customer ID', example: '7399337' },
  { token: '{{customer_name}}', label: 'Nama Pelanggan', example: 'Syamsul Bahri' },
  { token: '{{customer_address}}', label: 'Alamat Pelanggan', example: 'Jl. Kemuning Blok D2, Jakarta Selatan' },
  { token: '{{customer_contact}}', label: 'Kontak Pelanggan', example: '081377889900' },
  { token: '{{area}}', label: 'Area', example: 'Jakarta Selatan' },
  { token: '{{contractor_name}}', label: 'Contractor/Vendor', example: 'PT Mitra Jaringan Solusi' },
  { token: '{{appointment_date}}', label: 'Appointment Date', example: 'Senin, 23 November 2026' },
  { token: '{{appointment_slot}}', label: 'Appointment Slot', example: '10:00 - 12:00 WIB' },
  { token: '{{leader_name}}', label: 'Nama Leader', example: 'Hendra Gunawan' },
  { token: '{{installer_name}}', label: 'Nama Installer', example: 'Andi Saputra' },
  { token: '{{previous_installer_name}}', label: 'Installer Sebelumnya', example: 'Budi Santoso' },
  { token: '{{new_installer_name}}', label: 'Installer Baru', example: 'Andi Saputra' },
  { token: '{{reassignment_reason}}', label: 'Alasan Reassignment', example: 'Teknisi sebelumnya overload di cluster lain' },
  { token: '{{changed_at}}', label: 'Waktu Perubahan', example: '23 Nov 2026, 14:15 WIB' },
  { token: '{{wo_status}}', label: 'Status WO', example: 'Assigned' },
  { token: '{{operational_date}}', label: 'Tanggal Operasional WIB', example: 'Senin, 23 November 2026' },
  { token: '{{morajaws_url}}', label: 'URL MoraJaws (HTTPS)', example: 'https://morajaws.example.com' }
];

const DEFAULT_FALLBACK_HTTPS_BASE = 'https://ais-dev-i5z2rjrohog3e5mmhu75de-213407071640.asia-northeast1.run.app';

export function resolveSafeHttpsBaseUrl(): string {
  const candidates = [
    process.env.PRODUCTION_APP_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.DEV_APP_BASE_URL,
    DEFAULT_FALLBACK_HTTPS_BASE
  ];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:') {
        return parsed.origin;
      }
      if (parsed.protocol === 'http:' && parsed.hostname && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return `https://${parsed.host}`;
      }
    } catch {
      // skip invalid URL
    }
  }
  return DEFAULT_FALLBACK_HTTPS_BASE;
}

export function sanitizeHttpsUrl(rawUrl?: string | null, fallbackUrl?: string): string {
  const safeFallback = fallbackUrl && fallbackUrl.startsWith('https://')
    ? fallbackUrl
    : resolveSafeHttpsBaseUrl();
  if (!rawUrl || typeof rawUrl !== 'string') return safeFallback;
  const trimmed = rawUrl.trim();
  if (!trimmed) return safeFallback;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return safeFallback;
  } catch {
    return safeFallback;
  }
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strips any unsafe HTML/script tags, inline JS handlers, or javascript:/data: URLs
 * from template strings configured by Superadmin before rendering.
 */
export function sanitizeTemplateText(input: unknown): string {
  if (input === null || input === undefined) return '';
  let str = String(input);
  // Remove script/iframe/object/embed/style tags and their contents
  str = str.replace(/<\s*(script|iframe|object|embed|style|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  str = str.replace(/<\s*(script|iframe|object|embed|style|link|meta)[^>]*\/?\s*>/gi, '');
  // Strip any remaining HTML tags so only safe plain text + line breaks exist in editable text fields
  str = str.replace(/<[^>]+>/g, '');
  // Neutralize javascript: / vbscript: / data:text/html schemes regardless of adjacent characters
  str = str.replace(/(?:javascript|vbscript|data)\s*:/gi, '');
  // Limit length defensively
  return str.slice(0, 4000).trim();
}

export function formatIndonesianDate(dateStr?: string | null): string {
  if (!dateStr || !String(dateStr).trim()) return '';
  const raw = String(dateStr).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  try {
    const dt = isoMatch
      ? new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 5, 0, 0))
      : new Date(raw);
    if (Number.isNaN(dt.getTime())) return raw;
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(dt);
  } catch {
    return raw;
  }
}

export function formatIndonesianTimestampWIB(isoStr?: string | null): string {
  const target = isoStr && !Number.isNaN(new Date(isoStr).getTime()) ? new Date(isoStr) : new Date();
  try {
    const formatted = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(target);
    return `${formatted} WIB`;
  } catch {
    return target.toISOString();
  }
}

export function getDefaultEmailTemplates(): Record<EmailTemplateKey, EmailTemplateConfig> {
  const nowIso = new Date().toISOString();
  return {
    daily_reset_leader: {
      templateKey: 'daily_reset_leader',
      eventType: 'daily_reset',
      label: 'Daily Reset — Leader',
      description: 'Ringkasan harian setelah Daily Reset WIB selesai, dikelompokkan khusus Contractor/Vendor milik Leader.',
      enabled: true,
      subject: '[MoraJaws] Daily Reset Selesai ({{operational_date}}) — Ringkasan WO {{contractor_name}}',
      greeting: 'Halo {{recipient_name}},',
      bodyIntro: 'Proses Daily Reset operasional tanggal {{operational_date}} telah selesai diproses. Berikut ringkasan Work Order yang berada dalam cakupan {{contractor_name}} untuk ditindaklanjuti bersama tim teknisi Anda.',
      footerText: 'Email operasional otomatis MoraJaws Dispatch & Field Operations. Data disaring khusus sesuai otoritas Contractor Anda.',
      updatedAt: nowIso
    },
    daily_reset_installer: {
      templateKey: 'daily_reset_installer',
      eventType: 'daily_reset',
      label: 'Daily Reset — Installer',
      description: 'Ringkasan harian setelah Daily Reset WIB selesai, khusus WO yang ditugaskan kepada akun Installer.',
      enabled: true,
      subject: '[MoraJaws] Jadwal Tugas Harian ({{operational_date}}) — {{active_count}} WO Aktif',
      greeting: 'Halo {{recipient_name}},',
      bodyIntro: 'Daily Reset operasional tanggal {{operational_date}} telah selesai. Berikut ringkasan Work Order yang saat ini ditugaskan ke akun Anda. Silakan buka portal MoraJaws untuk mengecek detail pelanggan dan rute lokasi.',
      footerText: 'Pastikan check-in PROGRESS dan dokumentasi foto lapangan diunggah langsung melalui aplikasi MoraJaws.',
      updatedAt: nowIso
    },
    new_wo_leader: {
      templateKey: 'new_wo_leader',
      eventType: 'new_wo_leader',
      label: 'New WO Masuk — Leader',
      description: 'Dikirim otomatis saat WO baru berhasil dipetakan ke Contractor/Area milik Leader.',
      enabled: true,
      subject: '[MoraJaws] WO Baru Masuk: {{wo_number}} — {{customer_name}} ({{area}})',
      greeting: 'Halo {{recipient_name}},',
      bodyIntro: 'Work Order baru telah masuk ke daftar antrean {{contractor_name}} dan siap untuk Anda tugaskan kepada teknisi lapangan.',
      footerText: 'Segera lakukan assignment teknisi melalui Portal Leader MoraJaws sebelum slot appointment berjalan.',
      updatedAt: nowIso
    },
    wo_assigned_installer: {
      templateKey: 'wo_assigned_installer',
      eventType: 'wo_assigned_installer',
      label: 'Penugasan WO Baru — Installer',
      description: 'Dikirim kepada Installer ketika Leader menetapkan WO baru kepada akunnya.',
      enabled: true,
      subject: '[MoraJaws] Tugas WO Baru: {{wo_number}} — {{appointment_date}} ({{appointment_slot}})',
      greeting: 'Halo {{recipient_name}},',
      bodyIntro: 'Leader {{leader_name}} telah menugaskan Work Order baru kepada Anda. Harap periksa detail pelanggan, jadwal slot, dan lokasi pekerjaan di bawah ini.',
      footerText: 'Lakukan check-in di lokasi pelanggan dan lengkapi laporan instalasi melalui MoraJaws Installer Portal.',
      updatedAt: nowIso
    },
    wo_reassigned_prev_installer: {
      templateKey: 'wo_reassigned_prev_installer',
      eventType: 'wo_reassigned',
      label: 'Reassignment WO — Installer Sebelumnya',
      description: 'Pemberitahuan kepada Installer sebelumnya bahwa WO telah dialihkan ke teknisi lain.',
      enabled: true,
      subject: '[MoraJaws] Pengalihan Tugas: WO {{wo_number}} Dipindahkan ke Teknisi Lain',
      greeting: 'Halo {{recipient_name}},',
      bodyIntro: 'Work Order {{wo_number}} yang sebelumnya berada di akun Anda telah dipindahkan oleh Leader {{leader_name}} kepada {{new_installer_name}} pada {{changed_at}}.',
      footerText: 'WO tersebut tidak lagi menjadi tanggung jawab aktif Anda. Hubungi Leader Anda bila memerlukan konfirmasi tambahan.',
      updatedAt: nowIso
    },
    wo_reassigned_new_installer: {
      templateKey: 'wo_reassigned_new_installer',
      eventType: 'wo_reassigned',
      label: 'Reassignment WO — Installer Baru',
      description: 'Pemberitahuan kepada Installer baru bahwa WO dialihkan kepadanya.',
      enabled: true,
      subject: '[MoraJaws] Pengalihan WO Masuk: {{wo_number}} Ditugaskan ke Anda',
      greeting: 'Halo {{recipient_name}},',
      bodyIntro: 'Leader {{leader_name}} telah mengalihkan Work Order {{wo_number}} (dari {{previous_installer_name}}) kepada Anda pada {{changed_at}}. Segera tinjau detail tugas dan lanjutkan penanganan di lapangan.',
      footerText: 'Buka detail WO di MoraJaws untuk melihat histori pengerjaan dan chat operasional sebelumnya.',
      updatedAt: nowIso
    },
    daily_summary: {
      templateKey: 'daily_summary',
      eventType: 'daily_summary',
      label: 'Daily Summary Operasional',
      description: 'Rekapitulasi performa WO harian (Total, Assigned, Completed, Pending, Belum Dikerjakan, Bermasalah).',
      enabled: true,
      subject: '[MoraJaws] Daily Summary Operasional — {{operational_date}}',
      greeting: 'Halo {{recipient_name}},',
      bodyIntro: 'Berikut ringkasan eksekusi operasional Work Order pada tanggal {{operational_date}} berdasarkan data aktual database MoraJaws.',
      footerText: 'Laporan otomatis terjadwal MoraJaws Dispatch & Operations Command.',
      updatedAt: nowIso
    }
  };
}

function buildTokenMap(ctx: EmailTemplateRenderContext): Record<string, string> {
  const safeBaseUrl = resolveSafeHttpsBaseUrl();
  const safeMoraJawsUrl = sanitizeHttpsUrl(ctx.morajawsUrl, safeBaseUrl);
  const safeWoUrl = sanitizeHttpsUrl(
    ctx.woDetailUrl,
    ctx.woNumber ? `${safeBaseUrl}/?wo=${encodeURIComponent(ctx.woNumber)}` : safeBaseUrl
  );

  const formattedOpDate = ctx.operationalDate ? formatIndonesianDate(ctx.operationalDate) : formatIndonesianDate(new Date().toISOString());
  const formattedAppDate = ctx.appointmentDate ? formatIndonesianDate(ctx.appointmentDate) : '';
  const formattedChangedAt = ctx.changedAt ? formatIndonesianTimestampWIB(ctx.changedAt) : formatIndonesianTimestampWIB();

  return {
    '{{recipient_name}}': String(ctx.recipientName || 'Tim Operasional').trim(),
    '{{wo_number}}': String(ctx.woNumber || '').trim(),
    '{{customer_id}}': String(ctx.customerId || '').trim(),
    '{{customer_name}}': String(ctx.customerName || '').trim(),
    '{{customer_address}}': String(ctx.customerAddress || '').trim(),
    '{{customer_contact}}': String(ctx.customerContact || '').trim(),
    '{{area}}': String(ctx.area || '').trim(),
    '{{contractor_name}}': String(ctx.contractorName || '').trim(),
    '{{appointment_date}}': formattedAppDate,
    '{{appointment_slot}}': String(ctx.appointmentSlot || '').trim(),
    '{{leader_name}}': String(ctx.leaderName || '').trim(),
    '{{installer_name}}': String(ctx.installerName || '').trim(),
    '{{previous_installer_name}}': String(ctx.previousInstallerName || '').trim(),
    '{{new_installer_name}}': String(ctx.newInstallerName || '').trim(),
    '{{reassignment_reason}}': String(ctx.reassignmentReason || '').trim(),
    '{{changed_at}}': formattedChangedAt,
    '{{wo_status}}': String(ctx.woStatus || '').trim(),
    '{{operational_date}}': formattedOpDate,
    '{{morajaws_url}}': safeMoraJawsUrl,
    '{{wo_detail_url}}': safeWoUrl,
    '{{new_count}}': String(ctx.newCount ?? 0),
    '{{active_count}}': String(ctx.activeCount ?? 0),
    '{{pending_count}}': String(ctx.pendingCount ?? 0),
    '{{completed_count}}': String(ctx.completedCount ?? 0),
    '{{total_wo}}': String(ctx.totalWo ?? 0),
    '{{assigned_count}}': String(ctx.assignedCount ?? 0),
    '{{unworked_count}}': String(ctx.unworkedCount ?? 0),
    '{{issue_count}}': String(ctx.issueCount ?? 0)
  };
}

function interpolateText(rawText: string, tokenMap: Record<string, string>, escapeValues: boolean): string {
  const safeTemplate = sanitizeTemplateText(rawText);
  return safeTemplate.replace(/\{\{[a-z0-9_]+\}\}/gi, match => {
    const key = match.toLowerCase();
    const val = Object.prototype.hasOwnProperty.call(tokenMap, key) ? tokenMap[key] : '';
    return escapeValues ? escapeHtml(val) : val;
  });
}

function renderDetailRows(rows: Array<{ label: string; value?: string | null; accent?: boolean }>): string {
  const filtered = rows.filter(r => r.value !== undefined && r.value !== null && String(r.value).trim() !== '');
  if (filtered.length === 0) return '';

  return filtered
    .map(
      (row, idx) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:${idx === filtered.length - 1 ? '0' : '1px solid #2D1854'};color:#B8A8DF;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;width:38%;vertical-align:top;letter-spacing:0.2px;">
          ${escapeHtml(row.label)}
        </td>
        <td style="padding:10px 14px;border-bottom:${idx === filtered.length - 1 ? '0' : '1px solid #2D1854'};color:${row.accent ? '#38BDF8' : '#F5F3FF'};font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:${row.accent ? '800' : '600'};vertical-align:top;word-break:break-word;">
          ${escapeHtml(row.value)}
        </td>
      </tr>`
    )
    .join('');
}

function renderKpiStrip(items: Array<{ label: string; value: number; color: string; border: string }>): string {
  const cells = items
    .map(
      item => `
      <td style="width:${Math.floor(100 / items.length)}%;padding:4px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1A0D33;border:1px solid ${item.border};border-radius:10px;">
          <tr>
            <td style="padding:12px 10px;text-align:center;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;line-height:24px;color:${item.color};">
                ${escapeHtml(item.value)}
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#C4B5FD;margin-top:4px;">
                ${escapeHtml(item.label)}
              </div>
            </td>
          </tr>
        </table>
      </td>`
    )
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 8px 0;">
      <tr>${cells}</tr>
    </table>`;
}

export function getDemoContextForTemplate(templateKey: EmailTemplateKey): EmailTemplateRenderContext {
  const baseUrl = resolveSafeHttpsBaseUrl();
  const todayIso = new Date().toISOString().slice(0, 10);

  switch (templateKey) {
    case 'daily_reset_leader':
      return {
        recipientName: 'Hendra Gunawan',
        recipientRole: 'leader',
        contractorName: 'PT Mitra Jaringan Solusi',
        area: 'Jakarta Selatan',
        operationalDate: todayIso,
        newCount: 14,
        activeCount: 28,
        pendingCount: 5,
        completedCount: 19,
        morajawsUrl: baseUrl,
        isDemoPreview: true,
        highlightItems: [
          { woNumber: 'WO-2026-88401', customerName: 'Bapak Hendro Wibowo', area: 'Jakarta Selatan', slotTime: '09:00 - 11:00 WIB', status: 'Unassigned' },
          { woNumber: 'WO-2026-88402', customerName: 'Ibu Sari Dewi', area: 'Jakarta Selatan', slotTime: '13:00 - 15:00 WIB', status: 'Assigned' }
        ]
      };
    case 'daily_reset_installer':
      return {
        recipientName: 'Andi Saputra',
        recipientRole: 'installer',
        contractorName: 'PT Mitra Jaringan Solusi',
        operationalDate: todayIso,
        newCount: 3,
        activeCount: 5,
        pendingCount: 1,
        completedCount: 4,
        morajawsUrl: baseUrl,
        isDemoPreview: true,
        highlightItems: [
          { woNumber: 'WO-2026-88412', customerName: 'Syamsul Bahri', area: 'Jakarta Selatan', slotTime: '10:00 - 12:00 WIB', status: 'Assigned' },
          { woNumber: 'WO-2026-88415', customerName: 'Rina Marlina', area: 'Jakarta Selatan', slotTime: '14:00 - 16:00 WIB', status: 'Assigned' }
        ]
      };
    case 'new_wo_leader':
      return {
        recipientName: 'Hendra Gunawan',
        recipientRole: 'leader',
        woNumber: 'WO-2026-88419',
        customerId: '7399337',
        customerName: 'Syamsul Bahri',
        area: 'Jakarta Selatan',
        contractorName: 'PT Mitra Jaringan Solusi',
        appointmentDate: todayIso,
        appointmentSlot: '10:00 - 12:00 WIB',
        woStatus: 'Pending (Siap Ditugaskan)',
        morajawsUrl: baseUrl,
        isDemoPreview: true
      };
    case 'wo_assigned_installer':
      return {
        recipientName: 'Andi Saputra',
        recipientRole: 'installer',
        woNumber: 'WO-2026-88412',
        customerId: '7399337',
        customerName: 'Syamsul Bahri',
        customerAddress: 'Jl. Kemuning Blok D2, Grand Melati Residence, Jakarta Selatan',
        customerContact: '081377889900',
        area: 'Jakarta Selatan',
        contractorName: 'PT Mitra Jaringan Solusi',
        appointmentDate: todayIso,
        appointmentSlot: '10:00 - 12:00 WIB',
        leaderName: 'Hendra Gunawan',
        installerName: 'Andi Saputra',
        woStatus: 'Assigned',
        woDetailUrl: `${baseUrl}/?wo=WO-2026-88412`,
        morajawsUrl: baseUrl,
        isDemoPreview: true
      };
    case 'wo_reassigned_prev_installer':
      return {
        recipientName: 'Budi Santoso',
        recipientRole: 'installer',
        woNumber: 'WO-2026-88412',
        customerId: '7399337',
        customerName: 'Syamsul Bahri',
        area: 'Jakarta Selatan',
        contractorName: 'PT Mitra Jaringan Solusi',
        appointmentDate: todayIso,
        appointmentSlot: '10:00 - 12:00 WIB',
        leaderName: 'Hendra Gunawan',
        previousInstallerName: 'Budi Santoso',
        newInstallerName: 'Andi Saputra',
        reassignmentReason: 'Penyeimbangan beban kerja area Jakarta Selatan',
        changedAt: new Date().toISOString(),
        woStatus: 'Assigned',
        morajawsUrl: baseUrl,
        isDemoPreview: true
      };
    case 'wo_reassigned_new_installer':
      return {
        recipientName: 'Andi Saputra',
        recipientRole: 'installer',
        woNumber: 'WO-2026-88412',
        customerId: '7399337',
        customerName: 'Syamsul Bahri',
        customerAddress: 'Jl. Kemuning Blok D2, Grand Melati Residence, Jakarta Selatan',
        customerContact: '081377889900',
        area: 'Jakarta Selatan',
        contractorName: 'PT Mitra Jaringan Solusi',
        appointmentDate: todayIso,
        appointmentSlot: '10:00 - 12:00 WIB',
        leaderName: 'Hendra Gunawan',
        previousInstallerName: 'Budi Santoso',
        newInstallerName: 'Andi Saputra',
        reassignmentReason: 'Penyeimbangan beban kerja area Jakarta Selatan',
        changedAt: new Date().toISOString(),
        woStatus: 'Assigned',
        woDetailUrl: `${baseUrl}/?wo=WO-2026-88412`,
        morajawsUrl: baseUrl,
        isDemoPreview: true
      };
    case 'daily_summary':
    default:
      return {
        recipientName: 'Ray (Super Admin)',
        recipientRole: 'super_admin',
        contractorName: 'Semua Contractor Aktif',
        operationalDate: todayIso,
        totalWo: 64,
        assignedCount: 52,
        completedCount: 39,
        pendingCount: 11,
        unworkedCount: 9,
        issueCount: 5,
        morajawsUrl: baseUrl,
        isDemoPreview: true
      };
  }
}

export function renderEmailTemplate(
  template: EmailTemplateConfig,
  context: EmailTemplateRenderContext
): { subject: string; htmlBody: string; textBody: string } {
  const tokenMap = buildTokenMap(context);
  const subjectPlain = interpolateText(template.subject, tokenMap, false);
  const subjectFinal = context.isDemoPreview ? `[DEMO] ${subjectPlain}` : subjectPlain;

  const greetingHtml = interpolateText(template.greeting, tokenMap, true);
  const bodyIntroHtml = interpolateText(template.bodyIntro, tokenMap, true).replace(/\n/g, '<br/>');
  const footerHtml = interpolateText(template.footerText, tokenMap, true).replace(/\n/g, '<br/>');

  const safeBaseUrl = resolveSafeHttpsBaseUrl();
  const ctaUrl =
    template.templateKey === 'wo_assigned_installer' || template.templateKey === 'wo_reassigned_new_installer'
      ? sanitizeHttpsUrl(context.woDetailUrl, context.woNumber ? `${safeBaseUrl}/?wo=${encodeURIComponent(context.woNumber)}` : safeBaseUrl)
      : sanitizeHttpsUrl(context.morajawsUrl, safeBaseUrl);

  const ctaLabel =
    template.templateKey === 'wo_assigned_installer' || template.templateKey === 'wo_reassigned_new_installer'
      ? 'Open WO Detail'
      : 'Open MoraJaws';

  let eventTag = 'OPERATIONAL ALERT';
  let headline = 'Notifikasi Operasional MoraJaws';
  let bodySpecificHtml = '';

  if (template.templateKey === 'daily_reset_leader' || template.templateKey === 'daily_reset_installer') {
    eventTag = 'DAILY RESET COMPLETED · WIB';
    headline =
      template.templateKey === 'daily_reset_leader'
        ? `Ringkasan WO Contractor ${context.contractorName || ''}`.trim()
        : 'Ringkasan Tugas Harian Teknisi';
    bodySpecificHtml =
      renderKpiStrip([
        { label: 'WO Baru', value: context.newCount ?? 0, color: '#38BDF8', border: '#1E4E79' },
        { label: 'WO Aktif', value: context.activeCount ?? 0, color: '#C084FC', border: '#5B21B6' },
        { label: 'Pending', value: context.pendingCount ?? 0, color: '#FBBF24', border: '#78350F' },
        { label: 'Selesai', value: context.completedCount ?? 0, color: '#34D399', border: '#065F46' }
      ]) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#180C30;border:1px solid #3B1D78;border-radius:10px;margin-top:12px;">` +
      renderDetailRows([
        { label: 'Tanggal Operasional', value: tokenMap['{{operational_date}}'], accent: true },
        { label: 'Contractor / Vendor', value: tokenMap['{{contractor_name}}'] },
        { label: 'Area Cakupan', value: tokenMap['{{area}}'] }
      ]) +
      `</table>`;
  } else if (template.templateKey === 'daily_summary') {
    eventTag = 'DAILY SUMMARY REPORT';
    headline = `Rekapitulasi WO Operasional (${tokenMap['{{operational_date}}']})`;
    bodySpecificHtml =
      renderKpiStrip([
        { label: 'Total WO', value: context.totalWo ?? 0, color: '#F5F3FF', border: '#4C1D95' },
        { label: 'Assigned', value: context.assignedCount ?? 0, color: '#C084FC', border: '#5B21B6' },
        { label: 'Completed', value: context.completedCount ?? 0, color: '#34D399', border: '#065F46' }
      ]) +
      renderKpiStrip([
        { label: 'Pending', value: context.pendingCount ?? 0, color: '#FBBF24', border: '#78350F' },
        { label: 'Belum Dikerjakan', value: context.unworkedCount ?? 0, color: '#38BDF8', border: '#1E4E79' },
        { label: 'Bermasalah', value: context.issueCount ?? 0, color: '#FB7185', border: '#881337' }
      ]) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#180C30;border:1px solid #3B1D78;border-radius:10px;margin-top:12px;">` +
      renderDetailRows([
        { label: 'Tanggal Operasional', value: tokenMap['{{operational_date}}'], accent: true },
        { label: 'Cakupan Data', value: tokenMap['{{contractor_name}}'] || 'Seluruh Operasi MoraJaws' }
      ]) +
      `</table>`;
  } else if (template.templateKey === 'new_wo_leader') {
    eventTag = 'NEW WORK ORDER DISTRIBUTED';
    headline = `WO Baru Masuk: ${context.woNumber || '-'}`;
    bodySpecificHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#180C30;border:1px solid #3B1D78;border-radius:10px;margin-top:16px;">
        ${renderDetailRows([
          { label: 'WO Number', value: tokenMap['{{wo_number}}'], accent: true },
          { label: 'Customer ID', value: tokenMap['{{customer_id}}'] },
          { label: 'Customer Name', value: tokenMap['{{customer_name}}'] },
          { label: 'Area', value: tokenMap['{{area}}'] },
          { label: 'Contractor / Vendor', value: tokenMap['{{contractor_name}}'] },
          { label: 'Appointment Date', value: tokenMap['{{appointment_date}}'] },
          { label: 'Appointment Slot', value: tokenMap['{{appointment_slot}}'] },
          { label: 'Status WO', value: tokenMap['{{wo_status}}'] }
        ])}
      </table>`;
  } else if (template.templateKey === 'wo_assigned_installer') {
    eventTag = 'WO ASSIGNMENT';
    headline = `Penugasan Baru: ${context.woNumber || '-'}`;
    bodySpecificHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#180C30;border:1px solid #3B1D78;border-radius:10px;margin-top:16px;">
        ${renderDetailRows([
          { label: 'WO Number', value: tokenMap['{{wo_number}}'], accent: true },
          { label: 'Customer ID', value: tokenMap['{{customer_id}}'] },
          { label: 'Customer Name', value: tokenMap['{{customer_name}}'] },
          { label: 'Customer Address', value: tokenMap['{{customer_address}}'] },
          { label: 'Customer Contact', value: tokenMap['{{customer_contact}}'] },
          { label: 'Area', value: tokenMap['{{area}}'] },
          { label: 'Appointment Date', value: tokenMap['{{appointment_date}}'] },
          { label: 'Appointment Slot', value: tokenMap['{{appointment_slot}}'] },
          { label: 'Leader Name', value: tokenMap['{{leader_name}}'] },
          { label: 'Contractor / Vendor', value: tokenMap['{{contractor_name}}'] }
        ])}
      </table>`;
  } else {
    // Reassignment (prev or new installer)
    const isPrev = template.templateKey === 'wo_reassigned_prev_installer';
    eventTag = isPrev ? 'WO REASSIGNED · DIPINDAHKAN' : 'WO REASSIGNED · PENUGASAN BARU';
    headline = isPrev
      ? `WO ${context.woNumber || '-'} Dipindahkan`
      : `WO ${context.woNumber || '-'} Dialihkan ke Anda`;
    bodySpecificHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#180C30;border:1px solid #3B1D78;border-radius:10px;margin-top:16px;">
        ${renderDetailRows([
          { label: 'WO Number', value: tokenMap['{{wo_number}}'], accent: true },
          { label: 'Customer ID', value: tokenMap['{{customer_id}}'] },
          { label: 'Customer Name', value: tokenMap['{{customer_name}}'] },
          { label: 'Customer Address', value: isPrev ? '' : tokenMap['{{customer_address}}'] },
          { label: 'Customer Contact', value: isPrev ? '' : tokenMap['{{customer_contact}}'] },
          { label: 'Area', value: tokenMap['{{area}}'] },
          { label: 'Appointment Date', value: tokenMap['{{appointment_date}}'] },
          { label: 'Appointment Slot', value: tokenMap['{{appointment_slot}}'] },
          { label: 'Leader Name', value: tokenMap['{{leader_name}}'] },
          { label: 'Installer Sebelumnya', value: tokenMap['{{previous_installer_name}}'] },
          { label: 'Installer Baru', value: tokenMap['{{new_installer_name}}'] },
          { label: 'Alasan Pengalihan', value: tokenMap['{{reassignment_reason}}'] },
          { label: 'Waktu Perubahan', value: tokenMap['{{changed_at}}'] },
          { label: 'Contractor / Vendor', value: tokenMap['{{contractor_name}}'] }
        ])}
      </table>`;
  }

  const demoBannerHtml = context.isDemoPreview
    ? `
      <tr>
        <td style="background-color:#58149C;padding:8px 20px;text-align:center;border-bottom:1px solid #8648F5;">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#00E5FF;text-transform:uppercase;">
            DEMO PREVIEW — TEMPLATE SIMULASI (TIDAK DIKIRIM KE PENGGUNA LAPANGAN)
          </span>
        </td>
      </tr>`
    : '';

  const htmlBody = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(subjectFinal)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0D061B;color:#F5F3FF;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0D061B;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#160D29;border:1px solid #4A258D;border-radius:16px;overflow:hidden;">
          ${demoBannerHtml}
          <!-- Header Banner: MoraRepublic Dark Violet + Neon Fiber Optic Accent -->
          <tr>
            <td style="background-color:#261047;background-image:linear-gradient(135deg,#261047 0%,#3B1478 65%,#1C0D38 100%);padding:22px 24px;border-bottom:2px solid #8648F5;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:1.6px;color:#00E5FF;text-transform:uppercase;">
                      MORAJAWS · FIELD OPS DISPATCH
                    </div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:#FFFFFF;margin-top:6px;line-height:26px;">
                      ${escapeHtml(headline)}
                    </div>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <span style="display:inline-block;padding:5px 10px;background-color:#160D29;border:1px solid #7135B5;border-radius:6px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:800;letter-spacing:0.8px;color:#DAB9FF;text-transform:uppercase;">
                      ${escapeHtml(eventTag)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:24px;">
              <p style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#FFFFFF;">
                ${greetingHtml}
              </p>
              <p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:21px;color:#DDD6FE;">
                ${bodyIntroHtml}
              </p>

              ${bodySpecificHtml}

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 28px;background-color:#7C3AED;background-image:linear-gradient(135deg,#8648F5 0%,#58149C 100%);border:1px solid #A855F7;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:800;color:#FFFFFF;text-decoration:none;letter-spacing:0.3px;">
                      ${escapeHtml(ctaLabel)} &rarr;
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:10px;">
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9F8AC7;word-break:break-all;">
                      Link langsung: ${escapeHtml(ctaUrl)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#120822;padding:18px 24px;border-top:1px solid #35105E;">
              <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:18px;color:#B8A8DF;">
                ${footerHtml}
              </p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#7D6BA3;">
                MoraJaws Automated Dispatch Engine · Zona Waktu Asia/Jakarta (WIB)
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    context.isDemoPreview ? '[DEMO PREVIEW TEMPLATE]' : '',
    `MORAJAWS — ${headline}`,
    '',
    interpolateText(template.greeting, tokenMap, false),
    interpolateText(template.bodyIntro, tokenMap, false),
    '',
    context.woNumber ? `WO Number: ${context.woNumber}` : '',
    context.customerId ? `Customer ID: ${context.customerId}` : '',
    context.customerName ? `Customer Name: ${context.customerName}` : '',
    context.customerAddress ? `Alamat: ${context.customerAddress}` : '',
    context.customerContact ? `Kontak: ${context.customerContact}` : '',
    context.area ? `Area: ${context.area}` : '',
    context.contractorName ? `Contractor: ${context.contractorName}` : '',
    tokenMap['{{appointment_date}}'] ? `Appointment Date: ${tokenMap['{{appointment_date}}']}` : '',
    context.appointmentSlot ? `Appointment Slot: ${context.appointmentSlot}` : '',
    context.leaderName ? `Leader: ${context.leaderName}` : '',
    context.previousInstallerName ? `Installer Sebelumnya: ${context.previousInstallerName}` : '',
    context.newInstallerName ? `Installer Baru: ${context.newInstallerName}` : '',
    context.reassignmentReason ? `Alasan: ${context.reassignmentReason}` : '',
    '',
    `${ctaLabel}: ${ctaUrl}`,
    '',
    interpolateText(template.footerText, tokenMap, false)
  ]
    .filter(line => line !== undefined && line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    subject: subjectFinal,
    htmlBody,
    textBody: textLines
  };
}
