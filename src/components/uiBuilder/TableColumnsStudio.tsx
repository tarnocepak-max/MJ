import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  Lock,
  GripVertical,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Monitor,
  Database,
  Plus,
  RotateCcw,
  Eye,
  Save,
  Sparkles,
  CheckCircle2,
  Columns3,
  EyeOff,
  SlidersHorizontal,
  Info,
  X
} from 'lucide-react';
import { useUIConfig } from '../../context/UIConfigContext';
import { useApp } from '../../context/AppContext';
import {
  CANONICAL_COLUMN_GROUPS,
  DEFAULT_COLUMNS,
  DEFAULT_UI_CONFIG
} from '../../constants/defaultConfig';
import { ColumnConfig, Ticket } from '../../types/index';
import { ResponsiveModal } from '../common/ResponsiveModal';

interface TableColumnsStudioProps {
  isSuperAdmin: boolean;
  onTriggerNotice: (msg: string) => void;
  onTriggerError: (msg: string) => void;
  onOpenSavePresetModal: () => void;
  onNavigateToTickets?: () => void;
}

const FALLBACK_SIMULATOR_ROWS: Array<Partial<Ticket>> = [
  {
    id: 'sim_1',
    woNumber: 'WO-2611-0941',
    idCustomer: '1089421',
    customerName: 'Budi Prasetyo',
    customerPhone: '081287654321',
    statusWOAgent: 'In Progress',
    statusWOInstaller: 'On Site',
    statusWhatsApp: 'confirmed',
    approvalStatus: 'BUTUH APPROVAL',
    appointmentDate: '2026-11-15',
    slotTime: '09:00 - 11:00',
    area: 'Jakarta Selatan',
    clusterName: 'Kemang Village Residence',
    contactorName: 'PT Telkom Akses Mitra',
    leaderName: 'Sari Wulandari',
    installerName: 'Rizky Ramadhan',
    reportStatusLabel: 'Pending',
    remarksWOInstaller: 'Penarikan dropcore 45m via tiang FAT-KMG-04',
    fdtCode: 'FDT-JKS-012',
    fatCode: 'FAT-KMG-04',
    rosetRedamanDbm: '-19.4',
    ontModel: 'Huawei HG8245H5'
  },
  {
    id: 'sim_2',
    woNumber: 'WO-2611-0942',
    idCustomer: '1089422',
    customerName: 'Siti Nurhaliza',
    customerPhone: '081399887711',
    statusWOAgent: 'Assigned',
    statusWOInstaller: 'En Route',
    statusWhatsApp: 'ready',
    approvalStatus: 'APPROVED',
    appointmentDate: '2026-11-15',
    slotTime: '13:00 - 15:00',
    area: 'Depok Timur',
    clusterName: 'Pesona Khayangan',
    contactorName: 'PT Mora Prima Jaya',
    leaderName: 'Andi Wijaya',
    installerName: 'Deni Kurniawan',
    reportStatusLabel: 'Done',
    remarksWOInstaller: 'ONT online, redaman normal -18.2 dBm',
    fdtCode: 'FDT-DPK-009',
    fatCode: 'FAT-PKH-11',
    rosetRedamanDbm: '-18.2',
    ontModel: 'ZTE F670L'
  }
];

