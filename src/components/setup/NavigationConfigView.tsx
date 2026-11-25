import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { useToast } from '../../context/ToastContext';
import { NavCategoryConfig, StandaloneMenuItem, NavSubmenuItem } from '../../types';
import { ResponsiveModal } from '../common/ResponsiveModal';
import {
  FolderTree,
  Save,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Cloud,
  Edit2,
  Check,
  X,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Layers,
  Eye,
  LayoutDashboard,
  Building2,
  Wrench,
  MessageSquare,
  FileSpreadsheet,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  SlidersHorizontal,
  Smartphone,
  Calendar,
  Ticket as TicketIcon,
  Zap,
  UserCheck,
  BarChart3,
  UserPlus,
  History,
  KeyRound,
  Activity,
  Bell,
  Settings as SettingsIcon,
  Database,
  Users2,
  ListOrdered,
  Plus,
  Trash2,
  GripVertical,
  Folder,
  FileText,
  RefreshCw,
  ArrowRightLeft,
  ChevronRight
} from 'lucide-react';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import {
  HeaderSearchPopover,
  HeaderCategoryDropdown,
  HeaderSortButton,
  TableResetFilterButton
} from '../common/InteractiveTableHeader';
import { TableSelectionToolbar } from '../common/TableSelectionToolbar';
import { SortState, getNextSortDirection, sortDataArray } from '../../utils/tableSorting';

const AVAILABLE_ICONS: { name: string; label: string; component: React.ElementType }[] = [
  { name: 'LayoutDashboard', label: 'Dashboard', component: LayoutDashboard },
  { name: 'Ticket', label: 'Tiket', component: TicketIcon },
  { name: 'FileSpreadsheet', label: 'Spreadsheet', component: FileSpreadsheet },
  { name: 'MessageSquare', label: 'Pesan', component: MessageSquare },
  { name: 'Calendar', label: 'Kalender', component: Calendar },
  { name: 'Users2', label: 'Pengguna', component: Users2 },
  { name: 'Building2', label: 'Kontraktor', component: Building2 },
  { name: 'Wrench', label: 'Teknisi / Alat', component: Wrench },
  { name: 'Sliders', label: 'Setup / Kontrol', component: Sliders },
  { name: 'UserCheck', label: 'Penugasan', component: UserCheck },
  { name: 'BarChart3', label: 'Grafik Progress', component: BarChart3 },
  { name: 'FileText', label: 'Laporan Teks', component: FileText },
  { name: 'SlidersHorizontal', label: 'Pengaturan Kuota', component: SlidersHorizontal },
  { name: 'UserPlus', label: 'Tambah User', component: UserPlus },
  { name: 'FolderTree', label: 'Folder Pohon', component: FolderTree },
  { name: 'ShieldCheck', label: 'Keamanan / Role', component: ShieldCheck },
  { name: 'ListOrdered', label: 'Daftar Kategori', component: ListOrdered },
  { name: 'Activity', label: 'Kesehatan Sistem', component: Activity },
  { name: 'Bell', label: 'Notifikasi', component: Bell },
  { name: 'History', label: 'Audit Trail', component: History },
  { name: 'KeyRound', label: 'Sesi / Kunci', component: KeyRound },
  { name: 'Settings', label: 'Pengaturan', component: SettingsIcon },
  { name: 'RefreshCw', label: 'Sinkronisasi', component: RefreshCw },
  { name: 'Database', label: 'Database', component: Database },
  { name: 'CheckCircle2', label: 'Selesai / Tugas', component: CheckCircle2 }
];

export const getIconComp = (iconName?: string): React.ElementType => {
  const match = AVAILABLE_ICONS.find(i => i.name === iconName);
  return match ? match.component : Folder;
};

