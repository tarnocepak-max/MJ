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
  escapeHtml,
  formatIndonesianTimestampWIB,
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
  resolvedSenderEmail: string;
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

const EMAIL_CACHE_TTL_MS = 30_000;
let persistenceHooks: EmailServicePersistenceHooks | null = null;
let cachedConfig: EmailNotificationConfig | null = null;
let cachedConfigLoadedAt = 0;
let cachedTemplates: Record<EmailTemplateKey, EmailTemplateConfig> | null = null;
let cachedTemplatesLoadedAt = 0;
let dedicatedTablesMissing = false;
let isWorkerProcessing = false;
let workerDrainRequested = false;
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

function resolveSenderSelfEmail(cfg: EmailNotificationConfig): string {
  const smtp = resolveSmtpRuntimeConfig();
  const envFromEmail = smtp.envFrom.includes('<')
    ? (smtp.envFrom.match(/<([^>]+)>/)?.[1] || '').trim()
    : smtp.envFrom;
  if (isValidEmailAddress(envFromEmail) && !envFromEmail.toLowerCase().endsWith('.local')) {
    return envFromEmail;
  }
  const cfgSender = String(cfg.senderEmail || '').trim();
  if (isValidEmailAddress(cfgSender) && !cfgSender.toLowerCase().endsWith('.local')) {
    return cfgSender;
  }
  if (isValidEmailAddress(smtp.user)) {
    return smtp.user;
  }
  return '';
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
  const resolvedSenderEmail = resolveSenderSelfEmail(cfg);

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
    resolvedSenderEmail,
    ready: smtpUserConfigured && smtpPassConfigured,
    dedicatedTablesReady,
    statusMessage
  };
}

export async function getEmailNotificationConfig(): Promise<EmailNotificationConfig> {
  if (cachedConfig && Date.now() - cachedConfigLoadedAt < EMAIL_CACHE_TTL_MS) {
    return cachedConfig;
  }

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
        cachedConfigLoadedAt = Date.now();
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
        cachedConfigLoadedAt = Date.now();
        return cachedConfig;
      }
    }
  }

  const localStore = persistenceHooks?.getLocalStore();
  if (localStore?.emailNotificationConfig) {
    cachedConfig = normalizeEmailConfig(localStore.emailNotificationConfig);
    cachedConfigLoadedAt = Date.now();
    return cachedConfig;
  }
  if (localStore?.appSettings?.email_notification_settings) {
    cachedConfig = normalizeEmailConfig(localStore.appSettings.email_notification_settings);
    cachedConfigLoadedAt = Date.now();
    return cachedConfig;
  }

  const smtp = resolveSmtpRuntimeConfig();
  const smtpReady = (isValidEmailAddress(smtp.user) || smtp.user.length > 0) && smtp.pass.length >= 4;
  cachedConfig = normalizeEmailConfig({
    ...DEFAULT_CONFIG,
    enabled: smtpReady ? true : DEFAULT_CONFIG.enabled
  });
  cachedConfigLoadedAt = Date.now();
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
  cachedConfigLoadedAt = Date.now();
  await persistenceHooks?.writeAuditLog?.(
    'Email Notification Config Updated',
    'email_notification_settings',
    `Konfigurasi Email Notification diperbarui oleh ${merged.updatedBy} (enabled=${merged.enabled}, sender=${merged.senderEmail})`,
    actor
  );

  return merged;
}

