import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  Ticket,
  WhatsAppTemplate,
  WorkflowRule,
  AuditLog,
  User,
  UserRole,
  TicketActivity,
  WhatsAppMessageLog,
  HeaderMapping,
  Contractor,
  CoverageArea,
  RootCauseCategory,
  TechnicalReport,
  ProgressReportEntry,
  TicketStatusWOInstaller,
  TicketMessage,
  ChatAttachment,
  CanonicalFieldConfig,
  WOAssignmentHistory,
  ReportDropdownCategory,
  DataSyncStatus,
  ChatCategoryConfig,
  HierarchicalStatus,
  HierarchicalReason,
  HierarchicalRemark,
  WOApprovalStatus,
  DispatchApprovalWoAgentStatus,
  WOKpiSummary,
  WOKpiFilterKey,
  OverdueSummaryMetrics,
  WoClassificationSummary,
  RealtimeConnectionState,
  RealtimeStatusInfo,
  UserPresenceInfo,
  TypingIndicatorInfo
} from '../types/index.ts';
import {
  classifyWorkOrder,
  summarizeWorkOrderClassifications
} from '../services/woClassificationService';
import { installerGpsTracker } from '../services/installerGpsTrackingService';
import {
  dedupedFetch,
  getWoCache,
  setWoCache,
  invalidateWoCache,
  shouldThrottleViewRevalidation,
  markTicketEditingState,
  isTicketBeingEdited,
  mergeDeltaTickets,
  mergeProgressiveHydration
} from '../services/woSyncEngine';

import {
  INITIAL_SAMPLE_TICKETS,
  DEFAULT_WHATSAPP_TEMPLATES,
  DEFAULT_WORKFLOW_RULES,
  STANDARD_HEADER_MAPPINGS,
  DEFAULT_CONTRACTORS,
  DEFAULT_COVERAGE_AREAS,
  DEFAULT_ROOT_CAUSE_CATEGORIES,
  DEFAULT_WORK_RESULTS,
  DEFAULT_USERS
} from '../constants/defaultConfig';
import { executeWorkflowsOnTicket } from '../services/workflowEngine';
import { renderWhatsAppMessage, buildWhatsAppClickToChatUrl } from '../services/whatsappService';
import {
  MASTER_CANONICAL_FIELDS,
  autoDistributeTicket,
  runWODistributionEngine,
  extractContractorsFromTickets,
  generateContractorCode,
  processRawImportWithEngine,
  reassignWOTechnician
} from '../services/woFieldMappingEngine';
import {
  DEFAULT_PASSWORD_HASH,
  quickHash,
  Permission,
  hasPermission as checkPermission,
  DEFAULT_ROLE_PERMISSIONS,
  setDynamicRolePermissions,
  getRolePermissionsSnapshot
} from '../services/authService';
import { GoogleSheetsConfig, SheetSyncResult, DEFAULT_SHEETS_CONFIG } from '../types/sheets.ts';
import {
  pullRowsFromSheet,
  pushTicketsToSheet,
  getAccessToken
} from '../services/googleSheetsService.ts';
import {
  calculateDurationMinutes,
  formatWorkDuration,
  isProgressCategory,
  formatJakartaTimestamp
} from '../services/workSessionService';
import { useToast } from './ToastContext';
import { saveTicketsOffline, cacheMasterData, getOfflineTickets, removeSyncQueueItem } from '../services/offlineDb';
import { useOfflineSync } from './OfflineSyncContext';
import {
  saveGlobalAppSettingsToSupabase,
  loadGlobalAppSettingsFromSupabase,
  saveReportDropdownCategoryToSupabase,
  deleteReportDropdownCategoryFromSupabase,
  softDeleteReportDropdownCategoryInSupabase,
  loadReportDropdownCategoriesFromSupabase,
  INITIAL_REPORT_DROPDOWN_CATEGORIES,
  INITIAL_CHAT_CATEGORIES,
  saveChatCategoriesToSupabase,
  loadChatCategoriesFromSupabase,
  INITIAL_HIERARCHICAL_DROPLISTS,
  saveHierarchicalDroplistsToSupabase,
  loadHierarchicalDroplistsFromSupabase,
  reconcileDroplistData
} from '../services/supabaseConfigService';
import { supabaseDb } from '../services/supabaseDb';
import {
  bootstrapGlobalConfigs,
  getGlobalConfig,
  saveGlobalConfig,
  getRolePermissionsFromServer,
  saveRolePermissionsToServer,
  subscribeToGlobalConfigUpdates,
  ConfigConflictError,
  GlobalConfigConflictDetails,
  getTrackedConfigVersion,
  setTrackedConfigVersion
} from '../services/globalConfigService';
import { auditAndCleanDuplicates, DuplicateAuditReport } from '../services/woDeduplicationService';

import { getJakartaDateString, getJakartaDateParts, getTicketAppointmentDate } from '../services/appointmentDateParser';
import { getMsUntilNextJakartaMidnight } from '../services/woDateFilterEngine';
import {
  normalizeWoNumber,
  isValidWoNumber,
  getDeterministicTicketId,
  validateAndDeduplicateImportBatch,
  deduplicateTicketsInMemory
} from '../services/woDeduplicationService';
import {
  getDispatchApprovalOutcomeLabel,
  getRecommendedDispatchWoAgentStatus,
  isTicketClosed,
  normalizeDispatchWoAgentStatus
} from '../services/woLifecycleService';

