import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  Send,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  Sliders,
  FileCode2,
  History,
  Clock,
  Eye,
  Monitor,
  Smartphone,
  Save,
  Loader2,
  Search,
  Play,
  Zap,
  Database,
  Lock,
  Calendar,
  XCircle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { getAuthHeaders } from '../../services/authService';

type EmailSubTab = 'general' | 'rules' | 'templates' | 'logs';

interface EmailNotificationRules {
  dailyReset: { enabled: boolean; scheduleTime: string };
  newWoLeader: { enabled: boolean };
  woAssignedInstaller: { enabled: boolean };
  woReassigned: { enabled: boolean };
  dailySummary: { enabled: boolean; scheduleTime: string };
}

interface EmailNotificationConfig {
  enabled: boolean;
  senderName: string;
  senderEmail: string;
  replyToEmail: string;
  timezone: string;
  rules: EmailNotificationRules;
  updatedBy?: string;
  updatedAt?: string;
}

interface EmailProviderHealth {
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
  resolvedSenderEmail?: string;
  ready: boolean;
  dedicatedTablesReady: boolean;
  statusMessage: string;
}

interface EmailTemplateItem {
  templateKey: string;
  eventType: string;
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

interface PlaceholderToken {
  token: string;
  label: string;
  example: string;
}

interface EmailDeliveryLogItem {
  id: string;
  queueId?: string | null;
  eventKey?: string | null;
  notificationType: string;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  recipientRole?: string | null;
  subject: string;
  relatedWoNumber?: string | null;
  deliveryStatus: string;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

const DEFAULT_RULES: EmailNotificationRules = {
  dailyReset: { enabled: true, scheduleTime: '00:05' },
  newWoLeader: { enabled: true },
  woAssignedInstaller: { enabled: true },
  woReassigned: { enabled: true },
  dailySummary: { enabled: true, scheduleTime: '18:00' }
};

function statusBadgeMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case 'delivered':
      return {
        label: 'Delivered',
        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700/60'
      };
    case 'sent':
      return {
        label: 'Sent',
        cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-700/60'
      };
    case 'queued':
      return {
        label: 'Queued',
        cls: 'bg-[#EAE8FF] text-[#5145A6] border-[#C5BEEF] dark:bg-[#2E1459] dark:text-[#DAB9FF] dark:border-[#5B35B1]'
      };
    case 'processing':
      return {
        label: 'Processing',
        cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-700/60'
      };
    case 'retry_pending':
      return {
        label: 'Retry Pending',
        cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700/60'
      };
    case 'skipped':
      return {
        label: 'Skipped',
        cls: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700'
      };
    case 'failed':
    default:
      return {
        label: 'Failed',
        cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
      };
  }
}

function eventTypeLabel(type: string): string {
  switch (type) {
    case 'daily_reset':
      return 'Daily Reset';
    case 'new_wo_leader':
      return 'New WO Leader';
    case 'wo_assigned_installer':
      return 'WO Assigned';
    case 'wo_reassigned':
      return 'WO Reassigned';
    case 'daily_summary':
      return 'Daily Summary';
    case 'test_email':
      return 'Test Email';
    default:
      return type;
  }
}