export async function getEmailTemplates(): Promise<Record<EmailTemplateKey, EmailTemplateConfig>> {
  if (cachedTemplates && Date.now() - cachedTemplatesLoadedAt < EMAIL_CACHE_TTL_MS) {
    return cachedTemplates;
  }
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
        cachedTemplatesLoadedAt = Date.now();
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
          cachedTemplatesLoadedAt = Date.now();
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
    cachedTemplatesLoadedAt = Date.now();
    return cachedTemplates;
  }

  cachedTemplates = defaults;
  cachedTemplatesLoadedAt = Date.now();
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
  cachedTemplatesLoadedAt = Date.now();
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
  providerResponse?: string;
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
    const providerResponse = redactSmtpSecret(String(info?.response || '250 OK'), smtp.pass).slice(0, 300);
    return {
      ok: true,
      messageId: msgId,
      providerResponse,
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

export async function testSmtpProviderConnection(actor?: {
  id?: string;
  name?: string;
  role?: string;
}): Promise<{
  success: boolean;
  statusCode: number;
  message: string;
  recipientEmail?: string;
  providerMessageId?: string;
  errorCode?: string;
}> {
  const smtp = resolveSmtpRuntimeConfig();
  if (!smtp.user || !smtp.pass) {
    return {
      success: false,
      statusCode: 0,
      errorCode: 'SMTP_CREDENTIALS_MISSING',
      message: 'SMTP_USER dan SMTP_PASS belum terpasang di secrets environment server.'
    };
  }

  const cfg = await getEmailNotificationConfig();
  const senderSelfEmail = resolveSenderSelfEmail(cfg);
  if (!isValidEmailAddress(senderSelfEmail)) {
    return {
      success: false,
      statusCode: 0,
      errorCode: 'INVALID_SENDER_EMAIL',
      message: 'Alamat email pengirim (EMAIL_FROM / Sender Email / SMTP_USER) belum valid untuk menerima email uji koneksi.'
    };
  }

  try {
    const transporter = getOrCreateSmtpTransporter();
    await transporter.verify();
  } catch (err: any) {
    const classified = classifySmtpError(err, smtp.pass);
    return {
      success: false,
      statusCode: Number(err?.responseCode || 0),
      recipientEmail: senderSelfEmail,
      errorCode: classified.errorCode,
      message: `Gagal verifikasi Gmail SMTP (${smtp.host}:${smtp.port}): ${classified.errorMessage}`
    };
  }

  const fromHeader = formatFromHeader(cfg);
  const replyToHeader = resolveReplyToAddress(cfg);
  const encryptionMode = smtp.secure ? 'SSL/TLS' : 'STARTTLS';
  const nowIso = new Date().toISOString();
  const timestampWib = formatIndonesianTimestampWIB(nowIso);
  const actorLabel = sanitizeTemplateText(actor?.name || cfg.senderName || 'Superadmin') || 'Superadmin';
  const appBaseUrl = resolveSafeHttpsBaseUrl();
  const subject = `[MoraJaws] Test Connection Gmail SMTP Berhasil — ${timestampWib}`;

  const html = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0e071c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#f3e8ff;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0e071c;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#190e30;border:1px solid #3c1f6e;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:20px 24px;background:linear-gradient(135deg,#35105e 0%,#58149c 100%);border-bottom:1px solid #4c2387;">
              <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#d8b4fe;">MoraJaws Email Notification Center</div>
              <div style="font-size:18px;font-weight:800;color:#ffffff;margin-top:4px;">Verifikasi Koneksi Gmail SMTP Berhasil</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px;font-size:13px;line-height:1.6;color:#e9d5ff;">
              <p style="margin:0 0 12px 0;">Halo <strong>${escapeHtml(actorLabel)}</strong>,</p>
              <p style="margin:0 0 16px 0;">Email ini dikirim otomatis oleh fitur <strong>Test Connection</strong> ke alamat email pengirim sendiri untuk memastikan konfigurasi Gmail SMTP MoraJaws terhubung, terautentikasi, dan siap mengirim notifikasi operasional.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#120924;border:1px solid #35105e;border-radius:12px;">
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #2b134d;color:#c4b5fd;font-size:12px;width:40%;">SMTP Host &amp; Port</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #2b134d;color:#ffffff;font-size:12px;font-weight:700;">${escapeHtml(`${smtp.host}:${smtp.port}`)}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #2b134d;color:#c4b5fd;font-size:12px;">Enkripsi</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #2b134d;color:#6ee7b7;font-size:12px;font-weight:700;">${escapeHtml(encryptionMode)}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #2b134d;color:#c4b5fd;font-size:12px;">Pengirim &amp; Tujuan Tes</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #2b134d;color:#ffffff;font-size:12px;font-weight:700;">${escapeHtml(senderSelfEmail)}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;color:#c4b5fd;font-size:12px;">Waktu Pengujian (WIB)</td>
                  <td style="padding:10px 14px;color:#ffffff;font-size:12px;font-weight:700;">${escapeHtml(timestampWib)}</td>
                </tr>
              </table>
              <div style="margin-top:20px;text-align:center;">
                <a href="${escapeHtml(appBaseUrl)}" style="display:inline-block;padding:10px 20px;background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:12px;border-radius:10px;">Buka MoraJaws</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;background-color:#120924;border-top:1px solid #2b134d;font-size:11px;color:#a78bfa;text-align:center;">
              MoraJaws Operations &amp; Dispatch System · Automated SMTP Verification
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    'MoraJaws — Verifikasi Koneksi Gmail SMTP (Test Connection)',
    '',
    `Halo ${actorLabel},`,
    'Email percobaan ini dikirim ke alamat email pengirim sendiri untuk memverifikasi konfigurasi Gmail SMTP MoraJaws.',
    '',
    `SMTP Host & Port : ${smtp.host}:${smtp.port}`,
    `Enkripsi         : ${encryptionMode}`,
    `Alamat Tujuan    : ${senderSelfEmail}`,
    `Waktu (WIB)      : ${timestampWib}`,
    `Portal MoraJaws  : ${appBaseUrl}`
  ].join('\n');

  const eventKey = `test_connection:${Date.now()}`;
  const sendRes = await sendViaGmailSmtp({
    from: fromHeader,
    to: senderSelfEmail,
    replyTo: replyToHeader,
    subject,
    html,
    text,
    idempotencyKey: eventKey
  });

  await appendDeliveryLog({
    eventKey,
    notificationType: 'test_email',
    recipientUserId: actor?.id || null,
    recipientEmail: senderSelfEmail,
    recipientName: actorLabel,
    recipientRole: actor?.role || 'super_admin',
    subject,
    deliveryStatus: sendRes.ok ? 'sent' : 'failed',
    providerMessageId: sendRes.messageId,
    errorMessage: sendRes.errorMessage,
    metadata: {
      kind: 'test_connection_self_email',
      smtpHost: smtp.host,
      smtpPort: smtp.port,
      encryption: encryptionMode
    }
  });

  await persistenceHooks?.writeAuditLog?.(
    'SMTP Test Connection Executed',
    'email_notification_settings',
    sendRes.ok
      ? `Test Connection Gmail SMTP berhasil & email verifikasi terkirim ke ${senderSelfEmail} (Message ID: ${sendRes.messageId})`
      : `Test Connection Gmail SMTP ke ${senderSelfEmail} gagal: ${sendRes.errorMessage || 'Unknown error'}`,
    actor
  );

  if (!sendRes.ok) {
    return {
      success: false,
      statusCode: sendRes.httpStatus,
      recipientEmail: senderSelfEmail,
      errorCode: sendRes.errorCode || 'SMTP_TEST_SEND_FAILED',
      message: `Handshake SMTP (${smtp.host}:${smtp.port}) berhasil, namun pengiriman email percobaan ke ${senderSelfEmail} gagal: ${sendRes.errorMessage || 'Error tidak diketahui.'}`
    };
  }

  return {
    success: true,
    statusCode: 250,
    recipientEmail: senderSelfEmail,
    providerMessageId: sendRes.messageId,
    message: `Koneksi Gmail SMTP (${smtp.host}:${smtp.port}, ${encryptionMode}) terverifikasi & email percobaan berhasil dikirim ke ${senderSelfEmail} (Message ID: ${sendRes.messageId}).`
  };
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
  metadata?: Record<string, any>;
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
  const baseMetadata: Record<string, any> = {
    area: params.context.area || null,
    contractorName: params.context.contractorName || null,
    operationalDate: params.context.operationalDate || null,
    woNumber: params.relatedWoNumber || null,
    ...(params.metadata || {})
  };

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
    payload: baseMetadata,
    status: validEmail ? 'queued' : 'skipped',
    retryCount: 0,
    maxRetries: 3,
    nextRetryAt: validEmail ? nowIso : null,
    errorMessage: validEmail ? null : 'Email penerima kosong atau format email tidak valid.',
    createdAt: nowIso
  };

  const logMetadata = {
    ...baseMetadata,
    createdAt: item.createdAt,
    processedAt: validEmail ? null : nowIso,
    errorDetails: item.errorMessage || null
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
          errorMessage: item.errorMessage || undefined,
          metadata: logMetadata
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
    errorMessage: item.errorMessage || undefined,
    metadata: logMetadata
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
    // Signal active worker to drain newly enqueued items before releasing the lock
    workerDrainRequested = true;
    return { processed: 0, sent: 0, retryScheduled: 0, failed: 0, skipped: 0 };
  }
  isWorkerProcessing = true;
  const summary = { processed: 0, sent: 0, retryScheduled: 0, failed: 0, skipped: 0 };

  try {
    let drainLoop = 0;
    do {
      workerDrainRequested = false;
      drainLoop++;
      const cfg = await getEmailNotificationConfig();
      if (!cfg.enabled) break;

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

      if (dueItems.length === 0) {
        break;
      }

      const fromHeader = formatFromHeader(cfg);
      const replyToHeader = resolveReplyToAddress(cfg);

      for (const item of dueItems) {
        if (inProgressQueueIds.has(item.id)) {
          continue;
        }

        const baseLogMeta: Record<string, any> = {
          ...(item.payload || {}),
          eventId: item.payload?.eventId || item.eventKey,
          woNumber: item.relatedWoNumber || item.payload?.woNumber || null,
          createdAt: item.createdAt
        };

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
            errorMessage: item.errorMessage,
            metadata: {
              ...baseLogMeta,
              processedAt: item.processedAt,
              errorDetails: item.errorMessage
            }
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
              providerMessageId: item.providerMessageId || undefined,
              metadata: {
                ...baseLogMeta,
                processedAt: item.processedAt,
                sentAt: item.sentAt,
                providerResponse: sendRes.providerResponse || item.providerMessageId || '250 OK',
                errorDetails: null
              }
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
              errorMessage: item.errorMessage || undefined,
              metadata: {
                ...baseLogMeta,
                processedAt: item.processedAt,
                retryCount: item.retryCount,
                maxRetries: item.maxRetries,
                nextRetryAt: item.nextRetryAt,
                providerResponse: sendRes.errorCode || null,
                errorDetails: item.errorMessage
              }
            });
          }
        } finally {
          inProgressQueueIds.delete(item.id);
        }
      }
    } while (workerDrainRequested && drainLoop < 5);
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

