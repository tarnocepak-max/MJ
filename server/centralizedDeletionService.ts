import crypto from 'crypto';
import { getSupabaseBackendClient } from './supabaseClient.ts';
import {
  PROTECTED_PRODUCTION_WO_IDS,
  canonicalWoKey,
  classifySupabaseError,
  normalizeWoNumber,
  postgresRowToTicket
} from './supabaseAdapter.ts';

export type DeletionCategory =
  | 'work_orders'
  | 'assignment_history'
  | 'technical_reports'
  | 'ticket_messages'
  | 'attachments'
  | 'import_history'
  | 'import_staging'
  | 'other_data';

export type DeletionSubEntity =
  | 'all'
  | 'users'
  | 'contractors'
  | 'coverage_areas'
  | 'wa_templates'
  | 'droplist_items'
  | 'chat_categories';

export type DeletionType = 'soft_delete' | 'permanent_delete' | 'restore';
export type DeletionMode = 'soft_delete' | 'permanent_delete' | 'restore';

export interface DeletionActor {
  id: string;
  name: string;
  role: string;
}

export interface WoDependencySummary {
  found: boolean;
  id: string;
  woNumber: string;
  customerName?: string;
  isDeleted: boolean;
  isArchived: boolean;
  isProtected: boolean;
  activeImportLock: boolean;
  counts: {
    assignment_history: number;
    ticket_messages: number;
    technical_reports: number;
    attachments: number;
    wo_progress_report_history: number;
    wo_distribution_logs: number;
    wo_kendala_reports: number;
    wo_photo_evidence: number;
  };
  blockingTotal: number;
  canSoftDelete: boolean;
  canPermanentDelete: boolean;
  blockingReasons: string[];
}

