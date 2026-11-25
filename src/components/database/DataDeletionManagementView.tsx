import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  WoDependencySummary,
  DeletionLogRecord,
  fetchDeletionCategoriesSummary,
  fetchDeletionItems,
  inspectRecordDependencies,
  executeCentralizedSoftDelete,
  executeCentralizedPermanentDelete,
  executeCentralizedRestore,
  fetchDeletionHistory
} from '../../services/deletionManagementService';
import {
  Trash2,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  History,
  Search,
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
  AlertCircle
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

const SUB_ENTITY_OPTIONS: Array<{ id: DeletionSubEntity; label: string }> = [
  { id: 'all', label: 'Semua Sub-Entitas' },
  { id: 'users', label: 'Akun Pengguna (Users)' },
  { id: 'contractors', label: 'Kontraktor / Vendor' },
  { id: 'coverage_areas', label: 'Coverage Area' },
  { id: 'wa_templates', label: 'Template WhatsApp' },
  { id: 'droplist_items', label: 'Item Droplist' },
  { id: 'chat_categories', label: 'Kategori LiveChat' }
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
  const [selectedSubEntity, setSelectedSubEntity] = useState<DeletionSubEntity>(
    initialContext?.subEntity || 'all'
  );

  // Sync deep-link context when triggered externally
  useEffect(() => {
    if (!initialContext) return;
    if (initialContext.category && (isSuperAdmin || initialContext.category === 'work_orders')) {
      setSelectedCategory(initialContext.category);
    }
    if (initialContext.subEntity) {
      setSelectedSubEntity(initialContext.subEntity);
    }
    if (initialContext.mode) {
      if (isSuperAdmin || initialContext.mode === 'soft_delete') {
        setActiveTab(initialContext.mode);
      }
    }
    if (typeof initialContext.search === 'string') {
      setSearch(initialContext.search);
    }
    setPage(1);
    setSelectedIds([]);
  }, [initialContext, isSuperAdmin]);

  // Ensure import_staging switches away from unsupported soft_delete/restore tab
  useEffect(() => {
    if (selectedCategory === 'import_staging' && (activeTab === 'soft_delete' || activeTab === 'restore')) {
      setActiveTab('permanent_delete');
    }
  }, [selectedCategory, activeTab]);

  // Filters & Pagination
  const [search, setSearch] = useState(initialContext?.search || '');
  const [debouncedSearch, setDebouncedSearch] = useState(initialContext?.search || '');
  const [contractorFilter, setContractorFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [appointmentDateFilter, setAppointmentDateFilter] = useState('');
  const [deletionStatusFilter, setDeletionStatusFilter] = useState<'all' | 'active' | 'soft_deleted'>('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Data state
  const [summary, setSummary] = useState<CategoryCountsSummaryMap | null>(null);
  const [items, setItems] = useState<DeletionItemRow[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // History filters & data
  const [historyLogs, setHistoryLogs] = useState<DeletionLogRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState('');
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState('all');
  const [historyTypeFilter, setHistoryTypeFilter] = useState('all');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Modals: Detail, Action Confirmation (Soft Delete / Permanent Delete / Restore)
  const [detailItem, setDetailItem] = useState<DeletionItemRow | null>(null);
  const [detailDeps, setDetailDeps] = useState<WoDependencySummary | null>(null);
  const [isLoadingDetailDeps, setIsLoadingDetailDeps] = useState(false);

  const [actionModal, setActionModal] = useState<{
    open: boolean;
    mode: DeletionMode;
    targets: DeletionItemRow[];
  }>({ open: false, mode: 'soft_delete', targets: [] });
  const [actionReason, setActionReason] = useState('');
  const [permanentConfirmText, setPermanentConfirmText] = useState('');
  const [actionDeps, setActionDeps] = useState<WoDependencySummary | null>(null);
  const [isLoadingActionDeps, setIsLoadingActionDeps] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [search]);

  // Adjust default deletionStatus filter per tab
  useEffect(() => {
    if (activeTab === 'soft_delete') {
      setDeletionStatusFilter('active');
    } else if (activeTab === 'restore') {
      setDeletionStatusFilter('soft_deleted');
    } else if (activeTab === 'permanent_delete') {
      setDeletionStatusFilter('all');
    }
    setSelectedIds([]);
    setPage(1);
  }, [activeTab]);

  const loadSummary = useCallback(async () => {
    if (!hasAccess) return;
    const res = await fetchDeletionCategoriesSummary();
    if (res.success && res.summary) {
      setSummary(res.summary);
    }
  }, [hasAccess]);

  const loadItems = useCallback(async () => {
    if (!hasAccess || activeTab === 'history') return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetchDeletionItems({
        category: selectedCategory,
        subEntity: selectedCategory === 'other_data' ? selectedSubEntity : undefined,
        mode: activeTab,
        search: debouncedSearch,
        contractor: contractorFilter,
        area: areaFilter,
        appointmentDate: appointmentDateFilter,
        deletionStatus: deletionStatusFilter,
        page,
        pageSize
      });
      if (!res.success) {
        setLoadError(res.error || 'Gagal memuat daftar data.');
        setItems([]);
        setTotalItems(0);
        setTotalPages(1);
      } else {
        setItems(res.items || []);
        setTotalItems(res.total || 0);
        setTotalPages(res.totalPages || 1);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Gagal menghubungi server.');
    } finally {
      setIsLoading(false);
    }
  }, [
    hasAccess,
    activeTab,
    selectedCategory,
    selectedSubEntity,
    debouncedSearch,
    contractorFilter,
    areaFilter,
    appointmentDateFilter,
    deletionStatusFilter,
    page,
    pageSize
  ]);

  const loadHistory = useCallback(async () => {
    if (!hasAccess || activeTab !== 'history') return;
    setIsLoadingHistory(true);
    try {
      const res = await fetchDeletionHistory({
        search: historySearch,
        category: historyCategoryFilter,
        deletionType: historyTypeFilter,
        status: historyStatusFilter,
        dateFrom: historyDateFrom,
        dateTo: historyDateTo,
        page: historyPage,
        pageSize: 25
      });
      if (res.success) {
        setHistoryLogs(res.logs || []);
        setHistoryTotal(res.total || 0);
        setHistoryTotalPages(res.totalPages || 1);
      } else {
        toast.error(res.error || 'Gagal memuat Deletion History.');
      }
    } finally {
      setIsLoadingHistory(false);
    }
  }, [
    hasAccess,
    activeTab,
    historySearch,
    historyCategoryFilter,
    historyTypeFilter,
    historyStatusFilter,
    historyDateFrom,
    historyDateTo,
    historyPage,
    toast
  ]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (activeTab === 'history') {
      void loadHistory();
    } else {
      void loadItems();
    }
  }, [activeTab, loadItems, loadHistory]);

  const handleOpenDetail = async (row: DeletionItemRow) => {
    setDetailItem(row);
    setDetailDeps(null);
    if (row.category === 'work_orders') {
      setIsLoadingDetailDeps(true);
      try {
        const res = await inspectRecordDependencies('work_orders', row.id);
        if (res.success && res.dependencies) {
          setDetailDeps(res.dependencies);
        }
      } finally {
        setIsLoadingDetailDeps(false);
      }
    }
  };

  const handleOpenActionModal = async (mode: DeletionMode, targets: DeletionItemRow[]) => {
    if (targets.length === 0) return;
    setActionModal({ open: true, mode, targets });
    setActionReason(mode === 'restore' ? 'Pemulihan data melalui Data Deletion Management' : '');
    setPermanentConfirmText('');
    setActionError(null);
    setActionDeps(null);

    if (targets.length === 1 && targets[0].category === 'work_orders') {
      setIsLoadingActionDeps(true);
      try {
        const res = await inspectRecordDependencies('work_orders', targets[0].id);
        if (res.success && res.dependencies) {
          setActionDeps(res.dependencies);
        } else if (res.error) {
          setActionError(res.error);
        }
      } finally {
        setIsLoadingActionDeps(false);
      }
    }
  };

  const handleConfirmAction = async () => {
    if (isSubmittingAction) return;
    const { mode, targets } = actionModal;
    if (targets.length === 0) return;

    const cleanReason = actionReason.trim();
    if (mode !== 'restore' && cleanReason.length < 5) {
      setActionError('Alasan wajib diisi minimal 5 karakter.');
      return;
    }

    if (mode === 'permanent_delete') {
      if (targets.length !== 1) {
        setActionError('Hapus permanen hanya boleh dieksekusi satu record per transaksi.');
        return;
      }
      const t = targets[0];
      const expectedText = t.category === 'work_orders' ? String(t.woNumber || t.id) : String(t.id);
      if (t.category === 'work_orders') {
        if (permanentConfirmText.trim().toUpperCase() !== expectedText.trim().toUpperCase()) {
          setActionError(`Ketik persis WO Number "${expectedText}" untuk melanjutkan hapus permanen.`);
          return;
        }
      } else if (!permanentConfirmText.trim()) {
        setActionError(`Ketik persis ID "${expectedText}" untuk konfirmasi hapus permanen.`);
        return;
      } else if (permanentConfirmText.trim() !== expectedText.trim() && permanentConfirmText.trim() !== String(t.label || '').trim()) {
        setActionError(`Konfirmasi teks tidak cocok. Ketik "${expectedText}".`);
        return;
      }
    }

    setIsSubmittingAction(true);
    setActionError(null);
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
        const t = targets[0];
        const res = await executeCentralizedPermanentDelete({
          category: t.category,
          subEntity: t.subEntity,
          recordId: t.id,
          confirmText: permanentConfirmText.trim(),
          reason: cleanReason
        });
        if (!res.success) {
          setActionError(res.error || 'Hapus permanen ditolak oleh server.');
          return;
        }
        toast.success(res.message || 'Data berhasil dihapus permanen.', 'Hapus Permanen Berhasil');
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
      // Synchronize global AppContext state with authoritative database
      await Promise.allSettled([
        refreshDatabaseData(),
        refreshActiveTickets(),
        refreshKpiSummary({ silent: true })
      ]);
    } catch (err: any) {
      setActionError(err?.message || 'Terjadi kesalahan saat memproses permintaan.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const selectableItems = useMemo(() => {
    return items.filter(item => {
      if (item.isProtected || item.isLockedActive) return false;
      if (activeTab === 'soft_delete') return !item.isDeleted;
      if (activeTab === 'restore') return item.isDeleted;
      return false;
    });
  }, [items, activeTab]);

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

  return (
    <div className="space-y-5" data-testid="data-deletion-management-view">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-[#F3F8FC] via-[#EAE8FF] to-[#D8F0F0] border border-[#C5BEEF] text-[#26394E] shadow-md dark:from-[#160D29] dark:via-[#27104A] dark:to-[#1A0D36] dark:border-[#4A2580] dark:text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 border border-[#C5BEEF] text-[#5145A6] dark:bg-[#35105E] dark:border-[#7135B5]/60 dark:text-[#E8DDFF] text-[10.5px] font-extrabold uppercase tracking-wider mb-2">
            <Trash2 className="w-3.5 h-3.5" />
            <span>Database Application · Centralized Deletion Control</span>
          </div>
          <h2 className="text-xl font-display font-black tracking-tight text-[#26394E] dark:text-white">
            Database Deletion Management
          </h2>
          <p className="text-xs text-[#52647A] dark:text-[#D9CCF2] mt-1 max-w-2xl">
            Pusat kendali tunggal untuk Soft Delete, Hapus Permanen (Superadmin), Pemulihan Data (Restore), pemeriksaan dependensi FK, dan Audit Log Penghapusan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              void loadSummary();
              if (activeTab === 'history') void loadHistory();
              else void loadItems();
            }}
            disabled={isLoading || isLoadingHistory}
            className="btn-3d-lilac px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(isLoading || isLoadingHistory) ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <span className="px-3 py-1.5 rounded-xl bg-white/90 border border-[#C5BEEF] text-[#5145A6] dark:bg-[#35105E] dark:border-[#7135B5]/60 dark:text-[#E8DDFF] text-xs font-bold flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>{isSuperAdmin ? 'Superadmin (Full Control)' : 'Dispatch (WO Soft Delete)'}</span>
          </span>
        </div>
      </div>

      {/* 4 Main Operational Tabs */}
      <div className="mj-tactile-tab-bar p-1.5 rounded-2xl flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="tablist">
        {[
          {
            id: 'soft_delete' as ActiveTabMode,
            label: 'Soft Delete',
            icon: Trash2,
            visible: true
          },
          {
            id: 'permanent_delete' as ActiveTabMode,
            label: 'Permanent Delete',
            icon: ShieldAlert,
            visible: isSuperAdmin
          },
          {
            id: 'restore' as ActiveTabMode,
            label: 'Restore',
            icon: RotateCcw,
            visible: isSuperAdmin
          },
          {
            id: 'history' as ActiveTabMode,
            label: 'Deletion History',
            icon: History,
            visible: true
          }
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
                onClick={() => setActiveTab(tab.id)}
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

      {/* Category Selector (shown for Soft Delete, Permanent Delete, Restore) */}
      {activeTab !== 'history' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
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
                className={`p-3 rounded-2xl text-left transition-all cursor-pointer border flex flex-col justify-between gap-2 ${
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
        <div className="space-y-4">
          {/* Safety Notice for Permanent Delete */}
          {activeTab === 'permanent_delete' && (
            <div className="p-3.5 rounded-2xl bg-rose-50/90 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong>Kebijakan Zero-Cascade &amp; Perlindungan Data Historis:</strong> Hapus permanen pada Work Order
                <strong> otomatis DITOLAK</strong> apabila masih terdapat relasi di <code>assignment_history</code>,{' '}
                <code>ticket_messages</code>, <code>technical_reports</code>, atau <code>attachments</code>. Gunakan{' '}
                <strong>Soft Delete</strong> untuk penghapusan operasional sehari-hari.
              </div>
            </div>
          )}

          {/* Search & Filters Card */}
          <div className="card-3d-lavender p-4 rounded-2xl space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-[#8492A5] dark:text-[#A78BFA] shrink-0" />
                <input
                  type="text"
                  data-testid="deletion-search-input"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={
                    selectedCategory === 'work_orders'
                      ? 'Cari WO Number, Customer ID, Nama Pelanggan, Kontraktor, Area...'
                      : `Cari data pada ${activeCategoryMeta.label}...`
                  }
                  className="tactile-debossed-input w-full px-3 py-2 rounded-xl text-[#26394E] dark:text-white"
                />
              </div>

              {selectedCategory === 'other_data' && (
                <select
                  value={selectedSubEntity}
                  onChange={e => {
                    setSelectedSubEntity(e.target.value as DeletionSubEntity);
                    setPage(1);
                    setSelectedIds([]);
                  }}
                  className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
                >
                  {SUB_ENTITY_OPTIONS.map(opt => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {selectedCategory === 'work_orders' && (
                <>
                  <input
                    type="date"
                    value={appointmentDateFilter}
                    onChange={e => {
                      setAppointmentDateFilter(e.target.value);
                      setPage(1);
                    }}
                    title="Filter Appointment Date"
                    className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
                  />
                  <select
                    value={contractorFilter}
                    onChange={e => {
                      setContractorFilter(e.target.value);
                      setPage(1);
                    }}
                    className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
                  >
                    <option value="all">Semua Kontraktor</option>
                    {contractors.map((c, idx) => (
                      <option key={`del-con-${c.id || c.name}-${idx}`} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={areaFilter}
                    onChange={e => {
                      setAreaFilter(e.target.value);
                      setPage(1);
                    }}
                    className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
                  >
                    <option value="all">Semua Area</option>
                    {coverageAreas.map((a, idx) => (
                      <option key={`del-area-${a.id || a.name}-${idx}`} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <select
                value={deletionStatusFilter}
                onChange={e => {
                  setDeletionStatusFilter(e.target.value as 'all' | 'active' | 'soft_deleted');
                  setPage(1);
                }}
                className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
              >
                <option value="active">Status: Aktif</option>
                <option value="soft_deleted">Status: Soft Deleted</option>
                <option value="all">Status: Semua</option>
              </select>

              {(search || contractorFilter !== 'all' || areaFilter !== 'all' || appointmentDateFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setDebouncedSearch('');
                    setContractorFilter('all');
                    setAreaFilter('all');
                    setAppointmentDateFilter('');
                    setPage(1);
                  }}
                  className="btn-3d-lilac px-3 py-2 rounded-xl font-bold cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Bulk Action Bar */}
            {selectedRows.length > 0 && (activeTab === 'soft_delete' || activeTab === 'restore') && (
              <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#5145A6] dark:text-[#E8DDFF]">
                  {selectedRows.length} data dipilih pada kategori {activeCategoryMeta.shortLabel}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="btn-3d-lilac px-3 py-1.5 rounded-xl font-bold cursor-pointer"
                  >
                    Batal Pilih
                  </button>
                  {activeTab === 'soft_delete' && (
                    <button
                      type="button"
                      data-testid="bulk-soft-delete-btn"
                      onClick={() => void handleOpenActionModal('soft_delete', selectedRows)}
                      className="btn-3d-crimson px-3.5 py-1.5 rounded-xl text-white font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Soft Delete ({selectedRows.length})</span>
                    </button>
                  )}
                  {activeTab === 'restore' && isSuperAdmin && (
                    <button
                      type="button"
                      data-testid="bulk-restore-btn"
                      onClick={() => void handleOpenActionModal('restore', selectedRows)}
                      className="btn-3d-emerald px-3.5 py-1.5 rounded-xl text-white font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Pulihkan ({selectedRows.length})</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error Notice */}
          {loadError && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          )}

          {/* Data Table */}
          <div className="card-3d-lavender rounded-2xl overflow-hidden border border-[#DDE6F0] dark:border-[#35105E]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#EDF3F8]/90 dark:bg-[#22123F] border-b border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#D8B4FE] text-[11px] uppercase tracking-wider font-extrabold">
                    {(activeTab === 'soft_delete' || activeTab === 'restore') && (
                      <th className="py-3 px-3 w-10">
                        <input
                          type="checkbox"
                          checked={allSelectableChecked}
                          onChange={toggleSelectAll}
                          disabled={selectableItems.length === 0}
                          aria-label="Pilih semua baris"
                          className="rounded border-[#C5BEEF] text-[#6657C8] cursor-pointer"
                        />
                      </th>
                    )}
                    {selectedCategory === 'work_orders' ? (
                      <>
                        <th className="py-3 px-3">WO Number</th>
                        <th className="py-3 px-3">Customer ID</th>
                        <th className="py-3 px-3">Customer Name</th>
                        <th className="py-3 px-3">Appointment Date</th>
                        <th className="py-3 px-3">Contractor</th>
                        <th className="py-3 px-3">Area</th>
                        <th className="py-3 px-3">Assignment Status</th>
                        <th className="py-3 px-3">Deletion Status</th>
                        <th className="py-3 px-3 text-right">Action</th>
                      </>
                    ) : (
                      <>
                        <th className="py-3 px-3">ID / Referensi</th>
                        <th className="py-3 px-3">WO / Sub-Entitas</th>
                        <th className="py-3 px-3">Ringkasan Data</th>
                        <th className="py-3 px-3">Tanggal / Aktor</th>
                        <th className="py-3 px-3">Deletion Status</th>
                        <th className="py-3 px-3 text-right">Action</th>
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
                      const canSelect =
                        !row.isProtected &&
                        !row.isLockedActive &&
                        ((activeTab === 'soft_delete' && !row.isDeleted) ||
                          (activeTab === 'restore' && row.isDeleted));
                      const isChecked = selectedIds.includes(row.id);

                      return (
                        <tr
                          key={`${row.category}-${row.subEntity || 'main'}-${row.id}`}
                          className="bg-white/80 dark:bg-[#160D29]/60 hover:bg-[#F3F8FC] dark:hover:bg-[#27104A]/70 transition-colors"
                        >
                          {(activeTab === 'soft_delete' || activeTab === 'restore') && (
                            <td className="py-3 px-3">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!canSelect}
                                onChange={() => toggleSelectId(row.id)}
                                aria-label={`Pilih ${row.woNumber || row.id}`}
                                className="rounded border-[#C5BEEF] text-[#6657C8] cursor-pointer disabled:opacity-40"
                              />
                            </td>
                          )}

                          {selectedCategory === 'work_orders' ? (
                            <>
                              <td className="py-3 px-3 font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] whitespace-nowrap">
                                {row.woNumber || row.id}
                              </td>
                              <td className="py-3 px-3 font-mono text-[#26394E] dark:text-[#E8DDFF] whitespace-nowrap">
                                {row.customerId || '-'}
                              </td>
                              <td className="py-3 px-3 font-semibold text-[#26394E] dark:text-white max-w-[180px] truncate">
                                {row.customerName || '-'}
                              </td>
                              <td className="py-3 px-3 font-mono whitespace-nowrap text-[#26394E] dark:text-[#D9CCF2]">
                                {row.appointmentDate || '-'}
                              </td>
                              <td className="py-3 px-3 text-[#26394E] dark:text-[#D9CCF2] max-w-[150px] truncate">
                                {row.contractor || '-'}
                              </td>
                              <td className="py-3 px-3 text-[#26394E] dark:text-[#D9CCF2] whitespace-nowrap">
                                {row.area || '-'}
                              </td>
                              <td className="py-3 px-3 text-[#52647A] dark:text-[#CEC0E8] whitespace-nowrap">
                                {row.assignmentStatus || 'Unassigned'}
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap">{renderStatusBadge(row)}</td>
                            </>
                          ) : (
                            <>
                              <td className="py-3 px-3 font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] max-w-[160px] truncate">
                                {row.id}
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap">
                                {row.woNumber ? (
                                  <span className="font-mono font-semibold text-[#26394E] dark:text-white">{row.woNumber}</span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#E8DDFF] text-[10px] font-bold">
                                    {row.subEntity || row.category}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3 max-w-[260px] truncate text-[#26394E] dark:text-[#E8DDFF]">
                                {row.label ||
                                  row.fileName ||
                                  row.importName ||
                                  row.sourceFile ||
                                  row.message ||
                                  row.notes ||
                                  row.installerName ||
                                  '-'}
                              </td>
                              <td className="py-3 px-3 text-[#52647A] dark:text-[#A78BFA] whitespace-nowrap">
                                <div>{row.senderName || row.importedBy || row.assignedBy || row.role || '-'}</div>
                                {row.createdAt && (
                                  <div className="text-[10px] font-mono">
                                    {new Date(row.createdAt).toLocaleString('id-ID')}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap">{renderStatusBadge(row)}</td>
                            </>
                          )}

                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleOpenDetail(row)}
                                className="btn-3d-lilac p-1.5 min-h-[32px] rounded-lg cursor-pointer"
                                title="Detail & Dependensi"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {activeTab === 'soft_delete' && !row.isDeleted && activeCategoryMeta.supportsSoftDelete && (
                                <button
                                  type="button"
                                  disabled={Boolean(row.isProtected || row.isLockedActive)}
                                  onClick={() => void handleOpenActionModal('soft_delete', [row])}
                                  className="btn-3d-crimson px-2.5 py-1.5 min-h-[32px] rounded-lg text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Soft Delete</span>
                                </button>
                              )}

                              {activeTab === 'permanent_delete' && isSuperAdmin && (
                                <button
                                  type="button"
                                  disabled={Boolean(row.isProtected || row.isLockedActive)}
                                  onClick={() => void handleOpenActionModal('permanent_delete', [row])}
                                  className="btn-3d-crimson px-2.5 py-1.5 min-h-[32px] rounded-lg text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                  <ShieldAlert className="w-3 h-3" />
                                  <span>Hapus Permanen</span>
                                </button>
                              )}

                              {activeTab === 'restore' && isSuperAdmin && row.isDeleted && activeCategoryMeta.supportsRestore && (
                                <button
                                  type="button"
                                  onClick={() => void handleOpenActionModal('restore', [row])}
                                  className="btn-3d-emerald px-2.5 py-1.5 min-h-[32px] rounded-lg text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Restore</span>
                                </button>
                              )}
                            </div>
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

      {/* TAB CONTENT: DELETION HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="card-3d-lavender p-4 rounded-2xl flex flex-wrap items-center gap-2.5 text-xs">
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-[#8492A5] dark:text-[#A78BFA] shrink-0" />
              <input
                type="text"
                value={historySearch}
                onChange={e => {
                  setHistorySearch(e.target.value);
                  setHistoryPage(1);
                }}
                placeholder="Cari WO Number, Record ID, Aktor, Alasan, Transaction ID..."
                className="tactile-debossed-input w-full px-3 py-2 rounded-xl text-[#26394E] dark:text-white"
              />
            </div>

            <select
              value={historyCategoryFilter}
              onChange={e => {
                setHistoryCategoryFilter(e.target.value);
                setHistoryPage(1);
              }}
              className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
            >
              <option value="all">Semua Kategori</option>
              {DELETION_CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>
                  {c.shortLabel}
                </option>
              ))}
            </select>

            <select
              value={historyTypeFilter}
              onChange={e => {
                setHistoryTypeFilter(e.target.value);
                setHistoryPage(1);
              }}
              className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
            >
              <option value="all">Semua Tipe Aksi</option>
              <option value="soft_delete">Soft Delete</option>
              <option value="permanent_delete">Permanent Delete</option>
              <option value="restore">Restore</option>
            </select>

            <select
              value={historyStatusFilter}
              onChange={e => {
                setHistoryStatusFilter(e.target.value);
                setHistoryPage(1);
              }}
              className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
            >
              <option value="all">Semua Status</option>
              <option value="success">Success</option>
              <option value="rejected">Rejected</option>
              <option value="failed">Failed</option>
            </select>

            <input
              type="date"
              value={historyDateFrom}
              onChange={e => {
                setHistoryDateFrom(e.target.value);
                setHistoryPage(1);
              }}
              title="Dari tanggal"
              className="tactile-debossed-input px-2.5 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
            />
            <input
              type="date"
              value={historyDateTo}
              onChange={e => {
                setHistoryDateTo(e.target.value);
                setHistoryPage(1);
              }}
              title="Sampai tanggal"
              className="tactile-debossed-input px-2.5 py-2 rounded-xl text-[#26394E] dark:text-white font-semibold"
            />
          </div>

          <div className="card-3d-lavender rounded-2xl overflow-hidden border border-[#DDE6F0] dark:border-[#35105E]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#EDF3F8]/90 dark:bg-[#22123F] border-b border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#D8B4FE] text-[11px] uppercase tracking-wider font-extrabold">
                    <th className="py-3 px-3">Waktu &amp; Tx ID</th>
                    <th className="py-3 px-3">Tipe</th>
                    <th className="py-3 px-3">Kategori / Tabel</th>
                    <th className="py-3 px-3">WO / Record ID</th>
                    <th className="py-3 px-3">Eksekutor</th>
                    <th className="py-3 px-3">Alasan &amp; Catatan</th>
                    <th className="py-3 px-3">Status</th>
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
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={historyPage >= historyTotalPages}
                  onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                  className="btn-3d-lilac p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
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

      {/* CONFIRMATION MODAL: SOFT DELETE / PERMANENT DELETE / RESTORE */}
      <ResponsiveModal
        isOpen={actionModal.open}
        onClose={() => !isSubmittingAction && setActionModal({ open: false, mode: 'soft_delete', targets: [] })}
        title={
          actionModal.mode === 'permanent_delete'
            ? 'Konfirmasi Hapus Permanen (Permanent Delete)'
            : actionModal.mode === 'restore'
            ? 'Konfirmasi Pemulihan Data (Restore)'
            : 'Konfirmasi Soft Delete Data'
        }
        subtitle={`${actionModal.targets.length} record dipilih`}
        icon={
          actionModal.mode === 'permanent_delete' ? (
            <ShieldAlert className="w-4 h-4 text-rose-600" />
          ) : actionModal.mode === 'restore' ? (
            <RotateCcw className="w-4 h-4 text-emerald-600" />
          ) : (
            <Trash2 className="w-4 h-4 text-rose-600" />
          )
        }
        size="md"
        mobileVariant="sheet"
        footer={
          <>
            <button
              type="button"
              disabled={isSubmittingAction}
              onClick={() => setActionModal({ open: false, mode: 'soft_delete', targets: [] })}
              className="btn-3d-lilac px-4 py-2 min-h-[38px] rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="button"
              data-testid="confirm-deletion-action-btn"
              disabled={
                isSubmittingAction ||
                isLoadingActionDeps ||
                (actionModal.mode === 'permanent_delete' && Boolean(actionDeps && !actionDeps.canPermanentDelete))
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
                <span>Eksekusi Hapus Permanen</span>
              ) : actionModal.mode === 'restore' ? (
                <span>Pulihkan Data Sekarang</span>
              ) : (
                <span>Konfirmasi Soft Delete</span>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          {/* Selected summary */}
          <div className="p-3 rounded-xl bg-[#F3F8FC] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-1 max-h-32 overflow-y-auto">
            {actionModal.targets.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">
                  {t.woNumber || t.label || t.id}
                </span>
                <span className="text-[11px] text-[#52647A] dark:text-[#A78BFA] truncate">
                  {t.customerName || t.subEntity || t.category}
                </span>
              </div>
            ))}
          </div>

          {/* WO Dependency Inspection Block */}
          {actionModal.targets.length === 1 && actionModal.targets[0].category === 'work_orders' && (
            <div className="p-3.5 rounded-xl bg-[#EAE8FF]/60 dark:bg-[#22123F] border border-[#C5BEEF] dark:border-[#4A2580] space-y-2">
              <div className="font-bold text-[#5145A6] dark:text-[#E8DDFF] flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Pemeriksaan Dependensi Relasi WO</span>
              </div>
              {isLoadingActionDeps ? (
                <div className="text-[#52647A] dark:text-[#CEC0E8]">Memeriksa assignment_history, ticket_messages, technical_reports, attachments...</div>
              ) : actionDeps ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <div>assignment_history: <strong>{actionDeps.counts.assignment_history}</strong></div>
                    <div>ticket_messages: <strong>{actionDeps.counts.ticket_messages}</strong></div>
                    <div>technical_reports: <strong>{actionDeps.counts.technical_reports}</strong></div>
                    <div>attachments: <strong>{actionDeps.counts.attachments}</strong></div>
                  </div>
                  {actionModal.mode === 'soft_delete' && (
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                      Soft delete aman: seluruh histori assignment, LiveChat, laporan teknisi, dan lampiran tetap terjaga di database.
                    </div>
                  )}
                  {actionModal.mode === 'permanent_delete' && !actionDeps.canPermanentDelete && (
                    <div className="p-2.5 rounded-lg bg-rose-100 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-[11px]">
                      <strong>DITOLAK (Zero-Cascade):</strong> {actionDeps.blockingReasons.join(' ')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Reason Input */}
          <div>
            <label className="block font-bold text-[#26394E] dark:text-[#E8DDFF] mb-1">
              Alasan {actionModal.mode === 'restore' ? 'Pemulihan (Opsional)' : 'Penghapusan (Wajib min. 5 karakter)'}
            </label>
            <textarea
              rows={2}
              data-testid="deletion-reason-input"
              value={actionReason}
              onChange={e => setActionReason(e.target.value)}
              placeholder="Contoh: Duplikasi impor WO atau permintaan koreksi operasional..."
              className="tactile-debossed-input w-full px-3 py-2 rounded-xl text-[#26394E] dark:text-white"
            />
          </div>

          {/* Exact WO Number / ID Confirmation for Permanent Delete */}
          {actionModal.mode === 'permanent_delete' && actionModal.targets.length === 1 && (
            <div>
              <label className="block font-bold text-rose-700 dark:text-rose-300 mb-1">
                Ketik persis{' '}
                <code className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950 font-mono">
                  {actionModal.targets[0].category === 'work_orders'
                    ? actionModal.targets[0].woNumber || actionModal.targets[0].id
                    : actionModal.targets[0].id}
                </code>{' '}
                untuk konfirmasi hapus permanen:
              </label>
              <input
                type="text"
                data-testid="permanent-confirm-input"
                value={permanentConfirmText}
                onChange={e => setPermanentConfirmText(e.target.value)}
                placeholder="Ketik konfirmasi persis..."
                className="tactile-debossed-input w-full px-3 py-2 rounded-xl text-[#26394E] dark:text-white font-mono"
              />
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