function isUnassignedInstallerValue(val?: string | null): boolean {
  const clean = String(val || '').trim().toLowerCase();
  return (
    !clean ||
    clean === '-' ||
    clean === 'unassigned' ||
    clean === 'belum ditugaskan' ||
    clean === 'none' ||
    clean === 'null' ||
    clean === 'undefined' ||
    clean === 'teknisi sebelumnya'
  );
}

function resolveInstallerUserAccount(
  users: any[],
  opts: { id?: string | null; name?: string | null; allowInactive?: boolean }
): any | null {
  const targetId = String(opts.id || '').trim();
  const targetName = isUnassignedInstallerValue(opts.name) ? '' : String(opts.name || '').trim().toLowerCase();
  if (!targetId && !targetName) return null;

  const candidates = (users || []).filter(
    u =>
      u &&
      u.role === 'installer' &&
      !u.isDeleted &&
      (opts.allowInactive ? true : u.active !== false)
  );

  if (targetId) {
    const byId = candidates.find(u => String(u.id || '').trim() === targetId);
    if (byId) return byId;
  }
  if (targetName) {
    const byUsername = candidates.find(u => String(u.username || '').trim().toLowerCase() === targetName);
    if (byUsername) return byUsername;
    const byName = candidates.find(u => String(u.name || '').trim().toLowerCase() === targetName);
    if (byName) return byName;
  }
  return null;
}