export interface DeletionLogRecord {
  id: string;
  transactionId: string;
  deletionType: DeletionType;
  category: DeletionCategory;
  sourceTable: string;
  recordId: string;
  woNumber?: string | null;
  actorUserId?: string | null;
  actorName: string;
  actorRole: string;
  reason?: string | null;
  relatedCounts: Record<string, number>;
  status: 'success' | 'failed' | 'rejected';
  errorMessage?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface DeletionTargetInput {
  category: DeletionCategory;
  recordId: string;
  subEntity?: DeletionSubEntity;
  woNumber?: string;
  label?: string;
}

export type PermanentDeleteOperationStatus =
  | 'preparing'
  | 'verifying'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed';

export type PermanentDeleteItemStatus =
  | 'pending'
  | 'deleted'
  | 'already_deleted'
  | 'blocked_fk'
  | 'protected'
  | 'failed';

export interface PermanentDeleteItemResult {
  recordId: string;
  category: DeletionCategory;
  subEntity?: DeletionSubEntity;
  woNumber?: string;
  label?: string;
  status: PermanentDeleteItemStatus;
  code?: string;
  message?: string;
  transactionId?: string;
  processedAt?: string;
}

export interface PermanentDeleteOperationState {
  operationId: string;
  fingerprint: string;
  status: PermanentDeleteOperationStatus;
  stageLabel: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  reason: string;
  confirmText: string;
  totalCount: number;
  processedCount: number;
  succeededCount: number;
  alreadyDeletedCount: number;
  blockedCount: number;
  failedCount: number;
  chunkSize: number;
  nextIndex: number;
  targets: DeletionTargetInput[];
  results: PermanentDeleteItemResult[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  lastError?: string | null;
  auditLogged?: boolean;
}

export interface LocalStoreBridge {
  db: any;
  saveDatabaseToDisk: () => void;
  logServerAuditAsync: (
    action: string,
    entity: string,
    entityId: string,
    details: string,
    user?: any,
    extra?: any
  ) => Promise<any>;
  broadcastSupabaseChange: (table: string, event: string, payload: any) => void;
  revokeUserSessions: (userId: string) => void;
  isSupabaseMode: () => boolean;
  isLocalJsonModeAllowed: () => boolean;
  beforeCommitHook?: (ctx: { action: DeletionType; category: DeletionCategory; recordId: string }) => void;
}

export const ALL_DELETION_CATEGORIES: DeletionCategory[] = [
  'work_orders',
  'assignment_history',
  'technical_reports',
  'ticket_messages',
  'attachments',
  'import_history',
  'import_staging',
  'other_data'
];

export const PROTECTED_WO_NUMBERS = new Set<string>([
  'WO-EXPRESS-TEST-1793825456810',
  'WO-DUP-TEST-1793825458804',
  'WO-DUP-TEST-1793825458804-UNIQUE'
]);

const SENSITIVE_KEY_PATTERN = /password|passhash|passwordhash|token|secret|apikey|api_key|service_role|authorization|cookie|credential/i;

export function sanitizeDeletionPayload<T = any>(value: T, depth = 0): T {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map(item => sanitizeDeletionPayload(item, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) continue;
      out[k] = sanitizeDeletionPayload(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

export function isProtectedWorkOrder(record: { id?: string; woNumber?: string; wo_number?: string } | null | undefined): boolean {
  if (!record) return false;
  const id = String(record.id || '').trim();
  const wo = String(record.woNumber || record.wo_number || '').trim().toUpperCase();
  return PROTECTED_PRODUCTION_WO_IDS.has(id) || PROTECTED_WO_NUMBERS.has(wo);
}

// Concurrency lock guard (prevents simultaneous delete/restore on same record)
const inFlightDeletionLocks = new Map<string, { transactionId: string; actor: string; startedAt: number }>();
const LOCK_STALE_MS = 60_000;

export function acquireRecordLock(lockKey: string, transactionId: string, actorName: string): boolean {
  const existing = inFlightDeletionLocks.get(lockKey);
  if (existing && Date.now() - existing.startedAt < LOCK_STALE_MS) {
    return false;
  }
  inFlightDeletionLocks.set(lockKey, { transactionId, actor: actorName, startedAt: Date.now() });
  return true;
}

export function releaseRecordLock(lockKey: string, transactionId: string): void {
  const existing = inFlightDeletionLocks.get(lockKey);
  if (existing && existing.transactionId === transactionId) {
    inFlightDeletionLocks.delete(lockKey);
  }
}

export function isCategoryAllowedForRole(role: string, category: DeletionCategory, subEntity?: DeletionSubEntity): boolean {
  if (role === 'super_admin') return true;
  if (role === 'dispatch') {
    // Dispatch (only when explicitly granted `delete_wo_data`) may soft-delete operational WO records ONLY,
    // never users/contractors/areas/system staging/audit data.
    if (category === 'work_orders') return true;
    return false;
  }
  return false;
}

function makeTxId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function makeLogId(): string {
  return `dellog_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function ensureLocalCollections(db: any) {
  if (!Array.isArray(db.tickets)) db.tickets = [];
  if (!Array.isArray(db.assignmentHistory)) db.assignmentHistory = [];
  if (!Array.isArray(db.technicalReports)) db.technicalReports = [];
  if (!Array.isArray(db.ticketMessages)) db.ticketMessages = [];
  if (!Array.isArray(db.attachments)) db.attachments = [];
  if (!Array.isArray(db.storageMetadata)) db.storageMetadata = [];
  if (!Array.isArray(db.importHistory)) db.importHistory = [];
  if (!Array.isArray(db.importJobs)) db.importJobs = [];
  if (!Array.isArray(db.importStagingRows)) db.importStagingRows = [];
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.contractors)) db.contractors = [];
  if (!Array.isArray(db.coverageAreas)) db.coverageAreas = [];
  if (!Array.isArray(db.templates)) db.templates = [];
  if (!Array.isArray(db.deletionLogs)) db.deletionLogs = [];
  if (!Array.isArray(db.deletionOperations)) db.deletionOperations = [];
  if (!db.appSettings || typeof db.appSettings !== 'object') db.appSettings = {};
}

export function resolveSourceTable(category: DeletionCategory, subEntity?: DeletionSubEntity): string {
  switch (category) {
    case 'work_orders':
      return 'work_orders';
    case 'assignment_history':
      return 'assignment_history';
    case 'technical_reports':
      return 'technical_reports';
    case 'ticket_messages':
      return 'ticket_messages';
    case 'attachments':
      return 'attachments';
    case 'import_history':
      return 'import_history';
    case 'import_staging':
      return 'import_jobs';
    case 'other_data':
      if (subEntity === 'users') return 'users';
      if (subEntity === 'contractors') return 'contractors';
      if (subEntity === 'coverage_areas') return 'coverage_areas';
      if (subEntity === 'wa_templates') return 'wa_templates';
      if (subEntity === 'droplist_items' || subEntity === 'chat_categories') return 'app_settings';
      return 'other_data';
  }
}

export async function recordDeletionLog(
  bridge: LocalStoreBridge,
  entry: Omit<DeletionLogRecord, 'id' | 'createdAt'>
): Promise<DeletionLogRecord> {
  const full: DeletionLogRecord = {
    id: makeLogId(),
    createdAt: new Date().toISOString(),
    ...entry,
    metadata: sanitizeDeletionPayload(entry.metadata || {})
  };

  if (bridge.isLocalJsonModeAllowed()) {
    ensureLocalCollections(bridge.db);
    bridge.db.deletionLogs.unshift(full);
    if (bridge.db.deletionLogs.length > 5000) {
      bridge.db.deletionLogs.length = 5000;
    }
    bridge.saveDatabaseToDisk();
  }

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        await client.from('deletion_logs').insert({
          id: full.id,
          transaction_id: full.transactionId,
          deletion_type: full.deletionType,
          category: full.category,
          source_table: full.sourceTable,
          record_id: full.recordId,
          wo_number: full.woNumber || null,
          actor_user_id: full.actorUserId || null,
          actor_name: full.actorName,
          actor_role: full.actorRole,
          reason: full.reason || null,
          related_counts: full.relatedCounts || {},
          status: full.status,
          error_message: full.errorMessage || null,
          metadata: full.metadata || {},
          created_at: full.createdAt
        });
      } catch {
        // Non-fatal if migration 022 hasn't been applied on remote Supabase yet; audit_logs still receives event
      }
    }
  }

  return full;
}

function getLocalTechnicalReports(db: any): any[] {
  ensureLocalCollections(db);
  const explicit: any[] = db.technicalReports || [];
  const explicitTicketIds = new Set(explicit.map((r: any) => String(r.workOrderId || r.ticketId || '')));
  const derived: any[] = [];
  for (const t of db.tickets || []) {
    if (t?.technicalReport && typeof t.technicalReport === 'object' && Object.keys(t.technicalReport).length > 0) {
      if (!explicitTicketIds.has(String(t.id))) {
        derived.push({
          id: `tr_${t.id}`,
          workOrderId: t.id,
          ticketId: t.id,
          woNumber: t.woNumber,
          installerName: t.installerName || t.technicalReport.submittedBy || '-',
          statusInstaller: t.statusWOInstaller || t.technicalReport.status || '-',
          notes: t.technicalReport.notes || t.remarksWOInstaller || '',
          submittedAt: t.technicalReport.submittedAt || t.updatedAt || t.createdAt,
          isDeleted: Boolean(t.technicalReport.isDeleted),
          deletedAt: t.technicalReport.deletedAt || null,
          deletedBy: t.technicalReport.deletedBy || null,
          deletionReason: t.technicalReport.deletionReason || null,
          _derivedFromTicket: true
        });
      }
    }
  }
  return [...explicit, ...derived];
}

function getLocalAttachments(db: any): any[] {
  ensureLocalCollections(db);
  const map = new Map<string, any>();
  for (const a of db.attachments || []) {
    map.set(String(a.id), { ...a });
  }
  for (const m of db.storageMetadata || []) {
    const id = String(m.id || m.fileId || m.filePath || '');
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      workOrderId: m.ticketId || m.workOrderId || null,
      ticketId: m.ticketId || m.workOrderId || null,
      woNumber: m.woNumber || null,
      fileName: m.fileName || String(m.filePath || '').split('/').pop() || id,
      fileType: m.mimeType || m.category || 'file',
      fileSize: m.sizeBytes || m.fileSize || 0,
      storageProvider: m.provider || 'local_storage',
      storagePath: m.filePath || '',
      senderName: m.uploadedBy || '-',
      uploadedAt: m.uploadedAt || new Date().toISOString(),
      isDeleted: Boolean(m.isDeleted),
      deletedAt: m.deletedAt || null,
      deletedBy: m.deletedBy || null,
      deletionReason: m.deletionReason || null,
      _source: 'storageMetadata'
    });
  }
  return Array.from(map.values());
}

function getLocalImportHistory(db: any): any[] {
  ensureLocalCollections(db);
  const explicit: any[] = db.importHistory || [];
  if (explicit.length > 0) return explicit;
  // Fallback read-only view from auditLogs import_batch entries if importHistory is empty
  return (db.auditLogs || [])
    .filter((l: any) => l.entity === 'import_batch')
    .map((l: any) => ({
      id: String(l.id),
      jobId: l.entityId || l.id,
      importName: l.action,
      sourceFile: l.entityId || l.action,
      importedBy: l.performedBy || 'System',
      totalRows: 0,
      successCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      status: 'completed',
      createdAt: l.timestamp || new Date().toISOString(),
      isDeleted: Boolean(l.isDeleted),
      deletedAt: l.deletedAt || null,
      deletedBy: l.deletedBy || null,
      deletionReason: l.deletionReason || null,
      _derivedFromAudit: true
    }));
}

function getLocalDroplistItems(db: any): any[] {
  ensureLocalCollections(db);
  const out: any[] = [];
  const rawHier = db.appSettings?.hierarchical_droplists;
  if (Array.isArray(rawHier)) {
    for (const st of rawHier) {
      out.push({
        id: `status:${st.id}`,
        rawId: st.id,
        itemType: 'hierarchical_status',
        label: st.name || st.label,
        code: st.code || '',
        parentName: null,
        isDeleted: Boolean(st.isDeleted),
        deletedAt: st.deletedAt || null,
        deletedBy: st.deletedBy || null,
        deletionReason: st.deletionReason || null
      });
      if (Array.isArray(st.reasons)) {
        for (const r of st.reasons) {
          out.push({
            id: `reason:${st.id}:${r.id}`,
            rawId: r.id,
            parentId: st.id,
            itemType: 'hierarchical_reason',
            label: r.name || r.label,
            code: r.code || '',
            parentName: st.name || st.label,
            isDeleted: Boolean(r.isDeleted),
            deletedAt: r.deletedAt || null,
            deletedBy: r.deletedBy || null,
            deletionReason: r.deletionReason || null
          });
        }
      }
    }
  }
  const staticKey = 'static_droplist_categories';
  const staticCats = db.appSettings?.[staticKey];
  if (Array.isArray(staticCats)) {
    for (const cat of staticCats) {
      if (Array.isArray(cat.items)) {
        for (const item of cat.items) {
          out.push({
            id: `static:${cat.id}:${item.id}`,
            rawId: item.id,
            parentId: cat.id,
            itemType: 'static_droplist_item',
            label: item.label || item.name,
            code: item.value || '',
            parentName: cat.label || cat.id,
            isDeleted: Boolean(item.isDeleted),
            deletedAt: item.deletedAt || null,
            deletedBy: item.deletedBy || null,
            deletionReason: item.deletionReason || null
          });
        }
      }
    }
  }
  return out;
}

function getLocalChatCategories(db: any): any[] {
  ensureLocalCollections(db);
  const cats = db.appSettings?.chat_categories;
  if (!Array.isArray(cats)) return [];
  return cats.map((c: any) => ({
    id: String(c.id),
    label: c.label || c.name || c.id,
    description: c.description || '',
    isDeleted: Boolean(c.isDeleted),
    deletedAt: c.deletedAt || null,
    deletedBy: c.deletedBy || null,
    deletionReason: c.deletionReason || null
  }));
}

export async function inspectWoDependencies(
  bridge: LocalStoreBridge,
  woId: string
): Promise<WoDependencySummary> {
  const cleanId = String(woId || '').trim();
  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        const rpcRes = await client.rpc('morajaws_get_wo_dependencies', { p_wo_id: cleanId });
        if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
          const d: any = rpcRes.data;
          if (!d.found) {
            return {
              found: false,
              id: cleanId,
              woNumber: '',
              isDeleted: false,
              isArchived: false,
              isProtected: false,
              activeImportLock: false,
              counts: {
                assignment_history: 0,
                ticket_messages: 0,
                technical_reports: 0,
                attachments: 0,
                wo_progress_report_history: 0,
                wo_distribution_logs: 0,
                wo_kendala_reports: 0,
                wo_photo_evidence: 0
              },
              blockingTotal: 0,
              canSoftDelete: false,
              canPermanentDelete: false,
              blockingReasons: [d.errorMessage || 'Work Order tidak ditemukan.']
            };
          }
          return {
            found: true,
            id: String(d.id),
            woNumber: String(d.woNumber || ''),
            customerName: d.customerName || undefined,
            isDeleted: Boolean(d.isDeleted),
            isArchived: Boolean(d.isArchived),
            isProtected: Boolean(d.isProtected),
            activeImportLock: Boolean(d.activeImportLock),
            counts: {
              assignment_history: Number(d.counts?.assignment_history || 0),
              ticket_messages: Number(d.counts?.ticket_messages || 0),
              technical_reports: Number(d.counts?.technical_reports || 0),
              attachments: Number(d.counts?.attachments || 0),
              wo_progress_report_history: Number(d.counts?.wo_progress_report_history || 0),
              wo_distribution_logs: Number(d.counts?.wo_distribution_logs || 0),
              wo_kendala_reports: Number(d.counts?.wo_kendala_reports || 0),
              wo_photo_evidence: Number(d.counts?.wo_photo_evidence || 0)
            },
            blockingTotal: Number(d.blockingTotal || 0),
            canSoftDelete: Boolean(d.canSoftDelete),
            canPermanentDelete: Boolean(d.canPermanentDelete),
            blockingReasons: Array.isArray(d.blockingReasons) ? d.blockingReasons : []
          };
        }
      } catch {
        // Fallback to manual Supabase multi-table count query if Migration 022 RPC is not deployed yet
      }

      const { data: woRow } = await client.from('work_orders').select('*').eq('id', cleanId).maybeSingle();
      if (!woRow) {
        return {
          found: false,
          id: cleanId,
          woNumber: '',
          isDeleted: false,
          isArchived: false,
          isProtected: false,
          activeImportLock: false,
          counts: {
            assignment_history: 0,
            ticket_messages: 0,
            technical_reports: 0,
            attachments: 0,
            wo_progress_report_history: 0,
            wo_distribution_logs: 0,
            wo_kendala_reports: 0,
            wo_photo_evidence: 0
          },
          blockingTotal: 0,
          canSoftDelete: false,
          canPermanentDelete: false,
          blockingReasons: [`Work Order "${cleanId}" tidak ditemukan.`]
        };
      }
      const woNum = String(woRow.wo_number || '');
      const [ah, tm, tr, att] = await Promise.all([
        client.from('assignment_history').select('id', { count: 'exact', head: true }).or(`work_order_id.eq.${woRow.id}${woNum ? `,wo_number.ilike.${woNum}` : ''}`),
        client.from('ticket_messages').select('id', { count: 'exact', head: true }).or(`ticket_id.eq.${woRow.id}${woNum ? `,wo_number.ilike.${woNum}` : ''}`),
        client.from('technical_reports').select('id', { count: 'exact', head: true }).or(`work_order_id.eq.${woRow.id},ticket_id.eq.${woRow.id}`),
        client.from('attachments').select('id', { count: 'exact', head: true }).or(`work_order_id.eq.${woRow.id},ticket_id.eq.${woRow.id}${woNum ? `,wo_number.ilike.${woNum}` : ''}`)
      ]);
      const counts = {
        assignment_history: Number(ah.count || 0),
        ticket_messages: Number(tm.count || 0),
        technical_reports: Number(tr.count || 0),
        attachments: Number(att.count || 0),
        wo_progress_report_history: 0,
        wo_distribution_logs: 0,
        wo_kendala_reports: 0,
        wo_photo_evidence: 0
      };
      const isProt = isProtectedWorkOrder(woRow);
      const blockingTotal =
        counts.assignment_history + counts.ticket_messages + counts.technical_reports + counts.attachments;
      const reasons: string[] = [];
      if (isProt) reasons.push('Record WO produksi historis dilindungi secara mutlak.');
      if (counts.assignment_history > 0) reasons.push(`${counts.assignment_history} record assignment_history masih terhubung.`);
      if (counts.ticket_messages > 0) reasons.push(`${counts.ticket_messages} pesan ticket_messages masih terhubung.`);
      if (counts.technical_reports > 0) reasons.push(`${counts.technical_reports} laporan technical_reports masih terhubung.`);
      if (counts.attachments > 0) reasons.push(`${counts.attachments} lampiran attachments masih terhubung.`);
      return {
        found: true,
        id: String(woRow.id),
        woNumber: woNum,
        customerName: woRow.customer_name || undefined,
        isDeleted: Boolean(woRow.is_deleted),
        isArchived: Boolean(woRow.is_archived),
        isProtected: isProt,
        activeImportLock: false,
        counts,
        blockingTotal,
        canSoftDelete: !isProt && !woRow.is_deleted,
        canPermanentDelete: !isProt && blockingTotal === 0,
        blockingReasons: reasons
      };
    }
  }

  // Local JSON Mode
  ensureLocalCollections(bridge.db);
  const ticket =
    bridge.db.tickets.find((t: any) => String(t.id) === cleanId) ||
    bridge.db.tickets.find((t: any) => canonicalWoKey(t.woNumber) === canonicalWoKey(cleanId));

  if (!ticket) {
    return {
      found: false,
      id: cleanId,
      woNumber: '',
      isDeleted: false,
      isArchived: false,
      isProtected: false,
      activeImportLock: false,
      counts: {
        assignment_history: 0,
        ticket_messages: 0,
        technical_reports: 0,
        attachments: 0,
        wo_progress_report_history: 0,
        wo_distribution_logs: 0,
        wo_kendala_reports: 0,
        wo_photo_evidence: 0
      },
      blockingTotal: 0,
      canSoftDelete: false,
      canPermanentDelete: false,
      blockingReasons: [`Work Order "${cleanId}" tidak ditemukan.`]
    };
  }

  const canonWo = canonicalWoKey(ticket.woNumber);
  const assignCnt = (bridge.db.assignmentHistory || []).filter(
    (h: any) =>
      String(h.ticketId || h.workOrderId || '') === String(ticket.id) ||
      (canonWo && canonicalWoKey(h.woNumber) === canonWo)
  ).length;

  const msgCnt = (bridge.db.ticketMessages || []).filter(
    (m: any) =>
      String(m.ticketId || '') === String(ticket.id) ||
      (canonWo && canonicalWoKey(m.woNumber) === canonWo)
  ).length;

  const reportCnt = getLocalTechnicalReports(bridge.db).filter(
    (r: any) =>
      String(r.workOrderId || r.ticketId || '') === String(ticket.id) ||
      (canonWo && canonicalWoKey(r.woNumber) === canonWo)
  ).length;

  const attachCnt = getLocalAttachments(bridge.db).filter(
    (a: any) =>
      String(a.workOrderId || a.ticketId || '') === String(ticket.id) ||
      (canonWo && canonicalWoKey(a.woNumber) === canonWo)
  ).length;

  const activeJobs = (bridge.db.importJobs || []).filter((j: any) =>
    ['staging', 'queued', 'processing'].includes(String(j.status || '').toLowerCase())
  );
  const activeImportLock = activeJobs.some((j: any) => {
    if (ticket.importBatchId && (ticket.importBatchId === j.id || String(ticket.importBatchId).startsWith(`${j.id}_b`))) {
      return true;
    }
    return (bridge.db.importStagingRows || []).some(
      (sr: any) => sr.jobId === j.id && canonWo && canonicalWoKey(sr.woNumber) === canonWo
    );
  });

  const isProt = isProtectedWorkOrder(ticket);
  const blockingTotal = assignCnt + msgCnt + reportCnt + attachCnt;
  const reasons: string[] = [];
  if (isProt) reasons.push('Record WO produksi historis dilindungi secara mutlak.');
  if (activeImportLock) reasons.push('WO terkait proses import batch yang sedang aktif berjalan.');
  if (assignCnt > 0) reasons.push(`${assignCnt} record assignment_history (FK RESTRICT) masih terhubung.`);
  if (msgCnt > 0) reasons.push(`${msgCnt} pesan ticket_messages (FK RESTRICT) masih terhubung.`);
  if (reportCnt > 0) reasons.push(`${reportCnt} laporan technical_reports (FK RESTRICT) masih terhubung.`);
  if (attachCnt > 0) reasons.push(`${attachCnt} lampiran attachments (FK RESTRICT) masih terhubung.`);

  return {
    found: true,
    id: String(ticket.id),
    woNumber: String(ticket.woNumber || ''),
    customerName: ticket.customerName || undefined,
    isDeleted: Boolean(ticket.isDeleted),
    isArchived: Boolean(ticket.isArchived),
    isProtected: isProt,
    activeImportLock,
    counts: {
      assignment_history: assignCnt,
      ticket_messages: msgCnt,
      technical_reports: reportCnt,
      attachments: attachCnt,
      wo_progress_report_history: 0,
      wo_distribution_logs: 0,
      wo_kendala_reports: 0,
      wo_photo_evidence: 0
    },
    blockingTotal,
    canSoftDelete: !isProt && !activeImportLock && !ticket.isDeleted,
    canPermanentDelete: !isProt && !activeImportLock && blockingTotal === 0,
    blockingReasons: reasons
  };
}

export async function getCategoryCountsSummary(
  bridge: LocalStoreBridge,
  actorRole: string
): Promise<Record<DeletionCategory, { active: number; deleted: number; total: number }>> {
  const empty = () => ({ active: 0, deleted: 0, total: 0 });
  const summary: Record<DeletionCategory, { active: number; deleted: number; total: number }> = {
    work_orders: empty(),
    assignment_history: empty(),
    technical_reports: empty(),
    ticket_messages: empty(),
    attachments: empty(),
    import_history: empty(),
    import_staging: empty(),
    other_data: empty()
  };

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const countPair = async (table: string) => {
        try {
          const [totRes, delRes] = await Promise.all([
            client.from(table).select('id', { count: 'exact', head: true }),
            client.from(table).select('id', { count: 'exact', head: true }).eq('is_deleted', true)
          ]);
          const total = Number(totRes.count || 0);
          const deleted = Number(delRes.count || 0);
          return { active: Math.max(0, total - deleted), deleted, total };
        } catch {
          return empty();
        }
      };

      summary.work_orders = await countPair('work_orders');
      if (actorRole === 'super_admin') {
        const [ah, tr, tm, att, ih, ijRes, usr, con, area, tpl] = await Promise.all([
          countPair('assignment_history'),
          countPair('technical_reports'),
          countPair('ticket_messages'),
          countPair('attachments'),
          countPair('import_history'),
          client.from('import_jobs').select('id', { count: 'exact', head: true }),
          countPair('users'),
          countPair('contractors'),
          countPair('coverage_areas'),
          countPair('wa_templates')
        ]);
        summary.assignment_history = ah;
        summary.technical_reports = tr;
        summary.ticket_messages = tm;
        summary.attachments = att;
        summary.import_history = ih;
        const ijTotal = Number(ijRes.count || 0);
        summary.import_staging = { active: ijTotal, deleted: 0, total: ijTotal };
        summary.other_data = {
          active: usr.active + con.active + area.active + tpl.active,
          deleted: usr.deleted + con.deleted + area.deleted + tpl.deleted,
          total: usr.total + con.total + area.total + tpl.total
        };
      }
      return summary;
    }
  }

  ensureLocalCollections(bridge.db);
  const split = (arr: any[]) => {
    const deleted = arr.filter(x => Boolean(x?.isDeleted)).length;
    return { active: arr.length - deleted, deleted, total: arr.length };
  };

  summary.work_orders = split(bridge.db.tickets || []);
  if (actorRole === 'super_admin') {
    summary.assignment_history = split(bridge.db.assignmentHistory || []);
    summary.technical_reports = split(getLocalTechnicalReports(bridge.db));
    summary.ticket_messages = split(bridge.db.ticketMessages || []);
    summary.attachments = split(getLocalAttachments(bridge.db));
    summary.import_history = split(getLocalImportHistory(bridge.db));
    summary.import_staging = split(bridge.db.importJobs || []);
    const otherAll = [
      ...(bridge.db.users || []),
      ...(bridge.db.contractors || []),
      ...(bridge.db.coverageAreas || []),
      ...(bridge.db.templates || []),
      ...getLocalDroplistItems(bridge.db),
      ...getLocalChatCategories(bridge.db)
    ];
    summary.other_data = split(otherAll);
  }

  return summary;
}

function sanitizeTextQuery(v: unknown, maxLen = 120): string {
  return String(v ?? '').trim().slice(0, maxLen);
}

function sanitizeDateOnly(v: unknown): string {
  const s = String(v ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return '';
  }
  return s;
}

function escapePostgrestIlike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

function quotePostgrestFilterVal(input: string): string {
  const escaped = input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function compareDatesNullsLast(
  aRaw: unknown,
  bRaw: unknown,
  dir: 'asc' | 'desc',
  aTieRaw?: unknown,
  bTieRaw?: unknown,
  aId?: string,
  bId?: string
): number {
  const norm = (val: unknown): string | null => {
    const s = String(val ?? '').trim();
    if (!s) return null;
    const prefix = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(prefix)) return prefix;
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    return null;
  };
  const da = norm(aRaw);
  const db = norm(bRaw);
  if (da === null && db !== null) return 1; // NULLS LAST
  if (da !== null && db === null) return -1; // NULLS LAST
  if (da !== null && db !== null && da !== db) {
    const cmp = da < db ? -1 : 1;
    return dir === 'asc' ? cmp : -cmp;
  }
  const ta = Date.parse(String(aTieRaw || '')) || 0;
  const tb = Date.parse(String(bTieRaw || '')) || 0;
  if (ta !== tb) return tb - ta;
  return String(aId || '').localeCompare(String(bId || ''));
}

export interface ListDeletionItemsParams {
  actorRole: string;
  category: DeletionCategory;
  subEntity?: DeletionSubEntity;
  mode?: DeletionMode;
  search?: string;
  woNumber?: string;
  customerId?: string;
  customerName?: string;
  contractor?: string;
  area?: string;
  assignmentStatus?: string;
  appointmentDate?: string;
  appointmentDateFrom?: string;
  appointmentDateTo?: string;
  recordIdQuery?: string;
  summaryQuery?: string;
  actorQuery?: string;
  status?: string;
  deletionStatus?: 'all' | 'active' | 'soft_deleted';
  sortBy?: 'default' | 'appointment_date' | 'created_at';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function mapPgWorkOrderToRow(rawRow: any) {
  const t = postgresRowToTicket(rawRow);
  return {
    id: t.id,
    category: 'work_orders' as const,
    woNumber: t.woNumber,
    customerId: t.idCustomer || t.customerId || '',
    customerName: t.customerName || '',
    appointmentDate: t.appointmentDate || '',
    contractor: t.contactorName || t.contractorName || '',
    area: t.area || '',
    installerName: t.installerName || '',
    assignmentStatus: t.installerName ? `Assigned (${t.installerName})` : (t.statusWOInstaller || 'Unassigned'),
    statusWOAgent: t.statusWOAgent || '',
    statusWOInstaller: t.statusWOInstaller || '',
    isArchived: Boolean(t.isArchived),
    isDeleted: Boolean(t.isDeleted),
    deletedAt: t.deletedAt || null,
    deletedBy: t.deletedBy || null,
    deletionReason: t.deletionReason || null,
    isProtected: isProtectedWorkOrder(t),
    deletionStatus: t.isDeleted ? 'SOFT_DELETED' : t.isArchived ? 'ARCHIVED' : 'ACTIVE',
    updatedAt: t.updatedAt || rawRow.updated_at || null,
    createdAt: t.createdAt || rawRow.created_at || null,
    rawDetail: sanitizeDeletionPayload(t)
  };
}

export async function listDeletionItems(
  bridge: LocalStoreBridge,
  params: ListDeletionItemsParams
) {
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(100, Math.max(5, Number(params.pageSize || 25)));
  const search = sanitizeTextQuery(params.search).toLowerCase();
  const woNumberQ = sanitizeTextQuery(params.woNumber);
  const customerIdQ = sanitizeTextQuery(params.customerId);
  const customerNameQ = sanitizeTextQuery(params.customerName);
  const recordIdQ = sanitizeTextQuery(params.recordIdQuery);
  const summaryQ = sanitizeTextQuery(params.summaryQuery);
  const actorQ = sanitizeTextQuery(params.actorQuery);
  const contractorQ = sanitizeTextQuery(params.contractor);
  const areaQ = sanitizeTextQuery(params.area);
  const assignmentStatusQ = sanitizeTextQuery(params.assignmentStatus);
  const exactDateQ = sanitizeDateOnly(params.appointmentDate);
  const dateFromQ = sanitizeDateOnly(params.appointmentDateFrom);
  const dateToQ = sanitizeDateOnly(params.appointmentDateTo);
  const sortBy = params.sortBy === 'appointment_date' || params.sortBy === 'created_at' ? params.sortBy : 'default';
  const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' ? 'asc' : 'desc';
  const mode = params.mode || 'soft_delete';
  const deletionStatusFilter =
    params.deletionStatus || (mode === 'restore' ? 'soft_deleted' : mode === 'soft_delete' ? 'active' : 'all');

  if (!isCategoryAllowedForRole(params.actorRole, params.category, params.subEntity)) {
    throw Object.assign(new Error('Role Anda tidak diizinkan mengakses kategori penghapusan ini.'), {
      statusCode: 403,
      code: 'FORBIDDEN_CATEGORY'
    });
  }

  let rows: any[] = [];

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      // Server-side PostgreSQL filtering, sorting (NULLS LAST), and pagination BEFORE slicing
      if (params.category === 'work_orders') {
        const buildWoQuery = (targetPage: number) => {
          let q = client.from('work_orders').select('*', { count: 'exact' });
          if (deletionStatusFilter === 'active') q = q.eq('is_deleted', false);
          else if (deletionStatusFilter === 'soft_deleted') q = q.eq('is_deleted', true);

          if (woNumberQ) {
            const pat = quotePostgrestFilterVal(`%${escapePostgrestIlike(woNumberQ)}%`);
            q = q.or(`wo_number.ilike.${pat},work_order_number.ilike.${pat}`);
          }
          if (customerIdQ) {
            const pat = quotePostgrestFilterVal(`%${escapePostgrestIlike(customerIdQ)}%`);
            q = q.or(`customer_id.ilike.${pat},id_customer.ilike.${pat}`);
          }
          if (customerNameQ) {
            q = q.ilike('customer_name', `%${escapePostgrestIlike(customerNameQ)}%`);
          }
          if (contractorQ && contractorQ !== 'all') {
            const val = quotePostgrestFilterVal(escapePostgrestIlike(contractorQ));
            q = q.or(`contactor_name.ilike.${val},contractor_name.ilike.${val}`);
          }
          if (areaQ && areaQ !== 'all') {
            q = q.ilike('area', escapePostgrestIlike(areaQ));
          }
          if (exactDateQ) {
            q = q.eq('appointment_date', exactDateQ);
          } else {
            if (dateFromQ) q = q.gte('appointment_date', dateFromQ);
            if (dateToQ) q = q.lte('appointment_date', dateToQ);
          }
          if (assignmentStatusQ && assignmentStatusQ !== 'all') {
            const lowerAssign = assignmentStatusQ.toLowerCase();
            if (lowerAssign === 'assigned') {
              q = q.not('installer_name', 'is', null).neq('installer_name', '');
            } else if (lowerAssign === 'unassigned') {
              q = q.or('installer_name.is.null,installer_name.eq.');
            } else {
              q = q.ilike('status_wo_installer', `%${escapePostgrestIlike(assignmentStatusQ)}%`);
            }
          }
          if (params.status && params.status !== 'all') {
            const pat = quotePostgrestFilterVal(`%${escapePostgrestIlike(params.status)}%`);
            q = q.or(`status_wo_installer.ilike.${pat},status_wo_agent.ilike.${pat}`);
          }
          if (search) {
            const pat = quotePostgrestFilterVal(`%${escapePostgrestIlike(search)}%`);
            q = q.or(
              `id.ilike.${pat},wo_number.ilike.${pat},customer_id.ilike.${pat},customer_name.ilike.${pat},contactor_name.ilike.${pat},area.ilike.${pat},installer_name.ilike.${pat}`
            );
          }

          if (sortBy === 'appointment_date') {
            q = q
              .order('appointment_date', { ascending: sortDir === 'asc', nullsFirst: false })
              .order('updated_at', { ascending: false })
              .order('id', { ascending: true });
          } else {
            q = q.order('updated_at', { ascending: false }).order('id', { ascending: true });
          }

          const from = (targetPage - 1) * pageSize;
          const to = from + pageSize - 1;
          return q.range(from, to);
        };

        let { data, count, error } = await buildWoQuery(page);
        if (error) throw Object.assign(new Error(error.message), { statusCode: 503 });

        const total = Number(count ?? (data ? data.length : 0));
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        let safePage = Math.min(page, totalPages);
        if (safePage < page && total > 0) {
          const retryRes = await buildWoQuery(safePage);
          if (retryRes.error) throw Object.assign(new Error(retryRes.error.message), { statusCode: 503 });
          data = retryRes.data;
        } else if (total === 0) {
          safePage = 1;
        }

        return {
          items: (data || []).map(mapPgWorkOrderToRow),
          total,
          page: safePage,
          pageSize,
          totalPages
        };
      } else if (
        params.category === 'assignment_history' ||
        params.category === 'technical_reports' ||
        params.category === 'ticket_messages' ||
        params.category === 'attachments' ||
        params.category === 'import_history' ||
        params.category === 'import_staging'
      ) {
        const tableCfg: Record<
          string,
          { table: string; dateCol: string; idCol: string; summaryCol: string; actorCol: string; hasIsDeleted: boolean; hasWo: boolean }
        > = {
          assignment_history: { table: 'assignment_history', dateCol: 'assigned_at', idCol: 'id', summaryCol: 'installer_name', actorCol: 'assigned_by', hasIsDeleted: true, hasWo: true },
          technical_reports: { table: 'technical_reports', dateCol: 'submitted_at', idCol: 'id', summaryCol: 'notes', actorCol: 'installer_name', hasIsDeleted: true, hasWo: true },
          ticket_messages: { table: 'ticket_messages', dateCol: 'created_at', idCol: 'id', summaryCol: 'message', actorCol: 'sender_name', hasIsDeleted: true, hasWo: true },
          attachments: { table: 'attachments', dateCol: 'uploaded_at', idCol: 'id', summaryCol: 'file_name', actorCol: 'sender_name', hasIsDeleted: true, hasWo: true },
          import_history: { table: 'import_history', dateCol: 'created_at', idCol: 'id', summaryCol: 'source_file', actorCol: 'imported_by', hasIsDeleted: true, hasWo: false },
          import_staging: { table: 'import_jobs', dateCol: 'created_at', idCol: 'id', summaryCol: 'source_file', actorCol: 'created_by', hasIsDeleted: false, hasWo: false }
        };
        const cfg = tableCfg[params.category];

        const buildCatQuery = (targetPage: number) => {
          let q = client.from(cfg.table).select('*', { count: 'exact' });
          if (cfg.hasIsDeleted) {
            if (deletionStatusFilter === 'active') q = q.eq('is_deleted', false);
            else if (deletionStatusFilter === 'soft_deleted') q = q.eq('is_deleted', true);
          }
          if (recordIdQ) {
            q = q.ilike(cfg.idCol, `%${escapePostgrestIlike(recordIdQ)}%`);
          }
          if (woNumberQ) {
            const pat = `%${escapePostgrestIlike(woNumberQ)}%`;
            if (cfg.hasWo) q = q.ilike('wo_number', pat);
            else q = q.ilike('import_name', pat);
          }
          if (summaryQ) {
            q = q.ilike(cfg.summaryCol, `%${escapePostgrestIlike(summaryQ)}%`);
          }
          if (actorQ) {
            q = q.ilike(cfg.actorCol, `%${escapePostgrestIlike(actorQ)}%`);
          }
          if (exactDateQ) {
            q = q.gte(cfg.dateCol, `${exactDateQ}T00:00:00.000Z`).lte(cfg.dateCol, `${exactDateQ}T23:59:59.999Z`);
          } else {
            if (dateFromQ) q = q.gte(cfg.dateCol, `${dateFromQ}T00:00:00.000Z`);
            if (dateToQ) q = q.lte(cfg.dateCol, `${dateToQ}T23:59:59.999Z`);
          }
          if (search) {
            const pat = quotePostgrestFilterVal(`%${escapePostgrestIlike(search)}%`);
            const ors = [`${cfg.idCol}.ilike.${pat}`, `${cfg.summaryCol}.ilike.${pat}`, `${cfg.actorCol}.ilike.${pat}`];
            if (cfg.hasWo) ors.push(`wo_number.ilike.${pat}`);
            q = q.or(ors.join(','));
          }

          q = q
            .order(cfg.dateCol, { ascending: sortBy === 'created_at' ? sortDir === 'asc' : false, nullsFirst: false })
            .order('id', { ascending: true });

          const from = (targetPage - 1) * pageSize;
          return q.range(from, from + pageSize - 1);
        };

        let { data, count, error } = await buildCatQuery(page);
        if (error) throw Object.assign(new Error(error.message), { statusCode: 503 });
        const total = Number(count ?? (data ? data.length : 0));
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        let safePage = Math.min(page, totalPages);
        if (safePage < page && total > 0) {
          const retryRes = await buildCatQuery(safePage);
          if (retryRes.error) throw Object.assign(new Error(retryRes.error.message), { statusCode: 503 });
          data = retryRes.data;
        } else if (total === 0) {
          safePage = 1;
        }

        const mapped = (data || []).map((r: any) => {
          if (params.category === 'assignment_history') {
            return {
              id: r.id,
              category: 'assignment_history',
              woNumber: r.wo_number || '',
              workOrderId: r.work_order_id || '',
              installerName: r.installer_name || '',
              assignedBy: r.assigned_by || '',
              contractor: r.contractor_name || '',
              area: r.area || '',
              reason: r.reason || '',
              createdAt: r.assigned_at || r.created_at,
              isDeleted: Boolean(r.is_deleted),
              deletedAt: r.deleted_at || null,
              deletedBy: r.deleted_by || null,
              deletionReason: r.deletion_reason || null,
              deletionStatus: r.is_deleted ? 'SOFT_DELETED' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(r)
            };
          }
          if (params.category === 'technical_reports') {
            return {
              id: r.id,
              category: 'technical_reports',
              woNumber: r.wo_number || '',
              workOrderId: r.work_order_id || r.ticket_id || '',
              installerName: r.installer_name || '',
              statusInstaller: r.status_installer || '',
              notes: r.notes || '',
              createdAt: r.submitted_at || r.created_at,
              isDeleted: Boolean(r.is_deleted),
              deletedAt: r.deleted_at || null,
              deletedBy: r.deleted_by || null,
              deletionReason: r.deletion_reason || null,
              deletionStatus: r.is_deleted ? 'SOFT_DELETED' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(r)
            };
          }
          if (params.category === 'ticket_messages') {
            return {
              id: r.id,
              category: 'ticket_messages',
              woNumber: r.wo_number || '',
              ticketId: r.ticket_id || '',
              senderName: r.sender_name || '',
              senderRole: r.sender_role || '',
              message: r.message || '',
              createdAt: r.created_at,
              isDeleted: Boolean(r.is_deleted),
              deletedAt: r.deleted_at || null,
              deletedBy: r.deleted_by || null,
              deletionReason: r.deletion_reason || null,
              deletionStatus: r.is_deleted ? 'SOFT_DELETED' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(r)
            };
          }
          if (params.category === 'attachments') {
            return {
              id: r.id,
              category: 'attachments',
              woNumber: r.wo_number || '',
              workOrderId: r.work_order_id || r.ticket_id || '',
              fileName: r.file_name || '',
              fileType: r.file_type || '',
              fileSize: r.file_size || 0,
              storageProvider: r.storage_provider || '',
              storagePath: r.storage_path || '',
              senderName: r.sender_name || '',
              createdAt: r.uploaded_at,
              isDeleted: Boolean(r.is_deleted),
              deletedAt: r.deleted_at || null,
              deletedBy: r.deleted_by || null,
              deletionReason: r.deletion_reason || null,
              deletionStatus: r.is_deleted ? 'SOFT_DELETED' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(r)
            };
          }
          if (params.category === 'import_history') {
            return {
              id: r.id,
              category: 'import_history',
              jobId: r.job_id || r.original_job_id || '',
              importName: r.import_name || '',
              sourceFile: r.source_file || '',
              importedBy: r.imported_by || '',
              totalRows: r.total_rows || 0,
              successCount: r.success_count || 0,
              duplicateCount: r.duplicate_count || 0,
              failedCount: r.failed_count || 0,
              status: r.status || '',
              createdAt: r.created_at,
              isDeleted: Boolean(r.is_deleted),
              deletedAt: r.deleted_at || null,
              deletedBy: r.deleted_by || null,
              deletionReason: r.deletion_reason || null,
              deletionStatus: r.is_deleted ? 'SOFT_DELETED' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(r)
            };
          }
          return {
            id: r.id,
            category: 'import_staging',
            importName: r.import_name || '',
            sourceFile: r.source_file || '',
            status: r.status || '',
            totalRows: r.total_rows || 0,
            stagedRows: r.staged_rows || 0,
            processedRows: r.processed_rows || 0,
            createdBy: r.created_by || '',
            createdAt: r.created_at,
            isLockedActive: ['staging', 'queued', 'processing'].includes(String(r.status || '').toLowerCase()),
            isDeleted: false,
            deletionStatus: ['staging', 'queued', 'processing'].includes(String(r.status || '').toLowerCase()) ? 'LOCKED_ACTIVE' : 'STAGED',
            rawDetail: sanitizeDeletionPayload(r)
          };
        });

        return {
          items: mapped,
          total,
          page: safePage,
          pageSize,
          totalPages
        };
      } else if (params.category === 'other_data') {
        const sub = params.subEntity || 'all';
        const items: any[] = [];
        if (sub === 'all' || sub === 'users') {
          const { data } = await client.from('users').select('id, name, username, email, role, contractor_name, area, active, is_deleted, deleted_at, deleted_by, deletion_reason, created_at').limit(1000);
          for (const u of data || []) {
            items.push({
              id: u.id,
              category: 'other_data',
              subEntity: 'users',
              label: u.name,
              identifier: u.username,
              role: u.role,
              contractor: u.contractor_name || '',
              area: u.area || '',
              active: Boolean(u.active),
              createdAt: u.created_at || null,
              isDeleted: Boolean(u.is_deleted),
              deletedAt: u.deleted_at || null,
              deletedBy: u.deleted_by || null,
              deletionReason: u.deletion_reason || null,
              deletionStatus: u.is_deleted ? 'SOFT_DELETED' : u.active === false ? 'INACTIVE' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(u)
            });
          }
        }
        if (sub === 'all' || sub === 'contractors') {
          const { data } = await client.from('contractors').select('*').limit(500);
          for (const c of data || []) {
            items.push({
              id: c.id,
              category: 'other_data',
              subEntity: 'contractors',
              label: c.name,
              identifier: c.code || c.id,
              createdAt: c.created_at || null,
              isDeleted: Boolean(c.is_deleted),
              deletedAt: c.deleted_at || null,
              deletedBy: c.deleted_by || null,
              deletionReason: c.deletion_reason || null,
              deletionStatus: c.is_deleted ? 'SOFT_DELETED' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(c)
            });
          }
        }
        if (sub === 'all' || sub === 'coverage_areas') {
          const { data } = await client.from('coverage_areas').select('*').limit(500);
          for (const a of data || []) {
            items.push({
              id: a.id,
              category: 'other_data',
              subEntity: 'coverage_areas',
              label: a.name,
              identifier: a.id,
              createdAt: a.created_at || null,
              isDeleted: Boolean(a.is_deleted),
              deletedAt: a.deleted_at || null,
              deletedBy: a.deleted_by || null,
              deletionReason: a.deletion_reason || null,
              deletionStatus: a.is_deleted ? 'SOFT_DELETED' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(a)
            });
          }
        }
        if (sub === 'all' || sub === 'wa_templates') {
          const { data } = await client.from('wa_templates').select('*').limit(500);
          for (const t of data || []) {
            items.push({
              id: t.id,
              category: 'other_data',
              subEntity: 'wa_templates',
              label: t.name,
              identifier: t.category || t.id,
              createdAt: t.created_at || null,
              isDeleted: Boolean(t.is_deleted),
              deletedAt: t.deleted_at || null,
              deletedBy: t.deleted_by || null,
              deletionReason: t.deletion_reason || null,
              deletionStatus: t.is_deleted ? 'SOFT_DELETED' : 'ACTIVE',
              rawDetail: sanitizeDeletionPayload(t)
            });
          }
        }
        rows = items;
      }
    }
  } else {
    ensureLocalCollections(bridge.db);
    if (params.category === 'work_orders') {
      rows = (bridge.db.tickets || []).map((t: any) => ({
        id: t.id,
        category: 'work_orders',
        woNumber: t.woNumber,
        customerId: t.idCustomer || t.customerId || '',
        customerName: t.customerName || '',
        appointmentDate: t.appointmentDate || '',
        contractor: t.contactorName || t.contractorName || '',
        area: t.area || '',
        installerName: t.installerName || '',
        assignmentStatus: t.installerName ? `Assigned (${t.installerName})` : (t.statusWOInstaller || 'Unassigned'),
        statusWOAgent: t.statusWOAgent || '',
        statusWOInstaller: t.statusWOInstaller || '',
        isArchived: Boolean(t.isArchived),
        isDeleted: Boolean(t.isDeleted),
        deletedAt: t.deletedAt || null,
        deletedBy: t.deletedBy || null,
        deletionReason: t.deletionReason || null,
        isProtected: isProtectedWorkOrder(t),
        deletionStatus: t.isDeleted ? 'SOFT_DELETED' : t.isArchived ? 'ARCHIVED' : 'ACTIVE',
        updatedAt: t.updatedAt || t.createdAt || null,
        createdAt: t.createdAt || null,
        rawDetail: sanitizeDeletionPayload(t)
      }));
    } else if (params.category === 'assignment_history') {
      rows = (bridge.db.assignmentHistory || []).map((r: any) => ({
        id: r.id,
        category: 'assignment_history',
        woNumber: r.woNumber || '',
        workOrderId: r.ticketId || r.workOrderId || '',
        installerName: r.installerName || r.newInstaller || '',
        assignedBy: r.assignedBy || '',
        contractor: r.contractorName || r.contractor || '',
        area: r.area || '',
        reason: r.reason || '',
        createdAt: r.assignedAt || r.timestamp || r.createdAt,
        isDeleted: Boolean(r.isDeleted),
        deletedAt: r.deletedAt || null,
        deletedBy: r.deletedBy || null,
        deletionReason: r.deletionReason || null,
        deletionStatus: r.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
        rawDetail: sanitizeDeletionPayload(r)
      }));
    } else if (params.category === 'technical_reports') {
      rows = getLocalTechnicalReports(bridge.db).map((r: any) => ({
        id: r.id,
        category: 'technical_reports',
        woNumber: r.woNumber || '',
        workOrderId: r.workOrderId || r.ticketId || '',
        installerName: r.installerName || '',
        statusInstaller: r.statusInstaller || '',
        notes: r.notes || '',
        createdAt: r.submittedAt || r.createdAt,
        isDeleted: Boolean(r.isDeleted),
        deletedAt: r.deletedAt || null,
        deletedBy: r.deletedBy || null,
        deletionReason: r.deletionReason || null,
        deletionStatus: r.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
        rawDetail: sanitizeDeletionPayload(r)
      }));
    } else if (params.category === 'ticket_messages') {
      rows = (bridge.db.ticketMessages || []).map((m: any) => ({
        id: m.id,
        category: 'ticket_messages',
        woNumber: m.woNumber || '',
        ticketId: m.ticketId || '',
        senderName: m.senderName || '',
        senderRole: m.senderRole || '',
        message: m.message || m.text || '',
        createdAt: m.timestamp || m.createdAt,
        isDeleted: Boolean(m.isDeleted),
        deletedAt: m.deletedAt || null,
        deletedBy: m.deletedBy || null,
        deletionReason: m.deletionReason || null,
        deletionStatus: m.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
        rawDetail: sanitizeDeletionPayload(m)
      }));
    } else if (params.category === 'attachments') {
      rows = getLocalAttachments(bridge.db).map((a: any) => ({
        id: a.id,
        category: 'attachments',
        woNumber: a.woNumber || '',
        workOrderId: a.workOrderId || a.ticketId || '',
        fileName: a.fileName || '',
        fileType: a.fileType || '',
        fileSize: a.fileSize || 0,
        storageProvider: a.storageProvider || '',
        storagePath: a.storagePath || '',
        senderName: a.senderName || '',
        createdAt: a.uploadedAt,
        isDeleted: Boolean(a.isDeleted),
        deletedAt: a.deletedAt || null,
        deletedBy: a.deletedBy || null,
        deletionReason: a.deletionReason || null,
        deletionStatus: a.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
        rawDetail: sanitizeDeletionPayload(a)
      }));
    } else if (params.category === 'import_history') {
      rows = getLocalImportHistory(bridge.db).map((h: any) => ({
        id: h.id,
        category: 'import_history',
        jobId: h.jobId || h.originalJobId || '',
        importName: h.importName || '',
        sourceFile: h.sourceFile || '',
        importedBy: h.importedBy || '',
        totalRows: h.totalRows || 0,
        successCount: h.successCount || 0,
        duplicateCount: h.duplicateCount || 0,
        failedCount: h.failedCount || 0,
        status: h.status || '',
        createdAt: h.createdAt,
        isDeleted: Boolean(h.isDeleted),
        deletedAt: h.deletedAt || null,
        deletedBy: h.deletedBy || null,
        deletionReason: h.deletionReason || null,
        deletionStatus: h.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
        rawDetail: sanitizeDeletionPayload(h)
      }));
    } else if (params.category === 'import_staging') {
      rows = (bridge.db.importJobs || []).map((j: any) => ({
        id: j.id,
        category: 'import_staging',
        importName: j.importName || '',
        sourceFile: j.sourceFile || '',
        status: j.status || 'staging',
        totalRows: j.totalRows || 0,
        stagedRows: j.stagedRows || 0,
        processedRows: j.processedRows || 0,
        createdBy: j.createdBy || '',
        createdAt: j.createdAt,
        isLockedActive: ['staging', 'queued', 'processing'].includes(String(j.status || '').toLowerCase()),
        isDeleted: false,
        deletionStatus: ['staging', 'queued', 'processing'].includes(String(j.status || '').toLowerCase()) ? 'LOCKED_ACTIVE' : 'STAGED',
        rawDetail: sanitizeDeletionPayload(j)
      }));
    } else if (params.category === 'other_data') {
      const sub = params.subEntity || 'all';
      const items: any[] = [];
      if (sub === 'all' || sub === 'users') {
        for (const u of bridge.db.users || []) {
          items.push({
            id: u.id,
            category: 'other_data',
            subEntity: 'users',
            label: u.name,
            identifier: u.username,
            role: u.role,
            contractor: u.contractor || '',
            area: u.area || '',
            active: u.active !== false,
            createdAt: u.createdAt || null,
            isDeleted: Boolean(u.isDeleted),
            deletedAt: u.deletedAt || null,
            deletedBy: u.deletedBy || null,
            deletionReason: u.deletionReason || null,
            deletionStatus: u.isDeleted ? 'SOFT_DELETED' : u.active === false ? 'INACTIVE' : 'ACTIVE',
            rawDetail: sanitizeDeletionPayload(u)
          });
        }
      }
      if (sub === 'all' || sub === 'contractors') {
        for (const c of bridge.db.contractors || []) {
          items.push({
            id: c.id,
            category: 'other_data',
            subEntity: 'contractors',
            label: c.name,
            identifier: c.code || c.id,
            createdAt: c.createdAt || null,
            isDeleted: Boolean(c.isDeleted),
            deletedAt: c.deletedAt || null,
            deletedBy: c.deletedBy || null,
            deletionReason: c.deletionReason || null,
            deletionStatus: c.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
            rawDetail: sanitizeDeletionPayload(c)
          });
        }
      }
      if (sub === 'all' || sub === 'coverage_areas') {
        for (const a of bridge.db.coverageAreas || []) {
          items.push({
            id: a.id,
            category: 'other_data',
            subEntity: 'coverage_areas',
            label: a.name,
            identifier: a.id,
            createdAt: a.createdAt || null,
            isDeleted: Boolean(a.isDeleted),
            deletedAt: a.deletedAt || null,
            deletedBy: a.deletedBy || null,
            deletionReason: a.deletionReason || null,
            deletionStatus: a.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
            rawDetail: sanitizeDeletionPayload(a)
          });
        }
      }
      if (sub === 'all' || sub === 'wa_templates') {
        for (const t of bridge.db.templates || []) {
          items.push({
            id: t.id,
            category: 'other_data',
            subEntity: 'wa_templates',
            label: t.name,
            identifier: t.category || t.id,
            createdAt: t.createdAt || null,
            isDeleted: Boolean(t.isDeleted),
            deletedAt: t.deletedAt || null,
            deletedBy: t.deletedBy || null,
            deletionReason: t.deletionReason || null,
            deletionStatus: t.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
            rawDetail: sanitizeDeletionPayload(t)
          });
        }
      }
      if (sub === 'all' || sub === 'droplist_items') {
        for (const d of getLocalDroplistItems(bridge.db)) {
          items.push({
            ...d,
            category: 'other_data',
            subEntity: 'droplist_items',
            identifier: d.code || d.itemType,
            deletionStatus: d.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
            rawDetail: sanitizeDeletionPayload(d)
          });
        }
      }
      if (sub === 'all' || sub === 'chat_categories') {
        for (const cc of getLocalChatCategories(bridge.db)) {
          items.push({
            ...cc,
            category: 'other_data',
            subEntity: 'chat_categories',
            identifier: cc.id,
            deletionStatus: cc.isDeleted ? 'SOFT_DELETED' : 'ACTIVE',
            rawDetail: sanitizeDeletionPayload(cc)
          });
        }
      }
      rows = items;
    }
  }

  // Filter rows (Local JSON / test store & multi-table other_data)
  const filtered = rows.filter(r => {
    if (deletionStatusFilter === 'active' && r.isDeleted) return false;
    if (deletionStatusFilter === 'soft_deleted' && !r.isDeleted) return false;

    if (woNumberQ) {
      const woHay = String(r.woNumber || r.importName || '').toLowerCase();
      if (!woHay.includes(woNumberQ.toLowerCase())) return false;
    }
    if (customerIdQ) {
      if (!String(r.customerId || '').toLowerCase().includes(customerIdQ.toLowerCase())) return false;
    }
    if (customerNameQ) {
      if (!String(r.customerName || '').toLowerCase().includes(customerNameQ.toLowerCase())) return false;
    }
    if (recordIdQ) {
      if (!String(r.id || '').toLowerCase().includes(recordIdQ.toLowerCase())) return false;
    }
    if (summaryQ) {
      const sumHay = [r.label, r.fileName, r.importName, r.sourceFile, r.message, r.notes, r.installerName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!sumHay.includes(summaryQ.toLowerCase())) return false;
    }
    if (actorQ) {
      const actHay = [r.senderName, r.importedBy, r.assignedBy, r.createdBy, r.role]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!actHay.includes(actorQ.toLowerCase())) return false;
    }
    if (contractorQ && contractorQ !== 'all') {
      if (String(r.contractor || '').trim().toLowerCase() !== contractorQ.trim().toLowerCase()) return false;
    }
    if (areaQ && areaQ !== 'all') {
      if (String(r.area || '').trim().toLowerCase() !== areaQ.trim().toLowerCase()) return false;
    }
    if (assignmentStatusQ && assignmentStatusQ !== 'all') {
      const lowerAssign = assignmentStatusQ.toLowerCase();
      const hasInstaller = Boolean(String(r.installerName || '').trim());
      if (lowerAssign === 'assigned') {
        if (!hasInstaller) return false;
      } else if (lowerAssign === 'unassigned') {
        if (hasInstaller) return false;
      } else {
        const sVal = String(r.statusWOInstaller || r.assignmentStatus || '').toLowerCase();
        if (!sVal.includes(lowerAssign)) return false;
      }
    }
    if (exactDateQ) {
      const d = String((params.category === 'work_orders' ? r.appointmentDate : r.createdAt) || '').slice(0, 10);
      if (d !== exactDateQ) return false;
    } else if (dateFromQ || dateToQ) {
      const d = String((params.category === 'work_orders' ? r.appointmentDate : r.createdAt) || '').slice(0, 10);
      if (!d) return false;
      if (dateFromQ && d < dateFromQ) return false;
      if (dateToQ && d > dateToQ) return false;
    }
    if (params.status && params.status !== 'all') {
      const sTarget = params.status.toLowerCase();
      const sVal = String(r.statusWOInstaller || r.status || r.deletionStatus || '').toLowerCase();
      if (!sVal.includes(sTarget)) return false;
    }
    if (search) {
      const hay = [
        r.id,
        r.woNumber,
        r.customerId,
        r.customerName,
        r.appointmentDate,
        r.contractor,
        r.area,
        r.installerName,
        r.label,
        r.identifier,
        r.fileName,
        r.sourceFile,
        r.importName,
        r.senderName,
        r.message,
        r.reason
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Sort before pagination (NULLS LAST for appointment_date & created_at)
  const sorted = filtered.slice().sort((a, b) => {
    if (sortBy === 'appointment_date') {
      return compareDatesNullsLast(a.appointmentDate, b.appointmentDate, sortDir, a.updatedAt || a.createdAt, b.updatedAt || b.createdAt, a.id, b.id);
    }
    if (sortBy === 'created_at') {
      return compareDatesNullsLast(a.createdAt, b.createdAt, sortDir, a.updatedAt, b.updatedAt, a.id, b.id);
    }
    const ta = Date.parse(String(a.updatedAt || a.createdAt || '')) || 0;
    const tb = Date.parse(String(b.updatedAt || b.createdAt || '')) || 0;
    if (ta !== tb) return tb - ta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const items = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages
  };
}

export async function getDeletionFacets(
  bridge: LocalStoreBridge,
  actorRole: string,
  category: DeletionCategory
): Promise<{
  contractors: string[];
  areas: string[];
  assignmentStatuses: string[];
}> {
  if (!isCategoryAllowedForRole(actorRole, category)) {
    return { contractors: [], areas: [], assignmentStatuses: [] };
  }
  const contractorSet = new Set<string>();
  const areaSet = new Set<string>();
  const statusSet = new Set<string>(['Assigned', 'Unassigned']);

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client && category === 'work_orders') {
      try {
        const [cRes, aRes, woSampleRes] = await Promise.all([
          client.from('contractors').select('name').limit(300),
          client.from('coverage_areas').select('name').limit(300),
          client.from('work_orders').select('contactor_name, contractor_name, area, status_wo_installer').limit(1000)
        ]);
        for (const r of cRes.data || []) {
          const n = String(r?.name || '').trim();
          if (n) contractorSet.add(n);
        }
        for (const r of aRes.data || []) {
          const n = String(r?.name || '').trim();
          if (n) areaSet.add(n);
        }
        for (const r of woSampleRes.data || []) {
          const c = String(r?.contactor_name || r?.contractor_name || '').trim();
          if (c) contractorSet.add(c);
          const a = String(r?.area || '').trim();
          if (a) areaSet.add(a);
          const s = String(r?.status_wo_installer || '').trim();
          if (s) statusSet.add(s);
        }
      } catch {
        // return collected facets cleanly
      }
    }
  } else {
    ensureLocalCollections(bridge.db);
    for (const c of bridge.db.contractors || []) {
      const n = String(c?.name || '').trim();
      if (n) contractorSet.add(n);
    }
    for (const a of bridge.db.coverageAreas || []) {
      const n = String(a?.name || '').trim();
      if (n) areaSet.add(n);
    }
    for (const t of bridge.db.tickets || []) {
      const c = String(t?.contactorName || t?.contractorName || '').trim();
      if (c) contractorSet.add(c);
      const a = String(t?.area || '').trim();
      if (a) areaSet.add(a);
      const s = String(t?.statusWOInstaller || '').trim();
      if (s) statusSet.add(s);
    }
  }

  return {
    contractors: Array.from(contractorSet).sort((a, b) => a.localeCompare(b)),
    areas: Array.from(areaSet).sort((a, b) => a.localeCompare(b)),
    assignmentStatuses: Array.from(statusSet).sort((a, b) => a.localeCompare(b))
  };
}

export async function inspectWoDependenciesBatch(
  bridge: LocalStoreBridge,
  woIds: string[]
): Promise<{
  items: WoDependencySummary[];
  blockedCount: number;
  eligibleCount: number;
}> {
  const uniqueIds = Array.from(new Set(woIds.map(x => String(x || '').trim()).filter(Boolean))).slice(0, 100);
  const items: WoDependencySummary[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < uniqueIds.length; i += CONCURRENCY) {
    const chunk = uniqueIds.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(id => inspectWoDependencies(bridge, id)));
    items.push(...chunkResults);
  }
  const blockedCount = items.filter(d => !d.found || !d.canPermanentDelete).length;
  const eligibleCount = items.filter(d => d.found && d.canPermanentDelete).length;
  return { items, blockedCount, eligibleCount };
}

export async function listDeletionHistory(
  bridge: LocalStoreBridge,
  params: {
    search?: string;
    txIdQuery?: string;
    woOrRecordQuery?: string;
    reasonQuery?: string;
    category?: string;
    deletionType?: string;
    actor?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    sortDir?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  }
) {
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(100, Math.max(5, Number(params.pageSize || 25)));
  const search = sanitizeTextQuery(params.search).toLowerCase();
  const txIdQ = sanitizeTextQuery(params.txIdQuery).toLowerCase();
  const woOrRecordQ = sanitizeTextQuery(params.woOrRecordQuery).toLowerCase();
  const reasonQ = sanitizeTextQuery(params.reasonQuery).toLowerCase();
  const actorQ = sanitizeTextQuery(params.actor);
  const dateFromQ = sanitizeDateOnly(params.dateFrom);
  const dateToQ = sanitizeDateOnly(params.dateTo);
  const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' ? 'asc' : 'desc';

  let logs: DeletionLogRecord[] = [];
  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        let q = client.from('deletion_logs').select('*');
        if (params.category && params.category !== 'all') q = q.eq('category', params.category);
        if (params.deletionType && params.deletionType !== 'all') q = q.eq('deletion_type', params.deletionType);
        if (params.status && params.status !== 'all') q = q.eq('status', params.status);
        if (dateFromQ) q = q.gte('created_at', `${dateFromQ}T00:00:00.000Z`);
        if (dateToQ) q = q.lte('created_at', `${dateToQ}T23:59:59.999Z`);
        const { data, error } = await q.order('created_at', { ascending: sortDir === 'asc' }).limit(2000);
        if (!error && Array.isArray(data)) {
          logs = data.map((r: any) => ({
            id: r.id,
            transactionId: r.transaction_id,
            deletionType: r.deletion_type,
            category: r.category,
            sourceTable: r.source_table,
            recordId: r.record_id,
            woNumber: r.wo_number,
            actorUserId: r.actor_user_id,
            actorName: r.actor_name,
            actorRole: r.actor_role,
            reason: r.reason,
            relatedCounts: r.related_counts || {},
            status: r.status,
            errorMessage: r.error_message,
            metadata: sanitizeDeletionPayload(r.metadata || {}),
            createdAt: r.created_at
          }));
        }
      } catch {
        // fallback below if local store also present
      }
    }
  }

  if (logs.length === 0 && bridge.isLocalJsonModeAllowed()) {
    ensureLocalCollections(bridge.db);
    logs = (bridge.db.deletionLogs || []).map((l: any) => ({
      ...l,
      metadata: sanitizeDeletionPayload(l.metadata || {})
    }));
  }

  const filtered = logs.filter(l => {
    if (params.category && params.category !== 'all' && l.category !== params.category) return false;
    if (params.deletionType && params.deletionType !== 'all' && l.deletionType !== params.deletionType) return false;
    if (params.status && params.status !== 'all' && l.status !== params.status) return false;
    if (actorQ && actorQ !== 'all') {
      const actHay = `${l.actorName || ''} ${l.actorRole || ''}`.toLowerCase();
      if (!actHay.includes(actorQ.toLowerCase())) return false;
    }
    if (txIdQ) {
      if (!String(l.transactionId || '').toLowerCase().includes(txIdQ)) return false;
    }
    if (woOrRecordQ) {
      const hay = `${l.woNumber || ''} ${l.recordId || ''}`.toLowerCase();
      if (!hay.includes(woOrRecordQ)) return false;
    }
    if (reasonQ) {
      const hay = `${l.reason || ''} ${l.errorMessage || ''}`.toLowerCase();
      if (!hay.includes(reasonQ)) return false;
    }
    if (dateFromQ) {
      const d = String(l.createdAt || '').slice(0, 10);
      if (!d || d < dateFromQ) return false;
    }
    if (dateToQ) {
      const d = String(l.createdAt || '').slice(0, 10);
      if (!d || d > dateToQ) return false;
    }
    if (search) {
      const hay = [l.transactionId, l.recordId, l.woNumber, l.actorName, l.actorRole, l.reason, l.errorMessage, l.sourceTable]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const sorted = filtered.slice().sort((a, b) => compareDatesNullsLast(a.createdAt, b.createdAt, sortDir, a.createdAt, b.createdAt, a.id, b.id));

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  return {
    logs: pageItems,
    items: pageItems,
    total,
    page: safePage,
    pageSize,
    totalPages
  };
}

export async function executeSoftDeleteBatch(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  targets: DeletionTargetInput[],
  reason: string
): Promise<{
  success: boolean;
  transactionId: string;
  succeeded: any[];
  failed: Array<{ recordId: string; category: string; code: string; error: string }>;
}> {
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    throw Object.assign(new Error('Alasan penghapusan wajib diisi minimal 5 karakter.'), {
      statusCode: 400,
      code: 'INVALID_REASON'
    });
  }

  const txId = makeTxId('tx_sd');
  const succeeded: any[] = [];
  const failed: Array<{ recordId: string; category: string; code: string; error: string }> = [];

  for (const target of targets) {
    if (!isCategoryAllowedForRole(actor.role, target.category, target.subEntity)) {
      failed.push({
        recordId: target.recordId,
        category: target.category,
        code: 'FORBIDDEN_ROLE',
        error: `Role ${actor.role} tidak memiliki izin soft delete pada kategori ${target.category}.`
      });
      continue;
    }

    const lockKey = `${target.category}:${target.recordId}`;
    if (!acquireRecordLock(lockKey, txId, actor.name)) {
      await recordDeletionLog(bridge, {
        transactionId: txId,
        deletionType: 'soft_delete',
        category: target.category,
        sourceTable: resolveSourceTable(target.category, target.subEntity),
        recordId: target.recordId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        reason: cleanReason,
        relatedCounts: {},
        status: 'rejected',
        errorMessage: 'CONCURRENT_DELETION_LOCKED: Record sedang diproses transaksi penghapusan lain.'
      });
      failed.push({
        recordId: target.recordId,
        category: target.category,
        code: 'CONCURRENT_DELETION_LOCKED',
        error: 'Record sedang diproses penghapusan secara bersamaan oleh transaksi lain.'
      });
      continue;
    }

    try {
      const res = await executeSingleSoftDelete(bridge, actor, target, cleanReason, txId);
      if (res.success) {
        succeeded.push(res.data);
      } else {
        failed.push({
          recordId: target.recordId,
          category: target.category,
          code: res.code || 'SOFT_DELETE_FAILED',
          error: res.error || 'Gagal melakukan soft delete.'
        });
      }
    } finally {
      releaseRecordLock(lockKey, txId);
    }
  }

  return {
    success: failed.length === 0 && succeeded.length > 0,
    transactionId: txId,
    succeeded,
    failed
  };
}

async function executeSingleSoftDelete(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  target: DeletionTargetInput,
  cleanReason: string,
  txId: string
): Promise<{ success: boolean; data?: any; code?: string; error?: string }> {
  const { category, recordId, subEntity } = target;
  const sourceTable = resolveSourceTable(category, subEntity);
  const nowIso = new Date().toISOString();

  if (category === 'import_staging') {
    return {
      success: false,
      code: 'SOFT_DELETE_UNSUPPORTED_FOR_STAGING',
      error: 'Import Staging Data tidak menggunakan soft delete. Gunakan tab Permanent Delete (Superadmin) pada staging yang tidak aktif.'
    };
  }

  if (category === 'other_data' && subEntity === 'users' && recordId === actor.id) {
    return {
      success: false,
      code: 'SELF_DELETE_FORBIDDEN',
      error: 'Anda tidak dapat menghapus akun Anda sendiri saat sedang login.'
    };
  }

  // Supabase Path
  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (!client) {
      return { success: false, code: 'DATABASE_UNAVAILABLE', error: 'Supabase client tidak tersedia.' };
    }

    if (category === 'work_orders') {
      const rpcRes = await client.rpc('morajaws_soft_delete_wo_tx', {
        p_wo_id: recordId,
        p_reason: cleanReason,
        p_actor_id: actor.id,
        p_actor_name: actor.name,
        p_actor_role: actor.role,
        p_transaction_id: txId
      });

      if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
        const d: any = rpcRes.data;
        if (!d.success) {
          return { success: false, code: d.code || 'SOFT_DELETE_REJECTED', error: d.message || 'Soft delete ditolak.' };
        }
        const ticket = postgresRowToTicket(d.workOrder);
        bridge.broadcastSupabaseChange('work_orders', 'DELETE', ticket);
        return { success: true, data: ticket };
      }

      // If RPC missing on staging, perform guarded check + update + deletion_log
      const deps = await inspectWoDependencies(bridge, recordId);
      if (!deps.found) return { success: false, code: 'NOT_FOUND', error: 'Work Order tidak ditemukan.' };
      if (deps.isProtected) return { success: false, code: 'PROTECTED_RECORD', error: 'Record WO produksi dilindungi.' };
      if (deps.activeImportLock) return { success: false, code: 'ACTIVE_IMPORT_IN_PROGRESS', error: 'WO terkait import aktif.' };

      const { data: upData, error: upErr } = await client
        .from('work_orders')
        .update({
          is_deleted: true,
          deleted_at: nowIso,
          deleted_by: actor.name,
          deletion_reason: cleanReason,
          updated_at: nowIso,
          updated_by: actor.name
        })
        .eq('id', deps.id)
        .select('*');

      if (upErr || !upData?.length) {
        const errInfo = classifySupabaseError(upErr);
        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'soft_delete',
          category,
          sourceTable,
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'failed',
          errorMessage: errInfo.message
        });
        return { success: false, code: errInfo.code, error: errInfo.message };
      }

      const ticket = postgresRowToTicket(upData[0]);
      await recordDeletionLog(bridge, {
        transactionId: txId,
        deletionType: 'soft_delete',
        category,
        sourceTable,
        recordId: deps.id,
        woNumber: deps.woNumber,
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        reason: cleanReason,
        relatedCounts: deps.counts,
        status: 'success'
      });
      await bridge.logServerAuditAsync('WO Soft Deleted (Centralized)', 'work_order', deps.id, `WO ${deps.woNumber} di-soft-delete oleh ${actor.name}`, actor);
      bridge.broadcastSupabaseChange('work_orders', 'DELETE', ticket);
      return { success: true, data: ticket };
    }

    // Auxiliary tables in Supabase
    const tableMap: Record<string, string> = {
      assignment_history: 'assignment_history',
      technical_reports: 'technical_reports',
      ticket_messages: 'ticket_messages',
      attachments: 'attachments',
      import_history: 'import_history',
      users: 'users',
      contractors: 'contractors',
      coverage_areas: 'coverage_areas',
      wa_templates: 'wa_templates'
    };
    const tbl = category === 'other_data' ? tableMap[subEntity || ''] : tableMap[category];
    if (!tbl) {
      return { success: false, code: 'UNSUPPORTED_SUB_ENTITY', error: 'Sub-entitas tidak mendukung soft delete di Supabase.' };
    }
    const patch: Record<string, any> = {
      is_deleted: true,
      deleted_at: nowIso,
      deleted_by: actor.name,
      deletion_reason: cleanReason
    };
    if (tbl === 'users') patch.active = false;

    const { data, error } = await client.from(tbl).update(patch).eq('id', recordId).select('*');
    if (error || !data?.length) {
      const msg = error ? classifySupabaseError(error).message : `Record "${recordId}" tidak ditemukan di ${tbl}.`;
      await recordDeletionLog(bridge, {
        transactionId: txId,
        deletionType: 'soft_delete',
        category,
        sourceTable: tbl,
        recordId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        reason: cleanReason,
        relatedCounts: {},
        status: 'failed',
        errorMessage: msg
      });
      return { success: false, code: error ? 'SUPABASE_ERROR' : 'NOT_FOUND', error: msg };
    }

    if (tbl === 'users') bridge.revokeUserSessions(recordId);

    await recordDeletionLog(bridge, {
      transactionId: txId,
      deletionType: 'soft_delete',
      category,
      sourceTable: tbl,
      recordId,
      woNumber: data[0]?.wo_number || null,
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      reason: cleanReason,
      relatedCounts: {},
      status: 'success'
    });
    await bridge.logServerAuditAsync(`Centralized Soft Delete (${tbl})`, tbl, recordId, `${tbl} ${recordId} di-soft-delete oleh ${actor.name}. Alasan: ${cleanReason}`, actor);
    return { success: true, data: sanitizeDeletionPayload(data[0]) };
  }

  // Local JSON Mode (with explicit rollback snapshot!)
  if (!bridge.isLocalJsonModeAllowed()) {
    return { success: false, code: 'DATABASE_UNAVAILABLE', error: 'Database tidak tersedia.' };
  }

  ensureLocalCollections(bridge.db);
  const snapshotTickets = JSON.stringify(bridge.db.tickets);
  const snapshotAssign = JSON.stringify(bridge.db.assignmentHistory);
  const snapshotReports = JSON.stringify(bridge.db.technicalReports);
  const snapshotMsgs = JSON.stringify(bridge.db.ticketMessages);
  const snapshotAtt = JSON.stringify(bridge.db.attachments);
  const snapshotStorage = JSON.stringify(bridge.db.storageMetadata);
  const snapshotImpHist = JSON.stringify(bridge.db.importHistory);
  const snapshotUsers = JSON.stringify(bridge.db.users);
  const snapshotContractors = JSON.stringify(bridge.db.contractors);
  const snapshotAreas = JSON.stringify(bridge.db.coverageAreas);
  const snapshotTpls = JSON.stringify(bridge.db.templates);
  const snapshotSettings = JSON.stringify(bridge.db.appSettings);

  const rollbackLocal = () => {
    bridge.db.tickets = JSON.parse(snapshotTickets);
    bridge.db.assignmentHistory = JSON.parse(snapshotAssign);
    bridge.db.technicalReports = JSON.parse(snapshotReports);
    bridge.db.ticketMessages = JSON.parse(snapshotMsgs);
    bridge.db.attachments = JSON.parse(snapshotAtt);
    bridge.db.storageMetadata = JSON.parse(snapshotStorage);
    bridge.db.importHistory = JSON.parse(snapshotImpHist);
    bridge.db.users = JSON.parse(snapshotUsers);
    bridge.db.contractors = JSON.parse(snapshotContractors);
    bridge.db.coverageAreas = JSON.parse(snapshotAreas);
    bridge.db.templates = JSON.parse(snapshotTpls);
    bridge.db.appSettings = JSON.parse(snapshotSettings);
  };

  let woNumber: string | null = null;
  let relatedCounts: Record<string, number> = {};
  let mutatedRecord: any = null;

  try {
    if (category === 'work_orders') {
      const deps = await inspectWoDependencies(bridge, recordId);
      if (!deps.found) return { success: false, code: 'NOT_FOUND', error: `Work Order "${recordId}" tidak ditemukan.` };
      if (deps.isProtected) {
        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'soft_delete',
          category,
          sourceTable,
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'rejected',
          errorMessage: 'PROTECTED_RECORD: Record WO produksi dilindungi.'
        });
        return { success: false, code: 'PROTECTED_RECORD', error: 'Record WO produksi dilindungi secara mutlak.' };
      }
      if (deps.activeImportLock) {
        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'soft_delete',
          category,
          sourceTable,
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'rejected',
          errorMessage: 'ACTIVE_IMPORT_IN_PROGRESS: Impor WO masih aktif berjalan.'
        });
        return { success: false, code: 'ACTIVE_IMPORT_IN_PROGRESS', error: 'Tidak dapat menghapus WO saat proses import batch terkait masih berjalan.' };
      }
      const targetTicket = bridge.db.tickets.find((t: any) => String(t.id) === deps.id);
      if (!targetTicket) return { success: false, code: 'NOT_FOUND', error: 'Work Order tidak ditemukan.' };
      if (targetTicket.isDeleted) return { success: false, code: 'ALREADY_SOFT_DELETED', error: `WO ${targetTicket.woNumber} sudah berstatus soft delete.` };

      targetTicket.isDeleted = true;
      targetTicket.deletedAt = nowIso;
      targetTicket.deletedBy = actor.name;
      targetTicket.deletionReason = cleanReason;
      targetTicket.updatedAt = nowIso;
      targetTicket.updatedBy = actor.name;
      woNumber = targetTicket.woNumber;
      relatedCounts = deps.counts;
      mutatedRecord = targetTicket;
    } else if (category === 'assignment_history') {
      const rec = bridge.db.assignmentHistory.find((r: any) => String(r.id) === recordId);
      if (!rec) return { success: false, code: 'NOT_FOUND', error: 'Assignment history tidak ditemukan.' };
      rec.isDeleted = true;
      rec.deletedAt = nowIso;
      rec.deletedBy = actor.name;
      rec.deletionReason = cleanReason;
      woNumber = rec.woNumber || null;
      mutatedRecord = rec;
    } else if (category === 'technical_reports') {
      const explicit = bridge.db.technicalReports.find((r: any) => String(r.id) === recordId);
      if (explicit) {
        explicit.isDeleted = true;
        explicit.deletedAt = nowIso;
        explicit.deletedBy = actor.name;
        explicit.deletionReason = cleanReason;
        woNumber = explicit.woNumber || null;
        mutatedRecord = explicit;
      } else {
        const ticketId = recordId.startsWith('tr_') ? recordId.slice(3) : recordId;
        const t = bridge.db.tickets.find((x: any) => String(x.id) === ticketId && x.technicalReport);
        if (!t) return { success: false, code: 'NOT_FOUND', error: 'Technical report tidak ditemukan.' };
        t.technicalReport.isDeleted = true;
        t.technicalReport.deletedAt = nowIso;
        t.technicalReport.deletedBy = actor.name;
        t.technicalReport.deletionReason = cleanReason;
        woNumber = t.woNumber;
        mutatedRecord = { id: recordId, workOrderId: t.id, woNumber: t.woNumber, isDeleted: true };
      }
    } else if (category === 'ticket_messages') {
      const msg = bridge.db.ticketMessages.find((m: any) => String(m.id) === recordId);
      if (!msg) return { success: false, code: 'NOT_FOUND', error: 'Pesan LiveChat tidak ditemukan.' };
      msg.isDeleted = true;
      msg.deletedAt = nowIso;
      msg.deletedBy = actor.name;
      msg.deletionReason = cleanReason;
      woNumber = msg.woNumber || null;
      mutatedRecord = msg;
    } else if (category === 'attachments') {
      const att = bridge.db.attachments.find((a: any) => String(a.id) === recordId) ||
        bridge.db.storageMetadata.find((m: any) => String(m.id || m.fileId || m.filePath) === recordId);
      if (!att) return { success: false, code: 'NOT_FOUND', error: 'Attachment tidak ditemukan.' };
      att.isDeleted = true;
      att.deletedAt = nowIso;
      att.deletedBy = actor.name;
      att.deletionReason = cleanReason;
      woNumber = att.woNumber || null;
      mutatedRecord = att;
    } else if (category === 'import_history') {
      const ih = bridge.db.importHistory.find((h: any) => String(h.id) === recordId) ||
        bridge.db.auditLogs.find((l: any) => l.entity === 'import_batch' && String(l.id) === recordId);
      if (!ih) return { success: false, code: 'NOT_FOUND', error: 'Import history tidak ditemukan.' };
      ih.isDeleted = true;
      ih.deletedAt = nowIso;
      ih.deletedBy = actor.name;
      ih.deletionReason = cleanReason;
      mutatedRecord = ih;
    } else if (category === 'other_data') {
      if (subEntity === 'users') {
        const u = bridge.db.users.find((x: any) => String(x.id) === recordId);
        if (!u) return { success: false, code: 'NOT_FOUND', error: 'User tidak ditemukan.' };
        u.isDeleted = true;
        u.active = false;
        u.sessionVersion = (u.sessionVersion || 1) + 1;
        u.deletedAt = nowIso;
        u.deletedBy = actor.name;
        u.deletionReason = cleanReason;
        bridge.revokeUserSessions(u.id);
        mutatedRecord = sanitizeDeletionPayload(u);
      } else if (subEntity === 'contractors') {
        const c = bridge.db.contractors.find((x: any) => String(x.id) === recordId);
        if (!c) return { success: false, code: 'NOT_FOUND', error: 'Kontraktor tidak ditemukan.' };
        c.isDeleted = true;
        c.deletedAt = nowIso;
        c.deletedBy = actor.name;
        c.deletionReason = cleanReason;
        mutatedRecord = c;
      } else if (subEntity === 'coverage_areas') {
        const a = bridge.db.coverageAreas.find((x: any) => String(x.id) === recordId);
        if (!a) return { success: false, code: 'NOT_FOUND', error: 'Area tidak ditemukan.' };
        a.isDeleted = true;
        a.deletedAt = nowIso;
        a.deletedBy = actor.name;
        a.deletionReason = cleanReason;
        mutatedRecord = a;
      } else if (subEntity === 'wa_templates') {
        const t = bridge.db.templates.find((x: any) => String(x.id) === recordId);
        if (!t) return { success: false, code: 'NOT_FOUND', error: 'Template WhatsApp tidak ditemukan.' };
        t.isDeleted = true;
        t.deletedAt = nowIso;
        t.deletedBy = actor.name;
        t.deletionReason = cleanReason;
        mutatedRecord = t;
      } else if (subEntity === 'droplist_items') {
        let found = false;
        if (recordId.startsWith('status:') && Array.isArray(bridge.db.appSettings?.hierarchical_droplists)) {
          const stId = recordId.slice(7);
          const st = bridge.db.appSettings.hierarchical_droplists.find((s: any) => String(s.id) === stId);
          if (st) {
            st.isDeleted = true;
            st.deletedAt = nowIso;
            st.deletedBy = actor.name;
            st.deletionReason = cleanReason;
            found = true;
            mutatedRecord = st;
          }
        } else if (recordId.startsWith('reason:') && Array.isArray(bridge.db.appSettings?.hierarchical_droplists)) {
          const [, stId, rId] = recordId.split(':');
          const st = bridge.db.appSettings.hierarchical_droplists.find((s: any) => String(s.id) === stId);
          const r = st?.reasons?.find((x: any) => String(x.id) === rId);
          if (r) {
            r.isDeleted = true;
            r.deletedAt = nowIso;
            r.deletedBy = actor.name;
            r.deletionReason = cleanReason;
            found = true;
            mutatedRecord = r;
          }
        } else if (recordId.startsWith('static:') && Array.isArray(bridge.db.appSettings?.static_droplist_categories)) {
          const [, catId, itemId] = recordId.split(':');
          const cat = bridge.db.appSettings.static_droplist_categories.find((c: any) => String(c.id) === catId);
          const item = cat?.items?.find((x: any) => String(x.id) === itemId);
          if (item) {
            item.isDeleted = true;
            item.deletedAt = nowIso;
            item.deletedBy = actor.name;
            item.deletionReason = cleanReason;
            found = true;
            mutatedRecord = item;
          }
        }
        if (!found) return { success: false, code: 'NOT_FOUND', error: 'Item droplist tidak ditemukan.' };
      } else if (subEntity === 'chat_categories') {
        const cats = bridge.db.appSettings?.chat_categories;
        const cc = Array.isArray(cats) ? cats.find((c: any) => String(c.id) === recordId) : null;
        if (!cc) return { success: false, code: 'NOT_FOUND', error: 'Kategori LiveChat tidak ditemukan.' };
        cc.isDeleted = true;
        cc.deletedAt = nowIso;
        cc.deletedBy = actor.name;
        cc.deletionReason = cleanReason;
        mutatedRecord = cc;
      } else {
        return { success: false, code: 'INVALID_SUB_ENTITY', error: 'Sub-entitas Data Lainnya tidak valid.' };
      }
    }

    if (bridge.beforeCommitHook) {
      bridge.beforeCommitHook({ action: 'soft_delete', category, recordId });
    }
    bridge.saveDatabaseToDisk();

    await recordDeletionLog(bridge, {
      transactionId: txId,
      deletionType: 'soft_delete',
      category,
      sourceTable,
      recordId,
      woNumber,
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      reason: cleanReason,
      relatedCounts,
      status: 'success'
    });

    await bridge.logServerAuditAsync(
      `Centralized Soft Delete (${category})`,
      sourceTable,
      recordId,
      `${sourceTable} ${woNumber || recordId} di-soft-delete oleh ${actor.name} (${actor.role}). Alasan: ${cleanReason}`,
      actor,
      { transactionId: txId }
    );

    if (category === 'work_orders') {
      bridge.broadcastSupabaseChange('work_orders', 'DELETE', mutatedRecord);
    }

    return { success: true, data: sanitizeDeletionPayload(mutatedRecord) };
  } catch (err: any) {
    rollbackLocal();
    const errMsg = err?.message || 'Transaksi soft delete gagal dan di-rollback.';
    await recordDeletionLog(bridge, {
      transactionId: txId,
      deletionType: 'soft_delete',
      category,
      sourceTable,
      recordId,
      woNumber,
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      reason: cleanReason,
      relatedCounts,
      status: 'failed',
      errorMessage: errMsg
    });
    return { success: false, code: 'TRANSACTION_ROLLED_BACK', error: errMsg };
  }
}

function isRpcMissingError(rpcErr: any): boolean {
  if (!rpcErr) return false;
  const code = String(rpcErr.code || '').toUpperCase();
  const msg = String(rpcErr.message || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    (msg.includes('function') && msg.includes('does not exist'))
  );
}

export async function executePermanentDelete(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  target: DeletionTargetInput,
  confirmText: string,
  reason: string,
  options?: { knownWoNumber?: string; operationId?: string; skipAuditLog?: boolean }
): Promise<{
  success: boolean;
  transactionId: string;
  code?: string;
  error?: string;
  data?: any;
  relatedCounts?: Record<string, number>;
}> {
  const txId = makeTxId('tx_pd');
  const sourceTable = resolveSourceTable(target.category, target.subEntity);

  if (actor.role !== 'super_admin') {
    await recordDeletionLog(bridge, {
      transactionId: txId,
      deletionType: 'permanent_delete',
      category: target.category,
      sourceTable,
      recordId: target.recordId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      reason: String(reason || ''),
      relatedCounts: {},
      status: 'rejected',
      errorMessage: 'FORBIDDEN_ROLE: Permanent delete hanya untuk Superadmin.',
      metadata: options?.operationId ? { operationId: options.operationId } : {}
    });
    return {
      success: false,
      transactionId: txId,
      code: 'FORBIDDEN_ROLE',
      error: 'Akses Ditolak: Hapus Permanen (Permanent Delete) dibatasi HANYA untuk Superadmin.'
    };
  }

  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    return {
      success: false,
      transactionId: txId,
      code: 'INVALID_REASON',
      error: 'Alasan penghapusan permanen wajib diisi minimal 5 karakter.'
    };
  }

  const lockKey = `${target.category}:${target.recordId}`;
  if (!acquireRecordLock(lockKey, txId, actor.name)) {
    return {
      success: false,
      transactionId: txId,
      code: 'CONCURRENT_DELETION_LOCKED',
      error: 'Record sedang dikunci oleh proses penghapusan lain.'
    };
  }

  try {
    // 1. Work Orders Permanent Delete (Strictly zero cascade; rejects if any historical FK exists)
    if (target.category === 'work_orders') {
      if (bridge.isSupabaseMode()) {
        const client = getSupabaseBackendClient();
        if (!client) return { success: false, transactionId: txId, code: 'DATABASE_UNAVAILABLE', error: 'Supabase tidak tersedia.' };
        const rpcRes = await client.rpc('morajaws_permanent_delete_wo_tx', {
          p_wo_id: target.recordId,
          p_confirm_wo_number: confirmText,
          p_reason: cleanReason,
          p_actor_id: actor.id,
          p_actor_name: actor.name,
          p_actor_role: actor.role,
          p_transaction_id: txId
        });
        if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
          const d: any = rpcRes.data;
          if (!d.success) {
            return {
              success: false,
              transactionId: txId,
              code: d.code || 'PERMANENT_DELETE_REJECTED',
              error: d.message,
              relatedCounts: d.relatedCounts
            };
          }
          bridge.broadcastSupabaseChange('work_orders', 'DELETE', { id: target.recordId, permanent: true });
          return { success: true, transactionId: txId, data: d, relatedCounts: d.relatedCounts };
        }

        // Only fallback to manual queries if the RPC itself is not deployed; otherwise surface real DB error
        if (rpcRes.error && !isRpcMissingError(rpcRes.error)) {
          const classified = classifySupabaseError(rpcRes.error);
          await recordDeletionLog(bridge, {
            transactionId: txId,
            deletionType: 'permanent_delete',
            category: 'work_orders',
            sourceTable: 'work_orders',
            recordId: target.recordId,
            woNumber: options?.knownWoNumber || target.woNumber || null,
            actorUserId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
            reason: cleanReason,
            relatedCounts: {},
            status: 'failed',
            errorMessage: classified.message,
            metadata: options?.operationId ? { operationId: options.operationId } : {}
          });
          return { success: false, transactionId: txId, code: classified.code, error: classified.message };
        }

        // Guarded check if RPC not yet deployed
        const deps = await inspectWoDependencies(bridge, target.recordId);
        if (!deps.found) return { success: false, transactionId: txId, code: 'NOT_FOUND', error: 'Work Order tidak ditemukan.' };
        if (canonicalWoKey(confirmText) !== canonicalWoKey(deps.woNumber)) {
          return { success: false, transactionId: txId, code: 'CONFIRMATION_MISMATCH', error: `Ketik persis WO Number "${deps.woNumber}" untuk konfirmasi hapus permanen.` };
        }
        if (deps.isProtected) return { success: false, transactionId: txId, code: 'PROTECTED_RECORD', error: 'Record WO produksi dilindungi.' };
        if (deps.activeImportLock) return { success: false, transactionId: txId, code: 'ACTIVE_IMPORT_IN_PROGRESS', error: 'WO terkait import aktif.' };
        if (deps.blockingTotal > 0) {
          const blockMsg = `Hapus permanen DITOLAK (${deps.blockingReasons.join('; ')}). Gunakan Soft Delete agar data historis tetap terjaga.`;
          await recordDeletionLog(bridge, {
            transactionId: txId,
            deletionType: 'permanent_delete',
            category: 'work_orders',
            sourceTable: 'work_orders',
            recordId: deps.id,
            woNumber: deps.woNumber,
            actorUserId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
            reason: cleanReason,
            relatedCounts: deps.counts,
            status: 'rejected',
            errorMessage: blockMsg,
            metadata: options?.operationId ? { operationId: options.operationId } : {}
          });
          return { success: false, transactionId: txId, code: 'HAS_BLOCKING_RELATIONS', error: blockMsg, relatedCounts: deps.counts };
        }
        const { error: delErr } = await client.from('work_orders').delete().eq('id', deps.id);
        if (delErr) {
          const classified = classifySupabaseError(delErr);
          await recordDeletionLog(bridge, {
            transactionId: txId,
            deletionType: 'permanent_delete',
            category: 'work_orders',
            sourceTable: 'work_orders',
            recordId: deps.id,
            woNumber: deps.woNumber,
            actorUserId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
            reason: cleanReason,
            relatedCounts: deps.counts,
            status: 'failed',
            errorMessage: classified.message,
            metadata: options?.operationId ? { operationId: options.operationId } : {}
          });
          return { success: false, transactionId: txId, code: classified.code, error: classified.message };
        }
        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'permanent_delete',
          category: 'work_orders',
          sourceTable: 'work_orders',
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'success',
          metadata: options?.operationId ? { operationId: options.operationId } : {}
        });
        if (!options?.skipAuditLog) {
          await bridge.logServerAuditAsync('WO Permanently Deleted (Centralized)', 'work_order', deps.id, `WO ${deps.woNumber} dihapus permanen oleh Superadmin ${actor.name}. Alasan: ${cleanReason}`, actor, { transactionId: txId, operationId: options?.operationId });
        }
        bridge.broadcastSupabaseChange('work_orders', 'DELETE', { id: deps.id, permanent: true });
        return { success: true, transactionId: txId, data: { deletedId: deps.id, woNumber: deps.woNumber }, relatedCounts: deps.counts };
      }

      // Local JSON Mode
      ensureLocalCollections(bridge.db);
      const deps = await inspectWoDependencies(bridge, target.recordId);
      if (!deps.found) {
        return { success: false, transactionId: txId, code: 'NOT_FOUND', error: `Work Order "${target.recordId}" tidak ditemukan.` };
      }
      if (canonicalWoKey(confirmText) === '' || canonicalWoKey(confirmText) !== canonicalWoKey(deps.woNumber)) {
        return {
          success: false,
          transactionId: txId,
          code: 'CONFIRMATION_MISMATCH',
          error: `Konfirmasi WO Number tidak cocok. Harap ketik persis "${deps.woNumber}".`
        };
      }
      if (deps.isProtected) {
        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'permanent_delete',
          category: 'work_orders',
          sourceTable: 'work_orders',
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'rejected',
          errorMessage: 'PROTECTED_RECORD'
        });
        return { success: false, transactionId: txId, code: 'PROTECTED_RECORD', error: 'Record WO produksi dilindungi secara mutlak.' };
      }
      if (deps.activeImportLock) {
        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'permanent_delete',
          category: 'work_orders',
          sourceTable: 'work_orders',
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'rejected',
          errorMessage: 'ACTIVE_IMPORT_IN_PROGRESS'
        });
        return { success: false, transactionId: txId, code: 'ACTIVE_IMPORT_IN_PROGRESS', error: 'Tidak dapat menghapus permanen saat import batch aktif berjalan.' };
      }
      if (deps.blockingTotal > 0) {
        const blockMsg = `Hapus permanen DITOLAK untuk melindungi data historis (${deps.blockingReasons.join('; ')}). Gunakan Soft Delete agar assignment_history, ticket_messages, technical_reports, dan attachments tetap tersimpan.`;
        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'permanent_delete',
          category: 'work_orders',
          sourceTable: 'work_orders',
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'rejected',
          errorMessage: blockMsg
        });
        return {
          success: false,
          transactionId: txId,
          code: 'HAS_BLOCKING_RELATIONS',
          error: blockMsg,
          relatedCounts: deps.counts
        };
      }

      const snapshotTickets = JSON.stringify(bridge.db.tickets);
      try {
        bridge.db.tickets = bridge.db.tickets.filter((t: any) => String(t.id) !== deps.id);
        if (bridge.beforeCommitHook) {
          bridge.beforeCommitHook({ action: 'permanent_delete', category: 'work_orders', recordId: deps.id });
        }
        bridge.saveDatabaseToDisk();

        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'permanent_delete',
          category: 'work_orders',
          sourceTable: 'work_orders',
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'success'
        });
        await bridge.logServerAuditAsync('WO Permanently Deleted (Centralized)', 'work_order', deps.id, `WO ${deps.woNumber} dihapus permanen oleh Superadmin ${actor.name}. Alasan: ${cleanReason}`, actor, { transactionId: txId });
        bridge.broadcastSupabaseChange('work_orders', 'DELETE', { id: deps.id, permanent: true });
        return { success: true, transactionId: txId, data: { deletedId: deps.id, woNumber: deps.woNumber }, relatedCounts: deps.counts };
      } catch (err: any) {
        bridge.db.tickets = JSON.parse(snapshotTickets);
        const errMsg = err?.message || 'Permanent delete gagal dan telah di-rollback.';
        await recordDeletionLog(bridge, {
          transactionId: txId,
          deletionType: 'permanent_delete',
          category: 'work_orders',
          sourceTable: 'work_orders',
          recordId: deps.id,
          woNumber: deps.woNumber,
          actorUserId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          reason: cleanReason,
          relatedCounts: deps.counts,
          status: 'failed',
          errorMessage: errMsg
        });
        return { success: false, transactionId: txId, code: 'TRANSACTION_ROLLED_BACK', error: errMsg };
      }
    }

    // 2. Non-WO Categories Permanent Delete (Superadmin only, explicit confirmation matching recordId or label)
    if (target.category === 'other_data' && target.subEntity === 'users' && target.recordId === actor.id) {
      return { success: false, transactionId: txId, code: 'SELF_DELETE_FORBIDDEN', error: 'Anda tidak dapat menghapus akun sendiri.' };
    }

    if (bridge.isSupabaseMode()) {
      const client = getSupabaseBackendClient();
      if (!client) return { success: false, transactionId: txId, code: 'DATABASE_UNAVAILABLE', error: 'Supabase tidak tersedia.' };
      if (target.category === 'import_staging') {
        const { data: jobRow } = await client.from('import_jobs').select('id, status, import_name').eq('id', target.recordId).maybeSingle();
        if (!jobRow) return { success: false, transactionId: txId, code: 'NOT_FOUND', error: 'Staging import job tidak ditemukan.' };
        if (['staging', 'queued', 'processing'].includes(String(jobRow.status || '').toLowerCase())) {
          return { success: false, transactionId: txId, code: 'ACTIVE_IMPORT_IN_PROGRESS', error: 'Tidak dapat menghapus staging dari job impor yang sedang aktif.' };
        }
        const { error: delErr } = await client.from('import_jobs').delete().eq('id', target.recordId);
        if (delErr) {
          const msg = classifySupabaseError(delErr).message;
          await recordDeletionLog(bridge, {
            transactionId: txId, deletionType: 'permanent_delete', category: target.category, sourceTable: 'import_jobs',
            recordId: target.recordId, actorUserId: actor.id, actorName: actor.name, actorRole: actor.role,
            reason: cleanReason, relatedCounts: {}, status: 'failed', errorMessage: msg
          });
          return { success: false, transactionId: txId, code: 'DELETE_FAILED', error: msg };
        }
        await recordDeletionLog(bridge, {
          transactionId: txId, deletionType: 'permanent_delete', category: target.category, sourceTable: 'import_jobs',
          recordId: target.recordId, actorUserId: actor.id, actorName: actor.name, actorRole: actor.role,
          reason: cleanReason, relatedCounts: {}, status: 'success'
        });
        return { success: true, transactionId: txId, data: { deletedId: target.recordId } };
      }

      const tbl = sourceTable;
      if (tbl === 'app_settings' || tbl === 'other_data') {
        return { success: false, transactionId: txId, code: 'UNSUPPORTED', error: 'Konfigurasi app_settings menggunakan soft delete / nonaktif terpusat.' };
      }
      const { error: delErr } = await client.from(tbl).delete().eq('id', target.recordId);
      if (delErr) {
        const msg = classifySupabaseError(delErr).message;
        await recordDeletionLog(bridge, {
          transactionId: txId, deletionType: 'permanent_delete', category: target.category, sourceTable: tbl,
          recordId: target.recordId, actorUserId: actor.id, actorName: actor.name, actorRole: actor.role,
          reason: cleanReason, relatedCounts: {}, status: 'failed', errorMessage: msg
        });
        return { success: false, transactionId: txId, code: 'DELETE_FAILED', error: msg };
      }
      if (tbl === 'users') bridge.revokeUserSessions(target.recordId);
      await recordDeletionLog(bridge, {
        transactionId: txId, deletionType: 'permanent_delete', category: target.category, sourceTable: tbl,
        recordId: target.recordId, actorUserId: actor.id, actorName: actor.name, actorRole: actor.role,
        reason: cleanReason, relatedCounts: {}, status: 'success'
      });
      await bridge.logServerAuditAsync(`Permanent Delete (${tbl})`, tbl, target.recordId, `${tbl} ${target.recordId} dihapus permanen oleh ${actor.name}. Alasan: ${cleanReason}`, actor);
      return { success: true, transactionId: txId, data: { deletedId: target.recordId } };
    }

    // Local JSON non-WO permanent delete with snapshot rollback
    ensureLocalCollections(bridge.db);
    if (!String(confirmText || '').trim()) {
      return { success: false, transactionId: txId, code: 'CONFIRMATION_REQUIRED', error: 'Konfirmasi teks wajib diisi untuk hapus permanen.' };
    }

    const snap = JSON.stringify({
      assignmentHistory: bridge.db.assignmentHistory,
      technicalReports: bridge.db.technicalReports,
      ticketMessages: bridge.db.ticketMessages,
      attachments: bridge.db.attachments,
      storageMetadata: bridge.db.storageMetadata,
      importHistory: bridge.db.importHistory,
      importJobs: bridge.db.importJobs,
      importStagingRows: bridge.db.importStagingRows,
      users: bridge.db.users,
      contractors: bridge.db.contractors,
      coverageAreas: bridge.db.coverageAreas,
      templates: bridge.db.templates,
      appSettings: bridge.db.appSettings
    });

    try {
      let deleted = false;
      if (target.category === 'assignment_history') {
        const before = bridge.db.assignmentHistory.length;
        bridge.db.assignmentHistory = bridge.db.assignmentHistory.filter((r: any) => String(r.id) !== target.recordId);
        deleted = bridge.db.assignmentHistory.length < before;
      } else if (target.category === 'technical_reports') {
        const before = bridge.db.technicalReports.length;
        bridge.db.technicalReports = bridge.db.technicalReports.filter((r: any) => String(r.id) !== target.recordId);
        deleted = bridge.db.technicalReports.length < before;
        if (!deleted && target.recordId.startsWith('tr_')) {
          const t = bridge.db.tickets.find((x: any) => String(x.id) === target.recordId.slice(3) && x.technicalReport);
          if (t) {
            delete t.technicalReport;
            deleted = true;
          }
        }
      } else if (target.category === 'ticket_messages') {
        const before = bridge.db.ticketMessages.length;
        bridge.db.ticketMessages = bridge.db.ticketMessages.filter((m: any) => String(m.id) !== target.recordId);
        deleted = bridge.db.ticketMessages.length < before;
      } else if (target.category === 'attachments') {
        const b1 = bridge.db.attachments.length;
        const b2 = bridge.db.storageMetadata.length;
        bridge.db.attachments = bridge.db.attachments.filter((a: any) => String(a.id) !== target.recordId);
        bridge.db.storageMetadata = bridge.db.storageMetadata.filter((m: any) => String(m.id || m.fileId || m.filePath) !== target.recordId);
        deleted = bridge.db.attachments.length < b1 || bridge.db.storageMetadata.length < b2;
      } else if (target.category === 'import_history') {
        const before = bridge.db.importHistory.length;
        bridge.db.importHistory = bridge.db.importHistory.filter((h: any) => String(h.id) !== target.recordId);
        deleted = bridge.db.importHistory.length < before;
      } else if (target.category === 'import_staging') {
        const job = bridge.db.importJobs.find((j: any) => String(j.id) === target.recordId);
        if (!job) return { success: false, transactionId: txId, code: 'NOT_FOUND', error: 'Staging import job tidak ditemukan.' };
        if (['staging', 'queued', 'processing'].includes(String(job.status || '').toLowerCase())) {
          return { success: false, transactionId: txId, code: 'ACTIVE_IMPORT_IN_PROGRESS', error: 'Tidak dapat menghapus staging dari job impor yang sedang aktif.' };
        }
        bridge.db.importJobs = bridge.db.importJobs.filter((j: any) => String(j.id) !== target.recordId);
        bridge.db.importStagingRows = bridge.db.importStagingRows.filter((sr: any) => String(sr.jobId) !== target.recordId);
        deleted = true;
      } else if (target.category === 'other_data') {
        if (target.subEntity === 'users') {
          const before = bridge.db.users.length;
          bridge.db.users = bridge.db.users.filter((u: any) => String(u.id) !== target.recordId);
          deleted = bridge.db.users.length < before;
          if (deleted) bridge.revokeUserSessions(target.recordId);
        } else if (target.subEntity === 'contractors') {
          const before = bridge.db.contractors.length;
          bridge.db.contractors = bridge.db.contractors.filter((c: any) => String(c.id) !== target.recordId);
          deleted = bridge.db.contractors.length < before;
        } else if (target.subEntity === 'coverage_areas') {
          const before = bridge.db.coverageAreas.length;
          bridge.db.coverageAreas = bridge.db.coverageAreas.filter((a: any) => String(a.id) !== target.recordId);
          deleted = bridge.db.coverageAreas.length < before;
        } else if (target.subEntity === 'wa_templates') {
          const before = bridge.db.templates.length;
          bridge.db.templates = bridge.db.templates.filter((t: any) => String(t.id) !== target.recordId);
          deleted = bridge.db.templates.length < before;
        } else if (target.subEntity === 'droplist_items') {
          if (target.recordId.startsWith('status:') && Array.isArray(bridge.db.appSettings?.hierarchical_droplists)) {
            const stId = target.recordId.slice(7);
            const before = bridge.db.appSettings.hierarchical_droplists.length;
            bridge.db.appSettings.hierarchical_droplists = bridge.db.appSettings.hierarchical_droplists.filter((s: any) => String(s.id) !== stId);
            deleted = bridge.db.appSettings.hierarchical_droplists.length < before;
          } else if (target.recordId.startsWith('reason:') && Array.isArray(bridge.db.appSettings?.hierarchical_droplists)) {
            const [, stId, rId] = target.recordId.split(':');
            const st = bridge.db.appSettings.hierarchical_droplists.find((s: any) => String(s.id) === stId);
            if (st && Array.isArray(st.reasons)) {
              const before = st.reasons.length;
              st.reasons = st.reasons.filter((x: any) => String(x.id) !== rId);
              deleted = st.reasons.length < before;
            }
          } else if (target.recordId.startsWith('static:') && Array.isArray(bridge.db.appSettings?.static_droplist_categories)) {
            const [, catId, itemId] = target.recordId.split(':');
            const cat = bridge.db.appSettings.static_droplist_categories.find((c: any) => String(c.id) === catId);
            if (cat && Array.isArray(cat.items)) {
              const before = cat.items.length;
              cat.items = cat.items.filter((x: any) => String(x.id) !== itemId);
              deleted = cat.items.length < before;
            }
          }
        } else if (target.subEntity === 'chat_categories' && Array.isArray(bridge.db.appSettings?.chat_categories)) {
          const before = bridge.db.appSettings.chat_categories.length;
          bridge.db.appSettings.chat_categories = bridge.db.appSettings.chat_categories.filter((c: any) => String(c.id) !== target.recordId);
          deleted = bridge.db.appSettings.chat_categories.length < before;
        }
      }

      if (!deleted) {
        return { success: false, transactionId: txId, code: 'NOT_FOUND', error: `Record "${target.recordId}" tidak ditemukan.` };
      }

      if (bridge.beforeCommitHook) {
        bridge.beforeCommitHook({ action: 'permanent_delete', category: target.category, recordId: target.recordId });
      }
      bridge.saveDatabaseToDisk();

      await recordDeletionLog(bridge, {
        transactionId: txId,
        deletionType: 'permanent_delete',
        category: target.category,
        sourceTable,
        recordId: target.recordId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        reason: cleanReason,
        relatedCounts: {},
        status: 'success'
      });
      await bridge.logServerAuditAsync(`Permanent Delete (${sourceTable})`, sourceTable, target.recordId, `${sourceTable} ${target.recordId} dihapus permanen oleh ${actor.name}. Alasan: ${cleanReason}`, actor, { transactionId: txId });
      return { success: true, transactionId: txId, data: { deletedId: target.recordId } };
    } catch (err: any) {
      Object.assign(bridge.db, JSON.parse(snap));
      const errMsg = err?.message || 'Permanent delete gagal dan telah di-rollback.';
      await recordDeletionLog(bridge, {
        transactionId: txId,
        deletionType: 'permanent_delete',
        category: target.category,
        sourceTable,
        recordId: target.recordId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        reason: cleanReason,
        relatedCounts: {},
        status: 'failed',
        errorMessage: errMsg
      });
      return { success: false, transactionId: txId, code: 'TRANSACTION_ROLLED_BACK', error: errMsg };
    }
  } finally {
    releaseRecordLock(lockKey, txId);
  }
}

// ==============================================================================
// TRACKED, CHUNKED & IDEMPOTENT PERMANENT DELETION OPERATION ENGINE
// Prevents 30s client & Vercel Serverless timeouts, enforces strict idempotency,
// preserves partial progress across disconnects/refreshes, and emits per-WO reports.
// ==============================================================================

const DELETION_OP_PREFIX = 'deletion_op:';
const OPERATION_STEP_MUTEX = new Map<string, { startedAt: number; actorId: string }>();
const OPERATION_HOT_CACHE = new Map<string, PermanentDeleteOperationState>();
const OPERATION_STEP_TIMEOUT_MS = 60_000;
const DEFAULT_PERMANENT_DELETE_CHUNK_SIZE = 5;

function makeOperationId(clientProvided?: string): string {
  const clean = String(clientProvided || '').trim();
  if (/^[A-Za-z0-9_-]{8,80}$/.test(clean)) {
    return clean;
  }
  return `op_pd_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function buildOperationFingerprint(
  actorId: string,
  targets: DeletionTargetInput[],
  reason: string,
  confirmText: string
): string {
  const canonicalTargets = targets
    .map(t => `${t.category}:${t.subEntity || 'main'}:${t.recordId}`)
    .sort()
    .join('|');
  return crypto
    .createHash('sha256')
    .update(`${actorId}::${canonicalTargets}::${reason}::${confirmText.trim().toUpperCase()}`)
    .digest('hex')
    .slice(0, 32);
}

function acquireOperationStepMutex(operationId: string, actorId: string): boolean {
  const cur = OPERATION_STEP_MUTEX.get(operationId);
  if (cur && Date.now() - cur.startedAt < OPERATION_STEP_TIMEOUT_MS) {
    return false;
  }
  OPERATION_STEP_MUTEX.set(operationId, { startedAt: Date.now(), actorId });
  return true;
}

function releaseOperationStepMutex(operationId: string): void {
  OPERATION_STEP_MUTEX.delete(operationId);
}

function recomputeOperationCounters(op: PermanentDeleteOperationState): PermanentDeleteOperationState {
  let processed = 0;
  let succeeded = 0;
  let alreadyDeleted = 0;
  let blocked = 0;
  let failed = 0;
  let firstPending = -1;

  op.results.forEach((r, idx) => {
    if (r.status === 'pending') {
      if (firstPending === -1) firstPending = idx;
      return;
    }
    processed++;
    if (r.status === 'deleted') succeeded++;
    else if (r.status === 'already_deleted') alreadyDeleted++;
    else if (r.status === 'blocked_fk' || r.status === 'protected') blocked++;
    else failed++;
  });

  op.processedCount = processed;
  op.succeededCount = succeeded;
  op.alreadyDeletedCount = alreadyDeleted;
  op.blockedCount = blocked;
  op.failedCount = failed;
  op.nextIndex = firstPending === -1 ? op.totalCount : firstPending;

  if (firstPending === -1) {
    const anyProblem = blocked > 0 || failed > 0;
    const anySuccess = succeeded > 0 || alreadyDeleted > 0;
    if (!anyProblem) {
      op.status = 'completed';
      op.stageLabel = 'Berhasil';
    } else if (anySuccess) {
      op.status = 'partial';
      op.stageLabel = 'Sebagian berhasil';
    } else {
      op.status = 'failed';
      op.stageLabel = 'Gagal';
    }
    op.completedAt = op.completedAt || new Date().toISOString();
  }
  op.updatedAt = new Date().toISOString();
  return op;
}

async function savePermanentDeleteOperation(
  bridge: LocalStoreBridge,
  op: PermanentDeleteOperationState
): Promise<void> {
  OPERATION_HOT_CACHE.set(op.operationId, JSON.parse(JSON.stringify(op)));

  if (bridge.isLocalJsonModeAllowed()) {
    ensureLocalCollections(bridge.db);
    const list: PermanentDeleteOperationState[] = bridge.db.deletionOperations;
    const idx = list.findIndex(x => x.operationId === op.operationId);
    const copy = JSON.parse(JSON.stringify(op));
    if (idx >= 0) list[idx] = copy;
    else {
      list.unshift(copy);
      if (list.length > 100) list.length = 100;
    }
    bridge.saveDatabaseToDisk();
  }

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        await client.from('app_settings').upsert(
          {
            setting_key: `${DELETION_OP_PREFIX}${op.operationId}`,
            setting_value: sanitizeDeletionPayload(op),
            description: `Permanent Delete Operation (${op.totalCount} records) by ${op.actorName}`,
            updated_by: op.actorName,
            updated_at: op.updatedAt
          },
          { onConflict: 'setting_key' }
        );
      } catch {
        // Hot cache still preserves state in-process
      }
    }
  }
}

export async function loadPermanentDeleteOperation(
  bridge: LocalStoreBridge,
  operationId: string
): Promise<PermanentDeleteOperationState | null> {
  const cleanId = String(operationId || '').trim();
  if (!cleanId) return null;

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        const { data } = await client
          .from('app_settings')
          .select('setting_value')
          .eq('setting_key', `${DELETION_OP_PREFIX}${cleanId}`)
          .maybeSingle();
        if (data?.setting_value && typeof data.setting_value === 'object') {
          const loaded = data.setting_value as PermanentDeleteOperationState;
          OPERATION_HOT_CACHE.set(cleanId, loaded);
          return JSON.parse(JSON.stringify(loaded));
        }
      } catch {}
    }
  }

