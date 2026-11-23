import crypto from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { getSupabaseBackendClient, isSupabaseConfigured } from './supabaseClient.ts';
import { isContractorMatch, isAreaMatch } from './appFlowHelpers.ts';
import {
  getStrictAppointmentDateServer
} from './woClassificationService.ts';
import {
  isTicketAssigned,
  isTicketCheckedIn,
  isTicketClosed,
  normalizeCanonicalReportStatus
} from './woLifecycleService.ts';
import {
  type EmailNotificationEventType,
  type EmailTemplateConfig,
  type EmailTemplateKey,
  type EmailTemplateRenderContext,
  getDefaultEmailTemplates,
  getDemoContextForTemplate,
  renderEmailTemplate,
  resolveSafeHttpsBaseUrl,
  sanitizeTemplateText
} from './emailTemplateRenderer.ts';

export type EmailDeliveryStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'retry_pending'
  | 'skipped';

export interface EmailNotificationRules {
  dailyReset: { enabled: boolean; scheduleTime: string };
  newWoLeader: { enabled: boolean };
  woAssignedInstaller: { enabled: boolean };
  woReassigned: { enabled: boolean };
  dailySummary: { enabled: boolean; scheduleTime: string };
}

export interface EmailNotificationConfig {
  enabled: boolean;
  senderName: string;
  senderEmail: string;
  replyToEmail: string;
  timezone: string;
  rules: EmailNotificationRules;
  updatedBy?: string;
  updatedAt?: string;
}

export interface EmailQueueItem {
  id: string;
  eventKey: string;
  eventType: EmailNotificationEventType;
  templateKey: EmailTemplateKey;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  recipientRole?: string | null;
  relatedTicketId?: string | null;
  relatedWoNumber?: string | null;
  subject: string;
  htmlBody: string;
  textBody: string;
  payload: Record<string, any>;
  status: EmailDeliveryStatus;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  processedAt?: string | null;
  sentAt?: string | null;
}

export interface EmailDeliveryLogItem {
  id: string;
  queueId?: string | null;
  eventKey?: string | null;
  notificationType: EmailNotificationEventType | 'test_email';
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  recipientRole?: string | null;
  subject: string;
  relatedWoNumber?: string | null;
  deliveryStatus: EmailDeliveryStatus;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface EmailProviderHealth {
  provider: 'gmail_smtp';
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  starttlsEnabled: boolean;
  smtpUserConfigured: boolean;
  smtpPassConfigured: boolean;
  smtpUserPreview: string;
  envFromConfigured: boolean;
  envReplyToConfigured: boolean;
  resolvedFromPreview: string;
  resolvedReplyToPreview: string;
  ready: boolean;
  dedicatedTablesReady: boolean;
  statusMessage: string;
}

export interface EmailServicePersistenceHooks {
  getUsers: () => Promise<any[]>;
  getTickets: () => Promise<any[]>;
  getOperationalDateWIB: () => string;
  isLocalJsonAllowed: () => boolean;
  getLocalStore: () => {
    emailNotificationConfig?: EmailNotificationConfig;
    emailNotificationTemplates?: Record<string, EmailTemplateConfig>;
    emailNotificationQueue?: EmailQueueItem[];
    emailDeliveryLogs?: EmailDeliveryLogItem[];
    appSettings?: Record<string, any>;
  };
  saveLocalStore: () => void;
  writeAuditLog?: (action: string, entityId: string, details: string, actor?: any) => Promise<void>;
}

const DEFAULT_CONFIG: EmailNotificationConfig = {
  enabled: false,
  senderName: 'MoraJaws',
  senderEmail: 'noreply@morajaws.local',
  replyToEmail: '',
  timezone: 'Asia/Jakarta',
  rules: {
    dailyReset: { enabled: true, scheduleTime: '00:05' },
    newWoLeader: { enabled: true },
    woAssignedInstaller: { enabled: true },
    woReassigned: { enabled: true },
    dailySummary: { enabled: true, scheduleTime: '18:00' }
  },
  updatedAt: new Date().toISOString()
};

const RETRY_BACKOFF_SECONDS = [30, 120, 300];
const MAX_LOCAL_LOGS = 500;
const MAX_LOCAL_QUEUE = 500;

let persistenceHooks: EmailServicePersistenceHooks | null = null;
let cachedConfig: EmailNotificationConfig | null = null;
let cachedTemplates: Record<EmailTemplateKey, EmailTemplateConfig> | null = null;
let dedicatedTablesMissing = false;
let isWorkerProcessing = false;
let lastDailySummaryRunDateWIB: string | null = null;
let lastDailyResetTriggerDateWIB: string | null = null;
let cachedSmtpTransporter: Transporter | null = null;
let cachedSmtpTransporterKey: string | null = null;
const inProgressQueueIds = new Set<string>();
const sentEventKeysGuard = new Set<string>();

export function registerEmailNotificationPersistenceHooks(hooks: EmailServicePersistenceHooks): void {
  persistenceHooks = hooks;
}

export function isValidEmailAddress(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  // Reject spaces, newlines, header injection characters
  if (/[\r\n\s<>]/.test(trimmed)) return false;
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(trimmed);
}

function normalizeTimeHHmm(raw?: string | null, fallback: string = '18:00'): string {
  const val = String(raw || '').trim();
  const match = val.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return fallback;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function normalizeEmailConfig(raw?: Partial<EmailNotificationConfig> | null): EmailNotificationConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<EmailNotificationConfig>;
  const rawRules = (r.rules && typeof r.rules === 'object' ? r.rules : {}) as Partial<EmailNotificationRules>;

  const envFromRaw = (process.env.EMAIL_FROM || '').trim();
  const envFromEmail = envFromRaw.includes('<')
    ? (envFromRaw.match(/<([^>]+)>/)?.[1] || '').trim()
    : envFromRaw;
  const smtpUser = (process.env.SMTP_USER || '').trim();

  const rawSenderEmail = String(r.senderEmail || '').trim();
  const senderEmailCandidate =
    (rawSenderEmail && !rawSenderEmail.endsWith('.local') ? rawSenderEmail : '') ||
    envFromEmail ||
    (isValidEmailAddress(smtpUser) ? smtpUser : '') ||
    rawSenderEmail ||
    DEFAULT_CONFIG.senderEmail;
  const replyToCandidate = String(
    r.replyToEmail || process.env.EMAIL_REPLY_TO || (isValidEmailAddress(smtpUser) ? smtpUser : '')
  ).trim();

  return {
    enabled: Boolean(r.enabled),
    senderName: sanitizeTemplateText(r.senderName || DEFAULT_CONFIG.senderName).slice(0, 80) || DEFAULT_CONFIG.senderName,
    senderEmail: isValidEmailAddress(senderEmailCandidate) ? senderEmailCandidate : DEFAULT_CONFIG.senderEmail,
    replyToEmail: isValidEmailAddress(replyToCandidate) ? replyToCandidate : '',
    timezone: 'Asia/Jakarta',
    rules: {
      dailyReset: {
        enabled: rawRules.dailyReset?.enabled !== false,
        scheduleTime: normalizeTimeHHmm(rawRules.dailyReset?.scheduleTime, '00:05')
      },
      newWoLeader: {
        enabled: rawRules.newWoLeader?.enabled !== false
      },
      woAssignedInstaller: {
        enabled: rawRules.woAssignedInstaller?.enabled !== false
      },
      woReassigned: {
        enabled: rawRules.woReassigned?.enabled !== false
      },
      dailySummary: {
        enabled: rawRules.dailySummary?.enabled !== false,
        scheduleTime: normalizeTimeHHmm(rawRules.dailySummary?.scheduleTime, '18:00')
      }
    },
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt || new Date().toISOString()
  };
}

function isTableMissingError(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || '').toLowerCase();
  return code === 'PGRST205' || code === '42P01' || msg.includes('does not exist') || msg.includes('schema cache');
}

function resolveSmtpRuntimeConfig(): {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  pass: string;
  envFrom: string;
  envReplyTo: string;
} {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim() || 'smtp.gmail.com';
  const parsedPort = Number(process.env.SMTP_PORT || 587);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 587;
  const secure = String(process.env.SMTP_SECURE || 'false').trim().toLowerCase() === 'true';
  const requireTLS = !secure;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const envFrom = (process.env.EMAIL_FROM || '').trim();
  const envReplyTo = (process.env.EMAIL_REPLY_TO || '').trim();
  return { host, port, secure, requireTLS, user, pass, envFrom, envReplyTo };
}

function redactSmtpSecret(raw: string, pass: string): string {
  let out = String(raw || '');
  if (pass && pass.length >= 3) {
    out = out.split(pass).join('***');
  }
  return out;
}

function formatFromHeader(cfg: EmailNotificationConfig): string {
  const smtp = resolveSmtpRuntimeConfig();
  const displayName = sanitizeTemplateText(cfg.senderName || 'MoraJaws') || 'MoraJaws';
  if (smtp.envFrom) {
    if (smtp.envFrom.includes('<') && smtp.envFrom.includes('>')) return smtp.envFrom;
    if (isValidEmailAddress(smtp.envFrom)) return `${displayName} <${smtp.envFrom}>`;
  }
  if (isValidEmailAddress(cfg.senderEmail) && !cfg.senderEmail.endsWith('.local')) {
    return `${displayName} <${cfg.senderEmail}>`;
  }
  if (isValidEmailAddress(smtp.user)) {
    return `${displayName} <${smtp.user}>`;
  }
  const email = isValidEmailAddress(cfg.senderEmail) ? cfg.senderEmail : 'noreply@morajaws.local';
  return `${displayName} <${email}>`;
}