function resolveInstallerRecipientEmail(user?: any): string {
  if (!user) return '';
  const primary = String(user.email || '').trim();
  if (isValidEmailAddress(primary)) return primary;
  const alt = String(user.altEmail || '').trim();
  if (isValidEmailAddress(alt)) return alt;
  return primary || alt;
}

/**
 * Trigger C: WO Assignment Notification — Installer
 * - Fires ONLY to the Installer assigned to the WO.
 * - Logs skipped status if disabled or if installer user/email is missing.
 */
export async function triggerWoAssignedInstallerNotification(params: {
  ticket: any;
  installerUser?: any;
  installerName?: string;
  installerId?: string | null;
  leaderName: string;
  assignmentEventId: string;
  users?: any[];
}): Promise<{ enqueued: boolean; deduped?: boolean; skipped?: boolean; queueId?: string }> {
  const t = params.ticket;
  if (!t) return { enqueued: false, skipped: true };

  const woNumber = String(t.woNumber || t.workOrderNumber || t.id || '').trim();
  const targetId = String(params.installerUser?.id || params.installerId || t.installerId || t.installerUid || t.assignedToUid || '').trim();
  const targetName = String(params.installerUser?.name || params.installerName || t.installerName || t.assignedTo || '').trim();
  const eventKey = `wo_assigned:${t.id || woNumber}:${params.assignmentEventId}`;

  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled || !cfg.rules.woAssignedInstaller.enabled) {
    const reason = !cfg.enabled
      ? 'Master Email System nonaktif pada Email Notification Center.'
      : 'Rule notifikasi WO Assigned ke Installer dinonaktifkan.';
    await appendDeliveryLog({
      eventKey,
      notificationType: 'wo_assigned_installer',
      recipientUserId: targetId || null,
      recipientEmail: params.installerUser?.email || t.installerEmail || null,
      recipientName: targetName || null,
      recipientRole: 'installer',
      subject: `[MoraJaws] Tugas WO Baru: ${woNumber}`,
      relatedWoNumber: woNumber,
      deliveryStatus: 'skipped',
      errorMessage: reason,
      metadata: {
        eventId: params.assignmentEventId,
        eventTypeLabel: 'WO_ASSIGNED',
        woNumber,
        previousInstaller: null,
        newInstaller: targetName || null,
        leaderName: params.leaderName,
        processedAt: new Date().toISOString(),
        errorDetails: reason
      }
    });
    return { enqueued: false, skipped: true };
  }

  const users = params.users || (persistenceHooks ? await persistenceHooks.getUsers() : []);
  const installer =
    params.installerUser ||
    resolveInstallerUserAccount(users, { id: targetId, name: targetName });

  if (!installer) {
    const reason = `Akun Installer "${targetName || targetId || '-'}" tidak ditemukan atau tidak aktif di direktori pengguna.`;
    await appendDeliveryLog({
      eventKey,
      notificationType: 'wo_assigned_installer',
      recipientUserId: targetId || null,
      recipientEmail: null,
      recipientName: targetName || null,
      recipientRole: 'installer',
      subject: `[MoraJaws] Tugas WO Baru: ${woNumber}`,
      relatedWoNumber: woNumber,
      deliveryStatus: 'skipped',
      errorMessage: reason,
      metadata: {
        eventId: params.assignmentEventId,
        eventTypeLabel: 'WO_ASSIGNED',
        woNumber,
        previousInstaller: null,
        newInstaller: targetName || null,
        leaderName: params.leaderName,
        processedAt: new Date().toISOString(),
        errorDetails: reason
      }
    });
    return { enqueued: false, skipped: true };
  }

  const baseUrl = resolveSafeHttpsBaseUrl();
  const addressParts = [t.streetName || t.address, t.clusterName, t.city].filter(Boolean);
  const recipientEmail = resolveInstallerRecipientEmail(installer);

  const res = await enqueueEmailItem({
    eventKey,
    eventType: 'wo_assigned_installer',
    templateKey: 'wo_assigned_installer',
    recipientUserId: installer.id,
    recipientEmail,
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
    },
    metadata: {
      eventId: params.assignmentEventId,
      eventTypeLabel: 'WO_ASSIGNED',
      previousInstaller: null,
      newInstaller: installer.name,
      leaderName: params.leaderName
    }
  });

  if (res.enqueued) {
    void processEmailQueueBatch(10).catch(() => {});
  }
  return res;
}