  if (bridge.isLocalJsonModeAllowed()) {
    ensureLocalCollections(bridge.db);
    const found = (bridge.db.deletionOperations || []).find(
      (x: PermanentDeleteOperationState) => x.operationId === cleanId
    );
    if (found) return JSON.parse(JSON.stringify(found));
  }

  const cached = OPERATION_HOT_CACHE.get(cleanId);
  return cached ? JSON.parse(JSON.stringify(cached)) : null;
}

async function findInFlightOperationByFingerprint(
  bridge: LocalStoreBridge,
  fingerprint: string
): Promise<PermanentDeleteOperationState | null> {
  const now = Date.now();
  const MAX_ACTIVE_AGE_MS = 10 * 60_000;

  for (const op of OPERATION_HOT_CACHE.values()) {
    if (
      op.fingerprint === fingerprint &&
      (op.status === 'preparing' || op.status === 'verifying' || op.status === 'processing') &&
      now - (Date.parse(op.updatedAt) || 0) < MAX_ACTIVE_AGE_MS
    ) {
      return JSON.parse(JSON.stringify(op));
    }
  }

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        const { data } = await client
          .from('app_settings')
          .select('setting_value')
          .like('setting_key', `${DELETION_OP_PREFIX}%`)
          .order('updated_at', { ascending: false })
          .limit(20);
        for (const row of data || []) {
          const op = row?.setting_value as PermanentDeleteOperationState | undefined;
          if (
            op &&
            op.fingerprint === fingerprint &&
            (op.status === 'preparing' || op.status === 'verifying' || op.status === 'processing') &&
            now - (Date.parse(op.updatedAt) || 0) < MAX_ACTIVE_AGE_MS
          ) {
            return op;
          }
        }
      } catch {}
    }
  }

  if (bridge.isLocalJsonModeAllowed()) {
    ensureLocalCollections(bridge.db);
    const found = (bridge.db.deletionOperations || []).find(
      (op: PermanentDeleteOperationState) =>
        op.fingerprint === fingerprint &&
        (op.status === 'preparing' || op.status === 'verifying' || op.status === 'processing') &&
        now - (Date.parse(op.updatedAt) || 0) < MAX_ACTIVE_AGE_MS
    );
    if (found) return JSON.parse(JSON.stringify(found));
  }

  return null;
}