export const EmailNotificationCenterView: React.FC = () => {
  const { currentUser } = useApp();
  const { toast } = useToast();

  const isSuperadmin = currentUser?.role === 'super_admin';

  const [subTab, setSubTab] = useState<EmailSubTab>('general');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testConnectionMsg, setTestConnectionMsg] = useState<{
    ok: boolean;
    text: string;
    recipientEmail?: string;
    providerMessageId?: string;
  } | null>(null);

  const [testEmailResultMsg, setTestEmailResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [config, setConfig] = useState<EmailNotificationConfig>({
    enabled: false,
    senderName: 'MoraJaws',
    senderEmail: 'noreply@morajaws.local',
    replyToEmail: '',
    timezone: 'Asia/Jakarta',
    rules: DEFAULT_RULES
  });
  const [providerHealth, setProviderHealth] = useState<EmailProviderHealth | null>(null);
  const [testRecipientEmail, setTestRecipientEmail] = useState<string>(currentUser?.email || '');

  // Templates state
  const [templates, setTemplates] = useState<EmailTemplateItem[]>([]);
  const [placeholders, setPlaceholders] = useState<PlaceholderToken[]>([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('new_wo_leader');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftGreeting, setDraftGreeting] = useState('');
  const [draftBodyIntro, setDraftBodyIntro] = useState('');
  const [draftFooterText, setDraftFooterText] = useState('');
  const [draftTplEnabled, setDraftTplEnabled] = useState(true);
  const [activeField, setActiveField] = useState<'subject' | 'greeting' | 'bodyIntro' | 'footerText'>('bodyIntro');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');

  // Delivery Logs state
  const [logs, setLogs] = useState<EmailDeliveryLogItem[]>([]);
  const [queueCounts, setQueueCounts] = useState<Record<string, number>>({});
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [isTriggeringOps, setIsTriggeringOps] = useState(false);
  const [logFilters, setLogFilters] = useState({
    dateFrom: '',
    dateTo: '',
    role: 'ALL',
    notificationType: 'ALL',
    status: 'ALL',
    search: ''
  });

  const loadConfigAndTemplates = useCallback(async () => {
    if (!isSuperadmin) return;
    setIsLoading(true);
    try {
      const headers = getAuthHeaders();
      const [cfgRes, tplRes] = await Promise.all([
        fetch('/api/email-notifications/config', { headers, credentials: 'include' }),
        fetch('/api/email-notifications/templates', { headers, credentials: 'include' })
      ]);

      if (cfgRes.ok) {
        const cfgJson = await cfgRes.json();
        if (cfgJson.config) setConfig(cfgJson.config);
        if (cfgJson.providerHealth) setProviderHealth(cfgJson.providerHealth);
      }

      if (tplRes.ok) {
        const tplJson = await tplRes.json();
        if (Array.isArray(tplJson.templates)) {
          setTemplates(tplJson.templates);
        }
        if (Array.isArray(tplJson.placeholders)) {
          setPlaceholders(tplJson.placeholders);
        }
      }
    } catch {
      toast.error('Gagal memuat konfigurasi Email Notification Center.');
    } finally {
      setIsLoading(false);
    }
  }, [isSuperadmin, toast]);

  const loadLogs = useCallback(async () => {
    if (!isSuperadmin) return;
    setIsLoadingLogs(true);
    try {
      const params = new URLSearchParams();
      if (logFilters.dateFrom) params.set('dateFrom', logFilters.dateFrom);
      if (logFilters.dateTo) params.set('dateTo', logFilters.dateTo);
      if (logFilters.role !== 'ALL') params.set('role', logFilters.role);
      if (logFilters.notificationType !== 'ALL') params.set('notificationType', logFilters.notificationType);
      if (logFilters.status !== 'ALL') params.set('status', logFilters.status);
      if (logFilters.search.trim()) params.set('search', logFilters.search.trim());
      params.set('limit', '120');

      const res = await fetch(`/api/email-notifications/logs?${params.toString()}`, {
        headers: getAuthHeaders(),
        credentials: 'include'
      });
      if (res.ok) {
        const json = await res.json();
        setLogs(Array.isArray(json.logs) ? json.logs : []);
        setQueueCounts(json.queueCounts || {});
      }
    } finally {
      setIsLoadingLogs(false);
    }
  }, [isSuperadmin, logFilters]);

  useEffect(() => {
    void loadConfigAndTemplates();
  }, [loadConfigAndTemplates]);

  useEffect(() => {
    if (subTab === 'logs') {
      void loadLogs();
    }
  }, [subTab, loadLogs]);

  const selectedTemplate = templates.find(t => t.templateKey === selectedTemplateKey) || templates[0];

  const requestTemplatePreview = useCallback(
    async (
      templateKey: string,
      draft?: { subject: string; greeting: string; bodyIntro: string; footerText: string }
    ) => {
      if (!isSuperadmin || !templateKey) return;
      setIsLoadingPreview(true);
      try {
        const res = await fetch('/api/email-notifications/preview', {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ templateKey, draft })
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) {
          setPreviewSubject(json.subject || '');
          setPreviewHtml(json.htmlBody || '');
        }
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [isSuperadmin]
  );

  useEffect(() => {
    if (selectedTemplate) {
      setDraftSubject(selectedTemplate.subject);
      setDraftGreeting(selectedTemplate.greeting);
      setDraftBodyIntro(selectedTemplate.bodyIntro);
      setDraftFooterText(selectedTemplate.footerText);
      setDraftTplEnabled(selectedTemplate.enabled);
      void requestTemplatePreview(selectedTemplate.templateKey, {
        subject: selectedTemplate.subject,
        greeting: selectedTemplate.greeting,
        bodyIntro: selectedTemplate.bodyIntro,
        footerText: selectedTemplate.footerText
      });
    }
  }, [selectedTemplate, requestTemplatePreview]);

  if (!isSuperadmin) {
    return (
      <div className="card-3d-lavender rounded-2xl p-6 sm:p-8 border border-rose-200 dark:border-rose-900/70 text-center max-w-lg mx-auto space-y-3 my-6">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-display font-extrabold text-base text-[#26364A] dark:text-white">
          Akses Ditolak: Email Notification Center
        </h3>
        <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
          Konfigurasi automated email, template HTML, dan delivery logs hanya dapat diakses oleh <strong>Superadmin</strong>.
        </p>
      </div>
    );
  }

  const handleSaveConfig = async (nextOverride?: Partial<EmailNotificationConfig>) => {
    setIsSavingConfig(true);
    try {
      const payload = { ...config, ...(nextOverride || {}) };
      const res = await fetch('/api/email-notifications/config', {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast.error(json?.error || 'Gagal menyimpan konfigurasi Email Notification.');
        return;
      }
      setConfig(json.config);
      if (json.providerHealth) setProviderHealth(json.providerHealth);
      toast.success('Konfigurasi Email Notification berhasil disimpan.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConn(true);
    setTestConnectionMsg(null);
    try {
      const res = await fetch('/api/email-notifications/test-connection', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include'
      });
      const json = await res.json().catch(() => ({}));
      if (json.providerHealth) setProviderHealth(json.providerHealth);
      setTestConnectionMsg({
        ok: Boolean(json.success),
        text: json.message || 'Gagal menguji koneksi Gmail SMTP.',
        recipientEmail: json.recipientEmail || undefined,
        providerMessageId: json.providerMessageId || undefined
      });
      if (json.success) {
        toast.success(json.message);
      } else {
        toast.warning(json.message || 'Koneksi Gmail SMTP belum siap.');
      }
      if (subTab === 'logs') void loadLogs();
    } finally {
      setIsTestingConn(false);
    }
  };

  const handleSendTestEmail = async (tplKey?: string) => {
    const clean = testRecipientEmail.trim();
    if (!clean || !clean.includes('@')) {
      toast.warning('Masukkan alamat email tujuan test yang valid terlebih dahulu.');
      return;
    }
    setIsSendingTest(true);
    setTestEmailResultMsg(null);
    try {
      const res = await fetch('/api/email-notifications/test-send', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          recipientEmail: clean,
          templateKey: tplKey || selectedTemplateKey
        })
      });
      const json = await res.json().catch(() => ({}));
      if (json.providerHealth) setProviderHealth(json.providerHealth);
      if (res.ok && json.success) {
        setTestEmailResultMsg({ ok: true, text: json.message });
        toast.success(json.message);
      } else {
        const errMsg = json.message || 'Pengiriman test email melalui Gmail SMTP gagal.';
        setTestEmailResultMsg({ ok: false, text: errMsg });
        toast.error(errMsg);
      }
      if (subTab === 'logs') void loadLogs();
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleSaveTemplate = async (nextEnabled?: boolean) => {
    if (!selectedTemplate) return;
    setIsSavingTemplate(true);
    try {
      const res = await fetch(`/api/email-notifications/templates/${selectedTemplate.templateKey}`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          enabled: nextEnabled !== undefined ? nextEnabled : draftTplEnabled,
          subject: draftSubject,
          greeting: draftGreeting,
          bodyIntro: draftBodyIntro,
          footerText: draftFooterText
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast.error(json?.error || 'Gagal menyimpan template email.');
        return;
      }
      setTemplates(prev =>
        prev.map(t => (t.templateKey === json.template.templateKey ? json.template : t))
      );
      setDraftTplEnabled(json.template.enabled);
      toast.success(`Template "${json.template.label}" berhasil disimpan.`);
      void requestTemplatePreview(json.template.templateKey, {
        subject: json.template.subject,
        greeting: json.template.greeting,
        bodyIntro: json.template.bodyIntro,
        footerText: json.template.footerText
      });
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleInsertPlaceholder = (token: string) => {
    if (activeField === 'subject') setDraftSubject(prev => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token}`);
    else if (activeField === 'greeting') setDraftGreeting(prev => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token}`);
    else if (activeField === 'footerText') setDraftFooterText(prev => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token}`);
    else setDraftBodyIntro(prev => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token}`);
  };

  const handleProcessQueueNow = async () => {
    setIsProcessingQueue(true);
    try {
      const res = await fetch('/api/email-notifications/process-queue', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include'
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        const r = json.result;
        toast.info(
          `Antrean diproses: ${r.processed} item (${r.sent} terkirim, ${r.retryScheduled} retry, ${r.failed} gagal, ${r.skipped} dilewati).`
        );
        void loadLogs();
      } else {
        toast.error(json?.error || 'Gagal memproses antrean email.');
      }
    } finally {
      setIsProcessingQueue(false);
    }
  };

  const handleManualOperationalTrigger = async (kind: 'daily_summary' | 'daily_reset') => {
    setIsTriggeringOps(true);
    try {
      const endpoint =
        kind === 'daily_summary'
          ? '/api/email-notifications/trigger-daily-summary'
          : '/api/email-notifications/trigger-daily-reset';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include'
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        const r = json.result;
        toast.success(
          `${kind === 'daily_summary' ? 'Daily Summary' : 'Daily Reset'} (${json.operationalDate}): ${r.queued} masuk antrean, ${r.deduped} dedup, ${r.skipped} dilewati.`
        );
      } else {
        toast.error(json?.error || 'Gagal memicu notifikasi operasional.');
      }
    } finally {
      setIsTriggeringOps(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* HERO HEADER */}
      <div className="card-3d-lavender rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#EAE8FF] via-[#DDF4F4] to-[#E2ECFA] text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:from-[#58149C] dark:via-[#431599] dark:to-[#240B47] dark:text-white flex items-center justify-center shrink-0">
              <Mail className="w-6 h-6" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white tracking-tight">
                  Email Notification Center
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1]">
                  SUPERADMIN ONLY · WIB
                </span>
                {providerHealth && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                      providerHealth.ready
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                        : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${providerHealth.ready ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span>{providerHealth.ready ? 'GMAIL SMTP READY' : 'SMTP SECRETS NEEDED'}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] max-w-2xl leading-relaxed">
                Otomasi notifikasi email berbasis queue untuk Daily Reset, New WO Leader, WO Assignment, WO Reassignment, dan Daily Summary.
              </p>
            </div>
          </div>

          {/* Master Switch */}
          <div className="mj-tactile-well px-4 py-3 rounded-xl flex items-center gap-3 shrink-0">
            <div>
              <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                Master Email System
              </div>
              <div className="text-[11px] font-semibold text-[#5145A6] dark:text-[#D8B4FE]">
                {config.enabled ? 'Aktif (Auto-Queue Berjalan)' : 'Nonaktif (Ditangguhkan)'}
              </div>
            </div>
            <button
              type="button"
              disabled={isSavingConfig || isLoading}
              onClick={() => void handleSaveConfig({ enabled: !config.enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                config.enabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
              }`}
              title="Aktif/Nonaktifkan Sistem Email Otomatis"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* SUB-TABS */}
      <div className="mj-tactile-tab-bar p-1.5 rounded-2xl flex items-center gap-1.5 text-xs font-semibold overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setSubTab('general')}
          className={`px-3.5 py-2 min-h-[38px] rounded-xl flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
            subTab === 'general'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-white/75 dark:hover:bg-[#261942]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>A. General Configuration</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('rules')}
          className={`px-3.5 py-2 min-h-[38px] rounded-xl flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
            subTab === 'rules'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-white/75 dark:hover:bg-[#261942]'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>B. Notification Rules</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('templates')}
          className={`px-3.5 py-2 min-h-[38px] rounded-xl flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
            subTab === 'templates'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-white/75 dark:hover:bg-[#261942]'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5" />
          <span>C. Email Template Manager ({templates.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('logs')}
          className={`px-3.5 py-2 min-h-[38px] rounded-xl flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
            subTab === 'logs'
              ? 'btn-3d-primary text-white font-bold'
              : 'text-[#52647A] dark:text-[#CEC0E8] hover:bg-white/75 dark:hover:bg-[#261942]'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>D. Email Delivery Logs</span>
        </button>
      </div>

      {isLoading ? (
        <div className="card-3d-lavender rounded-2xl p-10 flex items-center justify-center gap-2 text-xs font-bold text-[#5145A6] dark:text-[#DAB9FF]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Memuat konfigurasi Email Notification Center...</span>
        </div>
      ) : (
        <>
          {/* ============================================================== */}
          {/* TAB A: GENERAL CONFIGURATION                                   */}
          {/* ============================================================== */}
          {subTab === 'general' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
              <div className="xl:col-span-7 card-3d-lavender rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
                  <div>
                    <h3 className="font-display font-extrabold text-sm text-[#26364A] dark:text-white">
                      Identitas Pengirim &amp; Konfigurasi Utama
                    </h3>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Pengaturan nama pengirim, alamat email pengirim terverifikasi, reply-to, dan zona waktu.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                      Sender Name
                    </label>
                    <input
                      type="text"
                      value={config.senderName}
                      onChange={e => setConfig(prev => ({ ...prev, senderName: e.target.value }))}
                      placeholder="MoraJaws Ops Dispatch"
                      className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-bold text-[#26364A] dark:text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                      Sender Email
                    </label>
                    <input
                      type="email"
                      value={config.senderEmail}
                      onChange={e => setConfig(prev => ({ ...prev, senderEmail: e.target.value }))}
                      placeholder="noreply@domainanda.com"
                      className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-bold text-[#26364A] dark:text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                      Reply-To Email
                    </label>
                    <input
                      type="email"
                      value={config.replyToEmail}
                      onChange={e => setConfig(prev => ({ ...prev, replyToEmail: e.target.value }))}
                      placeholder="ops-support@domainanda.com"
                      className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-bold text-[#26364A] dark:text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                      Default Timezone
                    </label>
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-bold text-[#52647A] dark:text-[#D8B4FE]">
                      <span>Asia/Jakarta (WIB)</span>
                      <Lock className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#A78BFA]" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <span className="text-[11px] text-[#8492A5] dark:text-[#A79BC0]">
                    {config.updatedAt
                      ? `Terakhir disimpan: ${new Date(config.updatedAt).toLocaleString('id-ID')}`
                      : 'Belum pernah disimpan'}
                  </span>
                  <button
                    type="button"
                    disabled={isSavingConfig}
                    onClick={() => void handleSaveConfig()}
                    className="btn-3d-primary px-4 py-2 min-h-[38px] rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isSavingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>Save Configuration</span>
                  </button>
                </div>
              </div>

              {/* Provider Status & Test Send */}
              <div className="xl:col-span-5 space-y-4">
                <div className="card-3d-lavender rounded-2xl p-5 space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display font-extrabold text-sm text-[#26364A] dark:text-white">
                        Provider Status (Gmail SMTP · STARTTLS)
                      </h3>
                      <p className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
                        Test Connection memverifikasi SMTP &amp; mengirim email percobaan ke alamat pengirim sendiri.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isTestingConn}
                      onClick={handleTestConnection}
                      title={
                        providerHealth?.resolvedSenderEmail
                          ? `Verifikasi SMTP & kirim email percobaan ke ${providerHealth.resolvedSenderEmail}`
                          : 'Verifikasi koneksi Gmail SMTP & kirim email percobaan ke pengirim sendiri'
                      }
                      className="btn-3d-lilac px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {isTestingConn ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                      <span>{isTestingConn ? 'Testing...' : 'Test Connection'}</span>
                    </button>
                  </div>

                  {providerHealth && (
                    <div className="space-y-2 text-xs">
                      <div className="mj-tactile-well p-3 rounded-xl flex items-center justify-between gap-2">
                        <span className="font-bold text-[#52647A] dark:text-[#CEC0E8]">Endpoint &amp; Enkripsi</span>
                        <span className="font-mono text-[10.5px] font-extrabold text-[#26364A] dark:text-white">
                          {providerHealth.smtpHost}:{providerHealth.smtpPort} · {providerHealth.smtpSecure ? 'SSL/TLS' : 'STARTTLS'}
                        </span>
                      </div>

                      <div className="mj-tactile-well p-3 rounded-xl flex items-center justify-between gap-2">
                        <span className="font-bold text-[#52647A] dark:text-[#CEC0E8]">SMTP_USER (Server Secret)</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold ${
                            providerHealth.smtpUserConfigured
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300'
                          }`}
                        >
                          {providerHealth.smtpUserConfigured ? providerHealth.smtpUserPreview : 'MISSING'}
                        </span>
                      </div>

                      <div className="mj-tactile-well p-3 rounded-xl flex items-center justify-between gap-2">
                        <span className="font-bold text-[#52647A] dark:text-[#CEC0E8]">SMTP_PASS (App Password)</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold ${
                            providerHealth.smtpPassConfigured
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300'
                          }`}
                        >
                          <Lock className="w-3 h-3" />
                          <span>{providerHealth.smtpPassConfigured ? 'CONFIGURED (SECRET)' : 'MISSING'}</span>
                        </span>
                      </div>

                      <div className="mj-tactile-well p-3 rounded-xl flex items-center justify-between gap-2">
                        <span className="font-bold text-[#52647A] dark:text-[#CEC0E8]">Migration 019 Tables</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold ${
                            providerHealth.dedicatedTablesReady
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                          }`}
                        >
                          <Database className="w-3 h-3" />
                          <span>{providerHealth.dedicatedTablesReady ? 'READY' : 'FALLBACK STORE'}</span>
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[11px] text-[#52647A] dark:text-[#CEC0E8] space-y-1">
                        <div>
                          <span className="font-bold">Header From:</span>{' '}
                          <span className="font-mono text-[#26364A] dark:text-white">{providerHealth.resolvedFromPreview}</span>
                        </div>
                        <div>
                          <span className="font-bold">Reply-To:</span>{' '}
                          <span className="font-mono text-[#26364A] dark:text-white">{providerHealth.resolvedReplyToPreview || '-'}</span>
                        </div>
                        <div>
                          <span className="font-bold">Target Self-Test:</span>{' '}
                          <span className="font-mono text-[#26364A] dark:text-white">
                            {providerHealth.resolvedSenderEmail || 'Belum dikonfigurasi'}
                          </span>
                        </div>
                        <div>{providerHealth.statusMessage}</div>
                      </div>
                    </div>
                  )}

                  {testConnectionMsg && (
                    <div
                      className={`p-3 rounded-xl text-[11px] font-bold border flex items-start gap-2 ${
                        testConnectionMsg.ok
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                      }`}
                    >
                      {testConnectionMsg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                      <div className="space-y-1 min-w-0">
                        <div>{testConnectionMsg.text}</div>
                        {(testConnectionMsg.recipientEmail || testConnectionMsg.providerMessageId) && (
                          <div className="font-mono text-[10px] opacity-90 break-all">
                            {testConnectionMsg.recipientEmail ? `Tujuan: ${testConnectionMsg.recipientEmail}` : ''}
                            {testConnectionMsg.recipientEmail && testConnectionMsg.providerMessageId ? ' · ' : ''}
                            {testConnectionMsg.providerMessageId ? `ID: ${testConnectionMsg.providerMessageId}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Send Test Email */}
                <div className="card-3d-lavender rounded-2xl p-5 space-y-3">
                  <div>
                    <h3 className="font-display font-extrabold text-sm text-[#26364A] dark:text-white">
                      Send Test Email
                    </h3>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Uji pengiriman aktual via Gmail SMTP ke alamat email penerima menggunakan template aktif.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      value={testRecipientEmail}
                      onChange={e => setTestRecipientEmail(e.target.value)}
                      placeholder="superadmin@gmail.com"
                      className="flex-1 px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-bold text-[#26364A] dark:text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={isSendingTest}
                      onClick={() => void handleSendTestEmail()}
                      className="btn-3d-primary px-4 py-2 min-h-[38px] rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {isSendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      <span>Send Test Email</span>
                    </button>
                  </div>
                  {testEmailResultMsg && (
                    <div
                      className={`p-3 rounded-xl text-[11px] font-bold border flex items-start gap-2 ${
                        testEmailResultMsg.ok
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                      }`}
                    >
                      {testEmailResultMsg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                      <span>{testEmailResultMsg.text}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB B: NOTIFICATION RULES & SCHEDULE                           */}
          {/* ============================================================== */}
          {subTab === 'rules' && (
            <div className="card-3d-lavender rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
                <div>
                  <h3 className="font-display font-extrabold text-sm text-[#26364A] dark:text-white">
                    Aturan Event &amp; Jadwal Pengiriman Otomatis
                  </h3>
                  <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                    Aktifkan/nonaktifkan masing-masing event email beserta jadwal operasional WIB.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isSavingConfig}
                  onClick={() => void handleSaveConfig()}
                  className="btn-3d-primary px-4 py-2 min-h-[38px] rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer self-start sm:self-auto disabled:opacity-50"
                >
                  {isSavingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Save Rules</span>
                </button>
              </div>

              <div className="space-y-3">
                {/* 1. Daily Reset */}
                <div className="mj-tactile-well p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                      1. Daily Reset Notification (Leader &amp; Installer)
                    </div>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Dikirim setelah proses Daily Reset WIB selesai. Maksimal 1 ringkasan per penerima per tanggal operasional.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-bold text-[#52647A] dark:text-[#CEC0E8]">WIB:</span>
                      <input
                        type="time"
                        value={config.rules.dailyReset.scheduleTime}
                        onChange={e =>
                          setConfig(prev => ({
                            ...prev,
                            rules: {
                              ...prev.rules,
                              dailyReset: { ...prev.rules.dailyReset, scheduleTime: e.target.value }
                            }
                          }))
                        }
                        className="px-2.5 py-1.5 rounded-lg tactile-debossed-input bg-white dark:bg-[#160D29] text-xs font-mono font-bold text-[#26364A] dark:text-white"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isTriggeringOps}
                      onClick={() => void handleManualOperationalTrigger('daily_reset')}
                      className="btn-3d-lilac px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      <span>Jalankan Sekarang</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig(prev => ({
                          ...prev,
                          rules: {
                            ...prev.rules,
                            dailyReset: { ...prev.rules.dailyReset, enabled: !prev.rules.dailyReset.enabled }
                          }
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                        config.rules.dailyReset.enabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          config.rules.dailyReset.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* 2. New WO Leader */}
                <div className="mj-tactile-well p-4 rounded-xl flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                      2. New WO Notification — Leader
                    </div>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Hanya dikirim saat WO baru berhasil dipetakan ke Contractor/Area Leader yang valid.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setConfig(prev => ({
                        ...prev,
                        rules: { ...prev.rules, newWoLeader: { enabled: !prev.rules.newWoLeader.enabled } }
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                      config.rules.newWoLeader.enabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        config.rules.newWoLeader.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 3. WO Assigned Installer */}
                <div className="mj-tactile-well p-4 rounded-xl flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                      3. WO Assignment Notification — Installer
                    </div>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Dikirim eksklusif kepada akun Installer yang ditunjuk saat Leader melakukan assignment WO.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setConfig(prev => ({
                        ...prev,
                        rules: {
                          ...prev.rules,
                          woAssignedInstaller: { enabled: !prev.rules.woAssignedInstaller.enabled }
                        }
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                      config.rules.woAssignedInstaller.enabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        config.rules.woAssignedInstaller.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 4. WO Reassignment */}
                <div className="mj-tactile-well p-4 rounded-xl flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                      4. WO Reassignment Notification (Prev &amp; New Installer)
                    </div>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Mengirim pemberitahuan pengalihan kepada Installer lama dan baru hanya jika teknisi benar-benar berubah.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setConfig(prev => ({
                        ...prev,
                        rules: { ...prev.rules, woReassigned: { enabled: !prev.rules.woReassigned.enabled } }
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                      config.rules.woReassigned.enabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        config.rules.woReassigned.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 5. Daily Summary */}
                <div className="mj-tactile-well p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                      5. Daily Summary Operasional
                    </div>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Rekapitulasi Total WO, Assigned, Completed, Pending, Belum Dikerjakan, dan Bermasalah sesuai data database terkini.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-bold text-[#52647A] dark:text-[#CEC0E8]">WIB:</span>
                      <input
                        type="time"
                        value={config.rules.dailySummary.scheduleTime}
                        onChange={e =>
                          setConfig(prev => ({
                            ...prev,
                            rules: {
                              ...prev.rules,
                              dailySummary: { ...prev.rules.dailySummary, scheduleTime: e.target.value }
                            }
                          }))
                        }
                        className="px-2.5 py-1.5 rounded-lg tactile-debossed-input bg-white dark:bg-[#160D29] text-xs font-mono font-bold text-[#26364A] dark:text-white"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isTriggeringOps}
                      onClick={() => void handleManualOperationalTrigger('daily_summary')}
                      className="btn-3d-lilac px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      <span>Kirim Summary</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig(prev => ({
                          ...prev,
                          rules: {
                            ...prev.rules,
                            dailySummary: { ...prev.rules.dailySummary, enabled: !prev.rules.dailySummary.enabled }
                          }
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                        config.rules.dailySummary.enabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          config.rules.dailySummary.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB C: EMAIL TEMPLATE MANAGER + LIVE DEMO HTML PREVIEW         */}
          {/* ============================================================== */}
          {subTab === 'templates' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
              {/* Left 5 cols: Selector + Editor */}
              <div className="xl:col-span-5 card-3d-lavender rounded-2xl p-5 space-y-4">
                <div className="space-y-2">
                  <label className="block text-[10.5px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                    Pilih Template Email (7 Skenario)
                  </label>
                  <select
                    value={selectedTemplateKey}
                    onChange={e => setSelectedTemplateKey(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-xs font-bold bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white border border-[#C5BEEF] dark:border-[#4A258D] focus:outline-none"
                  >
                    {templates.map(tpl => (
                      <option key={tpl.templateKey} value={tpl.templateKey}>
                        {tpl.label} {tpl.enabled ? '' : '(Nonaktif)'}
                      </option>
                    ))}
                  </select>
                  {selectedTemplate && (
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      {selectedTemplate.description}
                    </p>
                  )}
                </div>

                {/* Enable/Disable Template */}
                <div className="mj-tactile-well p-3 rounded-xl flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[#26364A] dark:text-white">Enable Notification Template</div>
                    <div className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8]">
                      {draftTplEnabled ? 'Template aktif untuk event terkait' : 'Template dinonaktifkan'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isSavingTemplate}
                    onClick={() => void handleSaveTemplate(!draftTplEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                      draftTplEnabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        draftTplEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Editor Fields */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                      Subject Email
                    </label>
                    <input
                      type="text"
                      value={draftSubject}
                      onFocus={() => setActiveField('subject')}
                      onChange={e => setDraftSubject(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-bold text-[#26364A] dark:text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                      Greeting
                    </label>
                    <input
                      type="text"
                      value={draftGreeting}
                      onFocus={() => setActiveField('greeting')}
                      onChange={e => setDraftGreeting(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-bold text-[#26364A] dark:text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                      Body Content
                    </label>
                    <textarea
                      rows={4}
                      value={draftBodyIntro}
                      onFocus={() => setActiveField('bodyIntro')}
                      onChange={e => setDraftBodyIntro(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-medium text-[#26364A] dark:text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
                      Footer Note
                    </label>
                    <textarea
                      rows={2}
                      value={draftFooterText}
                      onFocus={() => setActiveField('footerText')}
                      onChange={e => setDraftFooterText(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-medium text-[#26364A] dark:text-white focus:outline-none"
                    />
                  </div>
                </div>

                {/* Placeholders */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                    Sisipkan Placeholder ke "{activeField}"
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-2 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                    {placeholders.map(p => (
                      <button
                        key={p.token}
                        type="button"
                        onClick={() => handleInsertPlaceholder(p.token)}
                        className="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-white hover:bg-[#EAE8FF] dark:bg-[#2E1459] dark:hover:bg-[#3F1C78] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DDE6F0] dark:border-[#5B35B1] cursor-pointer transition-colors"
                        title={`${p.label} — Contoh: ${p.example}`}
                      >
                        {p.token}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isLoadingPreview}
                    onClick={() =>
                      void requestTemplatePreview(selectedTemplateKey, {
                        subject: draftSubject,
                        greeting: draftGreeting,
                        bodyIntro: draftBodyIntro,
                        footerText: draftFooterText
                      })
                    }
                    className="btn-3d-lilac px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview Email</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSendingTest}
                    onClick={() => void handleSendTestEmail(selectedTemplateKey)}
                    className="btn-3d-lilac px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Test Email</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSavingTemplate}
                    onClick={() => void handleSaveTemplate()}
                    className="btn-3d-primary px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer ml-auto"
                  >
                    {isSavingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>Save Template</span>
                  </button>
                </div>
              </div>

              {/* Right 7 cols: Live HTML Preview (DEMO) */}
              <div className="xl:col-span-7 card-3d-lavender rounded-2xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-extrabold bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-700">
                        DEMO PREVIEW
                      </span>
                      <span className="text-xs font-extrabold text-[#26364A] dark:text-white truncate">
                        Live Rendered HTML Preview
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-[#52647A] dark:text-[#CEC0E8] truncate">
                      Subject: {previewSubject || '-'}
                    </div>
                  </div>

                  <div className="mj-seg-track p-1 rounded-xl flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewViewport('desktop')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer ${
                        previewViewport === 'desktop'
                          ? 'btn-3d-primary text-white'
                          : 'text-[#52647A] dark:text-[#CEC0E8]'
                      }`}
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      <span>Desktop</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewViewport('mobile')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer ${
                        previewViewport === 'mobile'
                          ? 'btn-3d-primary text-white'
                          : 'text-[#52647A] dark:text-[#CEC0E8]'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Mobile</span>
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl bg-[#0D061B] border border-[#35105E] p-3 flex justify-center overflow-x-auto">
                  {isLoadingPreview ? (
                    <div className="h-[520px] flex items-center justify-center text-xs text-[#DAB9FF] gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Merender preview HTML...</span>
                    </div>
                  ) : (
                    <iframe
                      sandbox=""
                      title="Preview Email Template MoraJaws"
                      srcDoc={previewHtml}
                      className={`bg-[#0D061B] rounded-xl border border-[#4A258D]/60 transition-all ${
                        previewViewport === 'mobile' ? 'w-[375px] h-[560px]' : 'w-full max-w-[640px] h-[580px]'
                      }`}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB D: EMAIL DELIVERY LOGS                                     */}
          {/* ============================================================== */}
          {subTab === 'logs' && (
            <div className="space-y-4">
              {/* Queue Summary & Actions */}
              <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { key: 'queued', label: 'Queued' },
                      { key: 'retry_pending', label: 'Retry Pending' },
                      { key: 'sent', label: 'Sent' },
                      { key: 'delivered', label: 'Delivered' },
                      { key: 'failed', label: 'Failed' },
                      { key: 'skipped', label: 'Skipped' }
                    ].map(stat => (
                      <span
                        key={stat.key}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#35105E]"
                      >
                        {stat.label}: {queueCounts[stat.key] || 0}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isProcessingQueue}
                      onClick={handleProcessQueueNow}
                      className="btn-3d-lilac px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isProcessingQueue ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      <span>Process Queue</span>
                    </button>
                    <button
                      type="button"
                      disabled={isLoadingLogs}
                      onClick={loadLogs}
                      className="btn-3d-primary px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                      <span>Refresh Logs</span>
                    </button>
                  </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                  <div className="lg:col-span-2 relative">
                    <Search className="w-3.5 h-3.5 text-[#8492A5] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={logFilters.search}
                      onChange={e => setLogFilters(prev => ({ ...prev, search: e.target.value }))}
                      placeholder="Cari WO Number, email, provider ID..."
                      className="w-full pl-8 pr-3 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-semibold text-[#26364A] dark:text-white focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#8492A5] shrink-0" />
                    <input
                      type="date"
                      value={logFilters.dateFrom}
                      onChange={e => setLogFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                      className="w-full px-2.5 py-2 rounded-xl tactile-debossed-input bg-[#F4F7FB] dark:bg-[#160D29] text-xs font-mono text-[#26364A] dark:text-white"
                      title="Tanggal Mulai"
                    />
                  </div>

                  <select
                    value={logFilters.role}
                    onChange={e => setLogFilters(prev => ({ ...prev, role: e.target.value }))}
                    className="px-2.5 py-2 rounded-xl text-xs font-bold bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#35105E]"
                  >
                    <option value="ALL">Semua Role</option>
                    <option value="leader">Leader</option>
                    <option value="installer">Installer</option>
                    <option value="super_admin">Superadmin</option>
                  </select>

                  <select
                    value={logFilters.notificationType}
                    onChange={e => setLogFilters(prev => ({ ...prev, notificationType: e.target.value }))}
                    className="px-2.5 py-2 rounded-xl text-xs font-bold bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#35105E]"
                  >
                    <option value="ALL">Semua Jenis Event</option>
                    <option value="daily_reset">Daily Reset</option>
                    <option value="new_wo_leader">New WO Leader</option>
                    <option value="wo_assigned_installer">WO Assignment</option>
                    <option value="wo_reassigned">WO Reassignment</option>
                    <option value="daily_summary">Daily Summary</option>
                    <option value="test_email">Test Email</option>
                  </select>

                  <select
                    value={logFilters.status}
                    onChange={e => setLogFilters(prev => ({ ...prev, status: e.target.value }))}
                    className="px-2.5 py-2 rounded-xl text-xs font-bold bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#35105E]"
                  >
                    <option value="ALL">Semua Status</option>
                    <option value="queued">Queued</option>
                    <option value="processing">Processing</option>
                    <option value="sent">Sent</option>
                    <option value="delivered">Delivered</option>
                    <option value="retry_pending">Retry Pending</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                  </select>
                </div>
              </div>

              {/* Logs Table */}
              <div className="card-3d-lavender rounded-2xl overflow-hidden">
                {isLoadingLogs ? (
                  <div className="p-10 flex items-center justify-center gap-2 text-xs font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memuat Email Delivery Logs...</span>
                  </div>
                ) : logs.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <Mail className="w-8 h-8 text-[#8492A5] mx-auto" />
                    <div className="text-xs font-bold text-[#26364A] dark:text-white">
                      Belum ada riwayat pengiriman email yang sesuai filter
                    </div>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Aktifkan modul email notification atau kirim test email untuk memantau log secara real-time.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#F4F7FB] dark:bg-[#160D29] border-b border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#A79BC0]">
                          <th className="py-3 px-4">Waktu (WIB)</th>
                          <th className="py-3 px-4">Penerima &amp; Role</th>
                          <th className="py-3 px-4">Event / WO</th>
                          <th className="py-3 px-4">Subject</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Provider ID / Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#35105E]">
                        {logs.map(log => {
                          const badge = statusBadgeMeta(log.deliveryStatus);
                          return (
                            <tr key={log.id} className="hover:bg-[#F8FAFD] dark:hover:bg-[#22123F]/60">
                              <td className="py-3 px-4 font-mono text-[11px] text-[#52647A] dark:text-[#CEC0E8] whitespace-nowrap">
                                {new Date(log.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-bold text-[#26364A] dark:text-white">
                                  {log.recipientName || '-'}
                                </div>
                                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                                  {log.recipientEmail || '(tanpa email)'} ·{' '}
                                  <span className="uppercase font-mono">{log.recipientRole || '-'}</span>
                                </div>
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <div className="font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                                  {eventTypeLabel(log.notificationType)}
                                </div>
                                {log.relatedWoNumber && (
                                  <div className="text-[11px] font-mono text-[#26364A] dark:text-white">
                                    {log.relatedWoNumber}
                                  </div>
                                )}
                                {(log.metadata?.previousInstaller || log.metadata?.newInstaller) && (
                                  <div className="text-[10px] text-[#52647A] dark:text-[#CEC0E8]">
                                    {log.metadata?.previousInstaller ? `${log.metadata.previousInstaller} → ` : ''}
                                    {log.metadata?.newInstaller || '-'}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-4 max-w-[260px]">
                                <div className="truncate font-semibold text-[#26364A] dark:text-white" title={log.subject}>
                                  {log.subject}
                                </div>
                                {log.metadata?.eventId && (
                                  <div className="text-[10px] font-mono text-[#8492A5] truncate" title={String(log.metadata.eventId)}>
                                    Evt: {String(log.metadata.eventId)}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold border ${badge.cls}`}>
                                  {badge.label}
                                </span>
                                {log.metadata?.processedAt && (
                                  <div className="text-[9.5px] font-mono text-[#8492A5] mt-0.5">
                                    {new Date(log.metadata.processedAt).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-4 max-w-[240px]">
                                {log.providerMessageId && (
                                  <div className="text-[10.5px] font-mono text-emerald-700 dark:text-emerald-300 truncate">
                                    ID: {log.providerMessageId}
                                  </div>
                                )}
                                {log.errorMessage && (
                                  <div className="text-[10.5px] text-rose-600 dark:text-rose-300 flex items-start gap-1">
                                    <XCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                    <span className="line-clamp-2">{log.errorMessage}</span>
                                  </div>
                                )}
                                {!log.providerMessageId && !log.errorMessage && (
                                  <span className="text-[11px] text-[#8492A5]">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
