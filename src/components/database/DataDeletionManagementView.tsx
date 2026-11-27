import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { ResponsiveModal } from '../common/ResponsiveModal';
import {
  DeletionCategory,
  DeletionSubEntity,
  DeletionMode,
  DeletionNavContext,
  CategoryCountsSummaryMap,
  DeletionItemRow,
  DeletionFacets,
  WoDependencySummary,
  DeletionLogRecord,
  PermanentDeleteOperationState,
  RecentPermanentAuditResponse,
  fetchDeletionCategoriesSummary,
  fetchDeletionFacets,
  fetchDeletionItems,
  inspectRecordDependencies,
  inspectBatchDependencies,
  executeCentralizedSoftDelete,
  executeCentralizedPermanentDeleteBatch,
  executeCentralizedRestore,
  fetchDeletionHistory,
  createClientOperationId,
  loadSavedPermanentDeleteOpId,
  clearSavedPermanentDeleteOpId,
  fetchPermanentDeleteOperationStatus,
  fetchActivePermanentDeleteOperations,
  resumeOrExecutePermanentDeleteOperation,
  fetchRecentPermanentDeleteAudit
} from '../../services/deletionManagementService';
import {
  DeletionHeaderFilters,
  DeletionHistoryHeaderFilters,
  DeletionSortState,
  countActiveDeletionFilters,
  countActiveHistoryFilters,
  createInitialDeletionFilters,
  createInitialHistoryFilters,
  cycleAppointmentDateSort,
  cycleCreatedAtSort,
  doesPermanentConfirmMatch,
  getDefaultDeletionStatusForTab,
  isRowSelectableForTab,
  reconcileSelectionWithVisibleRows,
  resolveExpectedPermanentConfirmText
} from '../../utils/deletionTableHelpers';
import {
  HeaderSearchPopover,
  HeaderCategoryDropdown,
  HeaderDateSortFilterPopover,
  CategoryOptionItem
} from './DeletionTableHeaderControls';
import {
  Trash2,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  History,
  RefreshCw,
  Eye,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
  Layers,
  Users2,
  MessageSquare,
  FileText,
  Paperclip,
  FileSpreadsheet,
  Database,
  FolderCog,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Clock,
  FileSearch,
  X
} from 'lucide-react';

type ActiveTabMode = DeletionMode | 'history';

interface CategoryMeta {
  id: DeletionCategory;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  superAdminOnly?: boolean;
  supportsSoftDelete: boolean;
  supportsPermanentDelete: boolean;
  supportsRestore: boolean;
}

const DELETION_CATEGORIES: CategoryMeta[] = [
  {
    id: 'work_orders',
    label: 'Work Orders (WO)',
    shortLabel: 'Work Orders',
    icon: Layers,
    superAdminOnly: false,
    supportsSoftDelete: true,
    supportsPermanentDelete: true,
    supportsRestore: true
  },
  {
    id: 'assignment_history',
    label: 'Assignment History',
    shortLabel: 'Assignment History',
    icon: Users2,
    superAdminOnly: true,
    supportsSoftDelete: true,
    supportsPermanentDelete: true,
    supportsRestore: true
  },
  {
    id: 'technical_reports',
    label: 'Technical Reports',
    shortLabel: 'Tech Reports',
    icon: FileText,
    superAdminOnly: true,
    supportsSoftDelete: true,
    supportsPermanentDelete: true,
    supportsRestore: true
  },
  {
    id: 'ticket_messages',
    label: 'Ticket Messages / LiveChat',
    shortLabel: 'LiveChat',
    icon: MessageSquare,
    superAdminOnly: true,
    supportsSoftDelete: true,
    supportsPermanentDelete: true,
    supportsRestore: true
  },
  {
    id: 'attachments',
    label: 'Attachments',
    shortLabel: 'Attachments',
    icon: Paperclip,
    superAdminOnly: true,
    supportsSoftDelete: true,
    supportsPermanentDelete: true,
    supportsRestore: true
  },
  {
    id: 'import_history',
    label: 'Import History',
    shortLabel: 'Import History',
    icon: FileSpreadsheet,
    superAdminOnly: true,
    supportsSoftDelete: true,
    supportsPermanentDelete: true,
    supportsRestore: true
  },
  {
    id: 'import_staging',
    label: 'Import Staging Data',
    shortLabel: 'Import Staging',
    icon: Database,
    superAdminOnly: true,
    supportsSoftDelete: false,
    supportsPermanentDelete: true,
    supportsRestore: false
  },
  {
    id: 'other_data',
    label: 'Data Lainnya (Users, Master, Config)',
    shortLabel: 'Data Lainnya',
    icon: FolderCog,
    superAdminOnly: true,
    supportsSoftDelete: true,
    supportsPermanentDelete: true,
    supportsRestore: true
  }
];

const SUB_ENTITY_OPTIONS: CategoryOptionItem[] = [
  { value: 'users', label: 'Akun Pengguna (Users)' },
  { value: 'contractors', label: 'Kontraktor / Vendor' },
  { value: 'coverage_areas', label: 'Coverage Area' },
  { value: 'wa_templates', label: 'Template WhatsApp' },
  { value: 'droplist_items', label: 'Item Droplist' },
  { value: 'chat_categories', label: 'Kategori LiveChat' }
];

const DELETION_STATUS_OPTIONS: CategoryOptionItem[] = [
  { value: 'active', label: 'Aktif' },
  { value: 'soft_deleted', label: 'Soft Deleted' },
  { value: 'all', label: 'Semua Status' }
];

interface DataDeletionManagementViewProps {
  initialContext?: DeletionNavContext | null;
}