export async function getActiveOrRecentPermanentDeleteOperations(
  bridge: LocalStoreBridge,
  actor: DeletionActor
): Promise<PermanentDeleteOperationState[]> {
  if (actor.role !== 'super_admin') return [];
  const map = new Map<string, PermanentDeleteOperationState>();

  for (const op of OPERATION_HOT_CACHE.values()) {
    map.set(op.operationId, JSON.parse(JSON.stringify(op)));
  }

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        const { data } = await client
          .from('app_settings')
          .select('setting_value')
          .like('setting_key', `${DELETION_OP_PREFIX}%`)
          .order('updated_at', { ascending: false })
          .limit(15);
        for (const row of data || []) {
          const op = row?.setting_value as PermanentDeleteOperationState | undefined;
          if (op?.operationId) map.set(op.operationId, op);
        }
      } catch {}
    }
  } else if (bridge.isLocalJsonModeAllowed()) {
    ensureLocalCollections(bridge.db);
    for (const op of (bridge.db.deletionOperations || []).slice(0, 15)) {
      if (op?.operationId) map.set(op.operationId, JSON.parse(JSON.stringify(op)));
    }
  }

  return Array.from(map.values())
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    .slice(0, 10);
}

function dedupeTargetsInput(targets: DeletionTargetInput[]): DeletionTargetInput[] {
  const dedupedTargets: DeletionTargetInput[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    const cleanId = String(t.recordId || '').trim();
    const key = `${t.category}:${t.subEntity || 'main'}:${cleanId}`;
    if (!seen.has(key) && cleanId) {
      seen.add(key);
      dedupedTargets.push({
        category: t.category,
        recordId: cleanId,
        subEntity: t.subEntity,
        woNumber: t.woNumber ? String(t.woNumber).trim() : undefined,
        label: t.label ? String(t.label).trim() : undefined
      });
    }
  }
  return dedupedTargets;
}

