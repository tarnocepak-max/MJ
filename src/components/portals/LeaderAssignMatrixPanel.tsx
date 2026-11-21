import React, { useState } from 'react';
import {
  Search,
  Wand2,
  MapPin,
  RotateCcw,
  MessageSquare,
  LayoutGrid,
  Table as TableIcon,
  Sliders,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  Printer,
  UserCheck,
  Zap,
  Info,
  Phone,
  GitBranch,
  ChevronDown
} from 'lucide-react';
import { Ticket } from '../../types/index.ts';
import { useUIConfig } from '../../context/UIConfigContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { PaginationBar } from '../common/PaginationBar';
import { ColumnConfig } from './LeaderColumnSettingsModal';
import {
  formatSlotBadgeLabel,
  normalizeSlotIndex,
  TechnicianCapacitySummary
} from '../../services/leaderQuotaService';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { getTicketWorkStatus, formatJakartaTimeOnly } from '../../services/workSessionService';

interface LeaderAssignMatrixPanelProps {
  // Data
  totalScopedCount: number;
  slotTicketsSource?: Ticket[];
  filteredTickets: Ticket[];
  paginatedTickets: Ticket[];
  unassignedCount: number;
  assignedCount: number;
  inProgressCount: number;
  completedCount: number;
  pendingCount: number;
  problemCount: number;
  clusterOptions: string[];
  categoryOptions?: { name: string; count: number }[];
  technicians: TechnicianCapacitySummary[];