interface AppContextType {
  // Current user & RBAC
  currentUser: User;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; user?: User; errorCode?: string }>;
  logout: () => void;
  refreshAuthSession: () => Promise<boolean>;
  users: User[];
  hasPermission: (permission: Permission) => boolean;
  rolePermissions: Record<UserRole, string[]>;
  rolePermissionsVersion: number;
  updateRolePermissions: (
    matrix: Record<string, string[]>,
    options?: { forceOverwrite?: boolean; notes?: string }
  ) => Promise<{ success: boolean; error?: string }>;
  globalConflict: GlobalConfigConflictDetails | null;
  clearGlobalConflict: () => void;
  resolveGlobalConflict: (strategy: 'reload' | 'overwrite') => Promise<void>;
  canDelete: boolean;
  canImport: boolean;
  canEditWOData: boolean;
  operationalDate: string;
  todayWIB: string;
  setOperationalDate: (
    date: string,
    options?: { isAuto?: boolean; forceOverwrite?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;
  isSessionModalOpen: boolean;
  setIsSessionModalOpen: (open: boolean) => void;
  isChangePasswordModalOpen: boolean;
  setIsChangePasswordModalOpen: (open: boolean) => void;

  // WO Lifecycle KPI Summary & Drill-Down
  kpiSummary: WOKpiSummary | null;
  isKpiLoading: boolean;
  kpiError: string | null;
  kpiContractorFilter: string;
  kpiAreaFilter: string;
  setKpiContractorFilter: (v: string) => void;
  setKpiAreaFilter: (v: string) => void;
  lastKpiUpdatedAt: string | null;
  refreshKpiSummary: (opts?: { date?: string; contractor?: string; area?: string; silent?: boolean }) => Promise<void>;
  activeKpiDrilldown: { filterKey: WOKpiFilterKey; dateWIB?: string; contractor?: string; area?: string } | null;
  setActiveKpiDrilldown: (val: { filterKey: WOKpiFilterKey; dateWIB?: string; contractor?: string; area?: string } | null) => void;

  // Supabase PostgreSQL Real-time Sync & Connectivity
  databaseStatus: 'connected' | 'connecting' | 'offline' | 'error';
  databaseLoading: boolean;
  isDatabaseReady: boolean;
  realtimeConnectionState: RealtimeConnectionState;
  realtimeStatusInfo: RealtimeStatusInfo;
  reconnectRealtimeNow: () => void;

  // Requirement F: Real-time Cloud Sync Status Management
  syncStatus: DataSyncStatus;
  lastSyncTime: string | null;
  syncError: string | null;
  refreshDatabaseData: () => Promise<void>;

  // User Management (Super Admin Exclusive)
  registerDispatchAccount: (data: { name: string; username: string; phone?: string; email?: string }) => { success: boolean; user?: User; error?: string };
  registerLeaderAccount: (data: { name: string; username: string; phone?: string; contractor: string; area: string; email?: string }) => { success: boolean; user?: User; error?: string };
  registerInstallerAccount: (data: { name: string; username: string; phone: string; email?: string }) => { success: boolean; user?: User; error?: string };
  toggleUserStatus: (userId: string) => { success: boolean; error?: string };
  resetUserPassword: (userId: string) => { success: boolean; newPassword?: string; error?: string };
  deleteUser: (userId: string, reason: string, permanent?: boolean) => { success: boolean; error?: string };
  updateUser: (userId: string, updates: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  executeComprehensiveDeduplication: () => Promise<DuplicateAuditReport>;

  // Contractors & Coverage Areas
  contractors: Contractor[];
  addContractor: (data: Omit<Contractor, 'id' | 'createdAt'>) => Promise<{ success: boolean; contractor?: Contractor; error?: string }>;
  updateContractor: (id: string, updates: Partial<Contractor>) => Promise<{ success: boolean; error?: string }>;
  deleteContractor: (contractorId: string) => Promise<{ success: boolean; error?: string }>;
  autoRegisterContractors: (contractorsToRegister: Contractor[], newCoverageAreas?: CoverageArea[]) => { addedCount: number; updatedCount: number };
  coverageAreas: CoverageArea[];
  addCoverageArea: (data: Omit<CoverageArea, 'id'>) => Promise<{ success: boolean; area?: CoverageArea; error?: string }>;
  updateCoverageArea: (id: string, updates: Partial<CoverageArea>) => Promise<{ success: boolean; error?: string }>;
  deleteCoverageArea: (areaId: string) => Promise<{ success: boolean; error?: string }>;

  // Root Causes & Technical Reports
  rootCauseCategories: RootCauseCategory[];
  workResultsList: string[];
  updateRootCauseCategories: (
    categories: RootCauseCategory[],
    options?: { forceOverwrite?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;
  saveTechnicalReport: (
    ticketId: string,
    reportData: Omit<TechnicalReport, 'id' | 'ticketId' | 'submittedAt' | 'submittedBy'>
  ) => { success: boolean; error?: string; code?: string };
  saveProgressReport: (
    ticketId: string,
    data: {
      reportStatus: string;
      reasonReport: string;
      rootCause?: string;
      remarksReport: string;
      reportStatusId?: string;
      reportStatusLabel?: string;
      reasonReportId?: string;
      reasonReportLabel?: string;
      rootcauseId?: string;
      rootcauseLabel?: string;
      technicalTelemetry?: {
        opticalPowerDbm?: string;
        fatRedamanDbm?: string;
        ontSerialNumber?: string;
        dropcoreLength?: string;
        fatPort?: string;
        usedMaterials?: string;
        photos?: string[];
        photoSlots?: import('../types/index.ts').TechnicalPhotoSlot[];
        customerSignatureUrl?: string;
        customerConsentConfirmed?: boolean;
      };
    }
  ) => Promise<{ success: boolean; error?: string; code?: string; report?: ProgressReportEntry }>;
  verifyTechnicalReport: (ticketId: string) => void;
  uploadWoPhotoEvidence: (
    ticketId: string,
    payload: {
      slotKey: import('../types/index.ts').TechnicalPhotoSlotKey;
      title: string;
      fileData: string;
      fileName: string;
      mimeType: string;
      capturedAt: string;
      latitude?: number;
      longitude?: number;
      gpsAccuracyMeters?: number;
      altitudeMeters?: number;
      headingDeg?: number;
      speedMps?: number;
      locationSource?: string;
      permissionStatus?: string;
      geotagStatus?: import('../types/index.ts').GeotagStatus;
      captureMethod?: 'camera' | 'gallery';
      badgeText?: string;
      statusTag?: string;
      clientCaptureId: string;
      woNumber?: string;
      requireLiveCamera?: boolean;
      fieldNotes?: string;
    }
  ) => Promise<{
    success: boolean;
    photoSlot?: import('../types/index.ts').TechnicalPhotoSlot;
    houseLocation?: import('../types/index.ts').WorkOrderGeoLocation;
    fatLocation?: import('../types/index.ts').WorkOrderGeoLocation;
    ticket?: Ticket;
    error?: string;
    offline?: boolean;
  }>;
  deleteWoPhotoEvidence: (
    ticketId: string,
    slotKey: import('../types/index.ts').TechnicalPhotoSlotKey
  ) => Promise<{
    success: boolean;
    ticket?: Ticket;
    error?: string;
  }>;
  submitKendalaReport: (
    ticketId: string,
    payload: {
      reasonId?: string;
      reasonLabel?: string;
      description: string;
      fileData: string;
      fileName: string;
      mimeType: string;
      targetInstallerStatus?: 'Pending Technical' | 'Failed / Cancelled';
    }
  ) => Promise<{
    success: boolean;
    kendalaReport?: import('../types/index.ts').KendalaReportEntry;
    ticket?: Ticket;
    error?: string;
  }>;
  startWorkOnTicket: (ticketId: string) => Promise<{ success: boolean; error?: string; ticket?: Ticket }>;
  approveProgressReport: (
    ticketId: string,
    notes?: string,
    options?: { woAgentStatus?: DispatchApprovalWoAgentStatus; remarksAgent?: string }
  ) => Promise<{ success: boolean; error?: string }>;
  rejectProgressReport: (ticketId: string, reason: string) => Promise<{ success: boolean; error?: string }>;

  // Report Dropdown Categories (Report Status, Reason Report, Rootcause)
  reportDropdownCategories: ReportDropdownCategory[];
  isDropdownCategoriesLoading: boolean;
  addReportDropdownCategory: (data: Omit<ReportDropdownCategory, 'id' | 'createdAt'>) => Promise<{ success: boolean; category?: ReportDropdownCategory; error?: string }>;
  updateReportDropdownCategory: (id: string, updates: Partial<ReportDropdownCategory>) => Promise<{ success: boolean; error?: string }>;
  deleteReportDropdownCategory: (id: string, permanent?: boolean) => Promise<{ success: boolean; error?: string }>;
  toggleReportDropdownCategoryActive: (id: string) => Promise<{ success: boolean; error?: string }>;


  // Ticket Operations
  tickets: Ticket[];
  scopedTickets: Ticket[];
  activeTodayTickets: Ticket[];
  scopedActiveTickets: Ticket[];
  overdueTickets: Ticket[];
  exceptionTickets: Ticket[];
  overdueSummary: OverdueSummaryMetrics;
  classificationSummary: WoClassificationSummary;
  refreshOverdueTickets: () => Promise<void>;
  refreshActiveTickets: () => Promise<void>;
  getTicketById: (id: string) => Ticket | undefined;
  createTicket: (ticket: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'isArchived'>) => Ticket;
  updateTicket: (id: string, updates: Partial<Ticket>, reason?: string) => { success: boolean; error?: string };
  assignTicketPersonnel: (ticketId: string, leaderName?: string, installerName?: string) => void;
  bulkAssignPersonnel: (ticketIds: string[], leaderName?: string, installerName?: string, slotTime?: string, remarks?: string) => { success: boolean; count: number };
  reassignTicketPersonnel: (ticketId: string, newInstallerName: string, reason: string) => { success: boolean; error?: string; historyEntry?: WOAssignmentHistory };
  updateTicketStatus: (ticketId: string, statusAgent?: any, statusInstaller?: any, remarks?: string) => void;
  reopenTicket: (ticketId: string, reason: string) => { success: boolean; error?: string };
  archiveTicket: (ticketId: string) => void;
  restoreTicket: (ticketId: string) => void;
  deleteTicket: (ticketId: string, reason: string, permanent?: boolean) => { success: boolean; error?: string };
  bulkDeleteTickets: (ticketIds: string[], reason: string) => { success: boolean; count: number; error?: string };
  deleteCustomerData: (customerId: string, reason: string) => { success: boolean; error?: string };
  bulkImportTickets: (
    imported: Partial<Ticket>[],
    options?: { duplicatePolicy?: 'skip' | 'update_allowed' | 'review' }
  ) => { importedCount: number; updatedCount?: number; duplicatesIgnored: number; rejectedDuplicates?: string[]; distributedCount?: number; undistributedCount?: number };
  deleteImportedTicketsByDate: (importDate: string, reason: string) => { success: boolean; count: number; error?: string };

  // Live Chat
  ticketMessages: TicketMessage[];
  totalLiveChatUnreadCount: number;
  liveChatUnreadTicketsCount: number;
  presenceByUserId: Record<string, UserPresenceInfo>;
  typingByTicketId: Record<string, TypingIndicatorInfo[]>;
  sendTicketMessage: (ticketId: string, text: string, attachments?: ChatAttachment[], category?: string, options?: { clientMessageId?: string }) => Promise<{ success: boolean; error?: string; message?: TicketMessage; hasProgressTrigger?: boolean }>;
  retryTicketMessage: (localMessageId: string) => Promise<{ success: boolean; error?: string; message?: TicketMessage; hasProgressTrigger?: boolean }>;
  sendTypingIndicator: (ticketId: string, isTyping: boolean) => Promise<void>;
  loadOlderTicketMessages: (ticketId: string, beforeCursor?: string, limit?: number) => Promise<{ messages: TicketMessage[]; hasMore: boolean; nextCursor: string | null }>;
  uploadChatAttachment: (ticketId: string, file: File) => Promise<{ success: boolean; attachment?: ChatAttachment; error?: string }>;
  getMessagesForTicket: (ticketId: string) => TicketMessage[];
  refreshMessagesForTicket: (ticketId: string) => Promise<{ messages: TicketMessage[]; hasProgressTrigger: boolean }>;
  markTicketMessagesAsRead: (ticketId: string) => void;
  getTicketUnreadCount: (ticketId: string) => number;

  // Contact Center Chat Categories
  chatCategories: ChatCategoryConfig[];
  addChatCategory: (category: Omit<ChatCategoryConfig, 'id' | 'createdAt'>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  updateChatCategory: (id: string, updates: Partial<ChatCategoryConfig>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  deleteChatCategory: (id: string, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  toggleChatCategoryActive: (id: string, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  setTicketChatCategory: (ticketId: string, category: string) => Promise<void>;

  // Hierarchical Droplist Management (Level 1: Status WO -> Level 2: Reason WO -> Level 3: Remarks)
  hierarchicalStatuses: HierarchicalStatus[];
  saveHierarchicalDroplistsDirect: (
    statuses: HierarchicalStatus[],
    actionLabel?: string,
    options?: { forceOverwrite?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;
  addHierarchicalStatus: (status: Omit<HierarchicalStatus, 'id' | 'reasons'>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  updateHierarchicalStatus: (id: string, updates: Partial<HierarchicalStatus>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  deleteHierarchicalStatus: (id: string, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  addHierarchicalReason: (statusId: string, reason: Omit<HierarchicalReason, 'id' | 'statusId' | 'remarks'>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  updateHierarchicalReason: (statusId: string, reasonId: string, updates: Partial<HierarchicalReason>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  deleteHierarchicalReason: (statusId: string, reasonId: string, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  moveHierarchicalReason: (fromStatusId: string, toStatusId: string, reasonId: string, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  addHierarchicalRemark: (statusId: string, reasonId: string, remark: Omit<HierarchicalRemark, 'id' | 'reasonId'>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  updateHierarchicalRemark: (statusId: string, reasonId: string, remarkId: string, updates: Partial<HierarchicalRemark>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  deleteHierarchicalRemark: (statusId: string, reasonId: string, remarkId: string, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  getReasonsForStatus: (statusName: string) => HierarchicalReason[];
  getRemarksForReason: (statusName: string, reasonName: string) => HierarchicalRemark[];
  reconcileDroplistsNow: (options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; changedCount: number; message: string }>;


  // WhatsApp Operations
  templates: WhatsAppTemplate[];
  createTemplate: (template: Omit<WhatsAppTemplate, 'id' | 'version' | 'lastUpdated'>) => WhatsAppTemplate;
  updateTemplate: (id: string, updates: Partial<WhatsAppTemplate>) => void;
  deleteTemplate: (id: string) => void;
  getWhatsAppPreviewForTicket: (ticketId: string, templateId?: string) => { text: string; url: string; error?: string; missingVars: string[] };
  recordWhatsAppOpened: (ticketId: string, url: string, messageBody: string) => void;
  recordWhatsAppConfirmed: (ticketId: string, notes: string) => void;
  recordWhatsAppReschedule: (ticketId: string, notes: string) => void;
  recordWhatsAppUnreachable: (ticketId: string, notes: string) => void;

  // Workflows
  workflowRules: WorkflowRule[];
  toggleWorkflowRule: (ruleId: string, enabled: boolean, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  updateWorkflowRule: (ruleId: string, updates: Partial<WorkflowRule>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;

  // Header Mappings & Central Canonical Field Engine
  headerMappings: HeaderMapping[];
  updateHeaderMapping: (field: string, aliases: string[], options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  canonicalFields: CanonicalFieldConfig[];
  updateCanonicalFieldConfig: (field: string, updates: Partial<CanonicalFieldConfig>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;

  // Audit Logs & Activity
  auditLogs: AuditLog[];
  addAuditLog: (action: string, entity: AuditLog['entity'], entityId: string, details: string) => void;
  ticketActivities: TicketActivity[];
  waLogs: WhatsAppMessageLog[];

  // Google Sheets Auto-Sync
  googleSheetsConfig: GoogleSheetsConfig;
  updateGoogleSheetsConfig: (updates: Partial<GoogleSheetsConfig>, options?: { forceOverwrite?: boolean }) => Promise<{ success: boolean; error?: string }>;
  syncGoogleSheetsNow: (direction?: 'both' | 'export_only' | 'import_only') => Promise<SheetSyncResult>;

  // Helpers
  leadersList: string[];
  installersList: string[];
  contractorsList: string[];
  areasList: string[];

  // Toast Notifications
  toast: {
    success: (message: string, title?: string, duration?: number) => string;
    error: (message: string, title?: string, duration?: number) => string;
    warning: (message: string, title?: string, duration?: number) => string;
    info: (message: string, title?: string, duration?: number) => string;
  };
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info', title?: string, duration?: number) => string;

  // Offline Sync Center
  openOfflineSyncCenter: () => void;

  // Central Database Sync & Health
  isDataLoading: boolean;
  dataLoadError: string | null;
  loadCentralData: () => Promise<void>;
  syncStage: 'idle' | 'phase1_critical' | 'phase2_secondary' | 'phase3_background' | 'complete';
  isProgressiveHydrating: boolean;
  markTicketEditing: (ticketId: string | null | undefined, isEditing: boolean) => void;
  revalidateWoView: (viewKey: string, options?: { force?: boolean }) => Promise<void>;
  loadTicketDetailOnDemand: (ticketId: string) => Promise<{ ticket?: Ticket; messages?: TicketMessage[]; activities?: any[] } | null>;
  completeMandatoryPasswordChange: (payload: {
    user: User;
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    sessionId?: string;
    sessionVersion?: number;
  }) => Promise<void>;
  applyRotatedPasswordSession: (payload: {
    user: User;
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    sessionId?: string;
    sessionVersion?: number;
  }) => Promise<void>;
}

const STORAGE_KEYS = {
  USERS: 'morajaws_users_v4',
  TICKETS: 'morajaws_tickets_v4',
  CONTRACTORS: 'morajaws_contractors_v4',
  COVERAGE_AREAS: 'morajaws_coverage_areas_v4',
  ROOT_CAUSES: 'morajaws_root_causes_v4',
  MESSAGES: 'morajaws_messages_v4',
  TEMPLATES: 'morajaws_wa_templates_v4',
  WORKFLOWS: 'morajaws_workflows_v4',
  AUDIT: 'morajaws_audit_logs_v4',
  WA_LOGS: 'morajaws_wa_logs_v4',
  MAPPINGS: 'morajaws_mappings_v4',
  CANONICAL_FIELDS: 'morajaws_canonical_fields_v4',
  SHEETS_CONFIG: 'morajaws_sheets_config_v4'
};

// Purge legacy v1/v2/v3 sample storage keys on script evaluation
try {
  const legacyKeys = [
    'morajaws_users_v3', 'morajaws_tickets_v3', 'morajaws_contractors_v3',
    'morajaws_coverage_areas_v3', 'morajaws_messages_v3', 'morajaws_audit_logs_v3',
    'morajaws_wa_logs_v3', 'morajaws_users_v2', 'morajaws_tickets_v2',
    'morajaws_contractors_v2', 'morajaws_messages_v2'
  ];
  legacyKeys.forEach(k => localStorage.removeItem(k));
} catch (e) {}

export const normalizeContractor = (c: any): Contractor => {
  if (!c) return { id: '', name: '', code: '', coverageAreas: [], active: true, createdAt: '' };
  const rawAreas = c.coverageAreas ?? c.coverage_areas ?? [];
  const coverageAreas = Array.isArray(rawAreas) ? rawAreas.filter(Boolean).map(String) : [];
  return {
    ...c,
    id: String(c.id ?? ''),
    name: String(c.name ?? ''),
    code: String(c.code ?? ''),
    coverageAreas,
    leaderName: c.leaderName ?? c.leader_name ?? '',
    leaderPhone: c.leaderPhone ?? c.leader_phone ?? '',
    leaderEmail: c.leaderEmail ?? c.leader_email ?? ''
  };
};

export const deduplicateContractors = (list: Contractor[]): Contractor[] => {
  if (!Array.isArray(list)) return [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const result: Contractor[] = [];

  for (const raw of list) {
    if (!raw) continue;
    const c = normalizeContractor(raw);
    if (!c.name) continue;
    const cleanId = (c.id || '').trim();
    const cleanName = c.name.trim().toLowerCase();

    if (cleanId && seenIds.has(cleanId)) continue;
    if (cleanName && seenNames.has(cleanName)) continue;

    if (cleanId) seenIds.add(cleanId);
    if (cleanName) seenNames.add(cleanName);

    result.push(c);
  }
  return result;
};

const INITIAL_MESSAGES: TicketMessage[] = [];

export const UNAUTHENTICATED_USER: User = {
  id: '',
  name: 'Tamu',
  username: '',
  role: 'installer',
  active: false,
  createdAt: '2026-01-01T00:00:00Z'
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast, showToast } = useToast();
  const { isOnline, enqueueChange, registerAppSyncHandler, setIsOfflineModalOpen } = useOfflineSync();
  const [isDataLoading, setIsDataLoading] = useState<boolean>(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [syncStage, setSyncStage] = useState<'idle' | 'phase1_critical' | 'phase2_secondary' | 'phase3_background' | 'complete'>('idle');
  const [isProgressiveHydrating, setIsProgressiveHydrating] = useState<boolean>(false);
  const lastDeltaWatermarkRef = useRef<string>(new Date().toISOString());
  const syncRetryCountRef = useRef<number>(0);
  const protectedEditNotifiedRef = useRef<Set<string>>(new Set());
  const centralBootAbortRef = useRef<AbortController | null>(null);
  const deltaSyncAbortRef = useRef<AbortController | null>(null);
  const deltaSyncRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phase3IdleTimerRef = useRef<number | null>(null);

  const cancelPendingDeltaRetry = () => {
    if (deltaSyncRetryTimerRef.current) {
      clearTimeout(deltaSyncRetryTimerRef.current);
      deltaSyncRetryTimerRef.current = null;
    }
  };

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    try {
      const sessionStr = localStorage.getItem('morajaws_auth_session');
      if (sessionStr) {
        const sess = JSON.parse(sessionStr);
        if (sess.token) headers['Authorization'] = `Bearer ${sess.token}`;
        if (sess.userId) headers['x-user-id'] = sess.userId;
        if (sess.username) headers['x-username'] = sess.username;
      }
    } catch (e) {}
    return headers;
  };

  // Supabase PostgreSQL Real-time Sync & Connectivity Status
  const [databaseStatus, setDatabaseStatus] = useState<'connected' | 'connecting' | 'offline' | 'error'>('connecting');
  const [databaseLoading, setDatabaseLoading] = useState<boolean>(true);
  const [isDatabaseReady, setIsDatabaseReady] = useState<boolean>(false);

  // Requirement F: Real-time Cloud Sync Lifecycle Status
  const [syncStatus, setSyncStatus] = useState<DataSyncStatus>(navigator.onLine ? 'LOADING' : 'OFFLINE');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Global Super Admin Configs: Dynamic RBAC & 409 OCC Conflict State
  const [rolePermissions, setRolePermissions] = useState<Record<UserRole, string[]>>(() => getRolePermissionsSnapshot());
  const [rolePermissionsVersion, setRolePermissionsVersion] = useState<number>(1);
  const [globalConflict, setGlobalConflict] = useState<GlobalConfigConflictDetails | null>(null);
  const pendingGlobalMutationRef = useRef<{
    key: string;
    retry: () => Promise<{ success: boolean; error?: string }>;
  } | null>(null);

  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.USERS);
      if (saved) {
        const parsed: User[] = JSON.parse(saved);
        DEFAULT_USERS.forEach(defU => {
          if (!parsed.some(u => u.id === defU.id || u.username.toLowerCase() === defU.username.toLowerCase())) {
            parsed.push(defU);
          }
        });
        return parsed;
      }
    } catch (e) {}
    return DEFAULT_USERS;
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    try {
      const stored = localStorage.getItem('morajaws_logged_in');
      const sessionStr = localStorage.getItem('morajaws_auth_session');
      if (stored === 'true' && sessionStr) {
        const session = JSON.parse(sessionStr);
        const match = users.find(u => u.id === session.userId || u.username === session.username);
        if (match) return match;
        if (session && session.userId && session.role) {
          return {
            id: session.userId,
            name: session.name || session.username,
            username: session.username,
            role: session.role,
            contractor: session.contractor,
            contractorId: session.contractorId,
            area: session.area,
            email: session.email || `${session.username}@morajaws.net`,
            phone: session.phone,
            active: session.active !== false,
            createdAt: session.loginAt || new Date().toISOString()
          };
        }
      }
    } catch (e) {}
    return UNAUTHENTICATED_USER;
  });

  const [contractors, setContractors] = useState<Contractor[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CONTRACTORS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return deduplicateContractors(parsed);
        }
      }
    } catch (e) {}
    return deduplicateContractors(DEFAULT_CONTRACTORS);
  });

  const [coverageAreas, setCoverageAreas] = useState<CoverageArea[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.COVERAGE_AREAS);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEFAULT_COVERAGE_AREAS;
  });

  const [rootCauseCategories, setRootCauseCategories] = useState<RootCauseCategory[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ROOT_CAUSES);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEFAULT_ROOT_CAUSE_CATEGORIES;
  });

  const workResultsList = DEFAULT_WORK_RESULTS;

  const [tickets, setTickets] = useState<Ticket[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TICKETS);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed loading tickets from storage', e);
    }
    return [];
  });

  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);

  const [templates, setTemplates] = useState<WhatsAppTemplate[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TEMPLATES);
      if (saved) {
        const parsed: WhatsAppTemplate[] = JSON.parse(saved);
        const existingIds = new Set(parsed.map(t => t.id));
        const missing = DEFAULT_WHATSAPP_TEMPLATES.filter(t => !existingIds.has(t.id));
        return missing.length > 0 ? [...parsed, ...missing] : parsed;
      }
    } catch (e) {}
    return DEFAULT_WHATSAPP_TEMPLATES;
  });

  const [workflowRules, setWorkflowRules] = useState<WorkflowRule[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.WORKFLOWS);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEFAULT_WORKFLOW_RULES;
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.AUDIT);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      {
        id: 'audit-1',
        action: 'MoraJaws System Initialized',
        entity: 'auth',
        entityId: 'sys-0',
        details: 'MoraJaws operational with Contractors, Wi-Fi Root Cause Catalog, and Live Chat Engine',
        performedBy: 'System',
        userRole: 'super_admin',
        timestamp: new Date().toISOString()
      }
    ];
  });

  const [ticketActivities, setTicketActivities] = useState<TicketActivity[]>([]);

  const [waLogs, setWaLogs] = useState<WhatsAppMessageLog[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.WA_LOGS);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  const [headerMappings, setHeaderMappings] = useState<HeaderMapping[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MAPPINGS);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return STANDARD_HEADER_MAPPINGS;
  });

  const [reportDropdownCategories, setReportDropdownCategories] = useState<ReportDropdownCategory[]>(() => {
    try {
      const saved = localStorage.getItem('morajaws_report_dropdown_categories');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return INITIAL_REPORT_DROPDOWN_CATEGORIES;
  });

  const [isDropdownCategoriesLoading, setIsDropdownCategoriesLoading] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem('morajaws_report_dropdown_categories', JSON.stringify(reportDropdownCategories));
    } catch (e) {}
  }, [reportDropdownCategories]);

  // Contact Center Chat Categories state
  const [chatCategories, setChatCategories] = useState<ChatCategoryConfig[]>(() => {
    try {
      const saved = localStorage.getItem('morajaws_chat_categories');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return INITIAL_CHAT_CATEGORIES;
  });

  useEffect(() => {
    try {
      localStorage.setItem('morajaws_chat_categories', JSON.stringify(chatCategories));
    } catch (e) {}
  }, [chatCategories]);

  // Hierarchical Droplists (Status -> Reason -> Remarks) state
  const [hierarchicalStatuses, setHierarchicalStatuses] = useState<HierarchicalStatus[]>(() => {
    try {
      const saved = localStorage.getItem('morajaws_hierarchical_droplists');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return INITIAL_HIERARCHICAL_DROPLISTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('morajaws_hierarchical_droplists', JSON.stringify(hierarchicalStatuses));
    } catch (e) {}
  }, [hierarchicalStatuses]);

  const [canonicalFields, setCanonicalFields] = useState<CanonicalFieldConfig[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CANONICAL_FIELDS);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return MASTER_CANONICAL_FIELDS;
  });

  // Persistent storage sync
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CANONICAL_FIELDS, JSON.stringify(canonicalFields));
  }, [canonicalFields]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CONTRACTORS, JSON.stringify(contractors));
  }, [contractors]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COVERAGE_AREAS, JSON.stringify(coverageAreas));
  }, [coverageAreas]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ROOT_CAUSES, JSON.stringify(rootCauseCategories));
  }, [rootCauseCategories]);

  // Persistent storage sync (localStorage & IndexedDB offline cache)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
    saveTicketsOffline(tickets).catch(e => console.warn('Failed saving tickets to IndexedDB', e));
  }, [tickets]);

  // Mirror master data catalogs into IndexedDB for offline access
  useEffect(() => {
    cacheMasterData({
      contractors,
      users,
      coverageAreas,
      rootCauses: rootCauseCategories
    }).catch(e => console.warn('Failed caching master data to IndexedDB', e));
  }, [contractors, users, coverageAreas, rootCauseCategories]);

  // Load offline tickets from IndexedDB on startup if available
  useEffect(() => {
    async function loadFromIndexedDb() {
      try {
        const offlineList = await getOfflineTickets();
        if (offlineList && offlineList.length > 0) {
          setTickets(prev => {
            const existingMap = new Map(prev.map(t => [t.id, t]));
            offlineList.forEach(t => existingMap.set(t.id, t));
            return Array.from(existingMap.values());
          });
        }
      } catch (e) {
        console.warn('Failed loading offline tickets from IndexedDB', e);
      }
    }
    loadFromIndexedDb();
  }, []);

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('morajaws_logged_in');
      const session = localStorage.getItem('morajaws_auth_session');
      if (stored === 'true' && session) {
        return true;
      }
    } catch (e) {}
    return false;
  });

  const isLoggedInRef = React.useRef<boolean>(isLoggedIn);
  isLoggedInRef.current = isLoggedIn;

  const currentUserRef = React.useRef<User>(currentUser);
  currentUserRef.current = currentUser;

  const ticketsRef = React.useRef<Ticket[]>(tickets);
  ticketsRef.current = tickets;

  const activeScopedLookupRef = React.useRef<{ byId: Set<string>; woToId: Map<string, string> }>({
    byId: new Set(),
    woToId: new Map()
  });

  const deliveredTriggeredRef = React.useRef<Set<string>>(new Set());
  const hasHydratedChatMessagesRef = React.useRef<boolean>(false);
  const knownChatMessageIdsRef = React.useRef<Set<string>>(new Set());
  const notifiedChatSoundIdsRef = React.useRef<Set<string>>(new Set());
  const notifiedWoEventKeysRef = React.useRef<Set<string>>(new Set());
  const prevAuthSessionKeyRef = React.useRef<string>('');
  const failedMessagePayloadsRef = React.useRef<
    Map<string, { ticketId: string; text: string; attachments: ChatAttachment[]; category?: string; clientMessageId: string }>
  >(new Map());
  const typingExpiryTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [realtimeStatusInfo, setRealtimeStatusInfo] = useState<RealtimeStatusInfo>(() => supabaseDb.getRealtimeStatus());
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, UserPresenceInfo>>({});
  const [typingByTicketId, setTypingByTicketId] = useState<Record<string, TypingIndicatorInfo[]>>({});

  useEffect(() => {
    const unsubStatus = supabaseDb.subscribeRealtimeStatus(info => {
      setRealtimeStatusInfo(info);
    });
    const unsubReconnect = supabaseDb.subscribeReconnect(() => {
      if (!isLoggedInRef.current || currentUserRef.current?.mustChangePassword) return;
      runDeltaSync({ force: true }).catch(() => {});
      scheduleKpiRefreshRef.current?.();
      fetch('/api/livechat/presence', { headers: getAuthHeaders() })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (data?.success && Array.isArray(data.users)) {
            const nextMap: Record<string, UserPresenceInfo> = {};
            data.users.forEach((u: UserPresenceInfo) => {
              if (u?.userId) nextMap[u.userId] = u;
            });
            setPresenceByUserId(prev => ({ ...prev, ...nextMap }));
          }
        })
        .catch(() => {});
    });
    return () => {
      unsubStatus();
      unsubReconnect();
    };
  }, []);

  const reconnectRealtimeNow = React.useCallback(() => {
    supabaseDb.reconnectRealtimeNow();
  }, []);

  React.useEffect(() => {
    const nextKey = isLoggedIn ? String(currentUser?.id || '') : '';
    if (prevAuthSessionKeyRef.current !== nextKey) {
      prevAuthSessionKeyRef.current = nextKey;
      hasHydratedChatMessagesRef.current = false;
      knownChatMessageIdsRef.current.clear();
      notifiedChatSoundIdsRef.current.clear();
      notifiedWoEventKeysRef.current.clear();
    }
  }, [isLoggedIn, currentUser?.id]);

  const notifyIncomingChatMessages = React.useCallback(
    (msgs: TicketMessage[], options?: { fromSse?: boolean }) => {
      const uid = String(currentUserRef.current?.id || '').trim();
      const role = currentUserRef.current?.role;
      if (!isLoggedInRef.current || !uid || !Array.isArray(msgs) || msgs.length === 0) return;

      const lookup = activeScopedLookupRef.current;
      const freshIncoming: Array<{ message: TicketMessage; ticketId: string }> = [];
      const recencyCutoffMs = Date.now() - 5 * 60 * 1000;

      for (const m of msgs) {
        if (!m || !m.id) continue;
        if (notifiedChatSoundIdsRef.current.has(m.id)) {
          knownChatMessageIdsRef.current.add(m.id);
          continue;
        }
        if (!options?.fromSse && knownChatMessageIdsRef.current.has(m.id)) continue;

        let resolvedId: string | undefined;
        if (m.ticketId && lookup.byId.has(m.ticketId)) {
          resolvedId = m.ticketId;
        } else if (m.woNumber) {
          resolvedId = lookup.woToId.get(String(m.woNumber).trim().toUpperCase());
        }

        if (!resolvedId) {
          const matchedTicket = ticketsRef.current.find(
            t =>
              t.id === m.ticketId ||
              (m.woNumber && String(t.woNumber || '').trim().toUpperCase() === String(m.woNumber).trim().toUpperCase())
          );

          if (matchedTicket) {
            if (matchedTicket.isDeleted || matchedTicket.isArchived) {
              knownChatMessageIdsRef.current.add(m.id);
              continue;
            }
            if (options?.fromSse && (role === 'dispatch' || role === 'super_admin')) {
              resolvedId = matchedTicket.id;
            } else {
              knownChatMessageIdsRef.current.add(m.id);
              continue;
            }
          } else if (options?.fromSse && m.ticketId) {
            // Backend SSE stream already enforced strict RBAC via checkTicketAccess
            resolvedId = m.ticketId;
          } else {
            continue;
          }
        }

        knownChatMessageIdsRef.current.add(m.id);

        if (String(m.senderId || '').trim() === uid) continue;
        const readers = Array.isArray(m.readBy) ? m.readBy : [];
        if (readers.includes(uid)) continue;

        const parsedTs = Date.parse(m.timestamp);
        if (Number.isFinite(parsedTs) && parsedTs < recencyCutoffMs) continue;

        notifiedChatSoundIdsRef.current.add(m.id);
        freshIncoming.push({ message: m, ticketId: resolvedId });
      }

      if (freshIncoming.length === 0) return;

      const latest = freshIncoming[freshIncoming.length - 1];
      const targetTicket = ticketsRef.current.find(t => t.id === latest.ticketId);
      const woLabel = targetTicket?.woNumber || latest.message.woNumber || '';
      const senderLabel = latest.message.senderName || 'Tim Operasional';
      const rawSnippet =
        (latest.message.text || '').trim() ||
        (latest.message.attachments && latest.message.attachments.length > 0
          ? 'Mengirim lampiran foto'
          : 'Pesan baru');

      const bodyText =
        freshIncoming.length === 1
          ? `${senderLabel}${woLabel ? ` (${woLabel})` : ''}: ${rawSnippet}`
          : `${freshIncoming.length} pesan baru — terakhir dari ${senderLabel}${woLabel ? ` (${woLabel})` : ''}.`;

      try {
        window.dispatchEvent(
          new CustomEvent('morajaws:livechat-sound', {
            detail: {
              messageId: latest.message.id,
              ticketId: latest.ticketId,
              senderRole: latest.message.senderRole,
              recipientRole: role
            }
          })
        );
      } catch {}

      toast.info(bodyText, 'Live Chat', {
        withSound: false,
        soundCategory: 'live_chat',
        actionLabel: 'Buka Chat',
        onAction: () => {
          try {
            window.dispatchEvent(
              new CustomEvent('morajaws:open-live-chat', {
                detail: { ticketId: latest.ticketId }
              })
            );
          } catch {}
        }
      });
    },
    [toast]
  );

  const triggerDeliveryReceiptsForMessages = React.useCallback((msgs: TicketMessage[], uid?: string) => {
    const cleanUid = String(uid || currentUserRef.current?.id || '').trim();
    if (!cleanUid || !Array.isArray(msgs) || msgs.length === 0) return;

    const ticketIdsToAck = new Set<string>();
    for (const m of msgs) {
      if (!m || !m.id || !m.ticketId) continue;
      if (String(m.id).startsWith('optimistic_')) continue;
      if (String(m.senderId || '').trim() === cleanUid) continue;
      const deliveredTo = Array.isArray(m.deliveredTo) ? m.deliveredTo : [];
      if (deliveredTo.includes(cleanUid)) continue;
      const dedupeKey = `${cleanUid}:${m.id}`;
      if (deliveredTriggeredRef.current.has(dedupeKey)) continue;
      deliveredTriggeredRef.current.add(dedupeKey);
      ticketIdsToAck.add(m.ticketId);
    }

    ticketIdsToAck.forEach(tid => {
      supabaseDb
        .markTicketMessagesDelivered(tid)
        .then(res => {
          if (res?.success && res.data?.updatedIds && res.data.updatedIds.length > 0) {
            const ackIds = new Set(res.data.updatedIds);
            const ts = res.data.deliveredAt || new Date().toISOString();
            setTicketMessages(prev =>
              prev.map(m => {
                if (!ackIds.has(m.id)) return m;
                const dTo = Array.isArray(m.deliveredTo) ? m.deliveredTo : [];
                if (dTo.includes(cleanUid)) return m;
                return {
                  ...m,
                  deliveredTo: [...dTo, cleanUid],
                  deliveredAt: { ...(m.deliveredAt || {}), [cleanUid]: ts }
                };
              })
            );
          }
        })
        .catch(() => {});
    });
  }, []);

  // Supabase Express SSE Subscriptions & Master Sync
  useEffect(() => {
    let unsubWorkOrders: (() => void) | null = null;
    let unsubMessages: (() => void) | null = null;
    let unsubPresence: (() => void) | null = null;
    let unsubTyping: (() => void) | null = null;
    let unsubUsers: (() => void) | null = null;
    let unsubGlobalConfigs: (() => void) | null = null;
    let unsubRoles: (() => void) | null = null;
    let unsubContractors: (() => void) | null = null;
    let unsubCoverageAreas: (() => void) | null = null;
    let unsubOperationalDate: (() => void) | null = null;
    let unsubProgressReports: (() => void) | null = null;
    let isCancelled = false;

    const handleOnline = () => {
      cancelPendingDeltaRetry();
      setSyncStatus('SYNCING');
      setDatabaseStatus('connecting');
      if (ticketsRef.current.length > 0) {
        runDeltaSync({ force: true }).catch(() => {});
      } else {
        refreshDatabaseData().catch(() => {});
      }
    };
    const handleOffline = () => {
      cancelPendingDeltaRetry();
      if (deltaSyncAbortRef.current) {
        deltaSyncAbortRef.current.abort();
        deltaSyncAbortRef.current = null;
      }
      setSyncStatus('OFFLINE');
      setDatabaseStatus('offline');
    };
    const handleWindowFocusOrVisible = () => {
      if (document.visibilityState === 'hidden') {
        cancelPendingDeltaRetry();
        return;
      }
      if (isCancelled || !navigator.onLine) return;
      if (currentUserRef.current?.mustChangePassword) return;
      if (shouldThrottleViewRevalidation('window:focus', 10_000)) return;
      if (ticketsRef.current.length > 0) {
        runDeltaSync().catch(() => {});
      } else {
        loadCentralData().catch(() => {});
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleWindowFocusOrVisible);
    document.addEventListener('visibilitychange', handleWindowFocusOrVisible);

    const headers = getAuthHeaders();
    if (headers['Authorization']) {
      try {
        unsubWorkOrders = supabaseDb.subscribeToChanges({
          table: 'work_orders',
          onPayload: (payload) => {
            if (isCancelled || !payload) return;
            const rec = payload.record || payload.new;
            if (payload.eventType === 'ACCESS_REVOKED' && rec?.id) {
              const revokedId = String(rec.id);
              const revokedWo = String(rec.woNumber || '').trim().toUpperCase();
              setTickets(prev => prev.filter(t => t.id !== revokedId));
              setTicketMessages(prev =>
                prev.filter(
                  m =>
                    m.ticketId !== revokedId &&
                    (!revokedWo || String(m.woNumber || '').trim().toUpperCase() !== revokedWo)
                )
              );
              return;
            }
            if (payload.eventType === 'DELETE' && rec?.id) {
              if (!isTicketBeingEdited(rec.id)) {
                setTickets(prev => prev.map(t => (t.id === rec.id ? { ...t, ...rec } : t)));
              }
              if (rec.isDeleted) {
                setTicketMessages(prev => prev.filter(m => m.ticketId !== rec.id));
              }
            } else if (payload.eventType === 'UNMAPPED_DISTRIBUTION_ALERT') {
              const role = currentUserRef.current?.role;
              if (role === 'dispatch' || role === 'super_admin') {
                const count = Number(payload.undistributedCount || payload.count || 0);
                if (count > 0) {
                  toast.warning(
                    `${count} Work Order baru belum memiliki mapping Leader/Vendor aktif dan masuk ke antrean Belum Terdistribusi.`,
                    'Distribusi Leader Perlu Tindakan'
                  );
                }
              }
              scheduleKpiRefreshRef.current?.();
            } else if (rec && rec.id) {
              if (isTicketBeingEdited(rec.id)) {
                if (!protectedEditNotifiedRef.current.has(rec.id)) {
                  protectedEditNotifiedRef.current.add(rec.id);
                  toast.info(
                    `Ada pembaruan server untuk WO ${rec.woNumber || rec.id}. Editan Anda yang sedang aktif tetap dipertahankan.`,
                    'Sinkronisasi Terproteksi'
                  );
                }
                return;
              }
              const prevMatch = ticketsRef.current.find(t => t.id === rec.id);
              const wasPresent = Boolean(prevMatch);
              setTickets(prev => {
                const idx = prev.findIndex(t => t.id === rec.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], ...rec };
                  return copy;
                }
                return [rec, ...prev];
              });
              scheduleKpiRefreshRef.current?.();

              // Real-time Work Order assignment / approval / revision audio alerts via SSE
              const activeUser = currentUserRef.current;
              const actorName = String(rec.updatedBy || '').trim().toLowerCase();
              const myName = String(activeUser?.name || '').trim().toLowerCase();
              if (activeUser?.id && !rec.isDeleted && !rec.isArchived && (!actorName || actorName !== myName)) {
                const woEventKey = `${rec.id}:${rec.updatedAt || ''}:${rec.approvalStatus || ''}:${rec.installerId || rec.installerName || ''}`;
                if (!notifiedWoEventKeysRef.current.has(woEventKey)) {
                  if (activeUser.role === 'installer') {
                    if (!wasPresent) {
                      notifiedWoEventKeysRef.current.add(woEventKey);
                      toast.info(
                        `Work Order baru ditugaskan: ${rec.woNumber || rec.id} (${rec.customerName || 'Pelanggan'}).`,
                        'Penugasan WO Baru',
                        { withSound: true, soundCategory: 'wo_assignment' }
                      );
                    } else if (
                      rec.approvalStatus === 'REJECTED' &&
                      prevMatch?.approvalStatus !== 'REJECTED'
                    ) {
                      notifiedWoEventKeysRef.current.add(woEventKey);
                      toast.warning(
                        `Laporan WO ${rec.woNumber || rec.id} memerlukan revisi dari Dispatch.`,
                        'Revisi Laporan',
                        { withSound: true, soundCategory: 'important' }
                      );
                    } else if (
                      rec.approvalStatus === 'APPROVED' &&
                      prevMatch?.approvalStatus !== 'APPROVED'
                    ) {
                      notifiedWoEventKeysRef.current.add(woEventKey);
                      toast.success(
                        `Laporan WO ${rec.woNumber || rec.id} telah disetujui Dispatch (Approved).`,
                        'Laporan Disetujui',
                        { withSound: true, soundCategory: 'success' }
                      );
                    }
                  } else if (activeUser.role === 'dispatch' || activeUser.role === 'super_admin') {
                    if (
                      rec.approvalStatus === 'BUTUH APPROVAL' &&
                      prevMatch?.approvalStatus !== 'BUTUH APPROVAL'
                    ) {
                      notifiedWoEventKeysRef.current.add(woEventKey);
                      toast.warning(
                        `${rec.installerName || 'Teknisi'} mengirim laporan WO ${rec.woNumber || rec.id} untuk verifikasi QC.`,
                        'Laporan Siap Verifikasi',
                        { withSound: true, soundCategory: 'important' }
                      );
                    }
                  }
                }
              }

              // When a WO becomes newly accessible (e.g., reassignment to this Installer), fetch its messages immediately
              if (!wasPresent && !rec.isDeleted && !rec.isArchived) {
                fetch(`/api/tickets/${encodeURIComponent(rec.id)}/messages`, { headers: getAuthHeaders() })
                  .then(r => (r.ok ? r.json() : null))
                  .then(data => {
                    if (!isCancelled && data?.success && Array.isArray(data.messages)) {
                      const fetchedMsgs: TicketMessage[] = data.messages;
                      const staleCutoff = Date.now() - 5 * 60 * 1000;
                      fetchedMsgs.forEach(m => {
                        if (!m?.id) return;
                        const ts = Date.parse(m.timestamp);
                        if (!Number.isFinite(ts) || ts < staleCutoff) {
                          knownChatMessageIdsRef.current.add(m.id);
                        }
                      });
                      setTicketMessages(prev => {
                        const map = new Map(prev.map(m => [m.id, m]));
                        fetchedMsgs.forEach(m => {
                          if (m?.id) map.set(m.id, m);
                        });
                        return Array.from(map.values()).sort(
                          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                        );
                      });
                      triggerDeliveryReceiptsForMessages(fetchedMsgs);
                      notifyIncomingChatMessages(fetchedMsgs);
                    }
                  })
                  .catch(() => {});
              }
            } else {
              refreshDatabaseData().catch(() => {});
              scheduleKpiRefreshRef.current?.();
            }
          },
          onError: () => {}
        });

        unsubMessages = supabaseDb.subscribeToChanges({
          table: 'ticket_messages',
          onPayload: (payload) => {
            if (isCancelled || !payload) return;
            const rec = payload.record || payload.new || payload;
            if (payload.eventType === 'DELIVERY_RECEIPT' && rec?.ticketId && rec?.userId) {
              const receiverId = String(rec.userId);
              const targetTicketId = String(rec.ticketId);
              const updatedIdSet = Array.isArray(rec.updatedIds) ? new Set(rec.updatedIds.map(String)) : null;
              const ts = rec.deliveredAt || payload.timestamp || new Date().toISOString();
              setTicketMessages(prev =>
                prev.map(m => {
                  if (m.ticketId !== targetTicketId) return m;
                  if (updatedIdSet && !updatedIdSet.has(m.id)) return m;
                  const delivered = Array.isArray(m.deliveredTo) ? m.deliveredTo : [];
                  if (delivered.includes(receiverId)) return m;
                  return {
                    ...m,
                    deliveredTo: [...delivered, receiverId],
                    deliveredAt: { ...(m.deliveredAt || {}), [receiverId]: ts }
                  };
                })
              );
              return;
            }
            if (payload.eventType === 'READ_RECEIPT' && rec?.ticketId && rec?.userId) {
              const readerId = String(rec.userId);
              const targetTicketId = String(rec.ticketId);
              const updatedIdSet = Array.isArray(rec.updatedIds) ? new Set(rec.updatedIds.map(String)) : null;
              const ts = rec.readAt || payload.timestamp || new Date().toISOString();
              setTicketMessages(prev =>
                prev.map(m => {
                  if (m.ticketId !== targetTicketId) return m;
                  if (updatedIdSet && !updatedIdSet.has(m.id)) return m;
                  const readers = Array.isArray(m.readBy) ? m.readBy : [];
                  const delivered = Array.isArray(m.deliveredTo) ? m.deliveredTo : [];
                  const nextDelivered = delivered.includes(readerId) ? delivered : [...delivered, readerId];
                  const nextReaders = readers.includes(readerId) ? readers : [...readers, readerId];
                  return {
                    ...m,
                    deliveredTo: nextDelivered,
                    deliveredAt: { ...(m.deliveredAt || {}), [readerId]: m.deliveredAt?.[readerId] || ts },
                    readBy: nextReaders,
                    readAt: { ...(m.readAt || {}), [readerId]: ts }
                  };
                })
              );
              return;
            }
            if (rec && rec.id) {
              const incomingMsg: TicketMessage = { ...rec, deliveryStatus: rec.deliveryStatus || 'sent' };
              if (incomingMsg.id) {
                knownChatMessageIdsRef.current.add(incomingMsg.id);
              }
              setTicketMessages(prev => {
                const matchIdx = prev.findIndex(
                  m =>
                    m.id === incomingMsg.id ||
                    (incomingMsg.clientMessageId && m.clientMessageId === incomingMsg.clientMessageId)
                );
                if (matchIdx >= 0) {
                  const copy = [...prev];
                  copy[matchIdx] = { ...copy[matchIdx], ...incomingMsg, deliveryStatus: incomingMsg.deliveryStatus || 'sent', localError: undefined };
                  return copy;
                }
                return [...prev, incomingMsg].sort(
                  (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                );
              });
              // Clear active typing indicator for sender of incoming message
              if (incomingMsg.ticketId && incomingMsg.senderId) {
                setTypingByTicketId(prev => {
                  const list = prev[incomingMsg.ticketId];
                  if (!list || list.length === 0) return prev;
                  const nextList = list.filter(t => t.userId !== incomingMsg.senderId);
                  return { ...prev, [incomingMsg.ticketId]: nextList };
                });
              }
              // Trigger Delivered receipt & LiveChat notification sound immediately (NEVER marks readBy)
              triggerDeliveryReceiptsForMessages([incomingMsg]);
              notifyIncomingChatMessages([incomingMsg], { fromSse: true });
            }
          },
          onError: () => {}
        });

        unsubPresence = supabaseDb.subscribeToChanges({
          table: 'presence',
          onPayload: (payload) => {
            if (isCancelled || !payload) return;
            const rec: UserPresenceInfo | undefined = payload.record || payload.new;
            if (!rec?.userId) return;
            setPresenceByUserId(prev => ({ ...prev, [rec.userId]: rec }));
          }
        });

        unsubTyping = supabaseDb.subscribeToChanges({
          table: 'livechat_ephemeral',
          onPayload: (payload) => {
            if (isCancelled || !payload) return;
            const rec: TypingIndicatorInfo | undefined = payload.record || payload.new;
            if (!rec?.ticketId || !rec?.userId) return;
            if (rec.userId === currentUserRef.current?.id) return;
            const timerKey = `${rec.ticketId}:${rec.userId}`;
            const oldTimer = typingExpiryTimersRef.current.get(timerKey);
            if (oldTimer) {
              clearTimeout(oldTimer);
              typingExpiryTimersRef.current.delete(timerKey);
            }

            if (!rec.isTyping) {
              setTypingByTicketId(prev => {
                const list = prev[rec.ticketId] || [];
                const nextList = list.filter(t => t.userId !== rec.userId);
                if (nextList.length === list.length) return prev;
                return { ...prev, [rec.ticketId]: nextList };
              });
              return;
            }

            setTypingByTicketId(prev => {
              const list = (prev[rec.ticketId] || []).filter(t => t.userId !== rec.userId);
              return { ...prev, [rec.ticketId]: [...list, rec] };
            });

            const msLeft = Math.max(1000, Math.min(6000, Date.parse(rec.expiresAt) - Date.now() || 5000));
            const expTimer = setTimeout(() => {
              typingExpiryTimersRef.current.delete(timerKey);
              setTypingByTicketId(prev => {
                const list = prev[rec.ticketId] || [];
                const nextList = list.filter(t => t.userId !== rec.userId);
                if (nextList.length === list.length) return prev;
                return { ...prev, [rec.ticketId]: nextList };
              });
            }, msLeft);
            typingExpiryTimersRef.current.set(timerKey, expTimer);
          }
        });

        fetch('/api/livechat/presence', { headers })
          .then(r => (r.ok ? r.json() : null))
          .then(data => {
            if (!isCancelled && data?.success && Array.isArray(data.users)) {
              const nextMap: Record<string, UserPresenceInfo> = {};
              data.users.forEach((u: UserPresenceInfo) => {
                if (u?.userId) nextMap[u.userId] = u;
              });
              setPresenceByUserId(prev => ({ ...prev, ...nextMap }));
            }
          })
          .catch(() => {});

        unsubUsers = supabaseDb.subscribeToChanges({
          table: 'users',
          onPayload: () => {
            if (isCancelled) return;
            supabaseDb.getUsers().then((res) => {
              if (!isCancelled && res.success && Array.isArray(res.data)) {
                setUsers(res.data);
              }
            }).catch(() => {});
          }
        });

        unsubGlobalConfigs = subscribeToGlobalConfigUpdates((evt) => {
          if (isCancelled || !evt?.key) return;
          const val = evt.value;
          if (evt.key === 'hierarchical_droplists' && val) {
            const list = Array.isArray(val) ? val : val.statuses;
            if (Array.isArray(list)) setHierarchicalStatuses(list);
          } else if (evt.key === 'chat_categories' && val) {
            const list = Array.isArray(val) ? val : val.categories;
            if (Array.isArray(list)) setChatCategories(list);
          } else if (evt.key === 'report_dropdown_categories' && val) {
            const list = Array.isArray(val) ? val : val.categories;
            if (Array.isArray(list)) setReportDropdownCategories(list);
          } else if (evt.key === 'workflow_rules' && val) {
            const list = Array.isArray(val) ? val : val.rules;
            if (Array.isArray(list)) setWorkflowRules(list);
          } else if (evt.key === 'header_mappings' && val) {
            const list = Array.isArray(val) ? val : val.mappings;
            if (Array.isArray(list)) setHeaderMappings(list);
          } else if (evt.key === 'canonical_fields' && val) {
            const list = Array.isArray(val) ? val : val.fields;
            if (Array.isArray(list)) setCanonicalFields(list);
          } else if (evt.key === 'root_cause_categories' && val) {
            const list = Array.isArray(val) ? val : val.categories;
            if (Array.isArray(list)) setRootCauseCategories(list);
          } else if (evt.key === 'google_sheets_config' && val && typeof val === 'object') {
            setGoogleSheetsConfig(prev => ({ ...prev, ...val }));
          } else if (evt.key === 'operational_date_config' && val && typeof val === 'object') {
            const nextDate = val.isAuto || !val.operationalDate ? getJakartaDateString(0) : String(val.operationalDate);
            setTodayWIB(nextDate);
            setOperationalDateState(nextDate);
            try {
              localStorage.setItem('morajaws_operational_date', nextDate);
            } catch {}
          } else if (evt.key === 'role_permissions' && val && typeof val === 'object') {
            setDynamicRolePermissions(val);
            setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...val });
            if (typeof evt.version === 'number') {
              setRolePermissionsVersion(evt.version);
            }
          }
        });

        unsubRoles = supabaseDb.subscribeToChanges({
          table: 'roles',
          onPayload: () => {
            if (isCancelled) return;
            getRolePermissionsFromServer()
              .then((res) => {
                if (isCancelled) return;
                setDynamicRolePermissions(res.rolePermissions);
                setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...res.rolePermissions } as Record<UserRole, string[]>);
                setRolePermissionsVersion(res.version || 1);
              })
              .catch(() => {});
          }
        });

        unsubContractors = supabaseDb.subscribeToChanges({
          table: 'contractors',
          onPayload: () => {
            if (isCancelled) return;
            supabaseDb.getContractors().then((res) => {
              if (!isCancelled && res.success && Array.isArray(res.data)) {
                setContractors(deduplicateContractors(res.data));
              }
            }).catch(() => {});
          }
        });

        unsubCoverageAreas = supabaseDb.subscribeToChanges({
          table: 'coverage_areas',
          onPayload: () => {
            if (isCancelled) return;
            supabaseDb.getCoverageAreas().then((res) => {
              if (!isCancelled && res.success && Array.isArray(res.data)) {
                setCoverageAreas(res.data);
              }
            }).catch(() => {});
          }
        });

        unsubOperationalDate = supabaseDb.subscribeToChanges({
          table: 'system_operational_date',
          onPayload: (payload) => {
            if (isCancelled || !payload) return;
            const nextWIB =
              payload.record?.operationalDate ||
              payload.record?.operationalDateWIB ||
              getJakartaDateString(0);
            setTodayWIB(nextWIB);
            setOperationalDateState(nextWIB);
            try {
              localStorage.setItem('morajaws_operational_date', nextWIB);
            } catch {}
            loadCentralData().catch(() => {});
          }
        });

        unsubProgressReports = supabaseDb.subscribeToChanges({
          table: 'progress_reports',
          onPayload: (payload) => {
            if (isCancelled || !payload) return;
            const rec = payload.record || payload.new;
            if (rec && rec.id && !isTicketBeingEdited(rec.id)) {
              setTickets(prev => {
                const idx = prev.findIndex(t => t.id === rec.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], ...rec };
                  return copy;
                }
                return prev;
              });
            }
            scheduleKpiRefreshRef.current?.();
          }
        });
      } catch (sseErr) {
        console.warn('[Realtime SSE] Notice attaching Supabase SSE:', sseErr);
      }
    }

    // Safety Delta Sync fallback ONLY when SSE stream is not healthy/connected (avoids redundant polling when push SSE is active)
    const pollInterval = setInterval(() => {
      if (
        !isCancelled &&
        navigator.onLine &&
        document.visibilityState === 'visible' &&
        !currentUserRef.current?.mustChangePassword &&
        supabaseDb.getRealtimeStatus().state !== 'connected'
      ) {
        if (ticketsRef.current.length > 0) {
          runDeltaSync().catch(() => {});
        } else {
          loadCentralData().catch(() => {});
        }
      }
    }, 30000);

    return () => {
      isCancelled = true;
      cancelPendingDeltaRetry();
      if (deltaSyncAbortRef.current) {
        deltaSyncAbortRef.current.abort();
        deltaSyncAbortRef.current = null;
      }
      if (centralBootAbortRef.current) {
        centralBootAbortRef.current.abort();
        centralBootAbortRef.current = null;
      }
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleWindowFocusOrVisible);
      document.removeEventListener('visibilitychange', handleWindowFocusOrVisible);
      clearInterval(pollInterval);
      for (const tm of typingExpiryTimersRef.current.values()) {
        clearTimeout(tm);
      }
      typingExpiryTimersRef.current.clear();
      unsubWorkOrders?.();
      unsubMessages?.();
      unsubPresence?.();
      unsubTyping?.();
      unsubUsers?.();
      unsubGlobalConfigs?.();
      unsubRoles?.();
      unsubContractors?.();
      unsubCoverageAreas?.();
      unsubOperationalDate?.();
      unsubProgressReports?.();
    };
  }, [isLoggedIn, currentUser?.id]);

  // Automatic Installer Live GPS Tracking strictly bound to authenticated Installer session
  useEffect(() => {
    if (!isLoggedIn || !currentUser?.id || currentUser.role !== 'installer') {
      installerGpsTracker.stopTracking();
      return;
    }

    const startTrackingFromSession = () => {
      let sessionIdFromStorage: string | null = null;
      try {
        const rawSess = localStorage.getItem('morajaws_auth_session');
        if (rawSess) {
          const parsed = JSON.parse(rawSess);
          sessionIdFromStorage = parsed?.sessionId || null;
        }
      } catch {}

      installerGpsTracker
        .startForAuthenticatedInstaller({
          userId: currentUser.id,
          role: currentUser.role,
          sessionId: sessionIdFromStorage
        })
        .catch(() => {});
    };

    startTrackingFromSession();

    window.addEventListener('morajaws:auth-changed', startTrackingFromSession);
    return () => {
      window.removeEventListener('morajaws:auth-changed', startTrackingFromSession);
    };
  }, [isLoggedIn, currentUser?.id, currentUser?.role]);

  // Explicit Supabase PostgreSQL data refresh via Express proxy
  const refreshDatabaseData = async () => {
    if (!navigator.onLine) {
      setSyncStatus('OFFLINE');
      setDatabaseStatus('offline');
      toast.warning('Koneksi internet terputus. Menggunakan data offline lokal.', 'Mode Offline');
      return;
    }
    setSyncStatus('SYNCING');
    setDatabaseStatus('connecting');
    await loadCentralData();
  };

  const markTicketEditing = (ticketId: string | null | undefined, isEditing: boolean) => {
    markTicketEditingState(ticketId, isEditing);
    if (!isEditing && ticketId) {
      protectedEditNotifiedRef.current.delete(String(ticketId));
    }
  };

  const applyBootstrapHydration = (
    data: any,
    options: { isPhase2Full?: boolean; headers: Record<string, string> }
  ): { resolvedRole: UserRole; resolvedUserId: string; resolvedActive: boolean; passwordChangeRequired: boolean } => {
    let resolvedRole: UserRole = currentUserRef.current.role;
    let resolvedUserId: string = currentUserRef.current.id;
    let resolvedActive: boolean = currentUserRef.current.active;

    const liveWIB = data.operationalDateWIB || getJakartaDateString(0);
    setTodayWIB(liveWIB);
    setOperationalDateState(liveWIB);
    try {
      localStorage.setItem('morajaws_operational_date', liveWIB);
    } catch {}

    if (data.currentUser && data.isAuthenticated) {
      setCurrentUser(prev => ({ ...prev, ...data.currentUser }));
      resolvedRole = data.currentUser.role || resolvedRole;
      resolvedUserId = data.currentUser.id || resolvedUserId;
      resolvedActive = data.currentUser.active !== false;
    } else if (data.isAuthenticated === false && options.headers['Authorization']) {
      setIsLoggedIn(false);
      setCurrentUser(UNAUTHENTICATED_USER);
      try {
        localStorage.setItem('morajaws_logged_in', 'false');
        localStorage.removeItem('morajaws_auth_session');
        window.dispatchEvent(new CustomEvent('morajaws:auth-changed'));
      } catch (e) {}
    }

    if (data.rolePermissions && typeof data.rolePermissions === 'object') {
      setDynamicRolePermissions(data.rolePermissions);
      setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...data.rolePermissions });
    }

    const passwordChangeRequired = Boolean(data.passwordChangeRequired || data.currentUser?.mustChangePassword);

    if (Array.isArray(data.tickets)) {
      if (options.isPhase2Full) {
        setTickets(prev => mergeProgressiveHydration(prev, data.tickets));
        setWoCache('wo:full', data.tickets, data.serverTime);
      } else {
        setTickets(prev => (prev.length > 0 ? mergeDeltaTickets(prev, data.tickets, []).tickets : data.tickets));
        setWoCache('wo:critical', data.tickets, data.serverTime);
      }
    }

    if (Array.isArray(data.ticketMessages) && (!data.isCriticalMode || data.ticketMessages.length > 0)) {
      const hydratedMessages: TicketMessage[] = (() => {
        const map = new Map<string, TicketMessage>();
        data.ticketMessages.forEach((m: TicketMessage) => {
          if (m && m.id) map.set(m.id, m);
        });
        return Array.from(map.values()).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      })();
      if (!hasHydratedChatMessagesRef.current) {
        hydratedMessages.forEach(m => {
          if (m?.id) knownChatMessageIdsRef.current.add(m.id);
        });
        hasHydratedChatMessagesRef.current = true;
      }
      setTicketMessages(hydratedMessages);
      if (resolvedUserId) {
        triggerDeliveryReceiptsForMessages(hydratedMessages, resolvedUserId);
      }
    } else if (!hasHydratedChatMessagesRef.current && options.isPhase2Full) {
      hasHydratedChatMessagesRef.current = true;
    }

    if (Array.isArray(data.contractors) && data.contractors.length > 0) {
      setContractors(deduplicateContractors(data.contractors));
    }
    if (Array.isArray(data.coverageAreas) && data.coverageAreas.length > 0) {
      setCoverageAreas(data.coverageAreas);
    }
    if (Array.isArray(data.templates) && data.templates.length > 0) {
      setTemplates(data.templates);
    }

    if (data.serverTime) {
      lastDeltaWatermarkRef.current = data.serverTime;
    }

    setDatabaseStatus('connected');
    setIsDatabaseReady(true);
    setSyncStatus('SAVED');
    setLastSyncTime(new Date().toISOString());
    setSyncError(null);
    syncRetryCountRef.current = 0;

    return { resolvedRole, resolvedUserId, resolvedActive, passwordChangeRequired };
  };

  const runDeltaSync = async (options?: { force?: boolean }): Promise<void> => {
    const headers = getAuthHeaders();
    if (!headers['Authorization']) return;
    if (currentUserRef.current?.mustChangePassword) return;
    if (!navigator.onLine) {
      cancelPendingDeltaRetry();
      setSyncStatus('OFFLINE');
      setDatabaseStatus('offline');
      return;
    }

    if (options?.force && deltaSyncAbortRef.current) {
      deltaSyncAbortRef.current.abort();
      deltaSyncAbortRef.current = null;
    }

    return dedupedFetch('sync:delta', async () => {
      const controller = new AbortController();
      deltaSyncAbortRef.current = controller;
      try {
        cancelPendingDeltaRetry();
        setSyncStatus('SYNCING');
        const sinceIso = lastDeltaWatermarkRef.current || new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const res = await fetch(`/api/sync/delta?since=${encodeURIComponent(sinceIso)}`, {
          headers,
          signal: controller.signal
        });
        if (!res.ok) {
          if (res.status === 403) {
            const errData = await res.json().catch(() => ({}));
            if (errData?.code === 'PASSWORD_CHANGE_REQUIRED') {
              setCurrentUser(prev => ({ ...prev, mustChangePassword: true }));
              return;
            }
          }
          throw new Error(`Delta sync HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!data?.success) throw new Error(data?.error || 'Delta sync gagal');

        const updatedTickets: Ticket[] = Array.isArray(data.tickets) ? data.tickets : [];
        const deletedIds: string[] = Array.isArray(data.deletedIds) ? data.deletedIds : [];
        const deltaMessages: TicketMessage[] = Array.isArray(data.ticketMessages) ? data.ticketMessages : [];

        if (updatedTickets.length > 0 || deletedIds.length > 0 || options?.force) {
          setTickets(prev => {
            const merged = mergeDeltaTickets(prev, updatedTickets, deletedIds);
            if (merged.skippedEditedIds.length > 0) {
              merged.skippedEditedIds.forEach(sid => {
                if (!protectedEditNotifiedRef.current.has(sid)) {
                  protectedEditNotifiedRef.current.add(sid);
                  toast.info(
                    'Perubahan database tersedia di background. Editan aktif Anda tetap dilindungi.',
                    'Sinkronisasi Terproteksi'
                  );
                }
              });
            }
            setWoCache('wo:full', merged.tickets, data.serverTime || lastDeltaWatermarkRef.current);
            return merged.tickets;
          });
          if (updatedTickets.length > 0 || deletedIds.length > 0) {
            scheduleKpiRefreshRef.current?.();
          }
        }

        if (deltaMessages.length > 0) {
          deltaMessages.forEach(m => {
            if (m?.id) knownChatMessageIdsRef.current.add(m.id);
          });
          setTicketMessages(prev => {
            const next = [...prev];
            deltaMessages.forEach(incoming => {
              if (!incoming?.id) return;
              const matchIdx = next.findIndex(
                m =>
                  m.id === incoming.id ||
                  (incoming.clientMessageId && m.clientMessageId === incoming.clientMessageId)
              );
              const normalized: TicketMessage = {
                ...incoming,
                deliveryStatus: incoming.deliveryStatus || 'sent',
                localError: undefined
              };
              if (matchIdx >= 0) {
                next[matchIdx] = { ...next[matchIdx], ...normalized };
              } else {
                next.push(normalized);
              }
            });
            return next.sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          });
          triggerDeliveryReceiptsForMessages(deltaMessages);
        }

        if (data.rolePermissions && typeof data.rolePermissions === 'object') {
          setDynamicRolePermissions(data.rolePermissions);
          setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...data.rolePermissions });
          if (typeof data.rolePermissionsVersion === 'number') {
            setRolePermissionsVersion(data.rolePermissionsVersion);
          }
        }
        if (data.operationalDateWIB) {
          setTodayWIB(data.operationalDateWIB);
          setOperationalDateState(data.operationalDateWIB);
        }
        if (data.serverTime) {
          lastDeltaWatermarkRef.current = data.serverTime;
        }
        setDatabaseStatus('connected');
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        setSyncError(null);
        syncRetryCountRef.current = 0;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        syncRetryCountRef.current += 1;
        setSyncStatus('ERROR');
        setSyncError(err?.message || 'Gagal sinkronisasi delta');

        if (
          navigator.onLine &&
          document.visibilityState === 'visible' &&
          getAuthHeaders()['Authorization'] &&
          !currentUserRef.current?.mustChangePassword &&
          syncRetryCountRef.current <= 3
        ) {
          const retryDelayMs = 3000 * Math.pow(2, syncRetryCountRef.current - 1);
          cancelPendingDeltaRetry();
          deltaSyncRetryTimerRef.current = setTimeout(() => {
            deltaSyncRetryTimerRef.current = null;
            if (navigator.onLine && document.visibilityState === 'visible' && getAuthHeaders()['Authorization']) {
              void runDeltaSync();
            }
          }, retryDelayMs);
        }
      } finally {
        if (deltaSyncAbortRef.current === controller) {
          deltaSyncAbortRef.current = null;
        }
      }
    });
  };

  const revalidateWoView = async (viewKey: string, options?: { force?: boolean }): Promise<void> => {
    const headers = getAuthHeaders();
    if (!headers['Authorization']) return;
    if (currentUserRef.current?.mustChangePassword) return;
    if (!navigator.onLine) {
      setSyncStatus('OFFLINE');
      return;
    }
    if (!options?.force && shouldThrottleViewRevalidation(`view:${viewKey}`, 6_000)) {
      return;
    }
    if (ticketsRef.current.length === 0) {
      await loadCentralData();
      return;
    }
    await runDeltaSync({ force: options?.force });
  };

  const loadTicketDetailOnDemand = async (
    ticketId: string
  ): Promise<{ ticket?: Ticket; messages?: TicketMessage[]; activities?: any[] } | null> => {
    const cleanId = String(ticketId || '').trim();
    if (!cleanId) return null;
    const headers = getAuthHeaders();
    if (!headers['Authorization'] || !navigator.onLine) return null;

    return dedupedFetch(`wo:detail:${cleanId}`, async () => {
      try {
        const res = await fetch(
          `/api/work-orders/${encodeURIComponent(cleanId)}?include=messages,activities`,
          { headers }
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.success) return null;

        const hydratedTicket: Ticket | undefined = data.workOrder || data.ticket;
        const hydratedMessages: TicketMessage[] | undefined = Array.isArray(data.messages) ? data.messages : undefined;
        const hydratedActivities: any[] | undefined = Array.isArray(data.activities) ? data.activities : undefined;

        if (hydratedTicket && hydratedTicket.id && !isTicketBeingEdited(hydratedTicket.id)) {
          setTickets(prev => {
            const idx = prev.findIndex(t => t.id === hydratedTicket.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...hydratedTicket };
              return copy;
            }
            return [hydratedTicket, ...prev];
          });
        }

        if (hydratedMessages && hydratedMessages.length > 0) {
          setTicketMessages(prev => {
            const map = new Map(prev.map(m => [m.id, m]));
            hydratedMessages.forEach(m => {
              if (m?.id) map.set(m.id, m);
            });
            return Array.from(map.values()).sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          });
        }

        return {
          ticket: hydratedTicket,
          messages: hydratedMessages,
          activities: hydratedActivities
        };
      } catch {
        return null;
      }
    });
  };

  const loadCentralData = async () => {
    return dedupedFetch('central:bootstrap', async () => {
      if (centralBootAbortRef.current) {
        centralBootAbortRef.current.abort();
      }
      if (phase3IdleTimerRef.current !== null) {
        clearTimeout(phase3IdleTimerRef.current);
        phase3IdleTimerRef.current = null;
      }
      const bootController = new AbortController();
      centralBootAbortRef.current = bootController;

      const cachedFull = getWoCache<Ticket[]>('wo:full') || getWoCache<Ticket[]>('wo:critical');
      if (cachedFull && Array.isArray(cachedFull.data) && ticketsRef.current.length === 0) {
        setTickets(cachedFull.data);
      }

      const showBlockingSkeleton = ticketsRef.current.length === 0;
      if (showBlockingSkeleton) {
        setIsDataLoading(true);
      }
      setDatabaseLoading(true);
      setDataLoadError(null);
      setSyncStage('phase1_critical');

      try {
        const headers = getAuthHeaders();
        let resolvedRole: UserRole = currentUser.role;
        let resolvedUserId: string = currentUser.id;
        let resolvedActive: boolean = currentUser.active;
        let passwordChangeRequired = false;

        // PHASE 1 — Critical Shell, RBAC, First-Paint Work Orders (light payload)
        const critRes = await fetch('/api/bootstrap?mode=critical', {
          headers,
          signal: bootController.signal
        });
        if (bootController.signal.aborted) return;
        if (!critRes.ok) {
          if (critRes.status === 503) {
            const errData = await critRes.json().catch(() => ({}));
            setDatabaseStatus('error');
            setSyncStatus('ERROR');
            setSyncError(errData.message || 'Database authoritative Supabase PostgreSQL tidak tersedia.');
          }
          setIsDataLoading(false);
          setDatabaseLoading(false);
          return;
        }

        const critData = await critRes.json();
        if (bootController.signal.aborted) return;
        if (critData && critData.success) {
          const phase1Meta = applyBootstrapHydration(critData, { isPhase2Full: false, headers });
          resolvedRole = phase1Meta.resolvedRole;
          resolvedUserId = phase1Meta.resolvedUserId;
          resolvedActive = phase1Meta.resolvedActive;
          passwordChangeRequired = phase1Meta.passwordChangeRequired;
        }

        // Release critical UI immediately after Phase 1
        setIsDataLoading(false);
        setDatabaseLoading(false);

        if (!headers['Authorization']) {
          setAuditLogs([]);
          setIsDropdownCategoriesLoading(false);
          setSyncStage('complete');
          return;
        }

        if (passwordChangeRequired) {
          setIsDropdownCategoriesLoading(false);
          setSyncStage('complete');
          return;
        }

        // Yield 1 animation frame so critical shell & Priority 1 rows paint smoothly before Phase 2 starts
        await new Promise<void>(resolve => {
          if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function' && document.visibilityState === 'visible') {
            window.requestAnimationFrame(() => resolve());
          } else {
            window.setTimeout(resolve, 0);
          }
        });
        if (bootController.signal.aborted) return;

        // PHASE 2 — Secondary & Full Operational Hydration (non-blocking, parallel progressive WO + messages/templates + droplists)
        setSyncStage('phase2_secondary');
        setIsProgressiveHydrating(true);

        const [progressiveFullRes, secondaryBootRes, globalBoot] = await Promise.all([
          fetch('/api/work-orders/progressive?phase=full&limit=ALL', {
            headers,
            signal: bootController.signal
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch('/api/bootstrap?mode=secondary', {
            headers,
            signal: bootController.signal
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null),
          bootstrapGlobalConfigs().catch(() => null)
        ]);

        if (bootController.signal.aborted) return;

        if (progressiveFullRes && progressiveFullRes.success && Array.isArray(progressiveFullRes.tickets)) {
          setTickets(prev => mergeProgressiveHydration(prev, progressiveFullRes.tickets));
          setWoCache('wo:full', progressiveFullRes.tickets, progressiveFullRes.serverTime);
          if (progressiveFullRes.serverTime) {
            lastDeltaWatermarkRef.current = progressiveFullRes.serverTime;
          }
        }

        if (secondaryBootRes && secondaryBootRes.success) {
          const p2Meta = applyBootstrapHydration(secondaryBootRes, { isPhase2Full: true, headers });
          resolvedRole = p2Meta.resolvedRole;
          resolvedUserId = p2Meta.resolvedUserId;
          resolvedActive = p2Meta.resolvedActive;
        }

        if (globalBoot) {
          if (globalBoot.rolePermissions && typeof globalBoot.rolePermissions === 'object') {
            setDynamicRolePermissions(globalBoot.rolePermissions);
            setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...globalBoot.rolePermissions });
            setRolePermissionsVersion(globalBoot.rolePermissionsVersion || 1);
          }
          const cfgs = globalBoot.configs || {};
          if (cfgs.hierarchical_droplists) {
            const list = Array.isArray(cfgs.hierarchical_droplists)
              ? cfgs.hierarchical_droplists
              : cfgs.hierarchical_droplists.statuses;
            if (Array.isArray(list) && list.length > 0) setHierarchicalStatuses(list);
          }
          if (cfgs.chat_categories) {
            const list = Array.isArray(cfgs.chat_categories)
              ? cfgs.chat_categories
              : cfgs.chat_categories.categories;
            if (Array.isArray(list) && list.length > 0) setChatCategories(list);
          }
          if (cfgs.report_dropdown_categories) {
            const list = Array.isArray(cfgs.report_dropdown_categories)
              ? cfgs.report_dropdown_categories
              : cfgs.report_dropdown_categories.categories;
            if (Array.isArray(list) && list.length > 0) setReportDropdownCategories(list);
          }
          if (cfgs.workflow_rules) {
            const list = Array.isArray(cfgs.workflow_rules)
              ? cfgs.workflow_rules
              : cfgs.workflow_rules.rules;
            if (Array.isArray(list) && list.length > 0) setWorkflowRules(list);
          }
          if (cfgs.header_mappings) {
            const list = Array.isArray(cfgs.header_mappings)
              ? cfgs.header_mappings
              : cfgs.header_mappings.mappings;
            if (Array.isArray(list) && list.length > 0) setHeaderMappings(list);
          }
          if (cfgs.canonical_fields) {
            const list = Array.isArray(cfgs.canonical_fields)
              ? cfgs.canonical_fields
              : cfgs.canonical_fields.fields;
            if (Array.isArray(list) && list.length > 0) setCanonicalFields(list);
          }
          if (cfgs.root_cause_categories) {
            const list = Array.isArray(cfgs.root_cause_categories)
              ? cfgs.root_cause_categories
              : cfgs.root_cause_categories.categories;
            if (Array.isArray(list) && list.length > 0) setRootCauseCategories(list);
          }
          if (cfgs.google_sheets_config && typeof cfgs.google_sheets_config === 'object') {
            setGoogleSheetsConfig(prev => ({ ...prev, ...cfgs.google_sheets_config }));
          }
          if (globalBoot.operationalDate?.date) {
            setTodayWIB(globalBoot.operationalDate.date);
            setOperationalDateState(globalBoot.operationalDate.date);
            try {
              localStorage.setItem('morajaws_operational_date', globalBoot.operationalDate.date);
            } catch {}
          }
        } else {
          const [hierData, chatCatsData, reportCatsData] = await Promise.all([
            loadHierarchicalDroplistsFromSupabase().catch(() => null),
            loadChatCategoriesFromSupabase().catch(() => null),
            loadReportDropdownCategoriesFromSupabase().catch(() => null)
          ]);
          if (bootController.signal.aborted) return;
          if (Array.isArray(hierData) && hierData.length > 0) setHierarchicalStatuses(hierData);
          if (Array.isArray(chatCatsData) && chatCatsData.length > 0) setChatCategories(chatCatsData);
          if (Array.isArray(reportCatsData) && reportCatsData.length > 0) setReportDropdownCategories(reportCatsData);
        }

        setIsDropdownCategoriesLoading(false);
        setIsProgressiveHydrating(false);

        // PHASE 3 — Deferred Background Collections (Users Directory, Audit Logs) scheduled on browser idle
        setSyncStage('phase3_background');
        const runPhase3Background = () => {
          phase3IdleTimerRef.current = null;
          if (bootController.signal.aborted || !getAuthHeaders()['Authorization']) return;
          void (async () => {
            try {
              const canViewAudit = Boolean(
                resolvedUserId &&
                resolvedActive &&
                resolvedRole === 'super_admin'
              );
              const tasks: Promise<any>[] = [
                supabaseDb
                  .getUsers()
                  .then(usersRes => {
                    if (!bootController.signal.aborted && usersRes.success && Array.isArray(usersRes.data) && usersRes.data.length > 0) {
                      setUsers(usersRes.data);
                    }
                  })
                  .catch(() => {})
              ];
              if (canViewAudit) {
                tasks.push(
                  fetch('/api/supabase/audit-logs?limit=100', {
                    headers: getAuthHeaders(),
                    signal: bootController.signal
                  })
                    .then(r => (r.ok ? r.json() : null))
                    .then(auditData => {
                      if (!bootController.signal.aborted && auditData && auditData.success && Array.isArray(auditData.data)) {
                        setAuditLogs(auditData.data);
                      }
                    })
                    .catch(() => {})
                );
              }
              await Promise.all(tasks);
            } finally {
              if (!bootController.signal.aborted) {
                setSyncStage('complete');
              }
            }
          })();
        };

        const winAny = window as any;
        if (typeof winAny.requestIdleCallback === 'function') {
          winAny.requestIdleCallback(runPhase3Background, { timeout: 600 });
        } else {
          phase3IdleTimerRef.current = window.setTimeout(runPhase3Background, 250);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || bootController.signal.aborted) {
          return;
        }
        console.warn('[CentralData] Sync error:', err);
        setDataLoadError(err?.message || 'Gagal memuat status sesi');
        setDatabaseStatus('error');
        setSyncStatus('ERROR');
      } finally {
        if (centralBootAbortRef.current === bootController) {
          centralBootAbortRef.current = null;
        }
        setIsDataLoading(false);
        setDatabaseLoading(false);
        setIsProgressiveHydrating(false);
      }
    });
  };

  // Bootstrap from central backend on startup
  useEffect(() => {
    loadCentralData();
  }, []);

  // Register two-way sync processor with OfflineSyncContext
  useEffect(() => {
    registerAppSyncHandler(async (items) => {
      let successCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const item of items) {
        try {
          if (item.action === 'STATUS_CHANGE') {
            const { ticketId, statusAgent, statusInstaller, remarks } = item.payload;
            setTickets(prev => prev.map(t => {
              if (t.id === ticketId) {
                return {
                  ...t,
                  ...(statusAgent ? { statusWOAgent: statusAgent } : {}),
                  ...(statusInstaller ? { statusWOInstaller: statusInstaller } : {}),
                  ...(remarks !== undefined ? { remarksWOInstaller: remarks } : {}),
                  _offlineSyncStatus: 'synced',
                  updatedAt: new Date().toISOString()
                };
              }
              return t;
            }));
          } else if (item.action === 'REPORT') {
            const { ticketId, report } = item.payload;
            setTickets(prev => prev.map(t => {
              if (t.id === ticketId) {
                return {
                  ...t,
                  technicalReport: report,
                  _offlineSyncStatus: 'synced',
                  updatedAt: new Date().toISOString()
                };
              }
              return t;
            }));
          } else if (item.action === 'ASSIGN') {
            const { ticketId, leaderName, installerName } = item.payload;
            setTickets(prev => prev.map(t => {
              if (t.id === ticketId) {
                return {
                  ...t,
                  ...(leaderName !== undefined ? { leaderName } : {}),
                  ...(installerName !== undefined ? { installerName } : {}),
                  _offlineSyncStatus: 'synced',
                  updatedAt: new Date().toISOString()
                };
              }
              return t;
            }));
          } else if (item.action === 'UPDATE') {
            const { ticketId, updates } = item.payload;
            setTickets(prev => prev.map(t => {
              if (t.id === ticketId) {
                return {
                  ...t,
                  ...updates,
                  _offlineSyncStatus: 'synced',
                  updatedAt: new Date().toISOString()
                };
              }
              return t;
            }));
          }
          await removeSyncQueueItem(item.id);
          successCount++;
        } catch (err: any) {
          failedCount++;
          errors.push(err?.message || 'Error processing item ' + item.id);
        }
      }
      return { successCount, failedCount, errors };
    });
  }, [registerAppSyncHandler]);

  // Authoritative ticketMessages are persisted in backend/Supabase; purge stale browser storage cache
  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEYS.MESSAGES);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
  }, [templates]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WORKFLOWS, JSON.stringify(workflowRules));
  }, [workflowRules]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(auditLogs));
  }, [auditLogs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WA_LOGS, JSON.stringify(waLogs));
  }, [waLogs]);

  const [googleSheetsConfig, setGoogleSheetsConfig] = useState<GoogleSheetsConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SHEETS_CONFIG);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_SHEETS_CONFIG,
          ...parsed,
          accountEmail: parsed.accountEmail || '',
          accountName: parsed.accountName || ''
        };
      }
    } catch (e) {}
    return DEFAULT_SHEETS_CONFIG;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SHEETS_CONFIG, JSON.stringify(googleSheetsConfig));
  }, [googleSheetsConfig]);

  const assertSuperAdminConfigWrite = (moduleLabel: string): string | null => {
    if (currentUser.role !== 'super_admin') {
      const err = `Akses Ditolak: Hanya Super Admin yang berwenang mengubah konfigurasi global (${moduleLabel}).`;
      addAuditLog(
        'Unauthorized Global Config Attempt',
        'global_config',
        moduleLabel,
        `${currentUser.name} (${currentUser.role}) ditolak mengubah ${moduleLabel}`
      );
      toast.error(err, 'Otorisasi Ditolak');
      return err;
    }
    return null;
  };

  const saveAppConfigDbFirst = async <T,>(
    key: string,
    nextValue: T,
    options: {
      module: string;
      description: string;
      forceOverwrite?: boolean;
      onSuccess: (savedValue: T, version: number) => void;
      retryFactory: () => Promise<{ success: boolean; error?: string }>;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite(options.module);
    if (authErr) return { success: false, error: authErr };
    try {
      setSyncStatus('SYNCING');
      const res = await saveGlobalConfig<T>(key, nextValue, {
        module: options.module,
        description: options.description,
        expectedVersion: getTrackedConfigVersion(key),
        forceOverwrite: Boolean(options.forceOverwrite)
      });
      options.onSuccess(res.value ?? nextValue, res.version);
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      setSyncError(null);
      addAuditLog(`Global Config Saved (${options.module})`, 'global_config', key, `${options.description} (v${res.version})`);
      return { success: true };
    } catch (err: any) {
      if (err instanceof ConfigConflictError) {
        pendingGlobalMutationRef.current = { key, retry: options.retryFactory };
        setGlobalConflict(err.conflict);
        setSyncStatus('ERROR');
        toast.warning(
          `Konflik versi terdeteksi pada ${options.module}. Silakan pilih muat versi terbaru atau timpa perubahan.`,
          'Konflik Konfigurasi (409)'
        );
        return { success: false, error: err.message };
      }
      const msg = err?.message || `Gagal menyimpan ${options.module} ke database.`;
      setSyncStatus('ERROR');
      setSyncError(msg);
      toast.error(msg, 'Gagal Menyimpan ke Database');
      return { success: false, error: msg };
    }
  };

  const clearGlobalConflict = () => {
    setGlobalConflict(null);
    pendingGlobalMutationRef.current = null;
  };

  const resolveGlobalConflict = async (strategy: 'reload' | 'overwrite') => {
    const conflict = globalConflict;
    if (!conflict) return;
    if (strategy === 'reload') {
      try {
        if (conflict.key === 'role_permissions') {
          const res = await getRolePermissionsFromServer();
          setDynamicRolePermissions(res.rolePermissions);
          setRolePermissions({ ...DEFAULT_ROLE_PERMISSIONS, ...res.rolePermissions } as Record<UserRole, string[]>);
          setRolePermissionsVersion(res.version || 1);
        } else {
          await loadCentralData();
        }
        toast.info(`Konfigurasi "${conflict.key}" diperbarui dari versi terbaru di database.`, 'Versi Terbaru Dimuat');
      } catch (err: any) {
        toast.error(err?.message || 'Gagal memuat versi terbaru dari database.');
      } finally {
        clearGlobalConflict();
      }
      return;
    }

    const pending = pendingGlobalMutationRef.current;
    setGlobalConflict(null);
    if (pending) {
      pendingGlobalMutationRef.current = null;
      await pending.retry();
    }
  };

  const updateRolePermissions = async (
    matrix: Record<string, string[]>,
    options: { forceOverwrite?: boolean; notes?: string } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Role & Permission');
    if (authErr) return { success: false, error: authErr };
    try {
      setSyncStatus('SYNCING');
      const res = await saveRolePermissionsToServer(matrix, {
        expectedVersion: getTrackedConfigVersion('role_permissions') ?? rolePermissionsVersion,
        forceOverwrite: Boolean(options.forceOverwrite),
        notes: options.notes
      });
      const merged = { ...DEFAULT_ROLE_PERMISSIONS, ...res.rolePermissions } as Record<UserRole, string[]>;
      setDynamicRolePermissions(merged);
      setRolePermissions(merged);
      setRolePermissionsVersion(res.version || 1);
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Role Permissions Updated', 'global_config', 'role_permissions', `Matriks Role & Permission diperbarui (v${res.version})`);
      toast.success(`Matriks Role & Permission berhasil disimpan ke database (v${res.version}).`, 'Hak Akses Diperbarui');
      return { success: true };
    } catch (err: any) {
      if (err instanceof ConfigConflictError) {
        pendingGlobalMutationRef.current = {
          key: 'role_permissions',
          retry: () => updateRolePermissions(matrix, { ...options, forceOverwrite: true })
        };
        setGlobalConflict(err.conflict);
        setSyncStatus('ERROR');
        toast.warning('Konflik versi matriks Role & Permission terdeteksi.', 'Konflik Konfigurasi (409)');
        return { success: false, error: err.message };
      }
      const msg = err?.message || 'Gagal menyimpan matriks Role & Permission ke database.';
      setSyncStatus('ERROR');
      toast.error(msg, 'Gagal Menyimpan ke Database');
      return { success: false, error: msg };
    }
  };

  const updateGoogleSheetsConfig = async (
    updates: Partial<GoogleSheetsConfig>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Google Sheets Sync');
    if (authErr) return { success: false, error: authErr };
    try {
      setSyncStatus('SYNCING');
      const res = await fetch('/api/sheets/config', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...updates,
          expectedVersion: getTrackedConfigVersion('google_sheets_config'),
          forceOverwrite: Boolean(options.forceOverwrite)
        })
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409 && json?.conflict) {
        pendingGlobalMutationRef.current = {
          key: 'google_sheets_config',
          retry: () => updateGoogleSheetsConfig(updates, { forceOverwrite: true })
        };
        setGlobalConflict(json.conflict);
        setSyncStatus('ERROR');
        toast.warning('Konflik versi Google Sheets Config terdeteksi.', 'Konflik Konfigurasi (409)');
        return { success: false, error: json.error || 'Version conflict' };
      }
      if (!res.ok || !json || json.success !== true) {
        throw new Error(json?.error || `Gagal menyimpan konfigurasi Google Sheets (HTTP ${res.status}).`);
      }
      if (typeof json.version === 'number') {
        setTrackedConfigVersion('google_sheets_config', json.version);
      }
      setGoogleSheetsConfig(prev => ({ ...prev, ...(json.config || updates) }));
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Google Sheets Config Updated', 'global_config', 'sheets', 'Pengaturan sinkronisasi Google Sheet disimpan ke database');
      toast.success('Pengaturan Google Sheets berhasil disimpan ke database.', 'Tersimpan');
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Gagal menyimpan konfigurasi Google Sheets ke database.';
      setSyncStatus('ERROR');
      toast.error(msg, 'Gagal Menyimpan ke Database');
      return { success: false, error: msg };
    }
  };

  const addAuditLog = (action: string, entity: AuditLog['entity'], entityId: string, details: string) => {
    const entry: AuditLog = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      action,
      entity,
      entityId,
      details,
      performedBy: currentUser.name,
      userRole: currentUser.role,
      timestamp: new Date().toISOString()
    };
    setAuditLogs(prev => [entry, ...prev.slice(0, 499)]);
  };

  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);

  // Live Asia/Jakarta (WIB) calendar date for automatic 00:00 WIB active WO reset
  const [todayWIB, setTodayWIB] = useState<string>(() => getJakartaDateString(0));

  // Operational schedule reference date (Asia/Jakarta WIB — always initializes to live todayWIB)
  const [operationalDate, setOperationalDateState] = useState<string>(() => getJakartaDateString(0));

  // WO Lifecycle Dashboard KPI Summary & Drill-Down State
  const [kpiSummary, setKpiSummary] = useState<WOKpiSummary | null>(null);
  const [isKpiLoading, setIsKpiLoading] = useState<boolean>(false);
  const [lastKpiUpdatedAt, setLastKpiUpdatedAt] = useState<string | null>(null);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [kpiContractorFilter, setKpiContractorFilter] = useState<string>('ALL');
  const [kpiAreaFilter, setKpiAreaFilter] = useState<string>('ALL');
  const [activeKpiDrilldown, setActiveKpiDrilldown] = useState<{
    filterKey: WOKpiFilterKey;
    dateWIB?: string;
    contractor?: string;
    area?: string;
  } | null>(null);

  const kpiRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshKpiSummary = React.useCallback(
    async (opts?: { date?: string; contractor?: string; area?: string; silent?: boolean }) => {
      const headers = getAuthHeaders();
      if (!headers['Authorization']) return;
      if (!opts?.silent) {
        setIsKpiLoading(true);
      }
      setKpiError(null);
      try {
        const res = await supabaseDb.fetchDashboardKpiSummary({
          date: opts?.date || todayWIB,
          contractor: opts?.contractor ?? kpiContractorFilter,
          area: opts?.area ?? kpiAreaFilter
        });
        if (res.success && res.data) {
          setKpiSummary(res.data);
          setLastKpiUpdatedAt(new Date().toISOString());
        } else if (res.error) {
          setKpiError(res.error.message || 'Gagal memuat ringkasan KPI');
        }
      } catch (err: any) {
        setKpiError(err?.message || 'Gagal memuat ringkasan KPI');
      } finally {
        if (!opts?.silent) {
          setIsKpiLoading(false);
        }
      }
    },
    [todayWIB, kpiContractorFilter, kpiAreaFilter]
  );

  const scheduleKpiRefreshRef = useRef<(() => void) | undefined>(undefined);
  scheduleKpiRefreshRef.current = () => {
    if (kpiRefreshTimerRef.current) clearTimeout(kpiRefreshTimerRef.current);
    kpiRefreshTimerRef.current = setTimeout(() => {
      refreshKpiSummary({ silent: true }).catch(() => {});
    }, 350);
  };

  useEffect(() => {
    if (isLoggedIn) {
      refreshKpiSummary().catch(() => {});
    }
  }, [isLoggedIn, todayWIB, kpiContractorFilter, kpiAreaFilter, refreshKpiSummary]);

  const setOperationalDate = async (
    date: string,
    options: { isAuto?: boolean; forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Tanggal Operasional');
    if (authErr) return { success: false, error: authErr };
    try {
      setSyncStatus('SYNCING');
      const res = await fetch('/api/system/operational-date', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          operationalDate: date,
          isAuto: Boolean(options.isAuto),
          expectedVersion: getTrackedConfigVersion('operational_date_config'),
          forceOverwrite: Boolean(options.forceOverwrite)
        })
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409 && json?.conflict) {
        pendingGlobalMutationRef.current = {
          key: 'operational_date_config',
          retry: () => setOperationalDate(date, { ...options, forceOverwrite: true })
        };
        setGlobalConflict(json.conflict);
        setSyncStatus('ERROR');
        toast.warning('Konflik versi Tanggal Operasional terdeteksi.', 'Konflik Konfigurasi (409)');
        return { success: false, error: json.error || 'Version conflict' };
      }
      if (!res.ok || !json || json.success !== true) {
        throw new Error(json?.error || `Gagal menyimpan tanggal operasional (HTTP ${res.status}).`);
      }
      if (typeof json.version === 'number') {
        setTrackedConfigVersion('operational_date_config', json.version);
      }
      const committedDate = json.operationalDate || date;
      setTodayWIB(committedDate);
      setOperationalDateState(committedDate);
      try {
        localStorage.setItem('morajaws_operational_date', committedDate);
      } catch (e) {}
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Operational Date Updated', 'global_config', 'operational_date_config', `Tanggal operasional diatur ke ${committedDate} (v${json.version || 1})`);
      toast.success(`Tanggal operasional global diperbarui ke ${committedDate}.`, 'Tersimpan ke Database');
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Gagal menyimpan tanggal operasional ke database.';
      setSyncStatus('ERROR');
      toast.error(msg, 'Gagal Menyimpan ke Database');
      return { success: false, error: msg };
    }
  };

  // Authoritative backend sync for today's active WOs (uses lightweight delta sync when cache exists)
  const refreshActiveTickets = async () => {
    try {
      const headers = getAuthHeaders();
      if (!headers['Authorization']) return;
      if (ticketsRef.current.length > 0) {
        await runDeltaSync({ force: true });
        return;
      }
      await loadCentralData();
    } catch {}
  };

  // Multi-layer 00:00 WIB Midnight Auto-Reset Watcher (Exact Midnight Timeout + 15s Drift Check + Focus/Visibility Return Refresh)
  const lastVisibilityRefreshAtRef = useRef<number>(Date.now());
  useEffect(() => {
    let cancelled = false;
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;

    const checkAndApplyJakartaRollover = (forceActiveRefresh = false) => {
      if (cancelled) return;
      const liveNowWIB = getJakartaDateString(0);
      let rolledOver = false;
      setTodayWIB(prev => {
        if (prev !== liveNowWIB) {
          rolledOver = true;
          setOperationalDateState(liveNowWIB);
          try {
            localStorage.setItem('morajaws_operational_date', liveNowWIB);
          } catch {}
          if (navigator.onLine) {
            lastVisibilityRefreshAtRef.current = Date.now();
            refreshActiveTickets().catch(() => {});
          }
          toast.info(`Tanggal berganti ke ${liveNowWIB} (00:00 WIB). Daftar WO aktif diperbarui otomatis.`, 'Auto Reset 00:00 WIB');
          return liveNowWIB;
        }
        return prev;
      });

      if (!rolledOver && forceActiveRefresh && navigator.onLine) {
        const elapsed = Date.now() - lastVisibilityRefreshAtRef.current;
        if (elapsed >= 45_000) {
          lastVisibilityRefreshAtRef.current = Date.now();
          refreshActiveTickets().catch(() => {});
          refreshKpiSummary().catch(() => {});
        }
      }
    };

    const scheduleMidnightTimeout = () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      const msUntilMidnight = getMsUntilNextJakartaMidnight();
      midnightTimer = setTimeout(() => {
        checkAndApplyJakartaRollover();
        scheduleMidnightTimeout();
      }, Math.min(msUntilMidnight, 2147483647));
    };

    scheduleMidnightTimeout();

    const driftInterval = setInterval(() => checkAndApplyJakartaRollover(false), 15000);
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        checkAndApplyJakartaRollover(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      if (midnightTimer) clearTimeout(midnightTimer);
      clearInterval(driftInterval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, []);

  // Authentication & Session (Phase 13E: Supabase Auth as Sole Production Mechanism)
  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string; user?: User; errorCode?: string }> => {
    const cleanUser = username.trim();
    if (!cleanUser) {
      return { success: false, error: 'Nama pengguna atau email wajib diisi.', errorCode: 'INVALID_INPUT' };
    }
    if (!password) {
      return { success: false, error: 'Kata sandi wajib diisi.', errorCode: 'INVALID_INPUT' };
    }

    if (!navigator.onLine) {
      return {
        success: false,
        error: 'Koneksi jaringan terputus. Pastikan perangkat Anda terhubung ke internet.',
        errorCode: 'auth/network-request-failed'
      };
    }

    try {
      // Primary Production Authentication Gateway: /api/auth/login (MoraJaws Custom Auth)
      const serverRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: cleanUser,
          password
        })
      });

      const data = await serverRes.json().catch(() => ({}));

      if (!serverRes.ok || !data.success) {
        const errCode = data.code || 'MJ-AUTH-001';
        let errorMsg = data.error || 'Autentikasi gagal. Kredensial tidak cocok.';

        if (errCode === 'DATABASE_UNAVAILABLE' || serverRes.status === 503) {
          errorMsg = 'Database authoritative Supabase PostgreSQL tidak dapat diakses saat login.';
        } else if (serverRes.status === 404 || errCode === 'auth/user-not-found' || errCode === 'ACCOUNT_NOT_FOUND') {
          errorMsg = `Nama pengguna atau email "${cleanUser}" tidak ditemukan. Hubungi Superadmin untuk mendapatkan akses MoraJaws.`;
        } else if (serverRes.status === 403 || errCode === 'auth/user-disabled' || errCode === 'ACCOUNT_DISABLED' || errCode === 'ACCOUNT_DELETED') {
          errorMsg = data.error || 'Akun Anda telah dinonaktifkan oleh Administrator. Hubungi Super Admin.';
        } else if (serverRes.status === 429 || errCode === 'auth/too-many-requests' || errCode === 'ACCOUNT_LOCKED') {
          errorMsg = data.error || 'Terlalu banyak percobaan login yang gagal. Akses akun ditangguhkan sementara demi keamanan.';
        } else if (errCode === 'AUTH_INVALID_CREDENTIALS' || errCode === 'INVALID_CREDENTIALS' || errCode === 'auth/wrong-password') {
          errorMsg = data.error || 'Autentikasi gagal. Kredensial tidak cocok.';
        }

        addAuditLog('Login Attempt Failed', 'auth', cleanUser, errorMsg);
        return {
          success: false,
          error: errorMsg,
          errorCode: errCode
        };
      }

      const rawUser = data.user;
      const authedUser: User = {
        ...rawUser,
        lastLoginAt: new Date().toISOString()
      };

      setUsers(prev => {
        const exists = prev.find(u => u.id === authedUser.id);
        if (exists) {
          return prev.map(u => u.id === authedUser.id ? { ...u, ...authedUser } : u);
        }
        return [...prev, authedUser];
      });
      setCurrentUser(authedUser);
      setIsLoggedIn(true);

      const accessToken = data.tokens?.accessToken || data.token;
      const refreshToken = data.tokens?.refreshToken;
      const expiresIn = data.tokens?.expiresIn;
      const expiresAt = data.tokens?.expiresAt || (expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined);

      try {
        localStorage.setItem('morajaws_logged_in', 'true');
        localStorage.setItem('morajaws_auth_session', JSON.stringify({
          userId: authedUser.id,
          username: authedUser.username,
          role: authedUser.role,
          name: authedUser.name,
          contractor: authedUser.contractor,
          area: authedUser.area,
          loginAt: authedUser.lastLoginAt,
          token: accessToken,
          accessToken,
          refreshToken,
          sessionId: data.sessionId,
          sessionVersion: data.sessionVersion || (authedUser as any).sessionVersion || 1,
          expiresAt
        }));
        window.dispatchEvent(new CustomEvent('morajaws:auth-changed'));
      } catch (e) {}

      addAuditLog('Login Success', 'auth', authedUser.id, `Pengguna ${authedUser.name} (${authedUser.role}) berhasil login ke sistem via MoraJaws Custom Auth`);
      if (authedUser.role === 'installer' && data.sessionId) {
        installerGpsTracker
          .startForAuthenticatedInstaller({
            userId: authedUser.id,
            role: authedUser.role,
            sessionId: data.sessionId
          })
          .catch(() => {});
      }

      // Non-blocking progressive sync after login (unless user must change password first)
      if (!authedUser.mustChangePassword) {
        void loadCentralData();
      } else {
        setIsDataLoading(false);
        setSyncStage('complete');
      }
      try {
        window.dispatchEvent(new CustomEvent('morajaws:event-sound', { detail: { event: 'ready' } }));
      } catch {}
      return { success: true, user: authedUser };

    } catch (err: any) {
      console.error('[Auth] Login exception:', err);
      return {
        success: false,
        error: err?.message || 'Terjadi gangguan saat memproses autentikasi.',
        errorCode: 'AUTH_EXCEPTION'
      };
    }
  };

  const refreshAuthSession = async (): Promise<boolean> => {
    try {
      const sessionStr = localStorage.getItem('morajaws_auth_session');
      if (!sessionStr) return false;
      const sess = JSON.parse(sessionStr);
      if (!sess?.refreshToken) return false;

      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: sess.refreshToken })
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.success && data.tokens) {
        const updatedSess = {
          ...sess,
          token: data.tokens.accessToken,
          accessToken: data.tokens.accessToken,
          refreshToken: data.tokens.refreshToken || sess.refreshToken,
          expiresAt: data.tokens.expiresAt
        };
        localStorage.setItem('morajaws_auth_session', JSON.stringify(updatedSess));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Authentication & Session: Pure MoraJaws Custom Authentication backed by Supabase PostgreSQL

  const logout = () => {
    addAuditLog('User Logout', 'auth', currentUser.id, `Pengguna ${currentUser.name} (${currentUser.role}) logout dari sistem`);
    installerGpsTracker.stopTracking();
    cancelPendingDeltaRetry();
    if (centralBootAbortRef.current) {
      centralBootAbortRef.current.abort();
      centralBootAbortRef.current = null;
    }
    if (deltaSyncAbortRef.current) {
      deltaSyncAbortRef.current.abort();
      deltaSyncAbortRef.current = null;
    }
    if (phase3IdleTimerRef.current !== null) {
      clearTimeout(phase3IdleTimerRef.current);
      phase3IdleTimerRef.current = null;
    }
    setIsChangePasswordModalOpen(false);
    const authHeaders = getAuthHeaders();
    setIsLoggedIn(false);
    setCurrentUser(UNAUTHENTICATED_USER);
    setTicketMessages([]);
    setTickets([]);
    deliveredTriggeredRef.current.clear();
    notifiedChatSoundIdsRef.current.clear();
    notifiedWoEventKeysRef.current.clear();
    invalidateWoCache();
    try {
      localStorage.setItem('morajaws_logged_in', 'false');
      localStorage.removeItem('morajaws_auth_session');
      localStorage.removeItem(STORAGE_KEYS.MESSAGES);
      window.dispatchEvent(new CustomEvent('morajaws:auth-changed'));
    } catch (e) {}

    // Invoke MoraJaws Custom Auth logout on Express backend
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      }
    }).catch(() => {});

    // Reload public bootstrap after logout
    loadCentralData();

    toast.info('Anda telah berhasil logout dari sistem MoraJaws.', 'Logout');
  };

  const syncRotatedPasswordSessionState = (payload: {
    user: User;
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    sessionId?: string;
    sessionVersion?: number;
  }) => {
    const nextUser: User = {
      ...currentUserRef.current,
      ...payload.user,
      mustChangePassword: false,
      passwordChangedAt: new Date().toISOString()
    };
    setCurrentUser(nextUser);
    currentUserRef.current = nextUser;
    try {
      const raw = localStorage.getItem('morajaws_auth_session');
      const prevSess = raw ? JSON.parse(raw) : {};
      const nextToken = payload.accessToken || payload.token || prevSess.token;
      localStorage.setItem(
        'morajaws_auth_session',
        JSON.stringify({
          ...prevSess,
          userId: nextUser.id,
          username: nextUser.username,
          role: nextUser.role,
          name: nextUser.name,
          token: nextToken,
          accessToken: nextToken,
          refreshToken: payload.refreshToken || prevSess.refreshToken,
          sessionId: payload.sessionId || prevSess.sessionId,
          sessionVersion: payload.sessionVersion || prevSess.sessionVersion
        })
      );
      window.dispatchEvent(new CustomEvent('morajaws:auth-changed'));
    } catch {}
  };

  const applyRotatedPasswordSession = async (payload: {
    user: User;
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    sessionId?: string;
    sessionVersion?: number;
  }) => {
    syncRotatedPasswordSessionState(payload);
    toast.success('Kata sandi akun berhasil diperbarui.', 'Keamanan Diperbarui');
  };

  const completeMandatoryPasswordChange = async (payload: {
    user: User;
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    sessionId?: string;
    sessionVersion?: number;
  }) => {
    syncRotatedPasswordSessionState(payload);
    invalidateWoCache();
    toast.success('Kata sandi baru aktif. Memuat data operasional MoraJaws...', 'Keamanan Diperbarui');
    await loadCentralData();
  };

  const hasPermission = (permission: Permission) => checkPermission(currentUser.role, permission);
  const canDelete = currentUser.role === 'super_admin';
  const canImport = currentUser.role === 'super_admin';
  const canEditWOData = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  // Role Scoped Work Orders (Strict RBAC)
  const scopedTickets = React.useMemo(() => {
    return tickets.filter(t => {
      if (!t || t.isDeleted) return false;
      if (!currentUser || !currentUser.role) return false;
      // 1. Super Admin and Dispatch have system-wide visibility
      if (currentUser.role === 'super_admin' || currentUser.role === 'dispatch') return true;

      const ticketContractor = String(t.contactorName || t.contractorName || '').toLowerCase().trim();
      const ticketArea = String(t.area || '').toLowerCase().trim();

      // 2. Leader / Korlap: Strictly limited to their contractor and area
      if (currentUser.role === 'leader') {
        const leaderContractor = String(currentUser.contractor || '').toLowerCase().trim();
        const leaderArea = String(currentUser.area || '').toLowerCase().trim();

        if (!leaderContractor) return false;
        const matchContractor = Boolean(
          ticketContractor === leaderContractor ||
          (ticketContractor && leaderContractor && (ticketContractor.includes(leaderContractor) || leaderContractor.includes(ticketContractor)))
        );
        const matchArea = !leaderArea || Boolean(
          ticketArea === leaderArea ||
          (ticketArea && leaderArea && (ticketArea.includes(leaderArea) || leaderArea.includes(ticketArea)))
        );
        return matchContractor && matchArea;
      }

      // 3. Installer / Teknisi: STRICTLY LIMITED to tickets explicitly assigned to this technician!
      if (currentUser.role === 'installer') {
        const myId = String(currentUser.id || '').trim();
        if (!myId) return false;

        // Enforce contractor match when user has contractor configured
        const uContrId = String(currentUser.contractorId || '').toLowerCase().trim();
        const uContrName = String(currentUser.contractor || '').toLowerCase().trim();
        const tContrId = String(t.contractorId || '').toLowerCase().trim();
        const tContrName = ticketContractor;
        if (uContrId || uContrName) {
          if (!tContrId && !tContrName) return false;
          const contrMatch =
            (uContrId && tContrId && uContrId === tContrId) ||
            (uContrName && tContrName && (tContrName === uContrName || tContrName.includes(uContrName) || uContrName.includes(tContrName)));
          if (!contrMatch) return false;
        }

        const ticketAssignedIds = [
          t.installerId,
          (t as any).installerUid,
          t.assignedToUid,
          (t as any).assignedToId
        ]
          .map(v => String(v || '').trim())
          .filter(Boolean);

        const fbUid = String((currentUser as any).firebaseUid || '').trim();
        const myUsername = String(currentUser.username || '').trim().toLowerCase();

        // When explicit installer ID/UID exists on ticket, require strict identity match
        if (ticketAssignedIds.length > 0) {
          return ticketAssignedIds.some(
            aid => aid === myId || (Boolean(fbUid) && aid === fbUid)
          );
        }

        const assignedToRaw = String(t.assignedTo || '').trim();
        if (assignedToRaw && (assignedToRaw === myId || (fbUid && assignedToRaw === fbUid) || (myUsername && assignedToRaw.toLowerCase() === myUsername))) {
          return true;
        }

        // Fallback only when no explicit ID fields exist on legacy ticket records (exact normalized name/phone only)
        const myName = String(currentUser.name || '').toLowerCase().trim();
        const cleanMyName = myName.replace(/\(.*?\)/g, '').trim();
        const ticketInst = String(t.installerName || '').toLowerCase().trim();
        const cleanTicketInst = ticketInst.replace(/\(.*?\)/g, '').trim();
        if (!ticketInst && !assignedToRaw) return false;

        const exactNameMatch = Boolean(
          (ticketInst && (ticketInst === myName || (cleanMyName && cleanTicketInst === cleanMyName))) ||
          (myUsername && ticketInst === myUsername)
        );
        const phoneMatch = Boolean(
          currentUser.phone &&
          t.installerContact &&
          String(t.installerContact).replace(/\D/g, '') === String(currentUser.phone).replace(/\D/g, '')
        );

        return exactNameMatch || phoneMatch;
      }

      return false;
    });
  }, [tickets, currentUser]);

  // Active today's Work Orders (Strict Asia/Jakarta appointmentDate === todayWIB; never createdAt)
  const activeTodayTickets = React.useMemo(() => {
    return (tickets || []).filter(t => {
      if (!t || t.isArchived || t.isDeleted) return false;
      return getTicketAppointmentDate(t) === todayWIB;
    });
  }, [tickets, todayWIB]);

  // Role-scoped AND active-today Work Orders (Auto-reset at 00:00 WIB for all staff roles)
  const scopedActiveTickets = React.useMemo(() => {
    return (scopedTickets || []).filter(t => {
      if (!t || t.isArchived || t.isDeleted) return false;
      return getTicketAppointmentDate(t) === todayWIB;
    });
  }, [scopedTickets, todayWIB]);

  // Centralized WO Classification Engine (TODAY | UPCOMING | OVERDUE | COMPLETED | EXCEPTION)
  const overdueTickets = React.useMemo(() => {
    return (scopedTickets || [])
      .filter(t => {
        if (!t || t.isArchived || t.isDeleted) return false;
        return classifyWorkOrder(t, todayWIB).classification === 'OVERDUE';
      })
      .map(t => {
        const meta = classifyWorkOrder(t, todayWIB);
        return {
          ...t,
          woClassification: meta.classification,
          overdueDays: meta.overdueDays,
          overdueDurationBucket: meta.overdueDurationBucket
        };
      });
  }, [scopedTickets, todayWIB]);

  const exceptionTickets = React.useMemo(() => {
    if (currentUser?.role !== 'super_admin') {
      return [];
    }
    return (scopedTickets || [])
      .filter(t => {
        if (!t || t.isArchived || t.isDeleted) return false;
        return classifyWorkOrder(t, todayWIB).classification === 'EXCEPTION';
      })
      .map(t => ({
        ...t,
        woClassification: 'EXCEPTION' as const,
        overdueDays: 0,
        overdueDurationBucket: null
      }));
  }, [scopedTickets, todayWIB, currentUser?.role]);

  const { overdueSummary, classificationSummary } = React.useMemo(() => {
    const activePool = (scopedTickets || []).filter(t => t && !t.isArchived && !t.isDeleted);
    const summary = summarizeWorkOrderClassifications(activePool, todayWIB);
    return {
      overdueSummary: summary.overdueBreakdown,
      classificationSummary: summary
    };
  }, [scopedTickets, todayWIB]);

  const refreshOverdueTickets = async () => {
    await refreshActiveTickets();
  };



  const deleteUser = (userId: string, reason: string, permanent: boolean = false): { success: boolean; error?: string } => {
    if (currentUser.role !== 'super_admin') {
      const err = 'Akses Ditolak: Hanya Super Admin yang berwenang menghapus akun pengguna.';
      addAuditLog('Unauthorized User Deletion', 'auth', userId, `${currentUser.name} (${currentUser.role}) mencoba menghapus akun pengguna`);
      toast.error(err, 'Akses Ditolak');
      return { success: false, error: err };
    }
    if (userId === currentUser.id) {
      toast.error('Anda tidak dapat menghapus akun Anda sendiri saat sedang login.', 'Gagal Hapus');
      return { success: false, error: 'Anda tidak dapat menghapus akun Anda sendiri saat sedang login.' };
    }
    const target = users.find(u => u.id === userId);
    if (!target) {
      toast.error('Pengguna tidak ditemukan.', 'Error');
      return { success: false, error: 'Pengguna tidak ditemukan.' };
    }
    if (!reason || reason.trim().length < 5) {
      toast.error('Alasan penghapusan akun wajib diisi minimal 5 karakter.', 'Validasi Gagal');
      return { success: false, error: 'Alasan penghapusan akun wajib diisi minimal 5 karakter.' };
    }

    const now = new Date().toISOString();
    if (permanent) {
      setUsers(prev => prev.filter(u => u.id !== userId));
      supabaseDb.deleteUser(userId, reason)
        .then(res => {
          if (res.success) {
            toast.warning(`Akun ${target.name} (@${target.username}) telah dihapus dari Supabase PostgreSQL.`, 'Akun Dihapus');
          } else {
            toast.error('Gagal menghapus user di Supabase PostgreSQL: ' + (res.error?.message || 'Error'));
          }
        })
        .catch(err => toast.error('Gagal menghapus user di Supabase PostgreSQL: ' + (err?.message || err)));
      addAuditLog('User Permanently Deleted', 'auth', userId, `Super Admin ${currentUser.name} menghapus akun ${target.name} (@${target.username}). Alasan: ${reason}`);
    } else {
      const softDeleted = {
        ...target,
        isArchived: true,
        active: false,
        deletedAt: now,
        deletedBy: currentUser.name,
        deletionReason: reason
      };
      setUsers(prev => prev.map(u => (u.id === userId ? softDeleted : u)));
      supabaseDb.deleteUser(userId, reason)
        .then(res => {
          if (res.success) {
            toast.warning(`Akun ${target.name} (@${target.username}) berhasil dinonaktifkan & ditandai terhapus di Supabase PostgreSQL.`, 'Akun Dihapus (Soft Delete)');
          } else {
            toast.error('Gagal memperbarui status user di Supabase PostgreSQL: ' + (res.error?.message || 'Error'));
          }
        })
        .catch(err => toast.error('Gagal memperbarui status user di Supabase PostgreSQL: ' + (err?.message || err)));
      addAuditLog('User Soft Deleted', 'auth', userId, `Super Admin ${currentUser.name} menonaktifkan & menandai terhapus (soft delete) akun ${target.name} (@${target.username}). Alasan: ${reason}`);
    }

    return { success: true };
  };

  const updateUser = async (userId: string, updates: Partial<User>): Promise<{ success: boolean; error?: string }> => {
    if (currentUser.role !== 'super_admin' && currentUser.id !== userId) {
      const isLeaderManagingOwnInstaller =
        currentUser.role === 'leader' &&
        users.find(u => u.id === userId)?.role === 'installer' &&
        users.find(u => u.id === userId)?.contractor === currentUser.contractor;
      if (!isLeaderManagingOwnInstaller) {
        const err = 'Akses Ditolak: Anda tidak memiliki wewenang untuk mengubah data pengguna ini.';
        toast.error(err, 'Akses Ditolak');
        return { success: false, error: err };
      }
    }

    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) {
      return { success: false, error: 'Pengguna tidak ditemukan.' };
    }

    // Name and Username uniqueness validation
    if (updates.name) {
      const cleanName = updates.name.trim().replace(/\s+/g, ' ');
      const nameTaken = users.some(
        u => u.id !== userId && !u.isDeleted && u.name.trim().replace(/\s+/g, ' ').toLowerCase() === cleanName.toLowerCase()
      );
      if (nameTaken) {
        const err = 'AKUN SUDAH TERDAFTAR – Nama atau username sudah digunakan.';
        toast.error(err, 'Validasi Gagal');
        return { success: false, error: err };
      }
    }

    if (updates.username) {
      const cleanUsername = updates.username.trim().toLowerCase().replace(/\s+/g, '');
      const usernameTaken = users.some(
        u => u.id !== userId && !u.isDeleted && u.username.trim().toLowerCase() === cleanUsername
      );
      if (usernameTaken) {
        const err = 'AKUN SUDAH TERDAFTAR – Nama atau username sudah digunakan.';
        toast.error(err, 'Validasi Gagal');
        return { success: false, error: err };
      }
    }

    const updatedUser: User = {
      ...targetUser,
      ...updates,
      name: updates.name ? updates.name.trim().replace(/\s+/g, ' ') : targetUser.name,
      username: updates.username ? updates.username.trim().toLowerCase().replace(/\s+/g, '') : targetUser.username,
      id: userId
    };

    setUsers(prev => prev.map(u => (u.id === userId ? updatedUser : u)));

    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.updateUser(userId, updatedUser);
      if (!res.success) {
        setSyncStatus('ERROR');
        const msg = res.error?.message || 'Gagal menyimpan perubahan pengguna ke Supabase PostgreSQL.';
        toast.error(msg, 'Update Gagal');
        return { success: false, error: msg };
      }
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());

      toast.success(`Data akun ${updatedUser.name} berhasil diperbarui di Supabase PostgreSQL.`, 'Akun Diperbarui');
      addAuditLog('User Account Updated', 'auth', userId, `${currentUser.name} memperbarui profil pengguna ${updatedUser.name}`);
      return { success: true };
    } catch (err: any) {
      setSyncStatus('ERROR');
      toast.error('Gagal menyimpan perubahan pengguna: ' + (err?.message || err));
      return { success: false, error: err?.message || 'Gagal update pengguna' };
    }
  };

  const executeComprehensiveDeduplication = async (): Promise<DuplicateAuditReport> => {
    // Strict RBAC: Exclusive to Superadmin role
    if (currentUser.role !== 'super_admin') {
      const errMsg = 'Akses Ditolak: Hanya akun Superadmin yang memiliki wewenang merekonsiliasi atau menghapus duplikasi Work Order.';
      addAuditLog(
        'Unauthorized Deduplication Attempt Blocked',
        'ticket',
        'deduplication',
        `User ${currentUser.name} (${currentUser.role}) ditolak menjalankan penghapusan duplikasi dokumen WO. Otoritas eksklusif Superadmin.`
      );
      toast.error(errMsg, 'Akses Ditolak');
      return {
        totalExamined: tickets.length,
        totalValid: tickets.length,
        duplicatesFound: 0,
        duplicatesCleaned: 0,
        conflictsFound: 0,
        manualReviewList: [],
        failedCount: 0,
        cleanedTicketList: tickets,
        duplicateDocIdsToDelete: [],
        mergedMasterTickets: [],
        totalInspected: tickets.length,
        totalDuplicatesDetected: 0,
        totalDuplicatesCleaned: 0,
        totalConflicts: 0,
        totalManualReviewNeeded: 0,
        totalFailed: 0,
        conflictItems: []
      };
    }

    const report = auditAndCleanDuplicates(tickets, (action, _entity, id, details) => {
      addAuditLog(action, 'ticket', id, details);
    });
    if (report.duplicatesCleaned > 0) {
      setTickets(report.cleanedTicketList);
      if (report.mergedMasterTickets.length > 0) {
        try {
          await Promise.all(report.mergedMasterTickets.map(t => supabaseDb.updateWorkOrder(t.id, t)));
        } catch (e) {
          console.warn('[Supabase] Error saving merged master tickets:', e);
        }
      }
      if (report.duplicateDocIdsToDelete.length > 0) {
        try {
          await Promise.all(report.duplicateDocIdsToDelete.map(id => supabaseDb.deleteWorkOrder(id, 'Automated Deduplication', currentUser.name)));
        } catch (e) {
          console.warn('[Supabase] Error deleting duplicate docs:', e);
        }
      }
      addAuditLog(
        'Automated Deduplication Executed',
        'database_sync',
        'audit_clean',
        `Pembersihan duplikasi selesai: ${report.duplicatesCleaned} duplikat dibersihkan, ${report.totalValid} dokumen valid dipertahankan, ${report.conflictsFound} konflik ditandai.`
      );
      toast.success(
        `Pembersihan selesai: ${report.duplicatesCleaned} duplikasi dibersihkan dari ${report.totalExamined} dokumen.`,
        'Rekonsiliasi Sukses'
      );
    } else {
      toast.info('Database bersih! Tidak ditemukan record duplikat yang perlu dibersihkan.', 'Pemeriksaan Selesai');
    }
    return report;
  };

  const deleteCustomerData = (customerId: string, reason: string): { success: boolean; error?: string } => {
    if (currentUser.role !== 'super_admin') {
      toast.error('Akses Ditolak: Hanya Super Admin yang berwenang menghapus data pelanggan.', 'Akses Ditolak');
      return { success: false, error: 'Akses Ditolak: Hanya Super Admin yang berwenang menghapus data pelanggan.' };
    }
    if (!reason || reason.trim().length < 5) {
      toast.error('Alasan penghapusan pelanggan wajib diisi minimal 5 karakter.', 'Validasi Gagal');
      return { success: false, error: 'Alasan penghapusan pelanggan wajib diisi minimal 5 karakter.' };
    }

    const now = new Date().toISOString();
    const affectedTickets: Ticket[] = [];
    // Strict RBAC: deleteCustomerData MUST NOT delete or soft-delete Work Orders!
    setTickets(prev => prev.map(t => {
      const isTarget = t.idCustomer === customerId || t.customerId === customerId;
      if (!isTarget) return t;
      const updatedT: Ticket = {
        ...t,
        customerName: '[Data Pelanggan Dihapus]',
        customerPhone: '',
        updatedAt: now,
        updatedBy: currentUser.name
      };
      affectedTickets.push(updatedT);
      return updatedT;
    }));

    if (affectedTickets.length > 0) {
      setSyncStatus('SYNCING');
      Promise.all(affectedTickets.map(t => supabaseDb.updateWorkOrder(t.id, t)))
        .then(() => {
          setSyncStatus('SAVED');
          setLastSyncTime(new Date().toISOString());
        })
        .catch(err => {
          setSyncStatus('ERROR');
          console.warn('[Supabase] Error anonymizing customer tickets:', err);
        });
    }

    addAuditLog('Customer Data Anonymized', 'ticket', customerId, `Super Admin ${currentUser.name} menganonimkan data pelanggan ID ${customerId}. Alasan: ${reason}. Work Order tetap aktif.`);
    toast.info(`Data identitas pelanggan ID ${customerId} pada ${affectedTickets.length} tiket berhasil diproses tanpa menghapus Work Order.`, 'Data Pelanggan Diproses');
    return { success: true };
  };

  // Account Registration
  const registerDispatchAccount = (data: { name: string; username: string; phone?: string; email?: string }) => {
    if (currentUser.role !== 'super_admin') {
      addAuditLog('Unauthorized Staff Registration Blocked', 'auth', 'dispatch', `Ditolak: Leader/Staf ${currentUser.name} (${currentUser.role}) mencoba mendaftarkan akun Dispatch.`);
      return { success: false, error: 'Akses Ditolak: Hanya Super Admin yang berwenang mendaftarkan akun Dispatch.' };
    }

    const cleanName = data.name.trim().replace(/\s+/g, ' ');
    const cleanUsername = data.username.trim().toLowerCase().replace(/\s+/g, '');
    if (!cleanName || !cleanUsername) {
      return { success: false, error: 'Nama lengkap dan username wajib diisi.' };
    }

    // Check uniqueness of both name and username across all registered users
    const isNameTaken = users.some(u => !u.isDeleted && u.name.trim().replace(/\s+/g, ' ').toLowerCase() === cleanName.toLowerCase());
    const isUsernameTaken = users.some(u => !u.isDeleted && u.username.trim().toLowerCase() === cleanUsername);

    if (isNameTaken || isUsernameTaken) {
      const err = 'AKUN SUDAH TERDAFTAR – Nama atau username sudah digunakan.';
      toast.error(err, 'Registrasi Ditolak');
      return { success: false, error: err };
    }

    const newUser: User = {
      id: 'u-' + Date.now(),
      name: cleanName,
      username: cleanUsername,
      email: data.email?.trim() || `${cleanUsername}@morajaws.net`,
      phone: data.phone?.trim(),
      role: 'dispatch',
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    };

    setUsers(prev => [...prev, newUser]);
    addAuditLog('Dispatch Account Registered', 'auth', newUser.id, `Super Admin registered Dispatch account: ${newUser.name} (@${newUser.username})`);

    supabaseDb.createUser(newUser).catch(e => console.warn('[Supabase] Error saving dispatch account:', e));

    toast.success(`Akun Dispatch ${newUser.name} berhasil didaftarkan! Terbitkan token reset sekali pakai di Manajemen User untuk aktivasi aman.`, 'Registrasi Sukses');
    return { success: true, user: newUser };
  };

  const registerLeaderAccount = (data: { name: string; username: string; phone?: string; contractor: string; area: string; email?: string }) => {
    if (currentUser.role !== 'super_admin') {
      addAuditLog('Unauthorized Staff Registration Blocked', 'auth', 'leader', `Ditolak: Leader/Staf ${currentUser.name} (${currentUser.role}) mencoba mendaftarkan akun Leader.`);
      toast.error('Akses Ditolak: Leader tidak dapat membuat akun staf selain Installer.', 'Otoritas Dibatasi');
      return { success: false, error: 'Akses Ditolak: Pendaftaran Leader hanya dapat dilakukan oleh Super Admin.' };
    }

    const cleanName = data.name.trim().replace(/\s+/g, ' ');
    const cleanUsername = data.username.trim().toLowerCase().replace(/\s+/g, '');
    if (!cleanName || !cleanUsername) {
      return { success: false, error: 'Nama lengkap dan username wajib diisi.' };
    }

    // Check uniqueness of both name and username across all registered users
    const isNameTaken = users.some(u => !u.isDeleted && u.name.trim().replace(/\s+/g, ' ').toLowerCase() === cleanName.toLowerCase());
    const isUsernameTaken = users.some(u => !u.isDeleted && u.username.trim().toLowerCase() === cleanUsername);

    if (isNameTaken || isUsernameTaken) {
      const err = 'AKUN SUDAH TERDAFTAR – Nama atau username sudah digunakan.';
      toast.error(err, 'Registrasi Ditolak');
      return { success: false, error: err };
    }

    const contractorInput = data.contractor.trim();
    if (!contractorInput) return { success: false, error: 'Nama kontraktor wajib diisi.' };

    // Match existing contractor or auto-create new contractor vendor
    let matchedContractor = contractors.find(
      c => c.name.toLowerCase().trim() === contractorInput.toLowerCase() ||
           c.code.toLowerCase().trim() === contractorInput.toLowerCase()
    );

    if (!matchedContractor) {
      const code = generateContractorCode(contractorInput);
      matchedContractor = {
        id: 'c-' + Date.now(),
        name: contractorInput,
        code,
        coverageAreas: data.area ? [data.area] : ['Jabodetabek'],
        leaderName: cleanName,
        phone: data.phone?.trim(),
        email: data.email?.trim() || `ops@${code.toLowerCase()}.morajaws.net`,
        active: true,
        createdAt: new Date().toISOString()
      };
      setContractors(prev => [...prev, matchedContractor!]);
      supabaseDb.createContractor(matchedContractor).catch(e => console.warn('[Supabase] Error saving contractor:', e));
      addAuditLog(
        'Contractor Auto-Registered with Leader',
        'ui_config',
        matchedContractor.id,
        `Kontraktor ${matchedContractor.name} (${matchedContractor.code}) didaftarkan otomatis saat membuat akun Leader ${cleanName}`
      );
    } else {
      // Ensure area is added to contractor coverage if not already there
      if (data.area && !matchedContractor.coverageAreas.some(a => a.toLowerCase() === data.area.toLowerCase())) {
        const updatedAreas = [...matchedContractor.coverageAreas, data.area];
        const updatedContractorObj = { ...matchedContractor, coverageAreas: updatedAreas, leaderName: matchedContractor.leaderName || cleanName };
        setContractors(prev =>
          prev.map(c => c.id === matchedContractor!.id ? updatedContractorObj : c)
        );
        supabaseDb.updateContractor(matchedContractor.id, updatedContractorObj).catch(e => console.warn('[Supabase] Error updating contractor:', e));
      }
    }

    const newUser: User = {
      id: 'u-' + Date.now(),
      name: cleanName,
      username: cleanUsername,
      email: data.email?.trim() || `${cleanUsername}@${matchedContractor.code.toLowerCase()}.com`,
      phone: data.phone?.trim(),
      role: 'leader',
      contractor: matchedContractor.name,
      contractorId: matchedContractor.id,
      area: data.area,
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    };

    setUsers(prev => [...prev, newUser]);
    supabaseDb.createUser(newUser).catch(e => console.warn('[Supabase] Error saving leader user:', e));

    // Update contractor's leader if empty
    setContractors(prev =>
      prev.map(c => (c.id === matchedContractor!.id && !c.leaderName ? { ...c, leaderId: newUser.id, leaderName: newUser.name } : c))
    );

    addAuditLog('Leader Account Registered', 'auth', newUser.id, `Super Admin registered Leader account: ${newUser.name} for ${matchedContractor.name}`);

    toast.success(`Akun Leader ${newUser.name} berhasil didaftarkan untuk ${matchedContractor.name}! Terbitkan token reset sekali pakai untuk aktivasi aman.`, 'Registrasi Sukses');
    return { success: true, user: newUser };
  };

  const registerInstallerAccount = (data: { name: string; username: string; phone: string; email?: string }) => {
    // Both Leader (for their contractor/area) and Super Admin can register installers
    if (currentUser.role !== 'leader' && currentUser.role !== 'super_admin') {
      toast.error('Hanya Leader / Korlap atau Super Admin yang berwenang mendaftarkan Installer.', 'Akses Ditolak');
      return { success: false, error: 'Hanya Leader / Korlap atau Super Admin yang berwenang mendaftarkan Installer.' };
    }

    const cleanName = data.name.trim().replace(/\s+/g, ' ');
    const cleanUsername = data.username.trim().toLowerCase().replace(/\s+/g, '');
    if (!cleanName || !cleanUsername) {
      return { success: false, error: 'Nama lengkap dan username login wajib diisi.' };
    }

    // Check uniqueness of both name and username across all registered users
    const isNameTaken = users.some(u => !u.isDeleted && u.name.trim().replace(/\s+/g, ' ').toLowerCase() === cleanName.toLowerCase());
    const isUsernameTaken = users.some(u => !u.isDeleted && u.username.trim().toLowerCase() === cleanUsername);

    if (isNameTaken || isUsernameTaken) {
      const err = 'AKUN SUDAH TERDAFTAR – Nama atau username sudah digunakan.';
      toast.error(err, 'Registrasi Ditolak');
      return { success: false, error: err };
    }

    // Contractor and Area strictly locked to Leader's authorized scope
    const contractorName = currentUser.role === 'leader'
      ? (currentUser.contractor || 'PT Mitra Jaringan Solusi')
      : (contractors[0]?.name || 'PT Mitra Jaringan Solusi');
    const contractorObj = contractors.find(c => c.name === contractorName);
    const assignedArea = currentUser.role === 'leader'
      ? (currentUser.area || contractorObj?.coverageAreas[0] || 'Jakarta Selatan')
      : (contractorObj?.coverageAreas[0] || 'Jakarta Selatan');

    const newUser: User = {
      id: 'u-' + Date.now(),
      name: cleanName,
      username: cleanUsername,
      email: data.email?.trim() || `${cleanUsername}@installer.morajaws.net`,
      phone: data.phone.trim(),
      role: 'installer',
      contractor: contractorName,
      contractorId: contractorObj?.id,
      area: assignedArea,
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    };

    setUsers(prev => [...prev, newUser]);
    supabaseDb.createUser(newUser).catch(e => console.warn('[Supabase] Error saving installer user:', e));
    addAuditLog('Installer Account Registered', 'auth', newUser.id, `${currentUser.name} registered Installer: ${newUser.name} under ${contractorName} (${assignedArea})`);

    toast.success('BERHASIL – Akun Installer berhasil dibuat.', 'Registrasi Sukses');
    return { success: true, user: newUser };
  };

  const toggleUserStatus = (userId: string): { success: boolean; error?: string } => {
    if (currentUser.role !== 'super_admin') {
      toast.error('Akses Ditolak: Hanya Super Admin yang berwenang mengubah status aktif akun pengguna.', 'Akses Ditolak');
      return { success: false, error: 'Akses Ditolak: Hanya Super Admin yang berwenang mengubah status aktif akun pengguna.' };
    }
    const targetUser = users.find(u => u.id === userId);
    if (targetUser) {
      supabaseDb.updateUser(targetUser.id, { active: !targetUser.active }).catch(e => console.warn('[Supabase] Error toggling user status:', e));
    }
    setUsers(prev =>
      prev.map(u => {
        if (u.id !== userId) return u;
        const nextActive = !u.active;
        addAuditLog('User Status Changed', 'auth', u.id, `Status akun ${u.name} diubah menjadi ${nextActive ? 'Aktif' : 'Nonaktif'}`);
        toast.info(`Status akun ${u.name} diubah menjadi ${nextActive ? 'Aktif' : 'Nonaktif'}.`, 'Status Akun Diubah');
        return { ...u, active: nextActive };
      })
    );

    return { success: true };
  };

  const resetUserPassword = (userId: string): { success: boolean; newPassword?: string; error?: string } => {
    if (currentUser.role !== 'super_admin') {
      toast.error('Akses Ditolak: Hanya Super Admin yang berwenang mereset kata sandi akun pengguna.', 'Akses Ditolak');
      return { success: false, error: 'Akses Ditolak: Hanya Super Admin yang berwenang mereset kata sandi akun pengguna.' };
    }
    const targetUser = users.find(u => u.id === userId);
    if (targetUser) {
      supabaseDb.resetUserPassword(targetUser.id).catch(e => console.warn('[Supabase] Error resetting user password:', e));
    }
    setUsers(prev =>
      prev.map(u => {
        if (u.id !== userId) return u;
        addAuditLog('Password Reset', 'auth', u.id, `Sesi akun ${u.name} dicabut & akun diwajibkan reset kata sandi kuat (tanpa sandi default)`);
        toast.success(`Sesi akun ${u.name} dicabut. Terbitkan token reset sekali pakai agar pengguna dapat mengatur sandi baru yang kuat.`, 'Reset Sandi Aman');
        return { ...u, mustChangePassword: true };
      })
    );

    return { success: true };
  };

  // Master Contractors & Coverage Areas (Strict Super Admin DB-First)
  const addContractor = async (
    data: Omit<Contractor, 'id' | 'createdAt'>
  ): Promise<{ success: boolean; contractor?: Contractor; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Master Kontraktor');
    if (authErr) return { success: false, error: authErr };
    const newContractor: Contractor = {
      ...data,
      id: 'c-' + Date.now(),
      createdAt: new Date().toISOString()
    };
    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.createContractor(newContractor);
      if (!res.success) {
        throw new Error(res.error?.message || 'Gagal menyimpan kontraktor ke database.');
      }
      const saved = normalizeContractor(res.data || newContractor);
      setContractors(prev => deduplicateContractors([...prev, saved]));
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Contractor Added', 'global_config', saved.id, `Added contractor vendor: ${saved.name}`);
      toast.success(`Mitra kontraktor "${saved.name}" berhasil disimpan ke database.`, 'Kontraktor Ditambahkan');
      return { success: true, contractor: saved };
    } catch (err: any) {
      const msg = err?.message || 'Gagal menyimpan kontraktor ke database.';
      setSyncStatus('ERROR');
      toast.error(msg, 'Gagal Menyimpan ke Database');
      return { success: false, error: msg };
    }
  };

  const updateContractor = async (
    id: string,
    updates: Partial<Contractor>
  ): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Master Kontraktor');
    if (authErr) return { success: false, error: authErr };
    const existing = contractors.find(c => c.id === id);
    if (!existing) return { success: false, error: 'Kontraktor tidak ditemukan.' };
    const updatedPayload = { ...existing, ...updates };
    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.updateContractor(id, updatedPayload);
      if (!res.success) {
        throw new Error(res.error?.message || 'Gagal memperbarui kontraktor di database.');
      }
      const saved = normalizeContractor(res.data || updatedPayload);
      setContractors(prev => prev.map(c => (c.id === id ? saved : c)));
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Contractor Updated', 'global_config', id, `Updated contractor: ${saved.name}`);
      toast.success(`Data kontraktor "${saved.name}" diperbarui di database.`, 'Kontraktor Diperbarui');
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Gagal memperbarui kontraktor di database.';
      setSyncStatus('ERROR');
      toast.error(msg, 'Gagal Menyimpan ke Database');
      return { success: false, error: msg };
    }
  };

  const deleteContractor = async (contractorId: string): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Master Kontraktor');
    if (authErr) return { success: false, error: authErr };
    const target = contractors.find(c => c.id === contractorId);
    if (!target) return { success: false, error: 'Kontraktor tidak ditemukan.' };

    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.deleteContractor(contractorId);
      if (!res.success) {
        throw new Error(res.error?.message || 'Gagal menghapus kontraktor');
      }
      setContractors(prev => prev.filter(c => c.id !== contractorId));
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Contractor Deleted', 'global_config', contractorId, `Super Admin ${currentUser.name} menghapus kontraktor ${target.name}`);
      toast.warning(`Kontraktor ${target.name} berhasil dihapus dari Supabase PostgreSQL.`, 'Kontraktor Dihapus');
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Gagal menghapus kontraktor di database.';
      setSyncStatus('ERROR');
      toast.error('Gagal menghapus kontraktor di Supabase PostgreSQL: ' + msg, 'Gagal Menghapus');
      return { success: false, error: msg };
    }
  };

  const autoRegisterContractors = (
    contractorsToRegister: Contractor[],
    newCoverageAreasList: CoverageArea[] = []
  ): { addedCount: number; updatedCount: number } => {
    let addedCount = 0;
    let updatedCount = 0;

    setContractors(prev => {
      let updated = [...prev];
      contractorsToRegister.forEach(incoming => {
        if (!incoming || !incoming.name) return;
        const incomingId = (incoming.id || '').trim();
        const incomingName = incoming.name.trim().toLowerCase();
        const incomingCode = (incoming.code || '').trim().toLowerCase();

        const existingIdx = updated.findIndex(
          c => (incomingId && c.id === incomingId) ||
               c.name.trim().toLowerCase() === incomingName ||
               (incomingCode && c.code && c.code.trim().toLowerCase() === incomingCode)
        );
        if (existingIdx >= 0) {
          const ex = updated[existingIdx];
          const combinedAreas = Array.from(new Set([...(ex.coverageAreas || []), ...(incoming.coverageAreas || [])]));
          const merged = {
            ...ex,
            coverageAreas: combinedAreas,
            leaderName: ex.leaderName || incoming.leaderName,
            phone: ex.phone || incoming.phone
          };
          updated[existingIdx] = merged;
          if (currentUser.role === 'super_admin') {
            supabaseDb.updateContractor(merged.id, merged).catch(() => {});
          }
          updatedCount++;
        } else {
          updated.push(incoming);
          if (currentUser.role === 'super_admin') {
            supabaseDb.createContractor(incoming).catch(() => {});
          }
          addedCount++;
        }
      });
      return deduplicateContractors(updated);
    });

    if (newCoverageAreasList.length > 0) {
      setCoverageAreas(prev => {
        const merged = [...prev];
        newCoverageAreasList.forEach(na => {
          if (!merged.some(a => a.name.toLowerCase().trim() === na.name.toLowerCase().trim())) {
            merged.push(na);
            if (currentUser.role === 'super_admin') {
              supabaseDb.createCoverageArea(na).catch(() => {});
            }
          }
        });
        return merged;
      });
    }

    addAuditLog(
      'Contractors Registered/Enrolled',
      'ui_config',
      'contractors_batch',
      `${addedCount} kontraktor baru terdaftar, ${updatedCount} kontraktor diperbarui dari import/converter`
    );

    return { addedCount, updatedCount };
  };

  const addCoverageArea = async (
    data: Omit<CoverageArea, 'id'>
  ): Promise<{ success: boolean; area?: CoverageArea; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Master Coverage Area');
    if (authErr) return { success: false, error: authErr };
    const newArea: CoverageArea = {
      ...data,
      id: 'area-' + Date.now()
    };
    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.createCoverageArea(newArea);
      if (!res.success) {
        throw new Error(res.error?.message || 'Gagal menyimpan coverage area ke database.');
      }
      const saved = (res.data || newArea) as CoverageArea;
      setCoverageAreas(prev => [...prev, saved]);
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Coverage Area Added', 'global_config', saved.id, `Added coverage area: ${saved.name}`);
      toast.success(`Area coverage "${saved.name}" berhasil disimpan ke database.`, 'Area Ditambahkan');
      return { success: true, area: saved };
    } catch (err: any) {
      const msg = err?.message || 'Gagal menyimpan coverage area ke database.';
      setSyncStatus('ERROR');
      toast.error(msg, 'Gagal Menyimpan ke Database');
      return { success: false, error: msg };
    }
  };

  const updateCoverageArea = async (
    id: string,
    updates: Partial<CoverageArea>
  ): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Master Coverage Area');
    if (authErr) return { success: false, error: authErr };
    const existing = coverageAreas.find(a => a.id === id);
    if (!existing) return { success: false, error: 'Area coverage tidak ditemukan.' };
    const updatedPayload = { ...existing, ...updates };
    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.updateCoverageArea(id, updatedPayload);
      if (!res.success) {
        throw new Error(res.error?.message || 'Gagal memperbarui area coverage di database.');
      }
      const saved = (res.data || updatedPayload) as CoverageArea;
      setCoverageAreas(prev => prev.map(a => (a.id === id ? saved : a)));
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Coverage Area Updated', 'global_config', id, `Updated coverage area: ${saved.name}`);
      toast.success(`Area coverage "${saved.name}" diperbarui di database.`, 'Area Diperbarui');
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Gagal memperbarui area coverage di database.';
      setSyncStatus('ERROR');
      toast.error(msg, 'Gagal Menyimpan ke Database');
      return { success: false, error: msg };
    }
  };

  const deleteCoverageArea = async (areaId: string): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Master Coverage Area');
    if (authErr) return { success: false, error: authErr };
    const target = coverageAreas.find(a => a.id === areaId);
    if (!target) return { success: false, error: 'Area coverage tidak ditemukan.' };

    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.deleteCoverageArea(areaId);
      if (!res.success) {
        throw new Error(res.error?.message || 'Gagal menghapus area coverage');
      }
      setCoverageAreas(prev => prev.filter(a => a.id !== areaId));
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      addAuditLog('Coverage Area Deleted', 'global_config', areaId, `Super Admin ${currentUser.name} menghapus area ${target.name}`);
      toast.warning(`Area coverage ${target.name} berhasil dihapus dari Supabase PostgreSQL.`, 'Area Dihapus');
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Gagal menghapus area coverage di database.';
      setSyncStatus('ERROR');
      toast.error('Gagal menghapus area coverage di Supabase PostgreSQL: ' + msg, 'Gagal Menghapus');
      return { success: false, error: msg };
    }
  };

  // Root Cause Management (DB-First Global Config)
  const updateRootCauseCategories = async (
    categories: RootCauseCategory[],
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const result = await saveAppConfigDbFirst(
      'root_cause_categories',
      { categories, updatedAt: new Date().toISOString(), updatedBy: currentUser.name },
      {
        module: 'root_cause_categories',
        description: `Wi-Fi Root Cause taxonomy diperbarui (${categories.length} kategori)`,
        forceOverwrite: options.forceOverwrite,
        onSuccess: (saved) => {
          const list = Array.isArray(saved) ? saved : (saved as any)?.categories || categories;
          setRootCauseCategories(list);
        },
        retryFactory: () => updateRootCauseCategories(categories, { forceOverwrite: true })
      }
    );
    if (result.success) {
      toast.success('Katalog Root Cause berhasil disimpan ke database.', 'Root Cause Diperbarui');
    }
    return result;
  };

  // Technical Report Submission
  const saveTechnicalReport = (
    ticketId: string,
    reportData: Omit<TechnicalReport, 'id' | 'ticketId' | 'submittedAt' | 'submittedBy'>
  ) => {
    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };

    // App Flow 5: Installer MUST record persisted PROGRESS LiveChat check-in (WO ID + User ID) before saving report
    if (currentUser.role === 'installer') {
      const targetWoUpper = String(ticket.woNumber || '').trim().toUpperCase();
      const myUid = String(currentUser.id || '').trim();
      const hasPersistedProgress = Boolean(
        myUid &&
          ticketMessages.some(m => {
            if (!m || !m.id) return false;
            const msgId = String(m.id).trim();
            if (!msgId || msgId.startsWith('temp_') || msgId.startsWith('pending_') || msgId.startsWith('local_offline_')) {
              return false;
            }
            if ((m as any)._offlineSyncStatus === 'pending' || (m as any).status === 'failed' || (m as any).status === 'pending') {
              return false;
            }
            const woMatch =
              m.ticketId === ticket.id ||
              (targetWoUpper && String(m.woNumber || '').trim().toUpperCase() === targetWoUpper);
            if (!woMatch) return false;
            return String(m.senderId || '').trim() === myUid && isProgressCategory(m.category);
          })
      );
      if (!ticket.checkInAt || !hasPersistedProgress) {
        const msg = 'Anda wajib melakukan Check-in terlebih dahulu dengan mengirim pesan LiveChat ber-kategori PROGRESS sebelum menyimpan laporan.';
        toast.error(msg, 'Check-in PROGRESS Diperlukan');
        return { success: false, code: 'CHECK_IN_REQUIRED', error: msg };
      }
    }

    const now = new Date().toISOString();
    const report: TechnicalReport = {
      ...reportData,
      id: 'rep-' + Date.now(),
      ticketId,
      submittedBy: currentUser.name,
      submittedAt: now
    };

    // Requirement 3.B: Auto check-out on valid technical report save
    let checkOutAtVal: string | undefined = ticket.checkOutAt;
    let workDurationMinVal: number | undefined = ticket.workDurationMinutes;
    let workDurationStrVal: string | undefined = ticket.workDurationFormatted;
    let workSessionStatusVal = ticket.workSessionStatus || (ticket.checkInAt ? 'Sedang Dikerjakan' : 'Belum Check-in');
    let updatedSessions = Array.isArray(ticket.workSessions) ? [...ticket.workSessions] : [];

    if (ticket.checkInAt && (!ticket.checkOutAt || ticket.workSessionStatus === 'Sedang Dikerjakan')) {
      checkOutAtVal = now;
      workSessionStatusVal = 'Selesai';
      const mins = calculateDurationMinutes(ticket.checkInAt, now);
      workDurationMinVal = mins;
      workDurationStrVal = formatWorkDuration(mins);

      if (updatedSessions.length > 0) {
        const last = updatedSessions[updatedSessions.length - 1];
        if (last && (last.status === 'Sedang Dikerjakan' || !last.checkOutAt)) {
          last.checkOutAt = now;
          last.status = 'Selesai';
          last.durationMinutes = mins;
          last.durationFormatted = workDurationStrVal;
        }
      } else {
        updatedSessions.push({
          sessionId: 'ws_' + Date.now(),
          checkInAt: ticket.checkInAt,
          checkOutAt: now,
          durationMinutes: mins,
          durationFormatted: workDurationStrVal,
          status: 'Selesai'
        });
      }
    }

    setTickets(prev =>
      prev.map(t => {
        if (t.id !== ticketId) return t;
        const nextInstallerStatus = reportData.workResult === 'Tidak Berhasil'
          ? 'Failed / Cancelled'
          : reportData.workResult === 'Pekerjaan Tertunda'
          ? 'Pending Technical'
          : 'Completed';

        return {
          ...t,
          technicalReport: report,
          statusWOInstaller: nextInstallerStatus,
          statusWOAgent: nextInstallerStatus === 'Completed' ? 'Resolved' : t.statusWOAgent,
          checkOutAt: checkOutAtVal,
          workDurationMinutes: workDurationMinVal,
          workDurationFormatted: workDurationStrVal,
          workSessionStatus: workSessionStatusVal,
          workSessions: updatedSessions,
          _offlineSyncStatus: !isOnline ? 'pending' : 'synced',
          _offlineLastModified: now,
          updatedAt: now,
          updatedBy: currentUser.name
        };
      })
    );

    const activity: TicketActivity = {
      id: 'act-' + Date.now(),
      ticketId,
      woNumber: ticket.woNumber,
      action: 'Laporan Pekerjaan Teknisi Diserahkan',
      description: `Hasil: ${report.workResult}${report.rootCause ? ` | Catatan: ${report.rootCause}` : ''}${checkOutAtVal ? ` | Check-out: ${formatJakartaTimestamp(checkOutAtVal)} (Durasi: ${workDurationStrVal})` : ''}`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
      timestamp: now
    };
    setTicketActivities(prev => [activity, ...prev]);

    addAuditLog('Technical Report Submitted', 'ticket', ticketId, `Installer ${currentUser.name} submitted technical report for WO ${ticket.woNumber} (${report.workResult})`);

    if (!isOnline) {
      enqueueChange({
        entity: 'technical_report',
        entityId: ticketId,
        action: 'REPORT',
        summary: `Laporan Teknis WO ${ticket.woNumber} (${report.workResult})`,
        payload: { ticketId, report },
        user: { id: currentUser.id, name: currentUser.name, role: currentUser.role }
      }).catch(e => console.warn('Offline report enqueue error', e));
      toast.warning(`Laporan teknis WO ${ticket.woNumber} tersimpan offline di IndexedDB lokal.`, 'Laporan Offline');
    }

    // Persist report to Supabase PostgreSQL
    const updatedWithReport: Ticket = {
      ...ticket,
      technicalReport: report,
      statusWOInstaller: reportData.workResult === 'Tidak Berhasil' ? 'Failed / Cancelled' : reportData.workResult === 'Pekerjaan Tertunda' ? 'Pending Technical' : 'Completed',
      statusWOAgent: 'In Progress',
      approvalStatus: 'BUTUH APPROVAL',
      checkOutAt: checkOutAtVal,
      workDurationMinutes: workDurationMinVal,
      workDurationFormatted: workDurationStrVal,
      workSessionStatus: workSessionStatusVal,
      workSessions: updatedSessions,
      _offlineSyncStatus: !isOnline ? 'pending' : 'synced',
      _offlineLastModified: now,
      updatedAt: now,
      updatedBy: currentUser.name
    };

    setSyncStatus('SYNCING');
    supabaseDb.updateWorkOrder(ticketId, updatedWithReport)
      .then((res) => {
        if (!res.success) {
          setSyncStatus('ERROR');
          toast.error('Gagal menyimpan laporan teknis ke Supabase PostgreSQL: ' + (res.error?.message || 'Error'), 'Penyimpanan Gagal');
          return;
        }
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        toast.success(`Laporan teknis lapangan untuk WO ${ticket.woNumber} berhasil disimpan (BUTUH APPROVAL).`, 'Laporan Teknis Tersimpan');
      })
      .catch(err => {
        setSyncStatus('ERROR');
        if (!isOnline) {
          toast.warning(`Laporan teknis WO ${ticket.woNumber} tersimpan offline di IndexedDB lokal.`, 'Laporan Offline');
        } else {
          toast.error('Gagal menyimpan laporan teknis ke Supabase PostgreSQL: ' + (err?.message || err), 'Penyimpanan Gagal');
        }
      });

    // Also persist report to backend API
    fetch(`/api/tickets/${ticketId}/report`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ report })
    }).catch(e => console.error('Error saving technical report to server:', e));

    return { success: true };
  };

  const isInstallerMatch = (ticketInstaller: string | undefined, installerName: string): boolean => {
    if (!ticketInstaller || !installerName) return false;
    const tInst = String(ticketInstaller).toLowerCase().trim();
    const effInst = String(installerName).toLowerCase().trim();
    if (!tInst || !effInst) return false;
    if (tInst === effInst) return true;
    if (tInst.includes(effInst) || effInst.includes(tInst)) return true;
    const cleanEff = effInst.replace(/\(.*?\)/g, '').trim();
    if (cleanEff && (tInst.includes(cleanEff) || cleanEff.includes(tInst))) return true;
    return false;
  };

  const startWorkOnTicket = async (
    ticketId: string
  ): Promise<{ success: boolean; error?: string; ticket?: Ticket }> => {
    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };

    // 1. Ownership validation for field technician
    if (currentUser.role === 'installer') {
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const myName = (currentUser.name || '').toLowerCase().trim();
      const tInst = (ticket.installerName || '').toLowerCase().trim();

      const isMine =
        (myId && (ticket.assignedTo === myId || ticket.installerId === myId || ticket.assignedToUid === myId)) ||
        (myUsername && ticket.assignedTo?.toLowerCase() === myUsername) ||
        (myName && (tInst === myName || isInstallerMatch(ticket.installerName, myName)));

      if (!isMine) {
        return {
          success: false,
          error: 'Akses Ditolak: Anda hanya berwenang memulai pengerjaan untuk tiket yang ditugaskan kepada Anda.'
        };
      }
    }

    // 2. Check current status: if already in progress or completed, do not regress status, just open it
    const alreadyStarted =
      ticket.workStartedAt ||
      ticket.statusWOInstaller === 'On Site' ||
      ticket.statusWOInstaller === 'En Route' ||
      ticket.statusWOInstaller === 'Completed' ||
      ticket.statusWOInstaller === 'Installed' ||
      ticket.approvalStatus === 'BUTUH APPROVAL' ||
      ticket.approvalStatus === 'APPROVED';

    if (alreadyStarted) {
      return { success: true, ticket };
    }

    // 3. Mark ticket as In Progress / On Site
    const now = new Date().toISOString();
    const workStartUpdates: Partial<Ticket> = {
      statusWOInstaller: 'On Site',
      statusWOAgent: isTicketClosed(ticket) || ticket.statusWOAgent === 'Resolved' ? ticket.statusWOAgent : 'In Progress',
      workStartedAt: now,
      workStartedBy: currentUser.name,
      workStartedById: currentUser.id,
      _offlineSyncStatus: !isOnline ? 'pending' : 'synced',
      _offlineLastModified: now,
      updatedAt: now,
      updatedBy: currentUser.name
    };
    const updatedTicket: Ticket = {
      ...ticket,
      ...workStartUpdates
    };

    setTickets(prev => prev.map(t => (t.id === ticketId ? updatedTicket : t)));

    const activity: TicketActivity = {
      id: 'act-' + Date.now(),
      ticketId,
      woNumber: ticket.woNumber,
      action: 'Mulai Pengerjaan',
      description: `Teknisi ${currentUser.name} mulai mengerjakan Work Order di lokasi`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
      timestamp: now
    };
    setTicketActivities(prev => [activity, ...prev]);

    addAuditLog(
      'Work Started',
      'ticket',
      ticketId,
      `Teknisi ${currentUser.name} memulai pengerjaan untuk WO ${ticket.woNumber}`
    );

    if (!isOnline) {
      enqueueChange({
        entity: 'ticket',
        entityId: ticketId,
        action: 'STATUS_CHANGE',
        summary: `Mulai Kerjakan WO ${ticket.woNumber}`,
        payload: workStartUpdates,
        user: { id: currentUser.id, name: currentUser.name, role: currentUser.role }
      }).catch(e => console.warn('Offline startWork enqueue error', e));
      await saveTicketsOffline([updatedTicket]).catch(() => {});
      return { success: true, ticket: updatedTicket };
    }

    // Persist partial workStart update to Supabase PostgreSQL
    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.updateWorkOrder(updatedTicket.id, workStartUpdates);
      if (!res.success) {
        // Rollback optimistic state
        setTickets(prev => prev.map(t => (t.id === ticketId ? ticket : t)));
        setSyncStatus('ERROR');
        return {
          success: false,
          error: res.error?.message || 'Gagal menyimpan status Mulai Kerjakan ke server.'
        };
      }
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      const syncedTicket = res.data ? { ...updatedTicket, ...res.data } : updatedTicket;
      setTickets(prev => prev.map(t => (t.id === ticketId ? syncedTicket : t)));
      return { success: true, ticket: syncedTicket };
    } catch (err: any) {
      setTickets(prev => prev.map(t => (t.id === ticketId ? ticket : t)));
      setSyncStatus('ERROR');
      return {
        success: false,
        error: err?.message || 'Koneksi ke server gagal saat memulai pengerjaan.'
      };
    }
  };

  const saveProgressReport = async (
    ticketId: string,
    data: {
      reportStatus: string;
      reasonReport: string;
      rootCause?: string;
      remarksReport: string;
      reportStatusId?: string;
      reportStatusLabel?: string;
      reasonReportId?: string;
      reasonReportLabel?: string;
      rootcauseId?: string;
      rootcauseLabel?: string;
      technicalTelemetry?: {
        opticalPowerDbm?: string;
        fatRedamanDbm?: string;
        ontSerialNumber?: string;
        dropcoreLength?: string;
        fatPort?: string;
        usedMaterials?: string;
        photos?: string[];
        photoSlots?: import('../types/index.ts').TechnicalPhotoSlot[];
        customerSignatureUrl?: string;
        customerConsentConfirmed?: boolean;
      };
    }
  ): Promise<{ success: boolean; error?: string; code?: string; report?: ProgressReportEntry }> => {
    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };

    // 1. Strict Installer Assignment Verification & Check-in Requirement (App Flow 5)
    if (currentUser.role === 'installer') {
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const myName = (currentUser.name || '').toLowerCase().trim();
      const tInst = (ticket.installerName || '').toLowerCase().trim();

      const isMine =
        (myId && (ticket.assignedTo === myId || ticket.installerId === myId || ticket.assignedToUid === myId)) ||
        (myUsername && ticket.assignedTo?.toLowerCase() === myUsername) ||
        (myName && (tInst === myName || isInstallerMatch(ticket.installerName, myName)));

      if (!isMine) {
        return {
          success: false,
          error: 'Akses Ditolak: Anda hanya berwenang menyimpan laporan untuk tiket yang di-assign kepada Anda.'
        };
      }

      const targetWoUpper = String(ticket.woNumber || '').trim().toUpperCase();
      const hasPersistedProgress = Boolean(
        myId &&
          ticketMessages.some(m => {
            if (!m || !m.id) return false;
            const msgId = String(m.id).trim();
            if (!msgId || msgId.startsWith('temp_') || msgId.startsWith('pending_') || msgId.startsWith('local_offline_')) {
              return false;
            }
            if ((m as any)._offlineSyncStatus === 'pending' || (m as any).status === 'failed' || (m as any).status === 'pending') {
              return false;
            }
            const woMatch =
              m.ticketId === ticket.id ||
              (targetWoUpper && String(m.woNumber || '').trim().toUpperCase() === targetWoUpper);
            if (!woMatch) return false;
            return String(m.senderId || '').trim() === myId && isProgressCategory(m.category);
          })
      );

      if (!ticket.checkInAt || !hasPersistedProgress) {
        const msg = 'Anda wajib melakukan Check-in terlebih dahulu dengan mengirim pesan LiveChat ber-kategori PROGRESS sebelum menyimpan laporan.';
        toast.error(msg, 'Check-in PROGRESS Diperlukan');
        return {
          success: false,
          code: 'CHECK_IN_REQUIRED',
          error: msg
        };
      }
      // Check-out requires >= 3 uploaded & storage-verified physical photo evidence slots
      const candidateSlots = Array.isArray(data.technicalTelemetry?.photoSlots) && data.technicalTelemetry!.photoSlots!.length > 0
        ? data.technicalTelemetry!.photoSlots!
        : (Array.isArray(ticket.technicalReport?.photoSlots) ? ticket.technicalReport!.photoSlots! : []);
      const verifiedPhotoCount = candidateSlots.filter(slot => {
        if (!slot || typeof slot.url !== 'string') return false;
        const url = slot.url.trim();
        if (!url || url.startsWith('data:')) return false;
        const isPersistedUrl =
          url.startsWith('/uploads/') ||
          url.includes('/api/storage/public/') ||
          url.startsWith('https://') ||
          url.startsWith('http://');
        if (!isPersistedUrl) return false;
        return Boolean((slot.storagePath && slot.storagePath.trim()) || slot.uploadedAt);
      }).length;
      if (verifiedPhotoCount < 3) {
        const msg = `Check-out membutuhkan minimal 3 foto bukti fisik yang berhasil diunggah ke server (terunggah ${verifiedPhotoCount}/3).`;
        toast.error(msg, 'Bukti Foto Wajib Kurang');
        return {
          success: false,
          code: 'PHOTO_EVIDENCE_INCOMPLETE',
          error: msg
        };
      }
    }

    // 2. Validate mandatory fields (2-Tier Hierarchy: Level 1 Status WO -> Level 2 Reason WO)
    if (!data.reportStatus?.trim()) {
      return { success: false, error: 'Status WO (Level 1) wajib dipilih.' };
    }
    if (!data.reasonReport?.trim()) {
      return { success: false, error: 'Reason WO (Level 2) wajib dipilih.' };
    }

    // 3. Strict 2-Tier Hierarchical Droplist Validation against Supabase app_settings/hierarchical_droplists
    let matchedStatus: HierarchicalStatus | undefined;
    let matchedReason: HierarchicalReason | undefined;

    if (hierarchicalStatuses && hierarchicalStatuses.length > 0) {
      const normStatus = data.reportStatus.trim().toLowerCase();
      matchedStatus = hierarchicalStatuses.find(
        s => s.id === data.reportStatusId || s.name.trim().toLowerCase() === normStatus || (s.code && s.code.trim().toLowerCase() === normStatus)
      );

      if (!matchedStatus) {
        return {
          success: false,
          error: `Validasi Gagal: Status WO "${data.reportStatus}" tidak terdaftar dalam konfigurasi Setting Droplist.`
        };
      }

      const isStatusActive = matchedStatus.active !== false && (matchedStatus as any).isActive !== false;
      if (!isStatusActive) {
        return {
          success: false,
          error: `Validasi Gagal: Status WO "${matchedStatus.name}" telah dinonaktifkan oleh Admin untuk transaksi laporan baru.`
        };
      }

      // Level 2 Reason Validation (Must strictly be child of matchedStatus)
      const normReason = data.reasonReport.trim().toLowerCase();
      matchedReason = (matchedStatus.reasons || []).find(
        r => r.id === data.reasonReportId || r.name.trim().toLowerCase() === normReason
      );

      if (!matchedReason) {
        return {
          success: false,
          error: `Validasi Gagal: Reason WO "${data.reasonReport}" bukan merupakan pilihan turunan (child) yang sah dari Status "${matchedStatus.name}".`
        };
      }

      const isReasonActive = matchedReason.active !== false && (matchedReason as any).isActive !== false;
      if (!isReasonActive) {
        return {
          success: false,
          error: `Validasi Gagal: Reason WO "${matchedReason.name}" telah dinonaktifkan oleh Admin untuk transaksi laporan baru.`
        };
      }
    }

    const finalStatusName = matchedStatus ? matchedStatus.name : data.reportStatus.trim();
    const finalStatusId = matchedStatus ? matchedStatus.id : (data.reportStatusId || 'hs-' + finalStatusName.toLowerCase());
    const finalReasonName = matchedReason ? matchedReason.name : data.reasonReport.trim();
    const finalReasonId = matchedReason ? matchedReason.id : (data.reasonReportId || 'hr-' + finalReasonName.toLowerCase());
    const finalRemarks = (data.remarksReport || '').trim() || finalReasonName;

    const now = new Date().toISOString();
    const entry: ProgressReportEntry = {
      id: 'prog-' + Date.now(),
      ticketId,
      timestamp: now,
      submittedBy: currentUser.name,
      userRole: currentUser.role,
      reportStatus: finalStatusName,
      reportStatusId: finalStatusId,
      reportStatusLabel: finalStatusName,
      reasonReport: finalReasonName,
      reasonReportId: finalReasonId,
      reasonReportLabel: finalReasonName,
      remarksReport: finalRemarks,
      installerName: ticket.installerName,
      appointmentDate: ticket.appointmentDate || '',
      slotTime: ticket.slotTime,
      approvalStatus: 'BUTUH APPROVAL'
    };

    const tel = data.technicalTelemetry;
    const telPhotos = tel?.photos?.filter(Boolean) || tel?.photoSlots?.map(s => s.url).filter(Boolean) || ticket.technicalReport?.photos;
    const techReport: TechnicalReport = {
      ...(ticket.technicalReport || {}),
      id: ticket.technicalReport?.id || ('rep-' + Date.now()),
      ticketId,
      mainCategory: finalStatusName,
      workResult: finalReasonName,
      technicalDescription: finalRemarks,
      correctiveAction: finalReasonName,
      opticalPowerDbm: tel?.opticalPowerDbm || ticket.technicalReport?.opticalPowerDbm,
      opticalPowerRx: tel?.opticalPowerDbm || ticket.technicalReport?.opticalPowerRx,
      fatRedamanDbm: tel?.fatRedamanDbm || ticket.technicalReport?.fatRedamanDbm,
      deviceSerialNumber: tel?.ontSerialNumber || ticket.technicalReport?.deviceSerialNumber,
      dropcoreLength: tel?.dropcoreLength || ticket.technicalReport?.dropcoreLength,
      fatPort: tel?.fatPort || ticket.technicalReport?.fatPort,
      usedMaterials: tel?.usedMaterials || ticket.technicalReport?.usedMaterials,
      photos: telPhotos,
      photoSlots: tel?.photoSlots || ticket.technicalReport?.photoSlots,
      photoAfterUrl: telPhotos && telPhotos.length > 0 ? telPhotos[0] : ticket.technicalReport?.photoAfterUrl,
      customerSignatureUrl: tel?.customerSignatureUrl || ticket.customerSignatureUrl,
      customerConsentConfirmed: tel?.customerConsentConfirmed ?? ticket.technicalReport?.customerConsentConfirmed,
      submittedBy: currentUser.name,
      submittedAt: now,
      updatedAt: now
    };

    const nextInstallerStatus = (matchedStatus?.code || finalStatusName) as TicketStatusWOInstaller;

    // Requirement 3.B: Auto check-out on valid report save
    let checkOutAtVal: string | undefined = ticket.checkOutAt;
    let workDurationMinVal: number | undefined = ticket.workDurationMinutes;
    let workDurationStrVal: string | undefined = ticket.workDurationFormatted;
    let workSessionStatusVal = ticket.workSessionStatus || (ticket.checkInAt ? 'Sedang Dikerjakan' : 'Belum Check-in');
    let updatedSessions = Array.isArray(ticket.workSessions) ? [...ticket.workSessions] : [];

    if (ticket.checkInAt && (!ticket.checkOutAt || ticket.workSessionStatus === 'Sedang Dikerjakan')) {
      checkOutAtVal = now;
      workSessionStatusVal = 'Selesai';
      const mins = calculateDurationMinutes(ticket.checkInAt, now);
      workDurationMinVal = mins;
      workDurationStrVal = formatWorkDuration(mins);

      if (updatedSessions.length > 0) {
        const last = updatedSessions[updatedSessions.length - 1];
        if (last && (last.status === 'Sedang Dikerjakan' || !last.checkOutAt)) {
          last.checkOutAt = now;
          last.status = 'Selesai';
          last.durationMinutes = mins;
          last.durationFormatted = workDurationStrVal;
        }
      } else {
        updatedSessions.push({
          sessionId: 'ws_' + Date.now(),
          checkInAt: ticket.checkInAt,
          checkOutAt: now,
          durationMinutes: mins,
          durationFormatted: workDurationStrVal,
          status: 'Selesai'
        });
      }
    }

    const progressUpdateFields: Partial<Ticket> = {
      progressReports: [entry, ...(ticket.progressReports || [])],
      statusWOInstaller: nextInstallerStatus,
      // Status proses WO agent tetap In Progress (menunggu approval resmi dari Dispatch)
      statusWOAgent: 'In Progress',
      approvalStatus: 'BUTUH APPROVAL',
      reportStatusId: finalStatusId,
      reportStatusLabel: finalStatusName,
      reasonReportId: finalReasonId,
      reasonReportLabel: finalReasonName,
      remarksWOInstaller: finalRemarks,
      technicalReport: techReport,
      ...(tel?.opticalPowerDbm ? { rosetRedamanDbm: tel.opticalPowerDbm } : {}),
      ...(tel?.fatRedamanDbm ? { fatRedamanDbm: tel.fatRedamanDbm } : {}),
      ...(tel?.ontSerialNumber ? { ontSerialNumber: tel.ontSerialNumber } : {}),
      ...(tel?.dropcoreLength ? { dropcoreLength: tel.dropcoreLength } : {}),
      ...(tel?.fatPort ? { fatPort: tel.fatPort } : {}),
      ...(telPhotos ? { photoEvidenceCount: telPhotos.length } : {}),
      ...(tel?.customerSignatureUrl ? { customerSignatureUrl: tel.customerSignatureUrl } : {}),
      checkOutAt: checkOutAtVal,
      workDurationMinutes: workDurationMinVal,
      workDurationFormatted: workDurationStrVal,
      workSessionStatus: workSessionStatusVal,
      workSessions: updatedSessions,
      _offlineSyncStatus: !isOnline ? 'pending' : 'synced',
      _offlineLastModified: now,
      updatedAt: now,
      updatedBy: currentUser.name
    };

    const updatedWithProgress: Ticket = {
      ...ticket,
      ...progressUpdateFields
    };

    setTickets(prev =>
      prev.map(t => (t.id === ticketId ? updatedWithProgress : t))
    );

    const activity: TicketActivity = {
      id: 'act-' + Date.now(),
      ticketId,
      woNumber: ticket.woNumber,
      action: `Progress Report: ${finalStatusName}`,
      description: `Reason: ${finalReasonName} | Remarks: ${finalRemarks}`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
      timestamp: now
    };
    setTicketActivities(prev => [activity, ...prev]);

    addAuditLog(
      'Progress Report Saved',
      'ticket',
      ticketId,
      `Teknisi ${currentUser.name} melaporkan status ${finalStatusName} untuk WO ${ticket.woNumber} (Reason: ${finalReasonName})`
    );

    if (!isOnline) {
      enqueueChange({
        entity: 'technical_report',
        entityId: ticketId,
        action: 'REPORT',
        summary: `Progress Report WO ${ticket.woNumber} (${finalStatusName})`,
        payload: { ticketId, entry },
        user: { id: currentUser.id, name: currentUser.name, role: currentUser.role }
      }).catch(e => console.warn('Offline progress report enqueue error', e));
    }

    // Persist progress report authoritatively to backend endpoint (Confirmed Write + Version History + Auto Check-out)
    try {
      if (isOnline) {
        setSyncStatus('SYNCING');
        const resp = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/progress-report`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            entry,
            status: nextInstallerStatus,
            remarks: finalRemarks,
            reportStatusId: finalStatusId,
            reportStatusLabel: finalStatusName,
            reasonReportId: finalReasonId,
            reasonReportLabel: finalReasonName,
            technicalTelemetry: data.technicalTelemetry
          })
        });
        const json = await resp.json().catch(() => null);
        if (!resp.ok || !json || json.success !== true) {
          setTickets(prev => prev.map(t => (t.id === ticketId ? ticket : t)));
          const errCode = json?.code || `HTTP_${resp.status}`;
          const errMsg = json?.error || json?.message || 'Gagal menyimpan progress report ke server.';
          setSyncStatus('ERROR');
          toast.error('Gagal menyimpan progress report ke Supabase PostgreSQL: ' + errMsg, 'Penyimpanan Gagal');
          return { success: false, code: errCode, error: errMsg };
        }
        if (json.ticket && json.ticket.id) {
          setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, ...json.ticket } : t)));
        }
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        scheduleKpiRefreshRef.current?.();
        toast.success(
          `Laporan WO ${ticket.woNumber} (${finalStatusName}) berhasil disimpan dan sedang menunggu approval Dispatch.`,
          'Laporan Tersimpan (Butuh Approval)'
        );
        return { success: true, report: json.entry || entry };
      } else {
        await saveTicketsOffline([updatedWithProgress]);
        toast.warning(`Laporan WO ${ticket.woNumber} tersimpan offline di IndexedDB lokal (Butuh Approval).`, 'Laporan Offline');
        return { success: true, report: entry };
      }
    } catch (err: any) {
      setTickets(prev => prev.map(t => (t.id === ticketId ? ticket : t)));
      setSyncStatus('ERROR');
      console.error('Failed writing progress report to server:', err);
      toast.error('Gagal menyimpan progress report ke Supabase PostgreSQL: ' + (err?.message || err), 'Penyimpanan Gagal');
      return { success: false, error: err?.message || 'Gagal menyimpan ke Supabase PostgreSQL' };
    }
  };

  const uploadWoPhotoEvidence = async (
    ticketId: string,
    payload: {
      slotKey: import('../types/index.ts').TechnicalPhotoSlotKey;
      title: string;
      fileData: string;
      fileName: string;
      mimeType: string;
      capturedAt: string;
      latitude?: number;
      longitude?: number;
      gpsAccuracyMeters?: number;
      altitudeMeters?: number;
      headingDeg?: number;
      speedMps?: number;
      locationSource?: string;
      permissionStatus?: string;
      geotagStatus?: import('../types/index.ts').GeotagStatus;
      captureMethod?: 'camera' | 'gallery';
      badgeText?: string;
      statusTag?: string;
      clientCaptureId: string;
      woNumber?: string;
      requireLiveCamera?: boolean;
      fieldNotes?: string;
    }
  ) => {
    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };

    if (!isOnline) {
      return {
        success: false,
        offline: true,
        error: 'Perangkat sedang offline. Foto & koordinat tersimpan di draft lokal; tekan Retry Upload saat online.'
      };
    }

    try {
      const resp = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/photo-evidence`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...payload,
          woNumber: payload.woNumber || ticket.woNumber
        })
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json || json.success !== true) {
        return {
          success: false,
          error: json?.error || `Upload foto gagal (HTTP ${resp.status}).`
        };
      }

      if (json.ticket && json.ticket.id) {
        setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, ...json.ticket } : t)));
      }
      setLastSyncTime(new Date().toISOString());
      scheduleKpiRefreshRef.current?.();
      return {
        success: true,
        photoSlot: json.photoSlot,
        houseLocation: json.houseLocation,
        fatLocation: json.fatLocation,
        ticket: json.ticket
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Koneksi gagal saat mengunggah foto bukti.'
      };
    }
  };

  const deleteWoPhotoEvidence = async (
    ticketId: string,
    slotKey: import('../types/index.ts').TechnicalPhotoSlotKey
  ) => {
    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };
    if (!isOnline) {
      return {
        success: false,
        error: 'Koneksi offline. Penghapusan foto bukti membutuhkan koneksi server aktif.'
      };
    }

    try {
      const resp = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/photo-evidence/${encodeURIComponent(slotKey)}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders()
        }
      );
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json || json.success !== true) {
        return {
          success: false,
          error: json?.error || `Gagal menghapus foto bukti (HTTP ${resp.status}).`
        };
      }
      if (json.ticket && json.ticket.id) {
        setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, ...json.ticket } : t)));
      }
      setLastSyncTime(new Date().toISOString());
      scheduleKpiRefreshRef.current?.();
      return {
        success: true,
        ticket: json.ticket
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Koneksi gagal saat menghapus foto bukti.'
      };
    }
  };

  const submitKendalaReport = async (
    ticketId: string,
    payload: {
      reasonId?: string;
      reasonLabel?: string;
      description: string;
      fileData: string;
      fileName: string;
      mimeType: string;
      targetInstallerStatus?: 'Pending Technical' | 'Failed / Cancelled';
    }
  ) => {
    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };
    if (!isOnline) {
      return {
        success: false,
        error: 'Perangkat offline. Pengiriman laporan kendala & foto bukti membutuhkan koneksi internet.'
      };
    }

    try {
      setSyncStatus('SYNCING');
      const resp = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/kendala-report`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json || json.success !== true) {
        setSyncStatus('ERROR');
        const errMsg = json?.error || `Gagal mengirim laporan kendala (HTTP ${resp.status}).`;
        toast.error(errMsg, 'Laporan Kendala Gagal');
        return {
          success: false,
          error: errMsg
        };
      }

      if (json.ticket && json.ticket.id) {
        setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, ...json.ticket } : t)));
      }
      if (json.liveChatMessage && json.liveChatMessage.id) {
        setTicketMessages(prev => {
          if (prev.some(m => m.id === json.liveChatMessage.id)) return prev;
          return [...prev, json.liveChatMessage];
        });
      }
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      scheduleKpiRefreshRef.current?.();
      toast.success(
        `Laporan kendala & foto bukti WO ${ticket.woNumber} berhasil dikirim ke Leader & Dispatch.`,
        'Laporan Kendala Terkirim'
      );
      return {
        success: true,
        kendalaReport: json.kendalaReport,
        ticket: json.ticket
      };
    } catch (err: any) {
      setSyncStatus('ERROR');
      const errMsg = err?.message || 'Koneksi gagal saat mengirim laporan kendala.';
      toast.error(errMsg, 'Laporan Kendala Gagal');
      return {
        success: false,
        error: errMsg
      };
    }
  };

  const verifyTechnicalReport = (ticketId: string) => {
    if (currentUser.role !== 'dispatch' && currentUser.role !== 'super_admin') return;
    const target = tickets.find(t => t.id === ticketId);
    if (!target || !target.technicalReport) return;

    const verifiedTicket: Ticket = {
      ...target,
      technicalReport: {
        ...target.technicalReport,
        verifiedByDispatch: true,
        verifiedAt: new Date().toISOString(),
        verifiedBy: currentUser.name
      }
    };

    setTickets(prev =>
      prev.map(t => (t.id === ticketId ? verifiedTicket : t))
    );
    addAuditLog('Report Verified', 'ticket', ticketId, `Dispatch ${currentUser.name} verified technician work report`);

    supabaseDb.updateWorkOrder(verifiedTicket.id, verifiedTicket)
      .then((res) => {
        if (!res.success) throw new Error(res.error?.message || 'Verifikasi gagal');
        toast.success('Laporan teknis pekerjaan lapangan berhasil diverifikasi oleh Dispatch.', 'Laporan Terverifikasi');
      })
      .catch(err => {
        toast.error('Gagal memverifikasi laporan di Supabase PostgreSQL: ' + (err?.message || err), 'Verifikasi Gagal');
      });
  };

  const approveProgressReport = async (
    ticketId: string,
    notes?: string,
    options?: {
      woAgentStatus?: DispatchApprovalWoAgentStatus;
      remarksAgent?: string;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    if (currentUser.role !== 'dispatch' && currentUser.role !== 'super_admin') {
      return { success: false, error: 'Akses Ditolak: Hanya Dispatch dan Super Admin yang berwenang menyetujui laporan.' };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };

    // 1. Validasi: Dispatch Approval hanya dapat diproses jika WO benar-benar dalam status BUTUH APPROVAL
    if (ticket.approvalStatus === 'APPROVED') {
      return {
        success: false,
        error: `WO ${ticket.woNumber} sudah diverifikasi (${ticket.dispatchApprovalStatus || 'APPROVED'}) dengan hasil Ticket Closed.`
      };
    }
    if (ticket.approvalStatus !== 'BUTUH APPROVAL') {
      return {
        success: false,
        error: 'Validasi Gagal: Dispatch Approval hanya dapat diproses jika tiket berstatus BUTUH APPROVAL.'
      };
    }

    // 2. Validasi terhadap laporan Installer
    const hasReport = (ticket.progressReports && ticket.progressReports.length > 0) || !!ticket.technicalReport;
    if (!hasReport) {
      return {
        success: false,
        error: 'Validasi Gagal: Laporan pengerjaan teknisi tidak ditemukan pada tiket ini.'
      };
    }

    // 3. Validasi status akhir WO Agent (Done | Pending | Reschedule | Cancel)
    const explicitRaw = options?.woAgentStatus;
    let finalWoAgentStatus = normalizeDispatchWoAgentStatus(explicitRaw);
    if (explicitRaw !== undefined && String(explicitRaw).trim() !== '' && !finalWoAgentStatus) {
      return {
        success: false,
        error: 'Status WO Agent wajib dipilih dari: Done, Pending, Reschedule, atau Cancel.'
      };
    }
    if (!finalWoAgentStatus) {
      finalWoAgentStatus = getRecommendedDispatchWoAgentStatus(ticket);
    }

    const dispatchApprovalLabel = getDispatchApprovalOutcomeLabel(finalWoAgentStatus);
    const now = new Date().toISOString();
    const dispatchUid = currentUser.id || (currentUser as any).userId || '';

    // Perbarui status approval pada progress report terakhir tanpa merusak histori
    const updatedReports = (ticket.progressReports || []).map((p, idx) =>
      idx === 0
        ? {
            ...p,
            approvalStatus: 'APPROVED' as WOApprovalStatus,
            dispatchApprovalStatus: dispatchApprovalLabel,
            ticketResult: 'Closed',
            finalWoStatus: finalWoAgentStatus,
            approvedAt: now,
            approvedBy: currentUser.name,
            approvedById: dispatchUid,
            approvalNotes: notes || p.approvalNotes || ''
          }
        : p
    );

    // Update atomik: Dispatch Approval -> Status WO Agent final + Ticket Result Closed
    const updatedTicket: Ticket = {
      ...ticket,
      approvalStatus: 'APPROVED',
      dispatchApprovalStatus: dispatchApprovalLabel,
      ticketResult: 'Closed',
      approvalNotes: notes || '',
      approvedAt: now,
      approvedBy: currentUser.name,
      approvedById: dispatchUid,
      ...(options?.remarksAgent !== undefined ? { remarksAgent: options.remarksAgent } : {}),
      progressReports: updatedReports,
      technicalReport: ticket.technicalReport
        ? {
            ...ticket.technicalReport,
            verifiedByDispatch: true,
            verifiedAt: now,
            verifiedBy: currentUser.name
          }
        : undefined,
      statusWOAgent: finalWoAgentStatus,
      closedAt: now,
      closedBy: currentUser.name,
      closedById: dispatchUid,
      closeNotes:
        notes ||
        `${dispatchApprovalLabel} — Status WO Agent: ${finalWoAgentStatus}, Ticket Result: Closed (Diverifikasi Dispatch ${currentUser.name}).`,
      statusWOInstaller:
        finalWoAgentStatus === 'Done' &&
        (ticket.statusWOInstaller === 'Assigned' ||
          ticket.statusWOInstaller === 'En Route' ||
          ticket.statusWOInstaller === 'On Site')
          ? 'Completed'
          : ticket.statusWOInstaller,
      updatedAt: now,
      updatedBy: currentUser.name
    };

    setTickets(prev => prev.map(t => (t.id === ticketId ? updatedTicket : t)));

    const activity: TicketActivity = {
      id: 'act-' + Date.now(),
      ticketId,
      woNumber: ticket.woNumber,
      action: `${dispatchApprovalLabel} (Ticket Closed)`,
      description: `Dispatch ${currentUser.name} menyelesaikan verifikasi WO Agent -> ${finalWoAgentStatus} & Ticket Result -> Closed. Catatan: ${notes || '-'}`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
      timestamp: now
    };
    setTicketActivities(prev => [activity, ...prev]);

    addAuditLog(
      'Dispatch Approval & Ticket Closed',
      'ticket',
      ticketId,
      `Dispatch ${currentUser.name} menetapkan ${dispatchApprovalLabel} untuk WO ${ticket.woNumber} (WO Agent: ${finalWoAgentStatus}, Ticket Result: Closed)`
    );

    // Persist ke Backend Transactional Approve Endpoint
    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.approveWorkOrderReport(updatedTicket.id, notes, {
        woAgentStatus: finalWoAgentStatus,
        remarksAgent: options?.remarksAgent
      });
      if (!res.success) {
        throw new Error(res.error?.message || 'Gagal menyimpan status approval ke Supabase PostgreSQL.');
      }
      if (res.data && res.data.id) {
        setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, ...res.data } : t)));
      }
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      scheduleKpiRefreshRef.current?.();
      toast.success(
        `${dispatchApprovalLabel} tersimpan. Status WO Agent: ${finalWoAgentStatus}, Ticket Result: Closed.`,
        'Verifikasi Dispatch Selesai'
      );
    } catch (err: any) {
      console.error('[Supabase] Error saving approved report:', err);
      // Rollback local state jika gagal
      setTickets(prev => prev.map(t => (t.id === ticketId ? ticket : t)));
      setSyncStatus('ERROR');
      return { success: false, error: err?.message || 'Gagal menyimpan status approval ke Supabase PostgreSQL.' };
    }

    return { success: true };
  };

  const rejectProgressReport = async (
    ticketId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (currentUser.role !== 'dispatch' && currentUser.role !== 'super_admin') {
      return { success: false, error: 'Akses Ditolak: Hanya Dispatch dan Super Admin yang berwenang menolak laporan.' };
    }

    if (!reason || reason.trim().length < 3) {
      return { success: false, error: 'Alasan penolakan / revisi laporan wajib diisi minimal 3 karakter.' };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };

    const now = new Date().toISOString();
    const updatedReports = (ticket.progressReports || []).map((p, idx) =>
      idx === 0
        ? { ...p, approvalStatus: 'REJECTED' as WOApprovalStatus, rejectionReason: reason.trim(), revisionReason: reason.trim(), rejectedAt: now, rejectedBy: currentUser.name, rejectedById: currentUser.id }
        : p
    );

    const updatedTicket: Ticket = {
      ...ticket,
      approvalStatus: 'REJECTED',
      rejectionReason: reason.trim(),
      rejectedAt: now,
      rejectedBy: currentUser.name,
      rejectedById: currentUser.id,
      progressReports: updatedReports,
      statusWOAgent: 'In Progress', // Kembalikan ke proses agar teknisi merevisi
      updatedAt: now,
      updatedBy: currentUser.name
    };

    setTickets(prev => prev.map(t => (t.id === ticketId ? updatedTicket : t)));

    const activity: TicketActivity = {
      id: 'act-' + Date.now(),
      ticketId,
      woNumber: ticket.woNumber,
      action: 'Laporan Ditolak / Perlu Revisi',
      description: `Dispatch ${currentUser.name} meminta revisi laporan: "${reason.trim()}"`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
      timestamp: now
    };
    setTicketActivities(prev => [activity, ...prev]);

    addAuditLog(
      'Report Rejected',
      'ticket',
      ticketId,
      `Dispatch ${currentUser.name} menolak laporan WO ${ticket.woNumber}: "${reason.trim()}"`
    );

    try {
      setSyncStatus('SYNCING');
      const res = await supabaseDb.requestWorkOrderRevision(updatedTicket.id, reason.trim());
      if (!res.success) throw new Error(res.error?.message || 'Gagal menyimpan status penolakan');
      if (res.data && res.data.id) {
        setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, ...res.data } : t)));
      }
      setSyncStatus('SAVED');
      setLastSyncTime(new Date().toISOString());
      scheduleKpiRefreshRef.current?.();
      toast.warning(`Permintaan revisi laporan WO ${ticket.woNumber} telah dikirim ke teknisi.`, 'Revisi Dikirim');
    } catch (err: any) {
      console.warn('[Supabase] Error saving rejected report:', err);
      setTickets(prev => prev.map(t => (t.id === ticketId ? ticket : t)));
      setSyncStatus('ERROR');
      return { success: false, error: err?.message || 'Gagal menyimpan status penolakan ke Supabase PostgreSQL.' };
    }

    return { success: true };
  };

  // -------------------------------------------------------------
  // Report Dropdown Categories CRUD (DB-First Super Admin Exclusive)
  // -------------------------------------------------------------
  const saveReportDropdownCategoriesDbFirst = async (
    nextList: ReportDropdownCategory[],
    actionLabel: string,
    entityId: string,
    forceOverwrite = false
  ): Promise<{ success: boolean; error?: string }> => {
    return saveAppConfigDbFirst(
      'report_dropdown_categories',
      { categories: nextList, updatedAt: new Date().toISOString(), updatedBy: currentUser.name },
      {
        module: 'report_dropdown_categories',
        description: actionLabel,
        forceOverwrite,
        onSuccess: (saved) => {
          const list = Array.isArray(saved) ? saved : (saved as any)?.categories || nextList;
          setReportDropdownCategories(list);
          addAuditLog('Dropdown Categories Updated', 'global_config', entityId, actionLabel);
        },
        retryFactory: () => saveReportDropdownCategoriesDbFirst(nextList, actionLabel, entityId, true)
      }
    );
  };

  const addReportDropdownCategory = async (
    data: Omit<ReportDropdownCategory, 'id' | 'createdAt'>
  ): Promise<{ success: boolean; category?: ReportDropdownCategory; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Report Dropdown Categories');
    if (authErr) return { success: false, error: authErr };
    if (!data.name || !data.name.trim()) {
      return { success: false, error: 'Nama kategori wajib diisi.' };
    }

    const cleanName = data.name.trim();
    const duplicate = reportDropdownCategories.some(
      c => c.categoryType === data.categoryType && !c.isDeleted && c.name.toLowerCase().trim() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return { success: false, error: `Kategori "${cleanName}" sudah ada dalam daftar ${data.categoryType}.` };
    }

    const nextOrder = data.sortOrder !== undefined
      ? data.sortOrder
      : (reportDropdownCategories.filter(c => c.categoryType === data.categoryType).length + 1);

    const now = new Date().toISOString();
    const newCategory: ReportDropdownCategory = {
      id: `rdc-${data.categoryType.slice(0, 2)}-${Date.now()}`,
      categoryType: data.categoryType,
      name: cleanName,
      description: data.description?.trim() || '',
      isActive: data.isActive !== undefined ? data.isActive : true,
      sortOrder: nextOrder,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUser.name,
      updatedBy: currentUser.name,
      isDeleted: false
    };

    const nextList = [...reportDropdownCategories, newCategory];
    const saveRes = await saveReportDropdownCategoriesDbFirst(
      nextList,
      `Menambahkan kategori ${newCategory.categoryType}: "${newCategory.name}"`,
      newCategory.id
    );
    if (!saveRes.success) return { success: false, error: saveRes.error };
    toast.success(`Kategori "${newCategory.name}" berhasil disimpan ke Supabase PostgreSQL.`, 'Kategori Ditambahkan');
    return { success: true, category: newCategory };
  };

  const updateReportDropdownCategory = async (
    id: string,
    updates: Partial<ReportDropdownCategory>
  ): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Report Dropdown Categories');
    if (authErr) return { success: false, error: authErr };
    const existing = reportDropdownCategories.find(c => c.id === id);
    if (!existing) {
      return { success: false, error: 'Kategori tidak ditemukan.' };
    }

    if (updates.name && !updates.name.trim()) {
      return { success: false, error: 'Nama kategori tidak boleh kosong.' };
    }

    if (updates.name && updates.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = reportDropdownCategories.some(
        c => c.id !== id && c.categoryType === existing.categoryType && !c.isDeleted && c.name.toLowerCase().trim() === updates.name!.trim().toLowerCase()
      );
      if (duplicate) {
        return { success: false, error: `Kategori "${updates.name}" sudah ada dalam daftar.` };
      }
    }

    const now = new Date().toISOString();
    const updatedCategory: ReportDropdownCategory = {
      ...existing,
      ...updates,
      name: updates.name ? updates.name.trim() : existing.name,
      description: updates.description !== undefined ? updates.description.trim() : existing.description,
      updatedAt: now,
      updatedBy: currentUser.name
    };

    const nextList = reportDropdownCategories.map(c => c.id === id ? updatedCategory : c);
    const saveRes = await saveReportDropdownCategoriesDbFirst(
      nextList,
      `Memperbarui kategori ${existing.categoryType}: "${updatedCategory.name}"`,
      id
    );
    if (!saveRes.success) return { success: false, error: saveRes.error };
    toast.success(`Kategori "${updatedCategory.name}" berhasil diperbarui di Supabase PostgreSQL.`, 'Kategori Diperbarui');
    return { success: true };
  };

  const deleteReportDropdownCategory = async (
    id: string,
    permanent: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    const authErr = assertSuperAdminConfigWrite('Report Dropdown Categories');
    if (authErr) return { success: false, error: authErr };
    const existing = reportDropdownCategories.find(c => c.id === id);
    if (!existing) {
      return { success: false, error: 'Kategori tidak ditemukan.' };
    }

    if (permanent) {
      const nextList = reportDropdownCategories.filter(c => c.id !== id);
      const saveRes = await saveReportDropdownCategoriesDbFirst(
        nextList,
        `Menghapus permanen kategori ${existing.categoryType}: "${existing.name}"`,
        id
      );
      if (!saveRes.success) return { success: false, error: saveRes.error };
      toast.warning(`Kategori "${existing.name}" dihapus permanen dari Supabase PostgreSQL.`, 'Kategori Dihapus');
      return { success: true };
    } else {
      const now = new Date().toISOString();
      const softDeleted: ReportDropdownCategory = {
        ...existing,
        isActive: false,
        isDeleted: true,
        updatedAt: now,
        updatedBy: currentUser.name
      };
      const nextList = reportDropdownCategories.map(c => c.id === id ? softDeleted : c);
      const saveRes = await saveReportDropdownCategoriesDbFirst(
        nextList,
        `Menonaktifkan & menandai terhapus kategori ${existing.categoryType}: "${existing.name}"`,
        id
      );
      if (!saveRes.success) return { success: false, error: saveRes.error };
      toast.info(`Kategori "${existing.name}" dinonaktifkan (laporan lama tetap aman).`, 'Kategori Dinonaktifkan');
      return { success: true };
    }
  };

  const toggleReportDropdownCategoryActive = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const existing = reportDropdownCategories.find(c => c.id === id);
    if (!existing) return { success: false, error: 'Kategori tidak ditemukan.' };
    return updateReportDropdownCategory(id, { isActive: !existing.isActive });
  };

  const reopenTicket = (ticketId: string, reason: string) => {
    if (currentUser.role !== 'dispatch' && currentUser.role !== 'super_admin') {
      toast.error('Hanya Dispatch atau Super Admin yang dapat membuka kembali tiket.', 'Akses Ditolak');
      return { success: false, error: 'Hanya Dispatch atau Super Admin yang dapat membuka kembali tiket.' };
    }
    const ticket = getTicketById(ticketId);
    if (!ticket) {
      toast.error('Tiket tidak ditemukan.', 'Error');
      return { success: false, error: 'Tiket tidak ditemukan.' };
    }

    const now = new Date().toISOString();
    const reopenedTicket: Ticket = {
      ...ticket,
      statusWOAgent: 'In Progress',
      ticketResult: 'Open',
      dispatchApprovalStatus: undefined,
      approvalStatus: (ticket.progressReports && ticket.progressReports.length > 0) ? 'BUTUH APPROVAL' : 'NONE',
      reopenReason: reason,
      closedAt: undefined,
      closedBy: undefined,
      closedById: undefined,
      closeNotes: undefined,
      updatedAt: now,
      updatedBy: currentUser.name
    };

    setTickets(prev =>
      prev.map(t => (t.id === ticketId ? reopenedTicket : t))
    );

    addAuditLog('Ticket Reopened', 'ticket', ticketId, `Reopened WO ${ticket.woNumber}. Alasan: ${reason}`);

    setSyncStatus('SYNCING');
    supabaseDb.updateWorkOrder(reopenedTicket.id, reopenedTicket)
      .then((res) => {
        if (!res.success) throw new Error(res.error?.message || 'Gagal membuka tiket');
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        scheduleKpiRefreshRef.current?.();
        toast.info(`Tiket WO ${ticket.woNumber} berhasil dibuka kembali (Reopened).`, 'Tiket Dibuka Kembali');
      })
      .catch(err => {
        setSyncStatus('ERROR');
        toast.error('Gagal membuka tiket di Supabase PostgreSQL: ' + (err?.message || err), 'Gagal');
      });

    return { success: true };
  };

  // Live Chat (App Flow 4 & 5: Confirmed backend persistence, strict category PROGRESS check-in, persisted readBy)
  const sendTicketMessage = async (
    ticketId: string,
    text: string,
    attachments: ChatAttachment[] = [],
    category?: string,
    options?: { clientMessageId?: string }
  ): Promise<{ success: boolean; error?: string; message?: TicketMessage; hasProgressTrigger?: boolean }> => {
    const ticket = getTicketById(ticketId);
    if (!ticket) return { success: false, error: 'Tiket tidak ditemukan.' };

    // Strict Rule: Leader tidak bisa kirim chat (hanya super admin, dispatch, installer)
    if (currentUser.role === 'leader') {
      toast.error('Akses Dibatasi: Peran Leader hanya dapat membaca chat dan tidak diizinkan mengirim pesan.', 'Akses Ditolak');
      return { success: false, error: 'Peran Leader tidak diizinkan mengirim pesan chat.' };
    }

    if (!text.trim() && attachments.length === 0) {
      return { success: false, error: 'Pesan atau lampiran foto tidak boleh kosong.' };
    }

    // Role-based category validation:
    // - Installer: wajib memilih kategori aktif dari master DB sebelum mengirim pesan
    // - Dispatch & Superadmin: kategori opsional / bebas (tidak wajib & tidak memblokir kirim)
    let effectiveCategory = '';
    if (currentUser.role === 'installer') {
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const myName = (currentUser.name || '').toLowerCase().trim();
      const tInst = (ticket.installerName || '').toLowerCase().trim();

      const isMine =
        (myId && (ticket.assignedTo === myId || ticket.installerId === myId || ticket.assignedToUid === myId)) ||
        (myUsername && ticket.assignedTo?.toLowerCase() === myUsername) ||
        (myName && (tInst === myName || isInstallerMatch(ticket.installerName, myName))) ||
        (myUsername && (tInst === myUsername || isInstallerMatch(ticket.installerName, myUsername)));

      if (!isMine) {
        toast.error('Akses Ditolak: Anda hanya berwenang mengirim pesan pada tiket yang ditugaskan kepada Anda.');
        return { success: false, error: 'Akses Ditolak: Anda hanya berwenang mengirim pesan pada tiket yang ditugaskan kepada Anda.' };
      }

      const chosenCategory = String(category || '').trim();
      if (!chosenCategory || chosenCategory.toUpperCase() === 'UNCLASSIFIED') {
        toast.error('Pilih kategori chat terlebih dahulu sebelum memulai percakapan.', 'Kategori Wajib Dipilih');
        return { success: false, error: 'Pilih kategori chat terlebih dahulu sebelum memulai percakapan.' };
      }

      const activeMasterNames = chatCategories
        .filter(c => c.active !== false && c.name.trim().toUpperCase() !== 'UNCLASSIFIED')
        .map(c => c.name.trim().toUpperCase());
      if (activeMasterNames.length > 0 && !activeMasterNames.includes(chosenCategory.toUpperCase())) {
        toast.error(`Kategori "${chosenCategory}" tidak valid atau sedang dinonaktifkan.`, 'Kategori Tidak Valid');
        return { success: false, error: `Kategori "${chosenCategory}" tidak valid atau sedang dinonaktifkan.` };
      }
      effectiveCategory = chosenCategory.toUpperCase();
    } else if (category && category.trim()) {
      effectiveCategory = category.trim().toUpperCase();
    }

    const isStrictProgressCategory = Boolean(effectiveCategory && isProgressCategory(effectiveCategory));
    const hadCheckInBefore = Boolean(ticket.checkInAt);

    // Prepare idempotent optimistic message
    const clientMsgId =
      options?.clientMessageId ||
      `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimisticId = `optimistic_${clientMsgId}`;
    const optimisticNow = new Date().toISOString();

    failedMessagePayloadsRef.current.set(optimisticId, {
      ticketId,
      text: text.trim(),
      attachments,
      category: effectiveCategory || undefined,
      clientMessageId: clientMsgId
    });

    const optimisticMsg: TicketMessage = {
      id: optimisticId,
      clientMessageId: clientMsgId,
      ticketId,
      woNumber: ticket.woNumber || '',
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderRole: currentUser.role,
      text: text.trim(),
      ...(effectiveCategory ? { category: effectiveCategory } : {}),
      attachments,
      timestamp: optimisticNow,
      deliveredTo: [currentUser.id],
      readBy: [currentUser.id],
      deliveryStatus: 'sending'
    };

    setTicketMessages(prev => {
      const idx = prev.findIndex(m => m.id === optimisticId || m.clientMessageId === clientMsgId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...optimisticMsg, deliveryStatus: 'sending', localError: undefined };
        return copy;
      }
      return [...prev, optimisticMsg];
    });

    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/messages`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          text: text.trim(),
          attachments,
          clientMessageId: clientMsgId,
          ...(effectiveCategory ? { category: effectiveCategory } : {})
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.message) {
        const errMsg = json?.error || `Gagal mengirim pesan LiveChat (${res.status})`;
        setTicketMessages(prev =>
          prev.map(m =>
            m.id === optimisticId || m.clientMessageId === clientMsgId
              ? { ...m, deliveryStatus: 'failed', localError: errMsg }
              : m
          )
        );
        toast.error(errMsg, 'Pesan Gagal Terkirim');
        return { success: false, error: errMsg };
      }

      failedMessagePayloadsRef.current.delete(optimisticId);

      const savedMessage: TicketMessage = {
        ...json.message,
        clientMessageId: json.message.clientMessageId || clientMsgId,
        deliveredTo: Array.isArray(json.message.deliveredTo) ? json.message.deliveredTo : [currentUser.id],
        readBy: Array.isArray(json.message.readBy) ? json.message.readBy : [currentUser.id],
        deliveryStatus: 'sent'
      };

      if (savedMessage.id) {
        knownChatMessageIdsRef.current.add(savedMessage.id);
        notifiedChatSoundIdsRef.current.add(savedMessage.id);
      }

      setTicketMessages(prev => {
        const withoutOptimistic = prev.filter(
          m =>
            m.id !== optimisticId &&
            m.id !== savedMessage.id &&
            (!savedMessage.clientMessageId || m.clientMessageId !== savedMessage.clientMessageId)
        );
        return [...withoutOptimistic, savedMessage].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      });

      if (json.ticket) {
        setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, ...json.ticket } : t)));
      } else if (!json.deduplicated) {
        const now = savedMessage.timestamp || new Date().toISOString();
        setTickets(prev =>
          prev.map(t =>
            t.id === ticketId
              ? {
                  ...t,
                  ...(effectiveCategory ? { chatCategory: effectiveCategory } : {}),
                  chatMessagesCount: (t.chatMessagesCount || 0) + 1,
                  lastMessageAt: now,
                  lastMessageSnippet: text.trim() || (attachments.length > 0 ? `[Foto: ${attachments[0].fileName}]` : ''),
                  updatedAt: now
                }
              : t
          )
        );
      }

      // Only notify Check-in AFTER confirmed save of strict PROGRESS category message
      if (!json.deduplicated && currentUser.role === 'installer' && isStrictProgressCategory && (json.checkInTriggered || json.checkedIn || !hadCheckInBefore)) {
        const checkInTs = json.ticket?.checkInAt || savedMessage.timestamp || new Date().toISOString();
        addAuditLog(
          'Installer Check-in Recorded',
          'ticket',
          ticketId,
          `Teknisi ${currentUser.name} check-in otomatis pada WO ${ticket.woNumber} via pesan LiveChat kategori PROGRESS (${formatJakartaTimestamp(checkInTs)})`
        );
        toast.info(
          `Check-in berhasil tercatat pada ${formatJakartaTimestamp(checkInTs)}. Durasi kerja mulai dihitung.`,
          'Check-in Otomatis (PROGRESS)'
        );
      }

      if (isStrictProgressCategory) {
        scheduleKpiRefreshRef.current?.();
      }

      if (attachments.length > 0 && !json.deduplicated) {
        addAuditLog('Chat Attachment Uploaded', 'ticket', ticketId, `${currentUser.name} uploaded ${attachments.length} photo(s) in ticket chat`);
      }

      return { success: true, message: savedMessage, hasProgressTrigger: Boolean(json.hasProgressTrigger) };
    } catch (err: any) {
      const errMsg = err?.message || 'Koneksi gagal saat mengirim pesan LiveChat.';
      setTicketMessages(prev =>
        prev.map(m =>
          m.id === optimisticId || m.clientMessageId === clientMsgId
            ? { ...m, deliveryStatus: 'failed', localError: errMsg }
            : m
        )
      );
      toast.error(errMsg, 'Gagal Mengirim Pesan');
      return { success: false, error: errMsg };
    }
  };

  const retryTicketMessage = async (
    localMessageId: string
  ): Promise<{ success: boolean; error?: string; message?: TicketMessage; hasProgressTrigger?: boolean }> => {
    const saved = failedMessagePayloadsRef.current.get(localMessageId);
    if (!saved) {
      const msg = ticketMessages.find(m => m.id === localMessageId);
      if (!msg) return { success: false, error: 'Pesan untuk dikirim ulang tidak ditemukan.' };
      return sendTicketMessage(msg.ticketId, msg.text, msg.attachments || [], msg.category, {
        clientMessageId: msg.clientMessageId || localMessageId.replace(/^optimistic_/, '')
      });
    }
    return sendTicketMessage(saved.ticketId, saved.text, saved.attachments, saved.category, {
      clientMessageId: saved.clientMessageId
    });
  };

  const sendTypingIndicator = React.useCallback(async (ticketId: string, isTyping: boolean) => {
    if (!ticketId || currentUserRef.current?.role === 'leader') return;
    const headers = getAuthHeaders();
    if (!headers['Authorization']) return;
    const ticket = ticketsRef.current.find(t => t.id === ticketId || t.woNumber === ticketId);
    try {
      await fetch('/api/livechat/typing', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ticketId: ticket?.id || ticketId,
          woNumber: ticket?.woNumber,
          isTyping
        })
      });
    } catch {}
  }, []);

  const loadOlderTicketMessages = React.useCallback(
    async (
      ticketId: string,
      beforeCursor?: string,
      limit: number = 50
    ): Promise<{ messages: TicketMessage[]; hasMore: boolean; nextCursor: string | null }> => {
      const cleanId = String(ticketId || '').trim();
      if (!cleanId) return { messages: [], hasMore: false, nextCursor: null };
      const res = await supabaseDb.getTicketMessagesPaginated(cleanId, { limit, before: beforeCursor });
      if (!res.success) {
        return { messages: [], hasMore: false, nextCursor: null };
      }
      const olderMsgs = res.messages || [];
      if (olderMsgs.length > 0) {
        olderMsgs.forEach(m => {
          if (m?.id) knownChatMessageIdsRef.current.add(m.id);
        });
        setTicketMessages(prev => {
          const map = new Map<string, TicketMessage>();
          prev.forEach(m => {
            if (m?.id) map.set(m.id, m);
          });
          olderMsgs.forEach(m => {
            if (m?.id) map.set(m.id, { ...m, deliveryStatus: 'sent' });
          });
          return Array.from(map.values()).sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        });
      }
      return {
        messages: olderMsgs,
        hasMore: res.hasMore,
        nextCursor: res.nextCursor
      };
    },
    []
  );

  const uploadChatAttachment = React.useCallback(
    async (ticketId: string, file: File): Promise<{ success: boolean; attachment?: ChatAttachment; error?: string }> => {
      const headers = getAuthHeaders();
      if (!headers['Authorization']) {
        return { success: false, error: 'Sesi login tidak valid.' };
      }
      if (!file) {
        return { success: false, error: 'File tidak ditemukan.' };
      }
      if (!file.type.startsWith('image/')) {
        return { success: false, error: 'Hanya file gambar (JPG/PNG/WEBP) yang didukung.' };
      }
      if (file.size > 5 * 1024 * 1024) {
        return { success: false, error: 'Ukuran gambar maksimal 5 MB.' };
      }

      const ticket = ticketsRef.current.find(t => t.id === ticketId || t.woNumber === ticketId);
      const relatedWoNumber = ticket?.woNumber || ticketId;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/storage/adapter/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: file.name,
          fileData: dataUrl,
          mimeType: file.type || 'image/jpeg',
          fileCategory: 'chat_attachment',
          relatedWoNumber
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.metadata) {
        return { success: false, error: json?.error || `Upload gambar gagal (${res.status})` };
      }

      const storagePath = json.metadata.filePath;
      const downloadUrl =
        json.downloadUrl ||
        `/api/storage/adapter/download?storagePath=${encodeURIComponent(storagePath)}&category=live-chat&woNumber=${encodeURIComponent(relatedWoNumber)}`;

      const attachment: ChatAttachment = {
        id: json.metadata.fileId || `att_${Date.now()}`,
        type: 'image',
        url: downloadUrl,
        downloadUrl,
        storagePath,
        fileName: json.metadata.originalFileName || file.name,
        fileSize: json.metadata.fileSize || file.size,
        mimeType: json.metadata.mimeType || file.type,
        uploadStatus: 'uploaded'
      };
      return { success: true, attachment };
    },
    []
  );

  const getMessagesForTicket = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId || t.woNumber === ticketId);
    const woUpper = ticket?.woNumber ? String(ticket.woNumber).trim().toUpperCase() : '';
    const seen = new Set<string>();
    return ticketMessages
      .filter(m => {
        if (!m) return false;
        const match = m.ticketId === ticketId || (woUpper && String(m.woNumber || '').trim().toUpperCase() === woUpper);
        if (!match) return false;
        if (m.id) {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
        }
        return true;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  };

  const refreshMessagesForTicket = React.useCallback(
    async (ticketId: string): Promise<{ messages: TicketMessage[]; hasProgressTrigger: boolean }> => {
      const cleanId = String(ticketId || '').trim();
      if (!cleanId) return { messages: [], hasProgressTrigger: false };
      const headers = getAuthHeaders();
      if (!headers['Authorization']) return { messages: [], hasProgressTrigger: false };

      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(cleanId)}/messages`, {
          headers,
          cache: 'no-store'
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || !Array.isArray(data.messages)) {
          return { messages: [], hasProgressTrigger: false };
        }

        const fetchedMsgs: TicketMessage[] = data.messages;
        const staleCutoff = Date.now() - 5 * 60 * 1000;
        fetchedMsgs.forEach(m => {
          if (!m?.id) return;
          const ts = Date.parse(m.timestamp);
          if (!Number.isFinite(ts) || ts < staleCutoff) {
            knownChatMessageIdsRef.current.add(m.id);
          }
        });
        const matchedTicket = ticketsRef.current.find(t => t.id === cleanId || t.woNumber === cleanId);
        const canonicalId = matchedTicket?.id || cleanId;
        const woUpper = String(matchedTicket?.woNumber || '').trim().toUpperCase();

        setTicketMessages(prev => {
          const retained = prev.filter(m => {
            if (!m) return false;
            const belongsToTarget =
              m.ticketId === cleanId ||
              m.ticketId === canonicalId ||
              (woUpper && String(m.woNumber || '').trim().toUpperCase() === woUpper);
            return !belongsToTarget;
          });
          const mergedMap = new Map<string, TicketMessage>();
          [...retained, ...fetchedMsgs].forEach(m => {
            if (m?.id) mergedMap.set(m.id, m);
          });
          return Array.from(mergedMap.values()).sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        });

        triggerDeliveryReceiptsForMessages(fetchedMsgs);
        return {
          messages: fetchedMsgs,
          hasProgressTrigger: Boolean(data.hasProgressTrigger)
        };
      } catch {
        return { messages: [], hasProgressTrigger: false };
      }
    },
    [triggerDeliveryReceiptsForMessages]
  );

  const markTicketMessagesAsRead = (ticketId: string) => {
    const currentUserId = currentUser?.id || '';
    if (!currentUserId || !ticketId) return;

    const nowIso = new Date().toISOString();
    setTicketMessages(prev => {
      let changed = false;
      const next = prev.map(m => {
        if (m.ticketId !== ticketId) return m;
        if (m.senderId === currentUserId) return m;
        const currentReaders = Array.isArray(m.readBy) ? m.readBy : [];
        if (currentReaders.includes(currentUserId)) return m;
        changed = true;
        const currentDelivered = Array.isArray(m.deliveredTo) ? m.deliveredTo : [];
        return {
          ...m,
          deliveredTo: currentDelivered.includes(currentUserId) ? currentDelivered : [...currentDelivered, currentUserId],
          deliveredAt: { ...(m.deliveredAt || {}), [currentUserId]: m.deliveredAt?.[currentUserId] || nowIso },
          readBy: [...currentReaders, currentUserId],
          readAt: { ...(m.readAt || {}), [currentUserId]: nowIso }
        };
      });
      return changed ? next : prev;
    });

    // Persist read receipt to backend (idempotent even if local unread count was hydrated differently)
    supabaseDb.markTicketMessagesRead(ticketId).catch(() => {});
  };

  const activeScopedTicketLookup = React.useMemo(() => {
    const byId = new Set<string>();
    const woToId = new Map<string, string>();
    for (const t of scopedTickets) {
      if (!t || t.isDeleted || t.isArchived) continue;
      if (t.id) byId.add(t.id);
      if (t.woNumber && t.id) woToId.set(String(t.woNumber).trim().toUpperCase(), t.id);
    }
    return { byId, woToId };
  }, [scopedTickets]);
  activeScopedLookupRef.current = activeScopedTicketLookup;

  const unreadCountsByTicket = React.useMemo(() => {
    const currentUserId = String(currentUser?.id || '').trim();
    const map: Record<string, number> = {};
    if (!currentUserId || !isLoggedIn) return map;
    const seenMsgIds = new Set<string>();
    for (const m of ticketMessages) {
      if (!m) continue;
      if (m.id) {
        if (seenMsgIds.has(m.id)) continue;
        seenMsgIds.add(m.id);
      }
      if (String(m.senderId || '').trim() === currentUserId) continue;
      const readers = Array.isArray(m.readBy) ? m.readBy : [];
      if (readers.includes(currentUserId)) continue;
      let resolvedId: string | undefined;
      if (m.ticketId && activeScopedTicketLookup.byId.has(m.ticketId)) {
        resolvedId = m.ticketId;
      } else if (m.woNumber) {
        resolvedId = activeScopedTicketLookup.woToId.get(String(m.woNumber).trim().toUpperCase());
      }
      if (!resolvedId) continue;
      map[resolvedId] = (map[resolvedId] || 0) + 1;
    }
    return map;
  }, [ticketMessages, activeScopedTicketLookup, currentUser?.id, isLoggedIn]);

  const getTicketUnreadCount = (ticketId: string): number => {
    return unreadCountsByTicket[ticketId] || 0;
  };

  // Fallback Live Chat incoming sound & toast for polling / reconnect / newly-assigned WO fetch
  React.useEffect(() => {
    const uid = String(currentUser?.id || '').trim();
    if (!isLoggedIn || !uid || !hasHydratedChatMessagesRef.current) return;
    notifyIncomingChatMessages(ticketMessages);
  }, [ticketMessages, activeScopedTicketLookup, isLoggedIn, currentUser?.id, notifyIncomingChatMessages]);

  const totalLiveChatUnreadCount = React.useMemo(() => {
    return Object.values(unreadCountsByTicket).reduce((sum, count) => sum + count, 0);
  }, [unreadCountsByTicket]);

  const liveChatUnreadTicketsCount = React.useMemo(() => {
    return Object.values(unreadCountsByTicket).filter(count => count > 0).length;
  }, [unreadCountsByTicket]);

  // Ticket CRUD
  const getTicketById = (id: string) => {
    return tickets.find(t => t.id === id);
  };

  const createTicket = (data: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'isArchived'>): Ticket => {
    const rawWo = data.woNumber || (data as any).workOrderNumber || '';
    const normWo = normalizeWoNumber(rawWo);

    if (!normWo || !isValidWoNumber(normWo)) {
      toast.error('Gagal membuat WO: Nomor WO tidak valid atau kosong.', 'Validasi Gagal');
      throw new Error(`Nomor WO "${rawWo}" tidak valid.`);
    }

    // Check if WO already exists in current state
    const existing = tickets.find(t => normalizeWoNumber(t.woNumber || (t as any).workOrderNumber) === normWo);
    if (existing) {
      toast.warning(`Work Order ${normWo} sudah terdaftar di database. Duplikasi dicegah.`, 'Duplikasi Dicegah');
      return existing;
    }

    const deterministicId = getDeterministicTicketId(normWo);
    const created: Ticket = {
      ...data,
      id: deterministicId,
      woNumber: normWo,
      workOrderNumber: normWo,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name
    };

    const { ticket: processed, logs } = executeWorkflowsOnTicket(
      created,
      'ticket_created',
      workflowRules,
      templates,
      currentUser.name,
      currentUser.role
    );

    setTickets(prev => deduplicateTicketsInMemory([processed, ...prev]));
    setSyncStatus('SYNCING');
    supabaseDb.createWorkOrder(processed)
      .then((res) => {
        if (!res.success) throw new Error(res.error?.message || 'Gagal menyimpan tiket baru');
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
      })
      .catch(e => {
        console.warn('[Supabase] Error saving created ticket:', e);
        setSyncStatus('ERROR');
      });

    if (logs.length > 0) {
      setTicketActivities(prev => [...logs, ...prev]);
    }

    addAuditLog('Ticket Created', 'ticket', processed.id, `Created Work Order ${processed.woNumber} for ${processed.customerName}`);
    return processed;
  };

  const updateTicket = (id: string, updates: Partial<Ticket>, reason?: string): { success: boolean; error?: string } => {
    const existing = getTicketById(id);
    if (!existing) return { success: false, error: 'Tiket tidak ditemukan.' };

    // Installer can only update technicalReport and remarks on assigned WO
    if (currentUser.role === 'installer') {
      const assignedName = (existing.installerName || '').toLowerCase().trim();
      const currentName = (currentUser.name || '').toLowerCase().trim();
      if (assignedName !== currentName) {
        return { success: false, error: 'Akses Ditolak: Anda hanya berwenang memperbarui tiket yang ditugaskan kepada akun Anda.' };
      }
      const coreFields: (keyof Ticket)[] = ['woNumber', 'idCustomer', 'customerName', 'customerPhone', 'slotTime', 'contactorName', 'leaderName', 'installerName', 'area'];
      const hasCoreEdits = coreFields.some(f => updates[f] !== undefined && updates[f] !== existing[f]);
      if (hasCoreEdits) {
        return { success: false, error: 'Akses Ditolak: Teknisi hanya diizinkan memperbarui laporan teknis dan status penyelesaian.' };
      }
    } else if (currentUser.role === 'leader') {
      // Leader is specifically authorized to assign/update installerName, slotTime, and remarks
      const allowedKeys = ['installerName', 'slotTime', 'remarksWOInstaller'];
      const updateKeys = Object.keys(updates);
      const hasDisallowedKeys = updateKeys.some(k => !allowedKeys.includes(k));
      if (hasDisallowedKeys) {
        return { success: false, error: 'Akses Ditolak: Leader hanya berwenang menugaskan teknisi, slot waktu, dan catatan pada tiket timnya.' };
      }
    }

    // Strict Rule: Non-leaders cannot modify installerName / installerId
    if ((updates.installerName !== undefined || updates.installerId !== undefined) && currentUser.role !== 'leader') {
      return { success: false, error: 'Akses Ditolak: Hanya Leader yang berwenang melakukan assignment teknisi.' };
    }

    // Strict Rule: Dispatch cannot modify WO Leader / distribution assignment
    if (currentUser.role === 'dispatch') {
      const forbiddenDispatchFields: (keyof Ticket)[] = ['leaderName', 'leaderId', 'corlapName', 'distributionStatus'];
      const hasForbidden = forbiddenDispatchFields.some(f => updates[f] !== undefined && updates[f] !== existing[f]);
      if (hasForbidden) {
        return { success: false, error: 'Akses Ditolak: Dispatch tidak berwenang mengubah distribusi Leader atau assignment WO.' };
      }
    }

    let mergedTicket: Ticket | undefined;
    setTickets(prev =>
      prev.map(t => {
        if (t.id !== id) return t;
        const nextInstallerStatus = updates.installerName
          ? (t.checkInAt ? t.statusWOInstaller : 'Assigned')
          : t.statusWOInstaller;
        const merged: Ticket = {
          ...t,
          ...updates,
          statusWOInstaller: nextInstallerStatus,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name
        };

        if (updates.slotTime && updates.slotTime !== t.slotTime) {
          executeWorkflowsOnTicket(merged, 'slot_time_changed', workflowRules, templates, currentUser.name, currentUser.role);
        }

        if (updates.installerName && updates.installerName !== t.installerName) {
          const res = executeWorkflowsOnTicket(merged, 'installer_assigned', workflowRules, templates, currentUser.name, currentUser.role);
          if (res.logs.length > 0) {
            setTicketActivities(act => [...res.logs, ...act]);
          }
        }

        mergedTicket = merged;
        return merged;
      })
    );

    if (mergedTicket) {
      setSyncStatus('SYNCING');
      supabaseDb.updateWorkOrder(mergedTicket.id, mergedTicket)
        .then((res) => {
          if (!res.success) throw new Error(res.error?.message || 'Gagal memperbarui tiket');
          setSyncStatus('SAVED');
          setLastSyncTime(new Date().toISOString());
        })
        .catch(e => {
          console.warn('[Supabase] Error updating ticket:', e);
          setSyncStatus('ERROR');
        });
    }

    addAuditLog('Ticket Updated', 'ticket', id, `Updated fields on ticket: ${reason || Object.keys(updates).join(', ')}`);
    return { success: true };
  };

  const assignTicketPersonnel = (ticketId: string, _leaderName?: string, installerName?: string) => {
    // App Flow 2: Strictly ONLY Leader can assign WO to technician
    if (currentUser.role !== 'leader') {
      addAuditLog(
        'Unauthorized Technician Assignment Blocked',
        'ticket',
        ticketId,
        `Penugasan teknisi ditolak: Hanya Leader yang berwenang menugaskan WO ke teknisi. Operator: ${currentUser.name} (${currentUser.role})`
      );
      toast.error('Akses Ditolak: Hanya Leader yang berwenang melakukan assignment teknisi.', 'Otoritas Dibatasi');
      return;
    }

    const targetTicket = getTicketById(ticketId);
    if (!targetTicket) return;

    // Verify Contractor & Area scope of Leader
    const norm = (v?: string) => String(v || '').toLowerCase().trim();
    const leaderContr = norm(currentUser.contractor);
    const woContr = norm(targetTicket.contactorName || targetTicket.contractorName);
    if (leaderContr && woContr && !woContr.includes(leaderContr) && !leaderContr.includes(woContr)) {
      toast.error(`Akses Ditolak: WO ${targetTicket.woNumber} berada di luar cakupan Contractor Anda (${currentUser.contractor}).`, 'Di Luar Cakupan');
      return;
    }
    const leaderArea = norm(currentUser.area);
    const woArea = norm(targetTicket.area);
    if (leaderArea && woArea && !woArea.includes(leaderArea) && !leaderArea.includes(woArea)) {
      toast.error(`Akses Ditolak: WO ${targetTicket.woNumber} berada di luar wilayah Anda (${currentUser.area}).`, 'Di Luar Wilayah');
      return;
    }

    // Validate active installer in Leader scope
    const cleanInstName = (installerName || '').trim();
    const matchedInstaller = users.find(
      u => u.role === 'installer' && norm(u.name) === norm(cleanInstName)
    );
    if (cleanInstName && matchedInstaller && !matchedInstaller.active) {
      toast.error(`Teknisi ${matchedInstaller.name} sedang tidak aktif di sistem.`, 'Teknisi Nonaktif');
      return;
    }
    if (cleanInstName && matchedInstaller && leaderContr && matchedInstaller.contractor) {
      const instContr = norm(matchedInstaller.contractor);
      if (!instContr.includes(leaderContr) && !leaderContr.includes(instContr)) {
        toast.error(`Teknisi ${matchedInstaller.name} berasal dari vendor lain (${matchedInstaller.contractor}).`, 'Di Luar Cakupan');
        return;
      }
    }

    // Guard: skip redundant request/notification if already assigned to the exact same installer
    if (
      cleanInstName &&
      norm(targetTicket.installerName) === norm(cleanInstName) &&
      (!matchedInstaller?.id || !targetTicket.installerId || targetTicket.installerId === matchedInstaller.id)
    ) {
      return;
    }

    let updatedTicketItem: Ticket | undefined;

    setTickets(prev =>
      prev.map(t => {
        if (t.id !== ticketId) return t;
        let updated: Ticket = {
          ...t,
          installerName: cleanInstName || undefined,
          installerId: matchedInstaller?.id || t.installerId,
          installerContact: matchedInstaller?.phone || t.installerContact,
          leaderName: t.leaderName || currentUser.name,
          leaderId: t.leaderId || currentUser.id,
          statusWOInstaller: cleanInstName ? (t.checkInAt ? t.statusWOInstaller : 'Assigned') : 'Unassigned',
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name
        };

        if (cleanInstName) {
          const res = executeWorkflowsOnTicket(updated, 'installer_assigned', workflowRules, templates, currentUser.name, currentUser.role);
          updated = res.ticket;
          if (res.logs.length > 0) {
            setTicketActivities(act => [...res.logs, ...act]);
          }
        }

        updatedTicketItem = updated;
        return updated;
      })
    );

    if (updatedTicketItem) {
      setSyncStatus('SYNCING');
      fetch('/api/tickets/assign', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ticketId: updatedTicketItem.id,
          installerName: cleanInstName,
          installerId: matchedInstaller?.id,
          installerContact: matchedInstaller?.phone
        })
      })
        .then(async res => {
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.success) {
            throw new Error(json?.error || `Penugasan gagal (${res.status})`);
          }
          setSyncStatus('SAVED');
          setLastSyncTime(new Date().toISOString());
          if (cleanInstName) {
            toast.success(`Teknisi ${cleanInstName} berhasil ditugaskan ke WO ${targetTicket.woNumber}!`, 'Penugasan Berhasil');
          }
        })
        .catch(err => {
          setSyncStatus('ERROR');
          toast.error('Gagal menyimpan penugasan ke server: ' + (err?.message || err), 'Penugasan Gagal');
        });
    }

    addAuditLog('Personnel Assigned', 'ticket', ticketId, `Leader ${currentUser.name} assigned Installer: ${cleanInstName || '-'}`);
  };

  const bulkAssignPersonnel = (
    ticketIds: string[],
    _leaderName?: string,
    installerName?: string,
    slotTime?: string,
    remarks?: string
  ): { success: boolean; count: number } => {
    // App Flow 2: Strictly ONLY Leader can assign WO to technician
    if (currentUser.role !== 'leader') {
      addAuditLog(
        'Unauthorized Bulk Technician Assignment Blocked',
        'ticket',
        'bulk',
        `Penugasan massal teknisi ditolak: Hanya Leader yang berwenang menugaskan WO ke teknisi. Operator: ${currentUser.name} (${currentUser.role})`
      );
      toast.error('Akses Ditolak: Hanya Leader yang berwenang menugaskan WO ke teknisi.', 'Otoritas Dibatasi');
      return { success: false, count: 0 };
    }

    const norm = (v?: string) => String(v || '').toLowerCase().trim();
    const cleanInstName = (installerName || '').trim();
    const matchedInstaller = cleanInstName
      ? users.find(u => u.role === 'installer' && norm(u.name) === norm(cleanInstName))
      : undefined;

    if (cleanInstName && matchedInstaller && !matchedInstaller.active) {
      toast.error(`Teknisi ${matchedInstaller.name} sedang tidak aktif di sistem.`, 'Teknisi Nonaktif');
      return { success: false, count: 0 };
    }

    const leaderContr = norm(currentUser.contractor);
    const leaderArea = norm(currentUser.area);

    const targetSet = new Set(ticketIds);
    const now = new Date().toISOString();
    const updatedTicketsList: Ticket[] = [];

    setTickets(prev =>
      prev.map(t => {
        if (!targetSet.has(t.id)) return t;
        const woContr = norm(t.contactorName || t.contractorName);
        const woArea = norm(t.area);
        if (leaderContr && woContr && !woContr.includes(leaderContr) && !leaderContr.includes(woContr)) return t;
        if (leaderArea && woArea && !woArea.includes(leaderArea) && !leaderArea.includes(woArea)) return t;

        let updated: Ticket = {
          ...t,
          installerName: cleanInstName !== '' ? cleanInstName : t.installerName,
          installerId: matchedInstaller?.id || t.installerId,
          installerContact: matchedInstaller?.phone || t.installerContact,
          slotTime: slotTime !== undefined && slotTime !== '' ? slotTime : t.slotTime,
          statusWOInstaller: cleanInstName ? (t.checkInAt ? t.statusWOInstaller : 'Assigned') : t.statusWOInstaller,
          remarksWOInstaller: remarks ? (t.remarksWOInstaller ? `${t.remarksWOInstaller}; ${remarks}` : remarks) : t.remarksWOInstaller,
          updatedAt: now,
          updatedBy: currentUser.name
        };

        if (cleanInstName) {
          const res = executeWorkflowsOnTicket(updated, 'installer_assigned', workflowRules, templates, currentUser.name, currentUser.role);
          updated = res.ticket;
          if (res.logs.length > 0) {
            setTicketActivities(act => [...res.logs, ...act]);
          }
        }

        updatedTicketsList.push(updated);
        return updated;
      })
    );

    if (updatedTicketsList.length === 0) {
      toast.warning('Tidak ada tiket dalam cakupan Contractor & Area Anda untuk ditugaskan.', 'Di Luar Cakupan');
      return { success: false, count: 0 };
    }

    setSyncStatus('SYNCING');
    Promise.all(
      updatedTicketsList.map(t =>
        fetch('/api/tickets/assign', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            ticketId: t.id,
            installerName: t.installerName,
            installerId: t.installerId,
            installerContact: t.installerContact,
            slotTime: t.slotTime,
            remarksWOInstaller: t.remarksWOInstaller
          })
        }).then(r => r.json())
      )
    )
      .then(() => {
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        scheduleKpiRefreshRef.current?.();
        toast.success(`Berhasil memperbarui penugasan untuk ${updatedTicketsList.length} tiket.`, 'Penugasan Massal Sukses');
      })
      .catch(err => {
        setSyncStatus('ERROR');
        toast.error('Gagal menyimpan penugasan massal ke server: ' + (err?.message || err), 'Gagal');
      });

    addAuditLog(
      'Bulk Personnel Assigned',
      'ticket',
      `${updatedTicketsList.length} tickets`,
      `Bulk assigned ${updatedTicketsList.length} tickets by Leader ${currentUser.name}. Installer: ${cleanInstName || '-'}, Slot: ${slotTime || 'Original'}`
    );

    return { success: true, count: updatedTicketsList.length };
  };

  const reassignTicketPersonnel = (ticketId: string, newInstallerName: string, reason: string): { success: boolean; error?: string; historyEntry?: WOAssignmentHistory } => {
    // 1. App Flow 2 RBAC check: Strictly Leader ONLY
    if (currentUser.role !== 'leader') {
      const err = 'Akses Ditolak: Hanya akun dengan role Leader yang berwenang melakukan Reassign WO.';
      toast.error(err, 'Akses Ditolak');
      return { success: false, error: err };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket) {
      const err = 'Tiket Work Order tidak ditemukan.';
      toast.error(err, 'Error');
      return { success: false, error: err };
    }

    if (
      ticket.installerName &&
      ticket.installerName.trim().toLowerCase() === newInstallerName.trim().toLowerCase()
    ) {
      const msg = `WO ${ticket.woNumber} sudah ditugaskan kepada ${ticket.installerName}. Pilih teknisi lain untuk melakukan reassign.`;
      toast.warning(msg, 'Teknisi Tidak Berubah');
      return { success: false, error: msg };
    }

    const foundInstaller = users.find(u => u.name.toLowerCase().trim() === newInstallerName.toLowerCase().trim() && u.role === 'installer');
    const targetInstaller = foundInstaller || {
      id: 'inst-' + Date.now(),
      name: newInstallerName,
      active: true,
      contractor: currentUser.contractor,
      area: currentUser.area
    };

    // Call central reassignWOTechnician service engine
    const reassignRes = reassignWOTechnician(
      ticket,
      targetInstaller,
      {
        id: currentUser.id,
        name: currentUser.name,
        role: currentUser.role,
        contractor: currentUser.contractor,
        area: currentUser.area
      },
      reason
    );

    if (!reassignRes.success || !reassignRes.ticket) {
      toast.error(reassignRes.error || 'Gagal melakukan reassign WO.', 'Reassign Gagal');
      return { success: false, error: reassignRes.error };
    }

    // Update tickets state
    setTickets(prev => prev.map(t => t.id === ticketId ? reassignRes.ticket! : t));

    // Persist via authoritative backend reassign endpoint
    setSyncStatus('SYNCING');
    fetch('/api/tickets/reassign', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ticketId,
        woNumber: ticket.woNumber,
        newInstallerName,
        newInstallerId: foundInstaller?.id,
        reason
      })
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          throw new Error(json?.error || `Reassign gagal (${res.status})`);
        }
        if (json.ticket) {
          setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...json.ticket } : t));
        }
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        scheduleKpiRefreshRef.current?.();
        toast.success(`WO ${ticket.woNumber} berhasil dialihkan ke ${newInstallerName}!`, 'Reassign Berhasil');
      })
      .catch(err => {
        setSyncStatus('ERROR');
        setTickets(prev => prev.map(t => t.id === ticketId ? ticket : t));
        toast.error('Gagal menyimpan reassign ke server: ' + (err?.message || err), 'Reassign Gagal');
      });

    // Audit log
    addAuditLog(
      'WO Reassigned',
      'ticket',
      ticket.woNumber,
      `WO ${ticket.woNumber} dialihkan dari ${ticket.installerName || 'Unassigned'} ke ${newInstallerName} oleh ${currentUser.name}. Alasan: ${reason}`
    );

    return { success: true, historyEntry: reassignRes.historyEntry };
  };

  const updateTicketStatus = (ticketId: string, statusAgent?: any, statusInstaller?: any, remarks?: string) => {
    const target = getTicketById(ticketId);
    let updatedTicketItem: Ticket | undefined;

    setTickets(prev =>
      prev.map(t => {
        if (t.id !== ticketId) return t;
        const updated: Ticket = {
          ...t,
          ...(statusAgent ? { statusWOAgent: statusAgent } : {}),
          ...(statusInstaller ? { statusWOInstaller: statusInstaller } : {}),
          ...(remarks ? { remarksWOInstaller: remarks } : {}),
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name
        };

        if (statusInstaller === 'Completed') {
          executeWorkflowsOnTicket(updated, 'ticket_completed', workflowRules, templates, currentUser.name, currentUser.role);
        }

        updatedTicketItem = updated;
        return updated;
      })
    );

    if (updatedTicketItem) {
      setSyncStatus('SYNCING');
      supabaseDb.updateWorkOrder(updatedTicketItem.id, updatedTicketItem)
        .then((res) => {
          if (!res.success) throw new Error(res.error?.message || 'Gagal memperbarui status');
          setSyncStatus('SAVED');
          setLastSyncTime(new Date().toISOString());
          scheduleKpiRefreshRef.current?.();
          toast.info(`Status WO ${target?.woNumber || ticketId} diperbarui (${statusInstaller || statusAgent || 'Updated'}).`, 'Status Berubah');
        })
        .catch(err => {
          setSyncStatus('ERROR');
          toast.error('Gagal memperbarui status tiket di Supabase PostgreSQL: ' + (err?.message || err), 'Gagal');
        });
    }

    addAuditLog('Status Changed', 'ticket', ticketId, `Agent: ${statusAgent || '-'}, Installer: ${statusInstaller || '-'}`);
  };

  const archiveTicket = (ticketId: string) => {
    const target = getTicketById(ticketId);
    if (!target) return;
    const archived: Ticket = {
      ...target,
      isArchived: true,
      archivedAt: new Date().toISOString(),
      archivedBy: currentUser.name
    };
    setTickets(prev =>
      prev.map(t => (t.id === ticketId ? archived : t))
    );
    setSyncStatus('SYNCING');
    supabaseDb.archiveWorkOrder(ticketId, currentUser.name)
      .then((res) => {
        if (!res.success) throw new Error(res.error?.message || 'Gagal mengarsipkan tiket');
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        toast.info(`WO ${target?.woNumber || ticketId} dipindahkan ke arsip Supabase PostgreSQL.`, 'Tiket Diarsipkan');
      })
      .catch(err => {
        setSyncStatus('ERROR');
        toast.error('Gagal mengarsipkan tiket di Supabase PostgreSQL: ' + (err?.message || err), 'Gagal');
      });
    addAuditLog('Ticket Archived', 'ticket', ticketId, `Ticket moved to archive by ${currentUser.name}`);
  };

  const restoreTicket = (ticketId: string) => {
    const target = getTicketById(ticketId);
    if (!target) return;
    const restored: Ticket = {
      ...target,
      isArchived: false,
      isDeleted: false,
      archivedAt: undefined,
      archivedBy: undefined,
      deletedAt: undefined,
      deletedBy: undefined,
      deletionReason: undefined
    };
    setTickets(prev =>
      prev.map(t => (t.id === ticketId ? restored : t))
    );
    setSyncStatus('SYNCING');
    supabaseDb.restoreWorkOrder(ticketId, currentUser.name)
      .then((res) => {
        if (!res.success) throw new Error(res.error?.message || 'Gagal memulihkan tiket');
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        toast.success(`WO ${target?.woNumber || ticketId} berhasil dipulihkan dari arsip Supabase PostgreSQL.`, 'Tiket Dipulihkan');
      })
      .catch(err => {
        setSyncStatus('ERROR');
        toast.error('Gagal memulihkan tiket di Supabase PostgreSQL: ' + (err?.message || err), 'Gagal');
      });
    addAuditLog('Ticket Restored', 'ticket', ticketId, `Ticket restored from archive/deletion by ${currentUser.name}`);
  };

  const deleteTicket = (ticketId: string, reason: string, permanent: boolean = false): { success: boolean; error?: string } => {
    // STRICT SECURITY POLICY: Only Superadmin can delete WO
    if (currentUser.role !== 'super_admin') {
      const err = 'Akses Ditolak: Hanya akun Superadmin yang memiliki wewenang menghapus data Work Order.';
      addAuditLog('Unauthorized Deletion Attempt', 'ticket', ticketId, `${currentUser.name} (${currentUser.role}) mencoba menghapus WO tanpa izin Superadmin`);
      toast.error(err, 'Akses Ditolak');
      return { success: false, error: err };
    }

    const ticket = getTicketById(ticketId);
    if (!ticket) {
      toast.error('Tiket tidak ditemukan.', 'Error');
      return { success: false, error: 'Tiket tidak ditemukan.' };
    }

    if (!reason || reason.trim().length < 5) {
      toast.error('Alasan penghapusan wajib diisi minimal 5 karakter.', 'Validasi Gagal');
      return { success: false, error: 'Alasan penghapusan wajib diisi minimal 5 karakter.' };
    }

    const now = new Date().toISOString();
    if (permanent) {
      setTickets(prev => prev.filter(t => t.id !== ticketId));
      addAuditLog('Ticket Permanently Deleted', 'ticket', ticketId, `Superadmin ${currentUser.name} menandai hapus permanen WO ${ticket.woNumber}. Alasan: ${reason}`);
    } else {
      // Soft Delete
      setTickets(prev =>
        prev.map(t => {
          if (t.id !== ticketId) return t;
          return {
            ...t,
            isDeleted: true,
            deletedAt: now,
            deletedBy: currentUser.name,
            deletionReason: reason,
            updatedAt: now,
            updatedBy: currentUser.name
          };
        })
      );
      addAuditLog('Ticket Soft Deleted', 'ticket', ticketId, `Superadmin ${currentUser.name} menghapus (soft delete) WO ${ticket.woNumber}. Alasan: ${reason}`);
    }

    setSyncStatus('SYNCING');
    supabaseDb.deleteWorkOrder(ticketId, reason, currentUser.name)
      .then((res) => {
        if (!res.success) throw new Error(res.error?.message || 'Gagal menghapus tiket');
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        if (permanent) {
          toast.warning(`WO ${ticket.woNumber} telah dihapus dari daftar aktif Supabase PostgreSQL.`, 'WO Dihapus');
        } else {
          toast.warning(`WO ${ticket.woNumber} berhasil dihapus (soft delete).`, 'WO Dihapus');
        }
      })
      .catch(err => {
        setSyncStatus('ERROR');
        toast.error('Gagal menghapus tiket di Supabase PostgreSQL: ' + (err?.message || err), 'Gagal');
      });

    return { success: true };
  };

  const bulkImportTickets = (
    imported: Partial<Ticket>[],
    options?: { duplicatePolicy?: 'skip' | 'update_allowed' | 'review' }
  ) => {
    // ONLY Super Admin can import WO
    if (currentUser.role !== 'super_admin') {
      addAuditLog('Unauthorized Import Blocked', 'import_batch', 'import-denied', `Akses import ditolak untuk peran ${currentUser.role}`);
      toast.error('Akses Ditolak: Hanya Super Admin yang berwenang melakukan import Work Order.', 'Akses Ditolak');
      return { importedCount: 0, updatedCount: 0, duplicatesIgnored: 0, distributedCount: 0, undistributedCount: 0 };
    }

    const policy = options?.duplicatePolicy || 'skip';
    let importedCount = 0;
    let updatedCount = 0;
    let duplicatesIgnored = 0;
    let distributedCount = 0;
    let undistributedCount = 0;
    const existingWos = new Set(tickets.map(t => t.woNumber.toUpperCase().trim()));

    // Automatic Contractor & Coverage Area Registration from Import Results
    const { newContractors, updatedContractors, newCoverageAreas: extractedNewAreas } = extractContractorsFromTickets(
      imported,
      contractors,
      coverageAreas
    );

    let activeContractors = [...contractors];
    if (newContractors.length > 0 || updatedContractors.length > 0) {
      setContractors(prev => {
        let updated = [...prev];
        updatedContractors.forEach(up => {
          const idx = updated.findIndex(c => c.id === up.id);
          if (idx >= 0) updated[idx] = up;
        });
        newContractors.forEach(nc => {
          if (!updated.some(c => c.id === nc.id || c.name.toLowerCase().trim() === nc.name.toLowerCase().trim())) {
            updated.push(nc);
          }
        });
        return updated;
      });

      updatedContractors.forEach(up => {
        const idx = activeContractors.findIndex(c => c.id === up.id);
        if (idx >= 0) activeContractors[idx] = up;
      });
      newContractors.forEach(nc => {
        if (!activeContractors.some(c => c.id === nc.id || c.name.toLowerCase().trim() === nc.name.toLowerCase().trim())) {
          activeContractors.push(nc);
        }
      });
      if (newContractors.length > 0) {
        addAuditLog(
          'Contractors Auto-Registered',
          'ui_config',
          'import_contractors',
          `${newContractors.length} Kategori Kontraktor baru terdaftar otomatis dari hasil import/text converter: ${newContractors.map(c => `${c.name} [${c.code}]`).join(', ')}`
        );
      }
    }

    let activeCoverageAreas = [...coverageAreas];
    if (extractedNewAreas.length > 0) {
      setCoverageAreas(prev => {
        const merged = [...prev];
        extractedNewAreas.forEach(na => {
          if (!merged.some(a => a.name.toLowerCase().trim() === na.name.toLowerCase().trim())) {
            merged.push(na);
          }
        });
        return merged;
      });
      extractedNewAreas.forEach(na => {
        if (!activeCoverageAreas.some(a => a.name.toLowerCase().trim() === na.name.toLowerCase().trim())) {
          activeCoverageAreas.push(na);
        }
      });
      addAuditLog(
        'Coverage Areas Auto-Registered',
        'ui_config',
        'import_areas',
        `${extractedNewAreas.length} Cakupan Area baru terdaftar dari hasil import: ${extractedNewAreas.map(a => a.name).join(', ')}`
      );
    }

    const newItems: Ticket[] = [];
    const updatedTicketsMap = new Map<string, Partial<Ticket>>();
    const importTimestamp = new Date().toISOString();
    const importDateStr = importTimestamp.split('T')[0];
    const batchId = 'batch_' + Date.now();
    const rejectedDuplicates: string[] = [];
    const batchAcceptedWos = new Set<string>();

    imported.forEach(item => {
      const woNum = (item.woNumber || item.workOrderNumber || '').trim();
      const upperWo = woNum.toUpperCase();

      // Check for empty or invalid WO
      if (!woNum) {
        duplicatesIgnored++;
        return;
      }

      // Check duplicate within the incoming import batch
      if (batchAcceptedWos.has(upperWo)) {
        duplicatesIgnored++;
        if (!rejectedDuplicates.includes(woNum)) {
          rejectedDuplicates.push(woNum);
        }
        return;
      }

      // Check duplicate against existing database
      if (existingWos.has(upperWo)) {
        if (policy === 'update_allowed') {
          // Update allowed fields on existing ticket without overwriting existing technician or technical reports
          const updates: Partial<Ticket> = {};
          if (item.appointmentDate) updates.appointmentDate = item.appointmentDate;
          if (item.slotTime) updates.slotTime = item.slotTime;
          if (item.remarksAgent) updates.remarksAgent = item.remarksAgent;
          if (item.ticketCategory) updates.ticketCategory = item.ticketCategory;
          if (item.customerPhone) updates.customerPhone = item.customerPhone;
          updates.updatedAt = importTimestamp;
          updates.updatedBy = currentUser.name;

          updatedTicketsMap.set(upperWo, updates);
          updatedCount++;
          batchAcceptedWos.add(upperWo);
          return;
        } else {
          // Skip / Reject policy
          duplicatesIgnored++;
          if (!rejectedDuplicates.includes(woNum)) {
            rejectedDuplicates.push(woNum);
          }
          return;
        }
      }

      batchAcceptedWos.add(upperWo);

      // Run central WODistributionEngine with dynamically recognized contractors & Contractor+Area Leader matching
      const { ticket: distributed, status: distStatus, reason: distReason } = runWODistributionEngine(
        item,
        activeContractors,
        activeCoverageAreas,
        currentUser.role,
        users
      );
      if (distStatus === 'distributed') {
        distributedCount++;
      } else {
        undistributedCount++;
      }

      // Customer ID validation (exact 7 digits)
      const rawCustId = (distributed.idCustomer || distributed.customerId || '').trim();
      const custDigits = rawCustId.replace(/\D/g, '');
      const validCustId = custDigits.length === 7 ? custDigits : (rawCustId || '');

      const ticket: Ticket = {
        id: getDeterministicTicketId(woNum),
        woNumber: woNum,
        workOrderNumber: woNum,
        idCustomer: validCustId,
        customerId: validCustId,
        ticketNumber: distributed.ticketNumber,
        ticketDate: distributed.ticketDate,
        date: distributed.date || importDateStr,
        dateUpload: distributed.dateUpload || new Date().toISOString().replace('T', ' ').substring(0, 16),
        fileName: distributed.fileName || 'Imported_Data.xlsx',
        agentId: distributed.agentId || currentUser.username,
        customerName: distributed.customerName || distributed.endUserName || '-',
        endUserName: distributed.customerName || distributed.endUserName || '-',
        customerPhone: distributed.customerPhone || '',
        customerContact1: distributed.customerPhone || '',
        customerPhoneNormalized: distributed.customerPhoneNormalized,
        customerContact2: distributed.customerContact2,
        customerContact3: distributed.customerContact3,
        appointmentDate: distributed.appointmentDate || '',
        appointmentType: distributed.appointmentType,
        dateAssignAgent: distributed.dateAssignAgent,
        dateAssignTechnician: distributed.dateAssignTechnician,
        streetName: distributed.streetName || '',
        streetAlternatif: distributed.streetAlternatif || '',
        clusterName: distributed.clusterName || '',
        area: distributed.area || '',
        fdtCode: distributed.fdtCode,
        fatCode: distributed.fatCode,
        oltCode: distributed.oltCode,
        installationType: distributed.installationType,
        serviceType: distributed.serviceType,
        homepassType: distributed.homepassType,
        homepassDetailId: distributed.homepassDetailId,
        plan: distributed.plan,
        serviceAgingMaintenance: distributed.serviceAgingMaintenance,
        vendorName: distributed.vendorName,
        router: distributed.router,
        stb1Sn: distributed.stb1Sn,
        stb1Mac: distributed.stb1Mac,
        stb2Sn: distributed.stb2Sn,
        stb2Mac: distributed.stb2Mac,
        stb3Sn: distributed.stb3Sn,
        stb3Mac: distributed.stb3Mac,
        ontSerialNumber: distributed.ontSerialNumber,
        ontMacAddress: distributed.ontMacAddress,
        rgSerialNumber: distributed.rgSerialNumber,
        rgMacAddress: distributed.rgMacAddress,
        slotTime: distributed.slotTime || '',
        ticketCategory: distributed.ticketCategory || distributed.initialTicketCategory || 'New Installation FTTH',
        initialTicketCategory: distributed.ticketCategory || distributed.initialTicketCategory || 'New Installation FTTH',
        contactorName: distributed.contactorName || distributed.contractorName || '',
        contractorName: distributed.contactorName || distributed.contractorName || '',
        contractorId: distributed.contractorId,
        leaderId: distributed.leaderId,
        leaderName: distributed.leaderName || distributed.corlapName,
        leaderContact: distributed.leaderContact,
        corlapName: distributed.corlapName || distributed.leaderName,
        corlapContact: distributed.corlapContact,
        installerName: distributed.installerName,
        installerContact: distributed.installerContact,
        installerContact2: distributed.installerContact2,
        distributionStatus: distStatus,
        distributionNotes: distReason,
        statusWOAgent: distributed.statusWOAgent || 'Pending',
        statusWOInstaller: distributed.statusWOInstaller || (distributed.installerName ? 'Assigned' : 'Unassigned'),
        statusWhatsApp: distributed.statusWhatsApp || 'not_prepared',
        remarksWOInstaller: distributed.remarksWOInstaller,
        remarksAgent: distributed.remarksAgent,
        isArchived: false,
        importedAt: importTimestamp,
        importDate: importDateStr,
        importBatchId: batchId,
        createdAt: importTimestamp,
        updatedAt: importTimestamp,
        updatedBy: currentUser.name,
        unmappedHeaders: distributed.unmappedHeaders || [],
        additionalFields: distributed.additionalFields || {}
      };

      const res = executeWorkflowsOnTicket(ticket, 'ticket_imported', workflowRules, templates, currentUser.name, currentUser.role);
      newItems.push(res.ticket);
      existingWos.add(upperWo);
      importedCount++;
    });

    // Apply updates and additions to database
    setTickets(prev => {
      let result = prev;
      if (updatedTicketsMap.size > 0) {
        result = result.map(t => {
          const upper = (t.woNumber || '').toUpperCase().trim();
          if (updatedTicketsMap.has(upper)) {
            return { ...t, ...updatedTicketsMap.get(upper)! };
          }
          return t;
        });
      }
      return deduplicateTicketsInMemory([...newItems, ...result]);
    });

    // Persist imported and updated tickets to Supabase PostgreSQL (Confirmed Write)
    const updatedItemsToSave: Ticket[] = [];
    if (updatedTicketsMap.size > 0) {
      updatedTicketsMap.forEach((updates, upperWo) => {
        const found = tickets.find(t => (t.woNumber || '').toUpperCase().trim() === upperWo);
        if (found) {
          updatedItemsToSave.push({ ...found, ...updates });
        }
      });
    }

    if (newItems.length > 0 || updatedItemsToSave.length > 0) {
      setSyncStatus('SYNCING');
      const ops: Promise<any>[] = [];
      if (newItems.length > 0) {
        ops.push(supabaseDb.batchCreateWorkOrders(newItems, batchId));
      }
      if (updatedItemsToSave.length > 0) {
        ops.push(...updatedItemsToSave.map(item => supabaseDb.updateWorkOrder(item.id, item)));
      }

      Promise.all(ops)
        .then(() => {
          setSyncStatus('SAVED');
          setLastSyncTime(new Date().toISOString());
          const savedTotal = newItems.length + updatedItemsToSave.length;
          toast.success(
            `Berhasil menyimpan ${savedTotal} tiket ke Supabase PostgreSQL${updatedCount > 0 ? ` (${newItems.length} baru, ${updatedCount} diperbarui)` : ''}.${duplicatesIgnored > 0 ? ` (${duplicatesIgnored} nomor WO duplikat ditolak)` : ''}`,
            'Import Selesai'
          );
        })
        .catch(err => {
          setSyncStatus('ERROR');
          toast.error('Gagal menyimpan import tiket ke Supabase PostgreSQL: ' + (err?.message || err), 'Import Gagal');
        });
    } else if (duplicatesIgnored > 0) {
      toast.error(`Semua (${duplicatesIgnored}) nomor WO ditolak karena nomor WO sudah terdaftar dalam sistem.`, 'Nomor WO Duplikat Ditolak');
    }

    addAuditLog('Bulk Import Completed', 'import_batch', batchId, `Imported ${importedCount} tiket baru, diperbarui ${updatedCount} tiket. Ditolak ${duplicatesIgnored} nomor WO duplikat.`);

    if (duplicatesIgnored > 0) {
      addAuditLog(
        'Duplicate WOs Rejected on Import',
        'import_batch',
        batchId,
        `Ditolak ${duplicatesIgnored} nomor WO karena nomor WO sudah terdaftar di sistem: ${rejectedDuplicates.slice(0, 10).join(', ')}${rejectedDuplicates.length > 10 ? ` (+${rejectedDuplicates.length - 10} lainnya)` : ''}`
      );
    }

    return { importedCount, updatedCount, duplicatesIgnored, rejectedDuplicates, distributedCount, undistributedCount };
  };

  // Delete imported data filtered by import date within 7-day retention window
  const deleteImportedTicketsByDate = (
    importDate: string,
    reason: string
  ): { success: boolean; count: number; error?: string } => {
    if (currentUser.role !== 'super_admin') {
      const err = 'Akses Ditolak: Hanya akun Superadmin yang berwenang menghapus data Work Order.';
      toast.error(err, 'Akses Ditolak');
      return { success: false, count: 0, error: err };
    }

    if (!importDate) {
      toast.error('Pilih tanggal import yang ingin dihapus.', 'Validasi Gagal');
      return { success: false, count: 0, error: 'Tanggal import wajib diisi.' };
    }

    if (!reason || reason.trim().length < 5) {
      toast.error('Alasan penghapusan data import wajib diisi minimal 5 karakter.', 'Validasi Gagal');
      return { success: false, count: 0, error: 'Alasan penghapusan minimal 5 karakter.' };
    }

    // 7-day retention constraint check:
    const targetDate = new Date(importDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - targetDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 7) {
      const err = `Batas Retensi: Data import lebih dari 7 hari yang lalu (${importDate}) terkunci dan tidak dapat dihapus massal. Rentang waktu penghapusan adalah 7 hari terakhir.`;
      toast.error(err, 'Di Luar Rentang 7 Hari');
      return { success: false, count: 0, error: err };
    }

    // Find tickets imported on this date
    const matchingTickets = tickets.filter(t => {
      const tImportDate =
        t.importDate ||
        (t.importedAt ? (String(t.importedAt).includes('T') ? String(t.importedAt).split('T')[0] : String(t.importedAt).slice(0, 10)) : '') ||
        (t.createdAt ? (String(t.createdAt).includes('T') ? String(t.createdAt).split('T')[0] : String(t.createdAt).slice(0, 10)) : '') ||
        (t.date ? (String(t.date).includes('T') ? String(t.date).split('T')[0] : String(t.date).slice(0, 10)) : '');
      return (tImportDate === importDate || t.date === importDate) && !t.isDeleted;
    });

    if (matchingTickets.length === 0) {
      toast.info(`Tidak ada tiket import yang ditemukan pada tanggal ${importDate}.`, 'Tidak Ditemukan');
      return { success: false, count: 0, error: 'Tidak ada tiket pada tanggal tersebut.' };
    }

    const targetIds = new Set(matchingTickets.map(t => t.id));
    setTickets(prev => prev.filter(t => !targetIds.has(t.id)));

    // Soft delete matching from Supabase PostgreSQL
    setSyncStatus('SYNCING');
    Promise.all(matchingTickets.map(t => supabaseDb.deleteWorkOrder(t.id, reason, currentUser.name)))
      .then(() => {
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
      })
      .catch(err => {
        console.warn('[Supabase] Error deleting batch tickets:', err);
        setSyncStatus('ERROR');
      });

    addAuditLog(
      'Imported Data Purged',
      'import_batch',
      importDate,
      `Superadmin ${currentUser.name} menghapus ${matchingTickets.length} data tiket hasil import tanggal ${importDate}. Alasan: ${reason}`
    );

    toast.warning(`Berhasil menghapus ${matchingTickets.length} tiket hasil import tanggal ${importDate} dari Supabase PostgreSQL.`, 'Data Import Dihapus');
    return { success: true, count: matchingTickets.length };
  };

  // Bulk delete tickets for Superadmin
  const bulkDeleteTickets = (
    ticketIds: string[],
    reason: string
  ): { success: boolean; count: number; error?: string } => {
    if (currentUser.role !== 'super_admin') {
      const err = 'Akses Ditolak: Hanya akun Superadmin yang memiliki wewenang menghapus data Work Order.';
      toast.error(err, 'Akses Ditolak');
      return { success: false, count: 0, error: err };
    }

    if (!reason || reason.trim().length < 5) {
      toast.error('Alasan penghapusan tiket wajib diisi minimal 5 karakter.', 'Validasi Gagal');
      return { success: false, count: 0, error: 'Alasan penghapusan minimal 5 karakter.' };
    }

    const targetSet = new Set(ticketIds);
    let deletedCount = 0;
    const now = new Date().toISOString();
    setTickets(prev =>
      prev.map(t => {
        if (targetSet.has(t.id)) {
          deletedCount++;
          return {
            ...t,
            isDeleted: true,
            deletedAt: now,
            deletedBy: currentUser.name,
            deletionReason: reason,
            updatedAt: now,
            updatedBy: currentUser.name
          };
        }
        return t;
      })
    );

    // Soft delete in Supabase PostgreSQL
    setSyncStatus('SYNCING');
    Promise.all(ticketIds.map(id => supabaseDb.deleteWorkOrder(id, reason, currentUser.name)))
      .then(() => {
        setSyncStatus('SAVED');
        setLastSyncTime(new Date().toISOString());
        toast.warning(`Berhasil menghapus (soft delete) ${deletedCount} tiket Work Order.`, 'Hapus WO Berhasil');
      })
      .catch(err => {
        setSyncStatus('ERROR');
        toast.error('Gagal menghapus tiket massal di Supabase PostgreSQL: ' + (err?.message || err), 'Gagal');
      });

    addAuditLog(
      'Bulk Tickets Soft Deleted',
      'ticket',
      `${ticketIds.length} tickets`,
      `Superadmin ${currentUser.name} menghapus massal (soft delete) ${ticketIds.length} tiket Work Order. Alasan: ${reason}`
    );

    return { success: true, count: deletedCount };
  };

  // Google Sheets Bidirectional / Auto Sync (Super Admin Only)
  const syncGoogleSheetsNow = async (direction?: 'both' | 'export_only' | 'import_only'): Promise<SheetSyncResult> => {
    if (currentUser.role !== 'super_admin') {
      const msg = 'Akses Ditolak: Hanya Super Admin yang berwenang melakukan sinkronisasi Google Sheets.';
      toast.error(msg, 'Akses Ditolak');
      return {
        success: false,
        message: msg,
        timestamp: new Date().toISOString()
      };
    }

    const dir = direction || googleSheetsConfig.syncDirection;
    const sheetId = googleSheetsConfig.spreadsheetId?.trim();
    const tabName = googleSheetsConfig.sheetName?.trim() || 'Work_Orders';

    if (!sheetId) {
      const res: SheetSyncResult = {
        success: false,
        message: 'Spreadsheet ID atau URL Google Sheet belum diisi.',
        timestamp: new Date().toISOString()
      };
      setGoogleSheetsConfig(prev => ({ ...prev, lastSyncStatus: 'error', lastSyncMessage: res.message }));
      toast.error('Spreadsheet ID atau URL Google Sheet belum diisi.', 'Gagal Sinkronisasi');
      return res;
    }

    const token = getAccessToken();
    if (!token) {
      const res: SheetSyncResult = {
        success: false,
        message: 'Akun Google belum terhubung. Silakan login dengan Google terlebih dahulu.',
        timestamp: new Date().toISOString()
      };
      setGoogleSheetsConfig(prev => ({ ...prev, lastSyncStatus: 'error', lastSyncMessage: res.message }));
      toast.warning('Akun Google belum terhubung. Silakan hubungkan akun Google.', 'Perlu Otorisasi');
      return res;
    }

    setGoogleSheetsConfig(prev => ({
      ...prev,
      lastSyncStatus: 'syncing',
      lastSyncMessage: 'Sedang melakukan sinkronisasi data dengan Google Sheets...'
    }));

    try {
      let pulledCount = 0;
      let pushedCount = 0;
      let newContractorsCount = 0;

      // 1. PULL from Google Sheets (Import data rows into MoraJaws)
      if (dir === 'both' || dir === 'import_only') {
        const { rows } = await pullRowsFromSheet(sheetId, tabName);
        if (rows && rows.length > 0) {
          const existingWoSet = new Set(tickets.map(t => t.woNumber.toUpperCase().trim()));
          const engineResult = processRawImportWithEngine(
            rows,
            existingWoSet,
            contractors,
            coverageAreas,
            canonicalFields,
            currentUser.role,
            users
          );

          // Auto-register any new contractor categories detected from Google Sheet
          if (googleSheetsConfig.autoRegisterContractors && engineResult.detectedContractors?.length > 0) {
            const toEnroll = engineResult.detectedContractors.map(c => ({
              id: c.id,
              name: c.name,
              code: c.code,
              coverageAreas: c.coverageAreas,
              leaderName: c.leaderName,
              phone: c.phone,
              email: c.email || `ops@${c.code.toLowerCase()}.morajaws.net`,
              active: true,
              createdAt: new Date().toISOString()
            }));
            const enrollRes = autoRegisterContractors(toEnroll);
            newContractorsCount = enrollRes.addedCount;
          }

          const validRowsToImport = engineResult.parsedRows
            .filter(r => r.isValid)
            .map(r => ({
              ...r.mapped,
              fileName: `GoogleSheet_${tabName}`
            }));

          if (validRowsToImport.length > 0) {
            const importRes = bulkImportTickets(validRowsToImport);
            pulledCount = importRes.importedCount;
          }
        }
      }

      // 2. PUSH to Google Sheets (Export current MoraJaws active tickets to Sheet)
      if (dir === 'both' || dir === 'export_only') {
        const activeTickets = tickets.filter(t => !t.isArchived);
        const pushRes = await pushTicketsToSheet(sheetId, tabName, activeTickets);
        pushedCount = pushRes.updatedRows;
      }

      const now = new Date().toISOString();
      const summaryMsg = dir === 'both'
        ? `Sinkronisasi sukses: ${pulledCount} tiket baru diimpor, ${pushedCount} baris tersinkron ke Google Sheet.`
        : dir === 'import_only'
        ? `Tarik data sukses: ${pulledCount} tiket baru diimpor dari Google Sheet.`
        : `Kirim data sukses: ${pushedCount} baris tersimpan ke Google Sheet.`;

      setGoogleSheetsConfig(prev => ({
        ...prev,
        lastSyncAt: now,
        lastSyncStatus: 'success',
        lastSyncMessage: summaryMsg,
        syncedRowCount: pushedCount || tickets.length,
        lastPulledCount: pulledCount,
        lastPushedCount: pushedCount
      }));

      addAuditLog(
        'Google Sheets Synced',
        'ui_config',
        sheetId,
        `${summaryMsg} (${dir.toUpperCase()}) oleh ${currentUser.name}`
      );

      toast.success(summaryMsg, 'Sinkronisasi Sheets Berhasil');

      return {
        success: true,
        message: summaryMsg,
        pulledCount,
        pushedCount,
        newContractorsCount,
        timestamp: now
      };
    } catch (err: any) {
      const errorMsg = err?.message || 'Terjadi kesalahan saat sinkronisasi Google Sheet.';
      setGoogleSheetsConfig(prev => ({
        ...prev,
        lastSyncStatus: 'error',
        lastSyncMessage: errorMsg
      }));
      addAuditLog('Google Sheets Sync Failed', 'ui_config', sheetId, `Gagal sync: ${errorMsg}`);
      toast.error(errorMsg, 'Gagal Sinkronisasi Sheets');
      return {
        success: false,
        message: errorMsg,
        error: errorMsg,
        timestamp: new Date().toISOString()
      };
    }
  };

  // Background interval timer for automatic sync
  useEffect(() => {
    if (!googleSheetsConfig.enabled || !googleSheetsConfig.spreadsheetId) return;

    const intervalMinutes = Math.max(googleSheetsConfig.syncInterval || 10, 1);
    const intervalMs = intervalMinutes * 60 * 1000;

    const timer = setInterval(() => {
      const token = getAccessToken();
      if (!token) return; // Silent skip if not authenticated yet

      syncGoogleSheetsNow(googleSheetsConfig.syncDirection);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [
    googleSheetsConfig.enabled,
    googleSheetsConfig.spreadsheetId,
    googleSheetsConfig.sheetName,
    googleSheetsConfig.syncInterval,
    googleSheetsConfig.syncDirection,
    googleSheetsConfig.autoRegisterContractors,
    tickets
  ]);

  // WhatsApp helpers with strict RBAC: Only Superadmin and Dispatch allowed
  const isTemplateAuthorized = () => {
    return currentUser.role === 'super_admin' || currentUser.role === 'dispatch';
  };

  const createTemplate = (data: Omit<WhatsAppTemplate, 'id' | 'version' | 'lastUpdated'>): WhatsAppTemplate => {
    if (!isTemplateAuthorized()) {
      const errMsg = 'Akses Ditolak: Hanya Superadmin dan Dispatch yang diizinkan menambah Template WhatsApp.';
      toast.error(errMsg, 'Akses Ditolak');
      throw new Error(errMsg);
    }
    const newTpl: WhatsAppTemplate = {
      ...data,
      id: 'tpl_' + Date.now(),
      version: 1,
      lastUpdated: new Date().toISOString()
    };
    setTemplates(prev => [newTpl, ...prev]);
    supabaseDb.saveWaTemplate(newTpl).catch(e => console.warn('[Supabase] Error saving template:', e));
    addAuditLog('Template Created', 'template', newTpl.id, `Created WhatsApp template: ${newTpl.name}`);
    return newTpl;
  };

  const updateTemplate = (id: string, updates: Partial<WhatsAppTemplate>) => {
    if (!isTemplateAuthorized()) {
      const errMsg = 'Akses Ditolak: Hanya Superadmin dan Dispatch yang diizinkan mengubah Template WhatsApp.';
      toast.error(errMsg, 'Akses Ditolak');
      return;
    }
    setTemplates(prev =>
      prev.map(t => {
        if (t.id === id) {
          const updated = { ...t, ...updates, version: t.version + 1, lastUpdated: new Date().toISOString(), updatedBy: currentUser.name };
          supabaseDb.saveWaTemplate(updated).catch(e => console.warn('[Supabase] Error updating template:', e));
          return updated;
        }
        return t;
      })
    );
    addAuditLog('Template Updated', 'template', id, `Updated WhatsApp template: ${updates.name || id}`);
  };

  const deleteTemplate = (id: string) => {
    if (!isTemplateAuthorized()) {
      const errMsg = 'Akses Ditolak: Hanya Superadmin dan Dispatch yang diizinkan menghapus Template WhatsApp.';
      toast.error(errMsg, 'Akses Ditolak');
      return;
    }
    setTemplates(prev => prev.filter(t => t.id !== id));
    supabaseDb.deleteWaTemplate(id).catch(e => console.warn('[Supabase] Error deleting template:', e));
    addAuditLog('Template Deleted', 'template', id, `Deleted template ${id}`);
  };

  // -------------------------------------------------------------
  // Contact Center Chat Category Operations (DB-First Super Admin)
  // -------------------------------------------------------------
  const saveChatCategoriesDbFirst = async (
    updated: ChatCategoryConfig[],
    description: string,
    forceOverwrite = false
  ): Promise<{ success: boolean; error?: string }> => {
    return saveAppConfigDbFirst(
      'chat_categories',
      { categories: updated, updatedAt: new Date().toISOString(), updatedBy: currentUser.name },
      {
        module: 'chat_categories',
        description,
        forceOverwrite,
        onSuccess: (saved) => {
          const list = Array.isArray(saved) ? saved : (saved as any)?.categories || updated;
          setChatCategories(list);
        },
        retryFactory: () => saveChatCategoriesDbFirst(updated, description, true)
      }
    );
  };

  const addChatCategory = async (
    categoryData: Omit<ChatCategoryConfig, 'id' | 'createdAt'>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const normalizedName = String(categoryData.name || '').trim().toUpperCase();
    if (!normalizedName) {
      toast.error('Nama kategori chat tidak boleh kosong.');
      return { success: false, error: 'Nama kategori chat tidak boleh kosong.' };
    }
    const isDup = chatCategories.some(c => String(c.name || '').trim().toUpperCase() === normalizedName);
    if (isDup) {
      toast.warning(`Kategori chat "${normalizedName}" sudah terdaftar.`, 'Duplikasi Kategori');
      return { success: false, error: `Kategori chat "${normalizedName}" sudah terdaftar.` };
    }
    const newCat: ChatCategoryConfig = {
      ...categoryData,
      name: normalizedName,
      id: 'cat-' + Date.now(),
      createdAt: new Date().toISOString()
    };
    const updated = [...chatCategories, newCat];
    const res = await saveChatCategoriesDbFirst(updated, `Created chat category ${newCat.name}`, Boolean(options.forceOverwrite));
    if (res.success) {
      toast.success(`Kategori chat "${newCat.name}" berhasil disimpan ke Supabase PostgreSQL.`);
    }
    return res;
  };

  const updateChatCategory = async (
    id: string,
    updates: Partial<ChatCategoryConfig>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    if (updates.name !== undefined) {
      const normalizedName = String(updates.name || '').trim().toUpperCase();
      if (!normalizedName) {
        toast.error('Nama kategori chat tidak boleh kosong.');
        return { success: false, error: 'Nama kategori chat tidak boleh kosong.' };
      }
      const isDup = chatCategories.some(
        c => c.id !== id && String(c.name || '').trim().toUpperCase() === normalizedName
      );
      if (isDup) {
        toast.warning(`Kategori chat "${normalizedName}" sudah terdaftar.`, 'Duplikasi Kategori');
        return { success: false, error: `Kategori chat "${normalizedName}" sudah terdaftar.` };
      }
      updates = { ...updates, name: normalizedName };
    }
    const updated = chatCategories.map(c => (c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c));
    const res = await saveChatCategoriesDbFirst(updated, `Updated chat category ${id}`, Boolean(options.forceOverwrite));
    if (res.success) {
      toast.success('Kategori chat diperbarui di database.');
    }
    return res;
  };

  const deleteChatCategory = async (
    id: string,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const target = chatCategories.find(c => c.id === id);
    if (!target) return { success: false, error: 'Kategori chat tidak ditemukan.' };
    const updated = chatCategories.filter(c => c.id !== id);
    const res = await saveChatCategoriesDbFirst(updated, `Deleted chat category ${target.name}`, Boolean(options.forceOverwrite));
    if (res.success) {
      toast.info(`Kategori chat "${target.name}" telah dihapus dari database.`);
    }
    return res;
  };

  const toggleChatCategoryActive = async (
    id: string,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const updated = chatCategories.map(c => (c.id === id ? { ...c, active: !c.active, updatedAt: new Date().toISOString() } : c));
    return saveChatCategoriesDbFirst(updated, `Toggled chat category ${id}`, Boolean(options.forceOverwrite));
  };

  const setTicketChatCategory = async (ticketId: string, category: string) => {
    const target = getTicketById(ticketId);
    if (!target) return;
    const now = new Date().toISOString();
    setTickets(prev =>
      prev.map(t => (t.id === ticketId ? { ...t, chatCategory: category, updatedAt: now } : t))
    );
    try {
      await supabaseDb.updateWorkOrder(target.id, { chatCategory: category, updatedAt: now });
      addAuditLog('Chat Category Assigned', 'ticket', ticketId, `Assigned category ${category} to WO ${target.woNumber}`);
    } catch (e) {
      console.warn('[Supabase] Error saving ticket chat category:', e);
    }
  };

  // -------------------------------------------------------------
  // Hierarchical Droplist Operations (DB-First Super Admin)
  // -------------------------------------------------------------
  const saveHierarchicalDroplistsDirect = async (
    updated: HierarchicalStatus[],
    actionLabel: string = 'Hierarchical droplists updated',
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    return saveAppConfigDbFirst(
      'hierarchical_droplists',
      { statuses: updated, updatedAt: new Date().toISOString(), updatedBy: currentUser.name },
      {
        module: 'hierarchical_droplists',
        description: actionLabel,
        forceOverwrite: Boolean(options.forceOverwrite),
        onSuccess: (saved) => {
          const list = Array.isArray(saved) ? saved : (saved as any)?.statuses || updated;
          setHierarchicalStatuses(list);
        },
        retryFactory: () => saveHierarchicalDroplistsDirect(updated, actionLabel, { forceOverwrite: true })
      }
    );
  };

  const addHierarchicalStatus = async (
    statusData: Omit<HierarchicalStatus, 'id' | 'reasons'>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const newStatus: HierarchicalStatus = {
      ...statusData,
      id: 'hs-' + Date.now(),
      reasons: []
    };
    const updated = [...hierarchicalStatuses, newStatus];
    const res = await saveHierarchicalDroplistsDirect(updated, `Created Status WO ${newStatus.name}`, options);
    if (res.success) toast.success(`Status WO "${newStatus.name}" berhasil disimpan ke database.`);
    return res;
  };

  const updateHierarchicalStatus = async (
    id: string,
    updates: Partial<HierarchicalStatus>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const updated = hierarchicalStatuses.map(s => (s.id === id ? { ...s, ...updates } : s));
    const res = await saveHierarchicalDroplistsDirect(updated, `Updated Status WO ${id}`, options);
    if (res.success) toast.success('Status WO diperbarui di database.');
    return res;
  };

  const deleteHierarchicalStatus = async (
    id: string,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const target = hierarchicalStatuses.find(s => s.id === id);
    if (!target) return { success: false, error: 'Status WO tidak ditemukan.' };
    const updated = hierarchicalStatuses.filter(s => s.id !== id);
    const res = await saveHierarchicalDroplistsDirect(updated, `Deleted Status WO ${target.name}`, options);
    if (res.success) toast.info(`Status WO "${target.name}" telah dihapus dari database.`);
    return res;
  };

  const addHierarchicalReason = async (
    statusId: string,
    reasonData: Omit<HierarchicalReason, 'id' | 'statusId' | 'remarks'>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const newReason: HierarchicalReason = {
      ...reasonData,
      id: 'hr-' + Date.now(),
      statusId,
      remarks: []
    };
    const updated = hierarchicalStatuses.map(s => {
      if (s.id !== statusId) return s;
      return { ...s, reasons: [...s.reasons, newReason] };
    });
    const res = await saveHierarchicalDroplistsDirect(updated, `Created Reason WO ${newReason.name}`, options);
    if (res.success) toast.success(`Reason WO "${newReason.name}" berhasil disimpan ke database.`);
    return res;
  };

  const updateHierarchicalReason = async (
    statusId: string,
    reasonId: string,
    updates: Partial<HierarchicalReason>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const updated = hierarchicalStatuses.map(s => {
      if (s.id !== statusId) return s;
      return {
        ...s,
        reasons: s.reasons.map(r => (r.id === reasonId ? { ...r, ...updates } : r))
      };
    });
    const res = await saveHierarchicalDroplistsDirect(updated, `Updated Reason WO ${reasonId}`, options);
    if (res.success) toast.success('Reason WO diperbarui di database.');
    return res;
  };

  const deleteHierarchicalReason = async (
    statusId: string,
    reasonId: string,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const updated = hierarchicalStatuses.map(s => {
      if (s.id !== statusId) return s;
      return { ...s, reasons: s.reasons.filter(r => r.id !== reasonId) };
    });
    const res = await saveHierarchicalDroplistsDirect(updated, `Deleted Reason WO ${reasonId}`, options);
    if (res.success) toast.info('Reason WO telah dihapus dari database.');
    return res;
  };

  const moveHierarchicalReason = async (
    fromStatusId: string,
    toStatusId: string,
    reasonId: string,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    let movedReason: HierarchicalReason | null = null;
    hierarchicalStatuses.forEach(s => {
      if (s.id === fromStatusId) {
        const found = s.reasons.find(r => r.id === reasonId);
        if (found) movedReason = { ...found, statusId: toStatusId };
      }
    });
    if (!movedReason) return { success: false, error: 'Reason WO tidak ditemukan.' };

    const updated = hierarchicalStatuses.map(s => {
      if (s.id === fromStatusId) {
        return { ...s, reasons: s.reasons.filter(r => r.id !== reasonId) };
      }
      if (s.id === toStatusId) {
        return { ...s, reasons: [...s.reasons, movedReason!] };
      }
      return s;
    });
    const res = await saveHierarchicalDroplistsDirect(updated, `Moved Reason WO ${reasonId}`, options);
    if (res.success) toast.success('Reason WO dipindahkan dan disimpan ke database.');
    return res;
  };

  const addHierarchicalRemark = async (
    statusId: string,
    reasonId: string,
    remarkData: Omit<HierarchicalRemark, 'id' | 'reasonId'>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const newRemark: HierarchicalRemark = {
      ...remarkData,
      id: 'hrm-' + Date.now(),
      reasonId
    };
    const updated = hierarchicalStatuses.map(s => {
      if (s.id !== statusId) return s;
      return {
        ...s,
        reasons: s.reasons.map(r => {
          if (r.id !== reasonId) return r;
          return { ...r, remarks: [...r.remarks, newRemark] };
        })
      };
    });
    const res = await saveHierarchicalDroplistsDirect(updated, `Created Remark ${newRemark.name}`, options);
    if (res.success) toast.success(`Remarks "${newRemark.name}" berhasil disimpan ke database.`);
    return res;
  };

  const updateHierarchicalRemark = async (
    statusId: string,
    reasonId: string,
    remarkId: string,
    updates: Partial<HierarchicalRemark>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const updated = hierarchicalStatuses.map(s => {
      if (s.id !== statusId) return s;
      return {
        ...s,
        reasons: s.reasons.map(r => {
          if (r.id !== reasonId) return r;
          return {
            ...r,
            remarks: r.remarks.map(rm => (rm.id === remarkId ? { ...rm, ...updates } : rm))
          };
        })
      };
    });
    const res = await saveHierarchicalDroplistsDirect(updated, `Updated Remark ${remarkId}`, options);
    if (res.success) toast.success('Remarks diperbarui di database.');
    return res;
  };

  const deleteHierarchicalRemark = async (
    statusId: string,
    reasonId: string,
    remarkId: string,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const updated = hierarchicalStatuses.map(s => {
      if (s.id !== statusId) return s;
      return {
        ...s,
        reasons: s.reasons.map(r => {
          if (r.id !== reasonId) return r;
          return {
            ...r,
            remarks: r.remarks.filter(rm => rm.id !== remarkId)
          };
        })
      };
    });
    const res = await saveHierarchicalDroplistsDirect(updated, `Deleted Remark ${remarkId}`, options);
    if (res.success) toast.info('Remarks telah dihapus dari database.');
    return res;
  };

  const getReasonsForStatus = (statusNameOrId: string): HierarchicalReason[] => {
    if (!statusNameOrId) return [];
    const norm = statusNameOrId.trim().toLowerCase();
    const matched = hierarchicalStatuses.find(
      s => s.id === statusNameOrId || s.name.trim().toLowerCase() === norm || (s.code && s.code.trim().toLowerCase() === norm)
    );
    if (!matched) return [];
    return (matched.reasons || []).filter(r => r.active !== false && (r as any).isActive !== false);
  };

  const getRemarksForReason = (statusNameOrId: string, reasonNameOrId: string): HierarchicalRemark[] => {
    if (!statusNameOrId || !reasonNameOrId) return [];
    const reasons = getReasonsForStatus(statusNameOrId);
    const normR = reasonNameOrId.trim().toLowerCase();
    const matchedR = reasons.find(r => r.id === reasonNameOrId || r.name.trim().toLowerCase() === normR);
    if (!matchedR) return [];
    return (matchedR.remarks || []).filter(rm => rm.active !== false && (rm as any).isActive !== false);
  };

  const reconcileDroplistsNow = async (
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; changedCount: number; message: string }> => {
    const authErr = assertSuperAdminConfigWrite('Rekonsiliasi Droplist');
    if (authErr) return { success: false, changedCount: 0, message: authErr };
    const { reconciled, changedCount } = reconcileDroplistData(hierarchicalStatuses, reportDropdownCategories);
    if (changedCount > 0) {
      const saveRes = await saveHierarchicalDroplistsDirect(
        reconciled,
        `Rekonsiliasi data droplist: ${changedCount} opsi diselaraskan`,
        options
      );
      if (!saveRes.success) {
        return { success: false, changedCount: 0, message: saveRes.error || 'Gagal rekonsiliasi droplist.' };
      }
      toast.success(`Rekonsiliasi selesai: ${changedCount} opsi lama berhasil diselaraskan ke hierarki Supabase PostgreSQL.`, 'Rekonsiliasi Berhasil');
      return { success: true, changedCount, message: `${changedCount} opsi berhasil direkonsiliasi ke struktur hierarki.` };
    }
    toast.info('Seluruh konfigurasi droplist sudah selaras dan tidak ada data yang tumpang tindih.', 'Data Terverifikasi');
    return { success: true, changedCount: 0, message: 'Seluruh konfigurasi sudah selaras dan terhubung.' };
  };


  const getWhatsAppPreviewForTicket = (ticketId: string, templateId?: string) => {
    const t = getTicketById(ticketId);
    if (!t) return { text: '', url: '', error: 'Tiket tidak ditemukan', missingVars: [] };
    const tpl = templateId ? templates.find(item => item.id === templateId) : (templates.find(item => item.isDefault) || templates[0]);
    if (!tpl) return { text: '', url: '', error: 'Tidak ada template aktif', missingVars: [] };

    const { renderedText, missingVariables } = renderWhatsAppMessage(tpl.messageBody, t);
    const { url, error } = buildWhatsAppClickToChatUrl(t.customerPhone, renderedText);

    return {
      text: renderedText,
      url,
      error,
      missingVars: missingVariables
    };
  };

  const recordWhatsAppOpened = (ticketId: string, url: string, messageBody: string) => {
    const t = getTicketById(ticketId);
    if (!t) return;

    const logEntry: WhatsAppMessageLog = {
      id: 'wlog_' + Date.now(),
      ticketId,
      woNumber: t.woNumber,
      customerName: t.customerName,
      customerPhone: t.customerPhone,
      messageBody,
      url,
      eventType: 'opened_in_whatsapp',
      performedBy: currentUser.name,
      userRole: currentUser.role,
      timestamp: new Date().toISOString()
    };

    setWaLogs(prev => [logEntry, ...prev]);

    updateTicket(ticketId, {
      statusWhatsApp: 'opened_in_whatsapp',
      waLastOpenedAt: new Date().toISOString(),
      waGeneratedUrl: url,
      waMessagePreview: messageBody
    }, 'WhatsApp URL opened in browser');

    addAuditLog('WhatsApp URL Opened', 'ticket', ticketId, `Opened WhatsApp chat link for ${t.customerName} (${t.customerPhone})`);
  };

  const recordWhatsAppConfirmed = (ticketId: string, notes: string) => {
    const t = getTicketById(ticketId);
    if (!t) return;

    updateTicket(ticketId, {
      statusWhatsApp: 'confirmed',
      waConfirmedAt: new Date().toISOString(),
      waConfirmedBy: currentUser.name,
      waConfirmationNotes: notes
    }, 'Customer confirmed schedule');

    const logEntry: WhatsAppMessageLog = {
      id: 'wlog_' + Date.now(),
      ticketId,
      woNumber: t.woNumber,
      customerName: t.customerName,
      customerPhone: t.customerPhone,
      messageBody: t.waMessagePreview || '',
      url: t.waGeneratedUrl || '',
      eventType: 'marked_confirmed',
      performedBy: currentUser.name,
      userRole: currentUser.role,
      notes,
      timestamp: new Date().toISOString()
    };

    setWaLogs(prev => [logEntry, ...prev]);
    addAuditLog('Customer Confirmed', 'ticket', ticketId, `Customer verified visit slot. Notes: ${notes}`);
  };

  const recordWhatsAppReschedule = (ticketId: string, notes: string) => {
    updateTicket(ticketId, {
      statusWhatsApp: 'reschedule_requested',
      waConfirmationNotes: notes
    }, 'Customer requested reschedule');

    addAuditLog('Reschedule Requested', 'ticket', ticketId, `Customer requested reschedule. Notes: ${notes}`);
  };

  const recordWhatsAppUnreachable = (ticketId: string, notes: string) => {
    updateTicket(ticketId, {
      statusWhatsApp: 'unreachable',
      waConfirmationNotes: notes
    }, 'Customer unreachable');

    addAuditLog('Customer Unreachable', 'ticket', ticketId, `Customer unreachable. Notes: ${notes}`);
  };

  const toggleWorkflowRule = async (
    ruleId: string,
    enabled: boolean,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const nextRules = workflowRules.map(r => (r.id === ruleId ? { ...r, enabled } : r));
    const res = await saveAppConfigDbFirst(
      'workflow_rules',
      { rules: nextRules, updatedAt: new Date().toISOString(), updatedBy: currentUser.name },
      {
        module: 'workflow_rules',
        description: `Workflow rule ${ruleId} set to ${enabled ? 'ACTIVE' : 'INACTIVE'}`,
        forceOverwrite: Boolean(options.forceOverwrite),
        onSuccess: (saved) => {
          const list = Array.isArray(saved) ? saved : (saved as any)?.rules || nextRules;
          setWorkflowRules(list);
          addAuditLog('Workflow Toggled', 'workflow', ruleId, `Workflow rule ${ruleId} set to ${enabled ? 'ACTIVE' : 'INACTIVE'}`);
        },
        retryFactory: () => toggleWorkflowRule(ruleId, enabled, { forceOverwrite: true })
      }
    );
    if (res.success) {
      toast.success(`Workflow rule ${enabled ? 'diaktifkan' : 'dinonaktifkan'} dan disimpan ke database.`);
    }
    return res;
  };

  const updateWorkflowRule = async (
    ruleId: string,
    updates: Partial<WorkflowRule>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const nextRules = workflowRules.map(r => (r.id === ruleId ? { ...r, ...updates } : r));
    const res = await saveAppConfigDbFirst(
      'workflow_rules',
      { rules: nextRules, updatedAt: new Date().toISOString(), updatedBy: currentUser.name },
      {
        module: 'workflow_rules',
        description: `Updated workflow ${ruleId}`,
        forceOverwrite: Boolean(options.forceOverwrite),
        onSuccess: (saved) => {
          const list = Array.isArray(saved) ? saved : (saved as any)?.rules || nextRules;
          setWorkflowRules(list);
          addAuditLog('Workflow Updated', 'workflow', ruleId, `Updated workflow ${ruleId}`);
        },
        retryFactory: () => updateWorkflowRule(ruleId, updates, { forceOverwrite: true })
      }
    );
    if (res.success) {
      toast.success('Workflow rule berhasil diperbarui di database.');
    }
    return res;
  };

  const updateHeaderMapping = async (
    field: string,
    aliases: string[],
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const nextMappings = headerMappings.map(m => (m.standardField === field ? { ...m, aliases } : m));
    const res = await saveAppConfigDbFirst(
      'header_mappings',
      { mappings: nextMappings, updatedAt: new Date().toISOString(), updatedBy: currentUser.name },
      {
        module: 'header_mappings',
        description: `Updated alias dictionary for ${field}`,
        forceOverwrite: Boolean(options.forceOverwrite),
        onSuccess: (saved) => {
          const list = Array.isArray(saved) ? saved : (saved as any)?.mappings || nextMappings;
          setHeaderMappings(list);
          addAuditLog('Header Mapping Updated', 'global_config', field, `Updated alias dictionary for ${field}`);
        },
        retryFactory: () => updateHeaderMapping(field, aliases, { forceOverwrite: true })
      }
    );
    if (res.success) {
      toast.success(`Mapping header "${field}" disimpan ke database.`);
    }
    return res;
  };

  const updateCanonicalFieldConfig = async (
    field: string,
    updates: Partial<CanonicalFieldConfig>,
    options: { forceOverwrite?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const nextFields = canonicalFields.map(f => (f.canonicalField === field ? { ...f, ...updates } : f));
    const res = await saveAppConfigDbFirst(
      'canonical_fields',
      { fields: nextFields, updatedAt: new Date().toISOString(), updatedBy: currentUser.name },
      {
        module: 'canonical_fields',
        description: `Updated canonical config for ${field}`,
        forceOverwrite: Boolean(options.forceOverwrite),
        onSuccess: (saved) => {
          const list = Array.isArray(saved) ? saved : (saved as any)?.fields || nextFields;
          setCanonicalFields(list);
          addAuditLog('Canonical Field Config Updated', 'global_config', field, `Updated canonical config for ${field}`);
        },
        retryFactory: () => updateCanonicalFieldConfig(field, updates, { forceOverwrite: true })
      }
    );
    if (res.success) {
      toast.success(`Canonical field "${field}" disimpan ke database.`);
    }
    return res;
  };

  // Dynamic Options
  const leadersList = Array.from(
    new Set([
      ...users.filter(u => u.role === 'leader').map(u => u.name),
      ...contractors.map(c => c.leaderName).filter(Boolean),
      ...tickets.map(t => t.leaderName).filter(Boolean)
    ])
  ) as string[];

  const installersList = Array.from(
    new Set([
      ...users.filter(u => u.role === 'installer').map(u => u.name),
      ...tickets.map(t => t.installerName).filter(Boolean)
    ])
  ) as string[];

  const contractorsList = Array.from(
    new Set([
      ...contractors.map(c => c.name),
      ...tickets.map(t => t.contactorName).filter(Boolean)
    ])
  ) as string[];

  const areasList = Array.from(
    new Set([
      ...coverageAreas.map(a => a.name),
      ...tickets.map(t => t.area).filter(Boolean)
    ])
  ) as string[];

  return (
    <AppContext.Provider
      value={{
        currentUser,
        isLoggedIn,
        login,
        logout,
        refreshAuthSession,
        users,
        hasPermission,
        rolePermissions,
        rolePermissionsVersion,
        updateRolePermissions,
        globalConflict,
        clearGlobalConflict,
        resolveGlobalConflict,
        canDelete,
        canImport,
        canEditWOData,
        operationalDate,
        todayWIB,
        setOperationalDate,
        isSessionModalOpen,
        setIsSessionModalOpen,
        isChangePasswordModalOpen,
        setIsChangePasswordModalOpen,
        registerDispatchAccount,
        registerLeaderAccount,
        registerInstallerAccount,
        toggleUserStatus,
        resetUserPassword,
        deleteUser,
        updateUser,
        executeComprehensiveDeduplication,
        contractors,
        addContractor,
        updateContractor,
        deleteContractor,
        autoRegisterContractors,
        coverageAreas,
        addCoverageArea,
        updateCoverageArea,
        deleteCoverageArea,
        rootCauseCategories,
        workResultsList,
        updateRootCauseCategories,
        saveTechnicalReport,
        saveProgressReport,
        uploadWoPhotoEvidence,
        deleteWoPhotoEvidence,
        submitKendalaReport,
        verifyTechnicalReport,
        startWorkOnTicket,
        approveProgressReport,
        rejectProgressReport,
        tickets,
        scopedTickets,
        activeTodayTickets,
        scopedActiveTickets,
        overdueTickets,
        exceptionTickets,
        overdueSummary,
        classificationSummary,
        refreshOverdueTickets,
        refreshActiveTickets,
        getTicketById,
        createTicket,
        updateTicket,
        assignTicketPersonnel,
        bulkAssignPersonnel,
        reassignTicketPersonnel,
        updateTicketStatus,
        reopenTicket,
        archiveTicket,
        restoreTicket,
        deleteTicket,
        bulkDeleteTickets,
        deleteCustomerData,
        bulkImportTickets,
        deleteImportedTicketsByDate,
        ticketMessages,
        totalLiveChatUnreadCount,
        liveChatUnreadTicketsCount,
        presenceByUserId,
        typingByTicketId,
        sendTicketMessage,
        retryTicketMessage,
        sendTypingIndicator,
        loadOlderTicketMessages,
        uploadChatAttachment,
        getMessagesForTicket,
        refreshMessagesForTicket,
        markTicketMessagesAsRead,
        getTicketUnreadCount,
        templates,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        getWhatsAppPreviewForTicket,
        recordWhatsAppOpened,
        recordWhatsAppConfirmed,
        recordWhatsAppReschedule,
        recordWhatsAppUnreachable,
        workflowRules,
        toggleWorkflowRule,
        updateWorkflowRule,
        headerMappings,
        updateHeaderMapping,
        canonicalFields,
        updateCanonicalFieldConfig,
        auditLogs,
        addAuditLog,
        ticketActivities,
        waLogs,
        googleSheetsConfig,
        updateGoogleSheetsConfig,
        syncGoogleSheetsNow,
        leadersList,
        installersList,
        contractorsList,
        areasList,
        toast,
        showToast,
        openOfflineSyncCenter: () => setIsOfflineModalOpen(true),
        isDataLoading,
        dataLoadError,
        loadCentralData,
        syncStage,
        isProgressiveHydrating,
        markTicketEditing,
        revalidateWoView,
        loadTicketDetailOnDemand,
        completeMandatoryPasswordChange,
        applyRotatedPasswordSession,
        databaseStatus,
        databaseLoading,
        isDatabaseReady,
        realtimeConnectionState: realtimeStatusInfo.state,
        realtimeStatusInfo,
        reconnectRealtimeNow,
        syncStatus,
        lastSyncTime,
        syncError,
        refreshDatabaseData,
        reportDropdownCategories,
        isDropdownCategoriesLoading,
        addReportDropdownCategory,
        updateReportDropdownCategory,
        deleteReportDropdownCategory,
        toggleReportDropdownCategoryActive,
        chatCategories,
        addChatCategory,
        updateChatCategory,
        deleteChatCategory,
        toggleChatCategoryActive,
        setTicketChatCategory,
        hierarchicalStatuses,
        saveHierarchicalDroplistsDirect,
        addHierarchicalStatus,
        updateHierarchicalStatus,
        deleteHierarchicalStatus,
        addHierarchicalReason,
        updateHierarchicalReason,
        deleteHierarchicalReason,
        moveHierarchicalReason,
        addHierarchicalRemark,
        updateHierarchicalRemark,
        deleteHierarchicalRemark,
        getReasonsForStatus,
        getRemarksForReason,
        reconcileDroplistsNow,
        kpiSummary,
        isKpiLoading,
        lastKpiUpdatedAt,
        kpiError,
        kpiContractorFilter,
        kpiAreaFilter,
        setKpiContractorFilter,
        setKpiAreaFilter,
        refreshKpiSummary,
        activeKpiDrilldown,
        setActiveKpiDrilldown
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