export async function startPermanentDeleteOperation(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  targets: DeletionTargetInput[],
  confirmText: string,
  reason: string,
  options?: { operationId?: string; chunkSize?: number }
): Promise<{
  success: boolean;
  code?: string;
  error?: string;
  alreadyInProgress?: boolean;
  alreadyCompleted?: boolean;
  operation?: PermanentDeleteOperationState;
}> {
  if (actor.role !== 'super_admin') {
    const rejTxId = makeTxId('tx_pdb');
    for (const t of targets.slice(0, 20)) {
      await recordDeletionLog(bridge, {
        transactionId: rejTxId,
        deletionType: 'permanent_delete',
        category: t.category,
        sourceTable: resolveSourceTable(t.category, t.subEntity),
        recordId: t.recordId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        reason: String(reason || ''),
        relatedCounts: {},
        status: 'rejected',
        errorMessage: 'FORBIDDEN_ROLE: Permanent delete batch hanya untuk Superadmin.'
      });
    }
    return {
      success: false,
      code: 'FORBIDDEN_ROLE',
      error: 'Akses Ditolak: Hapus Permanen (Permanent Delete) dibatasi HANYA untuk role Superadmin.'
    };
  }

  const dedupedTargets = dedupeTargetsInput(targets);
  if (dedupedTargets.length === 0) {
    return {
      success: false,
      code: 'INVALID_TARGETS',
      error: 'Pilih minimal satu record valid untuk dihapus permanen.'
    };
  }

  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    return {
      success: false,
      code: 'INVALID_REASON',
      error: 'Alasan penghapusan permanen wajib diisi minimal 5 karakter.'
    };
  }

  const cleanConfirm = String(confirmText || '').trim();
  if (dedupedTargets.length > 1) {
    const expectedBatchPhrase = `HAPUS PERMANEN ${dedupedTargets.length} DATA`;
    if (cleanConfirm.toUpperCase() !== expectedBatchPhrase) {
      return {
        success: false,
        code: 'CONFIRMATION_MISMATCH',
        error: `Konfirmasi batch tidak cocok. Harap ketik persis "${expectedBatchPhrase}".`
      };
    }
  } else {
    const single = dedupedTargets[0];
    if (!cleanConfirm) {
      return {
        success: false,
        code: 'CONFIRMATION_REQUIRED',
        error: 'Konfirmasi teks wajib diisi untuk hapus permanen.'
      };
    }
    if (single.category === 'work_orders' && single.woNumber) {
      if (canonicalWoKey(cleanConfirm) !== canonicalWoKey(single.woNumber)) {
        return {
          success: false,
          code: 'CONFIRMATION_MISMATCH',
          error: `Konfirmasi WO Number tidak cocok. Harap ketik persis "${single.woNumber}".`
        };
      }
    }
  }

  const operationId = makeOperationId(options?.operationId);
  const existingById = await loadPermanentDeleteOperation(bridge, operationId);
  if (existingById) {
    if (existingById.actorUserId && existingById.actorUserId !== actor.id && actor.role !== 'super_admin') {
      return { success: false, code: 'FORBIDDEN_OPERATION', error: 'Anda tidak berwenang mengakses operasi ini.' };
    }
    const isTerminal =
      existingById.status === 'completed' || existingById.status === 'partial' || existingById.status === 'failed';
    return {
      success: true,
      alreadyInProgress: !isTerminal,
      alreadyCompleted: isTerminal,
      operation: existingById
    };
  }

  const fingerprint = buildOperationFingerprint(actor.id, dedupedTargets, cleanReason, cleanConfirm);
  const duplicateInFlight = await findInFlightOperationByFingerprint(bridge, fingerprint);
  if (duplicateInFlight) {
    return {
      success: true,
      alreadyInProgress: true,
      operation: duplicateInFlight
    };
  }

  const chunkSize = Math.min(10, Math.max(1, Number(options?.chunkSize || DEFAULT_PERMANENT_DELETE_CHUNK_SIZE)));
  const nowIso = new Date().toISOString();

  // Pre-verify existence once cleanly (bulk query in Supabase, index lookup in Local)
  const existingWoMap = new Map<string, string>();
  const woIds = dedupedTargets.filter(t => t.category === 'work_orders').map(t => t.recordId);

  if (woIds.length > 0) {
    if (bridge.isSupabaseMode()) {
      const client = getSupabaseBackendClient();
      if (!client) {
        return { success: false, code: 'DATABASE_UNAVAILABLE', error: 'Koneksi database Supabase tidak tersedia.' };
      }
      const { data: woRows, error: woSelErr } = await client
        .from('work_orders')
        .select('id, wo_number')
        .in('id', woIds);
      if (woSelErr) {
        const classified = classifySupabaseError(woSelErr);
        return { success: false, code: classified.code, error: classified.message };
      }
      for (const r of woRows || []) {
        existingWoMap.set(String(r.id), String(r.wo_number || ''));
      }
    } else {
      ensureLocalCollections(bridge.db);
      for (const id of woIds) {
        const found =
          bridge.db.tickets.find((t: any) => String(t.id) === id) ||
          bridge.db.tickets.find((t: any) => canonicalWoKey(t.woNumber) === canonicalWoKey(id));
        if (found) {
          existingWoMap.set(id, String(found.woNumber || ''));
        }
      }
    }
  }

  // Validate single-WO confirmation text against actual DB woNumber if present
  if (dedupedTargets.length === 1 && dedupedTargets[0].category === 'work_orders') {
    const actualWoNum = existingWoMap.get(dedupedTargets[0].recordId);
    if (actualWoNum && canonicalWoKey(cleanConfirm) !== canonicalWoKey(actualWoNum)) {
      return {
        success: false,
        code: 'CONFIRMATION_MISMATCH',
        error: `Konfirmasi WO Number tidak cocok. Harap ketik persis "${actualWoNum}".`
      };
    }
  }

  const initialResults: PermanentDeleteItemResult[] = dedupedTargets.map(t => {
    if (t.category === 'work_orders' && !existingWoMap.has(t.recordId)) {
      return {
        recordId: t.recordId,
        category: t.category,
        subEntity: t.subEntity,
        woNumber: t.woNumber,
        label: t.label,
        status: 'already_deleted',
        code: 'ALREADY_DELETED',
        message: 'Data sudah tidak ada di database (telah terhapus sebelumnya).',
        processedAt: nowIso
      };
    }
    return {
      recordId: t.recordId,
      category: t.category,
      subEntity: t.subEntity,
      woNumber: existingWoMap.get(t.recordId) || t.woNumber,
      label: t.label,
      status: 'pending'
    };
  });

  const op: PermanentDeleteOperationState = recomputeOperationCounters({
    operationId,
    fingerprint,
    status: 'processing',
    stageLabel: 'Sedang menghapus',
    actorUserId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    reason: cleanReason,
    confirmText: cleanConfirm,
    totalCount: dedupedTargets.length,
    processedCount: 0,
    succeededCount: 0,
    alreadyDeletedCount: 0,
    blockedCount: 0,
    failedCount: 0,
    chunkSize,
    nextIndex: 0,
    targets: dedupedTargets.map(t => ({
      ...t,
      woNumber: existingWoMap.get(t.recordId) || t.woNumber
    })),
    results: initialResults,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    lastError: null,
    auditLogged: false
  });

  await finalizeOperationAuditIfCompleted(bridge, actor, op);
  await savePermanentDeleteOperation(bridge, op);

  return {
    success: true,
    operation: op
  };
}