export const NavigationConfigView: React.FC = () => {
  const { currentUser, addAuditLog } = useApp();
  const {
    navCategories,
    standaloneMenus,
    submenuItems,
    accordionSettings,
    addCategory,
    updateCategory,
    deleteCategory,
    moveCategoryItem,
    reorderCategories,
    toggleCategoryActive,
    setCategoryAccordionMode,
    addSubmenu,
    updateSubmenu,
    deleteSubmenu,
    moveSubmenu,
    reorderSubmenus,
    moveSubmenuToCategory,
    toggleSubmenuActive,
    updateStandaloneMenu,
    moveStandaloneMenu,
    reorderStandaloneMenus,
    toggleStandaloneMenuActive,
    deleteStandaloneMenu,
    setAllowMultipleOpenGroups,
    saveNavigationConfig,
    resetNavigationConfig,
    reloadNavigationFromSupabase,
    isCloudSyncing,
    lastCloudSyncTime,
    lastCloudSyncError,
    hasUnsavedNavChanges,
    cloudSyncStatus,
    navDocVersion
  } = useUIConfig();
  const { toast } = useToast();

  const isSuperadmin = currentUser?.role === 'super_admin';

  // Active section tab in configuration
  const [activeConfigTab, setActiveConfigTab] = useState<'categories' | 'standalone' | 'submenus'>('categories');

  // Saving & Resetting status
  const [isSaving, setIsSaving] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Category Edit / Add State
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraftName, setCategoryDraftName] = useState('');
  const [categoryDraftIcon, setCategoryDraftIcon] = useState('Building2');
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('Building2');
  const [newCategoryMode, setNewCategoryMode] = useState<'accordion' | 'static'>('accordion');

  // Delete Category / Submenu Modal State
  const [deletingCategory, setDeletingCategory] = useState<NavCategoryConfig | null>(null);
  const [deletingSubmenu, setDeletingSubmenu] = useState<NavSubmenuItem | null>(null);
  const [deleteSubmenuAction, setDeleteSubmenuAction] = useState<'move' | 'disable'>('move');
  const [deleteTargetCategoryId, setDeleteTargetCategoryId] = useState<string>('menu_tambahan');

  // Submenu Edit / Add State
  const [editingSubmenuId, setEditingSubmenuId] = useState<string | null>(null);
  const [submenuDraftLabel, setSubmenuDraftLabel] = useState('');
  const [submenuDraftIcon, setSubmenuDraftIcon] = useState('');
  const [submenuDraftCategory, setSubmenuDraftCategory] = useState('');
  const [showAddSubmenuModal, setShowAddSubmenuModal] = useState(false);
  const [newSubmenuLabel, setNewSubmenuLabel] = useState('');
  const [newSubmenuIcon, setNewSubmenuIcon] = useState('FileText');
  const [newSubmenuCategoryId, setNewSubmenuCategoryId] = useState('contractor_area');
  const [newSubmenuRoles, setNewSubmenuRoles] = useState<string[]>(['super_admin', 'dispatch', 'leader']);

  // Standalone Menu Edit State
  const [editingStandaloneId, setEditingStandaloneId] = useState<string | null>(null);
  const [standaloneDraftLabel, setStandaloneDraftLabel] = useState('');
  const [standaloneDraftIcon, setStandaloneDraftIcon] = useState('');

  const { isCompactUI } = useResponsiveViewport();

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<{
    type: 'category' | 'standalone' | 'submenu';
    id: string;
    sourceCategoryId?: string;
  } | null>(null);

  // Live Preview Modal
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewRole, setPreviewRole] = useState<'super_admin' | 'dispatch' | 'leader' | 'installer'>('super_admin');
  const [previewOpenGroups, setPreviewOpenGroups] = useState<Record<string, boolean>>({
    contractor_area: true,
    installer: false,
    menu_tambahan: true
  });
  const [expandedCategoryPreview, setExpandedCategoryPreview] = useState<Record<string, boolean>>({
    contractor_area: true
  });

  // Tab 2 (Menu Mandiri) Filter & Sort State
  const [standaloneSearch, setStandaloneSearch] = useState('');
  const [standaloneRoleFilter, setStandaloneRoleFilter] = useState<string>('all');
  const [standaloneStatusFilter, setStandaloneStatusFilter] = useState<string>('all');
  const [standaloneSort, setStandaloneSort] = useState<SortState>({ key: null, direction: null });

  // Tab 3 (Submenu Items) Filter, Collapse & Batch Move State
  const [submenuSearch, setSubmenuSearch] = useState('');
  const [submenuCategoryFilter, setSubmenuCategoryFilter] = useState<string>('all');
  const [submenuRoleFilter, setSubmenuRoleFilter] = useState<string>('all');
  const [submenuStatusFilter, setSubmenuStatusFilter] = useState<string>('all');
  const [submenuSort, setSubmenuSort] = useState<SortState>({ key: null, direction: null });
  const [collapsedSubmenuGroups, setCollapsedSubmenuGroups] = useState<Record<string, boolean>>({
    menu_tambahan: false
  });
  const [selectedSubmenuIds, setSelectedSubmenuIds] = useState<string[]>([]);
  const [batchTargetCategoryId, setBatchTargetCategoryId] = useState<string>('menu_tambahan');

  // Filtered categories and standalone menus
  const sortedCategories = useMemo(() => {
    return [...(navCategories || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [navCategories]);

  const sortedStandaloneMenus = useMemo(() => {
    return [...(standaloneMenus || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [standaloneMenus]);

  const filteredStandaloneMenus = useMemo(() => {
    const q = standaloneSearch.trim().toLowerCase();
    const list = sortedStandaloneMenus.filter(menu => {
      const matchesSearch =
        !q ||
        menu.label.toLowerCase().includes(q) ||
        menu.id.toLowerCase().includes(q) ||
        (menu.roles || []).some(r => r.toLowerCase().includes(q));
      const matchesRole =
        standaloneRoleFilter === 'all' ||
        (menu.roles || []).includes(standaloneRoleFilter);
      const matchesStatus =
        standaloneStatusFilter === 'all' ||
        (standaloneStatusFilter === 'active' ? menu.visible !== false : menu.visible === false);
      return matchesSearch && matchesRole && matchesStatus;
    });
    return sortDataArray(list, standaloneSort.key, standaloneSort.direction, (row, key) => {
      if (key === 'order') return row.order ?? 0;
      if (key === 'label') return row.label;
      if (key === 'status') return row.visible !== false ? 'Aktif' : 'Nonaktif';
      return (row as any)[key];
    });
  }, [sortedStandaloneMenus, standaloneSearch, standaloneRoleFilter, standaloneStatusFilter, standaloneSort]);

  const isStandaloneFiltered =
    standaloneSearch.trim() !== '' ||
    standaloneRoleFilter !== 'all' ||
    standaloneStatusFilter !== 'all' ||
    Boolean(standaloneSort.direction);

  const standaloneActiveFilterCount =
    (standaloneSearch.trim() ? 1 : 0) +
    (standaloneRoleFilter !== 'all' ? 1 : 0) +
    (standaloneStatusFilter !== 'all' ? 1 : 0) +
    (standaloneSort.direction ? 1 : 0);

  const isSubmenuFiltered =
    submenuSearch.trim() !== '' ||
    submenuCategoryFilter !== 'all' ||
    submenuRoleFilter !== 'all' ||
    submenuStatusFilter !== 'all' ||
    Boolean(submenuSort.direction);

  const submenuActiveFilterCount =
    (submenuSearch.trim() ? 1 : 0) +
    (submenuCategoryFilter !== 'all' ? 1 : 0) +
    (submenuRoleFilter !== 'all' ? 1 : 0) +
    (submenuStatusFilter !== 'all' ? 1 : 0) +
    (submenuSort.direction ? 1 : 0);

  const navRoleFilterOptions = [
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'dispatch', label: 'Dispatch' },
    { value: 'leader', label: 'Leader / Korlap' },
    { value: 'installer', label: 'Teknisi / Installer' }
  ];

  const navStatusFilterOptions = [
    { value: 'active', label: 'Aktif' },
    { value: 'hidden', label: 'Disembunyikan' }
  ];

  // Grouped submenus
  const submenusByCategory = useMemo(() => {
    const map = new Map<string, NavSubmenuItem[]>();
    (sortedCategories || []).forEach(cat => map.set(cat.id, []));
    (submenuItems || []).forEach(sub => {
      const list = map.get(sub.categoryId) || [];
      list.push(sub);
      map.set(sub.categoryId, list);
    });
    // Sort items within each category
    map.forEach((items, catId) => {
      items.sort((a, b) => (a.order || 0) - (b.order || 0));
    });
    return map;
  }, [sortedCategories, submenuItems]);

  // Handle Save to Supabase PostgreSQL
  const handleSaveToCloud = async () => {
    if (!isSuperadmin) {
      toast.error('Akses ditolak: hanya Super Admin yang diizinkan menyimpan konfigurasi navigasi.', 'Akses Ditolak');
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveNavigationConfig(currentUser?.name || currentUser?.username || 'Super Admin');
      if (result.success) {
        toast.success(
          'Konfigurasi navigasi MoraJaws berhasil disimpan permanen ke Supabase PostgreSQL (app_settings / navigation_doc).',
          'Tersimpan Permanen'
        );
        addAuditLog(
          'update_navigation_config',
          'ui_config',
          'navigation_doc',
          'Memperbarui konfigurasi sistem navigasi di Supabase PostgreSQL (app_settings / navigation_doc)'
        );
      } else {
        const detail = result.error || 'Gagal menyimpan konfigurasi navigasi ke Supabase PostgreSQL.';
        toast.error(detail, 'Error Penyimpanan');
      }
    } catch (err: any) {
      const detail = err?.message || String(err);
      toast.error(detail, 'Gagal Simpan');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Reset to Defaults
  const handleConfirmReset = async () => {
    if (!isSuperadmin) {
      toast.error('Akses ditolak: hanya Super Admin yang diizinkan mereset konfigurasi navigasi.', 'Akses Ditolak');
      return;
    }
    setIsSaving(true);
    try {
      const res = await resetNavigationConfig(currentUser?.name || currentUser?.username || 'Super Admin');
      if (res.success) {
        toast.success('Konfigurasi navigasi telah dikembalikan ke default canonical MoraJaws dan tersimpan di Supabase PostgreSQL.', 'Reset Berhasil');
        setShowResetConfirm(false);
      } else {
        toast.error(res.error || 'Gagal mereset konfigurasi navigasi di Supabase PostgreSQL.', 'Error Reset');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Kesalahan saat reset konfigurasi navigasi.', 'Gagal Reset');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Reload from Supabase
  const handleReloadFromCloud = async () => {
    const res = await reloadNavigationFromSupabase();
    if (res.success) {
      toast.success('Konfigurasi navigasi terbaru berhasil dimuat dari Supabase PostgreSQL.', 'Sinkronisasi Berhasil');
    } else {
      toast.error(res.error || 'Gagal memuat konfigurasi dari Supabase PostgreSQL.', 'Gagal Muat Ulang');
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (type: 'category' | 'standalone' | 'submenu', id: string, sourceCategoryId?: string) => {
    setDraggedItem({ type, id, sourceCategoryId });
  };

  const handleDropCategory = (targetIndex: number) => {
    if (!draggedItem || draggedItem.type !== 'category') return;
    const sourceIndex = sortedCategories.findIndex(c => c.id === draggedItem.id);
    if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
      reorderCategories(sourceIndex, targetIndex);
      toast.info('Urutan kategori diperbarui.');
    }
    setDraggedItem(null);
  };

  const handleDropStandalone = (targetIndex: number) => {
    if (!draggedItem || draggedItem.type !== 'standalone') return;
    const sourceIndex = sortedStandaloneMenus.findIndex(m => m.id === draggedItem.id);
    if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
      reorderStandaloneMenus(sourceIndex, targetIndex);
      toast.info('Urutan menu mandiri diperbarui.');
    }
    setDraggedItem(null);
  };

  const handleDropSubmenu = (targetCategoryId: string, targetIndex: number) => {
    if (!draggedItem || draggedItem.type !== 'submenu') return;
    const { id: submenuId, sourceCategoryId } = draggedItem;

    if (sourceCategoryId === targetCategoryId) {
      // Reorder within same category
      const catSubmenus = submenusByCategory.get(targetCategoryId) || [];
      const sourceIndex = catSubmenus.findIndex(s => s.id === submenuId);
      if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
        reorderSubmenus(targetCategoryId, sourceIndex, targetIndex);
        toast.info('Urutan submenu diperbarui.');
      }
    } else {
      // Move to another category
      moveSubmenuToCategory(submenuId, targetCategoryId);
      toast.success(`Submenu dipindahkan ke kategori "${targetCategoryId}".`);
    }
    setDraggedItem(null);
  };

  const activeTabTitle =
    activeConfigTab === 'categories'
      ? 'Kategori Accordion'
      : activeConfigTab === 'standalone'
      ? 'Menu Mandiri'
      : 'Submenu Items';

  const handleToggleSelectSubmenu = (id: string) => {
    setSelectedSubmenuIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleExecuteBatchMove = () => {
    if (!isSuperadmin || selectedSubmenuIds.length === 0) return;
    const targetCat = sortedCategories.find(c => c.id === batchTargetCategoryId);
    let movedCount = 0;
    selectedSubmenuIds.forEach(subId => {
      const existing = (submenuItems || []).find(s => s.id === subId);
      if (existing && existing.categoryId !== batchTargetCategoryId) {
        moveSubmenuToCategory(subId, batchTargetCategoryId);
        movedCount += 1;
      }
    });
    setSelectedSubmenuIds([]);
    if (movedCount > 0) {
      toast.success(
        `${movedCount} submenu dipindahkan ke kategori "${targetCat?.name || batchTargetCategoryId}". Klik Simpan Konfigurasi untuk menyimpan permanen.`
      );
    } else {
      toast.info('Submenu yang dipilih sudah berada di kategori tujuan.');
    }
  };

  return (
    <div className="space-y-5">
      {/* ================================================================ */}
      {/* TOP HEADER & 3D ACTION BAR (STITCH TEMPLATES 1 & 2)              */}
      {/* ================================================================ */}
      <div className="card-3d-lavender relative overflow-hidden rounded-2xl p-4 sm:p-6">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#6657C8] via-[#7CC8D4] to-[#2E7D8B] dark:from-[#58149C] dark:via-[#A380FE] dark:to-[#6B103B]" />
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pt-1">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 bg-gradient-to-b from-[#EAE8FF] to-[#DDF4F4] text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:from-[#7135B5] dark:to-[#58149C] rounded-xl dark:text-white flex items-center justify-center shadow-xs dark:shadow-[0_3px_0_#35105E] shrink-0">
              <FolderTree className="w-5 h-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap text-[10.5px] font-mono font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                <span className="text-[#5145A6] dark:text-[#DAB9FF]">01 — System Configuration</span>
                <ChevronRight className="w-3 h-3 shrink-0" />
                <span>Menu Navigasi Engine</span>
                <ChevronRight className="w-3 h-3 shrink-0" />
                <span className="text-[#2E7D8B] dark:text-[#F4B6C2]">{activeTabTitle}</span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white tracking-tight">
                  Konfigurasi Menu Navigasi
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:bg-[#35105E] dark:text-[#D8B4FE] dark:border-[#7135B5]/40 uppercase font-mono tabular-nums">
                  v{navDocVersion} Schema
                </span>
                {hasUnsavedNavChanges && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800">
                    Draft Belum Disimpan
                  </span>
                )}
              </div>

              <p className="text-xs text-[#52647A] dark:text-[#CABDE8] max-w-3xl leading-relaxed">
                Kelola {sortedCategories.length} Kategori Accordion, {sortedStandaloneMenus.length} Menu Mandiri, dan{' '}
                {(submenuItems || []).length} Submenu Items beserta urutan drag-and-drop dan otorisasi role MoraJaws secara realtime.
              </p>
            </div>
          </div>

          {/* 3D Tactile Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowPreviewModal(true)}
              className="mj-btn-superadmin-lilac px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold gap-2 cursor-pointer"
            >
              <Eye className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
              <span>Pratinjau per Role</span>
            </button>

            {isSuperadmin && (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                disabled={isSaving}
                className="mj-btn-superadmin-lilac px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold gap-2 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/70 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset Default</span>
              </button>
            )}

            {isSuperadmin && (
              <button
                type="button"
                onClick={handleSaveToCloud}
                disabled={isSaving}
                className={`mj-btn-superadmin-primary px-4 sm:px-5 py-2 min-h-[40px] rounded-xl text-xs font-bold gap-2 cursor-pointer ${
                  isSaving ? 'mj-btn-loading' : ''
                }`}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Menyimpan ke Cloud...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Simpan Konfigurasi</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* SUPABASE SYNC STATUS & MULTI-SUBMENU COLLAPSE TOGGLE             */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Supabase Status Card */}
        <div
          className={`lg:col-span-5 card-3d-lavender rounded-2xl p-4 flex items-center justify-between gap-2.5 ${
            cloudSyncStatus === 'error' ? 'border-rose-400 dark:border-rose-500/60' : ''
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`p-2.5 rounded-xl shrink-0 ${
                cloudSyncStatus === 'synced'
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-700/50'
                  : cloudSyncStatus === 'error'
                  ? 'bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-700/50'
                  : cloudSyncStatus === 'syncing'
                  ? 'bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-700/50'
                  : 'bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-700/50'
              }`}
            >
              <Cloud className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                Supabase PostgreSQL
              </p>
              <p className="text-xs font-extrabold text-[#26364A] dark:text-white truncate">
                {cloudSyncStatus === 'synced'
                  ? hasUnsavedNavChanges
                    ? 'Tersinkronisasi (Ada Perubahan Lokal)'
                    : 'Tersinkronisasi Realtime'
                  : cloudSyncStatus === 'syncing'
                  ? 'Menyinkronkan ke Database...'
                  : cloudSyncStatus === 'error'
                  ? 'Gagal Sinkronisasi Database'
                  : 'Mode Lokal (Belum Tersimpan di Cloud)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {lastCloudSyncTime && (
              <span className="text-[10.5px] font-mono tabular-nums text-[#8492A5] dark:text-[#A79BC0]">
                {new Date(lastCloudSyncTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              type="button"
              onClick={handleReloadFromCloud}
              disabled={isCloudSyncing || isSaving}
              className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer disabled:opacity-50"
              title="Muat ulang konfigurasi dari Supabase PostgreSQL"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCloudSyncing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Multi-Accordion Behavior 3D Toggle Panel */}
        <div className="lg:col-span-7 card-3d-lavender rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-[#26364A] dark:text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE] shrink-0" />
              <span>Mendukung Multi-Submenu Collapse (Beberapa Kategori Terbuka Bersamaan)</span>
            </p>
            <p className="text-[11px] text-[#52647A] dark:text-[#CABDE8] mt-0.5">
              Ketika diaktifkan, membuka satu kategori accordion tidak akan menutup kategori lain secara otomatis.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={accordionSettings.allowMultipleOpenGroups}
            disabled={!isSuperadmin}
            onClick={() => setAllowMultipleOpenGroups(!accordionSettings.allowMultipleOpenGroups)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-all ${
              isSuperadmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
            } ${accordionSettings.allowMultipleOpenGroups ? 'mj-switch-track-on' : 'mj-switch-track-off'}`}
            title="Ubah Mode Multi-Accordion"
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full mj-switch-thumb transition-transform ${
                accordionSettings.allowMultipleOpenGroups ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Diagnostic Error Banner when Supabase Save/Load Fails */}
      {cloudSyncStatus === 'error' && lastCloudSyncError && (
        <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-500/50 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-rose-800 dark:text-rose-200">
                Detail Error Supabase PostgreSQL (app_settings / navigation_doc)
              </p>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5 font-mono break-all">
                {lastCloudSyncError}
              </p>
            </div>
          </div>
          {isSuperadmin && (
            <button
              type="button"
              onClick={handleSaveToCloud}
              disabled={isSaving}
              className="mj-btn-superadmin-maroon px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 cursor-pointer"
            >
              Coba Simpan Ulang
            </button>
          )}
        </div>
      )}

      {/* Read-only notice for non-Super Admin roles */}
      {!isSuperadmin && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-500/40 rounded-2xl p-3.5 flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>Mode Hanya-Baca: Hanya role Super Admin yang memiliki izin untuk mengubah dan menyimpan konfigurasi navigasi ke Supabase PostgreSQL.</span>
        </div>
      )}

      {/* ================================================================ */}
      {/* 3-SEGMENT TACTILE NAVIGATION SECTION TABS (STITCH TEMPLATES 1&2) */}
      {/* ================================================================ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="mj-tactile-tab-bar p-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1">
          <button
            type="button"
            onClick={() => setActiveConfigTab('categories')}
            className={`flex items-center justify-center gap-2 px-4 py-2 min-h-[42px] rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 sm:flex-1 ${
              activeConfigTab === 'categories'
                ? 'btn-3d-primary text-white'
                : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/75 dark:hover:bg-[#261942]'
            }`}
          >
            <Building2 className="w-4 h-4 shrink-0" />
            <span>1. Kategori Accordion</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums ${
                activeConfigTab === 'categories'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF]'
              }`}
            >
              {sortedCategories.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveConfigTab('standalone')}
            className={`flex items-center justify-center gap-2 px-4 py-2 min-h-[42px] rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 sm:flex-1 ${
              activeConfigTab === 'standalone'
                ? 'btn-3d-primary text-white'
                : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/75 dark:hover:bg-[#261942]'
            }`}
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            <span>2. Menu Mandiri</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums ${
                activeConfigTab === 'standalone'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF]'
              }`}
            >
              {sortedStandaloneMenus.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveConfigTab('submenus')}
            className={`flex items-center justify-center gap-2 px-4 py-2 min-h-[42px] rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 sm:flex-1 ${
              activeConfigTab === 'submenus'
                ? 'btn-3d-primary text-white'
                : 'text-[#52647A] dark:text-[#CABDE8] hover:text-[#26364A] dark:hover:text-white hover:bg-white/75 dark:hover:bg-[#261942]'
            }`}
          >
            <ListOrdered className="w-4 h-4 shrink-0" />
            <span>3. Submenu Items</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums ${
                activeConfigTab === 'submenus'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF]'
              }`}
            >
              {(submenuItems || []).length}
            </span>
          </button>
        </div>

        {isSuperadmin && (
          <div className="hidden xl:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F4F7FB] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-[11px] font-semibold text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
            <GripVertical className="w-3.5 h-3.5" />
            <span>Drag &amp; Drop Urutan Aktif</span>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* TAB 1: PENGATURAN KATEGORI (ACCORDION SUBMENU + PREVIEW)         */}
      {/* ================================================================ */}
      {activeConfigTab === 'categories' && (
        <div className="space-y-4">
          <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
                Daftar Kategori Utama (Accordion &amp; Static)
              </h3>
              <p className="text-xs text-[#52647A] dark:text-[#CABDE8] mt-0.5">
                Geser kartu atau gunakan tombol panah 3D untuk mengatur urutan sidebar, ubah mode Accordion/Static, atau lihat pratinjau submenu terpasang.
              </p>
            </div>
            {isSuperadmin && (
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(true)}
                className="mj-btn-superadmin-primary px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold gap-1.5 cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Kategori</span>
              </button>
            )}
          </div>

          <div className="space-y-3">
            {sortedCategories.map((cat, index) => {
              const CatIcon = getIconComp(cat.icon);
              const submenusInCat = submenusByCategory.get(cat.id) || [];
              const isEditing = editingCategoryId === cat.id;
              const isPreviewOpen = Boolean(expandedCategoryPreview[cat.id]);

              return (
                <div
                  key={cat.id}
                  draggable={isSuperadmin}
                  onDragStart={() => handleDragStart('category', cat.id)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDropCategory(index)}
                  className={`card-3d-lavender rounded-2xl p-4 transition-all duration-200 space-y-3 ${
                    cat.isActive === false ? 'opacity-65' : 'hover:border-[#9E95DE] dark:hover:border-[#7135B5]'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    {/* Left: Drag Handle, Icon, Name, Mode */}
                    <div className="flex items-center gap-3 min-w-0">
                      {isSuperadmin && (
                        <div
                          className="cursor-grab text-[#8492A5] hover:text-[#5145A6] dark:text-purple-400 dark:hover:text-white p-1 shrink-0"
                          title="Tahan & geser untuk mengubah urutan"
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                      )}

                      <div className="p-2.5 rounded-xl bg-[#EAE8FF] dark:bg-[#261547] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#7135B5]/30 shrink-0">
                        <CatIcon className="w-4 h-4" />
                      </div>

                      {isEditing ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={categoryDraftName}
                            onChange={e => setCategoryDraftName(e.target.value)}
                            className="px-2.5 py-1.5 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-white rounded-lg focus:outline-hidden"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (categoryDraftName.trim()) {
                                updateCategory(cat.id, {
                                  name: categoryDraftName.trim(),
                                  icon: categoryDraftIcon
                                });
                                setEditingCategoryId(null);
                                toast.success('Nama kategori diperbarui.');
                              }
                            }}
                            className="p-1.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-lg cursor-pointer"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCategoryId(null)}
                            className="p-1.5 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 rounded-lg cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white tracking-tight">
                              {cat.name}
                            </h4>
                            <span className="text-[10px] text-[#8492A5] dark:text-purple-400 font-mono">
                              ({cat.id})
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wider ${
                                cat.mode === 'static'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30'
                                  : 'bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:bg-purple-500/20 dark:text-[#D8B4FE] dark:border-purple-500/30'
                              }`}
                            >
                              {cat.mode === 'static' ? 'Static Mode' : 'Accordion Mode'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#52647A] dark:text-[#CABDE8] mt-0.5">
                            <strong className="font-mono tabular-nums">{submenusInCat.length}</strong> Submenu terdaftar · Urutan <strong className="font-mono tabular-nums">#{cat.order}</strong>
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right: 3D Tactile Controls */}
                    <div className="flex flex-wrap items-center gap-2 self-end md:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCategoryPreview(prev => ({
                            ...prev,
                            [cat.id]: !prev[cat.id]
                          }))
                        }
                        className="mj-btn-superadmin-lilac px-2.5 py-1.5 rounded-xl text-[11px] font-bold gap-1 cursor-pointer"
                        title="Lihat daftar submenu terpasang dalam kategori ini"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${isPreviewOpen ? 'rotate-180' : ''}`}
                        />
                        <span>Preview ({submenusInCat.length})</span>
                      </button>

                      {isSuperadmin && (
                        <button
                          type="button"
                          onClick={() =>
                            setCategoryAccordionMode(
                              cat.id,
                              cat.mode === 'static' ? 'accordion' : 'static'
                            )
                          }
                          className="mj-btn-superadmin-lilac px-2.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer"
                          title="Ganti Mode Accordion / Static"
                        >
                          Mode: {cat.mode === 'static' ? 'Statis' : 'Accordion'}
                        </button>
                      )}

                      {isSuperadmin && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={cat.isActive !== false}
                          onClick={() => toggleCategoryActive(cat.id)}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all cursor-pointer ${
                            cat.isActive !== false ? 'mj-switch-track-on' : 'mj-switch-track-off'
                          }`}
                          title={cat.isActive !== false ? 'Kategori Aktif' : 'Kategori Nonaktif'}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full mj-switch-thumb transition-transform ${
                              cat.isActive !== false ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      )}

                      {isSuperadmin && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveCategoryItem(cat.id, 'up')}
                            disabled={index === 0}
                            className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                            title="Pindah ke Atas"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveCategoryItem(cat.id, 'down')}
                            disabled={index === sortedCategories.length - 1}
                            className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                            title="Pindah ke Bawah"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {isSuperadmin && !isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCategoryId(cat.id);
                            setCategoryDraftName(cat.name);
                            setCategoryDraftIcon(cat.icon || 'Building2');
                          }}
                          className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                          title="Edit Kategori"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {isSuperadmin && (
                        <button
                          type="button"
                          onClick={() => setDeletingCategory(cat)}
                          className="w-8 h-8 inline-flex items-center justify-center rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800/70 transition-colors cursor-pointer"
                          title="Hapus Kategori"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable Inline Submenu Preview Drawer (Stitch Template 2) */}
                  {isPreviewOpen && (
                    <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#35105E] space-y-2.5">
                      <div className="flex items-center justify-between gap-2 text-[10.5px]">
                        <span className="font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                          Submenu Preview Terpasang ({submenusInCat.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveConfigTab('submenus')}
                          className="font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                        >
                          Kelola Semua Submenu →
                        </button>
                      </div>

                      {submenusInCat.length === 0 ? (
                        <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-dashed border-[#C5BEEF] dark:border-[#35105E] text-[11px] text-[#8492A5] dark:text-[#A79BC0] text-center">
                          Kategori ini belum memiliki submenu. Tambahkan melalui tab <strong>3. Submenu Items</strong>.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                          {submenusInCat.map(sub => {
                            const SubIcon = getIconComp(sub.icon);
                            return (
                              <div
                                key={sub.id}
                                className={`p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-1.5 ${
                                  sub.visible === false ? 'opacity-55' : ''
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="flex items-center gap-1.5 min-w-0 text-xs font-bold text-[#26364A] dark:text-white">
                                    <SubIcon className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                                    <span className="truncate">{sub.label}</span>
                                  </span>
                                  <span
                                    className={`text-[9.5px] font-bold shrink-0 ${
                                      sub.visible !== false
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-[#8492A5]'
                                    }`}
                                  >
                                    {sub.visible !== false ? 'Aktif' : 'Off'}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {(sub.roles || []).slice(0, 3).map(role => (
                                    <span
                                      key={role}
                                      className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-white dark:bg-[#261547] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DDE6F0] dark:border-[#4A258D]"
                                    >
                                      {role.replace('_admin', '').replace('_', ' ')}
                                    </span>
                                  ))}
                                  {(sub.roles || []).length > 3 && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-white dark:bg-[#261547] text-[#8492A5]">
                                      +{(sub.roles || []).length - 3}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 2: MENU MANDIRI / STANDALONE MENUS (STITCH TEMPLATE #2)      */}
      {/* ================================================================ */}
      {activeConfigTab === 'standalone' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
              {filteredStandaloneMenus.length} / {sortedStandaloneMenus.length} Menu Mandiri
            </span>
            <TableResetFilterButton
              activeCount={standaloneActiveFilterCount}
              onReset={() => {
                setStandaloneSearch('');
                setStandaloneRoleFilter('all');
                setStandaloneStatusFilter('all');
                setStandaloneSort({ key: null, direction: null });
              }}
              label="Reset Search/Filter"
            />
          </div>

          {isCompactUI ? (
            /* Mobile / Compact Responsive Card List */
            <div className="space-y-3">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <HeaderSearchPopover
                  label="Menu & Path"
                  value={standaloneSearch}
                  onChange={setStandaloneSearch}
                  placeholder="Cari menu atau /route..."
                  sortActive={standaloneSort.key === 'label' && Boolean(standaloneSort.direction)}
                  sortDir={standaloneSort.key === 'label' ? standaloneSort.direction : null}
                  onCycleSort={() =>
                    setStandaloneSort(prev => ({
                      key: 'label',
                      direction: prev.key === 'label' ? getNextSortDirection(prev.direction) : 'asc'
                    }))
                  }
                />
                <HeaderCategoryDropdown
                  label="Role RBAC"
                  value={standaloneRoleFilter}
                  defaultValue="all"
                  allLabel={`Semua Role (${sortedStandaloneMenus.length})`}
                  options={navRoleFilterOptions}
                  onChange={setStandaloneRoleFilter}
                />
                <HeaderCategoryDropdown
                  label="Status"
                  value={standaloneStatusFilter}
                  defaultValue="all"
                  allLabel="Semua Status"
                  options={navStatusFilterOptions}
                  onChange={setStandaloneStatusFilter}
                />
              </div>
              {filteredStandaloneMenus.length === 0 ? (
                <div className="card-3d-lavender rounded-2xl p-8 text-center space-y-3">
                  <p className="text-xs font-bold text-[#26364A] dark:text-white">
                    Tidak ada Menu Mandiri yang cocok dengan pencarian atau filter role.
                  </p>
                </div>
              ) : (
              filteredStandaloneMenus.map(menu => {
                const MenuIcon = getIconComp(menu.icon);
                const actualIndex = sortedStandaloneMenus.findIndex(m => m.id === menu.id);
                const isEditing = editingStandaloneId === menu.id;

                return (
                  <div
                    key={menu.id}
                    className={`card-3d-lavender rounded-2xl p-4 space-y-3 transition-all ${
                      menu.visible === false ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-7 h-7 rounded-lg bg-[#EAE8FF] dark:bg-[#261547] text-[#5145A6] dark:text-[#DAB9FF] font-mono text-xs font-extrabold flex items-center justify-center shrink-0 tabular-nums">
                          {actualIndex + 1}
                        </span>
                        <div className="p-2 rounded-xl bg-[#EAE8FF] dark:bg-[#261547] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#7135B5]/30 shrink-0">
                          <MenuIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white truncate">
                            {menu.label}
                          </h4>
                          <p className="font-mono text-[11px] text-[#8492A5] dark:text-[#A79BC0] truncate">
                            /{menu.id} · Standalone
                          </p>
                        </div>
                      </div>

                      {isSuperadmin && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={menu.visible !== false}
                          onClick={() => toggleStandaloneMenuActive(menu.id)}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all cursor-pointer ${
                            menu.visible !== false ? 'mj-switch-track-on' : 'mj-switch-track-off'
                          }`}
                          title={menu.visible !== false ? 'Menu Aktif' : 'Menu Disembunyikan'}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full mj-switch-thumb transition-transform ${
                              menu.visible !== false ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {isEditing && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#35105E]">
                        <input
                          type="text"
                          value={standaloneDraftLabel}
                          onChange={e => setStandaloneDraftLabel(e.target.value)}
                          className="flex-1 min-w-[140px] px-2.5 py-1.5 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-white rounded-lg focus:outline-hidden"
                          autoFocus
                        />
                        <select
                          value={standaloneDraftIcon}
                          onChange={e => setStandaloneDraftIcon(e.target.value)}
                          className="px-2.5 py-1.5 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-purple-200 rounded-lg focus:outline-hidden"
                        >
                          {AVAILABLE_ICONS.map(i => (
                            <option key={i.name} value={i.name}>
                              {i.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            if (standaloneDraftLabel.trim()) {
                              updateStandaloneMenu(menu.id, {
                                label: standaloneDraftLabel.trim(),
                                icon: standaloneDraftIcon
                              });
                              setEditingStandaloneId(null);
                              toast.success('Menu mandiri diperbarui.');
                            }
                          }}
                          className="p-2 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-lg cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingStandaloneId(null)}
                          className="p-2 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 rounded-lg cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#35105E]">
                      <div className="flex flex-wrap gap-1">
                        {(menu.roles || []).map(role => (
                          <span
                            key={role}
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
                              role === 'super_admin'
                                ? 'bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:bg-[#35105E] dark:text-[#DAB9FF] dark:border-[#7135B5]/40'
                                : 'bg-[#F4F7FB] text-[#52647A] border border-[#DDE6F0] dark:bg-[#160D29] dark:text-[#CABDE8] dark:border-[#35105E]'
                            }`}
                          >
                            {role.replace('_', ' ')}
                          </span>
                        ))}
                      </div>

                      {isSuperadmin && !isEditing && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => moveStandaloneMenu(menu.id, 'up')}
                            disabled={actualIndex === 0}
                            className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                            title="Pindah ke Atas"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStandaloneMenu(menu.id, 'down')}
                            disabled={actualIndex === sortedStandaloneMenus.length - 1}
                            className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                            title="Pindah ke Bawah"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingStandaloneId(menu.id);
                              setStandaloneDraftLabel(menu.label);
                              setStandaloneDraftIcon(menu.icon || 'LayoutDashboard');
                            }}
                            className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                            title="Edit Label / Ikon"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }))}
            </div>
          ) : (
            /* Desktop Clean Table Container matching Stitch Template #2 */
            <div className="card-3d-lavender rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#EDF3F8] dark:bg-[#160D29] border-b border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#A79BC0]">
                      <th className="py-3 px-4 w-24 text-center">
                        <HeaderSortButton
                          label="Urutan"
                          sortActive={standaloneSort.key === 'order' && Boolean(standaloneSort.direction)}
                          sortDir={standaloneSort.key === 'order' ? standaloneSort.direction : null}
                          onCycleSort={() =>
                            setStandaloneSort(prev => ({
                              key: 'order',
                              direction: prev.key === 'order' ? getNextSortDirection(prev.direction) : 'asc'
                            }))
                          }
                        />
                      </th>
                      <th className="py-3 px-4 min-w-[230px]">
                        <HeaderSearchPopover
                          label="Nama Menu & Path ID"
                          value={standaloneSearch}
                          onChange={setStandaloneSearch}
                          placeholder="Cari nama menu atau /route..."
                          sortActive={standaloneSort.key === 'label' && Boolean(standaloneSort.direction)}
                          sortDir={standaloneSort.key === 'label' ? standaloneSort.direction : null}
                          onCycleSort={() =>
                            setStandaloneSort(prev => ({
                              key: 'label',
                              direction: prev.key === 'label' ? getNextSortDirection(prev.direction) : 'asc'
                            }))
                          }
                        />
                      </th>
                      <th className="py-3 px-4 w-32">Tipe Engine</th>
                      <th className="py-3 px-4 min-w-[240px]">
                        <HeaderCategoryDropdown
                          label="Hak Akses RBAC"
                          value={standaloneRoleFilter}
                          defaultValue="all"
                          allLabel={`Semua Role (${sortedStandaloneMenus.length})`}
                          options={navRoleFilterOptions}
                          onChange={setStandaloneRoleFilter}
                        />
                      </th>
                      <th className="py-3 px-4 w-28 text-center">
                        <HeaderCategoryDropdown
                          label="Status"
                          value={standaloneStatusFilter}
                          defaultValue="all"
                          allLabel="Semua Status"
                          options={navStatusFilterOptions}
                          onChange={setStandaloneStatusFilter}
                          sortActive={standaloneSort.key === 'status' && Boolean(standaloneSort.direction)}
                          sortDir={standaloneSort.key === 'status' ? standaloneSort.direction : null}
                          onCycleSort={() =>
                            setStandaloneSort(prev => ({
                              key: 'status',
                              direction: prev.key === 'status' ? getNextSortDirection(prev.direction) : 'asc'
                            }))
                          }
                        />
                      </th>
                      <th className="py-3 px-4 w-32 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#2D1754] text-xs">
                    {filteredStandaloneMenus.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 px-4 text-center text-xs font-bold text-[#52647A] dark:text-[#CABDE8]">
                          Tidak ada Menu Mandiri yang cocok dengan pencarian atau filter aktif.
                        </td>
                      </tr>
                    ) : (
                    filteredStandaloneMenus.map(menu => {
                      const MenuIcon = getIconComp(menu.icon);
                      const actualIndex = sortedStandaloneMenus.findIndex(m => m.id === menu.id);
                      const isEditing = editingStandaloneId === menu.id;

                      return (
                        <tr
                          key={menu.id}
                          draggable={isSuperadmin && !isStandaloneFiltered}
                          onDragStart={() => handleDragStart('standalone', menu.id)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={() => {
                            if (!isStandaloneFiltered) {
                              handleDropStandalone(actualIndex);
                            }
                          }}
                          className={`group transition-colors odd:bg-white even:bg-[#F8FAFD] hover:bg-[#EDF3F8] dark:odd:bg-transparent dark:even:bg-transparent dark:hover:bg-[#1E1238]/75 ${
                            menu.visible === false ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="py-3 px-4 text-center">
                            <div className="inline-flex items-center justify-center gap-1.5">
                              {isSuperadmin && !isStandaloneFiltered && (
                                <GripVertical className="w-4 h-4 text-[#A4B3C4] group-hover:text-[#5145A6] dark:text-purple-500/60 dark:group-hover:text-[#DAB9FF] cursor-grab" />
                              )}
                              <span className="w-6 h-6 rounded-lg bg-[#EAE8FF] dark:bg-[#261547] text-[#5145A6] dark:text-[#DAB9FF] font-mono text-[11px] font-extrabold flex items-center justify-center tabular-nums">
                                {actualIndex + 1}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#261547] text-[#5145A6] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#4A258D] flex items-center justify-center shrink-0">
                                <MenuIcon className="w-4 h-4" />
                              </div>

                              {isEditing ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={standaloneDraftLabel}
                                    onChange={e => setStandaloneDraftLabel(e.target.value)}
                                    className="px-2.5 py-1 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-white rounded-lg focus:outline-hidden"
                                    autoFocus
                                  />
                                  <select
                                    value={standaloneDraftIcon}
                                    onChange={e => setStandaloneDraftIcon(e.target.value)}
                                    className="px-2 py-1 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-purple-200 rounded-lg focus:outline-hidden"
                                  >
                                    {AVAILABLE_ICONS.map(i => (
                                      <option key={i.name} value={i.name}>
                                        {i.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (standaloneDraftLabel.trim()) {
                                        updateStandaloneMenu(menu.id, {
                                          label: standaloneDraftLabel.trim(),
                                          icon: standaloneDraftIcon
                                        });
                                        setEditingStandaloneId(null);
                                        toast.success('Menu mandiri diperbarui.');
                                      }
                                    }}
                                    className="p-1.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-lg cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingStandaloneId(null)}
                                    className="p-1.5 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 rounded-lg cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="min-w-0">
                                  <div className="font-display font-extrabold text-[#26364A] dark:text-white truncate">
                                    {menu.label}
                                  </div>
                                  <div className="font-mono text-[11px] text-[#8492A5] dark:text-[#A79BC0]">
                                    /{menu.id}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span className="px-2.5 py-1 rounded-md bg-[#EAE8FF] dark:bg-[#261547] text-[#5145A6] dark:text-[#DAB9FF] font-mono text-[10px] font-extrabold uppercase tracking-wider">
                              Standalone
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(menu.roles || []).map(role => (
                                <span
                                  key={role}
                                  className={`px-2 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
                                    role === 'super_admin'
                                      ? 'bg-[#6657C8] text-white dark:bg-[#7135B5]'
                                      : 'bg-[#F4F7FB] text-[#52647A] border border-[#DDE6F0] dark:bg-[#160D29] dark:text-[#CABDE8] dark:border-[#35105E]'
                                  }`}
                                >
                                  {role.replace('_', ' ')}
                                </span>
                              ))}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-center">
                            {isSuperadmin ? (
                              <button
                                type="button"
                                role="switch"
                                aria-checked={menu.visible !== false}
                                onClick={() => toggleStandaloneMenuActive(menu.id)}
                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all cursor-pointer ${
                                  menu.visible !== false ? 'mj-switch-track-on' : 'mj-switch-track-off'
                                }`}
                                title={menu.visible !== false ? 'Menu Aktif' : 'Menu Disembunyikan'}
                              >
                                <span
                                  className={`inline-block h-4 w-4 transform rounded-full mj-switch-thumb transition-transform ${
                                    menu.visible !== false ? 'translate-x-6' : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            ) : (
                              <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CABDE8]">
                                {menu.visible !== false ? 'Aktif' : 'Nonaktif'}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            {isSuperadmin && !isEditing && (
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => moveStandaloneMenu(menu.id, 'up')}
                                  disabled={actualIndex === 0}
                                  className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                                  title="Pindah ke Atas"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveStandaloneMenu(menu.id, 'down')}
                                  disabled={actualIndex === sortedStandaloneMenus.length - 1}
                                  className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                                  title="Pindah ke Bawah"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingStandaloneId(menu.id);
                                    setStandaloneDraftLabel(menu.label);
                                    setStandaloneDraftIcon(menu.icon || 'LayoutDashboard');
                                  }}
                                  className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                                  title="Edit Label / Ikon"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 3: SUBMENU ITEMS PER CATEGORY (STITCH TEMPLATE #1)           */}
      {/* ================================================================ */}
      {activeConfigTab === 'submenus' && (
        <div className="space-y-4">
          {/* Compact Top Header Bar (Filter controls live in table headers; batch move appears strictly when >=1 row selected) */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-1">
            <div className="flex flex-wrap items-center gap-2">
              <HeaderCategoryDropdown
                label="Filter Kategori"
                value={submenuCategoryFilter}
                defaultValue="all"
                allLabel={`Semua Kategori (${(submenuItems || []).length})`}
                options={sortedCategories.map(c => ({
                  value: c.id,
                  label: c.name,
                  count: (submenusByCategory.get(c.id) || []).length
                }))}
                onChange={setSubmenuCategoryFilter}
              />
              {isCompactUI && (
                <>
                  <HeaderSearchPopover
                    label="Submenu & ID"
                    value={submenuSearch}
                    onChange={setSubmenuSearch}
                    placeholder="Cari submenu atau /route..."
                  />
                  <HeaderCategoryDropdown
                    label="Role Access"
                    value={submenuRoleFilter}
                    defaultValue="all"
                    allLabel="Semua Role"
                    options={navRoleFilterOptions}
                    onChange={setSubmenuRoleFilter}
                  />
                </>
              )}
              <TableResetFilterButton
                activeCount={submenuActiveFilterCount}
                onReset={() => {
                  setSubmenuSearch('');
                  setSubmenuCategoryFilter('all');
                  setSubmenuRoleFilter('all');
                  setSubmenuStatusFilter('all');
                  setSubmenuSort({ key: null, direction: null });
                }}
                label="Reset Search/Filter"
              />
            </div>

            {isSuperadmin && (
              <button
                type="button"
                onClick={() => setShowAddSubmenuModal(true)}
                className="mj-btn-superadmin-primary px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Submenu Baru</span>
              </button>
            )}
          </div>

          {isSuperadmin && selectedSubmenuIds.length > 0 && (
            <TableSelectionToolbar
              selectedCount={selectedSubmenuIds.length}
              itemLabel="submenu dipilih untuk dipindahkan"
              onClear={() => setSelectedSubmenuIds([])}
              clearLabel="Batal"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={batchTargetCategoryId}
                    onChange={e => setBatchTargetCategoryId(e.target.value)}
                    aria-label="Target kategori batch move"
                    className="px-3 py-1.5 text-xs font-semibold tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-purple-100 rounded-xl focus:outline-hidden cursor-pointer"
                  >
                    {sortedCategories.map(c => (
                      <option key={c.id} value={c.id}>
                        Pindah ke: {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleExecuteBatchMove}
                    className="mj-btn-superadmin-primary px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span>Terapkan Pindah ({selectedSubmenuIds.length})</span>
                  </button>
                </div>
              }
            />
          )}

          {/* Grouped Submenus per Category */}
          {sortedCategories
            .filter(cat => submenuCategoryFilter === 'all' || cat.id === submenuCategoryFilter)
            .map(cat => {
              const CatIcon = getIconComp(cat.icon);
              const allInCat = submenusByCategory.get(cat.id) || [];
              const q = submenuSearch.trim().toLowerCase();
              const filteredRawInCat = allInCat.filter(sub => {
                const matchesQ =
                  !q ||
                  sub.label.toLowerCase().includes(q) ||
                  sub.id.toLowerCase().includes(q) ||
                  cat.name.toLowerCase().includes(q);
                const matchesRole =
                  submenuRoleFilter === 'all' ||
                  (sub.roles || []).includes(submenuRoleFilter);
                const matchesStatus =
                  submenuStatusFilter === 'all' ||
                  (submenuStatusFilter === 'active' ? sub.visible !== false : sub.visible === false);
                return matchesQ && matchesRole && matchesStatus;
              });
              const filteredInCat = sortDataArray(
                filteredRawInCat,
                submenuSort.key,
                submenuSort.direction,
                (row, key) => {
                  if (key === 'order') return row.order ?? 0;
                  if (key === 'label') return row.label;
                  if (key === 'status') return row.visible !== false ? 'Aktif' : 'Nonaktif';
                  return (row as any)[key];
                }
              );

              if (isSubmenuFiltered && filteredInCat.length === 0) {
                return null;
              }

              const isCollapsed = !isSubmenuFiltered && Boolean(collapsedSubmenuGroups[cat.id]);

              return (
                <div
                  key={cat.id}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => {
                    if (!isSubmenuFiltered) {
                      handleDropSubmenu(cat.id, allInCat.length);
                    }
                  }}
                  className="card-3d-lavender rounded-2xl overflow-hidden"
                >
                  {/* Category Accordion Header */}
                  <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#261547] dark:via-[#1E1238] dark:to-[#160D29] border-b border-[#DDE6F0] dark:border-[#35105E] flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-b from-[#6657C8] to-[#5145A6] dark:from-[#7135B5] dark:to-[#58149C] text-white flex items-center justify-center shadow-[0_2px_0_#3E3484] dark:shadow-[0_2px_0_#35105E] shrink-0">
                        <CatIcon className="w-4 h-4" />
                      </div>
                      <h4 className="font-display text-sm font-extrabold text-[#26364A] dark:text-white truncate">
                        Kategori Induk: {cat.name}
                      </h4>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#6657C8] dark:bg-[#58149C] text-white tabular-nums shrink-0">
                        {filteredInCat.length} Submenu Items
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="hidden sm:inline font-mono text-[11px] font-semibold text-[#8492A5] dark:text-[#A79BC0]">
                        Key: {cat.id}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedSubmenuGroups(prev => ({
                            ...prev,
                            [cat.id]: !prev[cat.id]
                          }))
                        }
                        className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer"
                        title={isCollapsed ? 'Buka daftar submenu' : 'Ringkas daftar submenu'}
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                        />
                      </button>
                    </div>
                  </div>

                  {filteredInCat.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#8492A5] dark:text-purple-400">
                      Belum ada submenu dalam kategori ini. Geser submenu ke sini atau gunakan dropdown pindahkan kategori.
                    </div>
                  ) : isCollapsed ? (
                    /* Collapsed 3-Item Summary Preview (Stitch Template #1 - Group C) */
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        {filteredInCat.slice(0, 3).map((sub, idx) => {
                          const SubIcon = getIconComp(sub.icon);
                          return (
                            <div
                              key={sub.id}
                              className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <SubIcon className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                                <div className="min-w-0">
                                  <div className="text-xs font-extrabold text-[#26364A] dark:text-white truncate">
                                    {sub.label}
                                  </div>
                                  <div className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] truncate">
                                    /{sub.id}
                                  </div>
                                </div>
                              </div>
                              <span className="px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#261547] text-[#5145A6] dark:text-[#DAB9FF] font-mono text-[10px] font-bold shrink-0 tabular-nums">
                                #{idx + 1}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#35105E]">
                        <span className="text-xs font-semibold text-[#52647A] dark:text-[#CABDE8]">
                          {filteredInCat.length > 3
                            ? `+${filteredInCat.length - 3} submenu lainnya terkonfigurasi dalam kategori ini`
                            : `${filteredInCat.length} submenu terkonfigurasi dalam kategori ini`}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedSubmenuGroups(prev => ({
                              ...prev,
                              [cat.id]: false
                            }))
                          }
                          className="mj-btn-superadmin-lilac px-3 py-1.5 rounded-xl text-xs font-bold gap-1.5 cursor-pointer"
                        >
                          <span>Buka Seluruh {filteredInCat.length} Submenu</span>
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : isCompactUI ? (
                    /* Mobile / Compact Responsive Submenu Cards */
                    <div className="p-3 space-y-2.5">
                      {filteredInCat.map(sub => {
                        const SubIcon = getIconComp(sub.icon);
                        const sIndex = allInCat.findIndex(s => s.id === sub.id);
                        const isEditing = editingSubmenuId === sub.id;
                        const isSelected = selectedSubmenuIds.includes(sub.id);

                        return (
                          <div
                            key={sub.id}
                            className={`p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border space-y-2.5 ${
                              sub.visible === false
                                ? 'border-slate-200 dark:border-slate-800 opacity-60'
                                : 'border-[#DDE6F0] dark:border-[#35105E]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isSuperadmin && (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleSelectSubmenu(sub.id)}
                                    className="rounded border-[#9E95DE] dark:border-[#C9B6EA] text-[#5145A6] dark:text-[#58149C] focus:ring-0 cursor-pointer shrink-0"
                                    title="Pilih untuk pindah batch"
                                  />
                                )}
                                <div className="p-2 rounded-lg bg-white dark:bg-[#261547] text-[#5145A6] dark:text-[#D8B4FE] border border-[#DDE6F0] dark:border-[#35105E] shrink-0">
                                  <SubIcon className="w-3.5 h-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-extrabold text-[#26364A] dark:text-white truncate">
                                    {sub.label}
                                  </div>
                                  <div className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] truncate">
                                    /{sub.id} · #{sIndex + 1}
                                  </div>
                                </div>
                              </div>

                              {isSuperadmin && (
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={sub.visible !== false}
                                  onClick={() => toggleSubmenuActive(sub.id)}
                                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all cursor-pointer ${
                                    sub.visible !== false ? 'mj-switch-track-on' : 'mj-switch-track-off'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-4 w-4 transform rounded-full mj-switch-thumb transition-transform ${
                                      sub.visible !== false ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                  />
                                </button>
                              )}
                            </div>

                            {isEditing && (
                              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#35105E]">
                                <input
                                  type="text"
                                  value={submenuDraftLabel}
                                  onChange={e => setSubmenuDraftLabel(e.target.value)}
                                  className="flex-1 min-w-[140px] px-2.5 py-1 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-white rounded-lg focus:outline-hidden"
                                  autoFocus
                                />
                                <select
                                  value={submenuDraftIcon}
                                  onChange={e => setSubmenuDraftIcon(e.target.value)}
                                  className="px-2 py-1 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-purple-200 rounded-lg focus:outline-hidden"
                                >
                                  {AVAILABLE_ICONS.map(i => (
                                    <option key={i.name} value={i.name}>
                                      {i.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (submenuDraftLabel.trim()) {
                                      updateSubmenu(sub.id, {
                                        label: submenuDraftLabel.trim(),
                                        icon: submenuDraftIcon
                                      });
                                      setEditingSubmenuId(null);
                                      toast.success('Submenu diperbarui.');
                                    }
                                  }}
                                  className="p-1.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-lg cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingSubmenuId(null)}
                                  className="p-1.5 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 rounded-lg cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-1">
                              {(sub.roles || []).map(role => (
                                <span
                                  key={role}
                                  className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase bg-white dark:bg-[#261547] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DDE6F0] dark:border-[#4A258D]"
                                >
                                  {role.replace('_', ' ')}
                                </span>
                              ))}
                            </div>

                            {isSuperadmin && !isEditing && (
                              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#35105E]">
                                <select
                                  value={sub.categoryId}
                                  onChange={e => {
                                    moveSubmenuToCategory(sub.id, e.target.value);
                                    toast.success('Submenu dipindahkan ke kategori baru.');
                                  }}
                                  className="px-2.5 py-1 text-[10.5px] font-semibold bg-white dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-purple-200 rounded-xl focus:outline-hidden cursor-pointer"
                                >
                                  {sortedCategories.map(c => (
                                    <option key={c.id} value={c.id}>
                                      Pindah ke: {c.name}
                                    </option>
                                  ))}
                                </select>

                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => moveSubmenu(sub.id, 'up')}
                                    disabled={sIndex === 0}
                                    className="mj-btn-icon-3d-leader w-7 h-7 cursor-pointer"
                                  >
                                    <ArrowUp className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveSubmenu(sub.id, 'down')}
                                    disabled={sIndex === allInCat.length - 1}
                                    className="mj-btn-icon-3d-leader w-7 h-7 cursor-pointer"
                                  >
                                    <ArrowDown className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingSubmenuId(sub.id);
                                      setSubmenuDraftLabel(sub.label);
                                      setSubmenuDraftIcon(sub.icon || 'FileText');
                                    }}
                                    className="mj-btn-icon-3d-leader w-7 h-7 cursor-pointer"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeletingSubmenu(sub)}
                                    className="w-7 h-7 inline-flex items-center justify-center rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800/70 transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Desktop Submenu Table matching Stitch Template #1 */
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#EDF3F8] dark:bg-[#160D29] border-b border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#A79BC0]">
                            <th className="py-2.5 px-3 w-24 text-center">
                              <HeaderSortButton
                                label="Urutan"
                                sortActive={submenuSort.key === 'order' && Boolean(submenuSort.direction)}
                                sortDir={submenuSort.key === 'order' ? submenuSort.direction : null}
                                onCycleSort={() =>
                                  setSubmenuSort(prev => ({
                                    key: 'order',
                                    direction: prev.key === 'order' ? getNextSortDirection(prev.direction) : 'asc'
                                  }))
                                }
                              />
                            </th>
                            <th className="py-2.5 px-3 min-w-[200px]">
                              <HeaderSearchPopover
                                label="Submenu & Endpoint ID"
                                value={submenuSearch}
                                onChange={setSubmenuSearch}
                                placeholder="Cari submenu atau /route..."
                                sortActive={submenuSort.key === 'label' && Boolean(submenuSort.direction)}
                                sortDir={submenuSort.key === 'label' ? submenuSort.direction : null}
                                onCycleSort={() =>
                                  setSubmenuSort(prev => ({
                                    key: 'label',
                                    direction: prev.key === 'label' ? getNextSortDirection(prev.direction) : 'asc'
                                  }))
                                }
                              />
                            </th>
                            <th className="py-2.5 px-3 min-w-[180px]">
                              <HeaderCategoryDropdown
                                label="Granular Role Access"
                                value={submenuRoleFilter}
                                defaultValue="all"
                                allLabel="Semua Role Access"
                                options={navRoleFilterOptions}
                                onChange={setSubmenuRoleFilter}
                              />
                            </th>
                            <th className="py-2.5 px-3 w-44">Pindah Kategori</th>
                            <th className="py-2.5 px-3 w-24 text-center">
                              <HeaderCategoryDropdown
                                label="Status"
                                value={submenuStatusFilter}
                                defaultValue="all"
                                allLabel="Semua Status"
                                options={navStatusFilterOptions}
                                onChange={setSubmenuStatusFilter}
                                sortActive={submenuSort.key === 'status' && Boolean(submenuSort.direction)}
                                sortDir={submenuSort.key === 'status' ? submenuSort.direction : null}
                                onCycleSort={() =>
                                  setSubmenuSort(prev => ({
                                    key: 'status',
                                    direction: prev.key === 'status' ? getNextSortDirection(prev.direction) : 'asc'
                                  }))
                                }
                              />
                            </th>
                            <th className="py-2.5 px-3 w-36 text-right">Aksi Manajemen</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#2D1754] text-xs">
                          {filteredInCat.map(sub => {
                            const SubIcon = getIconComp(sub.icon);
                            const sIndex = allInCat.findIndex(s => s.id === sub.id);
                            const isEditing = editingSubmenuId === sub.id;
                            const isSelected = selectedSubmenuIds.includes(sub.id);

                            return (
                              <tr
                                key={sub.id}
                                draggable={isSuperadmin && !isSubmenuFiltered}
                                onDragStart={() => handleDragStart('submenu', sub.id, cat.id)}
                                onDragOver={e => e.preventDefault()}
                                onDrop={() => {
                                  if (!isSubmenuFiltered) {
                                    handleDropSubmenu(cat.id, sIndex);
                                  }
                                }}
                                className={`group transition-colors odd:bg-white even:bg-[#F8FAFD] hover:bg-[#EDF3F8] dark:odd:bg-transparent dark:even:bg-transparent dark:hover:bg-[#1E1238]/75 ${
                                  sub.visible === false ? 'opacity-60' : ''
                                }`}
                              >
                                <td className="py-2.5 px-3 text-center">
                                  <div className="inline-flex items-center justify-center gap-1.5">
                                    {isSuperadmin && (
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => handleToggleSelectSubmenu(sub.id)}
                                        className="rounded border-[#9E95DE] dark:border-[#C9B6EA] text-[#5145A6] dark:text-[#58149C] focus:ring-0 cursor-pointer"
                                        title="Pilih untuk pindah batch"
                                      />
                                    )}
                                    {isSuperadmin && !isSubmenuFiltered && (
                                      <GripVertical className="w-3.5 h-3.5 text-[#A4B3C4] group-hover:text-[#5145A6] dark:text-purple-500/60 dark:group-hover:text-[#DAB9FF] cursor-grab" />
                                    )}
                                    <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                                      #{sIndex + 1}
                                    </span>
                                  </div>
                                </td>

                                <td className="py-2.5 px-3">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="p-2 rounded-lg bg-[#EAE8FF] dark:bg-[#261547] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#35105E] shrink-0">
                                      <SubIcon className="w-3.5 h-3.5" />
                                    </div>
                                    {isEditing ? (
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <input
                                          type="text"
                                          value={submenuDraftLabel}
                                          onChange={e => setSubmenuDraftLabel(e.target.value)}
                                          className="px-2.5 py-1 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-white rounded-lg focus:outline-hidden"
                                          autoFocus
                                        />
                                        <select
                                          value={submenuDraftIcon}
                                          onChange={e => setSubmenuDraftIcon(e.target.value)}
                                          className="px-2 py-1 text-xs tactile-debossed-input bg-white dark:bg-[#100921] text-[#26364A] dark:text-purple-200 rounded-lg focus:outline-hidden"
                                        >
                                          {AVAILABLE_ICONS.map(i => (
                                            <option key={i.name} value={i.name}>
                                              {i.label}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (submenuDraftLabel.trim()) {
                                              updateSubmenu(sub.id, {
                                                label: submenuDraftLabel.trim(),
                                                icon: submenuDraftIcon
                                              });
                                              setEditingSubmenuId(null);
                                              toast.success('Submenu diperbarui.');
                                            }
                                          }}
                                          className="p-1.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-lg cursor-pointer"
                                        >
                                          <Check className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingSubmenuId(null)}
                                          className="p-1.5 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 rounded-lg cursor-pointer"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="min-w-0">
                                        <div className="font-bold text-[#26364A] dark:text-white truncate">
                                          {sub.label}
                                        </div>
                                        <div className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#A79BC0]">
                                          /{sub.id}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>

                                <td className="py-2.5 px-3">
                                  <div className="flex flex-wrap gap-1">
                                    {(sub.roles || []).map(role => (
                                      <span
                                        key={role}
                                        className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
                                          role === 'super_admin'
                                            ? 'bg-[#6657C8] text-white dark:bg-[#7135B5]'
                                            : 'bg-[#F4F7FB] text-[#52647A] border border-[#DDE6F0] dark:bg-[#160D29] dark:text-[#CABDE8] dark:border-[#35105E]'
                                        }`}
                                      >
                                        {role.replace('_', ' ')}
                                      </span>
                                    ))}
                                  </div>
                                </td>

                                <td className="py-2.5 px-3">
                                  {isSuperadmin ? (
                                    <select
                                      value={sub.categoryId}
                                      onChange={e => {
                                        moveSubmenuToCategory(sub.id, e.target.value);
                                        toast.success('Submenu dipindahkan ke kategori baru.');
                                      }}
                                      className="w-full px-2 py-1.5 text-[10.5px] font-semibold bg-white dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-purple-200 rounded-xl focus:outline-hidden cursor-pointer"
                                      title="Pindahkan ke Kategori Lain"
                                    >
                                      {sortedCategories.map(c => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="text-[11px] font-semibold text-[#52647A] dark:text-[#CABDE8]">
                                      {cat.name}
                                    </span>
                                  )}
                                </td>

                                <td className="py-2.5 px-3 text-center">
                                  {isSuperadmin ? (
                                    <button
                                      type="button"
                                      role="switch"
                                      aria-checked={sub.visible !== false}
                                      onClick={() => toggleSubmenuActive(sub.id)}
                                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all cursor-pointer ${
                                        sub.visible !== false ? 'mj-switch-track-on' : 'mj-switch-track-off'
                                      }`}
                                      title={sub.visible !== false ? 'Submenu Aktif' : 'Submenu Nonaktif'}
                                    >
                                      <span
                                        className={`inline-block h-4 w-4 transform rounded-full mj-switch-thumb transition-transform ${
                                          sub.visible !== false ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                      />
                                    </button>
                                  ) : (
                                    <span className="text-[11px] font-bold">
                                      {sub.visible !== false ? 'Aktif' : 'Nonaktif'}
                                    </span>
                                  )}
                                </td>

                                <td className="py-2.5 px-3 text-right">
                                  {isSuperadmin && !isEditing && (
                                    <div className="inline-flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => moveSubmenu(sub.id, 'up')}
                                        disabled={sIndex === 0}
                                        className="mj-btn-icon-3d-leader w-7 h-7 cursor-pointer"
                                        title="Pindah ke Atas"
                                      >
                                        <ArrowUp className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveSubmenu(sub.id, 'down')}
                                        disabled={sIndex === allInCat.length - 1}
                                        className="mj-btn-icon-3d-leader w-7 h-7 cursor-pointer"
                                        title="Pindah ke Bawah"
                                      >
                                        <ArrowDown className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingSubmenuId(sub.id);
                                          setSubmenuDraftLabel(sub.label);
                                          setSubmenuDraftIcon(sub.icon || 'FileText');
                                        }}
                                        className="mj-btn-icon-3d-leader w-7 h-7 cursor-pointer"
                                        title="Edit Submenu"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeletingSubmenu(sub)}
                                        className="w-7 h-7 inline-flex items-center justify-center rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800/70 transition-colors cursor-pointer"
                                        title="Hapus Submenu"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
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
              );
            })}
        </div>
      )}

      {/* ================================================================ */}
      {/* BOTTOM DB INTEGRITY & QUICK STATS FOOTER BAR (STITCH TEMPLATES)  */}
      {/* ================================================================ */}
      <div className="bg-gradient-to-r from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:bg-none dark:bg-[#160D29] text-[#26364A] dark:text-white rounded-2xl border border-[#C5BEEF] dark:border-[#35105E] px-4 sm:px-5 py-3.5 shadow-[0_4px_12px_rgba(38,54,74,0.06)] dark:shadow-[0_4px_0_#0d061b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[#52647A] dark:text-[#CABDE8]">
          <span className="inline-flex items-center gap-1.5 font-bold text-[#26364A] dark:text-white">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>PostgreSQL Realtime:</span>
            <span className="font-mono text-[#5145A6] dark:text-[#DAB9FF]">app_settings / navigation_doc</span>
          </span>
          <span className="text-[#C5BEEF] dark:text-[#4B386B]">|</span>
          <span className="font-mono text-[11px] tabular-nums text-[#52647A] dark:text-[#EEDBFF]">
            {sortedCategories.length} Kategori · {sortedStandaloneMenus.length} Mandiri · {(submenuItems || []).length} Submenu · v{navDocVersion}
          </span>
        </div>

        <button
          type="button"
          onClick={handleReloadFromCloud}
          disabled={isCloudSyncing || isSaving}
          className="mj-btn-superadmin-lilac px-3.5 py-2 rounded-xl text-xs font-bold gap-1.5 cursor-pointer self-start sm:self-auto shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isCloudSyncing ? 'animate-spin' : ''}`} />
          <span>Force Re-sync</span>
        </button>
      </div>


      {/* ================================================================ */}
      {/* MODAL: TAMBAH KATEGORI BARU                                      */}
      {/* ================================================================ */}
      <ResponsiveModal
        isOpen={showAddCategoryModal}
        onClose={() => setShowAddCategoryModal(false)}
        title="Tambah Kategori Navigasi"
        icon={<Plus className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowAddCategoryModal(false)}
              className="px-4 py-2 text-xs font-semibold text-[#52647A] hover:text-[#26364A] dark:text-purple-300 dark:hover:text-white rounded-xl cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                if (!newCategoryName.trim()) {
                  toast.warning('Nama kategori tidak boleh kosong.');
                  return;
                }
                addCategory({
                  name: newCategoryName.trim(),
                  icon: newCategoryIcon,
                  mode: newCategoryMode,
                  allowMultipleOpen: true
                });
                toast.success(`Kategori "${newCategoryName.trim()}" ditambahkan.`);
                setNewCategoryName('');
                setShowAddCategoryModal(false);
              }}
              className="px-4 py-2 text-xs font-bold bg-[#6657C8] hover:bg-[#5145A6] dark:bg-[#7135B5] dark:hover:bg-[#8B4BC1] text-white rounded-xl cursor-pointer"
            >
              Tambah Kategori
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-[#26364A] dark:text-purple-200 block mb-1">
              Nama Kategori
            </label>
            <input
              type="text"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder="Contoh: Operasional Khusus"
              className="w-full px-3 py-2 text-xs bg-[#F4F7FB] dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white rounded-xl focus:border-[#6657C8] dark:focus:border-[#7135B5] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#26364A] dark:text-purple-200 block mb-1">
              Ikon Kategori
            </label>
            <select
              value={newCategoryIcon}
              onChange={e => setNewCategoryIcon(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F4F7FB] dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white rounded-xl focus:border-[#6657C8] dark:focus:border-[#7135B5] focus:outline-hidden"
            >
              {AVAILABLE_ICONS.map(i => (
                <option key={i.name} value={i.name}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#26364A] dark:text-purple-200 block mb-1">
              Mode Tampilan
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewCategoryMode('accordion')}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                  newCategoryMode === 'accordion'
                    ? 'bg-[#EAE8FF] border-[#6657C8] text-[#5145A6] dark:bg-[#7135B5]/40 dark:border-[#D8B4FE] dark:text-white'
                    : 'bg-[#F4F7FB] border-[#DDE6F0] text-[#52647A] dark:bg-[#100921] dark:border-[#35105E] dark:text-purple-300'
                }`}
              >
                Accordion (Collapsible)
              </button>
              <button
                type="button"
                onClick={() => setNewCategoryMode('static')}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                  newCategoryMode === 'static'
                    ? 'bg-[#EAE8FF] border-[#6657C8] text-[#5145A6] dark:bg-[#7135B5]/40 dark:border-[#D8B4FE] dark:text-white'
                    : 'bg-[#F4F7FB] border-[#DDE6F0] text-[#52647A] dark:bg-[#100921] dark:border-[#35105E] dark:text-purple-300'
                }`}
              >
                Static (Selalu Terbuka)
              </button>
            </div>
          </div>
        </div>
      </ResponsiveModal>

      {/* ================================================================ */}
      {/* MODAL: HAPUS KATEGORI & OPSI SUBMENU                             */}
      {/* ================================================================ */}
      <ResponsiveModal
        isOpen={Boolean(deletingCategory)}
        onClose={() => setDeletingCategory(null)}
        title={deletingCategory ? `Hapus Kategori "${deletingCategory.name}"?` : 'Hapus Kategori'}
        subtitle="Pilih penanganan untuk submenu yang berada di dalam kategori ini"
        icon={<AlertTriangle className="w-4 h-4 text-rose-500 dark:text-rose-400" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeletingCategory(null)}
              className="px-4 py-2 text-xs font-semibold text-[#52647A] hover:text-[#26364A] dark:text-purple-300 dark:hover:text-white cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                if (!deletingCategory) return;
                deleteCategory(deletingCategory.id, deleteSubmenuAction, deleteTargetCategoryId);
                toast.success(`Kategori "${deletingCategory.name}" telah dihapus.`);
                setDeletingCategory(null);
              }}
              className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl cursor-pointer"
            >
              Hapus Kategori
            </button>
          </>
        }
      >
        {deletingCategory && (
          <div className="space-y-3">
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] cursor-pointer">
              <input
                type="radio"
                name="delAction"
                checked={deleteSubmenuAction === 'move'}
                onChange={() => setDeleteSubmenuAction('move')}
                className="mt-0.5 text-[#6657C8] dark:text-purple-500 focus:ring-0"
              />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold text-[#26364A] dark:text-white block">
                  Pindahkan Submenu ke Kategori Lain
                </span>
                <select
                  value={deleteTargetCategoryId}
                  onChange={e => setDeleteTargetCategoryId(e.target.value)}
                  disabled={deleteSubmenuAction !== 'move'}
                  className="mt-2 w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white rounded-lg focus:outline-hidden"
                >
                  {sortedCategories
                    .filter(c => c.id !== deletingCategory.id)
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                </select>
              </div>
            </label>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] cursor-pointer">
              <input
                type="radio"
                name="delAction"
                checked={deleteSubmenuAction === 'disable'}
                onChange={() => setDeleteSubmenuAction('disable')}
                className="mt-0.5 text-[#6657C8] dark:text-purple-500 focus:ring-0"
              />
              <div>
                <span className="text-xs font-bold text-[#26364A] dark:text-white block">
                  Nonaktifkan Seluruh Submenu
                </span>
                <span className="text-[11px] text-[#52647A] dark:text-purple-300">
                  Submenu akan disembunyikan dari navigasi tanpa menghapus fungsi atau halaman aslinya.
                </span>
              </div>
            </label>
          </div>
        )}
      </ResponsiveModal>

      {/* ================================================================ */}
      {/* MODAL: HAPUS SUBMENU CONFIRMATION                                */}
      {/* ================================================================ */}
      <ResponsiveModal
        isOpen={Boolean(deletingSubmenu)}
        onClose={() => setDeletingSubmenu(null)}
        title={deletingSubmenu ? `Hapus Submenu "${deletingSubmenu.label}"?` : 'Hapus Submenu'}
        icon={<AlertTriangle className="w-4 h-4 text-rose-500 dark:text-rose-400" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeletingSubmenu(null)}
              className="px-4 py-2 text-xs font-semibold text-[#52647A] hover:text-[#26364A] dark:text-purple-300 dark:hover:text-white cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                if (!deletingSubmenu) return;
                deleteSubmenu(deletingSubmenu.id);
                toast.info(`Submenu "${deletingSubmenu.label}" dihapus dari draft.`);
                setDeletingSubmenu(null);
              }}
              className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl cursor-pointer"
            >
              Ya, Hapus Submenu
            </button>
          </>
        }
      >
        <p className="text-xs text-[#52647A] dark:text-purple-300 leading-relaxed">
          Perubahan akan berlaku secara global setelah Anda menekan tombol Simpan Konfigurasi.
        </p>
      </ResponsiveModal>

      {/* ================================================================ */}
      {/* MODAL: TAMBAH SUBMENU BARU                                       */}
      {/* ================================================================ */}
      <ResponsiveModal
        isOpen={showAddSubmenuModal}
        onClose={() => setShowAddSubmenuModal(false)}
        title="Tambah Submenu Baru"
        icon={<Plus className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowAddSubmenuModal(false)}
              className="px-4 py-2 text-xs font-semibold text-[#52647A] hover:text-[#26364A] dark:text-purple-300 dark:hover:text-white rounded-xl cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                if (!newSubmenuLabel.trim()) {
                  toast.warning('Label submenu tidak boleh kosong.');
                  return;
                }
                addSubmenu({
                  label: newSubmenuLabel.trim(),
                  icon: newSubmenuIcon,
                  categoryId: newSubmenuCategoryId,
                  roles: newSubmenuRoles
                });
                toast.success(`Submenu "${newSubmenuLabel.trim()}" ditambahkan.`);
                setNewSubmenuLabel('');
                setShowAddSubmenuModal(false);
              }}
              className="px-4 py-2 text-xs font-bold bg-[#6657C8] hover:bg-[#5145A6] dark:bg-[#7135B5] dark:hover:bg-[#8B4BC1] text-white rounded-xl cursor-pointer"
            >
              Tambah Submenu
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-[#26364A] dark:text-purple-200 block mb-1">
              Label Submenu
            </label>
            <input
              type="text"
              value={newSubmenuLabel}
              onChange={e => setNewSubmenuLabel(e.target.value)}
              placeholder="Contoh: Laporan Mingguan"
              className="w-full px-3 py-2 text-xs bg-[#F4F7FB] dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white rounded-xl focus:border-[#6657C8] dark:focus:border-[#7135B5] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#26364A] dark:text-purple-200 block mb-1">
              Kategori Induk (Parent Category)
            </label>
            <select
              value={newSubmenuCategoryId}
              onChange={e => setNewSubmenuCategoryId(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F4F7FB] dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white rounded-xl focus:border-[#6657C8] dark:focus:border-[#7135B5] focus:outline-hidden"
            >
              {sortedCategories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#26364A] dark:text-purple-200 block mb-1">
              Ikon Submenu
            </label>
            <select
              value={newSubmenuIcon}
              onChange={e => setNewSubmenuIcon(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F4F7FB] dark:bg-[#100921] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white rounded-xl focus:border-[#6657C8] dark:focus:border-[#7135B5] focus:outline-hidden"
            >
              {AVAILABLE_ICONS.map(i => (
                <option key={i.name} value={i.name}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#26364A] dark:text-purple-200 block mb-1">
              Hak Akses Role
            </label>
            <div className="flex flex-wrap gap-2">
              {['super_admin', 'dispatch', 'leader', 'installer'].map(r => (
                <label key={r} className="flex items-center gap-1.5 text-xs text-[#52647A] dark:text-purple-300">
                  <input
                    type="checkbox"
                    checked={newSubmenuRoles.includes(r)}
                    onChange={e => {
                      if (e.target.checked) {
                        setNewSubmenuRoles(prev => [...prev, r]);
                      } else {
                        setNewSubmenuRoles(prev => prev.filter(x => x !== r));
                      }
                    }}
                    className="rounded border-[#DDE6F0] dark:border-[#35105E] text-[#6657C8] dark:text-purple-600 focus:ring-0"
                  />
                  <span className="capitalize">{r.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </ResponsiveModal>

      {/* ================================================================ */}
      {/* MODAL: RESET DEFAULT CONFIRMATION                                */}
      {/* ================================================================ */}
      <ResponsiveModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title="Reset ke Default Navigasi?"
        icon={<AlertTriangle className="w-4 h-4 text-rose-500 dark:text-rose-400" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowResetConfirm(false)}
              className="px-4 py-2 text-xs font-semibold text-[#52647A] hover:text-[#26364A] dark:text-purple-300 dark:hover:text-white cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirmReset}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl cursor-pointer"
            >
              Reset Default
            </button>
          </>
        }
      >
        <p className="text-xs text-[#52647A] dark:text-purple-300 leading-relaxed">
          Tindakan ini akan mengembalikan susunan 7 Menu Mandiri dan 3 Kategori Accordion (Contractor &amp; Area, Installer, Menu Tambahan) ke konfigurasi standar.
        </p>
      </ResponsiveModal>

      {/* ================================================================ */}
      {/* MODAL: LIVE PREVIEW SIDEBAR & WHITE THEME BOTTOM NAV              */}
      {/* ================================================================ */}
      <ResponsiveModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        title="Pratinjau Navigasi MoraJaws"
        subtitle="Pratinjau tampilan navigasi Sidebar dan Bottom Navigation Bright Theme dengan berbagai peran user."
        icon={<Eye className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />}
        variant="dark_purple"
        size="xl"
        mobileVariant="fullscreen"
        zIndexClass="z-60"
        headerExtra={
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-[#52647A] dark:text-purple-300 font-semibold whitespace-nowrap">Simulasikan Role:</span>
            <select
              value={previewRole}
              onChange={e => setPreviewRole(e.target.value as any)}
              className="px-2.5 py-1.5 text-xs bg-[#F4F7FB] dark:bg-[#160D29] border border-[#C5BEEF] dark:border-[#7135B5] text-[#26364A] dark:text-white rounded-lg focus:outline-hidden"
            >
              <option value="super_admin">Super Admin</option>
              <option value="dispatch">Dispatch</option>
              <option value="leader">Leader / Korlap</option>
              <option value="installer">Teknisi / Installer</option>
            </select>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Preview 1: Sidebar Mockup */}
          <div className="bg-[#100A21] border border-[#35105E] rounded-xl p-3 flex flex-col">
            <div className="pb-2 border-b border-[#35105E] text-[11px] font-bold text-[#D8B4FE] uppercase">
              Sidebar Navigation (Dark Purple Gloss)
            </div>

            <div className="flex-1 py-2 space-y-2 overflow-y-auto">
              {/* Standalone items */}
              <div className="space-y-1">
                {previewRole === 'installer' ? (
                  <>
                    <div className="px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-[#5B35B1] to-[#7135B5] text-white border-l-4 border-l-[#D8B4FE] flex items-center gap-2">
                      <LayoutDashboard className="w-4 h-4 text-[#D8B4FE]" />
                      <span>Dashboard Installer</span>
                    </div>
                    <div className="px-3 py-2 rounded-xl text-xs font-semibold text-purple-200 hover:bg-[#35105E]/50 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-purple-300" />
                      <span>Tugas Saya</span>
                    </div>
                  </>
                ) : (
                  sortedStandaloneMenus
                    .filter(m => m.visible !== false && (!m.roles || (Array.isArray(m.roles) && m.roles.includes(previewRole))))
                    .map((m, idx) => {
                      const IconComp = getIconComp(m.icon);
                      return (
                        <div
                          key={m.id}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                            idx === 0
                              ? 'bg-gradient-to-r from-[#5B35B1] to-[#7135B5] text-white border-l-4 border-l-[#D8B4FE]'
                              : 'text-purple-200 hover:bg-[#35105E]/40'
                          }`}
                        >
                          <IconComp className="w-4 h-4 text-[#D8B4FE]" />
                          <span>{m.label}</span>
                        </div>
                      );
                    })
                )}
              </div>

              {/* Accordion Categories for non-installer */}
              {previewRole !== 'installer' && (
                <div className="space-y-2 pt-2 border-t border-[#35105E]/60">
                  {sortedCategories
                    .filter(c => c.isActive !== false)
                    .map(c => {
                      const subs = (submenusByCategory.get(c.id) || []).filter(
                        s => s.visible !== false && (!s.roles || (Array.isArray(s.roles) && s.roles.includes(previewRole)))
                      );
                      if (subs.length === 0) return null;

                      const isOpen = !!previewOpenGroups[c.id];
                      const CatIcon = getIconComp(c.icon);

                      return (
                        <div key={c.id} className="rounded-xl bg-[#1C1133]/60 border border-[#35105E]/40">
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewOpenGroups(prev => ({
                                ...prev,
                                [c.id]: !prev[c.id]
                              }))
                            }
                            className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-purple-200 cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <CatIcon className="w-3.5 h-3.5 text-[#D8B4FE]" />
                              <span className="uppercase text-[11px]">{c.name}</span>
                            </div>
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform ${
                                isOpen ? 'rotate-180 text-[#D8B4FE]' : ''
                              }`}
                            />
                          </button>

                          {isOpen && (
                            <div className="space-y-1 p-1.5 pt-0 border-t border-[#35105E]/30">
                              {subs.map(s => {
                                const SubIcon = getIconComp(s.icon);
                                return (
                                  <div
                                    key={s.id}
                                    className="px-2.5 py-1.5 rounded-lg text-xs text-purple-200 flex items-center gap-2 hover:bg-[#35105E]/40"
                                  >
                                    <SubIcon className="w-3.5 h-3.5 text-purple-400" />
                                    <span>{s.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Preview 2: Mobile Bottom Navigation White Theme */}
          <div className="bg-slate-100 rounded-xl p-3 flex flex-col justify-between border border-slate-300">
            <div>
              <div className="pb-2 border-b border-slate-300 text-[11px] font-bold text-purple-900 uppercase">
                Bottom Navigation (Bright White Theme)
              </div>
              <p className="text-xs text-slate-600 mt-2">
                Menggunakan background putih bersih (#FFFFFF), highlight aktif (#F3EDFA), teks/ikon aktif (#6F35A5), serta indicator (#8B4BC1).
              </p>
            </div>

            {/* Mockup of White Theme Bottom Bar */}
            <div className="mt-8 bg-[#FFFFFF] border-t border-[#E9E1F0] rounded-xl shadow-lg p-2 flex items-center justify-around">
              {previewRole === 'installer' ? (
                <>
                  <div className="flex flex-col items-center py-1 px-3 rounded-xl bg-[#F3EDFA] text-[#6F35A5]">
                    <LayoutDashboard className="w-5 h-5 text-[#6F35A5]" />
                    <span className="text-[10px] font-bold mt-0.5">Beranda</span>
                  </div>
                  <div className="flex flex-col items-center py-1 px-3 text-[#8B8495]">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-[10px] font-medium mt-0.5">Tugas</span>
                  </div>
                  <div className="flex flex-col items-center py-1 px-3 text-[#8B8495]">
                    <FolderTree className="w-5 h-5" />
                    <span className="text-[10px] font-medium mt-0.5">Menu</span>
                  </div>
                </>
              ) : previewRole === 'leader' ? (
                <>
                  <div className="flex flex-col items-center py-1 px-3 rounded-xl bg-[#F3EDFA] text-[#6F35A5]">
                    <BarChart3 className="w-5 h-5 text-[#6F35A5]" />
                    <span className="text-[10px] font-bold mt-0.5">Progress</span>
                  </div>
                  <div className="flex flex-col items-center py-1 px-3 text-[#8B8495]">
                    <UserCheck className="w-5 h-5" />
                    <span className="text-[10px] font-medium mt-0.5">Assign</span>
                  </div>
                  <div className="flex flex-col items-center py-1 px-3 text-[#8B8495]">
                    <UserPlus className="w-5 h-5" />
                    <span className="text-[10px] font-medium mt-0.5">Teknisi</span>
                  </div>
                  <div className="flex flex-col items-center py-1 px-3 text-[#8B8495]">
                    <FolderTree className="w-5 h-5" />
                    <span className="text-[10px] font-medium mt-0.5">Menu</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center py-1 px-3 rounded-xl bg-[#F3EDFA] text-[#6F35A5]">
                    <LayoutDashboard className="w-5 h-5 text-[#6F35A5]" />
                    <span className="text-[10px] font-bold mt-0.5">Monitoring</span>
                  </div>
                  <div className="flex flex-col items-center py-1 px-3 text-[#8B8495]">
                    <TicketIcon className="w-5 h-5" />
                    <span className="text-[10px] font-medium mt-0.5">Tiket</span>
                  </div>
                  <div className="flex flex-col items-center py-1 px-3 text-[#8B8495]">
                    <FileSpreadsheet className="w-5 h-5" />
                    <span className="text-[10px] font-medium mt-0.5">Laporan</span>
                  </div>
                  <div className="flex flex-col items-center py-1 px-3 text-[#8B8495]">
                    <FolderTree className="w-5 h-5" />
                    <span className="text-[10px] font-medium mt-0.5">Menu</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </ResponsiveModal>
    </div>
  );
};