function resolveReplyToAddress(cfg: EmailNotificationConfig): string | undefined {
  const smtp = resolveSmtpRuntimeConfig();
  if (isValidEmailAddress(smtp.envReplyTo)) return smtp.envReplyTo;
  if (isValidEmailAddress(cfg.replyToEmail)) return cfg.replyToEmail;
  if (isValidEmailAddress(smtp.user)) return smtp.user;
  return undefined;
}

export async function getEmailProviderHealth(): Promise<EmailProviderHealth> {
  const smtp = resolveSmtpRuntimeConfig();
  const cfg = await getEmailNotificationConfig();

  const smtpUserConfigured = isValidEmailAddress(smtp.user) || smtp.user.length > 0;
  const smtpPassConfigured = smtp.pass.length >= 4;
  const envFromConfigured = Boolean(smtp.envFrom);
  const replyToResolved = resolveReplyToAddress(cfg) || '';
  const envReplyToConfigured = Boolean(smtp.envReplyTo || cfg.replyToEmail || replyToResolved);
  const resolvedFrom = formatFromHeader(cfg);

  let dedicatedTablesReady = false;
  if (isSupabaseConfigured()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { error } = await client.from('email_notification_settings').select('id').limit(1);
      dedicatedTablesReady = !error;
      dedicatedTablesMissing = Boolean(error && isTableMissingError(error));
    }
  }

  let statusMessage = `Siap mengirim email melalui Gmail SMTP (${smtp.host}:${smtp.port}, ${smtp.secure ? 'SSL/TLS' : 'STARTTLS'}).`;
  if (!smtpUserConfigured || !smtpPassConfigured) {
    statusMessage = 'SMTP_USER / SMTP_PASS belum dikonfigurasi pada secrets environment server. Queue tetap aktif, namun pengiriman SMTP menunggu kredensial server.';
  } else if (!envFromConfigured && cfg.senderEmail.endsWith('.local') && !isValidEmailAddress(smtp.user)) {
    statusMessage = 'SMTP credentials terdeteksi, namun EMAIL_FROM / alamat Gmail pengirim belum valid.';
  }

  return {
    provider: 'gmail_smtp',
    smtpHost: smtp.host,
    smtpPort: smtp.port,
    smtpSecure: smtp.secure,
    starttlsEnabled: smtp.requireTLS,
    smtpUserConfigured,
    smtpPassConfigured,
    smtpUserPreview: smtpUserConfigured ? smtp.user : 'Belum dikonfigurasi',
    envFromConfigured,
    envReplyToConfigured,
    resolvedFromPreview: resolvedFrom,
    resolvedReplyToPreview: replyToResolved || '-',
    ready: smtpUserConfigured && smtpPassConfigured,
    dedicatedTablesReady,
    statusMessage
  };
}

export async function getEmailNotificationConfig(): Promise<EmailNotificationConfig> {
  if (cachedConfig) return cachedConfig;

  if (isSupabaseConfigured() && !dedicatedTablesMissing) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { data, error } = await client
        .from('email_notification_settings')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();

      if (error) {
        if (isTableMissingError(error)) {
          dedicatedTablesMissing = true;
        }
      } else if (data) {
        cachedConfig = normalizeEmailConfig({
          enabled: data.enabled,
          senderName: data.sender_name,
          senderEmail: data.sender_email,
          replyToEmail: data.reply_to_email || '',
          timezone: data.timezone || 'Asia/Jakarta',
          rules: data.rules,
          updatedBy: data.updated_by,
          updatedAt: data.updated_at
        });
        return cachedConfig;
      }

      // Fallback to app_settings if migration 019 table isn't initialized yet
      const { data: appSet } = await client
        .from('app_settings')
        .select('value')
        .eq('key', 'email_notification_settings')
        .maybeSingle();
      if (appSet?.value && typeof appSet.value === 'object') {
        cachedConfig = normalizeEmailConfig(appSet.value);
        return cachedConfig;
      }
    }
  }

  const localStore = persistenceHooks?.getLocalStore();
  if (localStore?.emailNotificationConfig) {
    cachedConfig = normalizeEmailConfig(localStore.emailNotificationConfig);
    return cachedConfig;
  }
  if (localStore?.appSettings?.email_notification_settings) {
    cachedConfig = normalizeEmailConfig(localStore.appSettings.email_notification_settings);
    return cachedConfig;
  }

  cachedConfig = normalizeEmailConfig(DEFAULT_CONFIG);
  return cachedConfig;
}

export async function saveEmailNotificationConfig(
  updates: Partial<EmailNotificationConfig>,
  actor: { id?: string; name?: string; role?: string }
): Promise<EmailNotificationConfig> {
  const current = await getEmailNotificationConfig();
  const merged = normalizeEmailConfig({
    ...current,
    ...updates,
    rules: {
      dailyReset: {
        ...current.rules.dailyReset,
        ...(updates.rules?.dailyReset || {})
      },
      newWoLeader: {
        ...current.rules.newWoLeader,
        ...(updates.rules?.newWoLeader || {})
      },
      woAssignedInstaller: {
        ...current.rules.woAssignedInstaller,
        ...(updates.rules?.woAssignedInstaller || {})
      },
      woReassigned: {
        ...current.rules.woReassigned,
        ...(updates.rules?.woReassigned || {})
      },
      dailySummary: {
        ...current.rules.dailySummary,
        ...(updates.rules?.dailySummary || {})
      }
    },
    updatedBy: actor.name || 'Super Admin',
    updatedAt: new Date().toISOString()
  });

  if (isSupabaseConfigured()) {
    const client = getSupabaseBackendClient();
    if (client && !dedicatedTablesMissing) {
      const { error } = await client.from('email_notification_settings').upsert({
        id: 'default',
        enabled: merged.enabled,
        sender_name: merged.senderName,
        sender_email: merged.senderEmail,
        reply_to_email: merged.replyToEmail || null,
        timezone: merged.timezone,
        rules: merged.rules,
        updated_by: merged.updatedBy,
        updated_at: merged.updatedAt
      });
      if (error && isTableMissingError(error)) {
        dedicatedTablesMissing = true;
      }
    }
    if (client && dedicatedTablesMissing) {
      await client.from('app_settings').upsert({
        key: 'email_notification_settings',
        value: merged,
        updated_at: merged.updatedAt
      });
    }
  }

  const localStore = persistenceHooks?.getLocalStore();
  if (localStore) {
    localStore.emailNotificationConfig = merged;
    localStore.appSettings = localStore.appSettings || {};
    localStore.appSettings.email_notification_settings = merged;
    if (persistenceHooks?.isLocalJsonAllowed()) {
      persistenceHooks.saveLocalStore();
    }
  }

  cachedConfig = merged;
  await persistenceHooks?.writeAuditLog?.(
    'Email Notification Config Updated',
    'email_notification_settings',
    `Konfigurasi Email Notification diperbarui oleh ${merged.updatedBy} (enabled=${merged.enabled}, sender=${merged.senderEmail})`,
    actor
  );

  return merged;
}

export async function getEmailTemplates(): Promise<Record<EmailTemplateKey, EmailTemplateConfig>> {
  if (cachedTemplates) return cachedTemplates;
  const defaults = getDefaultEmailTemplates();

  if (isSupabaseConfigured() && !dedicatedTablesMissing) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { data, error } = await client.from('email_notification_templates').select('*');
      if (error) {
        if (isTableMissingError(error)) dedicatedTablesMissing = true;
      } else if (Array.isArray(data) && data.length > 0) {
        const merged = { ...defaults };
        for (const row of data) {
          const key = row.template_key as EmailTemplateKey;
          if (merged[key]) {
            merged[key] = {
              ...merged[key],
              enabled: row.enabled !== false,
              subject: sanitizeTemplateText(row.subject || merged[key].subject),
              greeting: sanitizeTemplateText(row.greeting || merged[key].greeting),
              bodyIntro: sanitizeTemplateText(row.body_intro || merged[key].bodyIntro),
              footerText: sanitizeTemplateText(row.footer_text || merged[key].footerText),
              updatedBy: row.updated_by || undefined,
              updatedAt: row.updated_at || merged[key].updatedAt
            };
          }
        }
        cachedTemplates = merged;
        return cachedTemplates;
      }

      if (dedicatedTablesMissing) {
        const { data: appSet } = await client
          .from('app_settings')
          .select('value')
          .eq('key', 'email_notification_templates')
          .maybeSingle();
        if (appSet?.value && typeof appSet.value === 'object') {
          const merged = { ...defaults };
          for (const key of Object.keys(defaults) as EmailTemplateKey[]) {
            const override = appSet.value[key];
            if (override && typeof override === 'object') {
              merged[key] = {
                ...defaults[key],
                enabled: override.enabled !== false,
                subject: sanitizeTemplateText(override.subject || defaults[key].subject),
                greeting: sanitizeTemplateText(override.greeting || defaults[key].greeting),
                bodyIntro: sanitizeTemplateText(override.bodyIntro || defaults[key].bodyIntro),
                footerText: sanitizeTemplateText(override.footerText || defaults[key].footerText),
                updatedBy: override.updatedBy,
                updatedAt: override.updatedAt
              };
            }
          }
          cachedTemplates = merged;
          return cachedTemplates;
        }
      }
    }
  }

  const localStore = persistenceHooks?.getLocalStore();
  if (localStore?.emailNotificationTemplates) {
    const merged = { ...defaults };
    for (const key of Object.keys(defaults) as EmailTemplateKey[]) {
      const override = localStore.emailNotificationTemplates[key];
      if (override) {
        merged[key] = {
          ...defaults[key],
          ...override,
          subject: sanitizeTemplateText(override.subject || defaults[key].subject),
          greeting: sanitizeTemplateText(override.greeting || defaults[key].greeting),
          bodyIntro: sanitizeTemplateText(override.bodyIntro || defaults[key].bodyIntro),
          footerText: sanitizeTemplateText(override.footerText || defaults[key].footerText)
        };
      }
    }
    cachedTemplates = merged;
    return cachedTemplates;
  }

  cachedTemplates = defaults;
  return cachedTemplates;
}