async function finalizeOperationAuditIfCompleted(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  op: PermanentDeleteOperationState
): Promise<void> {
  const isDone = op.status === 'completed' || op.status === 'partial' || op.status === 'failed';
  if (!isDone || op.auditLogged) return;
  op.auditLogged = true;

  if (op.succeededCount > 0 || op.blockedCount > 0 || op.failedCount > 0) {
    await bridge.logServerAuditAsync(
      'Permanent Delete Batch Summary',
      'work_order_batch',
      op.operationId,
      `Operasi hapus permanen ${op.operationId} selesai (${op.stageLabel}) oleh ${actor.name}: ${op.succeededCount} dihapus, ${op.alreadyDeletedCount} sudah terhapus sebelumnya, ${op.blockedCount} diblokir FK/proteksi, ${op.failedCount} gagal dari total ${op.totalCount}. Alasan: ${op.reason}`,
      actor,
      {
        operationId: op.operationId,
        totalCount: op.totalCount,
        succeededCount: op.succeededCount,
        alreadyDeletedCount: op.alreadyDeletedCount,
        blockedCount: op.blockedCount,
        failedCount: op.failedCount
      }
    );
  }
}

export async function stepPermanentDeleteOperation(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  operationId: string,
  requestedChunkSize?: number
): Promise<{
  success: boolean;
  code?: string;
  error?: string;
  inProgress?: boolean;
  operation?: PermanentDeleteOperationState;
}> {
  if (actor.role !== 'super_admin') {
    return {
      success: false,
      code: 'FORBIDDEN_ROLE',
      error: 'Akses Ditolak: Hanya Superadmin yang dapat mengeksekusi operasi hapus permanen.'
    };
  }

  const cleanId = String(operationId || '').trim();
  if (!cleanId) {
    return { success: false, code: 'INVALID_OPERATION_ID', error: 'Operation ID wajib disertakan.' };
  }

  if (!acquireOperationStepMutex(cleanId, actor.id)) {
    const snapshot = await loadPermanentDeleteOperation(bridge, cleanId);
    return {
      success: true,
      inProgress: true,
      code: 'OPERATION_IN_PROGRESS',
      operation: snapshot || undefined
    };
  }

  try {
    const op = await loadPermanentDeleteOperation(bridge, cleanId);
    if (!op) {
      return {
        success: false,
        code: 'OPERATION_NOT_FOUND',
        error: `Operasi hapus permanen "${cleanId}" tidak ditemukan atau telah kedaluwarsa.`
      };
    }

    if (op.status === 'completed' || op.status === 'partial' || op.status === 'failed') {
      return { success: true, operation: op };
    }

    op.status = 'processing';
    op.stageLabel = 'Sedang menghapus';

    const chunkLimit = Math.min(10, Math.max(1, Number(requestedChunkSize || op.chunkSize || DEFAULT_PERMANENT_DELETE_CHUNK_SIZE)));
    const pendingIndices: number[] = [];
    for (let i = 0; i < op.results.length && pendingIndices.length < chunkLimit; i++) {
      if (op.results[i].status === 'pending') {
        pendingIndices.push(i);
      }
    }

    if (pendingIndices.length === 0) {
      recomputeOperationCounters(op);
      await finalizeOperationAuditIfCompleted(bridge, actor, op);
      await savePermanentDeleteOperation(bridge, op);
      return { success: true, operation: op };
    }

    // Single bulk query for all WO items in this chunk (eliminates redundant per-WO inspect RPC!)
    const chunkWoIds = pendingIndices
      .map(idx => op.targets[idx])
      .filter(t => t.category === 'work_orders')
      .map(t => t.recordId);
    const chunkWoNumberMap = new Map<string, string>();
    const missingWoSet = new Set<string>();

    if (chunkWoIds.length > 0 && bridge.isSupabaseMode()) {
      const client = getSupabaseBackendClient();
      if (client) {
        const { data: woRows, error: woErr } = await client
          .from('work_orders')
          .select('id, wo_number')
          .in('id', chunkWoIds);
        if (!woErr && Array.isArray(woRows)) {
          const foundIds = new Set<string>();
          for (const r of woRows) {
            const rid = String(r.id);
            foundIds.add(rid);
            chunkWoNumberMap.set(rid, String(r.wo_number || ''));
          }
          for (const id of chunkWoIds) {
            if (!foundIds.has(id)) missingWoSet.add(id);
          }
        }
      }
    }

    for (const idx of pendingIndices) {
      const target = op.targets[idx];
      const itemRes = op.results[idx];
      const nowIso = new Date().toISOString();

      if (target.category === 'work_orders' && missingWoSet.has(target.recordId)) {
        itemRes.status = 'already_deleted';
        itemRes.code = 'ALREADY_DELETED';
        itemRes.message = 'WO sudah tidak ada di database (telah terhapus sebelumnya).';
        itemRes.processedAt = nowIso;
        continue;
      }

      let singleConfirm = target.recordId;
      if (target.category === 'work_orders') {
        singleConfirm =
          chunkWoNumberMap.get(target.recordId) ||
          target.woNumber ||
          itemRes.woNumber ||
          target.recordId;
      }

      const res = await executePermanentDelete(bridge, actor, target, singleConfirm, op.reason, {
        knownWoNumber: singleConfirm,
        operationId: op.operationId,
        skipAuditLog: false
      });

      itemRes.transactionId = res.transactionId;
      itemRes.processedAt = nowIso;

      if (res.success) {
        itemRes.status = 'deleted';
        itemRes.code = 'DELETED';
        itemRes.woNumber = res.data?.woNumber || itemRes.woNumber || singleConfirm;
        itemRes.message = 'Berhasil dihapus permanen.';
      } else if (res.code === 'NOT_FOUND') {
        itemRes.status = 'already_deleted';
        itemRes.code = 'ALREADY_DELETED';
        itemRes.message = 'Data sudah tidak ditemukan di database (telah terhapus sebelumnya).';
      } else if (res.code === 'HAS_BLOCKING_RELATIONS') {
        itemRes.status = 'blocked_fk';
        itemRes.code = res.code;
        itemRes.message = res.error || 'Diblokir oleh relasi FK historis.';
      } else if (res.code === 'PROTECTED_RECORD' || res.code === 'ACTIVE_IMPORT_IN_PROGRESS') {
        itemRes.status = 'protected';
        itemRes.code = res.code;
        itemRes.message = res.error || 'Record dilindungi / terkunci.';
      } else {
        itemRes.status = 'failed';
        itemRes.code = res.code || 'PERMANENT_DELETE_FAILED';
        itemRes.message = res.error || 'Gagal melakukan hapus permanen.';
        op.lastError = itemRes.message;
      }
    }

    recomputeOperationCounters(op);
    await finalizeOperationAuditIfCompleted(bridge, actor, op);
    await savePermanentDeleteOperation(bridge, op);

    return { success: true, operation: op };
  } finally {
    releaseOperationStepMutex(cleanId);
  }
}