/**
 * Trigger D: WO Reassignment Notification
 * - If previously unassigned, delegates automatically to triggerWoAssignedInstallerNotification (WO_ASSIGNED).
 * - Fires ONLY when the Installer actually changes.
 * - Sends notice to previous Installer & new Installer.
 */
export async function triggerWoReassignedNotifications(params: {
  ticket: any;
  previousInstallerId?: string | null;
  previousInstallerName?: string | null;
  newInstallerUser?: any;
  newInstallerId?: string | null;
  newInstallerName?: string | null;
  leaderName: string;
  reason?: string;
  changedAt?: string;
  reassignEventId: string;
  users?: any[];
}): Promise<{
  prevEnqueued: boolean;
  newEnqueued: boolean;
  unchangedSkipped: boolean;
  treatedAsNewAssignment?: boolean;
}> {
  const t = params.ticket;
  if (!t) return { prevEnqueued: false, newEnqueued: false, unchangedSkipped: false };

  const users = params.users || (persistenceHooks ? await persistenceHooks.getUsers() : []);
  const newInstId = String(params.newInstallerUser?.id || params.newInstallerId || t.installerId || t.installerUid || t.assignedToUid || '').trim();
  const rawNewName = String(params.newInstallerUser?.name || params.newInstallerName || t.installerName || t.assignedTo || '').trim();
  const newInstName = isUnassignedInstallerValue(rawNewName) ? '' : rawNewName;

  const prevInstId = String(params.previousInstallerId || '').trim();
  const rawPrevName = String(params.previousInstallerName || '').trim();
  const prevInstName = isUnassignedInstallerValue(rawPrevName) ? '' : rawPrevName;

  // Strict guard: never fire if installer did not actually change
  if (
    (prevInstId && newInstId && prevInstId === newInstId) ||
    (prevInstName && newInstName && prevInstName.toLowerCase() === newInstName.toLowerCase())
  ) {
    return { prevEnqueued: false, newEnqueued: false, unchangedSkipped: true };
  }

  // Requirement 3: If WO previously had NO Installer, treat as NEW ASSIGNMENT, not REASSIGNMENT
  if (!prevInstId && !prevInstName) {
    const assignRes = await triggerWoAssignedInstallerNotification({
      ticket: t,
      installerUser: params.newInstallerUser,
      installerId: newInstId || null,
      installerName: newInstName || undefined,
      leaderName: params.leaderName,
      assignmentEventId: params.reassignEventId,
      users
    });
    return {
      prevEnqueued: false,
      newEnqueued: assignRes.enqueued,
      unchangedSkipped: false,
      treatedAsNewAssignment: true
    };
  }

  const woNumber = String(t.woNumber || t.workOrderNumber || t.id || '').trim();
  const changedAt = params.changedAt || new Date().toISOString();
  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled || !cfg.rules.woReassigned.enabled) {
    const skipReason = !cfg.enabled
      ? 'Master Email System nonaktif pada Email Notification Center.'
      : 'Rule notifikasi WO Reassigned dinonaktifkan.';
    await appendDeliveryLog({
      eventKey: `wo_reassigned:${t.id || woNumber}:${params.reassignEventId}`,
      notificationType: 'wo_reassigned',
      recipientUserId: newInstId || null,
      recipientEmail: params.newInstallerUser?.email || null,
      recipientName: newInstName || null,
      recipientRole: 'installer',
      subject: `[MoraJaws] Pengalihan WO: ${woNumber}`,
      relatedWoNumber: woNumber,
      deliveryStatus: 'skipped',
      errorMessage: skipReason,
      metadata: {
        eventId: params.reassignEventId,
        eventTypeLabel: 'WO_REASSIGNED',
        woNumber,
        previousInstaller: prevInstName || prevInstId || null,
        newInstaller: newInstName || newInstId || null,
        leaderName: params.leaderName,
        processedAt: changedAt,
        errorDetails: skipReason
      }
    });
    return { prevEnqueued: false, newEnqueued: false, unchangedSkipped: false };
  }

  const newInstaller =
    params.newInstallerUser ||
    resolveInstallerUserAccount(users, { id: newInstId, name: newInstName });

  const prevInstaller = resolveInstallerUserAccount(users, {
    id: prevInstId,
    name: prevInstName,
    allowInactive: true
  });

  // Also check ID equality after resolving accounts (e.g., name alias mapped to same user id)
  if (prevInstaller && newInstaller && prevInstaller.id === newInstaller.id) {
    return { prevEnqueued: false, newEnqueued: false, unchangedSkipped: true };
  }

  const baseUrl = resolveSafeHttpsBaseUrl();
  const addressParts = [t.streetName || t.address, t.clusterName, t.city].filter(Boolean);
  const resolvedPrevDisplay = prevInstaller?.name || prevInstName || prevInstId || 'Teknisi Sebelumnya';
  const resolvedNewDisplay = newInstaller?.name || newInstName || newInstId || 'Teknisi Baru';

  let prevEnqueued = false;
  let newEnqueued = false;

  if (prevInstaller) {
    const prevRes = await enqueueEmailItem({
      eventKey: `wo_reassigned_prev:${t.id || woNumber}:${params.reassignEventId}:${prevInstaller.id}`,
      eventType: 'wo_reassigned',
      templateKey: 'wo_reassigned_prev_installer',
      recipientUserId: prevInstaller.id,
      recipientEmail: resolveInstallerRecipientEmail(prevInstaller),
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
        newInstallerName: resolvedNewDisplay,
        reassignmentReason: params.reason || '',
        changedAt,
        woStatus: t.statusWOInstaller || 'Assigned',
        morajawsUrl: baseUrl
      },
      metadata: {
        eventId: params.reassignEventId,
        eventTypeLabel: 'WO_REASSIGNED',
        previousInstaller: prevInstaller.name,
        newInstaller: resolvedNewDisplay,
        leaderName: params.leaderName,
        changedAt
      }
    });
    prevEnqueued = prevRes.enqueued;
  } else if (prevInstId || prevInstName) {
    const reason = `Akun Installer sebelumnya "${resolvedPrevDisplay}" tidak ditemukan di direktori pengguna.`;
    await appendDeliveryLog({
      eventKey: `wo_reassigned_prev:${t.id || woNumber}:${params.reassignEventId}:missing`,
      notificationType: 'wo_reassigned',
      recipientUserId: prevInstId || null,
      recipientEmail: null,
      recipientName: resolvedPrevDisplay,
      recipientRole: 'installer',
      subject: `[MoraJaws] Pengalihan Tugas: WO ${woNumber}`,
      relatedWoNumber: woNumber,
      deliveryStatus: 'skipped',
      errorMessage: reason,
      metadata: {
        eventId: params.reassignEventId,
        eventTypeLabel: 'WO_REASSIGNED',
        woNumber,
        previousInstaller: resolvedPrevDisplay,
        newInstaller: resolvedNewDisplay,
        leaderName: params.leaderName,
        processedAt: new Date().toISOString(),
        errorDetails: reason
      }
    });
  }

  if (newInstaller) {
    const newRes = await enqueueEmailItem({
      eventKey: `wo_reassigned_new:${t.id || woNumber}:${params.reassignEventId}:${newInstaller.id}`,
      eventType: 'wo_reassigned',
      templateKey: 'wo_reassigned_new_installer',
      recipientUserId: newInstaller.id,
      recipientEmail: resolveInstallerRecipientEmail(newInstaller),
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
        previousInstallerName: resolvedPrevDisplay,
        newInstallerName: newInstaller.name,
        reassignmentReason: params.reason || '',
        changedAt,
        woStatus: t.statusWOInstaller || 'Assigned',
        woDetailUrl: `${baseUrl}/?wo=${encodeURIComponent(woNumber)}`,
        morajawsUrl: baseUrl
      },
      metadata: {
        eventId: params.reassignEventId,
        eventTypeLabel: 'WO_REASSIGNED',
        previousInstaller: resolvedPrevDisplay,
        newInstaller: newInstaller.name,
        leaderName: params.leaderName,
        changedAt
      }
    });
    newEnqueued = newRes.enqueued;
  } else {
    const reason = `Akun Installer baru "${resolvedNewDisplay}" tidak ditemukan atau tidak aktif di direktori pengguna.`;
    await appendDeliveryLog({
      eventKey: `wo_reassigned_new:${t.id || woNumber}:${params.reassignEventId}:missing`,
      notificationType: 'wo_reassigned',
      recipientUserId: newInstId || null,
      recipientEmail: null,
      recipientName: resolvedNewDisplay,
      recipientRole: 'installer',
      subject: `[MoraJaws] Pengalihan WO Masuk: ${woNumber}`,
      relatedWoNumber: woNumber,
      deliveryStatus: 'skipped',
      errorMessage: reason,
      metadata: {
        eventId: params.reassignEventId,
        eventTypeLabel: 'WO_REASSIGNED',
        woNumber,
        previousInstaller: resolvedPrevDisplay,
        newInstaller: resolvedNewDisplay,
        leaderName: params.leaderName,
        processedAt: new Date().toISOString(),
        errorDetails: reason
      }
    });
  }

  if (prevEnqueued || newEnqueued) {
    void processEmailQueueBatch(10).catch(() => {});
  }

  return { prevEnqueued, newEnqueued, unchangedSkipped: false };
}