export async function saveEmailTemplate(
  templateKey: EmailTemplateKey,
  updates: Partial<EmailTemplateConfig>,
  actor: { id?: string; name?: string; role?: string }
): Promise<EmailTemplateConfig> {
  const all = await getEmailTemplates();
  const existing = all[templateKey];
  if (!existing) {
    throw new Error(`Template key "${templateKey}" tidak dikenal.`);
  }

  const updated: EmailTemplateConfig = {
    ...existing,
    enabled: updates.enabled !== undefined ? Boolean(updates.enabled) : existing.enabled,
    subject: updates.subject !== undefined ? sanitizeTemplateText(updates.subject) : existing.subject,
    greeting: updates.greeting !== undefined ? sanitizeTemplateText(updates.greeting) : existing.greeting,
    bodyIntro: updates.bodyIntro !== undefined ? sanitizeTemplateText(updates.bodyIntro) : existing.bodyIntro,
    footerText: updates.footerText !== undefined ? sanitizeTemplateText(updates.footerText) : existing.footerText,
    updatedBy: actor.name || 'Super Admin',
    updatedAt: new Date().toISOString()
  };

  if (!updated.subject.trim()) {
    updated.subject = existing.subject;
  }

  const nextMap = { ...all, [templateKey]: updated };

  if (isSupabaseConfigured()) {
    const client = getSupabaseBackendClient();
    if (client && !dedicatedTablesMissing) {
      const { error } = await client.from('email_notification_templates').upsert({
        template_key: updated.templateKey,
        event_type: updated.eventType,
        label: updated.label,
        description: updated.description,
        enabled: updated.enabled,
        subject: updated.subject,
        greeting: updated.greeting,
        body_intro: updated.bodyIntro,
        footer_text: updated.footerText,
        updated_by: updated.updatedBy,
        updated_at: updated.updatedAt
      });
      if (error && isTableMissingError(error)) {
        dedicatedTablesMissing = true;
      }
    }
    if (client && dedicatedTablesMissing) {
      await client.from('app_settings').upsert({
        key: 'email_notification_templates',
        value: nextMap,
        updated_at: updated.updatedAt
      });
    }
  }

  const localStore = persistenceHooks?.getLocalStore();
  if (localStore) {
    localStore.emailNotificationTemplates = nextMap;
    localStore.appSettings = localStore.appSettings || {};
    localStore.appSettings.email_notification_templates = nextMap;
    if (persistenceHooks?.isLocalJsonAllowed()) {
      persistenceHooks.saveLocalStore();
    }
  }

  cachedTemplates = nextMap;
  await persistenceHooks?.writeAuditLog?.(
    'Email Template Updated',
    templateKey,
    `Template email "${templateKey}" diperbarui oleh ${updated.updatedBy} (enabled=${updated.enabled})`,
    actor
  );

  return updated;
}

export async function renderDemoPreviewForTemplate(
  templateKey: EmailTemplateKey,
  draftOverride?: Partial<EmailTemplateConfig>
): Promise<{ subject: string; htmlBody: string; textBody: string; context: EmailTemplateRenderContext }> {
  const templates = await getEmailTemplates();
  const baseTpl = templates[templateKey];
  if (!baseTpl) {
    throw new Error(`Template "${templateKey}" tidak ditemukan.`);
  }
  const effectiveTpl: EmailTemplateConfig = {
    ...baseTpl,
    subject: draftOverride?.subject !== undefined ? sanitizeTemplateText(draftOverride.subject) : baseTpl.subject,
    greeting: draftOverride?.greeting !== undefined ? sanitizeTemplateText(draftOverride.greeting) : baseTpl.greeting,
    bodyIntro: draftOverride?.bodyIntro !== undefined ? sanitizeTemplateText(draftOverride.bodyIntro) : baseTpl.bodyIntro,
    footerText: draftOverride?.footerText !== undefined ? sanitizeTemplateText(draftOverride.footerText) : baseTpl.footerText
  };
  const demoCtx = getDemoContextForTemplate(templateKey);
  const rendered = renderEmailTemplate(effectiveTpl, demoCtx);
  return {
    ...rendered,
    context: demoCtx
  };
}

// ============================================================================
// GMAIL SMTP CLIENT (NODEMAILER + STARTTLS)
// ============================================================================

function getOrCreateSmtpTransporter(): Transporter {
  const smtp = resolveSmtpRuntimeConfig();
  const passDigest = crypto.createHash('sha256').update(smtp.pass).digest('hex').slice(0, 16);
  const key = `${smtp.host}:${smtp.port}:${smtp.secure}:${smtp.user}:${passDigest}:${process.env.SMTP_TEST_ALLOW_SELF_SIGNED || '0'}`;

  if (cachedSmtpTransporter && cachedSmtpTransporterKey === key) {
    return cachedSmtpTransporter;
  }

  if (cachedSmtpTransporter && typeof cachedSmtpTransporter.close === 'function') {
    try {
      cachedSmtpTransporter.close();
    } catch {
      // ignore close errors
    }
  }

  const isLocalTestServer =
    (smtp.host === '127.0.0.1' || smtp.host === 'localhost') &&
    process.env.SMTP_TEST_ALLOW_SELF_SIGNED === '1';

  cachedSmtpTransporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.requireTLS,
    auth: {
      user: smtp.user,
      pass: smtp.pass
    },
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      minVersion: 'TLSv1.2',
      servername: smtp.host,
      rejectUnauthorized: !isLocalTestServer
    }
  });
  cachedSmtpTransporterKey = key;
  return cachedSmtpTransporter;
}

function classifySmtpError(err: any, pass: string): {
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
} {
  const rawMsg = redactSmtpSecret(String(err?.message || 'Koneksi Gmail SMTP gagal.'), pass);
  const code = String(err?.code || '').toUpperCase();
  const responseCode = Number(err?.responseCode || 0);

  // Permanent authentication / policy / invalid envelope errors — never retry
  if (
    code === 'EAUTH' ||
    code === 'EENVELOPE' ||
    responseCode === 530 ||
    responseCode === 534 ||
    responseCode === 535 ||
    responseCode === 550 ||
    responseCode === 551 ||
    responseCode === 552 ||
    responseCode === 553 ||
    responseCode === 554
  ) {
    return {
      retryable: false,
      errorCode: code || `SMTP_${responseCode || 'AUTH_FAILED'}`,
      errorMessage: rawMsg
    };
  }

  // Transient TCP / TLS / rate-limit errors
  return {
    retryable: true,
    errorCode: code || (responseCode ? `SMTP_${responseCode}` : 'SMTP_TRANSIENT_ERROR'),
    errorMessage: rawMsg
  };
}

async function sendViaGmailSmtp(params: {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
}): Promise<{
  ok: boolean;
  messageId?: string;
  httpStatus: number;
  retryable: boolean;
  errorCode?: string;
  errorMessage?: string;
}> {
  const smtp = resolveSmtpRuntimeConfig();
  if (!smtp.user || !smtp.pass) {
    return {
      ok: false,
      httpStatus: 0,
      retryable: false,
      errorCode: 'SMTP_CREDENTIALS_MISSING',
      errorMessage: 'SMTP_USER atau SMTP_PASS belum dikonfigurasi pada secrets environment server.'
    };
  }

  try {
    const transporter = getOrCreateSmtpTransporter();
    const info = await transporter.sendMail({
      from: params.from,
      to: params.to,
      replyTo: params.replyTo && isValidEmailAddress(params.replyTo) ? params.replyTo : undefined,
      subject: params.subject,
      html: params.html,
      text: params.text,
      headers: params.idempotencyKey
        ? { 'X-MoraJaws-Event-Key': params.idempotencyKey.slice(0, 200) }
        : undefined
    });

    const msgId = String(info?.messageId || '').trim() || `smtp_${Date.now()}`;
    return {
      ok: true,
      messageId: msgId,
      httpStatus: 250,
      retryable: false
    };
  } catch (err: any) {
    const classified = classifySmtpError(err, smtp.pass);
    return {
      ok: false,
      httpStatus: Number(err?.responseCode || 0),
      retryable: classified.retryable,
      errorCode: classified.errorCode,
      errorMessage: classified.errorMessage
    };
  }
}

export async function testSmtpProviderConnection(): Promise<{
  success: boolean;
  statusCode: number;
  message: string;
}> {
  const smtp = resolveSmtpRuntimeConfig();
  if (!smtp.user || !smtp.pass) {
    return {
      success: false,
      statusCode: 0,
      message: 'SMTP_USER dan SMTP_PASS belum terpasang di secrets environment server.'
    };
  }

  try {
    const transporter = getOrCreateSmtpTransporter();
    await transporter.verify();
    return {
      success: true,
      statusCode: 250,
      message: `Koneksi Gmail SMTP (${smtp.host}:${smtp.port}, ${smtp.secure ? 'SSL/TLS' : 'STARTTLS'}) terverifikasi untuk ${smtp.user}.`
    };
  } catch (err: any) {
    const classified = classifySmtpError(err, smtp.pass);
    return {
      success: false,
      statusCode: Number(err?.responseCode || 0),
      message: `Gagal verifikasi Gmail SMTP (${smtp.host}:${smtp.port}): ${classified.errorMessage}`
    };
  }
}