export const DataDeletionManagementView: React.FC<DataDeletionManagementViewProps> = ({
  initialContext
}) => {
  const {
    currentUser,
    hasPermission,
    contractors,
    coverageAreas,
    refreshDatabaseData,
    refreshActiveTickets,
    refreshKpiSummary
  } = useApp();
  const { toast } = useToast();

  const isSuperAdmin = currentUser?.role === 'super_admin';
  const canDispatchDelete = currentUser?.role === 'dispatch' && hasPermission('delete_wo_data');
  const hasAccess = isSuperAdmin || canDispatchDelete;

  const visibleCategories = useMemo(
    () => DELETION_CATEGORIES.filter(c => isSuperAdmin || !c.superAdminOnly),
    [isSuperAdmin]
  );

  const [activeTab, setActiveTab] = useState<ActiveTabMode>(() => {
    if (initialContext?.mode && (isSuperAdmin || initialContext.mode === 'soft_delete')) {
      return initialContext.mode;
    }
    return 'soft_delete';
  });
  const [selectedCategory, setSelectedCategory] = useState<DeletionCategory>(() => {
    const reqCat = initialContext?.category || 'work_orders';
    if (!isSuperAdmin && reqCat !== 'work_orders') return 'work_orders';
    return reqCat;
  });

  const operationalMode: DeletionMode = activeTab === 'history' ? 'soft_delete' : activeTab;

  // Header-embedded filter & sort state (zero external filter panels)
  const [filters, setFilters] = useState<DeletionHeaderFilters>(() => ({
    ...createInitialDeletionFilters(
      initialContext?.mode && (isSuperAdmin || initialContext.mode === 'soft_delete')
        ? initialContext.mode
        : 'soft_delete',
      initialContext?.search || ''
    ),
    subEntity: initialContext?.subEntity || 'all'
  }));
  const [debouncedFilters, setDebouncedFilters] = useState<DeletionHeaderFilters>(filters);
  const [sortState, setSortState] = useState<DeletionSortState>({ by: 'default', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // History header-embedded filters
  const [historyFilters, setHistoryFilters] = useState<DeletionHistoryHeaderFilters>(() =>
    createInitialHistoryFilters()
  );
  const [debouncedHistoryFilters, setDebouncedHistoryFilters] = useState<DeletionHistoryHeaderFilters>(historyFilters);
  const [historyPage, setHistoryPage] = useState(1);

  // Data state
  const [summary, setSummary] = useState<CategoryCountsSummaryMap | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [facets, setFacets] = useState<DeletionFacets>({
    contractors: [],
    areas: [],
    assignmentStatuses: ['Assigned', 'Unassigned']
  });
  const [facetsError, setFacetsError] = useState<string | null>(null);
  const [items, setItems] = useState<DeletionItemRow[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // History data state
  const [historyLogs, setHistoryLogs] = useState<DeletionLogRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Detail & Action Confirmation Modals
  const [detailItem, setDetailItem] = useState<DeletionItemRow | null>(null);
  const [detailDeps, setDetailDeps] = useState<WoDependencySummary | null>(null);
  const [detailDepsError, setDetailDepsError] = useState<string | null>(null);
  const [isLoadingDetailDeps, setIsLoadingDetailDeps] = useState(false);

  const [actionModal, setActionModal] = useState<{
    open: boolean;
    mode: DeletionMode;
    targets: DeletionItemRow[];
  }>({ open: false, mode: 'soft_delete', targets: [] });
  const [actionReason, setActionReason] = useState('');
  const [permanentConfirmText, setPermanentConfirmText] = useState('');
  const [actionBatchDeps, setActionBatchDeps] = useState<{
    items: WoDependencySummary[];
    blockedCount: number;
    eligibleCount: number;
  } | null>(null);
  const [isLoadingActionDeps, setIsLoadingActionDeps] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionProgressText, setActionProgressText] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Tracked Permanent Delete Operation state (chunked progress, timeout/refresh recovery, per-WO report)
  const [permOperationId, setPermOperationId] = useState<string | null>(null);
  const [activePermOp, setActivePermOp] = useState<PermanentDeleteOperationState | null>(null);
  const [permOpNeedsResume, setPermOpNeedsResume] = useState(false);
  const [isRecoveredNotice, setIsRecoveredNotice] = useState(false);

  // Read-only recent permanent delete audit panel (Superadmin only)
  const [recentAuditOpen, setRecentAuditOpen] = useState(false);
  const [recentAuditData, setRecentAuditData] = useState<RecentPermanentAuditResponse | null>(null);
  const [isLoadingRecentAudit, setIsLoadingRecentAudit] = useState(false);

  const itemsReqSeq = useRef(0);
  const isSubmittingRef = useRef(false);
  const didAttemptMountRecoveryRef = useRef(false);

  // Sync deep-link context when triggered externally
  useEffect(() => {
    if (!initialContext) return;
    if (initialContext.category && (isSuperAdmin || initialContext.category === 'work_orders')) {
      setSelectedCategory(initialContext.category);
    }
    const nextMode: DeletionMode =
      initialContext.mode && (isSuperAdmin || initialContext.mode === 'soft_delete')
        ? initialContext.mode
        : 'soft_delete';
    if (initialContext.mode) {
      setActiveTab(nextMode);
    }
    setFilters(prev => ({
      ...prev,
      subEntity: initialContext.subEntity || prev.subEntity,
      woNumber: typeof initialContext.search === 'string' ? initialContext.search : prev.woNumber,
      deletionStatus: getDefaultDeletionStatusForTab(nextMode)
    }));
    setPage(1);
    setSelectedIds([]);
  }, [initialContext, isSuperAdmin]);

  // Ensure import_staging switches away from unsupported soft_delete/restore tab
  useEffect(() => {
    if (selectedCategory === 'import_staging' && (activeTab === 'soft_delete' || activeTab === 'restore')) {
      setActiveTab('permanent_delete');
    }
  }, [selectedCategory, activeTab]);

  // Debounce operational table header filters (250ms for text inputs)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedFilters(filters);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters]);

  // Debounce history table header filters (250ms)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedHistoryFilters(historyFilters);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [historyFilters]);

  const updateFilter = useCallback(<K extends keyof DeletionHeaderFilters>(key: K, val: DeletionHeaderFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: val }));
    setPage(1);
  }, []);

  const updateHistoryFilter = useCallback(
    <K extends keyof DeletionHistoryHeaderFilters>(key: K, val: DeletionHistoryHeaderFilters[K]) => {
      setHistoryFilters(prev => ({ ...prev, [key]: val }));
      setHistoryPage(1);
    },
    []
  );

  const handleTabChange = (nextTab: ActiveTabMode) => {
    setActiveTab(nextTab);
    if (nextTab !== 'history') {
      setFilters(prev => ({
        ...prev,
        deletionStatus: getDefaultDeletionStatusForTab(nextTab)
      }));
    }
    setSelectedIds([]);
    setPage(1);
    setHistoryPage(1);
  };

  const handleResetAllFilters = () => {
    const nextFilters = createInitialDeletionFilters(operationalMode);
    setFilters(nextFilters);
    setDebouncedFilters(nextFilters);
    setSortState({ by: 'default', dir: 'desc' });
    setPage(1);
    setSelectedIds([]);
  };

  const handleResetHistoryFilters = () => {
    const next = createInitialHistoryFilters();
    setHistoryFilters(next);
    setDebouncedHistoryFilters(next);
    setHistoryPage(1);
  };

  const loadSummary = useCallback(async () => {
    if (!hasAccess) return;
    setSummaryError(null);
    try {
      const res = await fetchDeletionCategoriesSummary();
      if (res.success && res.summary) {
        setSummary(res.summary);
      } else {
        setSummaryError(res.error || 'Gagal memuat ringkasan kategori dari server.');
      }
    } catch (err: any) {
      setSummaryError(err?.message || 'Gagal menghubungi server untuk ringkasan kategori.');
    }
  }, [hasAccess]);

  const loadFacets = useCallback(async () => {
    if (!hasAccess || selectedCategory !== 'work_orders') {
      setFacetsError(null);
      return;
    }
    setFacetsError(null);
    try {
      const res = await fetchDeletionFacets('work_orders');
      if (res.success && res.facets) {
        setFacets(res.facets);
      } else {
        setFacetsError(res.error || 'Gagal memuat opsi filter dropdown.');
      }
    } catch (err: any) {
      setFacetsError(err?.message || 'Gagal menghubungi server untuk opsi filter.');
    }
  }, [hasAccess, selectedCategory]);

  const loadItems = useCallback(async () => {
    if (!hasAccess || activeTab === 'history') return;
    const seq = ++itemsReqSeq.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetchDeletionItems({
        category: selectedCategory,
        subEntity: selectedCategory === 'other_data' ? debouncedFilters.subEntity : undefined,
        mode: activeTab,
        woNumber: debouncedFilters.woNumber,
        customerId: debouncedFilters.customerId,
        customerName: debouncedFilters.customerName,
        contractor: debouncedFilters.contractor,
        area: debouncedFilters.area,
        assignmentStatus: debouncedFilters.assignmentStatus,
        appointmentDate: debouncedFilters.appointmentDate,
        appointmentDateFrom: debouncedFilters.appointmentDateFrom,
        appointmentDateTo: debouncedFilters.appointmentDateTo,
        recordIdQuery: debouncedFilters.recordIdQuery,
        summaryQuery: debouncedFilters.summaryQuery,
        actorQuery: debouncedFilters.actorQuery,
        deletionStatus: debouncedFilters.deletionStatus,
        sortBy: sortState.by,
        sortDir: sortState.dir,
        page,
        pageSize
      });
      if (seq !== itemsReqSeq.current) return;
      if (!res.success) {
        setLoadError(res.error || 'Gagal memuat daftar data.');
        setItems([]);
        setTotalItems(0);
        setTotalPages(1);
        setSelectedIds([]);
      } else {
        const nextItems = res.items || [];
        setItems(nextItems);
        setTotalItems(res.total || 0);
        setTotalPages(res.totalPages || 1);
        if (res.page && res.page !== page) {
          setPage(res.page);
        }
        // Reconcile selection so rows hidden by filters/page can never stay selected
        setSelectedIds(prev => reconcileSelectionWithVisibleRows(prev, nextItems, activeTab, isSuperAdmin));
      }
    } catch (err: any) {
      if (seq !== itemsReqSeq.current) return;
      setLoadError(err?.message || 'Gagal menghubungi server.');
    } finally {
      if (seq === itemsReqSeq.current) {
        setIsLoading(false);
      }
    }
  }, [hasAccess, activeTab, selectedCategory, debouncedFilters, sortState, page, pageSize, isSuperAdmin]);

  const loadHistory = useCallback(async () => {
    if (!hasAccess || activeTab !== 'history') return;
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetchDeletionHistory({
        txIdQuery: debouncedHistoryFilters.txIdQuery,
        woOrRecordQuery: debouncedHistoryFilters.woOrRecordQuery,
        actor: debouncedHistoryFilters.actor || 'all',
        reasonQuery: debouncedHistoryFilters.reasonQuery,
        category: debouncedHistoryFilters.category,
        deletionType: debouncedHistoryFilters.deletionType,
        status: debouncedHistoryFilters.status,
        dateFrom: debouncedHistoryFilters.dateFrom,
        dateTo: debouncedHistoryFilters.dateTo,
        sortDir: debouncedHistoryFilters.sortDir,
        page: historyPage,
        pageSize: 25
      });
      if (res.success) {
        setHistoryLogs(res.logs || []);
        setHistoryTotal(res.total || 0);
        setHistoryTotalPages(res.totalPages || 1);
      } else {
        const errMsg = res.error || 'Gagal memuat Deletion History.';
        setHistoryError(errMsg);
        setHistoryLogs([]);
        setHistoryTotal(0);
        setHistoryTotalPages(1);
        toast.error(errMsg);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Gagal menghubungi server untuk Deletion History.';
      setHistoryError(errMsg);
      toast.error(errMsg);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [hasAccess, activeTab, debouncedHistoryFilters, historyPage, toast]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    if (activeTab === 'history') {
      void loadHistory();
    } else {
      void loadItems();
    }
  }, [activeTab, loadItems, loadHistory]);

  // Merged category dropdown options from real DB facets + AppContext master data
  const contractorOptions: CategoryOptionItem[] = useMemo(() => {
    const set = new Set<string>(facets.contractors || []);
    for (const c of contractors || []) {
      const n = String(c?.name || '').trim();
      if (n) set.add(n);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ value: name, label: name }));
  }, [facets.contractors, contractors]);

  const areaOptions: CategoryOptionItem[] = useMemo(() => {
    const set = new Set<string>(facets.areas || []);
    for (const a of coverageAreas || []) {
      const n = String(a?.name || '').trim();
      if (n) set.add(n);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ value: name, label: name }));
  }, [facets.areas, coverageAreas]);

  const assignmentStatusOptions: CategoryOptionItem[] = useMemo(() => {
    const set = new Set<string>(facets.assignmentStatuses || ['Assigned', 'Unassigned']);
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map(s => ({ value: s, label: s }));
  }, [facets.assignmentStatuses]);

  const applyCompletedPermOpSideEffects = useCallback(
    async (op: PermanentDeleteOperationState, recoveredFromTimeout?: boolean) => {
      const doneSuccess = op.succeededCount + op.alreadyDeletedCount;
      const doneIssues = op.blockedCount + op.failedCount;
      if (recoveredFromTimeout) {
        setIsRecoveredNotice(true);
      }
      if (doneIssues === 0 && doneSuccess > 0) {
        toast.success(
          op.alreadyDeletedCount > 0
            ? `Selesai: ${op.succeededCount} dihapus permanen, ${op.alreadyDeletedCount} sudah terhapus sebelumnya.`
            : `Berhasil menghapus permanen ${op.succeededCount} data.`,
          'Hapus Permanen Berhasil'
        );
      } else if (doneSuccess > 0 && doneIssues > 0) {
        toast.warning(
          `Selesai sebagian: ${doneSuccess} selesai, ${op.blockedCount} diblokir FK/proteksi, ${op.failedCount} gagal.`,
          'Hapus Permanen Parsial'
        );
      } else if (doneIssues > 0) {
        toast.error(
          `Hapus permanen selesai dengan ${doneIssues} kegagalan/penolakan.`,
          'Hapus Permanen Ditolak'
        );
      }

      setSelectedIds([]);
      await Promise.all([loadSummary(), loadItems()]);
      await Promise.allSettled([
        refreshDatabaseData(),
        refreshActiveTickets(),
        refreshKpiSummary({ silent: true })
      ]);
    },
    [toast, loadSummary, loadItems, refreshDatabaseData, refreshActiveTickets, refreshKpiSummary]
  );

  // Refresh recovery: if Superadmin reloads mid-operation or after timeout, check server operation status
  useEffect(() => {
    if (!isSuperAdmin || didAttemptMountRecoveryRef.current) return;
    didAttemptMountRecoveryRef.current = true;

    let cancelled = false;
    const recoverActiveOp = async () => {
      let savedOpId = loadSavedPermanentDeleteOpId();
      let foundOp: PermanentDeleteOperationState | undefined;

      if (savedOpId) {
        try {
          const res = await fetchPermanentDeleteOperationStatus(savedOpId);
          if (res.success && res.operation) {
            foundOp = res.operation;
          } else {
            clearSavedPermanentDeleteOpId();
            savedOpId = null;
          }
        } catch {
          // Keep saved ID if transient error
        }
      }

      if (!foundOp && !savedOpId) {
        try {
          const activeList = await fetchActivePermanentDeleteOperations();
          if (activeList.success && activeList.operations.length > 0) {
            foundOp = activeList.operations[0];
          }
        } catch {
          // Ignore silent check failure
        }
      }

      if (cancelled || !foundOp) return;

      const reconstructedTargets: DeletionItemRow[] = (foundOp.targets || []).map(t => ({
        id: t.recordId,
        category: t.category,
        subEntity: t.subEntity,
        woNumber: t.woNumber,
        label: t.label,
        isDeleted: false,
        deletionStatus: 'ACTIVE'
      }));

      setActiveTab('permanent_delete');
      setActionModal({ open: true, mode: 'permanent_delete', targets: reconstructedTargets });
      setActionReason(foundOp.reason || '');
      setPermOperationId(foundOp.operationId);
      setActivePermOp(foundOp);
      setActionError(null);

      const isInFlight =
        foundOp.status === 'preparing' || foundOp.status === 'verifying' || foundOp.status === 'processing';

      if (!isInFlight) {
        setActionProgressText(foundOp.stageLabel);
        return;
      }

      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmittingAction(true);
      setPermOpNeedsResume(false);
      setActionProgressText(
        `Memulihkan pemantauan setelah refresh: ${foundOp.processedCount} dari ${foundOp.totalCount} data diproses...`
      );

      try {
        const res = await resumeOrExecutePermanentDeleteOperation({
          operationId: foundOp.operationId,
          existingOperation: foundOp,
          chunkSize: 5,
          onProgress: (op, stageText) => {
            if (!cancelled) {
              setActivePermOp(op);
              setActionProgressText(stageText);
            }
          }
        });
        if (cancelled) return;
        if (res.operation) {
          setActivePermOp(res.operation);
        }
        if (res.needsResume) {
          setPermOpNeedsResume(true);
          setActionError(res.error || 'Koneksi terputus saat melanjutkan operasi.');
          await Promise.all([loadSummary(), loadItems()]);
          return;
        }
        if (res.completed && res.operation) {
          clearSavedPermanentDeleteOpId();
          await applyCompletedPermOpSideEffects(res.operation, true);
        }
      } finally {
        if (!cancelled) {
          setIsSubmittingAction(false);
          setActionProgressText(null);
        }
        isSubmittingRef.current = false;
      }
    };

    void recoverActiveOp();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, applyCompletedPermOpSideEffects, loadSummary, loadItems]);

  const handleLoadRecentPermanentAudit = async (forceReload = false) => {
    if (!isSuperAdmin) return;
    if (recentAuditOpen && !forceReload) {
      setRecentAuditOpen(false);
      return;
    }
    setRecentAuditOpen(true);
    setIsLoadingRecentAudit(true);
    try {
      const res = await fetchRecentPermanentDeleteAudit(60);
      setRecentAuditData(res);
      if (!res.success && res.error) {
        toast.error(res.error);
      }
    } finally {
      setIsLoadingRecentAudit(false);
    }
  };

  const handleOpenDetail = async (row: DeletionItemRow) => {
    setDetailItem(row);
    setDetailDeps(null);
    setDetailDepsError(null);
    if (row.category === 'work_orders') {
      setIsLoadingDetailDeps(true);
      try {
        const res = await inspectRecordDependencies('work_orders', row.id);
        if (res.success && res.dependencies) {
          setDetailDeps(res.dependencies);
        } else {
          setDetailDepsError(res.error || 'Gagal memeriksa dependensi Work Order dari server.');
        }
      } catch (err: any) {
        setDetailDepsError(err?.message || 'Gagal menghubungi server saat memeriksa dependensi.');
      } finally {
        setIsLoadingDetailDeps(false);
      }
    }
  };

  const handleOpenActionModal = async (mode: DeletionMode, targets: DeletionItemRow[]) => {
    if (targets.length === 0) return;
    if ((mode === 'permanent_delete' || mode === 'restore') && !isSuperAdmin) return;

    setActionModal({ open: true, mode, targets });
    setActionReason(mode === 'restore' ? 'Pemulihan data melalui Data Deletion Management' : '');
    setPermanentConfirmText('');
    setActionError(null);
    setActionProgressText(null);
    setActionBatchDeps(null);
    setActivePermOp(null);
    setPermOpNeedsResume(false);
    setIsRecoveredNotice(false);
    setPermOperationId(mode === 'permanent_delete' ? createClientOperationId() : null);

    if (targets[0].category === 'work_orders') {
      setIsLoadingActionDeps(true);
      try {
        if (targets.length === 1) {
          const res = await inspectRecordDependencies('work_orders', targets[0].id);
          if (res.success && res.dependencies) {
            setActionBatchDeps({
              items: [res.dependencies],
              blockedCount: res.dependencies.canPermanentDelete ? 0 : 1,
              eligibleCount: res.dependencies.canPermanentDelete ? 1 : 0
            });
          } else if (res.error) {
            setActionError(res.error);
          }
        } else {
          const res = await inspectBatchDependencies(
            'work_orders',
            targets.map(t => t.id)
          );
          if (res.success) {
            setActionBatchDeps({
              items: res.items,
              blockedCount: res.blockedCount,
              eligibleCount: res.eligibleCount
            });
          } else if (res.error) {
            setActionError(res.error);
          }
        }
      } finally {
        setIsLoadingActionDeps(false);
      }
    }
  };

  const handleCloseActionModal = () => {
    if (isSubmittingAction) return;
    const opStatus = activePermOp?.status;
    if (opStatus === 'completed' || opStatus === 'partial' || opStatus === 'failed') {
      clearSavedPermanentDeleteOpId();
    }
    setActionModal({ open: false, mode: 'soft_delete', targets: [] });
    setActivePermOp(null);
    setPermOpNeedsResume(false);
    setIsRecoveredNotice(false);
    setPermOperationId(null);
    setActionError(null);
    setActionProgressText(null);
  };

  const handleExcludeBlockedFromModal = () => {
    if (!actionBatchDeps) return;
    const eligibleIds = new Set(actionBatchDeps.items.filter(d => d.found && d.canPermanentDelete).map(d => d.id));
    const nextTargets = actionModal.targets.filter(t => eligibleIds.has(t.id));
    const nextDeps = actionBatchDeps.items.filter(d => eligibleIds.has(d.id));
    setActionModal(prev => ({ ...prev, targets: nextTargets }));
    setActionBatchDeps({
      items: nextDeps,
      blockedCount: 0,
      eligibleCount: nextDeps.length
    });
    setPermanentConfirmText('');
    setActionError(null);
  };

  const handleResumePermanentOperation = async () => {
    if (!activePermOp || isSubmittingRef.current || isSubmittingAction) return;
    isSubmittingRef.current = true;
    setIsSubmittingAction(true);
    setActionError(null);
    setPermOpNeedsResume(false);
    setActionProgressText('Memeriksa status transaksi di server & melanjutkan sisa data...');

    try {
      const res = await resumeOrExecutePermanentDeleteOperation({
        operationId: activePermOp.operationId,
        existingOperation: activePermOp,
        chunkSize: 5,
        onProgress: (op, stageText) => {
          setActivePermOp(op);
          setActionProgressText(stageText);
        }
      });
      if (res.operation) {
        setActivePermOp(res.operation);
      }
      if (res.needsResume) {
        setPermOpNeedsResume(true);
        setActionError(res.error || 'Koneksi terputus saat melanjutkan operasi.');
        await Promise.all([loadSummary(), loadItems()]);
        return;
      }
      if (res.completed && res.operation) {
        clearSavedPermanentDeleteOpId();
        await applyCompletedPermOpSideEffects(res.operation, true);
      } else if (res.error) {
        setActionError(res.error);
      }
    } catch (err: any) {
      setPermOpNeedsResume(true);
      setActionError(err?.message || 'Gagal menghubungi server.');
    } finally {
      setIsSubmittingAction(false);
      setActionProgressText(null);
      isSubmittingRef.current = false;
    }
  };

  const handleConfirmAction = async () => {
    if (isSubmittingRef.current || isSubmittingAction) return;
    const { mode, targets } = actionModal;
    if (targets.length === 0) return;

    const cleanReason = actionReason.trim();
    if (mode !== 'restore' && cleanReason.length < 5) {
      setActionError('Alasan wajib diisi minimal 5 karakter.');
      return;
    }

    if (mode === 'permanent_delete') {
      if (!isSuperAdmin) {
        setActionError('Akses Ditolak: Hapus permanen hanya untuk Superadmin.');
        return;
      }
      if (actionBatchDeps && actionBatchDeps.blockedCount > 0) {
        setActionError('Terdapat record dengan relasi historis aktif (Zero-Cascade). Keluarkan item terblokir atau gunakan Soft Delete.');
        return;
      }
      const expectedText = resolveExpectedPermanentConfirmText(targets);
      if (!doesPermanentConfirmMatch(targets, permanentConfirmText)) {
        setActionError(`Konfirmasi teks tidak cocok. Harap ketik persis "${expectedText}".`);
        return;
      }
    }

    isSubmittingRef.current = true;
    setIsSubmittingAction(true);
    setActionError(null);
    setPermOpNeedsResume(false);
    setIsRecoveredNotice(false);
    setActionProgressText(
      mode === 'permanent_delete'
        ? `Menyiapkan penghapusan & memverifikasi dependensi ${targets.length} data...`
        : mode === 'restore'
        ? `Memulihkan ${targets.length} data...`
        : `Memproses soft delete ${targets.length} data...`
    );

    try {
      if (mode === 'soft_delete') {
        const res = await executeCentralizedSoftDelete({
          targets: targets.map(t => ({
            category: t.category,
            recordId: t.id,
            subEntity: t.subEntity
          })),
          reason: cleanReason
        });
        if (!res.success && (!res.succeeded || res.succeeded.length === 0)) {
          setActionError(res.error || 'Gagal menjalankan soft delete.');
          return;
        }
        if (res.failed && res.failed.length > 0) {
          toast.warning(
            `Soft delete selesai parsial: ${res.succeeded?.length || 0} berhasil, ${res.failed.length} gagal (${res.failed[0].error}).`,
            'Soft Delete Parsial'
          );
        } else {
          toast.success(
            res.message || `Berhasil melakukan soft delete pada ${targets.length} data.`,
            'Soft Delete Berhasil'
          );
        }
      } else if (mode === 'permanent_delete') {
        const opId = permOperationId || createClientOperationId();
        if (!permOperationId) setPermOperationId(opId);

        const res = await executeCentralizedPermanentDeleteBatch({
          targets: targets.map(t => ({
            category: t.category,
            recordId: t.id,
            subEntity: t.subEntity,
            woNumber: t.woNumber,
            label: t.label
          })),
          confirmText: permanentConfirmText.trim(),
          reason: cleanReason,
          operationId: opId,
          onProgress: (op, stageText) => {
            setActivePermOp(op);
            setActionProgressText(stageText);
          }
        });

        if (res.operation) {
          setActivePermOp(res.operation);
        }

        if (res.needsResume) {
          setPermOpNeedsResume(true);
          setActionError(
            res.error ||
              'Koneksi ke server terputus. Klik "Cek Status & Lanjutkan" untuk melanjutkan sisa data tanpa menghapus ulang data yang sudah selesai.'
          );
          await Promise.all([loadSummary(), loadItems()]);
          return;
        }

        if (!res.operation && !res.success) {
          setActionError(res.error || 'Hapus permanen ditolak oleh server.');
          return;
        }

        if (res.operation) {
          await applyCompletedPermOpSideEffects(res.operation, res.recoveredFromTimeout);
          return;
        }
      } else if (mode === 'restore') {
        const res = await executeCentralizedRestore({
          targets: targets.map(t => ({
            category: t.category,
            recordId: t.id,
            subEntity: t.subEntity
          })),
          reason: cleanReason || undefined
        });
        if (!res.success && (!res.succeeded || res.succeeded.length === 0)) {
          setActionError(res.error || 'Gagal memulihkan data.');
          return;
        }
        if (res.failed && res.failed.length > 0) {
          toast.warning(
            `Restore parsial: ${res.succeeded?.length || 0} berhasil, ${res.failed.length} gagal (${res.failed[0].error}).`,
            'Restore Parsial'
          );
        } else {
          toast.success(
            res.message || `Berhasil memulihkan ${targets.length} data ke status aktif.`,
            'Restore Berhasil'
          );
        }
      }

      setActionModal({ open: false, mode: 'soft_delete', targets: [] });
      setSelectedIds([]);
      await Promise.all([loadSummary(), loadItems()]);
      await Promise.allSettled([
        refreshDatabaseData(),
        refreshActiveTickets(),
        refreshKpiSummary({ silent: true })
      ]);
    } catch (err: any) {
      setActionError(err?.message || 'Terjadi kesalahan saat memproses permintaan.');
    } finally {
      setIsSubmittingAction(false);
      setActionProgressText(null);
      isSubmittingRef.current = false;
    }
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const selectableItems = useMemo(
    () => items.filter(item => isRowSelectableForTab(item, operationalMode, isSuperAdmin)),
    [items, operationalMode, isSuperAdmin]
  );

  const allSelectableChecked =
    selectableItems.length > 0 && selectableItems.every(item => selectedIds.includes(item.id));

  const toggleSelectAll = () => {
    if (allSelectableChecked) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableItems.map(i => i.id));
    }
  };

  const selectedRows = useMemo(
    () => items.filter(i => selectedIds.includes(i.id)),
    [items, selectedIds]
  );

  const activeFilterCount = useMemo(
    () => countActiveDeletionFilters(filters, sortState, operationalMode),
    [filters, sortState, operationalMode]
  );

  const activeHistoryFilterCount = useMemo(
    () => countActiveHistoryFilters(historyFilters),
    [historyFilters]
  );

  if (!hasAccess) {
    return (
      <div className="card-3d-lavender p-8 rounded-2xl max-w-xl mx-auto my-8 text-center space-y-3 border border-rose-300 dark:border-rose-800">
        <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-base font-extrabold text-[#26364A] dark:text-white">
          Akses Ditolak: Database Deletion Management
        </h2>
        <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
          Pusat penghapusan dan pemulihan data dibatasi khusus untuk <strong>Superadmin</strong> (atau Dispatch dengan izin eksplisit).
          Role Anda saat ini (<strong>{currentUser?.role}</strong>) tidak memiliki otoritas penghapusan database.
        </p>
      </div>
    );
  }

  const activeCategoryMeta = DELETION_CATEGORIES.find(c => c.id === selectedCategory) || DELETION_CATEGORIES[0];

  const renderStatusBadge = (row: DeletionItemRow) => {
    if (row.isProtected) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <Lock className="w-3 h-3" /> PROTECTED
        </span>
      );
    }
    if (row.isLockedActive || row.deletionStatus === 'LOCKED_ACTIVE') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
          <Lock className="w-3 h-3" /> ACTIVE LOCK
        </span>
      );
    }
    if (row.isDeleted) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
          SOFT DELETED
        </span>
      );
    }
    if (row.isArchived) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          ARCHIVED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        ACTIVE
      </span>
    );
  };

  const singleActionDeps = actionBatchDeps?.items.length === 1 ? actionBatchDeps.items[0] : null;
  const expectedPermanentPhrase = resolveExpectedPermanentConfirmText(actionModal.targets);

  return (
    <div className="space-y-4" data-testid="data-deletion-management-view">
      {/* Compact Header Banner */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-[#F3F8FC] via-[#EAE8FF] to-[#D8F0F0] border border-[#C5BEEF] text-[#26394E] shadow-md dark:from-[#160D29] dark:via-[#27104A] dark:to-[#1A0D36] dark:border-[#4A2580] dark:text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/85 border border-[#C5BEEF] text-[#5145A6] dark:bg-[#35105E] dark:border-[#7135B5]/60 dark:text-[#E8DDFF] text-[10.5px] font-extrabold uppercase tracking-wider mb-1.5">
            <Trash2 className="w-3.5 h-3.5" />
            <span>Database Application · Data Deletion</span>
          </div>
          <h2 className="text-lg sm:text-xl font-display font-black tracking-tight text-[#26394E] dark:text-white">
            Database Deletion Management
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              void loadSummary();
              void loadFacets();
              if (activeTab === 'history') void loadHistory();
              else void loadItems();
            }}
            disabled={isLoading || isLoadingHistory}
            className="btn-3d-lilac px-3.5 py-2 min-h-[36px] rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isLoadingHistory ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <span className="px-3 py-1.5 rounded-xl bg-white/90 border border-[#C5BEEF] text-[#5145A6] dark:bg-[#35105E] dark:border-[#7135B5]/60 dark:text-[#E8DDFF] text-xs font-bold flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>{isSuperAdmin ? 'Superadmin' : 'Dispatch (WO Soft Delete)'}</span>
          </span>
        </div>
      </div>

      {/* 4 Main Operational Tabs */}
      <div className="mj-tactile-tab-bar p-1.5 rounded-2xl flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="tablist">
        {[
          { id: 'soft_delete' as ActiveTabMode, label: 'Soft Delete', icon: Trash2, visible: true },
          { id: 'permanent_delete' as ActiveTabMode, label: 'Permanent Delete', icon: ShieldAlert, visible: isSuperAdmin },
          { id: 'restore' as ActiveTabMode, label: 'Restore', icon: RotateCcw, visible: isSuperAdmin },
          { id: 'history' as ActiveTabMode, label: 'Deletion History', icon: History, visible: true }
        ]
          .filter(t => t.visible)
          .map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`deletion-tab-${tab.id}`}
                onClick={() => handleTabChange(tab.id)}
                className={`px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
                  isActive
                    ? tab.id === 'permanent_delete'
                      ? 'btn-3d-crimson text-white'
                      : tab.id === 'restore'
                      ? 'btn-3d-emerald text-white'
                      : 'btn-3d-primary text-white'
                    : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#26364A] dark:hover:text-white hover:bg-[#EDF3F8] dark:hover:bg-[#2A174B]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
      </div>

      {activeTab !== 'history' && summaryError && (
        <div
          data-testid="deletion-summary-error-banner"
          className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{summaryError}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            className="btn-3d-lilac px-3 py-1 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Coba Lagi</span>
          </button>
        </div>
      )}

      {/* Category Selector */}
      {activeTab !== 'history' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {visibleCategories.map(cat => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            const counts = summary?.[cat.id] || { active: 0, deleted: 0, total: 0 };
            const isDisabledForTab =
              (activeTab === 'soft_delete' && !cat.supportsSoftDelete) ||
              (activeTab === 'restore' && !cat.supportsRestore);

            return (
              <button
                key={cat.id}
                type="button"
                data-testid={`deletion-category-${cat.id}`}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setSelectedIds([]);
                  setPage(1);
                }}
                className={`p-2.5 rounded-2xl text-left transition-all cursor-pointer border flex flex-col justify-between gap-1.5 ${
                  isSelected
                    ? 'bg-gradient-to-br from-[#6657C8] to-[#5145A6] dark:from-[#5B289B] dark:to-[#35105E] text-white border-[#5145A6] dark:border-[#9353D3] shadow-md'
                    : 'card-3d-lavender text-[#26394E] dark:text-white border-[#DDE6F0] dark:border-[#35105E] hover:border-[#6657C8]/60'
                } ${isDisabledForTab ? 'opacity-75' : ''}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-[#5145A6] dark:text-[#D8B4FE]'}`} />
                  <span
                    className={`text-[10px] font-mono font-extrabold px-1.5 py-0.5 rounded-full tabular-nums ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#E8DDFF]'
                    }`}
                  >
                    {counts.total}
                  </span>
                </div>
                <div>
                  <div className="text-[11px] font-bold leading-tight truncate">{cat.shortLabel}</div>
                  <div className={`text-[9.5px] mt-0.5 font-mono tabular-nums ${isSelected ? 'text-white/80' : 'text-[#52647A] dark:text-[#A78BFA]'}`}>
                    Aktif: {counts.active} · Hapus: {counts.deleted}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* TAB CONTENT: OPERATIONAL LIST (SOFT DELETE / PERMANENT DELETE / RESTORE) */}
      {activeTab !== 'history' && (
        <div className="space-y-3">
          {activeTab === 'permanent_delete' && (
            <div className="space-y-2.5">
              <div className="p-3 rounded-2xl bg-rose-50/90 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <strong>Zero-Cascade Policy:</strong> Hapus permanen WO <strong>ditolak otomatis</strong> apabila masih memiliki relasi di{' '}
                    <code>assignment_history</code>, <code>ticket_messages</code>, <code>technical_reports</code>, atau <code>attachments</code>.
                    Eksekusi batch berjalan bertahap per 5 data dengan pelacakan idempoten.
                  </div>
                </div>
                {isSuperAdmin && (
                  <button
                    type="button"
                    data-testid="audit-recent-permanent-btn"
                    onClick={() => void handleLoadRecentPermanentAudit(false)}
                    className="btn-3d-lilac px-3 py-1.5 min-h-[32px] rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <FileSearch className="w-3.5 h-3.5" />
                    <span>{recentAuditOpen ? 'Tutup Audit Terbaru' : 'Audit Status Terbaru'}</span>
                  </button>
                )}
              </div>

              {recentAuditOpen && isSuperAdmin && (
                <div
                  data-testid="recent-permanent-audit-panel"
                  className="card-3d-lavender rounded-2xl p-3.5 border border-[#C5BEEF] dark:border-[#4A2580] text-xs space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-extrabold text-[#26394E] dark:text-white flex items-center gap-1.5">
                      <FileSearch className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
                      <span>Audit Read-Only Transaksi Hapus Permanen Terbaru</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleLoadRecentPermanentAudit(true)}
                      disabled={isLoadingRecentAudit}
                      className="btn-3d-lilac px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingRecentAudit ? 'animate-spin' : ''}`} />
                      <span>Muat Ulang</span>
                    </button>
                  </div>
                  {isLoadingRecentAudit ? (
                    <div className="text-[#52647A] dark:text-[#CEC0E8]">Memeriksa log hapus permanen & keberadaan WO di database...</div>
                  ) : !recentAuditData || recentAuditData.recentLogs.length === 0 ? (
                    <div className="text-[#52647A] dark:text-[#CEC0E8]">Belum ada log transaksi hapus permanen yang tercatat.</div>
                  ) : (
                    <div className="overflow-x-auto max-h-56 overflow-y-auto rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-[#EDF3F8] dark:bg-[#22123F] text-[#52647A] dark:text-[#D8B4FE] font-extrabold">
                            <th className="py-2 px-2.5">Waktu</th>
                            <th className="py-2 px-2.5">WO / Record ID</th>
                            <th className="py-2 px-2.5">Status Log</th>
                            <th className="py-2 px-2.5">Status Aktual di DB</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#2D1852]">
                          {recentAuditData.recentLogs.map(log => {
                            const dbCheck = recentAuditData.woExistenceMap[log.recordId];
                            return (
                              <tr key={log.id} className="bg-white/80 dark:bg-[#160D29]/60">
                                <td className="py-1.5 px-2.5 font-mono whitespace-nowrap">
                                  {new Date(log.createdAt).toLocaleString('id-ID')}
                                </td>
                                <td className="py-1.5 px-2.5 font-mono">
                                  <span className="font-bold text-[#5145A6] dark:text-[#D8B4FE]">{log.woNumber || log.recordId}</span>
                                </td>
                                <td className="py-1.5 px-2.5 uppercase font-bold">{log.status}</td>
                                <td className="py-1.5 px-2.5">
                                  {log.category !== 'work_orders' ? (
                                    <span className="text-[#52647A] dark:text-[#CEC0E8]">{log.category}</span>
                                  ) : dbCheck?.exists ? (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold">
                                      Masih Ada ({dbCheck.isDeleted ? 'Soft Deleted' : 'Aktif'})
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 font-bold">
                                      Sudah Terhapus Permanen
                                    </span>
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
              )}
            </div>
          )}

          {facetsError && selectedCategory === 'work_orders' && (
            <div
              data-testid="deletion-facets-error-banner"
              className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{facetsError}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadFacets()}
                className="btn-3d-lilac px-3 py-1 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Coba Lagi</span>
              </button>
            </div>
          )}

          {loadError && (
            <div
              data-testid="deletion-items-error-banner"
              className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loadError}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadItems()}
                disabled={isLoading}
                className="btn-3d-lilac px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Coba Lagi</span>
              </button>
            </div>
          )}

          {/* Data Table Card — Zero Separate Filter Card; Header Controls Embedded in <thead> */}
          <div className="card-3d-lavender rounded-2xl overflow-hidden border border-[#DDE6F0] dark:border-[#35105E]">
            {/* Compact Table Header Strip: Contextual Selection Actions + Reset Search */}
            <div className="px-3.5 py-2.5 bg-[#F3F8FC]/95 dark:bg-[#1E1038] border-b border-[#DDE6F0] dark:border-[#35105E] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-[#26394E] dark:text-white">
                  {activeCategoryMeta.label}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white dark:bg-[#2D1852] border border-[#DDE6F0] dark:border-[#4A2580] text-[10.5px] font-mono font-bold text-[#52647A] dark:text-[#D8B4FE]">
                  {totalItems} record
                </span>

                {/* Contextual Action Toolbar: Shown ONLY when 1+ rows checked */}
                {selectedRows.length > 0 && (
                  <div
                    data-testid="contextual-selection-toolbar"
                    className="flex flex-wrap items-center gap-1.5 pl-2 ml-1 border-l border-[#C5BEEF] dark:border-[#4A2580]"
                  >
                    <span className="px-2.5 py-1 rounded-lg bg-[#EAE8FF] dark:bg-[#4A2580] text-[#5145A6] dark:text-white font-extrabold text-[11px]">
                      {selectedRows.length} dipilih
                    </span>

                    {activeTab === 'soft_delete' && activeCategoryMeta.supportsSoftDelete && (
                      <button
                        type="button"
                        data-testid="bulk-soft-delete-btn"
                        onClick={() => void handleOpenActionModal('soft_delete', selectedRows)}
                        className="btn-3d-crimson px-3 py-1.5 min-h-[32px] rounded-xl text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Soft Delete Selected</span>
                      </button>
                    )}

                    {isSuperAdmin && activeCategoryMeta.supportsPermanentDelete && (
                      <button
                        type="button"
                        data-testid="bulk-permanent-delete-btn"
                        onClick={() => void handleOpenActionModal('permanent_delete', selectedRows)}
                        className={`${
                          activeTab === 'permanent_delete'
                            ? 'btn-3d-crimson text-white'
                            : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-950/70 dark:hover:bg-rose-900 dark:text-rose-200 dark:border-rose-700'
                        } px-3 py-1.5 min-h-[32px] rounded-xl font-bold text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors`}
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Permanent Delete Selected</span>
                      </button>
                    )}

                    {activeTab === 'restore' && isSuperAdmin && activeCategoryMeta.supportsRestore && (
                      <button
                        type="button"
                        data-testid="bulk-restore-btn"
                        onClick={() => void handleOpenActionModal('restore', selectedRows)}
                        className="btn-3d-emerald px-3 py-1.5 min-h-[32px] rounded-xl text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restore Selected</span>
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid="clear-selection-btn"
                      onClick={() => setSelectedIds([])}
                      className="btn-3d-lilac px-2.5 py-1.5 min-h-[32px] rounded-xl font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      <span>Clear Selection</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                data-testid="reset-table-search-btn"
                onClick={handleResetAllFilters}
                disabled={activeFilterCount === 0}
                aria-label="Reset Search dan Sorting"
                title="Reset seluruh pencarian, filter kolom, dan sorting"
                className={`px-2.5 py-1.5 min-h-[32px] rounded-xl font-bold text-[11px] inline-flex items-center gap-1.5 transition-all cursor-pointer border ${
                  activeFilterCount > 0
                    ? 'bg-white border-[#C5BEEF] text-[#5145A6] hover:bg-[#EAE8FF] dark:bg-[#35105E] dark:border-[#7135B5] dark:text-white shadow-xs'
                    : 'bg-white/50 border-[#E2E8F0] text-[#94A3B8] dark:bg-[#160D29]/50 dark:border-[#2D1852] dark:text-[#6D5A99] opacity-70 cursor-default'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Search</span>
                {activeFilterCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#6657C8] text-white dark:bg-[#38BDF8] dark:text-[#0F172A] text-[10px] font-mono">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11.5px]" data-testid="deletion-items-table">
                <thead>
                  <tr className="bg-[#EDF3F8]/95 dark:bg-[#22123F] border-b border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#D8B4FE] text-[10.5px] uppercase tracking-tight font-extrabold">
                    <th className="py-2.5 pl-2.5 pr-1.5 w-8">
                      <input
                        type="checkbox"
                        data-testid="deletion-select-all-checkbox"
                        checked={allSelectableChecked}
                        onChange={toggleSelectAll}
                        disabled={selectableItems.length === 0}
                        aria-label="Pilih semua baris di halaman ini"
                        className="rounded border-[#C5BEEF] text-[#6657C8] cursor-pointer disabled:opacity-40"
                      />
                    </th>
                    {selectedCategory === 'work_orders' ? (
                      <>
                        <th className="py-2.5 px-1.5 whitespace-nowrap">
                          <HeaderSearchPopover
                            label="WO Number"
                            value={filters.woNumber}
                            onChange={val => updateFilter('woNumber', val)}
                            placeholder="Cari WO Number..."
                            testId="hdr-wo-number"
                          />
                        </th>
                        <th className="py-2.5 px-1.5 whitespace-nowrap">
                          <HeaderSearchPopover
                            label="Customer ID"
                            value={filters.customerId}
                            onChange={val => updateFilter('customerId', val)}
                            placeholder="Cari Customer ID..."
                            testId="hdr-customer-id"
                          />
                        </th>
                        <th className="py-2.5 px-1.5 whitespace-nowrap">
                          <HeaderSearchPopover
                            label="Customer Name"
                            value={filters.customerName}
                            onChange={val => updateFilter('customerName', val)}
                            placeholder="Cari nama pelanggan..."
                            testId="hdr-customer-name"
                          />
                        </th>
                        <th className="py-2.5 px-1.5 whitespace-nowrap">
                          <HeaderDateSortFilterPopover
                            label="Appointment Date"
                            sortActive={sortState.by === 'appointment_date'}
                            sortDir={sortState.dir}
                            onCycleSort={() => {
                              setSortState(prev => cycleAppointmentDateSort(prev));
                              setPage(1);
                            }}
                            exactDate={filters.appointmentDate}
                            dateFrom={filters.appointmentDateFrom}
                            dateTo={filters.appointmentDateTo}
                            onChangeDates={next => {
                              setFilters(prev => ({
                                ...prev,
                                appointmentDate: next.exactDate,
                                appointmentDateFrom: next.dateFrom,
                                appointmentDateTo: next.dateTo
                              }));
                              setPage(1);
                            }}
                            supportsExactDate={true}
                            testId="hdr-appointment-date"
                          />
                        </th>
                        <th className="py-2.5 px-1.5 whitespace-nowrap">
                          <HeaderCategoryDropdown
                            label="Contractor"
                            value={filters.contractor}
                            allLabel="Semua Kontraktor"
                            options={contractorOptions}
                            onChange={val => updateFilter('contractor', val)}
                            testId="hdr-contractor"
                          />
                        </th>
                        <th className="py-2.5 px-1.5 whitespace-nowrap">
                          <HeaderCategoryDropdown
                            label="Area"
                            value={filters.area}
                            allLabel="Semua Area"
                            options={areaOptions}
                            onChange={val => updateFilter('area', val)}
                            testId="hdr-area"
                          />
                        </th>
                        <th className="py-2.5 px-1.5 whitespace-nowrap">
                          <HeaderCategoryDropdown
                            label="Assignment"
                            value={filters.assignmentStatus}
                            allLabel="Semua Status"
                            options={assignmentStatusOptions}
                            onChange={val => updateFilter('assignmentStatus', val)}
                            testId="hdr-assignment-status"
                          />
                        </th>
                        <th className="py-2.5 px-1.5 whitespace-nowrap">
                          <HeaderCategoryDropdown
                            label="Status"
                            value={filters.deletionStatus}
                            defaultValue={getDefaultDeletionStatusForTab(operationalMode)}
                            options={DELETION_STATUS_OPTIONS}
                            onChange={val => updateFilter('deletionStatus', val as 'all' | 'active' | 'soft_deleted')}
                            testId="hdr-deletion-status"
                          />
                        </th>
                        <th className="py-2.5 pl-1.5 pr-2.5 text-right whitespace-nowrap w-11">Detail</th>
                      </>
                    ) : (
                      <>
                        <th className="py-3 px-3 whitespace-nowrap">
                          <HeaderSearchPopover
                            label="ID / Referensi"
                            value={filters.recordIdQuery}
                            onChange={val => updateFilter('recordIdQuery', val)}
                            placeholder="Cari ID / referensi..."
                            testId="hdr-record-id"
                          />
                        </th>
                        <th className="py-3 px-3 whitespace-nowrap">
                          {selectedCategory === 'other_data' ? (
                            <HeaderCategoryDropdown
                              label="Sub-Entitas"
                              value={filters.subEntity}
                              allLabel="Semua Sub-Entitas"
                              options={SUB_ENTITY_OPTIONS}
                              onChange={val => {
                                updateFilter('subEntity', val as DeletionSubEntity);
                                setSelectedIds([]);
                              }}
                              testId="hdr-sub-entity"
                            />
                          ) : (
                            <HeaderSearchPopover
                              label="WO / Nama"
                              value={filters.woNumber}
                              onChange={val => updateFilter('woNumber', val)}
                              placeholder="Cari WO / Import..."
                              testId="hdr-nonwo-wo"
                            />
                          )}
                        </th>
                        <th className="py-3 px-3 whitespace-nowrap">
                          <HeaderSearchPopover
                            label="Ringkasan Data"
                            value={filters.summaryQuery}
                            onChange={val => updateFilter('summaryQuery', val)}
                            placeholder="Cari ringkasan / file..."
                            testId="hdr-summary"
                          />
                        </th>
                        <th className="py-3 px-3 whitespace-nowrap">
                          <HeaderSearchPopover
                            label="Aktor"
                            value={filters.actorQuery}
                            onChange={val => updateFilter('actorQuery', val)}
                            placeholder="Cari aktor / pengirim..."
                            testId="hdr-actor"
                          />
                        </th>
                        <th className="py-3 px-3 whitespace-nowrap">
                          <HeaderDateSortFilterPopover
                            label="Tanggal"
                            sortActive={sortState.by === 'created_at'}
                            sortDir={sortState.dir}
                            onCycleSort={() => {
                              setSortState(prev => cycleCreatedAtSort(prev));
                              setPage(1);
                            }}
                            exactDate={filters.appointmentDate}
                            dateFrom={filters.appointmentDateFrom}
                            dateTo={filters.appointmentDateTo}
                            onChangeDates={next => {
                              setFilters(prev => ({
                                ...prev,
                                appointmentDate: next.exactDate,
                                appointmentDateFrom: next.dateFrom,
                                appointmentDateTo: next.dateTo
                              }));
                              setPage(1);
                            }}
                            supportsExactDate={true}
                            testId="hdr-created-at"
                          />
                        </th>
                        <th className="py-3 px-3 whitespace-nowrap">
                          <HeaderCategoryDropdown
                            label="Deletion Status"
                            value={filters.deletionStatus}
                            defaultValue={getDefaultDeletionStatusForTab(operationalMode)}
                            options={DELETION_STATUS_OPTIONS}
                            onChange={val => updateFilter('deletionStatus', val as 'all' | 'active' | 'soft_deleted')}
                            testId="hdr-deletion-status"
                          />
                        </th>
                        <th className="py-3 px-3 text-right whitespace-nowrap">Detail</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#2D1852]">
                  {isLoading ? (
                    <tr>
                      <td colSpan={10} className="py-10 text-center text-[#52647A] dark:text-[#CEC0E8]">
                        <div className="inline-flex items-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Memuat data dari server...</span>
                        </div>
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-10 text-center text-[#52647A] dark:text-[#CEC0E8]">
                        Tidak ada record untuk filter dan kategori ini.
                      </td>
                    </tr>
                  ) : (
                    items.map(row => {
                      const canSelect = isRowSelectableForTab(row, operationalMode, isSuperAdmin);
                      const isChecked = selectedIds.includes(row.id);

                      return (
                        <tr
                          key={`${row.category}-${row.subEntity || 'main'}-${row.id}`}
                          className={`transition-colors ${
                            isChecked
                              ? 'bg-[#EAE8FF]/70 dark:bg-[#2F1859]/80'
                              : 'bg-white/80 dark:bg-[#160D29]/60 hover:bg-[#F3F8FC] dark:hover:bg-[#27104A]/70'
                          }`}
                        >
                          <td className="py-2.5 pl-2.5 pr-1.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={!canSelect}
                              onChange={() => toggleSelectId(row.id)}
                              aria-label={`Pilih ${row.woNumber || row.label || row.id}`}
                              className="rounded border-[#C5BEEF] text-[#6657C8] cursor-pointer disabled:opacity-40"
                            />
                          </td>

                          {selectedCategory === 'work_orders' ? (
                            <>
                              <td className="py-2.5 px-1.5 font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] whitespace-nowrap">
                                {row.woNumber || row.id}
                              </td>
                              <td className="py-2.5 px-1.5 font-mono text-[#26394E] dark:text-[#E8DDFF] whitespace-nowrap">
                                {row.customerId || '-'}
                              </td>
                              <td className="py-2.5 px-1.5 font-semibold text-[#26394E] dark:text-white max-w-[130px] truncate" title={row.customerName || '-'}>
                                {row.customerName || '-'}
                              </td>
                              <td className="py-2.5 px-1.5 font-mono whitespace-nowrap text-[#26394E] dark:text-[#D9CCF2]">
                                {row.appointmentDate || '-'}
                              </td>
                              <td className="py-2.5 px-1.5 text-[#26394E] dark:text-[#D9CCF2] max-w-[115px] truncate" title={row.contractor || '-'}>
                                {row.contractor || '-'}
                              </td>
                              <td className="py-2.5 px-1.5 text-[#26394E] dark:text-[#D9CCF2] max-w-[95px] truncate" title={row.area || '-'}>
                                {row.area || '-'}
                              </td>
                              <td className="py-2.5 px-1.5 text-[#52647A] dark:text-[#CEC0E8] max-w-[100px] truncate" title={row.assignmentStatus || 'Unassigned'}>
                                {row.assignmentStatus || 'Unassigned'}
                              </td>
                              <td className="py-2.5 px-1.5 whitespace-nowrap">{renderStatusBadge(row)}</td>
                            </>
                          ) : (
                            <>
                              <td className="py-2.5 px-2 font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] max-w-[150px] truncate">
                                {row.id}
                              </td>
                              <td className="py-2.5 px-2 whitespace-nowrap">
                                {row.woNumber ? (
                                  <span className="font-mono font-semibold text-[#26394E] dark:text-white">{row.woNumber}</span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#E8DDFF] text-[10px] font-bold">
                                    {row.subEntity || row.category}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-2 max-w-[220px] truncate text-[#26394E] dark:text-[#E8DDFF]">
                                {row.label ||
                                  row.fileName ||
                                  row.importName ||
                                  row.sourceFile ||
                                  row.message ||
                                  row.notes ||
                                  row.installerName ||
                                  '-'}
                              </td>
                              <td className="py-2.5 px-2 text-[#52647A] dark:text-[#CEC0E8] whitespace-nowrap">
                                {row.senderName || row.importedBy || row.assignedBy || row.role || '-'}
                              </td>
                              <td className="py-2.5 px-2 text-[#52647A] dark:text-[#A78BFA] whitespace-nowrap font-mono text-[11px]">
                                {row.createdAt ? new Date(row.createdAt).toLocaleString('id-ID') : '-'}
                              </td>
                              <td className="py-2.5 px-2 whitespace-nowrap">{renderStatusBadge(row)}</td>
                            </>
                          )}

                          {/* Detail Inspect Only — Zero Per-Row Delete Buttons */}
                          <td className="py-2.5 pl-1.5 pr-2.5 text-right whitespace-nowrap w-11">
                            <button
                              type="button"
                              onClick={() => void handleOpenDetail(row)}
                              aria-label={`Detail ${row.woNumber || row.label || row.id}`}
                              title="Detail & Dependensi"
                              className="btn-3d-lilac p-1.5 min-h-[30px] rounded-lg inline-flex items-center justify-center cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="px-4 py-3 bg-[#EDF3F8]/80 dark:bg-[#22123F] border-t border-[#DDE6F0] dark:border-[#35105E] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="text-[#52647A] dark:text-[#CEC0E8] font-mono">
                Menampilkan <strong>{items.length}</strong> dari <strong>{totalItems}</strong> record · Hal {page} / {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Jumlah baris per halaman"
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="tactile-debossed-input px-2.5 py-1 rounded-lg text-[#26394E] dark:text-white font-semibold"
                >
                  <option value={25}>25 / hal</option>
                  <option value={50}>50 / hal</option>
                  <option value={100}>100 / hal</option>
                </select>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="btn-3d-lilac p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
                  aria-label="Halaman sebelumnya"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="btn-3d-lilac p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
                  aria-label="Halaman berikutnya"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: DELETION HISTORY — Header Controls Embedded in <thead> */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {historyError && (
            <div
              data-testid="deletion-history-error-banner"
              className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{historyError}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadHistory()}
                disabled={isLoadingHistory}
                className="btn-3d-lilac px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                <span>Coba Lagi</span>
              </button>
            </div>
          )}
          <div className="card-3d-lavender rounded-2xl overflow-hidden border border-[#DDE6F0] dark:border-[#35105E]">
            <div className="px-3.5 py-2.5 bg-[#F3F8FC]/95 dark:bg-[#1E1038] border-b border-[#DDE6F0] dark:border-[#35105E] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-[#26394E] dark:text-white">Audit Log Penghapusan</span>
                <span className="px-2 py-0.5 rounded-full bg-white dark:bg-[#2D1852] border border-[#DDE6F0] dark:border-[#4A2580] text-[10.5px] font-mono font-bold text-[#52647A] dark:text-[#D8B4FE]">
                  {historyTotal} log
                </span>
              </div>

              <button
                type="button"
                data-testid="reset-history-search-btn"
                onClick={handleResetHistoryFilters}
                disabled={activeHistoryFilterCount === 0}
                aria-label="Reset Search Deletion History"
                className={`px-2.5 py-1.5 min-h-[32px] rounded-xl font-bold text-[11px] inline-flex items-center gap-1.5 transition-all cursor-pointer border ${
                  activeHistoryFilterCount > 0
                    ? 'bg-white border-[#C5BEEF] text-[#5145A6] hover:bg-[#EAE8FF] dark:bg-[#35105E] dark:border-[#7135B5] dark:text-white shadow-xs'
                    : 'bg-white/50 border-[#E2E8F0] text-[#94A3B8] dark:bg-[#160D29]/50 dark:border-[#2D1852] dark:text-[#6D5A99] opacity-70 cursor-default'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Search</span>
                {activeHistoryFilterCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#6657C8] text-white dark:bg-[#38BDF8] dark:text-[#0F172A] text-[10px] font-mono">
                    {activeHistoryFilterCount}
                  </span>
                )}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11.5px]" data-testid="deletion-history-table">
                <thead>
                  <tr className="bg-[#EDF3F8]/95 dark:bg-[#22123F] border-b border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#D8B4FE] text-[10.5px] uppercase tracking-tight font-extrabold">
                    <th className="py-3 px-3 whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <HeaderDateSortFilterPopover
                          label="Waktu"
                          sortActive={historyFilters.sortDir !== 'desc'}
                          sortDir={historyFilters.sortDir}
                          onCycleSort={() => {
                            updateHistoryFilter('sortDir', historyFilters.sortDir === 'desc' ? 'asc' : 'desc');
                          }}
                          exactDate=""
                          dateFrom={historyFilters.dateFrom}
                          dateTo={historyFilters.dateTo}
                          onChangeDates={next => {
                            setHistoryFilters(prev => ({ ...prev, dateFrom: next.dateFrom, dateTo: next.dateTo }));
                            setHistoryPage(1);
                          }}
                          supportsExactDate={false}
                          testId="hist-date"
                        />
                        <HeaderSearchPopover
                          label="Tx"
                          value={historyFilters.txIdQuery}
                          onChange={val => updateHistoryFilter('txIdQuery', val)}
                          placeholder="Cari Transaction ID..."
                          testId="hist-tx"
                        />
                      </div>
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      <HeaderCategoryDropdown
                        label="Tipe"
                        value={historyFilters.deletionType}
                        allLabel="Semua Tipe"
                        options={[
                          { value: 'soft_delete', label: 'Soft Delete' },
                          { value: 'permanent_delete', label: 'Permanent Delete' },
                          { value: 'restore', label: 'Restore' }
                        ]}
                        onChange={val => updateHistoryFilter('deletionType', val)}
                        testId="hist-type"
                      />
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      <HeaderCategoryDropdown
                        label="Kategori"
                        value={historyFilters.category}
                        allLabel="Semua Kategori"
                        options={DELETION_CATEGORIES.map(c => ({ value: c.id, label: c.shortLabel }))}
                        onChange={val => updateHistoryFilter('category', val)}
                        testId="hist-category"
                      />
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      <HeaderSearchPopover
                        label="WO / Record ID"
                        value={historyFilters.woOrRecordQuery}
                        onChange={val => updateHistoryFilter('woOrRecordQuery', val)}
                        placeholder="Cari WO / Record ID..."
                        testId="hist-record"
                      />
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      <HeaderSearchPopover
                        label="Eksekutor"
                        value={historyFilters.actor}
                        onChange={val => updateHistoryFilter('actor', val)}
                        placeholder="Cari nama / role..."
                        testId="hist-actor"
                      />
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      <HeaderSearchPopover
                        label="Alasan & Catatan"
                        value={historyFilters.reasonQuery}
                        onChange={val => updateHistoryFilter('reasonQuery', val)}
                        placeholder="Cari alasan / error..."
                        testId="hist-reason"
                      />
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      <HeaderCategoryDropdown
                        label="Status"
                        value={historyFilters.status}
                        allLabel="Semua Status"
                        options={[
                          { value: 'success', label: 'Success' },
                          { value: 'rejected', label: 'Rejected' },
                          { value: 'failed', label: 'Failed' }
                        ]}
                        onChange={val => updateHistoryFilter('status', val)}
                        testId="hist-status"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#2D1852]">
                  {isLoadingHistory ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#52647A] dark:text-[#CEC0E8]">
                        Memuat riwayat penghapusan...
                      </td>
                    </tr>
                  ) : historyLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#52647A] dark:text-[#CEC0E8]">
                        Belum ada riwayat penghapusan atau pemulihan yang tercatat.
                      </td>
                    </tr>
                  ) : (
                    historyLogs.map(log => (
                      <tr key={log.id} className="bg-white/80 dark:bg-[#160D29]/60">
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-mono text-[#26394E] dark:text-white">
                            {new Date(log.createdAt).toLocaleString('id-ID')}
                          </div>
                          <div className="font-mono text-[10px] text-[#8492A5] dark:text-[#A78BFA]">{log.transactionId}</div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              log.deletionType === 'permanent_delete'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                : log.deletionType === 'restore'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {log.deletionType}
                          </span>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-bold text-[#26394E] dark:text-white">{log.category}</div>
                          <div className="font-mono text-[10px] text-[#52647A] dark:text-[#A78BFA]">{log.sourceTable}</div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {log.woNumber && (
                            <div className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">{log.woNumber}</div>
                          )}
                          <div className="font-mono text-[10.5px] text-[#52647A] dark:text-[#CEC0E8] max-w-[160px] truncate">
                            {log.recordId}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-semibold text-[#26394E] dark:text-white">{log.actorName}</div>
                          <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] uppercase">{log.actorRole}</div>
                        </td>
                        <td className="py-3 px-3 max-w-[260px]">
                          <div className="text-[#26394E] dark:text-[#E8DDFF]">{log.reason || '-'}</div>
                          {log.errorMessage && (
                            <div className="text-[10.5px] text-rose-600 dark:text-rose-400 mt-0.5">{log.errorMessage}</div>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {log.status === 'success' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                              <CheckCircle2 className="w-3 h-3" /> SUCCESS
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                              <XCircle className="w-3 h-3" /> {log.status.toUpperCase()}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 bg-[#EDF3F8]/80 dark:bg-[#22123F] border-t border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between text-xs">
              <span className="font-mono text-[#52647A] dark:text-[#CEC0E8]">
                Total Log: <strong>{historyTotal}</strong> · Hal {historyPage} / {historyTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={historyPage <= 1}
                  onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                  className="btn-3d-lilac p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
                  aria-label="Halaman log sebelumnya"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={historyPage >= historyTotalPages}
                  onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                  className="btn-3d-lilac p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
                  aria-label="Halaman log berikutnya"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL & DEPENDENCY INSPECTOR MODAL */}
      <ResponsiveModal
        isOpen={Boolean(detailItem)}
        onClose={() => setDetailItem(null)}
        title={detailItem ? `Detail Record: ${detailItem.woNumber || detailItem.label || detailItem.id}` : 'Detail Record'}
        subtitle={detailItem ? `${detailItem.category} ${detailItem.subEntity ? `(${detailItem.subEntity})` : ''}` : undefined}
        icon={<Eye className="w-4 h-4" />}
        size="lg"
        mobileVariant="sheet"
        footer={
          <button
            type="button"
            onClick={() => setDetailItem(null)}
            className="btn-3d-lilac px-4 py-2 rounded-xl font-bold text-xs cursor-pointer"
          >
            Tutup
          </button>
        }
      >
        {detailItem && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#F3F8FC] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
              <div>
                <div className="text-[10.5px] text-[#52647A] dark:text-[#A78BFA]">Record ID</div>
                <div className="font-mono font-bold text-[#26394E] dark:text-white break-all">{detailItem.id}</div>
              </div>
              <div>
                <div className="text-[10.5px] text-[#52647A] dark:text-[#A78BFA]">Status Hapus</div>
                <div className="mt-0.5">{renderStatusBadge(detailItem)}</div>
              </div>
              {detailItem.isDeleted && (
                <>
                  <div>
                    <div className="text-[10.5px] text-[#52647A] dark:text-[#A78BFA]">Dihapus Oleh</div>
                    <div className="font-semibold text-[#26394E] dark:text-white">{detailItem.deletedBy || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-[#52647A] dark:text-[#A78BFA]">Alasan Penghapusan</div>
                    <div className="text-[#26394E] dark:text-white">{detailItem.deletionReason || '-'}</div>
                  </div>
                </>
              )}
            </div>

            {detailItem.category === 'work_orders' && (
              <div className="p-3.5 rounded-xl bg-[#EAE8FF]/50 dark:bg-[#22123F] border border-[#C5BEEF] dark:border-[#4A2580] space-y-2.5">
                <div className="font-bold text-[#5145A6] dark:text-[#E8DDFF] flex items-center gap-1.5">
                  <Database className="w-4 h-4" />
                  <span>Inspeksi Dependensi Work Order</span>
                </div>
                {isLoadingDetailDeps ? (
                  <div className="text-[#52647A] dark:text-[#CEC0E8]">Memeriksa jumlah relasi di database...</div>
                ) : detailDepsError ? (
                  <div
                    data-testid="detail-deps-error-banner"
                    className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{detailDepsError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleOpenDetail(detailItem)}
                      className="btn-3d-lilac px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Coba Lagi</span>
                    </button>
                  </div>
                ) : detailDeps ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                      <div className="text-[10px] text-[#52647A] dark:text-[#A78BFA]">assignment_history</div>
                      <div className="font-mono font-black text-base text-[#26394E] dark:text-white">{detailDeps.counts.assignment_history}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                      <div className="text-[10px] text-[#52647A] dark:text-[#A78BFA]">ticket_messages</div>
                      <div className="font-mono font-black text-base text-[#26394E] dark:text-white">{detailDeps.counts.ticket_messages}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                      <div className="text-[10px] text-[#52647A] dark:text-[#A78BFA]">technical_reports</div>
                      <div className="font-mono font-black text-base text-[#26394E] dark:text-white">{detailDeps.counts.technical_reports}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                      <div className="text-[10px] text-[#52647A] dark:text-[#A78BFA]">attachments</div>
                      <div className="font-mono font-black text-base text-[#26394E] dark:text-white">{detailDeps.counts.attachments}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {detailItem.rawDetail && (
              <div className="space-y-1">
                <div className="font-bold text-[#52647A] dark:text-[#CEC0E8]">Metadata Tersanitasi</div>
                <pre className="p-3 rounded-xl bg-[#F3F8FC] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[11px] font-mono overflow-x-auto max-h-64 text-[#26394E] dark:text-[#D9CCF2]">
                  {JSON.stringify(detailItem.rawDetail, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </ResponsiveModal>

      {/* CONFIRMATION MODAL: SOFT DELETE / PERMANENT DELETE (SINGLE & BATCH) / RESTORE */}
      <ResponsiveModal
        isOpen={actionModal.open}
        onClose={handleCloseActionModal}
        title={
          actionModal.mode === 'permanent_delete'
            ? activePermOp &&
              (activePermOp.status === 'completed' ||
                activePermOp.status === 'partial' ||
                activePermOp.status === 'failed')
              ? 'Laporan Hasil Hapus Permanen'
              : 'Konfirmasi Hapus Permanen (Permanent Delete)'
            : actionModal.mode === 'restore'
            ? 'Konfirmasi Pemulihan Data (Restore)'
            : 'Konfirmasi Soft Delete Data'
        }
        subtitle={
          activePermOp
            ? `${activePermOp.processedCount} dari ${activePermOp.totalCount} data diproses · ${activePermOp.stageLabel}`
            : `${actionModal.targets.length} record dipilih`
        }
        icon={
          actionModal.mode === 'permanent_delete' ? (
            <ShieldAlert className="w-4 h-4 text-rose-600" />
          ) : actionModal.mode === 'restore' ? (
            <RotateCcw className="w-4 h-4 text-emerald-600" />
          ) : (
            <Trash2 className="w-4 h-4 text-rose-600" />
          )
        }
        size={activePermOp ? 'lg' : 'md'}
        mobileVariant="sheet"
        footer={(() => {
          const isPermTerminal =
            actionModal.mode === 'permanent_delete' &&
            Boolean(
              activePermOp &&
                (activePermOp.status === 'completed' ||
                  activePermOp.status === 'partial' ||
                  activePermOp.status === 'failed')
            );

          if (isPermTerminal) {
            return (
              <button
                type="button"
                data-testid="close-permanent-delete-report-btn"
                onClick={handleCloseActionModal}
                className="btn-3d-primary px-5 py-2 min-h-[38px] rounded-xl text-white font-bold text-xs cursor-pointer"
              >
                Selesai & Tutup
              </button>
            );
          }

          return (
            <>
              <button
                type="button"
                disabled={isSubmittingAction}
                onClick={handleCloseActionModal}
                className="btn-3d-lilac px-4 py-2 min-h-[38px] rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                {permOpNeedsResume ? 'Tutup Sementara' : 'Batal'}
              </button>

              {permOpNeedsResume && activePermOp ? (
                <button
                  type="button"
                  data-testid="resume-permanent-delete-btn"
                  disabled={isSubmittingAction}
                  onClick={() => void handleResumePermanentOperation()}
                  className="btn-3d-crimson px-4 py-2 min-h-[38px] rounded-xl text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSubmittingAction ? 'animate-spin' : ''}`} />
                  <span>Cek Status & Lanjutkan Sisa</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="confirm-deletion-action-btn"
                  disabled={
                    isSubmittingAction ||
                    isLoadingActionDeps ||
                    actionModal.targets.length === 0 ||
                    (actionModal.mode === 'permanent_delete' && Boolean(actionBatchDeps && actionBatchDeps.blockedCount > 0))
                  }
                  onClick={() => void handleConfirmAction()}
                  className={`px-4 py-2 min-h-[38px] rounded-xl text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                    actionModal.mode === 'restore' ? 'btn-3d-emerald' : 'btn-3d-crimson'
                  }`}
                >
                  {isSubmittingAction ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Memproses...</span>
                    </>
                  ) : actionModal.mode === 'permanent_delete' ? (
                    <span>Eksekusi Hapus Permanen ({actionModal.targets.length})</span>
                  ) : actionModal.mode === 'restore' ? (
                    <span>Pulihkan Data Sekarang</span>
                  ) : (
                    <span>Konfirmasi Soft Delete ({actionModal.targets.length})</span>
                  )}
                </button>
              )}
            </>
          );
        })()}
      >
        <div className="space-y-4 text-xs">
          {/* Live / Completed Tracked Permanent Delete Progress & Per-WO Report */}
          {actionModal.mode === 'permanent_delete' && activePermOp && (
            <div
              data-testid="permanent-delete-operation-panel"
              className="p-3.5 rounded-2xl bg-[#F3F8FC] dark:bg-[#160D29] border border-[#C5BEEF] dark:border-[#4A2580] space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-extrabold text-[#26394E] dark:text-white">
                  {activePermOp.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  ) : activePermOp.status === 'partial' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  ) : activePermOp.status === 'failed' ? (
                    <XCircle className="w-4 h-4 text-rose-600" />
                  ) : (
                    <Clock className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
                  )}
                  <span data-testid="perm-op-stage-label">{activePermOp.stageLabel}</span>
                </div>
                <span className="font-mono text-[10.5px] px-2 py-0.5 rounded-full bg-white dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#4A2580] text-[#52647A] dark:text-[#D8B4FE]">
                  {activePermOp.processedCount} / {activePermOp.totalCount} diproses
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2.5 rounded-full bg-[#E2E8F0] dark:bg-[#2D1852] overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    activePermOp.status === 'failed'
                      ? 'bg-rose-500'
                      : activePermOp.status === 'partial'
                      ? 'bg-amber-500'
                      : 'bg-gradient-to-r from-[#6657C8] to-emerald-500'
                  }`}
                  style={{
                    width: `${
                      activePermOp.totalCount > 0
                        ? Math.min(100, Math.round((activePermOp.processedCount / activePermOp.totalCount) * 100))
                        : 0
                    }%`
                  }}
                />
              </div>

              {isRecoveredNotice && (
                <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 text-[11px] font-semibold">
                  Status transaksi berhasil direkonsiliasi langsung dari server tanpa menjalankan hapus ulang ganda.
                </div>
              )}

              {/* Summary Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800">
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-300">Berhasil</div>
                  <div className="text-sm font-black text-emerald-800 dark:text-emerald-200" data-testid="perm-op-succeeded-count">
                    {activePermOp.succeededCount}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800">
                  <div className="text-[10px] text-sky-700 dark:text-sky-300">Sudah Terhapus</div>
                  <div className="text-sm font-black text-sky-800 dark:text-sky-200" data-testid="perm-op-already-deleted-count">
                    {activePermOp.alreadyDeletedCount}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800">
                  <div className="text-[10px] text-amber-700 dark:text-amber-300">Diblokir FK</div>
                  <div className="text-sm font-black text-amber-800 dark:text-amber-200" data-testid="perm-op-blocked-count">
                    {activePermOp.blockedCount}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800">
                  <div className="text-[10px] text-rose-700 dark:text-rose-300">Gagal</div>
                  <div className="text-sm font-black text-rose-800 dark:text-rose-200" data-testid="perm-op-failed-count">
                    {activePermOp.failedCount}
                  </div>
                </div>
              </div>

              {/* Per-WO Breakdown List */}
              <div className="max-h-56 overflow-y-auto rounded-xl border border-[#DDE6F0] dark:border-[#35105E] divide-y divide-[#E2E8F0] dark:divide-[#2D1852] bg-white dark:bg-[#1E1038]">
                {activePermOp.results.map(item => (
                  <div
                    key={`${item.category}:${item.recordId}`}
                    className="px-3 py-2 flex items-start justify-between gap-2 text-[11px]"
                    data-testid={`perm-op-item-${item.recordId}`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-[#26394E] dark:text-white truncate">
                        {item.woNumber || item.label || item.recordId}
                      </div>
                      {item.message && (
                        <div className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8] break-words">
                          {item.message}
                        </div>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 uppercase ${
                        item.status === 'deleted'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : item.status === 'already_deleted'
                          ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                          : item.status === 'blocked_fk' || item.status === 'protected'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : item.status === 'failed'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {item.status === 'deleted'
                        ? 'Berhasil'
                        : item.status === 'already_deleted'
                        ? 'Sudah Terhapus'
                        : item.status === 'blocked_fk'
                        ? 'Diblokir FK'
                        : item.status === 'protected'
                        ? 'Dilindungi'
                        : item.status === 'failed'
                        ? 'Gagal'
                        : 'Antrean'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="text-[10px] font-mono text-[#8492A5] dark:text-[#A78BFA]">
                Operation ID: {activePermOp.operationId}
              </div>
            </div>
          )}

          {/* Confirmation Form (Hidden once terminal Permanent Delete report is shown) */}
          {!(
            actionModal.mode === 'permanent_delete' &&
            activePermOp &&
            (activePermOp.status === 'completed' ||
              activePermOp.status === 'partial' ||
              activePermOp.status === 'failed')
          ) && (
            <>
              {/* Selected items preview (shown before operation starts) */}
              {!activePermOp && (
                <div className="p-3 rounded-xl bg-[#F3F8FC] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-1 max-h-36 overflow-y-auto">
                  {actionModal.targets.map(t => {
                    const dep = actionBatchDeps?.items.find(d => d.id === t.id);
                    const isBlocked = actionModal.mode === 'permanent_delete' && dep && !dep.canPermanentDelete;
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">
                          {t.woNumber || t.label || t.id}
                        </span>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[11px] text-[#52647A] dark:text-[#A78BFA] truncate">
                            {t.customerName || t.subEntity || t.category}
                          </span>
                          {dep && actionModal.mode === 'permanent_delete' && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                isBlocked
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              }`}
                            >
                              {isBlocked ? `Blok (${dep.blockingTotal} relasi)` : 'Aman'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* WO Dependency Inspection Block (Single & Multi-Select) */}
              {!activePermOp && actionModal.targets.length > 0 && actionModal.targets[0].category === 'work_orders' && (
                <div className="p-3.5 rounded-xl bg-[#EAE8FF]/60 dark:bg-[#22123F] border border-[#C5BEEF] dark:border-[#4A2580] space-y-2">
                  <div className="font-bold text-[#5145A6] dark:text-[#E8DDFF] flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span>Pemeriksaan Dependensi Relasi WO ({actionModal.targets.length} item)</span>
                  </div>
                  {isLoadingActionDeps ? (
                    <div className="text-[#52647A] dark:text-[#CEC0E8]">
                      Memeriksa assignment_history, ticket_messages, technical_reports, attachments...
                    </div>
                  ) : singleActionDeps ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                        <div>assignment_history: <strong>{singleActionDeps.counts.assignment_history}</strong></div>
                        <div>ticket_messages: <strong>{singleActionDeps.counts.ticket_messages}</strong></div>
                        <div>technical_reports: <strong>{singleActionDeps.counts.technical_reports}</strong></div>
                        <div>attachments: <strong>{singleActionDeps.counts.attachments}</strong></div>
                      </div>
                      {actionModal.mode === 'soft_delete' && (
                        <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                          Soft delete aman: seluruh histori assignment, LiveChat, laporan teknisi, dan lampiran tetap terjaga di database.
                        </div>
                      )}
                      {actionModal.mode === 'permanent_delete' && !singleActionDeps.canPermanentDelete && (
                        <div className="p-2.5 rounded-lg bg-rose-100 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-[11px]">
                          <strong>DITOLAK (Zero-Cascade):</strong> {singleActionDeps.blockingReasons.join(' ')}
                        </div>
                      )}
                    </div>
                  ) : actionBatchDeps ? (
                    <div className="space-y-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-3 font-mono">
                        <span className="text-emerald-700 dark:text-emerald-300">
                          Siap hapus permanen: <strong>{actionBatchDeps.eligibleCount}</strong>
                        </span>
                        <span className="text-rose-700 dark:text-rose-300">
                          Diblokir relasi FK: <strong>{actionBatchDeps.blockedCount}</strong>
                        </span>
                      </div>
                      {actionModal.mode === 'permanent_delete' && actionBatchDeps.blockedCount > 0 && (
                        <div className="p-2.5 rounded-lg bg-rose-100 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 space-y-2">
                          <div>
                            <strong>DITOLAK (Zero-Cascade):</strong> {actionBatchDeps.blockedCount} WO masih memiliki data historis atau dilindungi. Gunakan Soft Delete atau keluarkan item terblokir sebelum eksekusi.
                          </div>
                          {actionBatchDeps.eligibleCount > 0 && (
                            <button
                              type="button"
                              onClick={handleExcludeBlockedFromModal}
                              className="btn-3d-lilac px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer"
                            >
                              Keluarkan {actionBatchDeps.blockedCount} data terblokir
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Reason Input */}
              {!activePermOp && (
                <div>
                  <label
                    htmlFor="deletion-reason-textarea"
                    className="block font-bold text-[#26394E] dark:text-[#E8DDFF] mb-1"
                  >
                    Alasan {actionModal.mode === 'restore' ? 'Pemulihan (Opsional)' : 'Penghapusan (Wajib min. 5 karakter)'}
                  </label>
                  <textarea
                    id="deletion-reason-textarea"
                    rows={2}
                    data-testid="deletion-reason-input"
                    disabled={isSubmittingAction}
                    value={actionReason}
                    onChange={e => setActionReason(e.target.value)}
                    placeholder="Contoh: Duplikasi impor WO atau permintaan koreksi operasional..."
                    className="tactile-debossed-input w-full px-3 py-2 rounded-xl text-[#26394E] dark:text-white"
                  />
                </div>
              )}

              {/* Exact Confirmation Text for Permanent Delete (Single or Multi) */}
              {!activePermOp && actionModal.mode === 'permanent_delete' && actionModal.targets.length > 0 && (
                <div>
                  <label
                    htmlFor="permanent-confirm-input"
                    className="block font-bold text-rose-700 dark:text-rose-300 mb-1"
                  >
                    Ketik persis{' '}
                    <code className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950 font-mono">
                      {expectedPermanentPhrase}
                    </code>{' '}
                    untuk konfirmasi hapus permanen:
                  </label>
                  <input
                    id="permanent-confirm-input"
                    type="text"
                    data-testid="permanent-confirm-input"
                    disabled={isSubmittingAction}
                    value={permanentConfirmText}
                    onChange={e => setPermanentConfirmText(e.target.value)}
                    placeholder={`Ketik "${expectedPermanentPhrase}"...`}
                    className="tactile-debossed-input w-full px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-mono"
                  />
                </div>
              )}
            </>
          )}

          {actionProgressText && (
            <div className="p-2.5 rounded-xl bg-[#EAE8FF] dark:bg-[#2A174B] border border-[#C5BEEF] dark:border-[#5B289B] text-[#5145A6] dark:text-[#E8DDFF] text-[11px] font-semibold flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{actionProgressText}</span>
            </div>
          )}

          {actionError && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] font-semibold">
              {actionError}
            </div>
          )}
        </div>
      </ResponsiveModal>
    </div>
  );
};