/**
 * Authoritative Post-Commit Outbox Dispatcher for ALL WO Assignment & Reassignment routes.
 * Compares committed DB state (previousTicket vs updated ticket):
 * - Unchanged Installer -> skipped (0 emails)
 * - Unassigned -> Installer -> WO_ASSIGNED (1 email to Installer)
 * - Installer A -> Installer B -> WO_REASSIGNED (2 emails: Installer A + Installer B)
 */
export async function dispatchWoAssignmentChangeNotification(params: {
  ticket: any;
  previousTicket?: any;
  previousInstallerId?: string | null;
  previousInstallerName?: string | null;
  newInstallerUser?: any;
  newInstallerId?: string | null;
  newInstallerName?: string | null;
  leaderName: string;
  reason?: string;
  changedAt?: string;
  eventId: string;
  users?: any[];
}): Promise<{
  mode: 'assigned' | 'reassigned' | 'unchanged_skipped' | 'invalid_input_skipped';
  prevEnqueued: boolean;
  newEnqueued: boolean;
  unchangedSkipped: boolean;
  deduped?: boolean;
  skipped?: boolean;
}> {
  const t = params.ticket;
  if (!t) {
    return { mode: 'invalid_input_skipped', prevEnqueued: false, newEnqueued: false, unchangedSkipped: false, skipped: true };
  }

  const prevTicket = params.previousTicket;
  const rawPrevId = params.previousInstallerId ?? prevTicket?.installerId ?? prevTicket?.installerUid ?? prevTicket?.assignedToUid ?? '';
  const rawPrevName = params.previousInstallerName ?? prevTicket?.installerName ?? prevTicket?.assignedTo ?? '';
  const prevInstId = String(rawPrevId || '').trim();
  const prevInstName = isUnassignedInstallerValue(rawPrevName) ? '' : String(rawPrevName || '').trim();

  const rawNewId = params.newInstallerUser?.id ?? params.newInstallerId ?? t.installerId ?? t.installerUid ?? t.assignedToUid ?? '';
  const rawNewName = params.newInstallerUser?.name ?? params.newInstallerName ?? t.installerName ?? t.assignedTo ?? '';
  const newInstId = String(rawNewId || '').trim();
  const newInstName = isUnassignedInstallerValue(rawNewName) ? '' : String(rawNewName || '').trim();

  if (!newInstId && !newInstName) {
    return { mode: 'invalid_input_skipped', prevEnqueued: false, newEnqueued: false, unchangedSkipped: false, skipped: true };
  }

  // Never send notification if assignment target did not change
  if (
    (prevInstId && newInstId && prevInstId === newInstId) ||
    (prevInstName && newInstName && prevInstName.toLowerCase() === newInstName.toLowerCase())
  ) {
    return { mode: 'unchanged_skipped', prevEnqueued: false, newEnqueued: false, unchangedSkipped: true };
  }

  const hasPreviousInstaller = Boolean(prevInstId || prevInstName);
  if (!hasPreviousInstaller) {
    const res = await triggerWoAssignedInstallerNotification({
      ticket: t,
      installerUser: params.newInstallerUser,
      installerId: newInstId || null,
      installerName: newInstName || undefined,
      leaderName: params.leaderName,
      assignmentEventId: params.eventId,
      users: params.users
    });
    return {
      mode: 'assigned',
      prevEnqueued: false,
      newEnqueued: res.enqueued,
      unchangedSkipped: false,
      deduped: res.deduped,
      skipped: res.skipped
    };
  }

  const reassignRes = await triggerWoReassignedNotifications({
    ticket: t,
    previousInstallerId: prevInstId || null,
    previousInstallerName: prevInstName || null,
    newInstallerUser: params.newInstallerUser,
    newInstallerId: newInstId || null,
    newInstallerName: newInstName || null,
    leaderName: params.leaderName,
    reason: params.reason,
    changedAt: params.changedAt,
    reassignEventId: params.eventId,
    users: params.users
  });

  if (reassignRes.unchangedSkipped) {
    return { mode: 'unchanged_skipped', prevEnqueued: false, newEnqueued: false, unchangedSkipped: true };
  }

  return {
    mode: reassignRes.treatedAsNewAssignment ? 'assigned' : 'reassigned',
    prevEnqueued: reassignRes.prevEnqueued,
    newEnqueued: reassignRes.newEnqueued,
    unchangedSkipped: false
  };
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

export async function runScheduledEmailTick(options?: {
  forceDailyResetWindow?: boolean;
  forceDailySummaryWindow?: boolean;
}): Promise<{
  enabled: boolean;
  queueResult?: Awaited<ReturnType<typeof processEmailQueueBatch>>;
  dailyResetTriggered?: boolean;
  dailySummaryTriggered?: boolean;
  dateWIB: string;
  hhmmWIB: string;
}> {
  const { dateWIB, hhmmWIB } = getJakartaHHmmNow();
  const cfg = await getEmailNotificationConfig();
  if (!cfg.enabled) {
    return { enabled: false, dateWIB, hhmmWIB };
  }

  // 1. Drain due queued / retry_pending items
  const queueResult = await processEmailQueueBatch(25);
  let dailySummaryTriggered = false;
  let dailyResetTriggered = false;

  // 2. Check WIB schedule for Daily Summary & scheduled Daily Reset Notification window
  if (
    cfg.rules.dailySummary.enabled &&
    (options?.forceDailySummaryWindow || hhmmWIB === cfg.rules.dailySummary.scheduleTime) &&
    lastDailySummaryRunDateWIB !== dateWIB
  ) {
    lastDailySummaryRunDateWIB = dateWIB;
    dailySummaryTriggered = true;
    await triggerDailySummaryNotifications({ operationalDateWIB: dateWIB });
  }

  if (
    cfg.rules.dailyReset.enabled &&
    (options?.forceDailyResetWindow || hhmmWIB === cfg.rules.dailyReset.scheduleTime) &&
    lastDailyResetTriggerDateWIB !== dateWIB
  ) {
    lastDailyResetTriggerDateWIB = dateWIB;
    dailyResetTriggered = true;
    // Daily reset idempotency guarantees at most 1 notification per recipient per operationalDateWIB
    const activeOpDate = persistenceHooks?.getOperationalDateWIB() || dateWIB;
    await triggerDailyResetNotifications({
      operationalDateWIB: activeOpDate,
      resetCompleted: activeOpDate === dateWIB
    });
  }

  return {
    enabled: true,
    queueResult,
    dailyResetTriggered,
    dailySummaryTriggered,
    dateWIB,
    hhmmWIB
  };
}

export function startEmailNotificationScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    try {
      await runScheduledEmailTick();
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
  cachedConfigLoadedAt = 0;
  cachedTemplates = null;
  cachedTemplatesLoadedAt = 0;
  dedicatedTablesMissing = false;
  workerDrainRequested = false;
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