export const testResendProviderConnection = testSmtpProviderConnection;

// ============================================================================
// QUEUE STORAGE & DELIVERY LOGS
// ============================================================================

async function appendDeliveryLog(entry: Omit<EmailDeliveryLogItem, 'id' | 'createdAt'>): Promise<EmailDeliveryLogItem> {
  const logRow: EmailDeliveryLogItem = {
    id: `elog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    ...entry
  };

  if (isSupabaseConfigured() && !dedicatedTablesMissing) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { error } = await client.from('email_delivery_logs').insert({
        id: logRow.id,
        queue_id: logRow.queueId || null,
        event_key: logRow.eventKey || null,
        notification_type: logRow.notificationType,
        recipient_user_id: logRow.recipientUserId || null,
        recipient_email: logRow.recipientEmail || null,
        recipient_name: logRow.recipientName || null,
        recipient_role: logRow.recipientRole || null,
        subject: logRow.subject,
        related_wo_number: logRow.relatedWoNumber || null,
        delivery_status: logRow.deliveryStatus,
        provider_message_id: logRow.providerMessageId || null,
        error_message: logRow.errorMessage || null,
        metadata: logRow.metadata || {},
        created_at: logRow.createdAt
      });
      if (error && isTableMissingError(error)) {
        dedicatedTablesMissing = true;
      }
    }
  }

  const localStore = persistenceHooks?.getLocalStore();
  if (localStore) {
    localStore.emailDeliveryLogs = localStore.emailDeliveryLogs || [];
    localStore.emailDeliveryLogs.unshift(logRow);
    if (localStore.emailDeliveryLogs.length > MAX_LOCAL_LOGS) {
      localStore.emailDeliveryLogs.length = MAX_LOCAL_LOGS;
    }
    if (persistenceHooks?.isLocalJsonAllowed()) {
      persistenceHooks.saveLocalStore();
    }
  }

  return logRow;
}

async function enqueueEmailItem(params: {
  eventKey: string;
  eventType: EmailNotificationEventType;
  templateKey: EmailTemplateKey;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  recipientRole?: string | null;
  relatedTicketId?: string | null;
  relatedWoNumber?: string | null;
  context: EmailTemplateRenderContext;
}): Promise<{ enqueued: boolean; deduped?: boolean; skipped?: boolean; queueId?: string }> {
  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled) {
    return { enqueued: false, skipped: true };
  }

  const templates = await getEmailTemplates();
  const tpl = templates[params.templateKey];
  if (!tpl || !tpl.enabled) {
    return { enqueued: false, skipped: true };
  }

  const rendered = renderEmailTemplate(tpl, params.context);
  const cleanEmail = (params.recipientEmail || '').trim();
  const validEmail = isValidEmailAddress(cleanEmail);
  const nowIso = new Date().toISOString();

  const item: EmailQueueItem = {
    id: `eq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    eventKey: params.eventKey,
    eventType: params.eventType,
    templateKey: params.templateKey,
    recipientUserId: params.recipientUserId || null,
    recipientEmail: cleanEmail || null,
    recipientName: params.recipientName || null,
    recipientRole: params.recipientRole || null,
    relatedTicketId: params.relatedTicketId || null,
    relatedWoNumber: params.relatedWoNumber || null,
    subject: rendered.subject,
    htmlBody: rendered.htmlBody,
    textBody: rendered.textBody,
    payload: {
      area: params.context.area,
      contractorName: params.context.contractorName,
      operationalDate: params.context.operationalDate
    },
    status: validEmail ? 'queued' : 'skipped',
    retryCount: 0,
    maxRetries: 3,
    nextRetryAt: validEmail ? nowIso : null,
    errorMessage: validEmail ? null : 'Email penerima kosong atau format email tidak valid.',
    createdAt: nowIso
  };

  if (isSupabaseConfigured() && !dedicatedTablesMissing) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { error } = await client.from('email_notification_queue').insert({
        id: item.id,
        event_key: item.eventKey,
        event_type: item.eventType,
        template_key: item.templateKey,
        recipient_user_id: item.recipientUserId,
        recipient_email: item.recipientEmail,
        recipient_name: item.recipientName,
        recipient_role: item.recipientRole,
        related_ticket_id: item.relatedTicketId,
        related_wo_number: item.relatedWoNumber,
        subject: item.subject,
        html_body: item.htmlBody,
        text_body: item.textBody,
        payload: item.payload,
        status: item.status,
        retry_count: item.retryCount,
        max_retries: item.maxRetries,
        next_retry_at: item.nextRetryAt,
        error_message: item.errorMessage,
        created_at: item.createdAt
      });

      if (error) {
        if (String(error.code) === '23505') {
          return { enqueued: false, deduped: true };
        }
        if (isTableMissingError(error)) {
          dedicatedTablesMissing = true;
        } else {
          console.warn('[EmailQueue] Supabase insert error:', error.message);
        }
      } else {
        await appendDeliveryLog({
          queueId: item.id,
          eventKey: item.eventKey,
          notificationType: item.eventType,
          recipientUserId: item.recipientUserId,
          recipientEmail: item.recipientEmail,
          recipientName: item.recipientName,
          recipientRole: item.recipientRole,
          subject: item.subject,
          relatedWoNumber: item.relatedWoNumber,
          deliveryStatus: item.status,
          errorMessage: item.errorMessage || undefined
        });
        return { enqueued: validEmail, skipped: !validEmail, queueId: item.id };
      }
    }
  }

  // Fallback / Local queue with idempotency dedup
  const localStore = persistenceHooks?.getLocalStore();
  if (localStore) {
    localStore.emailNotificationQueue = localStore.emailNotificationQueue || [];
    if (localStore.emailNotificationQueue.some(q => q.eventKey === item.eventKey)) {
      return { enqueued: false, deduped: true };
    }
    localStore.emailNotificationQueue.unshift(item);
    if (localStore.emailNotificationQueue.length > MAX_LOCAL_QUEUE) {
      localStore.emailNotificationQueue.length = MAX_LOCAL_QUEUE;
    }
    if (persistenceHooks?.isLocalJsonAllowed()) {
      persistenceHooks.saveLocalStore();
    }
  }

  await appendDeliveryLog({
    queueId: item.id,
    eventKey: item.eventKey,
    notificationType: item.eventType,
    recipientUserId: item.recipientUserId,
    recipientEmail: item.recipientEmail,
    recipientName: item.recipientName,
    recipientRole: item.recipientRole,
    subject: item.subject,
    relatedWoNumber: item.relatedWoNumber,
    deliveryStatus: item.status,
    errorMessage: item.errorMessage || undefined
  });

  return { enqueued: validEmail, skipped: !validEmail, queueId: item.id };
}

async function updateQueueRow(item: EmailQueueItem): Promise<void> {
  if (isSupabaseConfigured() && !dedicatedTablesMissing) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { error } = await client
        .from('email_notification_queue')
        .update({
          status: item.status,
          retry_count: item.retryCount,
          next_retry_at: item.nextRetryAt || null,
          provider_message_id: item.providerMessageId || null,
          error_message: item.errorMessage || null,
          processed_at: item.processedAt || null,
          sent_at: item.sentAt || null
        })
        .eq('id', item.id);
      if (error && isTableMissingError(error)) {
        dedicatedTablesMissing = true;
      }
    }
  }

  const localStore = persistenceHooks?.getLocalStore();
  if (localStore?.emailNotificationQueue) {
    const idx = localStore.emailNotificationQueue.findIndex(q => q.id === item.id);
    if (idx >= 0) {
      localStore.emailNotificationQueue[idx] = { ...item };
      if (persistenceHooks?.isLocalJsonAllowed()) {
        persistenceHooks.saveLocalStore();
      }
    }
  }
}