function getTicketCellValue(ticket: Partial<Ticket>, key: string): string {
  if (key === 'appointmentDate') {
    return String(ticket.appointmentDate || ticket.date || '-');
  }
  if (key === 'photoEvidenceCount') {
    if (typeof ticket.photoEvidenceCount === 'number') return String(ticket.photoEvidenceCount);
    const count =
      (ticket.technicalReport?.photos?.length || 0) +
      (ticket.technicalReport?.photoBeforeUrl ? 1 : 0) +
      (ticket.technicalReport?.photoAfterUrl ? 1 : 0);
    return count > 0 ? `${count} foto` : '-';
  }
  if (key === 'reassignHistoryCount') {
    if (typeof ticket.reassignHistoryCount === 'number') return String(ticket.reassignHistoryCount);
    return String(ticket.assignmentHistory?.filter(h => h.sourceAction === 'reassign').length || 0);
  }
  if (key === 'customerCoordinates') {
    if (ticket.customerCoordinates) return ticket.customerCoordinates;
    if (ticket.latitude !== undefined && ticket.longitude !== undefined) {
      return `${ticket.latitude}, ${ticket.longitude}`;
    }
    return '-';
  }
  if (key === 'workDurationMinutes') {
    return ticket.workDurationMinutes !== undefined ? `${ticket.workDurationMinutes} mnt` : '-';
  }
  if (key === 'dropcoreLength') {
    return String(ticket.dropcoreLength || ticket.dropcoreLengthMeter || '-');
  }
  const raw = (ticket as Record<string, any>)[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return '-';
  return String(raw);
}

export const TableColumnsStudio: React.FC<TableColumnsStudioProps> = ({
  isSuperAdmin,
  onTriggerNotice,
  onTriggerError,
  onOpenSavePresetModal,
  onNavigateToTickets
}) => {
  const {
    config,
    isDrafting,
    updateDraft,
    cancelDraft,
    saveConfigToSupabase,
    isCloudSyncing
  } = useUIConfig();
  const { tickets, currentUser } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Scoped Ctrl+F shortcut to focus column dictionary search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (searchInputRef.current) {
          e.preventDefault();
          searchInputRef.current.focus();
        }
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current && searchQuery) {
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery]);

  const columns = useMemo(() => {
    return [...(config.ticketsTable.columns || DEFAULT_COLUMNS)].sort((a, b) => a.order - b.order);
  }, [config.ticketsTable.columns]);

  const freezeCount = Math.max(1, Math.min(4, config.ticketsTable.freezeColumnCount ?? 4));
  const cellFontSize = config.ticketsTable.cellFontSize || 'medium';
  const smartOmitEmpty = config.ticketsTable.smartOmitEmpty ?? true;
  const showHoverTooltips = config.ticketsTable.showHoverTooltips ?? true;

  // Real dynamically computed KPIs
  const kpiStats = useMemo(() => {
    const total = columns.length;
    const active = columns.filter(c => c.visible).length;
    const mandatory = columns.filter(c => c.mandatory).length;
    const hidden = columns.filter(c => !c.visible).length;
    return { total, active, mandatory, hidden, freezeCount };
  }, [columns, freezeCount]);

  // Visible columns for Simulator Preview
  const activeColumns = useMemo(() => {
    return columns.filter(c => c.visible);
  }, [columns]);

  // Locked sticky left columns in Simulator (up to freezeCount)
  const frozenColumns = useMemo(() => {
    return activeColumns.slice(0, freezeCount);
  }, [activeColumns, freezeCount]);

  const frozenColumnOffsets = useMemo(() => {
    const offsets: number[] = [];
    let currentLeft = 0;
    for (let i = 0; i < freezeCount && i < activeColumns.length; i++) {
      offsets.push(currentLeft);
      const col = activeColumns[i];
      const w = col.key === 'selection' ? 40 : Math.min(col.width || 130, 160);
      currentLeft += w;
    }
    return offsets;
  }, [activeColumns, freezeCount]);

  const simulatorRows = useMemo(() => {
    const realRows = (tickets || []).filter(t => t && !t.isDeleted && !t.isArchived).slice(0, 4);
    return realRows.length > 0 ? realRows : FALLBACK_SIMULATOR_ROWS;
  }, [tickets]);

  const isShowingLiveTickets = (tickets || []).some(t => t && !t.isDeleted && !t.isArchived);

  // Filtered columns by search query
  const filteredColumns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter(c => {
      return (
        c.label.toLowerCase().includes(q) ||
        c.key.toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q) ||
        (c.badgeHint || '').toLowerCase().includes(q)
      );
    });
  }, [columns, searchQuery]);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleToggleColumnVisible = (col: ColumnConfig) => {
    if (!isSuperAdmin) return;
    if (col.mandatory) {
      onTriggerError(`Kolom "${col.label}" terkunci mandatori dan wajib selalu ditampilkan.`);
      return;
    }
    updateDraft(prev => ({
      ...prev,
      ticketsTable: {
        ...prev.ticketsTable,
        columns: prev.ticketsTable.columns.map(c =>
          c.key === col.key ? { ...c, visible: !c.visible } : c
        )
      }
    }));
  };

  const handleWidthChange = (key: string, nextWidth: number) => {
    if (!isSuperAdmin) return;
    const clamped = Math.max(40, Math.min(480, nextWidth || 100));
    updateDraft(prev => ({
      ...prev,
      ticketsTable: {
        ...prev.ticketsTable,
        columns: prev.ticketsTable.columns.map(c =>
          c.key === key ? { ...c, width: clamped } : c
        )
      }
    }));
  };

  const handleReorderByKeys = (sourceKey: string, targetKey: string) => {
    if (!isSuperAdmin || sourceKey === targetKey) return;
    updateDraft(prev => {
      const sorted = [...prev.ticketsTable.columns].sort((a, b) => a.order - b.order);
      const fromIdx = sorted.findIndex(c => c.key === sourceKey);
      const toIdx = sorted.findIndex(c => c.key === targetKey);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = sorted.splice(fromIdx, 1);
      sorted.splice(toIdx, 0, moved);
      return {
        ...prev,
        ticketsTable: {
          ...prev.ticketsTable,
          columns: sorted.map((c, idx) => ({ ...c, order: idx + 1 }))
        }
      };
    });
    onTriggerNotice('Urutan kolom diperbarui di draft & Simulator Live.');
  };

  const handleMoveColumnStep = (key: string, direction: 'up' | 'down') => {
    if (!isSuperAdmin) return;
    const idx = columns.findIndex(c => c.key === key);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= columns.length) return;
    handleReorderByKeys(key, columns[targetIdx].key);
  };

  const handleApplyPresetDraft = (presetId: string) => {
    if (!isSuperAdmin) return;
    const preset = config.ticketsTable.presets.find(p => p.id === presetId);
    if (!preset) return;
    updateDraft(prev => ({
      ...prev,
      ticketsTable: {
        ...prev.ticketsTable,
        activePresetId: preset.id,
        columns: preset.columns.map((c, idx) => ({
          ...c,
          visible: c.mandatory ? true : c.visible,
          order: idx + 1
        })),
        density: preset.density,
        rowsPerPage: preset.rowsPerPage
      }
    }));
    onTriggerNotice(`Preset "${preset.name}" diterapkan di draft. Klik "Simpan Konfigurasi Kolom" atau "Terapkan Pengaturan" untuk sinkron ke Supabase.`);
  };

  const handleResetColumnsDefault = () => {
    if (!isSuperAdmin) return;
    updateDraft(prev => ({
      ...prev,
      ticketsTable: {
        ...prev.ticketsTable,
        columns: DEFAULT_COLUMNS.map(c => ({ ...c })),
        activePresetId: 'preset_default',
        density: DEFAULT_UI_CONFIG.ticketsTable.density,
        cellFontSize: DEFAULT_UI_CONFIG.ticketsTable.cellFontSize,
        freezeColumnCount: DEFAULT_UI_CONFIG.ticketsTable.freezeColumnCount,
        smartOmitEmpty: DEFAULT_UI_CONFIG.ticketsTable.smartOmitEmpty,
        showHoverTooltips: DEFAULT_UI_CONFIG.ticketsTable.showHoverTooltips
      }
    }));
    onTriggerNotice('Kolom dan ergonomi dipulihkan ke default BASE_DATA_WO di draft.');
  };

  const handleSaveToDatabase = async () => {
    if (!isSuperAdmin) {
      onTriggerError('Akses Ditolak: Hanya Super Admin yang dapat menyimpan konfigurasi kolom global.');
      return;
    }
    const res = await saveConfigToSupabase(currentUser?.name || 'Super Admin');
    if (res.success) {
      onTriggerNotice(
        `Konfigurasi 46 kolom & ergonomi UI berhasil disimpan ke Supabase PostgreSQL (${res.updatedAt ? new Date(res.updatedAt).toLocaleTimeString('id-ID') : 'Tersimpan'}).`
      );
    } else {
      onTriggerError(res.error || 'Gagal menyimpan konfigurasi kolom ke Supabase PostgreSQL.');
    }
  };

  const simDensityRowHeight =
    config.ticketsTable.density === 'compact'
      ? 'h-8 py-1'
      : config.ticketsTable.density === 'spacious'
      ? 'h-[52px] py-3'
      : 'h-[42px] py-2';

  const simFontSizeClass =
    cellFontSize === 'small'
      ? 'text-[12px]'
      : cellFontSize === 'large'
      ? 'text-[14px]'
      : 'text-[13px]';

  return (
    <div className="space-y-5">
      {/* Contextual Top Action Strip for Tab 03 */}
      <div className="bg-white/95 dark:bg-[#1E1238] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] px-5 py-3.5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#EAE8FF] dark:bg-[#35105E] border border-[#C5BEEF] dark:border-[#5B35B1] flex items-center justify-center text-[#5145A6] dark:text-[#D8B4FE] shrink-0">
            <Columns3 className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-display font-bold text-sm text-[#26364A] dark:text-white truncate">
                Studio Konfigurasi 46 Kolom Kanonik &amp; Ergonomi Tabel WO
              </h4>
              {isDrafting && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 whitespace-nowrap">
                  Draft Belum Disimpan
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
              Kelola visibilitas, urutan horizontal, sticky freeze, lebar kolom, dan kepadatan tampilan tabel Work Order secara global.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleResetColumnsDefault}
            disabled={!isSuperAdmin || isCloudSyncing}
            className="btn-3d-lilac inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
            <span>Pulihkan Default Kolom</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPreviewModal(true)}
            className="btn-3d-lilac inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            <Eye className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
            <span>Pratinjau Tabel WO</span>
          </button>

          <button
            type="button"
            onClick={handleSaveToDatabase}
            disabled={!isSuperAdmin || isCloudSyncing}
            className="btn-3d-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isCloudSyncing ? 'Menyimpan...' : 'Simpan Konfigurasi Kolom'}</span>
          </button>
        </div>
      </div>

      {/* Search + Preset Selector + Smart Omit + 5 Real KPI Summary Cards */}
      <div className="bg-white/95 dark:bg-[#1E1238] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] p-4 shadow-2xs space-y-4">
        {/* Search & Presets Row */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            {/* Search Box */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#8492A5] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari kolom / field key..."
                className="w-full pl-8 pr-14 py-1.5 text-xs bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-lg text-[#26364A] dark:text-[#F5F1FF] placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25 focus:border-[#6657C8]"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded bg-[#EDF3F8] dark:bg-[#35105E] text-[#52647A] dark:text-[#D8B4FE] cursor-pointer"
                  title="Bersihkan pencarian"
                >
                  <X className="w-3 h-3" />
                </button>
              ) : (
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-[10px] font-mono text-[#8492A5]">
                  Ctrl+F
                </kbd>
              )}
            </div>

            {/* Preset Tampilan Pills */}
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#A78BFA] mr-1">
                PRESET TAMPILAN:
              </span>
              {config.ticketsTable.presets.map(preset => {
                const isActive = config.ticketsTable.activePresetId === preset.id;
                const activeColCount = preset.columns.filter(c => c.visible).length;
                const displayLabel =
                  preset.id === 'preset_all_46'
                    ? 'Semua 46 Kolom'
                    : `${preset.name} (${activeColCount})`;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!isSuperAdmin}
                    onClick={() => handleApplyPresetDraft(preset.id)}
                    title={preset.description}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap disabled:opacity-60 ${
                      isActive
                        ? 'bg-[#6657C8] dark:bg-[#2D115B] text-white border-[#5145A6] dark:border-[#2D115B] shadow-xs'
                        : 'bg-white dark:bg-[#251545] text-[#52647A] dark:text-[#CEC0E8] border-[#DDE6F0] dark:border-[#35105E] hover:border-[#9E95DE] hover:text-[#5145A6]'
                    }`}
                  >
                    {isActive && <SlidersHorizontal className="w-3 h-3 text-[#EAE8FF] dark:text-[#D8B4FE]" />}
                    <span>{displayLabel}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={onOpenSavePresetModal}
                disabled={!isSuperAdmin || isCloudSyncing}
                className="btn-3d-lilac inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                title="Simpan konfigurasi kolom saat ini menjadi preset kustom baru"
              >
                <Plus className="w-3 h-3 text-[#5145A6] dark:text-[#D8B4FE]" />
                <span>Simpan Preset</span>
              </button>
            </div>
          </div>

          {/* Smart Omit Toggle */}
          <div className="flex items-center gap-2.5 shrink-0 pt-1 xl:pt-0">
            <button
              type="button"
              role="switch"
              aria-checked={smartOmitEmpty}
              disabled={!isSuperAdmin}
              onClick={() =>
                updateDraft(prev => ({
                  ...prev,
                  ticketsTable: {
                    ...prev.ticketsTable,
                    smartOmitEmpty: !(prev.ticketsTable.smartOmitEmpty ?? true)
                  }
                }))
              }
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                smartOmitEmpty ? 'bg-[#6657C8] dark:bg-[#431599]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  smartOmitEmpty ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs font-semibold text-[#26364A] dark:text-[#F5F1FF] whitespace-nowrap">
              Smart Omit (Kosong)
            </span>
          </div>
        </div>

        {/* 5 Real Dynamically Computed KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* KPI 1: Kanonik Total */}
          <div className="rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F4F7FB] dark:bg-[#160D29]/60 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white dark:bg-[#251545] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-center text-[#52647A] dark:text-[#A78BFA] shrink-0">
              <Columns3 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-lg font-extrabold tabular-nums text-[#26364A] dark:text-white leading-none">
                {kpiStats.total}
              </div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8] truncate">
                Kanonik Total
              </div>
            </div>
          </div>

          {/* KPI 2: Kolom Aktif */}
          <div className="rounded-xl border border-[#C5BEEF] dark:border-[#5B35B1] bg-[#EAE8FF]/70 dark:bg-[#251545] p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white dark:bg-[#1E1238] border border-[#C5BEEF] dark:border-[#5B35B1] flex items-center justify-center text-[#5145A6] dark:text-[#D8B4FE] shrink-0">
              <Eye className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-lg font-extrabold tabular-nums text-[#5145A6] dark:text-white leading-none">
                {kpiStats.active}
              </div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE] truncate">
                Kolom Aktif
              </div>
            </div>
          </div>

          {/* KPI 3: Terkunci (Wajib) */}
          <div className="rounded-xl border border-[#FDE68A] dark:border-amber-800/60 bg-[#FFFBEB] dark:bg-amber-950/30 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white dark:bg-amber-950/70 border border-[#FDE68A] dark:border-amber-800 flex items-center justify-center text-[#D97706] shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-lg font-extrabold tabular-nums text-[#B45309] dark:text-amber-300 leading-none">
                {kpiStats.mandatory}
              </div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#92400E] dark:text-amber-400 truncate">
                Terkunci (Wajib)
              </div>
            </div>
          </div>

          {/* KPI 4: Disembunyikan */}
          <div className="rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F4F7FB] dark:bg-[#160D29]/60 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white dark:bg-[#251545] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-center text-[#8492A5] shrink-0">
              <EyeOff className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-lg font-extrabold tabular-nums text-[#52647A] dark:text-[#CEC0E8] leading-none">
                {kpiStats.hidden}
              </div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8] truncate">
                Disembunyikan
              </div>
            </div>
          </div>

          {/* KPI 5: Sticky Freeze Horizontal */}
          <div className="rounded-xl border border-[#BDE4E8] dark:border-[#5B35B1] bg-[#DDF4F4]/60 dark:bg-[#1E1238] p-3 flex items-center gap-3 col-span-2 sm:col-span-1">
            <div className="w-9 h-9 rounded-lg bg-white dark:bg-[#35105E] border border-[#BDE4E8] dark:border-[#5B35B1] flex items-center justify-center text-[#2E7D8B] dark:text-[#D8B4FE] shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-extrabold tabular-nums text-[#26364A] dark:text-white leading-tight truncate">
                Sticky 1-{freezeCount} Locked
              </div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[#2E7D8B] dark:text-[#A78BFA] truncate">
                Freeze Horizontal
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Split Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* LEFT PANEL (7 Cols): Categorized 46 Canonical Fields Dictionary */}
        <div className="xl:col-span-7 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="font-display font-extrabold text-base text-[#26364A] dark:text-white">
                Kamus {columns.length} Kolom Kanonik (BASE_DATA_WO)
              </h3>
              <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-transparent font-mono text-[10px] font-bold">
                SCHEMA v4.{config.version || 18}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
              <GripVertical className="w-3.5 h-3.5 text-[#8492A5]" />
              <span>Tarik ikon untuk mengubah urutan horizontal</span>
            </div>
          </div>

          {filteredColumns.length === 0 && (
            <div className="bg-white/95 dark:bg-[#1E1238] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] p-8 text-center space-y-2">
              <p className="text-sm font-bold text-[#26364A] dark:text-white">
                Kolom tidak ditemukan untuk kueri &ldquo;{searchQuery}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#5B35B1] cursor-pointer"
              >
                Tampilkan Semua 46 Kolom
              </button>
            </div>
          )}

          {CANONICAL_COLUMN_GROUPS.map(group => {
            const groupCols = filteredColumns.filter(c => (c.categoryGroup || 'H') === group.id);
            if (groupCols.length === 0) return null;

            const activeInGroup = groupCols.filter(c => c.visible).length;
            const hiddenInGroup = groupCols.length - activeInGroup;
            const isDarkGroup = group.id === 'A' || group.id === 'B';
            const isCollapsed = Boolean(collapsedGroups[group.id]) && !searchQuery.trim();

            return (
              <div
                key={group.id}
                className="bg-white/95 dark:bg-[#1E1238] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] overflow-hidden shadow-2xs"
              >
                {/* Group Header */}
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(group.id)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    isDarkGroup
                      ? 'bg-gradient-to-r from-[#EAE8FF] to-[#DDF4F4] text-[#26364A] border-b border-[#C5BEEF] hover:from-[#DFDCFA] hover:to-[#CEF0F0] dark:bg-none dark:bg-[#2D115B] dark:text-white dark:border-[#35105E] dark:hover:bg-[#35105E]'
                      : 'bg-[#F4F7FB] dark:bg-[#251545] text-[#26364A] dark:text-white border-b border-[#DDE6F0] dark:border-[#35105E] hover:bg-[#EDF3F8] dark:hover:bg-[#35105E]/80'
                  }`}
                >
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 shrink-0 text-[#5145A6] dark:text-[#D8B4FE]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0 text-[#5145A6] dark:text-[#D8B4FE]" />
                    )}
                    <span className="font-display font-bold text-xs sm:text-[13px] tracking-tight">
                      {group.title}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                        isDarkGroup
                          ? 'bg-white text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:bg-white/15 dark:text-[#E9D5FF]'
                          : 'bg-white dark:bg-[#1E1238] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#5B35B1]'
                      }`}
                    >
                      {group.subtitle
                        ? group.subtitle
                        : hiddenInGroup === 0
                        ? `Semua Aktif (${activeInGroup})`
                        : `${activeInGroup} Aktif • ${hiddenInGroup} Sembunyi`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {group.mandatoryGroup ? (
                      <Lock className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                    ) : (
                      <span
                        className={`text-[11px] font-mono font-semibold whitespace-nowrap ${
                          isDarkGroup ? 'text-[#2E7D8B] dark:text-[#E9D5FF]' : 'text-[#52647A] dark:text-[#CEC0E8]'
                        }`}
                      >
                        {hiddenInGroup === 0 && isDarkGroup ? 'Semua Aktif' : `${groupCols.length} Kolom`}
                      </span>
                    )}
                  </div>
                </button>

                {/* Group Rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-[#DDE6F0] dark:divide-[#35105E]">
                    {groupCols.map(col => {
                      const globalIdx = columns.findIndex(c => c.key === col.key);
                      const isDragging = draggedKey === col.key;
                      const isDragTarget = dragOverKey === col.key && draggedKey !== col.key;
                      const frozenIdx = frozenColumns.findIndex(f => f.key === col.key);

                      return (
                        <div
                          key={col.key}
                          draggable={isSuperAdmin}
                          onDragStart={() => setDraggedKey(col.key)}
                          onDragOver={e => {
                            e.preventDefault();
                            if (draggedKey && draggedKey !== col.key) setDragOverKey(col.key);
                          }}
                          onDragLeave={() => {
                            if (dragOverKey === col.key) setDragOverKey(null);
                          }}
                          onDrop={e => {
                            e.preventDefault();
                            if (draggedKey && draggedKey !== col.key) {
                              handleReorderByKeys(draggedKey, col.key);
                            }
                            setDraggedKey(null);
                            setDragOverKey(null);
                          }}
                          onDragEnd={() => {
                            setDraggedKey(null);
                            setDragOverKey(null);
                          }}
                          className={`px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
                            isDragging
                              ? 'opacity-45 bg-[#EAE8FF] dark:bg-[#35105E]'
                              : isDragTarget
                              ? 'bg-[#DDF4F4]/80 dark:bg-[#35105E]/70 ring-1 ring-inset ring-[#6657C8] dark:ring-[#7135B5]'
                              : !col.visible
                              ? 'bg-[#F4F7FB]/80 dark:bg-[#160D29]/50 opacity-75 hover:opacity-100'
                              : 'hover:bg-[#EDF3F8]/70 dark:hover:bg-[#251545]/50'
                          }`}
                        >
                          {/* Left Side: Drag Handle + Order + Name + Key + Description */}
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <div className="flex items-center gap-1 pt-0.5 shrink-0">
                              <span
                                className={`text-[#8492A5] ${isSuperAdmin ? 'cursor-grab active:cursor-grabbing hover:text-[#5145A6]' : 'opacity-40'}`}
                                title="Tarik untuk mengubah urutan kolom"
                              >
                                <GripVertical className="w-4 h-4" />
                              </span>
                              <span className="w-7 text-[11px] font-mono font-bold tabular-nums text-[#52647A] dark:text-[#A78BFA]">
                                #{globalIdx + 1}
                              </span>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-bold text-[#26364A] dark:text-white">
                                  {col.label}
                                </span>
                                <span className="font-mono text-[10.5px] text-[#52647A] dark:text-[#CEC0E8]">
                                  {col.key}
                                </span>
                                {frozenIdx >= 0 && (
                                  <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#5B35B1] whitespace-nowrap">
                                    Sticky {frozenIdx + 1}
                                  </span>
                                )}
                                {col.badgeHint && !col.badgeHint.startsWith('Sticky') && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold whitespace-nowrap ${
                                      col.badgeHint.includes('Alert')
                                        ? 'bg-rose-50 dark:bg-rose-950/60 text-[#DC4C5A] border border-rose-200 dark:border-rose-800'
                                        : col.badgeHint === 'BUTUH APPROVAL'
                                        ? 'bg-amber-50 dark:bg-amber-950/60 text-[#D97706] border border-amber-200 dark:border-amber-800'
                                        : col.badgeHint === 'wa.me Action'
                                        ? 'bg-[#ECFDF5] dark:bg-emerald-950/60 text-[#16A36A] border border-emerald-200 dark:border-emerald-800'
                                        : col.badgeHint === 'G-Maps Link'
                                        ? 'bg-[#EFF6FF] dark:bg-blue-950/60 text-[#3977C9] border border-blue-200 dark:border-blue-800'
                                        : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#5B35B1]'
                                    }`}
                                  >
                                    {col.badgeHint}
                                  </span>
                                )}
                              </div>
                              {col.description && (
                                <p className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8]/80 truncate mt-0.5">
                                  {col.description}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Right Side: Reorder Buttons + Width Input + Lock/Switch */}
                          <div className="flex items-center justify-end gap-2.5 shrink-0 pl-9 sm:pl-0">
                            {/* Reorder Micro-Controls */}
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                disabled={!isSuperAdmin || globalIdx === 0}
                                onClick={() => handleMoveColumnStep(col.key, 'up')}
                                title="Naikkan urutan kolom"
                                className="p-1 rounded text-[#8492A5] hover:text-[#5145A6] hover:bg-[#EAE8FF] dark:hover:bg-[#35105E] disabled:opacity-25 cursor-pointer"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={!isSuperAdmin || globalIdx === columns.length - 1}
                                onClick={() => handleMoveColumnStep(col.key, 'down')}
                                title="Turunkan urutan kolom"
                                className="p-1 rounded text-[#8492A5] hover:text-[#5145A6] hover:bg-[#EAE8FF] dark:hover:bg-[#35105E] disabled:opacity-25 cursor-pointer"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>

                            {/* Editable Width */}
                            <div className="flex items-center gap-1 text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                              <span>Width:</span>
                              <input
                                type="number"
                                min={40}
                                max={480}
                                disabled={!isSuperAdmin}
                                value={col.width || 120}
                                onChange={e => handleWidthChange(col.key, parseInt(e.target.value, 10))}
                                className="w-14 px-1.5 py-0.5 text-right font-mono text-[11px] font-semibold bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded text-[#26364A] dark:text-white disabled:opacity-60 tabular-nums"
                              />
                              <span className="text-[10px]">px</span>
                            </div>

                            {/* Lock or Mandatory Indicator */}
                            {col.mandatory ? (
                              <span
                                className="w-5 h-5 rounded flex items-center justify-center text-[#D97706] bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800"
                                title="Kolom Mandatori — Terkunci Selalu Tampil"
                              >
                                <Lock className="w-3 h-3" />
                              </span>
                            ) : (
                              <span className="w-5" />
                            )}

                            {/* Visibility Toggle Switch */}
                            <button
                              type="button"
                              role="switch"
                              aria-checked={col.visible}
                              disabled={!isSuperAdmin || col.mandatory}
                              onClick={() => handleToggleColumnVisible(col)}
                              title={
                                col.mandatory
                                  ? 'Kolom mandatori selalu aktif'
                                  : col.visible
                                  ? 'Sembunyikan kolom di tabel WO'
                                  : 'Tampilkan kolom di tabel WO'
                              }
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed ${
                                col.visible
                                  ? col.mandatory
                                    ? 'bg-[#6657C8]/80 dark:bg-[#431599]/80'
                                    : 'bg-[#6657C8] dark:bg-[#431599]'
                                  : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                                  col.visible ? 'translate-x-4.5' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* RIGHT PANEL (5 Cols, Sticky): Simulator Live Tabel WO + Ergonomi */}
        <div className="xl:col-span-5 xl:sticky xl:top-20 space-y-4">
          {/* Card 1: Simulator Live Tabel WO */}
          <div className="bg-white/95 dark:bg-[#1E1238] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] overflow-hidden shadow-2xs">
            <div className="px-4 py-3 border-b border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
                <h4 className="font-display font-bold text-sm text-[#26364A] dark:text-white">
                  Simulator Live Tabel WO
                </h4>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#16A36A]">
                <span className="w-2 h-2 rounded-full bg-[#16A36A]" />
                <span>{isShowingLiveTickets ? 'Real-Time View' : 'Preview View'}</span>
              </span>
            </div>

            <div className="p-3.5 space-y-3">
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                Preview tampilan interaktif dengan <strong className="text-[#26364A] dark:text-white">{freezeCount} kolom pertama terkunci (Sticky Left Freeze)</strong> saat tabel digulir secara horizontal:
              </p>

              {/* Scrollable Live Grid */}
              <div className="rounded-lg border border-[#DDE6F0] dark:border-[#35105E] overflow-x-auto bg-white dark:bg-[#160D29]">
                <table className={`w-full border-collapse text-left ${simFontSizeClass}`}>
                  <thead>
                    <tr className="bg-[#EDF3F8] dark:bg-[#2D115B] text-[#26364A] dark:text-white text-[10.5px] font-mono font-bold border-b border-[#DDE6F0] dark:border-white/10">
                      {activeColumns.map((col, idx) => {
                        const isFrozen = idx < freezeCount;
                        const w = col.key === 'selection' ? 40 : Math.min(col.width || 130, 160);
                        const leftPos = isFrozen ? frozenColumnOffsets[idx] : undefined;
                        return (
                          <th
                            key={col.key}
                            style={{
                              minWidth: `${w}px`,
                              width: `${w}px`,
                              left: leftPos !== undefined ? `${leftPos}px` : undefined
                            }}
                            className={`px-2.5 py-2 whitespace-nowrap border-r border-[#DDE6F0] dark:border-white/10 ${
                              isFrozen ? 'sticky z-20 bg-[#EAE8FF] dark:bg-[#2D115B]' : ''
                            } ${
                              isFrozen && idx === freezeCount - 1
                                ? 'shadow-[3px_0_6px_-2px_rgba(38,54,74,0.14)] dark:shadow-[3px_0_6px_-2px_rgba(0,0,0,0.28)]'
                                : ''
                            }`}
                            title={showHoverTooltips ? `${col.label} (${col.key})` : undefined}
                          >
                            {col.key === 'selection' ? '#' : col.key}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DDE6F0] dark:divide-[#35105E]">
                    {simulatorRows.map((row, rowIdx) => (
                      <tr
                        key={row.id || rowIdx}
                        className="odd:bg-white even:bg-[#F8FAFD] hover:bg-[#EDF3F8] dark:odd:bg-transparent dark:even:bg-transparent dark:hover:bg-[#251545]/60 transition-colors"
                      >
                        {activeColumns.map((col, idx) => {
                          const isFrozen = idx < freezeCount;
                          const w = col.key === 'selection' ? 40 : Math.min(col.width || 130, 160);
                          const leftPos = isFrozen ? frozenColumnOffsets[idx] : undefined;
                          const val = getTicketCellValue(row, col.key);

                          if (col.key === 'selection') {
                            return (
                              <td
                                key={col.key}
                                style={{ minWidth: `${w}px`, width: `${w}px`, left: `${leftPos}px` }}
                                className={`px-2.5 text-center border-r border-[#DDE6F0] dark:border-[#35105E] ${simDensityRowHeight} ${
                                  isFrozen ? 'sticky z-10 bg-white dark:bg-[#1E1238]' : ''
                                }`}
                              >
                                <span
                                  className={`inline-flex w-3.5 h-3.5 rounded border items-center justify-center text-[9px] ${
                                    rowIdx === 0
                                      ? 'bg-[#6657C8] border-[#5145A6] dark:bg-[#431599] dark:border-[#431599] text-white'
                                      : 'border-[#CBD5E1] dark:border-[#5B35B1]'
                                  }`}
                                >
                                  {rowIdx === 0 ? '✓' : ''}
                                </span>
                              </td>
                            );
                          }

                          return (
                            <td
                              key={col.key}
                              style={{
                                minWidth: `${w}px`,
                                maxWidth: `${w}px`,
                                left: leftPos !== undefined ? `${leftPos}px` : undefined
                              }}
                              title={showHoverTooltips ? val : undefined}
                              className={`px-2.5 truncate whitespace-nowrap border-r border-[#DDE6F0]/70 dark:border-[#35105E]/70 ${simDensityRowHeight} ${
                                isFrozen ? 'sticky z-10 bg-white dark:bg-[#1E1238]' : ''
                              } ${
                                isFrozen && idx === freezeCount - 1
                                  ? 'shadow-[3px_0_6px_-2px_rgba(38,54,74,0.12)]'
                                  : ''
                              } ${
                                col.key === 'woNumber'
                                  ? 'font-mono font-bold text-[#26364A] dark:text-white'
                                  : col.key === 'customerPhone'
                                  ? 'font-mono font-semibold text-[#16A36A]'
                                  : col.key === 'idCustomer'
                                  ? 'font-mono tabular-nums text-[#52647A] dark:text-[#CEC0E8]'
                                  : 'text-[#26364A] dark:text-[#F5F1FF]'
                              }`}
                            >
                              {val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-3 py-2 rounded-lg bg-[#EAE8FF]/70 dark:bg-[#251545] border border-[#C5BEEF] dark:border-[#5B35B1] flex items-center justify-between gap-2 text-[11px]">
                <span className="text-[#5145A6] dark:text-[#D8B4FE] font-medium">
                  Gulir ke kanan untuk melihat <strong>{Math.max(0, activeColumns.length - freezeCount)}</strong> kolom berikutnya
                </span>
                <span className="font-bold text-[#5145A6] dark:text-white tabular-nums whitespace-nowrap">
                  Active: {kpiStats.active} Kolom
                </span>
              </div>
            </div>
          </div>

          {/* Stitch Card: Preview Urutan Kolom Aktif (Numbered Chips) */}
          <div className="card-3d-lavender rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                <span className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-[#5145A6] dark:text-[#D8B4FE]">
                  PREVIEW URUTAN KOLOM AKTIF
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1] tabular-nums">
                {activeColumns.length} / {columns.length} Tampil
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto pr-0.5">
              {activeColumns.map((col, idx) => {
                const isFrozen = idx < freezeCount;
                return (
                  <span
                    key={`active-chip-${col.key}`}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                      isFrozen
                        ? 'bg-[#6657C8] text-white border-[#5145A6] dark:bg-[#58149C] dark:border-[#431599]'
                        : 'bg-white dark:bg-[#160D29] text-[#26364A] dark:text-[#E9D5FF] border-[#C5BEEF] dark:border-[#3B1D78]'
                    }`}
                    title={`${col.label} (${col.key}) · ${col.width || 120}px`}
                  >
                    <span className={`font-mono text-[10px] ${isFrozen ? 'text-[#EAE8FF] dark:text-[#DAB9FF]' : 'text-[#5145A6] dark:text-[#D8B4FE]'}`}>
                      {idx + 1}.
                    </span>
                    <span className="truncate max-w-[140px]">{col.label}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Card 2: Pengaturan Ergonomi Tampilan UI */}
          <div className="bg-white/95 dark:bg-[#1E1238] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] overflow-hidden shadow-2xs">
            <div className="px-4 py-3 border-b border-[#DDE6F0] dark:border-[#35105E] flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
              <h4 className="font-display font-bold text-sm text-[#26364A] dark:text-white">
                Pengaturan Ergonomi Tampilan UI
              </h4>
            </div>

            <div className="p-4 space-y-4 text-xs">
              {/* Row Density */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#26364A] dark:text-[#F5F1FF]">
                  Kepadatan Baris Tabel (Row Density)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'compact', label: 'Compact (32px)' },
                    { id: 'comfortable', label: 'Comfortable (42px)' },
                    { id: 'spacious', label: 'Relaxed (52px)' }
                  ].map(opt => {
                    const active = config.ticketsTable.density === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!isSuperAdmin}
                        onClick={() =>
                          updateDraft(prev => ({
                            ...prev,
                            ticketsTable: {
                              ...prev.ticketsTable,
                              density: opt.id as 'compact' | 'comfortable' | 'spacious'
                            }
                          }))
                        }
                        className={`px-2.5 py-2 rounded-lg font-semibold border text-center transition-all cursor-pointer disabled:opacity-50 ${
                          active
                            ? 'bg-[#6657C8] dark:bg-[#2D115B] text-white border-[#5145A6] dark:border-[#2D115B] shadow-xs'
                            : 'bg-[#F4F7FB] dark:bg-[#160D29] text-[#52647A] dark:text-[#CEC0E8] border-[#DDE6F0] dark:border-[#35105E] hover:border-[#9E95DE]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Typography Cell Font Size */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#26364A] dark:text-[#F5F1FF]">
                  Ukuran Tipografi Sel Data
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'small', label: '12px Small' },
                    { id: 'medium', label: '13px Default' },
                    { id: 'large', label: '14px Medium' }
                  ].map(opt => {
                    const active = cellFontSize === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!isSuperAdmin}
                        onClick={() =>
                          updateDraft(prev => ({
                            ...prev,
                            ticketsTable: {
                              ...prev.ticketsTable,
                              cellFontSize: opt.id as 'small' | 'medium' | 'large'
                            }
                          }))
                        }
                        className={`px-2.5 py-2 rounded-lg font-semibold border text-center transition-all cursor-pointer disabled:opacity-50 ${
                          active
                            ? 'bg-[#6657C8] dark:bg-[#2D115B] text-white border-[#5145A6] dark:border-[#2D115B] shadow-xs'
                            : 'bg-[#F4F7FB] dark:bg-[#160D29] text-[#52647A] dark:text-[#CEC0E8] border-[#DDE6F0] dark:border-[#35105E] hover:border-[#9E95DE]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Freeze Column Count */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-bold text-[#26364A] dark:text-[#F5F1FF]">
                    Kolom Terkunci Kiri (Freeze Count)
                  </label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4].map(n => (
                      <button
                        key={n}
                        type="button"
                        disabled={!isSuperAdmin}
                        onClick={() =>
                          updateDraft(prev => ({
                            ...prev,
                            ticketsTable: {
                              ...prev.ticketsTable,
                              freezeColumnCount: n
                            }
                          }))
                        }
                        className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold border transition-all cursor-pointer disabled:opacity-50 ${
                          freezeCount === n
                            ? 'bg-[#6657C8] dark:bg-[#431599] text-white border-[#5145A6] dark:border-[#431599]'
                            : 'bg-[#EAE8FF] dark:bg-[#251545] text-[#5145A6] dark:text-[#D8B4FE] border-[#C5BEEF] dark:border-[#5B35B1]'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="ml-1 px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] font-bold text-[10.5px]">
                      {freezeCount} Kolom
                    </span>
                  </div>
                </div>
                <div className="px-3 py-2 rounded-lg bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                    {frozenColumns
                      .map((c, i) => `#${i + 1} ${c.label.split(' ')[0]}`)
                      .join(', ')}
                  </span>
                  <Lock className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
                </div>
              </div>

              {/* Hover Tooltips Toggle */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="min-w-0">
                  <div className="font-bold text-[#26364A] dark:text-[#F5F1FF]">
                    Tampilkan Tooltip Lengkap saat Hover
                  </div>
                  <div className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8]/80">
                    Munculkan alamat utuh, remark &amp; telemetry saat pointer diarahkan
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showHoverTooltips}
                  disabled={!isSuperAdmin}
                  onClick={() =>
                    updateDraft(prev => ({
                      ...prev,
                      ticketsTable: {
                        ...prev.ticketsTable,
                        showHoverTooltips: !(prev.ticketsTable.showHoverTooltips ?? true)
                      }
                    }))
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                    showHoverTooltips ? 'bg-[#6657C8] dark:bg-[#431599]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      showHoverTooltips ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Supabase Storage Location Note */}
              <div className="p-3 rounded-xl bg-[#DDF4F4]/70 dark:bg-[#251545] border border-[#BDE4E8] dark:border-[#5B35B1] flex items-start gap-2.5">
                <Database className="w-4 h-4 text-[#2E7D8B] dark:text-[#D8B4FE] shrink-0 mt-0.5" />
                <div className="space-y-1 text-[11px] leading-relaxed">
                  <div className="font-bold text-[#26364A] dark:text-white">
                    Lokasi Penyimpanan Preferensi
                  </div>
                  <div className="text-[#52647A] dark:text-[#CEC0E8]">
                    Database Supabase:{' '}
                    <span className="font-mono font-bold text-[#2E7D8B] dark:text-[#D8B4FE]">
                      app_settings.ui_configuration
                    </span>
                  </div>
                  <div className="text-[#52647A] dark:text-[#CEC0E8]/80">
                    Perubahan disimpan secara global dan langsung didistribusikan ke sesi seluruh agent, korlap, dan supervisor secara instan via Server-Sent Events (SSE).
                  </div>
                </div>
              </div>

              {/* Ergonomics Footer Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    cancelDraft();
                    onTriggerNotice('Perubahan draft dibatalkan dan dikembalikan ke konfigurasi tersimpan.');
                  }}
                  disabled={!isDrafting || isCloudSyncing}
                  className="btn-3d-lilac px-3 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-45"
                >
                  Batalkan Perubahan
                </button>
                <button
                  type="button"
                  onClick={handleSaveToDatabase}
                  disabled={!isSuperAdmin || isCloudSyncing}
                  className="btn-3d-primary px-3 py-2 rounded-xl text-xs font-extrabold cursor-pointer disabled:opacity-50"
                >
                  {isCloudSyncing ? 'Menyimpan...' : 'Terapkan Pengaturan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Table Preview Modal */}
      {showPreviewModal && (
        <ResponsiveModal
          isOpen={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
          title={`Pratinjau Penuh Tabel Work Order (${activeColumns.length} Kolom Aktif)`}
          subtitle={`Densitas: ${config.ticketsTable.density} • Font: ${cellFontSize} • Sticky Left: ${freezeCount} Kolom`}
          icon={<Eye className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />}
          size="2xl"
          mobileVariant="fullscreen"
          zIndexClass="z-60"
          headerExtra={
            onNavigateToTickets ? (
              <button
                type="button"
                onClick={() => {
                  setShowPreviewModal(false);
                  onNavigateToTickets();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#6657C8] hover:bg-[#5145A6] dark:bg-[#431599] text-white dark:hover:bg-[#35105E] cursor-pointer whitespace-nowrap"
              >
                Buka Halaman Ticket MyRepublic
              </button>
            ) : undefined
          }
        >
          <div className="p-4 sm:p-5">
            <div className="rounded-xl border border-[#DDE6F0] dark:border-[#35105E] overflow-x-auto">
              <table className={`w-full border-collapse text-left ${simFontSizeClass}`}>
                <thead>
                  <tr className="bg-[#EDF3F8] dark:bg-[#2D115B] text-[#26364A] dark:text-white text-[11px] font-bold uppercase tracking-wider border-b border-[#DDE6F0] dark:border-white/10">
                    {activeColumns.map((col, idx) => {
                      const isFrozen = idx < freezeCount;
                      return (
                        <th
                          key={col.key}
                          style={{ minWidth: `${col.width || 120}px` }}
                          className={`px-3 py-2.5 whitespace-nowrap border-r border-[#DDE6F0] dark:border-white/10 ${
                            isFrozen ? 'bg-[#EAE8FF] dark:bg-[#35105E]' : ''
                          }`}
                        >
                          {col.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE6F0] dark:divide-[#35105E]">
                  {simulatorRows.map((row, rIdx) => (
                    <tr key={row.id || rIdx} className="odd:bg-white even:bg-[#F8FAFD] hover:bg-[#EDF3F8] dark:odd:bg-transparent dark:even:bg-transparent dark:hover:bg-[#251545]/60">
                      {activeColumns.map(col => (
                        <td
                          key={col.key}
                          style={{ minWidth: `${col.width || 120}px` }}
                          className={`px-3 whitespace-nowrap truncate max-w-xs border-r border-[#DDE6F0]/60 dark:border-[#35105E]/50 text-[#26364A] dark:text-[#F5F1FF] ${simDensityRowHeight}`}
                        >
                          {col.key === 'selection' ? '☐' : getTicketCellValue(row, col.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isShowingLiveTickets && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                <Info className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                <span>Menampilkan contoh baris pratinjau karena belum ada WO aktif yang termuat.</span>
              </div>
            )}
            {isShowingLiveTickets && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-[#16A36A] font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Pratinjau menggunakan data Work Order aktual dari database aplikasi.</span>
              </div>
            )}
          </div>
        </ResponsiveModal>
      )}
    </div>
  );
};