  // Filters & view state
  viewMode: 'cards' | 'table';
  onViewModeChange: (mode: 'cards' | 'table') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  slotFilter: string;
  onSlotFilterChange: (slot: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  categoryFilter?: string;
  onCategoryFilterChange?: (cat: string) => void;
  clusterFilter: string;
  onClusterFilterChange: (cluster: string) => void;
  installerFilter: string;
  onInstallerFilterChange: (inst: string) => void;
  onResetFilters: () => void;

  // Bulk selection & actions
  selectedTicketIds: string[];
  onToggleSelectTicket: (id: string) => void;
  onSelectAllUnassigned: (checked: boolean) => void;
  onClearSelection: () => void;
  bulkQuickInstaller: string;
  onBulkQuickInstallerChange: (name: string) => void;
  onExecuteBulkQuickAssign: () => void;
  onExecuteAutoBalance: () => void;

  // Per-card actions
  isLeaderRole: boolean;
  onInlineAssign: (ticket: Ticket, installerName: string) => void;
  onOpenReassignModal: (ticket: Ticket) => void;
  onOpenWhatsAppModal: (ticket: Ticket) => void;
  onSelectTicket: (ticket: Ticket) => void;

  // Table view props
  visibleColumns: ColumnConfig[];
  renderHeaderCell: (col: ColumnConfig) => React.ReactNode;
  renderBodyCell: (
    col: ColumnConfig,
    t: Ticket,
    isSelected: boolean,
    isExpanded: boolean,
    label: string,
    progressPercent: number
  ) => React.ReactNode;
  expandedRowIds: Record<string, boolean>;
  classifyTicketOperational: (t: Ticket) => {
    category: 'unassigned' | 'waiting' | 'in_progress' | 'completed' | 'pending' | 'problem';
    label: string;
    progressPercent: number;
    color: string;
  };
  onOpenColumnSettings: () => void;
  onExportCopy: () => void;
  onExportCSV: () => void;
  onExportExcel: () => void;
  onPrint: () => void;

  // Pagination
  rowsPerPage: number;
  onRowsPerPageChange: (rows: number) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function getCustomerInitials(name?: string): string {
  const parts = String(name || 'PL').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getInstallerBadgeInfo(ticket: Ticket): { label: string; cls: string } {
  const s = String(ticket.statusWOInstaller || 'Unassigned').trim();
  const up = s.toUpperCase();
  if (!ticket.installerName || up === 'UNASSIGNED') {
    return {
      label: 'UNASSIGNED',
      cls: 'bg-[#fef3c7] dark:bg-amber-950/60 border border-[#fcd34d] dark:border-amber-700 text-[#b45309] dark:text-amber-300'
    };
  }
  if (up === 'COMPLETED' || up === 'INSTALLED') {
    return {
      label: up,
      cls: 'bg-[#dcfce7] dark:bg-emerald-950/60 border border-[#86efac] dark:border-emerald-700 text-[#15803d] dark:text-emerald-300'
    };
  }
  if (up === 'ON SITE' || up === 'EN ROUTE' || up === 'IN PROGRESS') {
    return {
      label: up,
      cls: 'bg-[#eedbff] dark:bg-[#2E1B59] border border-[#d0bcff] dark:border-[#5B35B1] text-[#58149c] dark:text-[#dab9ff]'
    };
  }
  if (up === 'FAILED / CANCELLED' || up === 'PENDING TECHNICAL') {
    return {
      label: up,
      cls: 'bg-[#ffdad6] dark:bg-rose-950/60 border border-[#fca5a5] dark:border-rose-800 text-[#93000a] dark:text-rose-300'
    };
  }
  return {
    label: up,
    cls: 'bg-[#f3eaff] dark:bg-[#2E1B59] border border-[#d0bcff] dark:border-[#58149c]/50 text-[#58149c] dark:text-[#dab9ff]'
  };
}

function getWhatsAppBadgeInfo(ticket: Ticket): { label: string; cls: string } {
  const raw = String(ticket.statusWhatsApp || '').toLowerCase();
  if (raw.includes('confirm')) {
    return {
      label: 'WA: CONFIRMED',
      cls: 'bg-[#ecfdf5] dark:bg-emerald-950/60 border border-[#16a36a]/30 text-[#15803d] dark:text-emerald-300'
    };
  }
  if (raw.includes('open') || raw.includes('read') || raw.includes('sent')) {
    return {
      label: 'WA: OPENED',
      cls: 'bg-[#ecfdf5] dark:bg-emerald-950/60 border border-[#16a36a]/30 text-[#15803d] dark:text-emerald-300'
    };
  }
  if (raw.includes('unreachable') || raw.includes('fail') || raw.includes('cancel')) {
    return {
      label: 'WA: UNREACHABLE',
      cls: 'bg-[#ffdad6] dark:bg-rose-950/60 border border-[#ba1a1a]/30 text-[#93000a] dark:text-rose-300'
    };
  }
  if (raw.includes('reschedule')) {
    return {
      label: 'WA: RESCHEDULE',
      cls: 'bg-[#fef3c7] dark:bg-amber-950/60 border border-[#fcd34d] text-[#b45309] dark:text-amber-300'
    };
  }
  return {
    label: 'WA: READY',
    cls: 'bg-[#f8f1ff] dark:bg-[#261942] border border-[#e8ddff] dark:border-[#4b386b] text-[#58149c] dark:text-[#dab9ff]'
  };
}

export const LeaderAssignMatrixPanel: React.FC<LeaderAssignMatrixPanelProps> = ({
  totalScopedCount,
  slotTicketsSource,
  filteredTickets,
  paginatedTickets,
  unassignedCount,
  assignedCount,
  inProgressCount,
  completedCount,
  pendingCount,
  problemCount,
  clusterOptions,
  categoryOptions = [],
  technicians,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  slotFilter,
  onSlotFilterChange,
  statusFilter,
  onStatusFilterChange,
  categoryFilter = 'ALL',
  onCategoryFilterChange,
  clusterFilter,
  onClusterFilterChange,
  installerFilter,
  onInstallerFilterChange,
  onResetFilters,
  selectedTicketIds,
  onToggleSelectTicket,
  onSelectAllUnassigned,
  onClearSelection,
  bulkQuickInstaller,
  onBulkQuickInstallerChange,
  onExecuteBulkQuickAssign,
  onExecuteAutoBalance,
  isLeaderRole,
  onInlineAssign,
  onOpenReassignModal,
  onOpenWhatsAppModal,
  onSelectTicket,
  visibleColumns,
  renderHeaderCell,
  renderBodyCell,
  expandedRowIds,
  classifyTicketOperational,
  onOpenColumnSettings,
  onExportCopy,
  onExportCSV,
  onExportExcel,
  onPrint,
  rowsPerPage,
  onRowsPerPageChange,
  currentPage,
  totalPages,
  onPageChange
}) => {
  const [pendingInlineChoice, setPendingInlineChoice] = useState<Record<string, string>>({});
  const { isCompactUI } = useResponsiveViewport();
  const { canSwitchDisplayMode, setDisplayMode } = useUIConfig();

  const unassignedTicketsInView = filteredTickets.filter(t => !t.installerName);
  const allUnassignedChecked =
    unassignedTicketsInView.length > 0 &&
    unassignedTicketsInView.every(t => selectedTicketIds.includes(t.id));

  const techLookupMap = new Map<string, TechnicianCapacitySummary>();
  technicians.forEach(tech => {
    techLookupMap.set(tech.installer.name.toLowerCase().trim(), tech);
  });

  const effectiveViewMode: 'cards' | 'table' = isCompactUI ? 'cards' : 'table';

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    slotFilter !== 'ALL' ||
    statusFilter !== 'all' ||
    categoryFilter !== 'ALL' ||
    clusterFilter !== 'ALL' ||
    installerFilter !== 'ALL';

  const slotSource = slotTicketsSource || filteredTickets;
  const slotTabItems = [
    { id: 'ALL', label: 'Semua Slot', count: slotSource.length },
    {
      id: '1',
      label: 'Slot 1 (09-11)',
      count: slotSource.filter(t => normalizeSlotIndex(t.slotTime) === 1).length
    },
    {
      id: '2',
      label: 'Slot 2 (11-13)',
      count: slotSource.filter(t => normalizeSlotIndex(t.slotTime) === 2).length
    },
    {
      id: '3',
      label: 'Slot 3 (13-15)',
      count: slotSource.filter(t => normalizeSlotIndex(t.slotTime) === 3).length
    },
    {
      id: '4',
      label: 'Slot 4 (15-17)',
      count: slotSource.filter(t => normalizeSlotIndex(t.slotTime) === 4).length
    }
  ];

  return (
    <div className="space-y-3.5">
      {/* CATEGORY FILTER CHIPS (Matching Stitch Assign Pills) */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5">
        <button
          type="button"
          onClick={() => {
            onStatusFilterChange('all');
            if (onCategoryFilterChange) onCategoryFilterChange('ALL');
          }}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
            statusFilter === 'all' && categoryFilter === 'ALL'
              ? 'bg-[#58149c] text-white shadow-[0_2px_8px_rgba(88,20,156,0.28)]'
              : 'bg-white dark:bg-[#1E1238] border border-[#e8ddff] dark:border-[#35105E] text-[#4b4452] dark:text-[#CEC0E8] hover:border-[#a380fe]'
          }`}
        >
          <span>Semua</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
              statusFilter === 'all' && categoryFilter === 'ALL'
                ? 'bg-white/20 text-white'
                : 'bg-[#f3eaff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff]'
            }`}
          >
            {totalScopedCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (onCategoryFilterChange) onCategoryFilterChange('ALL');
            onStatusFilterChange(statusFilter === 'unassigned' ? 'all' : 'unassigned');
          }}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
            statusFilter === 'unassigned'
              ? 'bg-[#d97706] text-white shadow-[0_2px_8px_rgba(217,119,6,0.28)]'
              : 'bg-white dark:bg-[#1E1238] border border-[#e8ddff] dark:border-[#35105E] text-[#4b4452] dark:text-[#CEC0E8] hover:border-amber-400'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === 'unassigned' ? 'bg-white' : 'bg-[#d97706]'}`} />
          <span>Unassigned</span>
          <span className="font-mono text-[10.5px] tabular-nums opacity-90">{unassignedCount}</span>
        </button>

        {categoryOptions.map(cat => {
          const isCatActive = categoryFilter === cat.name;
          return (
            <button
              key={cat.name}
              type="button"
              onClick={() => {
                if (onCategoryFilterChange) {
                  onCategoryFilterChange(isCatActive ? 'ALL' : cat.name);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                isCatActive
                  ? 'bg-[#58149c] text-white shadow-[0_2px_8px_rgba(88,20,156,0.25)]'
                  : 'bg-white dark:bg-[#1E1238] border border-[#e8ddff] dark:border-[#35105E] text-[#4b4452] dark:text-[#CEC0E8] hover:border-[#a380fe]'
              }`}
            >
              <span>{cat.name}</span>
              <span className="font-mono text-[10.5px] tabular-nums opacity-85">{cat.count}</span>
            </button>
          );
        })}
      </div>

      {/* FILTER & CONTROLS BAR */}
      <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#e8ddff] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(31,22,56,0.04)] space-y-3">
        {/* SLOT GROUPING QUICK TABS (Ref 2 Dispatch Queue Matrix) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 border-b border-[#f3eaff] dark:border-[#35105E]">
          {slotTabItems.map(tab => {
            const isSlotActive = slotFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSlotFilterChange(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer ${
                  isSlotActive
                    ? 'tactile-chip-active'
                    : 'tactile-chip text-[#4b4452] dark:text-[#CEC0E8]'
                }`}
              >
                <Clock className="w-3 h-3 opacity-85" />
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
                    isSlotActive
                      ? 'bg-white/20 text-white'
                      : 'bg-[#f3eaff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff]'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[190px]">
            <Search className="w-3.5 h-3.5 text-[#7d7484] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Cari WO / ID Pelanggan / Alamat / ODP..."
              className="tactile-debossed-input w-full pl-8.5 pr-3 py-2 bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#3E246F] rounded-xl text-xs text-[#1f1638] dark:text-white placeholder:text-[#7d7484] focus:outline-hidden focus:border-[#58149c]"
            />
          </div>

          {/* Slot Waktu Filter */}
          <select
            value={slotFilter}
            onChange={e => onSlotFilterChange(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#3E246F] rounded-xl text-xs font-semibold text-[#1f1638] dark:text-white focus:outline-hidden focus:border-[#58149c] cursor-pointer"
          >
            <option value="ALL">Semua Slot</option>
            <option value="1">Slot 1 (09:00 - 11:00)</option>
            <option value="2">Slot 2 (11:00 - 13:00)</option>
            <option value="3">Slot 3 (13:00 - 15:00)</option>
            <option value="4">Slot 4 (15:00 - 17:00)</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => onStatusFilterChange(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#3E246F] rounded-xl text-xs font-semibold text-[#1f1638] dark:text-white focus:outline-hidden focus:border-[#58149c] cursor-pointer"
          >
            <option value="all">Semua Status ({totalScopedCount})</option>
            <option value="unassigned">Unassigned ({unassignedCount})</option>
            <option value="assigned">Assigned ({assignedCount})</option>
            <option value="in_progress">Sedang Jalan ({inProgressCount})</option>
            <option value="completed">Selesai ({completedCount})</option>
            <option value="pending">Tertunda ({pendingCount})</option>
            <option value="problem">Kendala ({problemCount})</option>
          </select>

          {/* Sub-Cluster Filter */}
          <select
            value={clusterFilter}
            onChange={e => onClusterFilterChange(e.target.value)}
            className="w-full sm:w-auto sm:max-w-[175px] px-3 py-2 bg-white dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#3E246F] rounded-xl text-xs font-semibold text-[#1f1638] dark:text-white focus:outline-hidden focus:border-[#58149c] cursor-pointer"
          >
            <option value="ALL">Semua Cluster</option>
            {clusterOptions.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* View Mode Toggle: Synchronized with Global Display Mode (Mobile = Kartu, Desktop = Tabel) */}
          {canSwitchDisplayMode && (
            <div
              role="group"
              aria-label="Kartu & Tabel Layout Switch"
              className="inline-flex items-center rounded-xl border border-[#e8ddff] dark:border-[#3E246F] bg-[#f8f1ff] dark:bg-[#160D29] p-0.5 ml-auto shrink-0 gap-0.5"
            >
              <button
                type="button"
                onClick={() => {
                  setDisplayMode('mobile');
                  onViewModeChange('cards');
                }}
                aria-pressed={effectiveViewMode === 'cards'}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                  effectiveViewMode === 'cards'
                    ? 'btn-3d-primary'
                    : 'text-[#7d7484] dark:text-[#A79BC0] hover:text-[#1f1638] dark:hover:text-white'
                }`}
                title="Tampilan Kartu (Terintegrasi dengan Mobile Mode)"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Kartu</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDisplayMode('desktop');
                  onViewModeChange('table');
                }}
                aria-pressed={effectiveViewMode === 'table'}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                  effectiveViewMode === 'table'
                    ? 'btn-3d-primary'
                    : 'text-[#7d7484] dark:text-[#A79BC0] hover:text-[#1f1638] dark:hover:text-white'
                }`}
                title="Tampilan Tabel (Terintegrasi dengan Desktop Mode)"
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Tabel</span>
              </button>
            </div>
          )}
        </div>

        {/* Active Installer Filter indicator + Table Extra Controls */}
        {(installerFilter !== 'ALL' || hasActiveFilters || effectiveViewMode === 'table') && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#f3eaff] dark:border-[#3E246F] text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              {installerFilter !== 'ALL' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#f3eaff] dark:bg-[#261942] border border-[#d0bcff] dark:border-[#4B386B] text-[#58149c] dark:text-[#dab9ff] font-semibold">
                  <span>Filter Teknisi: {installerFilter}</span>
                  <button
                    type="button"
                    onClick={() => onInstallerFilterChange('ALL')}
                    className="hover:text-[#ba1a1a] font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </span>
              )}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="btn-3d-secondary inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Filter</span>
                </button>
              )}
            </div>

            {effectiveViewMode === 'table' && (
              <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={onExportCopy}
                  className="btn-3d-secondary px-2 py-1 rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={onExportCSV}
                  className="btn-3d-secondary px-2 py-1 rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={onExportExcel}
                  className="btn-3d-emerald px-2 py-1 rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={onPrint}
                  className="btn-3d-secondary px-2 py-1 rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3 h-3" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenColumnSettings}
                  className="btn-3d-secondary px-2.5 py-1 rounded-lg font-bold text-[#58149c] flex items-center gap-1 cursor-pointer"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Atur Kolom</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* BULK SELECTION & AUTO-BALANCE ROW */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-[#e8ddff] dark:border-[#3E246F] text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-[#1f1638] dark:text-white">
              <input
                type="checkbox"
                checked={allUnassignedChecked}
                disabled={unassignedTicketsInView.length === 0}
                onChange={e => onSelectAllUnassigned(e.target.checked)}
                className="w-4 h-4 accent-[#58149c] rounded border-[#cec3d4] cursor-pointer"
              />
              <span>
                Pilih Semua Unassigned ({unassignedTicketsInView.length} WO)
              </span>
            </label>

            {selectedTicketIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#58149c] dark:text-[#dab9ff] tabular-nums">
                  • {selectedTicketIds.length} WO Terpilih
                </span>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="text-[11px] text-[#7d7484] dark:text-[#A79BC0] hover:text-[#ba1a1a] underline cursor-pointer"
                >
                  Batal
                </button>
              </div>
            )}
          </div>

          {isLeaderRole ? (
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={bulkQuickInstaller}
                onChange={e => onBulkQuickInstallerChange(e.target.value)}
                className="px-3 py-2 sm:py-1.5 bg-[#f8f1ff] dark:bg-[#160D29] border border-[#d0bcff] dark:border-[#4B386B] rounded-xl text-xs font-medium text-[#1f1638] dark:text-white w-full sm:w-auto sm:min-w-[180px] focus:outline-hidden focus:border-[#58149c]"
              >
                <option value="">Tugaskan Terpilih Ke...</option>
                {technicians.map(tech => (
                  <option
                    key={tech.installer.id}
                    value={tech.installer.name}
                    disabled={tech.isFull}
                  >
                    {tech.installer.name} ({tech.assignedCount}/{tech.maxLimit})
                    {tech.isFull ? ' - PENUH' : ''}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={!bulkQuickInstaller || selectedTicketIds.length === 0}
                onClick={onExecuteBulkQuickAssign}
                className="btn-3d-primary px-3.5 py-1.5 rounded-xl disabled:opacity-45 font-bold text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Tugaskan</span>
              </button>

              <button
                type="button"
                onClick={onExecuteAutoBalance}
                title="Auto-Balance Slot: distribusikan otomatis WO Unassigned sesuai slot waktu & sisa kuota terendah"
                className="btn-3d-secondary px-2.5 py-1.5 rounded-xl text-[#58149c] dark:text-[#dab9ff] cursor-pointer shrink-0 flex items-center gap-1.5"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold">Auto-Balance</span>
              </button>
            </div>
          ) : (
            <span className="px-2.5 py-1 rounded-lg bg-[#f8f1ff] dark:bg-[#261942] border border-[#e8ddff] dark:border-[#4B386B] text-[11px] font-semibold text-[#7d7484] dark:text-[#A79BC0]">
              Mode Monitoring Read-Only (Write eksklusif Leader)
            </span>
          )}
        </div>
      </div>

      {/* BODY: EMPTY STATE OR STITCH CARDS OR CLASSIC TABLE */}
      {filteredTickets.length === 0 ? (
        <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#e8ddff] dark:border-[#3E246F] p-10 text-center space-y-3 shadow-[0_2px_8px_rgba(31,22,56,0.04)]">
          <div className="w-11 h-11 rounded-2xl bg-[#f3eaff] dark:bg-[#2E1B59] text-[#58149c] dark:text-[#dab9ff] flex items-center justify-center mx-auto">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-[#1f1638] dark:text-white">
              Tidak ada Work Order yang cocok dengan filter aktif
            </h4>
            <p className="text-xs text-[#7d7484] dark:text-[#A79BC0] mt-1">
              Coba ubah filter Slot Waktu, Status, Kategori, atau kata kunci pencarian Anda.
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="btn-3d-primary px-4 py-2 rounded-xl font-bold text-xs cursor-pointer"
            >
              Tampilkan Semua WO Hari Ini
            </button>
          )}
        </div>
      ) : effectiveViewMode === 'cards' ? (
        /* STITCH WO DISPATCH CARDS */
        <div className={`grid gap-3.5 ${isCompactUI ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
          {paginatedTickets.map(t => {
            const isSelected = selectedTicketIds.includes(t.id);
            const isUnassigned = !t.installerName;
            const instBadge = getInstallerBadgeInfo(t);
            const waBadge = getWhatsAppBadgeInfo(t);
            const slotIdx = normalizeSlotIndex(t.slotTime);
            const slotBadgeLabel = formatSlotBadgeLabel(t.slotTime);

            const assignedTech = t.installerName
              ? techLookupMap.get(t.installerName.toLowerCase().trim())
              : undefined;

            const sortedInlineCandidates = [...technicians].sort((a, b) => {
              if (a.isFull !== b.isFull) return a.isFull ? 1 : -1;
              const aSlotFree = slotIdx
                ? a.slots.find(s => s.slotIndex === slotIdx)?.state === 'free'
                : !a.isFull;
              const bSlotFree = slotIdx
                ? b.slots.find(s => s.slotIndex === slotIdx)?.state === 'free'
                : !b.isFull;
              if (aSlotFree !== bSlotFree) return aSlotFree ? -1 : 1;
              return a.assignedCount - b.assignedCount;
            });

            const recommendedCandidate = sortedInlineCandidates.find(c => !c.isFull) || sortedInlineCandidates[0];
            const chosenInstallerName = pendingInlineChoice[t.id] || recommendedCandidate?.installer.name || '';
            const chosenTechObj = chosenInstallerName
              ? techLookupMap.get(chosenInstallerName.toLowerCase().trim())
              : recommendedCandidate;
            const chosenFirstName = chosenInstallerName ? chosenInstallerName.split(' ')[0] : '';

            const realOpm =
              t.technicalReport?.opticalPowerDbm ??
              t.technicalReport?.opticalPowerRx ??
              t.fatRedamanDbm;

            const isUrgentOrIncident =
              String(t.ticketCategory || '').toLowerCase().includes('gangguan') ||
              String(t.ticketCategory || '').toLowerCase().includes('repair') ||
              String(t.ticketCategory || '').toLowerCase().includes('los') ||
              String(t.statusWOInstaller || '').toLowerCase().includes('pending');

            return (
              <div
                key={t.id}
                className={`rounded-2xl p-4 transition-all flex flex-col justify-between gap-3 shadow-[0_3px_12px_rgba(31,22,56,0.05)] ${
                  isSelected
                    ? 'border-[1.5px] border-[#58149c] ring-2 ring-[#dab9ff]/70 bg-[#fcf9ff] dark:bg-[#27184A]'
                    : isUnassigned
                    ? 'border border-[#e8ddff] dark:border-[#4b386b] bg-white dark:bg-[#1E1238] hover:border-[#a380fe]'
                    : 'border border-[#e8ddff] dark:border-[#3E246F] bg-white dark:bg-[#1E1238] hover:border-[#d0bcff]'
                }`}
              >
                {/* Row 1: Checkbox + #WO + Category Pill + Slot/Status */}
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelectTicket(t.id)}
                        aria-label={`Pilih ${t.woNumber}`}
                        className="w-4 h-4 accent-[#58149c] rounded border-[#cec3d4] cursor-pointer shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => onSelectTicket(t)}
                        className="font-mono font-extrabold text-[13.5px] text-[#1f1638] dark:text-white hover:text-[#58149c] dark:hover:text-[#dab9ff] hover:underline tabular-nums cursor-pointer"
                      >
                        {t.woNumber}
                      </button>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isUrgentOrIncident
                            ? 'bg-[#ffdad6] dark:bg-rose-950/70 text-[#93000a] dark:text-rose-300'
                            : 'bg-[#eedbff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff]'
                        }`}
                      >
                        {t.ticketCategory || 'FTTH'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${instBadge.cls}`}
                      >
                        {instBadge.label}
                      </span>
                    </div>
                  </div>

                  {/* Secondary meta line: Slot Time & WA status */}
                  <div className="flex flex-wrap items-center gap-1.5 pl-6 text-[11px]">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] text-[#4b4452] dark:text-[#CEC0E8] font-semibold tabular-nums">
                      <Clock className="w-3 h-3 text-[#58149c] dark:text-[#dab9ff]" />
                      {slotBadgeLabel}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${waBadge.cls}`}>
                      {waBadge.label}
                    </span>
                  </div>
                </div>

                {/* Optional Real OTDR/OPM Dark Telemetry Bar (Only shown if real OPM exists in DB) */}
                {realOpm !== undefined && realOpm !== null && String(realOpm).trim() !== '' && (
                  <div className="rounded-xl bg-[#1f1638] dark:bg-[#120924] text-white p-3 space-y-1">
                    <div className="flex items-center justify-between text-[10.5px] font-mono">
                      <span className="flex items-center gap-1.5 font-bold text-amber-300 uppercase">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        OPM TELEMETRY TERCATAT
                      </span>
                      <span className="font-extrabold text-amber-300 tabular-nums">
                        {String(realOpm).includes('dBm') ? realOpm : `${realOpm} dBm`}
                      </span>
                    </div>
                    {(t.remarksWOInstaller || t.technicalReport?.rootCause) && (
                      <p className="text-[11px] text-[#e8ddff] line-clamp-2">
                        {t.remarksWOInstaller || t.technicalReport?.rootCause}
                      </p>
                    )}
                  </div>
                )}

                {/* Customer & Network Info Card */}
                <div className="bg-[#f8f1ff] dark:bg-[#160D29] rounded-xl p-3 border border-[#e8ddff] dark:border-[#35105E] space-y-2">
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[#e8ddff] dark:bg-[#2E1B59] text-[#58149c] dark:text-[#dab9ff] font-extrabold text-xs flex items-center justify-center shrink-0">
                        {getCustomerInitials(t.customerName)}
                      </div>
                      <div className="min-w-0">
                        <div
                          className="font-bold text-[13.5px] text-[#1f1638] dark:text-white truncate"
                          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                        >
                          {t.customerName}
                        </div>
                        <div className="text-[11px] font-mono text-[#7d7484] dark:text-[#CEC0E8] truncate tabular-nums">
                          ID: {t.idCustomer || t.customerId || '-'} · {t.customerPhone || '-'}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenWhatsAppModal(t)}
                      title="Hubungi / Kirim Notifikasi WhatsApp"
                      className="w-8 h-8 rounded-xl bg-white dark:bg-[#261942] border border-[#e8ddff] dark:border-[#4b386b] text-[#58149c] dark:text-[#dab9ff] hover:bg-[#eedbff] flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => openCustomerAddressInGoogleMaps(t)}
                    className="w-full flex items-start gap-1.5 text-[11.5px] text-[#4b4452] dark:text-[#CEC0E8] hover:text-[#58149c] dark:hover:text-[#dab9ff] text-left group cursor-pointer"
                    title="Buka alamat pelanggan di Google Maps"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#58149c] dark:text-[#dab9ff] shrink-0 mt-0.5" />
                    <span className="line-clamp-2 group-hover:underline">
                      {[t.streetName, t.clusterName, t.area].filter(Boolean).join(', ') || 'Alamat belum tercatat'}
                    </span>
                  </button>

                  {/* ODP / FAT Network Strip */}
                  {(t.fdtCode || t.fatCode || t.remarksAgent) && (
                    <div className="pt-1.5 border-t border-[#e8ddff] dark:border-[#35105E] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 font-mono font-bold text-[#1f1638] dark:text-[#e8ddff]">
                        <GitBranch className="w-3 h-3 text-[#58149c] dark:text-[#dab9ff]" />
                        {t.fatCode || t.fdtCode || 'ODP/FAT -'}
                      </span>
                      {t.fdtCode && t.fatCode && (
                        <span className="font-mono text-[10.5px] text-[#7d7484] dark:text-[#CEC0E8]">
                          OLT/FDT: {t.fdtCode}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Bottom Action Area */}
                {isUnassigned ? (
                  isLeaderRole ? (
                    <div className="space-y-2">
                      {/* Stitch Recommended Technician Selector Box */}
                      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#160D29] border border-[#d0bcff] dark:border-[#4b386b]">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="w-7 h-7 rounded-full bg-[#eedbff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff] flex items-center justify-center shrink-0">
                            <UserCheck className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-[#58149c] dark:text-[#dab9ff] uppercase">
                                {pendingInlineChoice[t.id] ? 'Teknisi Dipilih' : 'Rekomendasi Slot'}
                              </span>
                              {chosenTechObj && (
                                <span className="text-[10px] font-mono font-bold text-[#16A36A] dark:text-emerald-400 tabular-nums">
                                  ({chosenTechObj.assignedCount}/{chosenTechObj.maxLimit})
                                </span>
                              )}
                            </div>
                            <div className="relative flex items-center">
                              <select
                                value={chosenInstallerName}
                                onChange={e =>
                                  setPendingInlineChoice(prev => ({
                                    ...prev,
                                    [t.id]: e.target.value
                                  }))
                                }
                                aria-label={`Pilih teknisi untuk ${t.woNumber}`}
                                className="w-full appearance-none bg-transparent pr-5 py-0.5 font-bold text-xs text-[#1f1638] dark:text-white focus:outline-hidden cursor-pointer truncate"
                              >
                                {sortedInlineCandidates.length === 0 ? (
                                  <option value="">Belum ada teknisi aktif</option>
                                ) : (
                                  sortedInlineCandidates.map(tech => (
                                    <option key={tech.installer.id} value={tech.installer.name} className="bg-white dark:bg-[#1E1238]">
                                      {tech.installer.name} ({tech.assignedCount}/{tech.maxLimit} Slot{tech.isFull ? ' · PENUH' : ''})
                                    </option>
                                  ))
                                )}
                              </select>
                              <ChevronDown className="w-3.5 h-3.5 text-[#7d7484] pointer-events-none absolute right-0" />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Primary Action + Secondary Detail & WA */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!chosenInstallerName}
                          onClick={() => {
                            if (!chosenInstallerName) return;
                            onInlineAssign(t, chosenInstallerName);
                            setPendingInlineChoice(prev => {
                              const next = { ...prev };
                              delete next[t.id];
                              return next;
                            });
                          }}
                          className="btn-3d-primary flex-1 py-2.5 px-3 rounded-xl disabled:opacity-45 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>
                            {chosenFirstName ? `Assign Cepat ke ${chosenFirstName}` : 'Assign Teknisi'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onSelectTicket(t)}
                          className="btn-3d-secondary px-3 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Info className="w-3.5 h-3.5 text-[#58149c] dark:text-[#dab9ff]" />
                          <span>Detail</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onOpenWhatsAppModal(t)}
                          title="Kirim / pratinjau pesan WhatsApp"
                          className="btn-3d-icon-wa w-10 h-10 shrink-0 cursor-pointer"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-semibold text-[#b45309] dark:text-amber-300">
                        Menunggu penugasan Korlap
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectTicket(t)}
                        className="btn-3d-secondary px-3 py-2 rounded-xl font-bold text-xs cursor-pointer"
                      >
                        Detail
                      </button>
                    </div>
                  )
                ) : (
                  <div className="space-y-2 pt-0.5">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E]">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserCheck className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
                        <span className="text-xs font-bold text-[#1f1638] dark:text-white truncate">
                          {t.installerName}
                        </span>
                      </div>
                      {assignedTech && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold font-mono tabular-nums shrink-0 ${
                            assignedTech.isFull
                              ? 'bg-[#ba1a1a] text-white'
                              : 'bg-[#dcfce7] dark:bg-emerald-950/70 text-[#15803d] dark:text-emerald-300'
                          }`}
                        >
                          {assignedTech.assignedCount}/{assignedTech.maxLimit} Slot
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isLeaderRole && (
                        <button
                          type="button"
                          onClick={() => onOpenReassignModal(t)}
                          className="btn-3d-secondary flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-[#58149c] dark:text-[#dab9ff]" />
                          <span>Reassign</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectTicket(t)}
                        className="btn-3d-secondary flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Info className="w-3.5 h-3.5 text-[#58149c] dark:text-[#dab9ff]" />
                        <span>Detail</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenWhatsAppModal(t)}
                        title="Kirim pesan WhatsApp ke teknisi"
                        className="btn-3d-icon-wa w-9 h-9 shrink-0 cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* CLASSIC TABLE VIEW (PRESERVED WITH COLUMN CUSTOMIZER & EXPANDABLE ROWS) */
        <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#e8ddff] dark:border-[#3E246F] shadow-[0_2px_8px_rgba(31,22,56,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#35105E] text-white text-[11px] font-bold uppercase sticky top-0 z-10 border-b border-[#431599] [&_button]:text-white [&_button:hover]:text-[#E9D5FF] [&_svg]:text-white/90">
                <tr>{visibleColumns.map(col => renderHeaderCell(col))}</tr>
              </thead>
              <tbody className="divide-y divide-[#F1EDF7] dark:divide-[#2E1859]">
                {paginatedTickets.map(t => {
                  const { label, progressPercent } = classifyTicketOperational(t);
                  const isSelected = selectedTicketIds.includes(t.id);
                  const isExpanded = Boolean(expandedRowIds[t.id]);
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        className={`transition-colors hover:bg-[#F7F6FA] dark:hover:bg-[#261942] ${
                          isSelected ? 'bg-[#F5F1FF] dark:bg-[#2C1A4E]' : ''
                        }`}
                      >
                        {visibleColumns.map(col =>
                          renderBodyCell(col, t, isSelected, isExpanded, label, progressPercent)
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#F7F6FA] dark:bg-[#160D29]">
                          <td colSpan={visibleColumns.length} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                              <div className="space-y-1.5">
                                <span className="font-bold text-[#1f1638] dark:text-white block">
                                  Detail Lokasi &amp; Alamat Pelanggan
                                </span>
                                <div className="text-[#494453] dark:text-[#CBD5E1]">
                                  <strong>Alamat Lengkap:</strong> {t.streetName || '-'}
                                </div>
                                <div className="text-[#494453] dark:text-[#CBD5E1]">
                                  <strong>Patokan:</strong> {t.streetAlternatif || 'Tidak ada'}
                                </div>
                                <div className="text-[#494453] dark:text-[#CBD5E1]">
                                  <strong>Area &amp; Cluster:</strong> {t.area} · {t.clusterName || '-'}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openCustomerAddressInGoogleMaps(t)}
                                  className="btn-3d-secondary inline-flex items-center gap-1.5 px-3 py-1.5 mt-1 text-xs font-semibold text-[#58149c] rounded-lg cursor-pointer"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                  <span>Buka di Google Maps</span>
                                </button>
                              </div>

                              <div className="space-y-1 font-mono text-[11px] text-[#494453] dark:text-[#CBD5E1]">
                                <span className="font-bold text-[#1f1638] dark:text-white block font-sans text-xs">
                                  Data Jaringan &amp; Perangkat
                                </span>
                                <div>OLT / FDT Code: <strong>{t.fdtCode || '-'}</strong></div>
                                <div>FAT Code: <strong>{t.fatCode || '-'}</strong></div>
                                <div>Kategori: <strong>{t.ticketCategory}</strong></div>
                                <div>ONT: <strong>{t.ontBrand || '-'} / {t.ontModel || '-'}</strong></div>
                              </div>

                              <div className="space-y-1.5">
                                <span className="font-bold text-[#1f1638] dark:text-white block text-xs">
                                  Catatan &amp; Status Kerja (WIB)
                                </span>
                                <div className="p-2.5 rounded-lg bg-white dark:bg-[#1E1238] border border-[#e8ddff] dark:border-[#3E246F] text-[#494453] dark:text-[#CBD5E1] text-[11px] space-y-1">
                                  <div>{t.remarksWOInstaller || t.remarksAgent || 'Belum ada catatan.'}</div>
                                  <div className="pt-1 border-t border-[#F1EDF7] dark:border-[#3E246F] flex flex-wrap gap-3 font-mono text-[10.5px]">
                                    <span>Status: <strong>{getTicketWorkStatus(t).status}</strong></span>
                                    <span>Check-in: <strong>{t.checkInAt ? formatJakartaTimeOnly(t.checkInAt) : '-'}</strong></span>
                                    <span>Check-out: <strong>{t.checkOutAt ? formatJakartaTimeOnly(t.checkOutAt) : '-'}</strong></span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAGINATION FOOTER */}
      <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#e8ddff] dark:border-[#3E246F] overflow-hidden shadow-[0_2px_6px_rgba(31,22,56,0.03)]">
        <PaginationBar
          currentPage={currentPage}
          totalPages={rowsPerPage === -1 ? 1 : totalPages}
          totalItems={filteredTickets.length}
          pageSize={rowsPerPage === -1 ? 'ALL' : rowsPerPage}
          pageSizeOptions={[6, 10, 25, 50, 'ALL']}
          onPageChange={onPageChange}
          onPageSizeChange={size => onRowsPerPageChange(size === 'ALL' ? -1 : size)}
          itemLabel="Work Order"
          className="border-t-0"
        />
      </div>
    </div>
  );
};