export async function auditRecentPermanentDeletes(
  bridge: LocalStoreBridge,
  limit = 60
): Promise<{
  totalLogsChecked: number;
  recentLogs: DeletionLogRecord[];
  woExistenceMap: Record<string, { exists: boolean; isDeleted?: boolean; woNumber?: string }>;
}> {
  const hist = await listDeletionHistory(bridge, {
    deletionType: 'permanent_delete',
    page: 1,
    pageSize: Math.min(100, Math.max(10, limit))
  });
  const logs = hist.logs || [];
  const woIds = Array.from(
    new Set(logs.filter(l => l.category === 'work_orders' && l.recordId).map(l => String(l.recordId)))
  ).slice(0, 100);
  const woExistenceMap: Record<string, { exists: boolean; isDeleted?: boolean; woNumber?: string }> = {};

  if (woIds.length > 0) {
    if (bridge.isSupabaseMode()) {
      const client = getSupabaseBackendClient();
      if (client) {
        const { data } = await client
          .from('work_orders')
          .select('id, wo_number, is_deleted')
          .in('id', woIds);
        const foundMap = new Map<string, any>();
        for (const r of data || []) foundMap.set(String(r.id), r);
        for (const id of woIds) {
          const row = foundMap.get(id);
          woExistenceMap[id] = row
            ? { exists: true, isDeleted: Boolean(row.is_deleted), woNumber: String(row.wo_number || '') }
            : { exists: false };
        }
      }
    } else if (bridge.isLocalJsonModeAllowed()) {
      ensureLocalCollections(bridge.db);
      for (const id of woIds) {
        const row = (bridge.db.tickets || []).find((t: any) => String(t.id) === id);
        woExistenceMap[id] = row
          ? { exists: true, isDeleted: Boolean(row.isDeleted), woNumber: String(row.woNumber || '') }
          : { exists: false };
      }
    }
  }

  return {
    totalLogsChecked: logs.length,
    recentLogs: logs,
    woExistenceMap
  };
}