export async function processEmailQueueBatch(limit: number = 15): Promise<{
  processed: number;
  sent: number;
  retryScheduled: number;
  failed: number;
  skipped: number;
}> {
  if (isWorkerProcessing) {
    return { processed: 0, sent: 0, retryScheduled: 0, failed: 0, skipped: 0 };
  }
  isWorkerProcessing = true;
  const summary = { processed: 0, sent: 0, retryScheduled: 0, failed: 0, skipped: 0 };

  try {
    const cfg = await getEmailNotificationConfig();
    if (!cfg.enabled) return summary;

    const nowIso = new Date().toISOString();
    let dueItems: EmailQueueItem[] = [];

    if (isSupabaseConfigured() && !dedicatedTablesMissing) {
      const client = getSupabaseBackendClient();
      if (client) {
        const { data, error } = await client
          .from('email_notification_queue')
          .select('*')
          .in('status', ['queued', 'retry_pending'])
          .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
          .order('created_at', { ascending: true })
          .limit(limit);

        if (error) {
          if (isTableMissingError(error)) dedicatedTablesMissing = true;
        } else if (Array.isArray(data)) {
          dueItems = data.map((row: any) => ({
            id: row.id,
            eventKey: row.event_key,
            eventType: row.event_type,
            templateKey: row.template_key,
            recipientUserId: row.recipient_user_id,
            recipientEmail: row.recipient_email,
            recipientName: row.recipient_name,
            recipientRole: row.recipient_role,
            relatedTicketId: row.related_ticket_id,
            relatedWoNumber: row.related_wo_number,
            subject: row.subject,
            htmlBody: row.html_body,
            textBody: row.text_body,
            payload: row.payload || {},
            status: row.status,
            retryCount: row.retry_count || 0,
            maxRetries: row.max_retries || 3,
            nextRetryAt: row.next_retry_at,
            providerMessageId: row.provider_message_id,
            errorMessage: row.error_message,
            createdAt: row.created_at,
            processedAt: row.processed_at,
            sentAt: row.sent_at
          }));
        }
      }
    }

    if (dueItems.length === 0) {
      const localStore = persistenceHooks?.getLocalStore();
      if (localStore?.emailNotificationQueue) {
        dueItems = localStore.emailNotificationQueue
          .filter(
            q =>
              (q.status === 'queued' || q.status === 'retry_pending') &&
              (!q.nextRetryAt || q.nextRetryAt <= nowIso)
          )
          .slice(0, limit);
      }
    }

    const fromHeader = formatFromHeader(cfg);
    const replyToHeader = resolveReplyToAddress(cfg);

    for (const item of dueItems) {
      if (inProgressQueueIds.has(item.id)) {
        continue;
      }

      // Idempotency guard: if already sent or already has providerMessageId, never resend
      if (
        item.providerMessageId ||
        sentEventKeysGuard.has(item.eventKey)
      ) {
        if (item.status !== 'sent' && item.status !== 'delivered') {
          item.status = 'sent';
          item.errorMessage = null;
          item.sentAt = item.sentAt || new Date().toISOString();
          await updateQueueRow(item);
        }
        continue;
      }

      // Check existing delivery logs for same eventKey already sent/delivered
      const localStore = persistenceHooks?.getLocalStore();
      const alreadySentLocally = Boolean(
        localStore?.emailDeliveryLogs?.some(
          l =>
            l.eventKey === item.eventKey &&
            (l.deliveryStatus === 'sent' || l.deliveryStatus === 'delivered')
        )
      );
      if (alreadySentLocally) {
        sentEventKeysGuard.add(item.eventKey);
        item.status = 'sent';
        item.errorMessage = null;
        item.sentAt = item.sentAt || new Date().toISOString();
        await updateQueueRow(item);
        continue;
      }

      if (!isValidEmailAddress(item.recipientEmail)) {
        summary.processed++;
        item.status = 'skipped';
        item.errorMessage = 'Email penerima kosong atau tidak valid.';
        item.processedAt = new Date().toISOString();
        await updateQueueRow(item);
        await appendDeliveryLog({
          queueId: item.id,
          eventKey: item.eventKey,
          notificationType: item.eventType,
          recipientUserId: item.recipientUserId,
          recipientEmail: item.recipientEmail,
          recipientName: item.recipientName,
          recipientRole: item.recipientRole,
          subject: item.subject,
          relatedWoNumber: item.relatedWoNumber,
          deliveryStatus: 'skipped',
          errorMessage: item.errorMessage
        });
        summary.skipped++;
        continue;
      }

      // Atomic conditional claim in Supabase to avoid duplicate sends across overlapping batches
      if (isSupabaseConfigured() && !dedicatedTablesMissing) {
        const client = getSupabaseBackendClient();
        if (client) {
          const { data: claimed, error: claimErr } = await client
            .from('email_notification_queue')
            .update({
              status: 'processing',
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id)
            .in('status', ['queued', 'retry_pending'])
            .is('provider_message_id', null)
            .select('id')
            .maybeSingle();
          if (claimErr) {
            if (isTableMissingError(claimErr)) dedicatedTablesMissing = true;
          } else if (!claimed) {
            continue;
          }
        }
      }

      inProgressQueueIds.add(item.id);
      try {
        summary.processed++;
        item.status = 'processing';
        item.processedAt = new Date().toISOString();
        await updateQueueRow(item);

        const sendRes = await sendViaGmailSmtp({
          from: fromHeader,
          to: item.recipientEmail!,
          replyTo: replyToHeader,
          subject: item.subject,
          html: item.htmlBody,
          text: item.textBody,
          idempotencyKey: item.eventKey
        });

        if (sendRes.ok) {
          sentEventKeysGuard.add(item.eventKey);
          if (sentEventKeysGuard.size > 5000) {
            const firstKey = sentEventKeysGuard.values().next().value;
            if (firstKey) sentEventKeysGuard.delete(firstKey);
          }
          item.status = 'sent';
          item.providerMessageId = sendRes.messageId || null;
          item.errorMessage = null;
          item.sentAt = new Date().toISOString();
          await updateQueueRow(item);
          await appendDeliveryLog({
            queueId: item.id,
            eventKey: item.eventKey,
            notificationType: item.eventType,
            recipientUserId: item.recipientUserId,
            recipientEmail: item.recipientEmail,
            recipientName: item.recipientName,
            recipientRole: item.recipientRole,
            subject: item.subject,
            relatedWoNumber: item.relatedWoNumber,
            deliveryStatus: 'sent',
            providerMessageId: item.providerMessageId || undefined
          });
          summary.sent++;
        } else {
          const nextRetry = item.retryCount + 1;
          item.retryCount = nextRetry;
          item.errorMessage = sendRes.errorMessage || 'Pengiriman email melalui Gmail SMTP gagal.';

          if (sendRes.retryable && nextRetry <= item.maxRetries) {
            const delaySec = RETRY_BACKOFF_SECONDS[Math.min(nextRetry - 1, RETRY_BACKOFF_SECONDS.length - 1)];
            item.status = 'retry_pending';
            item.nextRetryAt = new Date(Date.now() + delaySec * 1000).toISOString();
            summary.retryScheduled++;
          } else {
            item.status = 'failed';
            item.nextRetryAt = null;
            summary.failed++;
          }

          await updateQueueRow(item);
          await appendDeliveryLog({
            queueId: item.id,
            eventKey: item.eventKey,
            notificationType: item.eventType,
            recipientUserId: item.recipientUserId,
            recipientEmail: item.recipientEmail,
            recipientName: item.recipientName,
            recipientRole: item.recipientRole,
            subject: item.subject,
            relatedWoNumber: item.relatedWoNumber,
            deliveryStatus: item.status,
            errorMessage: item.errorMessage || undefined
          });
        }
      } finally {
        inProgressQueueIds.delete(item.id);
      }
    }
  } finally {
    isWorkerProcessing = false;
  }

  return summary;
}

export async function sendTestEmailNotification(params: {
  recipientEmail: string;
  templateKey?: EmailTemplateKey;
  actor: { id?: string; name?: string; role?: string };
}): Promise<{
  success: boolean;
  message: string;
  providerMessageId?: string;
  code?: string;
}> {
  const cleanEmail = (params.recipientEmail || '').trim();
  if (!isValidEmailAddress(cleanEmail)) {
    return {
      success: false,
      code: 'INVALID_RECIPIENT_EMAIL',
      message: 'Alamat email tujuan test tidak valid.'
    };
  }

  const cfg = await getEmailNotificationConfig();
  const templates = await getEmailTemplates();
  const tplKey: EmailTemplateKey = params.templateKey && templates[params.templateKey]
    ? params.templateKey
    : 'new_wo_leader';
  const tpl = templates[tplKey];
  const ctx = getDemoContextForTemplate(tplKey);
  ctx.recipientName = params.actor.name || ctx.recipientName;
  ctx.isDemoPreview = true;

  const rendered = renderEmailTemplate(tpl, ctx);
  const sendRes = await sendViaGmailSmtp({
    from: formatFromHeader(cfg),
    to: cleanEmail,
    replyTo: resolveReplyToAddress(cfg),
    subject: `[TEST] ${rendered.subject}`,
    html: rendered.htmlBody,
    text: rendered.textBody
  });

  await appendDeliveryLog({
    eventKey: `test_send:${tplKey}:${Date.now()}`,
    notificationType: 'test_email',
    recipientUserId: params.actor.id || null,
    recipientEmail: cleanEmail,
    recipientName: params.actor.name || 'Super Admin',
    recipientRole: params.actor.role || 'super_admin',
    subject: `[TEST] ${rendered.subject}`,
    deliveryStatus: sendRes.ok ? 'sent' : 'failed',
    providerMessageId: sendRes.messageId,
    errorMessage: sendRes.errorMessage
  });

  if (!sendRes.ok) {
    return {
      success: false,
      code: sendRes.errorCode || 'TEST_SEND_FAILED',
      message: sendRes.errorMessage || 'Gagal mengirim test email.'
    };
  }

  return {
    success: true,
    providerMessageId: sendRes.messageId,
    message: `Test email berhasil dikirim ke ${cleanEmail} (Message ID: ${sendRes.messageId}).`
  };
}

export async function listEmailDeliveryLogs(filters?: {
  dateFrom?: string;
  dateTo?: string;
  role?: string;
  notificationType?: string;
  status?: string;
  search?: string;
  limit?: number;
}): Promise<{ logs: EmailDeliveryLogItem[]; total: number; queueCounts: Record<string, number> }> {
  const limit = Math.min(Math.max(Number(filters?.limit) || 100, 1), 300);
  let rawLogs: EmailDeliveryLogItem[] = [];
  const queueCounts: Record<string, number> = {
    queued: 0,
    processing: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    retry_pending: 0,
    skipped: 0
  };

  if (isSupabaseConfigured() && !dedicatedTablesMissing) {
    const client = getSupabaseBackendClient();
    if (client) {
      let q = client
        .from('email_delivery_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (filters?.role && filters.role !== 'ALL') q = q.eq('recipient_role', filters.role);
      if (filters?.notificationType && filters.notificationType !== 'ALL') {
        q = q.eq('notification_type', filters.notificationType);
      }
      if (filters?.status && filters.status !== 'ALL') {
        q = q.eq('delivery_status', filters.status);
      }
      if (filters?.dateFrom) q = q.gte('created_at', `${filters.dateFrom}T00:00:00.000Z`);
      if (filters?.dateTo) q = q.lte('created_at', `${filters.dateTo}T23:59:59.999Z`);

      const { data, error } = await q;
      if (error) {
        if (isTableMissingError(error)) dedicatedTablesMissing = true;
      } else if (Array.isArray(data)) {
        rawLogs = data.map((row: any) => ({
          id: row.id,
          queueId: row.queue_id,
          eventKey: row.event_key,
          notificationType: row.notification_type,
          recipientUserId: row.recipient_user_id,
          recipientEmail: row.recipient_email,
          recipientName: row.recipient_name,
          recipientRole: row.recipient_role,
          subject: row.subject,
          relatedWoNumber: row.related_wo_number,
          deliveryStatus: row.delivery_status,
          providerMessageId: row.provider_message_id,
          errorMessage: row.error_message,
          metadata: row.metadata || {},
          createdAt: row.created_at
        }));
      }

      if (!dedicatedTablesMissing) {
        const { data: qStats } = await client
          .from('email_notification_queue')
          .select('status')
          .order('created_at', { ascending: false })
          .limit(500);
        if (Array.isArray(qStats)) {
          for (const row of qStats) {
            const st = String(row.status || 'queued');
            queueCounts[st] = (queueCounts[st] || 0) + 1;
          }
        }
      }
    }
  }

  if (rawLogs.length === 0) {
    const localStore = persistenceHooks?.getLocalStore();
    rawLogs = [...(localStore?.emailDeliveryLogs || [])];
    for (const q of localStore?.emailNotificationQueue || []) {
      queueCounts[q.status] = (queueCounts[q.status] || 0) + 1;
    }
  }

  const searchLower = (filters?.search || '').trim().toLowerCase();
  const filtered = rawLogs.filter(item => {
    if (filters?.role && filters.role !== 'ALL' && item.recipientRole !== filters.role) return false;
    if (filters?.notificationType && filters.notificationType !== 'ALL' && item.notificationType !== filters.notificationType) return false;
    if (filters?.status && filters.status !== 'ALL' && item.deliveryStatus !== filters.status) return false;
    if (filters?.dateFrom && item.createdAt < `${filters.dateFrom}T00:00:00`) return false;
    if (filters?.dateTo && item.createdAt > `${filters.dateTo}T23:59:59.999Z`) return false;
    if (searchLower) {
      const hay = `${item.recipientEmail || ''} ${item.recipientName || ''} ${item.relatedWoNumber || ''} ${item.subject || ''} ${item.providerMessageId || ''}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  return {
    logs: filtered.slice(0, limit),
    total: filtered.length,
    queueCounts
  };
}

export function verifyResendWebhookSignature(params: {
  rawBody: string;
  svixId?: string;
  svixTimestamp?: string;
  svixSignature?: string;
  secret: string;
}): boolean {
  const { rawBody, svixId, svixTimestamp, svixSignature, secret } = params;
  if (!secret || !svixId || !svixTimestamp || !svixSignature || !rawBody) {
    return false;
  }
  const tsNum = Number(svixTimestamp);
  if (!Number.isFinite(tsNum)) return false;
  // Tolerance window: 5 minutes
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > 300) return false;

  const cleanSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(cleanSecret, 'base64');
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent, 'utf8')
    .digest('base64');

  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const candidates = svixSignature.split(' ').map(part => part.trim()).filter(Boolean);
  for (const part of candidates) {
    const [, sigVal] = part.includes(',') ? part.split(',', 2) : ['v1', part];
    if (!sigVal) continue;
    const candidateBuf = Buffer.from(sigVal.trim(), 'utf8');
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

export async function handleResendWebhookEvent(payload: any): Promise<boolean> {
  const evtType = String(payload?.type || '').trim().toLowerCase();
  const emailId = String(payload?.data?.email_id || payload?.data?.id || '').trim();
  if (!emailId) return false;

  let nextStatus: EmailDeliveryStatus | null = null;
  let errorMsg: string | null = null;
  if (evtType === 'email.delivered') nextStatus = 'delivered';
  else if (evtType === 'email.bounced' || evtType === 'email.delivery_delayed' || evtType === 'email.complained') {
    nextStatus = 'failed';
    errorMsg = `Resend webhook event: ${evtType}`;
  }
  if (!nextStatus) return false;

  if (isSupabaseConfigured() && !dedicatedTablesMissing) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { data: queueRow, error } = await client
        .from('email_notification_queue')
        .select('*')
        .eq('provider_message_id', emailId)
        .maybeSingle();

      if (error && isTableMissingError(error)) {
        dedicatedTablesMissing = true;
      } else if (queueRow) {
        await client
          .from('email_notification_queue')
          .update({ status: nextStatus, error_message: errorMsg })
          .eq('id', queueRow.id);

        await appendDeliveryLog({
          queueId: queueRow.id,
          eventKey: `${queueRow.event_key}:webhook:${nextStatus}`,
          notificationType: queueRow.event_type,
          recipientUserId: queueRow.recipient_user_id,
          recipientEmail: queueRow.recipient_email,
          recipientName: queueRow.recipient_name,
          recipientRole: queueRow.recipient_role,
          subject: queueRow.subject,
          relatedWoNumber: queueRow.related_wo_number,
          deliveryStatus: nextStatus,
          providerMessageId: emailId,
          errorMessage: errorMsg || undefined
        });
        return true;
      }
    }
  }

  const localStore = persistenceHooks?.getLocalStore();
  if (localStore?.emailNotificationQueue) {
    const localRow = localStore.emailNotificationQueue.find(q => q.providerMessageId === emailId);
    if (localRow) {
      localRow.status = nextStatus;
      localRow.errorMessage = errorMsg;
      if (persistenceHooks?.isLocalJsonAllowed()) {
        persistenceHooks.saveLocalStore();
      }
      await appendDeliveryLog({
        queueId: localRow.id,
        eventKey: `${localRow.eventKey}:webhook:${nextStatus}`,
        notificationType: localRow.eventType,
        recipientUserId: localRow.recipientUserId,
        recipientEmail: localRow.recipientEmail,
        recipientName: localRow.recipientName,
        recipientRole: localRow.recipientRole,
        subject: localRow.subject,
        relatedWoNumber: localRow.relatedWoNumber,
        deliveryStatus: nextStatus,
        providerMessageId: emailId,
        errorMessage: errorMsg || undefined
      });
      return true;
    }
  }

  return false;
}

// ============================================================================
// 5 AUTHORITATIVE EVENT TRIGGERS (NON-BLOCKING & SCOPED)
// ============================================================================

function computeTicketBucketsForSummary(tickets: any[], operationalDateWIB: string) {
  let newCount = 0;
  let activeCount = 0;
  let pendingCount = 0;
  let completedCount = 0;
  let assignedCount = 0;
  let unworkedCount = 0;
  let issueCount = 0;

  for (const t of tickets) {
    if (!t || t.isArchived || t.isDeleted) continue;
    const appDate = getStrictAppointmentDateServer(t);
    const closed = isTicketClosed(t);
    const assigned = isTicketAssigned(t);
    const checkedIn = isTicketCheckedIn(t);
    const repStatus = normalizeCanonicalReportStatus(t);
    const stInst = String(t.statusWOInstaller || '').trim().toUpperCase();
    const stAgent = String(t.statusWOAgent || '').trim().toUpperCase();

    if (closed) {
      if (appDate === operationalDateWIB) completedCount++;
      continue;
    }

    if (appDate && appDate > operationalDateWIB) {
      // Future WO doesn't count as overdue/today active unless assigned today
      continue;
    }

    activeCount++;
    if (assigned) assignedCount++;
    if (!assigned && appDate === operationalDateWIB) newCount++;
    if (assigned && !checkedIn) unworkedCount++;

    if (
      repStatus === 'PENDING' ||
      repStatus === 'RESCHEDULE' ||
      stInst === 'PENDING' ||
      stInst === 'RESCHEDULE' ||
      stAgent === 'PENDING'
    ) {
      pendingCount++;
    }

    if (
      repStatus === 'CANCEL' ||
      stInst === 'KENDALA' ||
      stInst === 'ISSUE' ||
      Boolean(t.kendalaReports?.length) ||
      String(t.approvalStatus || '').toUpperCase() === 'REVISION'
    ) {
      issueCount++;
    }
  }

  return {
    totalWo: activeCount + completedCount,
    newCount,
    activeCount,
    pendingCount,
    completedCount,
    assignedCount,
    unworkedCount,
    issueCount
  };
}

function ticketBelongsToLeader(ticket: any, leader: any): boolean {
  if (!ticket || !leader) return false;
  if (ticket.leaderId && leader.id && String(ticket.leaderId) === String(leader.id)) {
    return true;
  }
  const leaderContractor = String(leader.contractor || leader.contractorId || '').trim();
  const woContractor = String(ticket.contactorName || ticket.contractorName || ticket.contractorId || '').trim();
  if (!leaderContractor || !woContractor || !isContractorMatch(woContractor, leaderContractor)) {
    return false;
  }
  const leaderArea = String(leader.area || '').trim();
  const woArea = String(ticket.area || '').trim();
  if (leaderArea && woArea && !isAreaMatch(woArea, leaderArea)) {
    return false;
  }
  return true;
}

function ticketBelongsToInstaller(ticket: any, installer: any): boolean {
  if (!ticket || !installer) return false;
  const uid = String(installer.id || '').trim();
  if (
    uid &&
    (String(ticket.installerId || '') === uid ||
      String(ticket.installerUid || '') === uid ||
      String(ticket.assignedToUid || '') === uid)
  ) {
    return true;
  }
  const instName = String(installer.name || '').trim().toLowerCase();
  const woInstName = String(ticket.installerName || ticket.assignedTo || '').trim().toLowerCase();
  return Boolean(instName && woInstName && instName === woInstName);
}

/**
 * Trigger A: Daily Reset Notification
 * - Fires strictly ONLY when Daily Reset completed successfully.
 * - Max 1 summary per recipient per operational date (enforced via event_key).
 * - Leaders receive only WOs in their Contractor scope.
 * - Installers receive only WOs assigned to their account.
 */
export async function triggerDailyResetNotifications(params: {
  operationalDateWIB: string;
  resetCompleted: boolean;
}): Promise<{ queued: number; deduped: number; skipped: number }> {
  if (!params.resetCompleted) {
    return { queued: 0, deduped: 0, skipped: 0 };
  }
  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled || !cfg.rules.dailyReset.enabled) {
    return { queued: 0, deduped: 0, skipped: 0 };
  }
  if (!persistenceHooks) return { queued: 0, deduped: 0, skipped: 0 };

  const [users, tickets] = await Promise.all([
    persistenceHooks.getUsers(),
    persistenceHooks.getTickets()
  ]);

  const activeUsers = (users || []).filter(u => u && u.active !== false && !u.isDeleted);
  let queued = 0;
  let deduped = 0;
  let skipped = 0;

  for (const user of activeUsers) {
    if (user.role !== 'leader' && user.role !== 'installer') continue;

    const scopedTickets =
      user.role === 'leader'
        ? tickets.filter(t => ticketBelongsToLeader(t, user))
        : tickets.filter(t => ticketBelongsToInstaller(t, user));

    const stats = computeTicketBucketsForSummary(scopedTickets, params.operationalDateWIB);
    const tplKey: EmailTemplateKey =
      user.role === 'leader' ? 'daily_reset_leader' : 'daily_reset_installer';

    const res = await enqueueEmailItem({
      eventKey: `daily_reset:${params.operationalDateWIB}:${user.id}`,
      eventType: 'daily_reset',
      templateKey: tplKey,
      recipientUserId: user.id,
      recipientEmail: user.email,
      recipientName: user.name,
      recipientRole: user.role,
      context: {
        recipientName: user.name,
        recipientRole: user.role,
        contractorName: user.contractor || '',
        area: user.area || '',
        operationalDate: params.operationalDateWIB,
        newCount: stats.newCount,
        activeCount: stats.activeCount,
        pendingCount: stats.pendingCount,
        completedCount: stats.completedCount,
        morajawsUrl: resolveSafeHttpsBaseUrl()
      }
    });

    if (res.enqueued) queued++;
    else if (res.deduped) deduped++;
    else skipped++;
  }

  if (queued > 0) {
    void processEmailQueueBatch(20).catch(() => {});
  }
  return { queued, deduped, skipped };
}

/**
 * Trigger B: New WO Notification — Leader
 * - Fires ONLY when WO is successfully mapped/distributed to a valid Leader.
 * - Never fires for unmapped/exception/undistributed WOs.
 */
export async function triggerNewWoLeaderNotifications(params: {
  tickets: any[];
  users?: any[];
}): Promise<{ queued: number; deduped: number; skipped: number }> {
  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled || !cfg.rules.newWoLeader.enabled) {
    return { queued: 0, deduped: 0, skipped: 0 };
  }

  const users = params.users || (persistenceHooks ? await persistenceHooks.getUsers() : []);
  let queued = 0;
  let deduped = 0;
  let skipped = 0;

  for (const t of params.tickets || []) {
    if (!t || t.distributionStatus !== 'distributed' || !t.leaderId) {
      skipped++;
      continue;
    }
    const woNumber = String(t.woNumber || t.workOrderNumber || '').trim();
    if (!woNumber) {
      skipped++;
      continue;
    }
    const leaderUser = users.find(
      u => u && u.id === t.leaderId && u.role === 'leader' && u.active !== false && !u.isDeleted
    );
    if (!leaderUser) {
      skipped++;
      continue;
    }

    const res = await enqueueEmailItem({
      eventKey: `new_wo_leader:${woNumber}:${leaderUser.id}`,
      eventType: 'new_wo_leader',
      templateKey: 'new_wo_leader',
      recipientUserId: leaderUser.id,
      recipientEmail: leaderUser.email,
      recipientName: leaderUser.name,
      recipientRole: leaderUser.role,
      relatedTicketId: t.id || null,
      relatedWoNumber: woNumber,
      context: {
        recipientName: leaderUser.name,
        recipientRole: 'leader',
        woNumber,
        customerId: t.customerId || t.idCustomer || '',
        customerName: t.customerName || t.endUserName || '',
        area: t.area || '',
        contractorName: t.contractorName || t.contactorName || leaderUser.contractor || '',
        appointmentDate: getStrictAppointmentDateServer(t) || t.appointmentDate || '',
        appointmentSlot: t.slotTime || '',
        woStatus: t.statusWOAgent || t.statusWOInstaller || 'Pending',
        morajawsUrl: resolveSafeHttpsBaseUrl()
      }
    });

    if (res.enqueued) queued++;
    else if (res.deduped) deduped++;
    else skipped++;
  }

  if (queued > 0) {
    void processEmailQueueBatch(15).catch(() => {});
  }
  return { queued, deduped, skipped };
}

/**
 * Trigger C: WO Assignment Notification — Installer
 * - Fires ONLY to the Installer assigned to the WO.
 */
export async function triggerWoAssignedInstallerNotification(params: {
  ticket: any;
  installerUser?: any;
  installerName?: string;
  leaderName: string;
  assignmentEventId: string;
  users?: any[];
}): Promise<{ enqueued: boolean; deduped?: boolean; skipped?: boolean }> {
  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled || !cfg.rules.woAssignedInstaller.enabled) {
    return { enqueued: false, skipped: true };
  }

  const t = params.ticket;
  if (!t) return { enqueued: false, skipped: true };
  const users = params.users || (persistenceHooks ? await persistenceHooks.getUsers() : []);

  let installer = params.installerUser;
  if (!installer) {
    const targetId = String(t.installerId || t.installerUid || t.assignedToUid || '').trim();
    const targetName = String(params.installerName || t.installerName || '').trim().toLowerCase();
    installer = users.find(
      u =>
        u &&
        u.role === 'installer' &&
        u.active !== false &&
        !u.isDeleted &&
        ((targetId && u.id === targetId) || (targetName && String(u.name || '').trim().toLowerCase() === targetName))
    );
  }
  if (!installer) {
    return { enqueued: false, skipped: true };
  }

  const woNumber = String(t.woNumber || t.workOrderNumber || t.id || '').trim();
  const baseUrl = resolveSafeHttpsBaseUrl();
  const addressParts = [t.streetName || t.address, t.clusterName, t.city].filter(Boolean);

  const res = await enqueueEmailItem({
    eventKey: `wo_assigned:${t.id || woNumber}:${params.assignmentEventId}`,
    eventType: 'wo_assigned_installer',
    templateKey: 'wo_assigned_installer',
    recipientUserId: installer.id,
    recipientEmail: installer.email,
    recipientName: installer.name,
    recipientRole: 'installer',
    relatedTicketId: t.id || null,
    relatedWoNumber: woNumber,
    context: {
      recipientName: installer.name,
      recipientRole: 'installer',
      woNumber,
      customerId: t.customerId || t.idCustomer || '',
      customerName: t.customerName || t.endUserName || '',
      customerAddress: addressParts.join(', '),
      customerContact: t.customerPhone || t.customerContact1 || '',
      area: t.area || '',
      contractorName: t.contactorName || t.contractorName || installer.contractor || '',
      appointmentDate: getStrictAppointmentDateServer(t) || t.appointmentDate || '',
      appointmentSlot: t.slotTime || '',
      leaderName: params.leaderName,
      installerName: installer.name,
      woStatus: t.statusWOInstaller || 'Assigned',
      woDetailUrl: `${baseUrl}/?wo=${encodeURIComponent(woNumber)}`,
      morajawsUrl: baseUrl
    }
  });

  if (res.enqueued) {
    void processEmailQueueBatch(10).catch(() => {});
  }
  return res;
}

/**
 * Trigger D: WO Reassignment Notification
 * - Fires ONLY when the Installer actually changes.
 * - Sends notice to previous Installer & new Installer.
 */
export async function triggerWoReassignedNotifications(params: {
  ticket: any;
  previousInstallerId?: string | null;
  previousInstallerName?: string | null;
  newInstallerUser?: any;
  newInstallerName?: string;
  leaderName: string;
  reason?: string;
  changedAt?: string;
  reassignEventId: string;
  users?: any[];
}): Promise<{ prevEnqueued: boolean; newEnqueued: boolean; unchangedSkipped: boolean }> {
  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled || !cfg.rules.woReassigned.enabled) {
    return { prevEnqueued: false, newEnqueued: false, unchangedSkipped: false };
  }

  const t = params.ticket;
  if (!t) return { prevEnqueued: false, newEnqueued: false, unchangedSkipped: false };

  const users = params.users || (persistenceHooks ? await persistenceHooks.getUsers() : []);
  const newInstId = String(params.newInstallerUser?.id || t.installerId || t.installerUid || '').trim();
  const newInstName = String(params.newInstallerUser?.name || params.newInstallerName || t.installerName || '').trim();
  const prevInstId = String(params.previousInstallerId || '').trim();
  const prevInstName = String(params.previousInstallerName || '').trim();

  // Strict guard: never fire if installer did not actually change
  if (
    (prevInstId && newInstId && prevInstId === newInstId) ||
    (prevInstName && newInstName && prevInstName.toLowerCase() === newInstName.toLowerCase())
  ) {
    return { prevEnqueued: false, newEnqueued: false, unchangedSkipped: true };
  }

  const newInstaller =
    params.newInstallerUser ||
    users.find(
      u =>
        u &&
        u.role === 'installer' &&
        u.active !== false &&
        !u.isDeleted &&
        ((newInstId && u.id === newInstId) || (newInstName && String(u.name || '').trim().toLowerCase() === newInstName.toLowerCase()))
    );

  const prevInstaller =
    (prevInstId || prevInstName)
      ? users.find(
          u =>
            u &&
            u.role === 'installer' &&
            ((prevInstId && u.id === prevInstId) || (prevInstName && String(u.name || '').trim().toLowerCase() === prevInstName.toLowerCase()))
        )
      : null;

  const woNumber = String(t.woNumber || t.workOrderNumber || t.id || '').trim();
  const baseUrl = resolveSafeHttpsBaseUrl();
  const changedAt = params.changedAt || new Date().toISOString();
  const addressParts = [t.streetName || t.address, t.clusterName, t.city].filter(Boolean);

  let prevEnqueued = false;
  let newEnqueued = false;

  if (prevInstaller && (!newInstaller || prevInstaller.id !== newInstaller.id)) {
    const prevRes = await enqueueEmailItem({
      eventKey: `wo_reassigned_prev:${t.id || woNumber}:${params.reassignEventId}:${prevInstaller.id}`,
      eventType: 'wo_reassigned',
      templateKey: 'wo_reassigned_prev_installer',
      recipientUserId: prevInstaller.id,
      recipientEmail: prevInstaller.email,
      recipientName: prevInstaller.name,
      recipientRole: 'installer',
      relatedTicketId: t.id || null,
      relatedWoNumber: woNumber,
      context: {
        recipientName: prevInstaller.name,
        recipientRole: 'installer',
        woNumber,
        customerId: t.customerId || t.idCustomer || '',
        customerName: t.customerName || t.endUserName || '',
        area: t.area || '',
        contractorName: t.contactorName || t.contractorName || '',
        appointmentDate: getStrictAppointmentDateServer(t) || t.appointmentDate || '',
        appointmentSlot: t.slotTime || '',
        leaderName: params.leaderName,
        previousInstallerName: prevInstaller.name,
        newInstallerName: newInstaller?.name || newInstName,
        reassignmentReason: params.reason || '',
        changedAt,
        woStatus: t.statusWOInstaller || 'Assigned',
        morajawsUrl: baseUrl
      }
    });
    prevEnqueued = prevRes.enqueued;
  }

  if (newInstaller) {
    const newRes = await enqueueEmailItem({
      eventKey: `wo_reassigned_new:${t.id || woNumber}:${params.reassignEventId}:${newInstaller.id}`,
      eventType: 'wo_reassigned',
      templateKey: 'wo_reassigned_new_installer',
      recipientUserId: newInstaller.id,
      recipientEmail: newInstaller.email,
      recipientName: newInstaller.name,
      recipientRole: 'installer',
      relatedTicketId: t.id || null,
      relatedWoNumber: woNumber,
      context: {
        recipientName: newInstaller.name,
        recipientRole: 'installer',
        woNumber,
        customerId: t.customerId || t.idCustomer || '',
        customerName: t.customerName || t.endUserName || '',
        customerAddress: addressParts.join(', '),
        customerContact: t.customerPhone || t.customerContact1 || '',
        area: t.area || '',
        contractorName: t.contactorName || t.contractorName || '',
        appointmentDate: getStrictAppointmentDateServer(t) || t.appointmentDate || '',
        appointmentSlot: t.slotTime || '',
        leaderName: params.leaderName,
        previousInstallerName: prevInstaller?.name || prevInstName || 'Teknisi Sebelumnya',
        newInstallerName: newInstaller.name,
        reassignmentReason: params.reason || '',
        changedAt,
        woStatus: t.statusWOInstaller || 'Assigned',
        woDetailUrl: `${baseUrl}/?wo=${encodeURIComponent(woNumber)}`,
        morajawsUrl: baseUrl
      }
    });
    newEnqueued = newRes.enqueued;
  }

  if (prevEnqueued || newEnqueued) {
    void processEmailQueueBatch(10).catch(() => {});
  }

  return { prevEnqueued, newEnqueued, unchangedSkipped: false };
}

/**
 * Trigger E: Daily Summary Notification
 * - Calculates fresh metrics directly from persisted DB data.
 * - Sends global summary to Superadmin and Contractor-scoped summary to Leaders.
 */
export async function triggerDailySummaryNotifications(params: {
  operationalDateWIB: string;
  forceManualTag?: string;
}): Promise<{ queued: number; deduped: number; skipped: number }> {
  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled || !cfg.rules.dailySummary.enabled) {
    return { queued: 0, deduped: 0, skipped: 0 };
  }
  if (!persistenceHooks) return { queued: 0, deduped: 0, skipped: 0 };

  const [users, tickets] = await Promise.all([
    persistenceHooks.getUsers(),
    persistenceHooks.getTickets()
  ]);

  const activeRecipients = (users || []).filter(
    u => u && u.active !== false && !u.isDeleted && (u.role === 'super_admin' || u.role === 'leader')
  );

  let queued = 0;
  let deduped = 0;
  let skipped = 0;
  const suffix = params.forceManualTag ? `:manual:${params.forceManualTag}` : '';

  for (const user of activeRecipients) {
    const scopedTickets =
      user.role === 'leader' ? tickets.filter(t => ticketBelongsToLeader(t, user)) : tickets;

    const stats = computeTicketBucketsForSummary(scopedTickets, params.operationalDateWIB);
    const res = await enqueueEmailItem({
      eventKey: `daily_summary:${params.operationalDateWIB}:${user.id}${suffix}`,
      eventType: 'daily_summary',
      templateKey: 'daily_summary',
      recipientUserId: user.id,
      recipientEmail: user.email,
      recipientName: user.name,
      recipientRole: user.role,
      context: {
        recipientName: user.name,
        recipientRole: user.role,
        contractorName: user.role === 'leader' ? (user.contractor || 'Contractor Anda') : 'Seluruh Operasi MoraJaws',
        operationalDate: params.operationalDateWIB,
        totalWo: stats.totalWo,
        assignedCount: stats.assignedCount,
        completedCount: stats.completedCount,
        pendingCount: stats.pendingCount,
        unworkedCount: stats.unworkedCount,
        issueCount: stats.issueCount,
        morajawsUrl: resolveSafeHttpsBaseUrl()
      }
    });

    if (res.enqueued) queued++;
    else if (res.deduped) deduped++;
    else skipped++;
  }

  if (queued > 0) {
    void processEmailQueueBatch(20).catch(() => {});
  }
  return { queued, deduped, skipped };
}

// ============================================================================
// BACKGROUND SCHEDULER (WIB CRON TICK + RETRY QUEUE WORKER)
// ============================================================================

function getJakartaHHmmNow(): { dateWIB: string; hhmmWIB: string } {
  const now = new Date();
  try {
    const dateFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);
    return { dateWIB: dateFmt, hhmmWIB: timeFmt };
  } catch {
    const shifted = new Date(now.getTime() + 7 * 3600 * 1000);
    return {
      dateWIB: shifted.toISOString().slice(0, 10),
      hhmmWIB: shifted.toISOString().slice(11, 16)
    };
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startEmailNotificationScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    try {
      const cfg = await getEmailNotificationConfig();
      if (!cfg.enabled) return;

      // 1. Drain due queued / retry_pending items
      await processEmailQueueBatch(10);

      // 2. Check WIB schedule for Daily Summary & scheduled Daily Reset Notification window
      const { dateWIB, hhmmWIB } = getJakartaHHmmNow();
      if (
        cfg.rules.dailySummary.enabled &&
        hhmmWIB === cfg.rules.dailySummary.scheduleTime &&
        lastDailySummaryRunDateWIB !== dateWIB
      ) {
        lastDailySummaryRunDateWIB = dateWIB;
        await triggerDailySummaryNotifications({ operationalDateWIB: dateWIB });
      }

      if (
        cfg.rules.dailyReset.enabled &&
        hhmmWIB === cfg.rules.dailyReset.scheduleTime &&
        lastDailyResetTriggerDateWIB !== dateWIB
      ) {
        lastDailyResetTriggerDateWIB = dateWIB;
        // Daily reset idempotency guarantees at most 1 notification per recipient per operationalDateWIB
        const activeOpDate = persistenceHooks?.getOperationalDateWIB() || dateWIB;
        await triggerDailyResetNotifications({
          operationalDateWIB: activeOpDate,
          resetCompleted: activeOpDate === dateWIB
        });
      }
    } catch {
      // Never crash main Express server process from background scheduler
    }
  }, 45000);

  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref();
  }
}

export function resetEmailServiceCachesForTesting(): void {
  cachedConfig = null;
  cachedTemplates = null;
  dedicatedTablesMissing = false;
  lastDailySummaryRunDateWIB = null;
  lastDailyResetTriggerDateWIB = null;
  inProgressQueueIds.clear();
  sentEventKeysGuard.clear();
  if (cachedSmtpTransporter && typeof cachedSmtpTransporter.close === 'function') {
    try {
      cachedSmtpTransporter.close();
    } catch {
      // ignore
    }
  }
  cachedSmtpTransporter = null;
  cachedSmtpTransporterKey = null;
}
