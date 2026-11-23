import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { HierarchicalStatus, HierarchicalReason, DroplistItem } from '../../types';
import {
  Layers,
  Plus,
  Trash2,
  Edit2,
  Check,
  ChevronDown,
  ChevronRight,
  Search,
  MoveRight,
  AlertTriangle,
  FolderTree,
  CheckCircle2,
  CornerDownRight,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Database,
  RefreshCw,
  Eye,
  EyeOff,
  Sliders,
  ShieldCheck,
  FileCheck,
  CheckCheck
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  getGlobalConfig,
  saveGlobalConfig,
  subscribeToGlobalConfigUpdates
} from '../../services/globalConfigService';
import { ResponsiveModal } from '../common/ResponsiveModal';

export const DroplistManagementView: React.FC = () => {
  const {
    currentUser,
    hierarchicalStatuses,
    saveHierarchicalDroplistsDirect,
    addHierarchicalStatus,
    updateHierarchicalStatus,
    deleteHierarchicalStatus,
    addHierarchicalReason,
    updateHierarchicalReason,
    deleteHierarchicalReason,
    moveHierarchicalReason,
    reconcileDroplistsNow
  } = useApp();
  const { toast } = useToast();

  const isSuperAdmin = currentUser?.role === 'super_admin';
  const [isSaving, setIsSaving] = useState(false);

  const [activeMainTab, setActiveMainTab] = useState<'hierarchy' | 'static_droplists'>('hierarchy');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterActiveState, setFilterActiveState] = useState<'all' | 'active_only' | 'inactive_only'>('all');
  const [isReconciling, setIsReconciling] = useState(false);

  // Confirm Delete Level 1 Status Modal (replaces window.confirm)
  const [confirmDeleteStatus, setConfirmDeleteStatus] = useState<{
    status: HierarchicalStatus;
    totalReasons: number;
  } | null>(null);

  // Expand / Collapse state for Level 1 (Status)
  const [expandedStatusIds, setExpandedStatusIds] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    (hierarchicalStatuses || []).forEach(s => {
      init[s.id] = true;
    });
    return init;
  });

  // Modals state
  const [isAddStatusOpen, setIsAddStatusOpen] = useState(false);
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusCode, setNewStatusCode] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#6657C8');

  // Reason Modal
  const [targetStatusIdForReason, setTargetStatusIdForReason] = useState<string | null>(null);
  const [newReasonName, setNewReasonName] = useState('');
  const [newReasonCode, setNewReasonCode] = useState('');

  // Move Reason Modal
  const [movingReason, setMovingReason] = useState<{ reason: HierarchicalReason; fromStatusId: string } | null>(null);
  const [targetMoveStatusId, setTargetMoveStatusId] = useState<string>('');

  // Edit in place / Edit Modal
  const [editingItem, setEditingItem] = useState<{
    type: 'status' | 'reason';
    id: string;
    parentStatusId?: string;
    name: string;
    code?: string;
    color?: string;
  } | null>(null);

  // General Static Droplists state (Slot Waktu, Kategori Tiket, Status Agent)
  const [activeGeneralCategory, setActiveGeneralCategory] = useState<DroplistItem['category']>('slot_time');
  const [generalDroplists, setGeneralDroplists] = useState<DroplistItem[]>([
    { id: 'd-15', category: 'slot_time', label: '09:00 - 11:00 WIB', value: '09:00 - 11:00 WIB', order: 1, active: true },
    { id: 'd-16', category: 'slot_time', label: '11:00 - 13:00 WIB', value: '11:00 - 13:00 WIB', order: 2, active: true },
    { id: 'd-17', category: 'slot_time', label: '13:00 - 15:00 WIB', value: '13:00 - 15:00 WIB', order: 3, active: true },
    { id: 'd-18', category: 'slot_time', label: '15:00 - 17:00 WIB', value: '15:00 - 17:00 WIB', order: 4, active: true },
    { id: 'd-19', category: 'ticket_category', label: 'New Installation FTTH', value: 'New Installation FTTH', order: 1, active: true },
    { id: 'd-20', category: 'ticket_category', label: 'Relocation ONT', value: 'Relocation ONT', order: 2, active: true },
    { id: 'd-21', category: 'ticket_category', label: 'Maintenance LOS Red Light', value: 'Maintenance LOS Red Light', order: 3, active: true },
    { id: 'd-22', category: 'ticket_category', label: 'Upgrade Bandwidth + Mesh', value: 'Upgrade Bandwidth + Mesh', order: 4, active: true },
    { id: 'd-23', category: 'ticket_category', label: 'Dismantle Perangkat', value: 'Dismantle Perangkat', order: 5, active: true }
  ]);
  const [newGeneralLabel, setNewGeneralLabel] = useState('');
  const [newGeneralValue, setNewGeneralValue] = useState('');

  // Load & subscribe to real-time Supabase PostgreSQL updates for general droplists
  React.useEffect(() => {
    let mounted = true;
    getGlobalConfig<{ items?: DroplistItem[] } | DroplistItem[]>('general_droplists')
      .then(res => {
        if (!mounted || !res.value) return;
        const items = Array.isArray(res.value) ? res.value : res.value.items;
        if (Array.isArray(items) && items.length > 0) {
          setGeneralDroplists(items);
        }
      })
      .catch(err => {
        console.warn('[Supabase] Error loading general droplists:', err?.message || err);
      });

    const unsub = subscribeToGlobalConfigUpdates(
      ev => {
        if (!mounted || ev.key !== 'general_droplists' || !ev.value) return;
        const items = Array.isArray(ev.value) ? ev.value : ev.value.items;
        if (Array.isArray(items)) {
          setGeneralDroplists(items);
        }
      },
      err => {
        console.warn('[Supabase] Error subscribing to general droplists:', err);
      }
    );
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  // Compute Total Metrics across the 2-level hierarchy
  const metrics = useMemo(() => {
    let totalStatuses = 0;
    let activeStatuses = 0;
    let totalReasons = 0;
    let activeReasons = 0;

    (hierarchicalStatuses || []).forEach(s => {
      totalStatuses++;
      if (s.active !== false && (s as any).isActive !== false) activeStatuses++;

      (s.reasons || []).forEach(r => {
        totalReasons++;
        if (r.active !== false && (r as any).isActive !== false) activeReasons++;
      });
    });

    return {
      totalStatuses,
      activeStatuses,
      totalReasons,
      activeReasons
    };
  }, [hierarchicalStatuses]);

  // Expand / Collapse toggles
  const toggleStatusExpand = (id: string) => {
    setExpandedStatusIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExpandAll = () => {
    const sMap: Record<string, boolean> = {};
    hierarchicalStatuses.forEach(s => {
      sMap[s.id] = true;
    });
    setExpandedStatusIds(sMap);
  };

  const handleCollapseAll = () => {
    setExpandedStatusIds({});
  };

  // Reorder Handlers with Database-First OCC persistence via AppContext
  const handleMoveStatusOrder = async (statusId: string, direction: 'up' | 'down') => {
    if (!isSuperAdmin || isSaving) return;
    const idx = hierarchicalStatuses.findIndex(s => s.id === statusId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= hierarchicalStatuses.length) return;
    const copy = [...hierarchicalStatuses];
    const temp = copy[idx];
    copy[idx] = copy[targetIdx];
    copy[targetIdx] = temp;
    const reordered = copy.map((s, i) => ({ ...s, order: i + 1 }));
    setIsSaving(true);
    try {
      const res = await saveHierarchicalDroplistsDirect(reordered, `Reordered Status WO ${temp.name}`);
      if (res.success) {
        toast.success('Urutan Status WO berhasil disimpan ke database.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleMoveReasonOrder = async (statusId: string, reasonId: string, direction: 'up' | 'down') => {
    if (!isSuperAdmin || isSaving) return;
    const status = hierarchicalStatuses.find(s => s.id === statusId);
    if (!status) return;
    const idx = status.reasons.findIndex(r => r.id === reasonId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= status.reasons.length) return;
    const updated = hierarchicalStatuses.map(s => {
      if (s.id !== statusId) return s;
      const reasonsCopy = [...s.reasons];
      const temp = reasonsCopy[idx];
      reasonsCopy[idx] = reasonsCopy[targetIdx];
      reasonsCopy[targetIdx] = temp;
      return {
        ...s,
        reasons: reasonsCopy.map((r, i) => ({ ...r, order: i + 1 }))
      };
    });
    setIsSaving(true);
    try {
      const res = await saveHierarchicalDroplistsDirect(updated, `Reordered Reason WO ${reasonId}`);
      if (res.success) {
        toast.success('Urutan Reason WO berhasil disimpan ke database.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Reconcile Data Action
  const handleTriggerReconcile = async () => {
    if (!isSuperAdmin || isReconciling || isSaving) return;
    setIsReconciling(true);
    try {
      await reconcileDroplistsNow();
    } finally {
      setIsReconciling(false);
    }
  };

  // Search & Active Filter
  const filteredStatuses = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return hierarchicalStatuses
      .filter(s => {
        const isAct = s.active !== false && (s as any).isActive !== false;
        if (filterActiveState === 'active_only') return isAct;
        if (filterActiveState === 'inactive_only') return !isAct;
        return true;
      })
      .map(status => {
        if (!q) return status;

        const statusMatch = String(status.name || '').toLowerCase().includes(q) || (status.code && String(status.code).toLowerCase().includes(q));
        const matchingReasons = (status.reasons || []).filter(reason => {
          return (
            String(reason.name || '').toLowerCase().includes(q) ||
            Boolean(reason.code && String(reason.code).toLowerCase().includes(q))
          );
        });

        if (statusMatch || matchingReasons.length > 0) {
          return {
            ...status,
            reasons: statusMatch ? status.reasons : matchingReasons
          };
        }
        return null;
      })
      .filter(Boolean) as HierarchicalStatus[];
  }, [hierarchicalStatuses, searchQuery, filterActiveState]);

  // General Droplists Add, Delete & Toggle Handlers (Database-First)
  const currentGeneralItems = generalDroplists
    .filter(d => d.category === activeGeneralCategory)
    .sort((a, b) => a.order - b.order);

  const handleAddGeneralItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin || isSaving || !newGeneralLabel.trim()) return;
    const val = newGeneralValue.trim() || newGeneralLabel.trim();
    const newItem: DroplistItem = {
      id: 'drop-' + Date.now(),
      category: activeGeneralCategory,
      label: newGeneralLabel.trim(),
      value: val,
      order: currentGeneralItems.length + 1,
      active: true
    };
    const updated = [...generalDroplists, newItem];
    setIsSaving(true);
    try {
      await saveGlobalConfig(
        'general_droplists',
        { items: updated, updatedAt: new Date().toISOString() },
        { module: 'general_droplists', description: `Tambah item droplist statis: ${newItem.label}` }
      );
      setGeneralDroplists(updated);
      setNewGeneralLabel('');
      setNewGeneralValue('');
      toast.success(`Item "${newItem.label}" berhasil disimpan ke database.`);
    } catch (err: any) {
      toast.error('Gagal menyimpan ke database: ' + (err?.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteGeneralItem = async (id: string) => {
    if (!isSuperAdmin || isSaving) return;
    const target = generalDroplists.find(d => d.id === id);
    const updated = generalDroplists.filter(d => d.id !== id);
    setIsSaving(true);
    try {
      await saveGlobalConfig(
        'general_droplists',
        { items: updated, updatedAt: new Date().toISOString() },
        { module: 'general_droplists', description: `Hapus item droplist statis: ${target?.label || id}` }
      );
      setGeneralDroplists(updated);
      toast.info('Item berhasil dihapus dari database.');
    } catch (err: any) {
      toast.error('Gagal menghapus dari database: ' + (err?.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleGeneralActive = async (id: string) => {
    if (!isSuperAdmin || isSaving) return;
    const updated = generalDroplists.map(d => d.id === id ? { ...d, active: !d.active } : d);
    setIsSaving(true);
    try {
      await saveGlobalConfig(
        'general_droplists',
        { items: updated, updatedAt: new Date().toISOString() },
        { module: 'general_droplists', description: `Ubah status aktif droplist statis ${id}` }
      );
      setGeneralDroplists(updated);
      toast.success('Status item droplist statis diperbarui di database.');
    } catch (err: any) {
      toast.error('Gagal mengubah status di database: ' + (err?.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {!isSuperAdmin && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 dark:bg-amber-950/50 dark:border-amber-500/40 dark:text-amber-200 text-xs flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            <strong>Mode Baca (Read-Only):</strong> Perubahan droplist global (Status WO, Reason WO, dan Droplist Statis) hanya dapat dilakukan oleh <strong>Super Admin</strong>.
          </span>
        </div>
      )}

      {/* ============================================================ */}
      {/* TOP HEADER BANNER                                            */}
      {/* ============================================================ */}
      <div className="bg-gradient-to-r from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:bg-none dark:bg-[#160D29] rounded-2xl border border-[#C5BEEF] dark:border-[#D8B4FE]/30 p-5 shadow-sm dark:shadow-[0_4px_24px_rgba(22,13,41,0.6)] relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#9E95DE]/50 dark:via-[#D8B4FE]/60 to-transparent" />

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white border border-[#C5BEEF] text-[#5145A6] shadow-xs dark:bg-gradient-to-br dark:from-[#7135B5] dark:to-[#35105E] dark:border-[#D8B4FE]/50 dark:text-white flex items-center justify-center shrink-0 dark:shadow-[0_0_15px_rgba(113,53,181,0.4)]">
            <Layers className="w-5 h-5 text-[#5145A6] dark:text-[#E9D5FF]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-extrabold text-[#26364A] dark:text-white tracking-tight">
                DROPLIST MANAGEMENT
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-white/90 text-[#5145A6] border border-[#C5BEEF] dark:bg-[#35105E] dark:text-[#D8B4FE] dark:border-[#D8B4FE]/30">
                <Database className="w-3 h-3 text-[#6657C8] dark:text-[#A855F7]" />
                <span>Single Source of Truth • Supabase PostgreSQL</span>
              </span>
            </div>
            <p className="text-xs text-[#52647A] dark:text-[#D8B4FE]/80 mt-0.5">
              Sistem konfigurasi terpadu 2-tingkat: <strong>Status WO (Level 1)</strong> → <strong>Reason WO (Level 2)</strong>.
            </p>
          </div>
        </div>

        {/* Top Header Buttons */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={handleTriggerReconcile}
            disabled={!isSuperAdmin || isReconciling || isSaving}
            className="px-3 py-1.5 text-xs font-semibold text-[#5145A6] hover:text-[#26364A] bg-white/90 hover:bg-white border border-[#C5BEEF] dark:text-[#D8B4FE] dark:hover:text-white dark:bg-[#35105E]/70 dark:hover:bg-[#35105E] dark:border-[#D8B4FE]/30 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title="Sinkronisasikan dan verifikasi rekonsiliasi data lama ke hierarki utama"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#6657C8] dark:text-[#A855F7] ${isReconciling ? 'animate-spin' : ''}`} />
            <span>{isReconciling ? 'Menyelaraskan...' : 'Rekonsiliasi Data'}</span>
          </button>

          <button
            type="button"
            disabled={!isSuperAdmin || isSaving}
            onClick={() => {
              if (!isSuperAdmin) return;
              setNewStatusName('');
              setNewStatusCode('');
              setNewStatusColor('#6657C8');
              setIsAddStatusOpen(true);
            }}
            className="px-4 py-2 text-xs font-bold text-white bg-[#6657C8] hover:bg-[#5145A6] border border-[#9E95DE] shadow-sm dark:bg-gradient-to-r dark:from-[#7135B5] dark:to-[#A855F7] dark:hover:from-[#7E3CC7] dark:hover:to-[#B666FE] rounded-xl flex items-center justify-center gap-1.5 dark:shadow-[0_0_18px_rgba(168,85,247,0.4)] dark:border-[#E9D5FF]/30 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            <span>+ Tambah Status WO (Level 1)</span>
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2-LEVEL ARCHITECTURE METRICS SUMMARY CARDS                   */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Level 1: Status WO */}
        <div className="bg-white dark:bg-[#160D29]/80 rounded-2xl border border-[#DDE6F0] dark:border-[#D8B4FE]/20 p-3.5 flex items-center justify-between shadow-xs dark:shadow-none">
          <div>
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#8492A5] dark:text-[#D8B4FE]/60 block">
              Level 1 (Parent)
            </span>
            <div className="text-sm font-extrabold text-[#26364A] dark:text-white mt-0.5">
              Status WO
            </div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono mt-0.5">
              {metrics.activeStatuses} Aktif <span className="text-[#8492A5] dark:text-[#D8B4FE]/40">/ {metrics.totalStatuses} Total</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] border border-[#C5BEEF] text-[#5145A6] dark:bg-[#35105E]/80 dark:border-[#A855F7]/40 dark:text-white flex items-center justify-center font-bold text-sm">
            {metrics.totalStatuses}
          </div>
        </div>

        {/* Level 2: Reason WO */}
        <div className="bg-white dark:bg-[#160D29]/80 rounded-2xl border border-[#DDE6F0] dark:border-[#D8B4FE]/20 p-3.5 flex items-center justify-between shadow-xs dark:shadow-none">
          <div>
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#8492A5] dark:text-[#D8B4FE]/60 block">
              Level 2 (Child)
            </span>
            <div className="text-sm font-extrabold text-[#26364A] dark:text-white mt-0.5">
              Reason WO
            </div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono mt-0.5">
              {metrics.activeReasons} Aktif <span className="text-[#8492A5] dark:text-[#D8B4FE]/40">/ {metrics.totalReasons} Total</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] border border-[#C5BEEF] text-[#5145A6] dark:bg-[#35105E]/80 dark:border-[#A855F7]/40 dark:text-white flex items-center justify-center font-bold text-sm">
            {metrics.totalReasons}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* NAVIGATION TABS: HIERARCHICAL TREE VS STATIC DROPLISTS       */}
      {/* ============================================================ */}
      <div className="flex items-center gap-2 border-b border-[#DDE6F0] dark:border-[#D8B4FE]/20 pb-1 text-xs overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveMainTab('hierarchy')}
          className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            activeMainTab === 'hierarchy'
              ? 'bg-[#6657C8] text-white border border-[#9E95DE] shadow-sm dark:bg-[#7135B5] dark:shadow-[0_0_15px_rgba(113,53,181,0.4)] dark:border-[#E9D5FF]/40'
              : 'bg-[#F4F7FB] text-[#52647A] hover:bg-[#EDF3F8] hover:text-[#26364A] border border-[#DDE6F0] dark:bg-[#1E1138]/40 dark:text-[#D8B4FE]/80 dark:hover:bg-[#35105E]/40 dark:hover:text-white dark:border-[#D8B4FE]/20'
          }`}
        >
          <FolderTree className={`w-3.5 h-3.5 ${activeMainTab === 'hierarchy' ? 'text-white dark:text-[#E9D5FF]' : 'text-[#5145A6] dark:text-[#E9D5FF]'}`} />
          <span>Hierarchical Tree (Status → Reason)</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            activeMainTab === 'hierarchy'
              ? 'bg-white/20 text-white'
              : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-white/20 dark:text-white'
          }`}>
            {metrics.totalStatuses}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainTab('static_droplists')}
          className={`px-4 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            activeMainTab === 'static_droplists'
              ? 'bg-[#6657C8] text-white border border-[#9E95DE] shadow-sm dark:bg-[#7135B5] dark:shadow-[0_0_15px_rgba(113,53,181,0.4)] dark:border-[#E9D5FF]/40'
              : 'bg-[#F4F7FB] text-[#52647A] hover:bg-[#EDF3F8] hover:text-[#26364A] border border-[#DDE6F0] dark:bg-[#1E1138]/40 dark:text-[#D8B4FE]/80 dark:hover:bg-[#35105E]/40 dark:hover:text-white dark:border-[#D8B4FE]/20'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Droplist Statis & Slot Waktu ({generalDroplists.length})</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/* TAB 1: HIERARCHICAL TREE VIEW                                */}
      {/* ============================================================ */}
      {activeMainTab === 'hierarchy' && (
        <div className="space-y-4">
          {/* Controls: Search, Expand All, Active Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#160D29]/70 rounded-2xl border border-[#DDE6F0] dark:border-[#D8B4FE]/20 p-3.5 shadow-xs dark:shadow-none">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#D8B4FE]/60 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari status atau reason di seluruh hirarki..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/30 border border-[#DDE6F0] dark:border-[#D8B4FE]/25 rounded-xl text-xs text-[#26364A] dark:text-white placeholder-[#8492A5] dark:placeholder-[#D8B4FE]/40 focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Filter Active / Inactive */}
              <select
                value={filterActiveState}
                onChange={e => setFilterActiveState(e.target.value as any)}
                className="px-3 py-1.5 bg-[#F4F7FB] dark:bg-[#35105E]/40 border border-[#DDE6F0] dark:border-[#D8B4FE]/25 rounded-xl text-xs text-[#26364A] dark:text-white focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none cursor-pointer"
              >
                <option value="all">Semua Status (Aktif & Nonaktif)</option>
                <option value="active_only">Hanya Status Aktif</option>
                <option value="inactive_only">Hanya Status Nonaktif</option>
              </select>

              <button
                type="button"
                onClick={handleExpandAll}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#5145A6] hover:text-[#26364A] bg-[#F4F7FB] hover:bg-[#EAE8FF] dark:text-[#D8B4FE] dark:hover:text-white dark:bg-[#35105E]/40 dark:hover:bg-[#35105E]/70 rounded-xl border border-[#DDE6F0] dark:border-[#D8B4FE]/25 cursor-pointer"
              >
                Expand All
              </button>
              <button
                type="button"
                onClick={handleCollapseAll}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#5145A6] hover:text-[#26364A] bg-[#F4F7FB] hover:bg-[#EAE8FF] dark:text-[#D8B4FE] dark:hover:text-white dark:bg-[#35105E]/40 dark:hover:bg-[#35105E]/70 rounded-xl border border-[#DDE6F0] dark:border-[#D8B4FE]/25 cursor-pointer"
              >
                Collapse All
              </button>
            </div>
          </div>

          {/* Hierarchical Tree Container */}
          <div className="space-y-3">
            {filteredStatuses.length === 0 ? (
              <div className="p-10 text-center text-xs text-[#52647A] dark:text-[#D8B4FE]/70 bg-white dark:bg-[#160D29]/60 rounded-2xl border border-[#DDE6F0] dark:border-[#D8B4FE]/20 space-y-2">
                <AlertTriangle className="w-8 h-8 text-[#8492A5] dark:text-[#D8B4FE]/50 mx-auto" />
                <p className="font-semibold text-[#26364A] dark:text-white">Tidak ada data status yang cocok dengan filter atau pencarian.</p>
                <p className="text-[11px]">Coba reset kata kunci atau klik "+ Tambah Status WO (Level 1)".</p>
              </div>
            ) : (
              filteredStatuses.map(status => {
                const isExpanded = Boolean(expandedStatusIds[status.id]);
                const statusReasons = status.reasons || [];
                const totalStatusReasons = statusReasons.length;
                const isStatusActive = status.active !== false && (status as any).isActive !== false;

                return (
                  <div
                    key={status.id}
                    className={`rounded-2xl border transition-all overflow-hidden ${
                      isStatusActive
                        ? 'bg-white border-[#DDE6F0] shadow-xs dark:bg-[#160D29] dark:border-[#D8B4FE]/30 dark:shadow-md'
                        : 'bg-[#F4F7FB] border-[#E2E8F0] opacity-75 dark:bg-[#160D29]/60 dark:border-white/10'
                    }`}
                  >
                    {/* LEVEL 1: STATUS HEADER BAR */}
                    <div className="p-3.5 sm:p-4 bg-gradient-to-r from-[#EAE8FF]/70 via-[#F4F7FB] to-[#DDF4F4]/60 dark:from-[#1E0F3D] dark:to-[#160D29] border-b border-[#DDE6F0] dark:border-[#D8B4FE]/20 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleStatusExpand(status.id)}
                          className="p-1 rounded-lg text-[#5145A6] hover:bg-[#EAE8FF] dark:text-[#D8B4FE] dark:hover:bg-[#35105E] cursor-pointer transition-colors"
                          title={isExpanded ? 'Tutup Detail' : 'Buka Detail'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[#6657C8] dark:text-[#A855F7]" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[#8492A5] dark:text-[#D8B4FE]/60" />
                          )}
                        </button>

                        <span
                          className="w-3.5 h-3.5 rounded-full shadow-[0_0_8px_currentColor] shrink-0"
                          style={{ backgroundColor: status.color || '#6657C8', color: status.color || '#6657C8' }}
                        />

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-xs sm:text-sm text-[#26364A] dark:text-white">
                              {status.name}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white text-[#5145A6] border border-[#C5BEEF] dark:bg-[#35105E] dark:text-[#D8B4FE] dark:border-[#D8B4FE]/30 font-bold">
                              Level 1 • {status.code || status.name.toUpperCase()}
                            </span>

                            {/* Active / Inactive Status Toggle Badge */}
                            <button
                              type="button"
                              disabled={!isSuperAdmin || isSaving}
                              onClick={async () => {
                                if (!isSuperAdmin || isSaving) return;
                                const nextState = !isStatusActive;
                                setIsSaving(true);
                                try {
                                  await updateHierarchicalStatus(status.id, { active: nextState, isActive: nextState });
                                } finally {
                                  setIsSaving(false);
                                }
                              }}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                                isStatusActive
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-400/30 dark:hover:bg-emerald-500/30'
                                  : 'bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600/40 dark:hover:bg-slate-700'
                              }`}
                              title="Klik untuk ubah aktif / nonaktif"
                            >
                              {isStatusActive ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                              <span>{isStatusActive ? 'Aktif' : 'Nonaktif'}</span>
                            </button>
                          </div>

                          <div className="text-[11px] text-[#52647A] dark:text-[#D8B4FE]/70 mt-0.5">
                            {totalStatusReasons} Reason WO
                          </div>
                        </div>
                      </div>

                      {/* Level 1 Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Order Reorder */}
                        <div className="flex items-center border border-[#DDE6F0] dark:border-[#D8B4FE]/25 rounded-lg overflow-hidden bg-white dark:bg-[#35105E]/40">
                          <button
                            type="button"
                            disabled={!isSuperAdmin || isSaving}
                            onClick={() => handleMoveStatusOrder(status.id, 'up')}
                            className="p-1 hover:bg-[#EDF3F8] text-[#52647A] hover:text-[#26364A] dark:hover:bg-[#35105E] dark:text-[#D8B4FE]/70 dark:hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Geser Urutan Status ke Atas"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={!isSuperAdmin || isSaving}
                            onClick={() => handleMoveStatusOrder(status.id, 'down')}
                            className="p-1 hover:bg-[#EDF3F8] text-[#52647A] hover:text-[#26364A] dark:hover:bg-[#35105E] dark:text-[#D8B4FE]/70 dark:hover:text-white cursor-pointer border-l border-[#DDE6F0] dark:border-[#D8B4FE]/25 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Geser Urutan Status ke Bawah"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Add Reason */}
                        <button
                          type="button"
                          disabled={!isSuperAdmin || isSaving}
                          onClick={() => {
                            if (!isSuperAdmin) return;
                            setTargetStatusIdForReason(status.id);
                            setNewReasonName('');
                            setNewReasonCode('');
                          }}
                          className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/35 dark:text-emerald-300 rounded-lg text-[11px] font-bold flex items-center gap-1 dark:border-emerald-400/30 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Tambah Reason (Level 2) di bawah status ini"
                        >
                          <Plus className="w-3 h-3" />
                          <span>+ Reason</span>
                        </button>

                        {/* Edit Status */}
                        <button
                          type="button"
                          disabled={!isSuperAdmin || isSaving}
                          onClick={() => {
                            if (!isSuperAdmin) return;
                            setEditingItem({
                              type: 'status',
                              id: status.id,
                              name: status.name,
                              code: status.code,
                              color: status.color
                            });
                          }}
                          className="p-1.5 text-[#52647A] hover:text-[#5145A6] hover:bg-[#EAE8FF] border border-[#DDE6F0] dark:text-[#D8B4FE]/70 dark:hover:text-white dark:hover:bg-[#35105E] rounded-lg cursor-pointer dark:border-[#D8B4FE]/20 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Edit Status WO"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Status */}
                        <button
                          type="button"
                          disabled={!isSuperAdmin || isSaving}
                          onClick={async () => {
                            if (!isSuperAdmin || isSaving) return;
                            if (totalStatusReasons > 0) {
                              setConfirmDeleteStatus({
                                status,
                                totalReasons: totalStatusReasons
                              });
                              return;
                            }
                            setIsSaving(true);
                            try {
                              await deleteHierarchicalStatus(status.id);
                            } finally {
                              setIsSaving(false);
                            }
                          }}
                          className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 dark:text-rose-400 dark:hover:text-rose-200 dark:hover:bg-rose-950/50 rounded-lg cursor-pointer dark:border-rose-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Hapus Status WO"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* LEVEL 2: REASONS LIST */}
                    {isExpanded && (
                      <div className="p-3 sm:p-4 space-y-3 bg-[#F8FAFD] dark:bg-[#110920]/60">
                        {statusReasons.length === 0 ? (
                          <div className="p-4 text-center text-xs text-[#8492A5] dark:text-[#D8B4FE]/50 italic">
                            Belum ada Reason WO (Level 2) di bawah status ini. Klik "+ Reason" di atas untuk menambahkan.
                          </div>
                        ) : (
                          statusReasons.map(reason => {
                            const isReasonActive = reason.active !== false && (reason as any).isActive !== false;

                            return (
                              <div
                                key={reason.id}
                                className={`rounded-xl border transition-all overflow-hidden ml-2 sm:ml-4 ${
                                  isReasonActive
                                    ? 'bg-white border-[#DDE6F0] dark:bg-[#1A0E2E] dark:border-[#D8B4FE]/20'
                                    : 'bg-[#F4F7FB] border-[#E2E8F0] opacity-70 dark:bg-[#140827] dark:border-white/5'
                                }`}
                              >
                                {/* Reason Header */}
                                <div className="p-3 bg-[#F4F7FB] dark:bg-[#1F1138]/60 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <CornerDownRight className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#A855F7] shrink-0" />

                                    <span className="font-bold text-xs text-[#26364A] dark:text-white">
                                      {reason.name}
                                    </span>

                                    <span className="text-[9.5px] font-mono px-1.5 py-0.2 rounded bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:bg-[#35105E]/80 dark:text-[#E9D5FF] dark:border-[#D8B4FE]/20">
                                      Level 2 {reason.code ? `• ${reason.code}` : ''}
                                    </span>

                                    {/* Active / Inactive Reason Toggle */}
                                    <button
                                      type="button"
                                      disabled={!isSuperAdmin || isSaving}
                                      onClick={async () => {
                                        if (!isSuperAdmin || isSaving) return;
                                        const nextState = !isReasonActive;
                                        setIsSaving(true);
                                        try {
                                          await updateHierarchicalReason(status.id, reason.id, { active: nextState, isActive: nextState });
                                        } finally {
                                          setIsSaving(false);
                                        }
                                      }}
                                      className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                        isReasonActive
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-400/30'
                                          : 'bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600/40'
                                      }`}
                                    >
                                      {isReasonActive ? 'Aktif' : 'Nonaktif'}
                                    </button>
                                  </div>

                                  {/* Reason Actions */}
                                  <div className="flex items-center gap-1 shrink-0">
                                    {/* Reorder Reason */}
                                    <div className="flex items-center border border-[#DDE6F0] dark:border-[#D8B4FE]/20 rounded overflow-hidden bg-white dark:bg-[#35105E]/40">
                                      <button
                                        type="button"
                                        disabled={!isSuperAdmin || isSaving}
                                        onClick={() => handleMoveReasonOrder(status.id, reason.id, 'up')}
                                        className="p-1 hover:bg-[#EDF3F8] text-[#52647A] hover:text-[#26364A] dark:hover:bg-[#35105E] dark:text-[#D8B4FE]/70 dark:hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Geser Reason ke Atas"
                                      >
                                        <ArrowUp className="w-2.5 h-2.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!isSuperAdmin || isSaving}
                                        onClick={() => handleMoveReasonOrder(status.id, reason.id, 'down')}
                                        className="p-1 hover:bg-[#EDF3F8] text-[#52647A] hover:text-[#26364A] dark:hover:bg-[#35105E] dark:text-[#D8B4FE]/70 dark:hover:text-white cursor-pointer border-l border-[#DDE6F0] dark:border-[#D8B4FE]/20 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Geser Reason ke Bawah"
                                      >
                                        <ArrowDown className="w-2.5 h-2.5" />
                                      </button>
                                    </div>

                                    {/* Move to another status */}
                                    <button
                                      type="button"
                                      disabled={!isSuperAdmin || isSaving}
                                      onClick={() => {
                                        if (!isSuperAdmin) return;
                                        setMovingReason({
                                          reason,
                                          fromStatusId: status.id
                                        });
                                        setTargetMoveStatusId(status.id);
                                      }}
                                      className="p-1 text-[#52647A] hover:text-amber-600 dark:text-[#D8B4FE]/70 dark:hover:text-amber-300 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Pindahkan Reason ke Status WO lain"
                                    >
                                      <MoveRight className="w-3.5 h-3.5" />
                                    </button>

                                    {/* Edit Reason */}
                                    <button
                                      type="button"
                                      disabled={!isSuperAdmin || isSaving}
                                      onClick={() => {
                                        if (!isSuperAdmin) return;
                                        setEditingItem({
                                          type: 'reason',
                                          id: reason.id,
                                          parentStatusId: status.id,
                                          name: reason.name,
                                          code: reason.code
                                        });
                                      }}
                                      className="p-1 text-[#52647A] hover:text-[#5145A6] dark:text-[#D8B4FE]/70 dark:hover:text-white rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Edit Reason WO"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>

                                    {/* Delete Reason */}
                                    <button
                                      type="button"
                                      disabled={!isSuperAdmin || isSaving}
                                      onClick={async () => {
                                        if (!isSuperAdmin || isSaving) return;
                                        setIsSaving(true);
                                        try {
                                          await deleteHierarchicalReason(status.id, reason.id);
                                        } finally {
                                          setIsSaving(false);
                                        }
                                      }}
                                      className="p-1 text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-200 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Hapus Reason WO"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>

                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 2: GENERAL STATIC DROPLISTS (Slot Waktu, Kategori Tiket) */}
      {/* ============================================================ */}
      {activeMainTab === 'static_droplists' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Category Selector */}
          <div className="lg:col-span-4 bg-white dark:bg-[#160D29] rounded-2xl border border-[#DDE6F0] dark:border-[#D8B4FE]/25 p-4 shadow-xs space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#D8B4FE]/60 block mb-2">
              Kategori Droplist Tambahan
            </span>
            <div className="space-y-1.5">
              {[
                { key: 'slot_time', label: 'Slot Waktu Kunjungan' },
                { key: 'ticket_category', label: 'Kategori Tiket WO' },
                { key: 'status_agent', label: 'Status WO Agent (Dispatch)' }
              ].map(c => {
                const isSelected = activeGeneralCategory === c.key;
                const count = generalDroplists.filter(d => d.category === c.key).length;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setActiveGeneralCategory(c.key as any)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-[#6657C8] text-white border-[#9E95DE] font-bold shadow-sm dark:bg-[#7135B5] dark:border-[#A855F7] dark:shadow-[0_0_15px_rgba(113,53,181,0.4)]'
                        : 'bg-[#F4F7FB] text-[#52647A] border-[#DDE6F0] hover:bg-[#EDF3F8] hover:text-[#26364A] dark:bg-[#1E1138]/40 dark:text-[#D8B4FE]/80 dark:border-[#D8B4FE]/20 dark:hover:bg-[#35105E]/40 dark:hover:text-white'
                    }`}
                  >
                    <span className="text-xs">{c.label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E]/70 dark:text-[#D8B4FE]'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Items Editor */}
          <div className="lg:col-span-8 bg-white dark:bg-[#160D29] rounded-2xl border border-[#DDE6F0] dark:border-[#D8B4FE]/25 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] dark:border-[#D8B4FE]/15">
              <div>
                <h3 className="font-extrabold text-[#26364A] dark:text-white text-sm">
                  Kelola Opsi: {activeGeneralCategory === 'slot_time' ? 'Slot Waktu Kunjungan' : activeGeneralCategory === 'ticket_category' ? 'Kategori Tiket WO' : 'Status WO Agent'}
                </h3>
                <p className="text-[11px] text-[#52647A] dark:text-[#D8B4FE]/70 mt-0.5">
                  Daftar opsi statis tersimpan permanen di Supabase PostgreSQL.
                </p>
              </div>
            </div>

            {/* Add item form */}
            <form onSubmit={handleAddGeneralItem} className="flex flex-col sm:flex-row gap-2 text-xs">
              <input
                type="text"
                required
                disabled={!isSuperAdmin || isSaving}
                placeholder="Label opsi baru..."
                value={newGeneralLabel}
                onChange={e => setNewGeneralLabel(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/30 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white placeholder-[#8492A5] dark:placeholder-[#D8B4FE]/40 focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none disabled:opacity-50"
              />
              <input
                type="text"
                disabled={!isSuperAdmin || isSaving}
                placeholder="Nilai kode (opsional)..."
                value={newGeneralValue}
                onChange={e => setNewGeneralValue(e.target.value)}
                className="w-full sm:w-48 px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/30 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white placeholder-[#8492A5] dark:placeholder-[#D8B4FE]/40 focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none font-mono disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!isSuperAdmin || isSaving}
                className="px-4 py-2 bg-[#6657C8] hover:bg-[#5145A6] border border-[#9E95DE] dark:bg-[#7135B5] dark:hover:bg-[#8542D1] text-white rounded-xl font-bold flex items-center justify-center gap-1.5 shadow-sm dark:border-[#E9D5FF]/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>{isSaving ? 'Menyimpan...' : 'Tambah'}</span>
              </button>
            </form>

            {/* Items list */}
            <div className="divide-y divide-[#E2E8F0] dark:divide-[#D8B4FE]/15 border border-[#DDE6F0] dark:border-[#D8B4FE]/20 rounded-xl overflow-hidden text-xs">
              {currentGeneralItems.length === 0 ? (
                <div className="p-4 text-center text-[#8492A5] dark:text-[#D8B4FE]/50 italic">
                  Belum ada opsi dalam kategori ini.
                </div>
              ) : (
                currentGeneralItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-3 odd:bg-white even:bg-[#F8FAFD] hover:bg-[#EDF3F8] dark:odd:bg-transparent dark:even:bg-transparent dark:bg-[#1A0E2E]/60 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 dark:hover:bg-[#1E1138]/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[#8492A5] dark:text-[#D8B4FE]/50 text-[11px] w-6">{idx + 1}.</span>
                      <div>
                        <span className="font-bold text-[#26364A] dark:text-white">{item.label}</span>
                        <span className="text-[11px] text-[#8492A5] dark:text-[#D8B4FE]/60 font-mono ml-2">[{item.value}]</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!isSuperAdmin || isSaving}
                        onClick={() => handleToggleGeneralActive(item.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          item.active
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-400/30'
                            : 'bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600/40'
                        }`}
                      >
                        {item.active ? 'Aktif' : 'Nonaktif'}
                      </button>
                      <button
                        type="button"
                        disabled={!isSuperAdmin || isSaving}
                        onClick={() => handleDeleteGeneralItem(item.id)}
                        className="p-1 text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-200 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: ADD LEVEL 1 STATUS WO                                 */}
      {/* ============================================================ */}
      <ResponsiveModal
        isOpen={isAddStatusOpen}
        onClose={() => setIsAddStatusOpen(false)}
        title="Tambah Status Work Order Baru (Level 1)"
        icon={<Layers className="w-4 h-4" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-70"
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsAddStatusOpen(false)}
              className="px-4 py-2 rounded-xl text-xs text-[#52647A] hover:bg-[#EDF3F8] dark:text-[#D8B4FE] dark:hover:bg-[#35105E]/40 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={!isSuperAdmin || isSaving}
              onClick={async () => {
                if (!isSuperAdmin || isSaving) return;
                if (!newStatusName.trim()) {
                  toast.error('Nama status tidak boleh kosong');
                  return;
                }
                setIsSaving(true);
                try {
                  const res = await addHierarchicalStatus({
                    name: newStatusName.trim(),
                    code: newStatusCode.trim() || newStatusName.trim().toUpperCase().replace(/\s+/g, '_'),
                    color: newStatusColor,
                    order: hierarchicalStatuses.length + 1,
                    active: true,
                    isActive: true
                  });
                  if (res.success) {
                    setIsAddStatusOpen(false);
                  }
                } finally {
                  setIsSaving(false);
                }
              }}
              className="px-5 py-2 bg-[#6657C8] hover:bg-[#5145A6] border border-[#9E95DE] dark:bg-[#7135B5] dark:hover:bg-[#8542D1] text-white rounded-xl text-xs font-bold dark:border-[#E9D5FF]/30 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Menyimpan...' : 'Simpan Status'}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <div>
            <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF] mb-1">Nama Status <span className="text-rose-500 dark:text-rose-400">*</span></label>
            <input
              type="text"
              placeholder="Contoh: Installed, Pending Technical..."
              value={newStatusName}
              onChange={e => setNewStatusName(e.target.value)}
              className="w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/40 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white placeholder-[#8492A5] dark:placeholder-[#D8B4FE]/40 focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none"
            />
          </div>
          <div>
            <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF] mb-1">Kode Status (Identifier)</label>
            <input
              type="text"
              placeholder="Contoh: INSTALLED, PENDING_TECH..."
              value={newStatusCode}
              onChange={e => setNewStatusCode(e.target.value)}
              className="w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/40 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white placeholder-[#8492A5] dark:placeholder-[#D8B4FE]/40 focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none font-mono uppercase"
            />
          </div>
          <div>
            <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF] mb-1">Warna Label</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newStatusColor}
                onChange={e => setNewStatusColor(e.target.value)}
                className="w-8 h-8 rounded border border-[#DDE6F0] dark:border-[#D8B4FE]/30 cursor-pointer"
              />
              <span className="font-mono text-xs text-[#26364A] dark:text-white">{newStatusColor}</span>
            </div>
          </div>
        </div>
      </ResponsiveModal>

      {/* ============================================================ */}
      {/* MODAL: ADD LEVEL 2 REASON WO                                 */}
      {/* ============================================================ */}
      <ResponsiveModal
        isOpen={Boolean(targetStatusIdForReason)}
        onClose={() => setTargetStatusIdForReason(null)}
        title="Tambah Reason WO Baru (Level 2)"
        icon={<Plus className="w-4 h-4" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-70"
        footer={
          <>
            <button
              type="button"
              onClick={() => setTargetStatusIdForReason(null)}
              className="px-4 py-2 rounded-xl text-xs text-[#52647A] hover:bg-[#EDF3F8] dark:text-[#D8B4FE] dark:hover:bg-[#35105E]/40 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={!isSuperAdmin || isSaving || !targetStatusIdForReason}
              onClick={async () => {
                if (!isSuperAdmin || isSaving || !targetStatusIdForReason) return;
                if (!newReasonName.trim()) {
                  toast.error('Nama reason tidak boleh kosong');
                  return;
                }
                const parentStatus = hierarchicalStatuses.find(s => s.id === targetStatusIdForReason);
                const reasonCount = parentStatus?.reasons?.length || 0;
                setIsSaving(true);
                try {
                  const res = await addHierarchicalReason(targetStatusIdForReason, {
                    name: newReasonName.trim(),
                    code: newReasonCode.trim() || newReasonName.trim().toUpperCase().replace(/\s+/g, '_'),
                    order: reasonCount + 1,
                    active: true,
                    isActive: true
                  });
                  if (res.success) {
                    setTargetStatusIdForReason(null);
                  }
                } finally {
                  setIsSaving(false);
                }
              }}
              className="px-5 py-2 bg-[#6657C8] hover:bg-[#5145A6] border border-[#9E95DE] dark:bg-[#7135B5] dark:hover:bg-[#8542D1] text-white rounded-xl text-xs font-bold dark:border-[#E9D5FF]/30 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Menyimpan...' : 'Simpan Reason'}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <div>
            <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF] mb-1">Nama Reason / Alasan <span className="text-rose-500 dark:text-rose-400">*</span></label>
            <input
              type="text"
              placeholder="Contoh: Redaman OPM Normal (-18dBm)..."
              value={newReasonName}
              onChange={e => setNewReasonName(e.target.value)}
              className="w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/40 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white placeholder-[#8492A5] dark:placeholder-[#D8B4FE]/40 focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none"
            />
          </div>
          <div>
            <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF] mb-1">Kode Reason (Opsional)</label>
            <input
              type="text"
              placeholder="Contoh: RSN_COMP_NORMAL..."
              value={newReasonCode}
              onChange={e => setNewReasonCode(e.target.value)}
              className="w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/40 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white placeholder-[#8492A5] dark:placeholder-[#D8B4FE]/40 focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none font-mono uppercase"
            />
          </div>
        </div>
      </ResponsiveModal>

      {/* ============================================================ */}
      {/* MODAL: MOVE REASON TO ANOTHER STATUS WO                      */}
      {/* ============================================================ */}
      <ResponsiveModal
        isOpen={Boolean(movingReason)}
        onClose={() => setMovingReason(null)}
        title="Pindahkan Reason ke Status Lain"
        icon={<MoveRight className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-70"
        footer={
          <>
            <button
              type="button"
              onClick={() => setMovingReason(null)}
              className="px-4 py-2 rounded-xl text-xs text-[#52647A] hover:bg-[#EDF3F8] dark:text-[#D8B4FE] dark:hover:bg-[#35105E]/40 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={!isSuperAdmin || isSaving || !movingReason}
              onClick={async () => {
                if (!isSuperAdmin || isSaving || !movingReason) return;
                if (targetMoveStatusId === movingReason.fromStatusId) {
                  toast.info('Status tujuan sama dengan status saat ini.');
                  setMovingReason(null);
                  return;
                }
                setIsSaving(true);
                try {
                  const res = await moveHierarchicalReason(movingReason.fromStatusId, targetMoveStatusId, movingReason.reason.id);
                  if (res.success) {
                    setMovingReason(null);
                  }
                } finally {
                  setIsSaving(false);
                }
              }}
              className="px-5 py-2 bg-[#6657C8] hover:bg-[#5145A6] border border-[#9E95DE] dark:bg-[#7135B5] dark:hover:bg-[#8542D1] text-white rounded-xl text-xs font-bold dark:border-[#E9D5FF]/30 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Memindahkan...' : 'Pindahkan'}
            </button>
          </>
        }
      >
        {movingReason && (
          <div className="space-y-4 text-xs">
            <p className="text-[#52647A] dark:text-[#D8B4FE]/80">
              Pindahkan reason <strong className="text-[#26364A] dark:text-white">"{movingReason.reason.name}"</strong> ke Status WO tujuan.
            </p>
            <div className="space-y-2">
              <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF]">Pilih Status Tujuan (Level 1):</label>
              <select
                value={targetMoveStatusId}
                onChange={e => setTargetMoveStatusId(e.target.value)}
                className="w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/40 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none"
              >
                {hierarchicalStatuses.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code || s.name}) {s.id === movingReason.fromStatusId ? '(Status Saat Ini)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </ResponsiveModal>

      {/* ============================================================ */}
      {/* MODAL: EDIT ITEM (STATUS OR REASON)                          */}
      {/* ============================================================ */}
      <ResponsiveModal
        isOpen={Boolean(editingItem)}
        onClose={() => setEditingItem(null)}
        title={
          editingItem
            ? `Edit ${editingItem.type === 'status' ? 'Status WO (Level 1)' : editingItem.type === 'reason' ? 'Reason WO (Level 2)' : 'Remark (Level 3)'}`
            : 'Edit Item'
        }
        icon={<Edit2 className="w-4 h-4" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-70"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditingItem(null)}
              className="px-4 py-2 rounded-xl text-xs text-[#52647A] hover:bg-[#EDF3F8] dark:text-[#D8B4FE] dark:hover:bg-[#35105E]/40 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={!isSuperAdmin || isSaving || !editingItem}
              onClick={async () => {
                if (!isSuperAdmin || isSaving || !editingItem) return;
                if (!editingItem.name.trim()) {
                  toast.error('Nama tidak boleh kosong');
                  return;
                }
                setIsSaving(true);
                try {
                  let res: { success: boolean; error?: string } = { success: false };
                  if (editingItem.type === 'status') {
                    res = await updateHierarchicalStatus(editingItem.id, {
                      name: editingItem.name.trim(),
                      code: editingItem.code?.trim() || editingItem.name.trim().toUpperCase().replace(/\s+/g, '_'),
                      color: editingItem.color
                    });
                  } else if (editingItem.type === 'reason' && editingItem.parentStatusId) {
                    res = await updateHierarchicalReason(editingItem.parentStatusId, editingItem.id, {
                      name: editingItem.name.trim(),
                      code: editingItem.code?.trim() || editingItem.name.trim().toUpperCase().replace(/\s+/g, '_')
                    });
                  }
                  if (res.success) {
                    setEditingItem(null);
                  }
                } finally {
                  setIsSaving(false);
                }
              }}
              className="px-5 py-2 bg-[#6657C8] hover:bg-[#5145A6] border border-[#9E95DE] dark:bg-[#7135B5] dark:hover:bg-[#8542D1] text-white rounded-xl text-xs font-bold dark:border-[#E9D5FF]/30 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </>
        }
      >
        {editingItem && (
          <div className="space-y-3 text-xs">
            <div>
              <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF] mb-1">Nama / Teks <span className="text-rose-500 dark:text-rose-400">*</span></label>
              <input
                type="text"
                value={editingItem.name}
                onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                className="w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/40 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none"
              />
            </div>

            <div>
              <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF] mb-1">Kode Identifier</label>
              <input
                type="text"
                value={editingItem.code || ''}
                onChange={e => setEditingItem({ ...editingItem, code: e.target.value })}
                className="w-full px-3 py-2 bg-[#F4F7FB] dark:bg-[#35105E]/40 border border-[#DDE6F0] dark:border-[#D8B4FE]/30 rounded-xl text-[#26364A] dark:text-white focus:border-[#6657C8] dark:focus:border-[#A855F7] focus:outline-none font-mono uppercase"
              />
            </div>

            {editingItem.type === 'status' && (
              <div>
                <label className="font-semibold block text-[#26364A] dark:text-[#E9D5FF] mb-1">Warna Label</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editingItem.color || '#6657C8'}
                    onChange={e => setEditingItem({ ...editingItem, color: e.target.value })}
                    className="w-8 h-8 rounded border border-[#DDE6F0] dark:border-[#D8B4FE]/30 cursor-pointer"
                  />
                  <span className="font-mono text-xs text-[#26364A] dark:text-white">{editingItem.color || '#6657C8'}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </ResponsiveModal>

      {/* ============================================================ */}
      {/* MODAL: CONFIRM DELETE LEVEL 1 STATUS WITH CHILDREN           */}
      {/* ============================================================ */}
      <ResponsiveModal
        isOpen={Boolean(confirmDeleteStatus)}
        onClose={() => { if (!isSaving) setConfirmDeleteStatus(null); }}
        title={confirmDeleteStatus ? `Hapus Status WO "${confirmDeleteStatus.status.name}"?` : 'Konfirmasi Hapus'}
        icon={<AlertTriangle className="w-4 h-4 text-rose-500 dark:text-rose-400" />}
        variant="dark_purple"
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-70"
        footer={
          <>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => setConfirmDeleteStatus(null)}
              className="px-4 py-2 rounded-xl text-xs text-[#52647A] hover:bg-[#EDF3F8] dark:text-[#D8B4FE] dark:hover:bg-[#35105E]/40 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isSaving || !confirmDeleteStatus}
              onClick={async () => {
                if (!isSuperAdmin || isSaving || !confirmDeleteStatus) return;
                const targetId = confirmDeleteStatus.status.id;
                setIsSaving(true);
                try {
                  const res = await deleteHierarchicalStatus(targetId);
                  if (res.success) {
                    setConfirmDeleteStatus(null);
                  }
                } finally {
                  setIsSaving(false);
                }
              }}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold border border-rose-300/30 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Menghapus...' : 'Ya, Hapus Permanen'}
            </button>
          </>
        }
      >
        {confirmDeleteStatus && (
          <p className="text-xs text-[#52647A] dark:text-[#D8B4FE]/80 leading-relaxed">
            Status WO ini memiliki <strong className="text-[#26364A] dark:text-white">{confirmDeleteStatus.totalReasons}</strong> child reasons. Menghapus status ini akan menghapus seluruh cabang di bawahnya secara global dari database.
          </p>
        )}
      </ResponsiveModal>
    </div>
  );
};