export async function executePermanentDeleteBatch(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  targets: DeletionTargetInput[],
  confirmText: string,
  reason: string,
  options?: { operationId?: string; chunkSize?: number }
): Promise<{
  success: boolean;
  transactionId: string;
  operationId?: string;
  code?: string;
  error?: string;
  succeeded: any[];
  failed: Array<{ recordId: string; category: string; code: string; error: string }>;
  operation?: PermanentDeleteOperationState;
}> {
  const startRes = await startPermanentDeleteOperation(bridge, actor, targets, confirmText, reason, options);
  if (!startRes.success || !startRes.operation) {
    return {
      success: false,
      transactionId: makeTxId('tx_pdb'),
      code: startRes.code,
      error: startRes.error,
      succeeded: [],
      failed:
        startRes.code === 'FORBIDDEN_ROLE'
          ? targets.map(t => ({
              recordId: t.recordId,
              category: t.category,
              code: 'FORBIDDEN_ROLE',
              error: 'Hanya Superadmin yang dapat melakukan Permanent Delete.'
            }))
          : []
    };
  }

  let op = startRes.operation;
  if (op.status === 'preparing' || op.status === 'verifying' || op.status === 'processing') {
    while (op.nextIndex < op.totalCount && (op.status === 'preparing' || op.status === 'verifying' || op.status === 'processing')) {
      const stepRes = await stepPermanentDeleteOperation(bridge, actor, op.operationId, op.chunkSize);
      if (!stepRes.success && !stepRes.operation) {
        return {
          success: false,
          transactionId: op.operationId,
          operationId: op.operationId,
          code: stepRes.code || 'PERMANENT_DELETE_BATCH_ERROR',
          error: stepRes.error || 'Gagal menjalankan batch hapus permanen.',
          succeeded: [],
          failed: []
        };
      }
      if (stepRes.inProgress) {
        break;
      }
      if (stepRes.operation) {
        op = stepRes.operation;
      } else {
        break;
      }
    }
  }

  const succeeded = op.results
    .filter(r => r.status === 'deleted' || r.status === 'already_deleted')
    .map(r => ({ deletedId: r.recordId, woNumber: r.woNumber, status: r.status }));

  const failed = op.results
    .filter(r => r.status === 'blocked_fk' || r.status === 'protected' || r.status === 'failed')
    .map(r => ({
      recordId: r.recordId,
      category: r.category,
      code: r.code || 'PERMANENT_DELETE_REJECTED',
      error: r.message || 'Gagal melakukan hapus permanen.'
    }));

  return {
    success: failed.length === 0 && succeeded.length > 0,
    transactionId: op.results.find(r => r.transactionId)?.transactionId || op.operationId,
    operationId: op.operationId,
    code: failed.length > 0 && succeeded.length === 0 ? failed[0].code : undefined,
    error: failed.length > 0 && succeeded.length === 0 ? failed[0].error : undefined,
    succeeded,
    failed,
    operation: op
  };
}

export async function executeRestoreBatch(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  targets: DeletionTargetInput[],
  reason?: string
): Promise<{
  success: boolean;
  transactionId: string;
  succeeded: any[];
  failed: Array<{ recordId: string; category: string; code: string; error: string }>;
}> {
  const txId = makeTxId('tx_rs');
  if (actor.role !== 'super_admin') {
    throw Object.assign(new Error('Akses Ditolak: Fitur Restore Data hanya diperbolehkan untuk role Superadmin.'), {
      statusCode: 403,
      code: 'FORBIDDEN_ROLE'
    });
  }

  const cleanReason = String(reason || '').trim() || 'Pemulihan data melalui Centralized Data Deletion Management';
  const succeeded: any[] = [];
  const failed: Array<{ recordId: string; category: string; code: string; error: string }> = [];

  for (const target of targets) {
    const lockKey = `${target.category}:${target.recordId}`;
    if (!acquireRecordLock(lockKey, txId, actor.name)) {
      failed.push({
        recordId: target.recordId,
        category: target.category,
        code: 'CONCURRENT_DELETION_LOCKED',
        error: 'Record sedang diproses oleh transaksi lain.'
      });
      continue;
    }

    try {
      const res = await executeSingleRestore(bridge, actor, target, cleanReason, txId);
      if (res.success) {
        succeeded.push(res.data);
      } else {
        failed.push({
          recordId: target.recordId,
          category: target.category,
          code: res.code || 'RESTORE_FAILED',
          error: res.error || 'Gagal memulihkan data.'
        });
      }
    } finally {
      releaseRecordLock(lockKey, txId);
    }
  }

  return {
    success: failed.length === 0 && succeeded.length > 0,
    transactionId: txId,
    succeeded,
    failed
  };
}

async function executeSingleRestore(
  bridge: LocalStoreBridge,
  actor: DeletionActor,
  target: DeletionTargetInput,
  cleanReason: string,
  txId: string
): Promise<{ success: boolean; data?: any; code?: string; error?: string }> {
  const { category, recordId, subEntity } = target;
  const sourceTable = resolveSourceTable(category, subEntity);
  const nowIso = new Date().toISOString();

  if (bridge.isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (!client) return { success: false, code: 'DATABASE_UNAVAILABLE', error: 'Supabase tidak tersedia.' };

    if (category === 'work_orders') {
      const rpcRes = await client.rpc('morajaws_restore_wo_tx', {
        p_wo_id: recordId,
        p_reason: cleanReason,
        p_actor_id: actor.id,
        p_actor_name: actor.name,
        p_actor_role: actor.role,
        p_transaction_id: txId
      });

      if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
        const d: any = rpcRes.data;
        if (!d.success) {
          return { success: false, code: d.code || 'RESTORE_REJECTED', error: d.message };
        }
        const restored = postgresRowToTicket(d.workOrder);
        bridge.broadcastSupabaseChange('work_orders', 'UPDATE', restored);
        return { success: true, data: restored };
      }
    }

    const tbl = category === 'other_data' ? resolveSourceTable('other_data', subEntity) : sourceTable;
    if (category === 'work_orders') {
      const { data: woRow } = await client.from('work_orders').select('*').eq('id', recordId).maybeSingle();
      if (!woRow) return { success: false, code: 'NOT_FOUND', error: 'Work Order tidak ditemukan.' };
      if (isProtectedWorkOrder(woRow)) return { success: false, code: 'PROTECTED_RECORD', error: 'Record WO produksi dilindungi.' };
      const canon = canonicalWoKey(woRow.wo_number);
      if (woRow.is_deleted && canon) {
        const { data: conflict } = await client.from('work_orders').select('id').eq('is_deleted', false).ilike('wo_number', normalizeWoNumber(woRow.wo_number)).neq('id', woRow.id).limit(1).maybeSingle();
        if (conflict) {
          return { success: false, code: 'DUPLICATE_ACTIVE_WO', error: `Tidak dapat memulihkan WO ${woRow.wo_number} karena sudah ada WO aktif dengan nomor sama (${conflict.id}).` };
        }
      }
    }

    const patch: Record<string, any> = {
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      deletion_reason: null
    };
    if (tbl === 'work_orders') {
      patch.is_archived = false;
      patch.archived_at = null;
      patch.archived_by = null;
      patch.updated_at = nowIso;
      patch.updated_by = actor.name;
    }
    if (tbl === 'users') patch.active = true;

    const { data, error } = await client.from(tbl).update(patch).eq('id', recordId).select('*');
    if (error || !data?.length) {
      const msg = error ? classifySupabaseError(error).message : `Record "${recordId}" tidak ditemukan di ${tbl}.`;
      return { success: false, code: 'RESTORE_FAILED', error: msg };
    }
    await recordDeletionLog(bridge, {
      transactionId: txId, deletionType: 'restore', category, sourceTable: tbl, recordId,
      woNumber: data[0]?.wo_number || null, actorUserId: actor.id, actorName: actor.name, actorRole: actor.role,
      reason: cleanReason, relatedCounts: {}, status: 'success'
    });
    const out = tbl === 'work_orders' ? postgresRowToTicket(data[0]) : sanitizeDeletionPayload(data[0]);
    if (tbl === 'work_orders') bridge.broadcastSupabaseChange('work_orders', 'UPDATE', out);
    return { success: true, data: out };
  }

  // Local JSON Mode
  ensureLocalCollections(bridge.db);
  let woNumber: string | null = null;
  let restored: any = null;

  if (category === 'work_orders') {
    const t = bridge.db.tickets.find((x: any) => String(x.id) === recordId);
    if (!t) return { success: false, code: 'NOT_FOUND', error: 'Work Order tidak ditemukan.' };
    if (isProtectedWorkOrder(t)) return { success: false, code: 'PROTECTED_RECORD', error: 'Record WO produksi dilindungi.' };
    const norm = canonicalWoKey(t.woNumber);
    const conflict = t.isDeleted && norm
      ? bridge.db.tickets.find((x: any) => !x.isDeleted && String(x.id) !== String(t.id) && canonicalWoKey(x.woNumber) === norm)
      : null;
    if (conflict) {
      await recordDeletionLog(bridge, {
        transactionId: txId, deletionType: 'restore', category, sourceTable: 'work_orders', recordId: t.id,
        woNumber: t.woNumber, actorUserId: actor.id, actorName: actor.name, actorRole: actor.role,
        reason: cleanReason, relatedCounts: {}, status: 'rejected',
        errorMessage: `DUPLICATE_ACTIVE_WO: Konflik dengan WO aktif ${conflict.id}`
      });
      return { success: false, code: 'DUPLICATE_ACTIVE_WO', error: `Tidak dapat memulihkan WO ${t.woNumber} karena sudah terdapat WO aktif dengan nomor yang sama (${conflict.id}).` };
    }
    t.isDeleted = false;
    t.deletedAt = undefined;
    t.deletedBy = undefined;
    t.deletionReason = undefined;
    t.isArchived = false;
    t.archivedAt = undefined;
    t.archivedBy = undefined;
    t.updatedAt = nowIso;
    t.updatedBy = actor.name;
    woNumber = t.woNumber;
    restored = t;
  } else if (category === 'assignment_history') {
    const r = bridge.db.assignmentHistory.find((x: any) => String(x.id) === recordId);
    if (!r) return { success: false, code: 'NOT_FOUND', error: 'Record tidak ditemukan.' };
    r.isDeleted = false; r.deletedAt = undefined; r.deletedBy = undefined; r.deletionReason = undefined;
    woNumber = r.woNumber || null; restored = r;
  } else if (category === 'technical_reports') {
    const r = bridge.db.technicalReports.find((x: any) => String(x.id) === recordId);
    if (r) {
      r.isDeleted = false; r.deletedAt = undefined; r.deletedBy = undefined; r.deletionReason = undefined;
      woNumber = r.woNumber || null; restored = r;
    } else if (recordId.startsWith('tr_')) {
      const t = bridge.db.tickets.find((x: any) => String(x.id) === recordId.slice(3) && x.technicalReport);
      if (!t) return { success: false, code: 'NOT_FOUND', error: 'Report tidak ditemukan.' };
      t.technicalReport.isDeleted = false; delete t.technicalReport.deletedAt; delete t.technicalReport.deletedBy; delete t.technicalReport.deletionReason;
      woNumber = t.woNumber; restored = { id: recordId, workOrderId: t.id, woNumber: t.woNumber, isDeleted: false };
    } else {
      return { success: false, code: 'NOT_FOUND', error: 'Report tidak ditemukan.' };
    }
  } else if (category === 'ticket_messages') {
    const m = bridge.db.ticketMessages.find((x: any) => String(x.id) === recordId);
    if (!m) return { success: false, code: 'NOT_FOUND', error: 'Pesan tidak ditemukan.' };
    m.isDeleted = false; m.deletedAt = undefined; m.deletedBy = undefined; m.deletionReason = undefined;
    woNumber = m.woNumber || null; restored = m;
  } else if (category === 'attachments') {
    const a = bridge.db.attachments.find((x: any) => String(x.id) === recordId) ||
      bridge.db.storageMetadata.find((x: any) => String(x.id || x.fileId || x.filePath) === recordId);
    if (!a) return { success: false, code: 'NOT_FOUND', error: 'Attachment tidak ditemukan.' };
    a.isDeleted = false; a.deletedAt = undefined; a.deletedBy = undefined; a.deletionReason = undefined;
    woNumber = a.woNumber || null; restored = a;
  } else if (category === 'import_history') {
    const h = bridge.db.importHistory.find((x: any) => String(x.id) === recordId) ||
      bridge.db.auditLogs.find((x: any) => x.entity === 'import_batch' && String(x.id) === recordId);
    if (!h) return { success: false, code: 'NOT_FOUND', error: 'Import history tidak ditemukan.' };
    h.isDeleted = false; h.deletedAt = undefined; h.deletedBy = undefined; h.deletionReason = undefined;
    restored = h;
  } else if (category === 'other_data') {
    if (subEntity === 'users') {
      const u = bridge.db.users.find((x: any) => String(x.id) === recordId);
      if (!u) return { success: false, code: 'NOT_FOUND', error: 'User tidak ditemukan.' };
      u.isDeleted = false; u.active = true; u.deletedAt = undefined; u.deletedBy = undefined; u.deletionReason = undefined;
      restored = sanitizeDeletionPayload(u);
    } else if (subEntity === 'contractors') {
      const c = bridge.db.contractors.find((x: any) => String(x.id) === recordId);
      if (!c) return { success: false, code: 'NOT_FOUND', error: 'Kontraktor tidak ditemukan.' };
      c.isDeleted = false; c.deletedAt = undefined; c.deletedBy = undefined; c.deletionReason = undefined;
      restored = c;
    } else if (subEntity === 'coverage_areas') {
      const a = bridge.db.coverageAreas.find((x: any) => String(x.id) === recordId);
      if (!a) return { success: false, code: 'NOT_FOUND', error: 'Area tidak ditemukan.' };
      a.isDeleted = false; a.deletedAt = undefined; a.deletedBy = undefined; a.deletionReason = undefined;
      restored = a;
    } else if (subEntity === 'wa_templates') {
      const t = bridge.db.templates.find((x: any) => String(x.id) === recordId);
      if (!t) return { success: false, code: 'NOT_FOUND', error: 'Template tidak ditemukan.' };
      t.isDeleted = false; t.deletedAt = undefined; t.deletedBy = undefined; t.deletionReason = undefined;
      restored = t;
    } else if (subEntity === 'droplist_items') {
      if (recordId.startsWith('status:') && Array.isArray(bridge.db.appSettings?.hierarchical_droplists)) {
        const st = bridge.db.appSettings.hierarchical_droplists.find((s: any) => String(s.id) === recordId.slice(7));
        if (st) { st.isDeleted = false; delete st.deletedAt; delete st.deletedBy; delete st.deletionReason; restored = st; }
      } else if (recordId.startsWith('reason:') && Array.isArray(bridge.db.appSettings?.hierarchical_droplists)) {
        const [, stId, rId] = recordId.split(':');
        const st = bridge.db.appSettings.hierarchical_droplists.find((s: any) => String(s.id) === stId);
        const r = st?.reasons?.find((x: any) => String(x.id) === rId);
        if (r) { r.isDeleted = false; delete r.deletedAt; delete r.deletedBy; delete r.deletionReason; restored = r; }
      } else if (recordId.startsWith('static:') && Array.isArray(bridge.db.appSettings?.static_droplist_categories)) {
        const [, catId, itemId] = recordId.split(':');
        const cat = bridge.db.appSettings.static_droplist_categories.find((c: any) => String(c.id) === catId);
        const item = cat?.items?.find((x: any) => String(x.id) === itemId);
        if (item) { item.isDeleted = false; delete item.deletedAt; delete item.deletedBy; delete item.deletionReason; restored = item; }
      }
      if (!restored) return { success: false, code: 'NOT_FOUND', error: 'Droplist item tidak ditemukan.' };
    } else if (subEntity === 'chat_categories') {
      const cc = Array.isArray(bridge.db.appSettings?.chat_categories)
        ? bridge.db.appSettings.chat_categories.find((c: any) => String(c.id) === recordId)
        : null;
      if (!cc) return { success: false, code: 'NOT_FOUND', error: 'Chat category tidak ditemukan.' };
      cc.isDeleted = false; delete cc.deletedAt; delete cc.deletedBy; delete cc.deletionReason;
      restored = cc;
    }
  }

  if (!restored) return { success: false, code: 'NOT_FOUND', error: 'Record tidak ditemukan.' };

  bridge.saveDatabaseToDisk();
  await recordDeletionLog(bridge, {
    transactionId: txId,
    deletionType: 'restore',
    category,
    sourceTable,
    recordId,
    woNumber,
    actorUserId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    reason: cleanReason,
    relatedCounts: {},
    status: 'success'
  });
  await bridge.logServerAuditAsync(`Centralized Restore (${category})`, sourceTable, recordId, `${sourceTable} ${woNumber || recordId} dipulihkan oleh ${actor.name}`, actor, { transactionId: txId });
  if (category === 'work_orders') {
    bridge.broadcastSupabaseChange('work_orders', 'UPDATE', restored);
  }
  return { success: true, data: sanitizeDeletionPayload(restored) };
}
