import React, { useState } from 'react';
import {
  Wand2,
  MapPin,
  MessageSquare,
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
  ChevronDown,
  AlertTriangle
} from 'lucide-react';
import { Ticket } from '../../types/index.ts';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { PaginationBar } from '../common/PaginationBar';
import { ColumnConfig } from './LeaderColumnSettingsModal';
import {
  HeaderCategoryDropdown,
  HeaderSearchPopover,
  TableResetFilterButton
} from '../common/InteractiveTableHeader';
import { TableSelectionToolbar } from '../common/TableSelectionToolbar';
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
  extraFilterCount?: number;
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
  isSubmittingAssign?: boolean;
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
      cls: 'bg-[#FFF2D9] dark:bg-amber-950/60 border border-[#F2CF95] dark:border-amber-700 text-[#9D661F] dark:text-amber-300'
    };
  }
  if (up === 'COMPLETED' || up === 'INSTALLED') {
    return {
      label: up,
      cls: 'bg-[#E4F5EC] dark:bg-emerald-950/60 border border-[#B7E4CC] dark:border-emerald-700 text-[#218A63] dark:text-emerald-300'
    };
  }
  if (up === 'ON SITE' || up === 'EN ROUTE' || up === 'IN PROGRESS') {
    return {
      label: up,
      cls: 'bg-[#EAE8FF] dark:bg-[#2E1B59] border border-[#DCE3F2] dark:border-[#5B35B1] text-[#5145A6] dark:text-[#dab9ff]'
    };
  }
  if (up === 'FAILED / CANCELLED' || up === 'PENDING TECHNICAL') {
    return {
      label: up,
      cls: 'bg-[#FCE9EB] dark:bg-rose-950/60 border border-[#F3C5CA] dark:border-rose-800 text-[#9B2C37] dark:text-rose-300'
    };
  }
  return {
    label: up,
    cls: 'bg-[#EAE8FF] dark:bg-[#2E1B59] border border-[#DCE3F2] dark:border-[#58149c]/50 text-[#5145A6] dark:text-[#dab9ff]'
  };
}

function getWhatsAppBadgeInfo(ticket: Ticket): { label: string; cls: string } {
  const raw = String(ticket.statusWhatsApp || '').toLowerCase();
  if (raw.includes('confirm')) {
    return {
      label: 'WA: CONFIRMED',
      cls: 'bg-[#E4F5EC] dark:bg-emerald-950/60 border border-[#B7E4CC] dark:border-[#16a36a]/30 text-[#218A63] dark:text-emerald-300'
    };
  }
  if (raw.includes('open') || raw.includes('read') || raw.includes('sent')) {
    return {
      label: 'WA: OPENED',
      cls: 'bg-[#E4F5EC] dark:bg-emerald-950/60 border border-[#B7E4CC] dark:border-[#16a36a]/30 text-[#218A63] dark:text-emerald-300'
    };
  }
  if (raw.includes('unreachable') || raw.includes('fail') || raw.includes('cancel')) {
    return {
      label: 'WA: UNREACHABLE',
      cls: 'bg-[#FCE9EB] dark:bg-rose-950/60 border border-[#F3C5CA] dark:border-[#ba1a1a]/30 text-[#9B2C37] dark:text-rose-300'
    };
  }
  if (raw.includes('reschedule')) {
    return {
      label: 'WA: RESCHEDULE',
      cls: 'bg-[#FFF2D9] dark:bg-amber-950/60 border border-[#F2CF95] dark:border-[#fcd34d] text-[#9D661F] dark:text-amber-300'
    };
  }
  return {
    label: 'WA: READY',
    cls: 'bg-[#DDF4F4] dark:bg-[#261942] border border-[#BDE4E8] dark:border-[#4b386b] text-[#2E7D8B] dark:text-[#dab9ff]'
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
  extraFilterCount = 0,
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
  isSubmittingAssign = false,
  onInlineAssign,
  onOpenReassignModal,
  onOpenWhatsAppModal,
  onSelectTicket,
  visibleColumns,
  renderHeaderCell,
  renderBodyCell,
  expandedRowIds,
  classifyTicketOperational,
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

  const unassignedTicketsOnPage = paginatedTickets.filter(t => !t.installerName);
  const allUnassignedChecked =
    unassignedTicketsOnPage.length > 0 &&
    unassignedTicketsOnPage.every(t => selectedTicketIds.includes(t.id));

  const techLookupMap = new Map<string, TechnicianCapacitySummary>();
  technicians.forEach(tech => {
    techLookupMap.set(tech.installer.name.toLowerCase().trim(), tech);
  });

  const effectiveViewMode: 'cards' | 'table' = isCompactUI ? 'cards' : 'table';

  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (slotFilter !== 'ALL' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (categoryFilter !== 'ALL' ? 1 : 0) +
    (clusterFilter !== 'ALL' ? 1 : 0) +
    (installerFilter !== 'ALL' ? 1 : 0) +
    extraFilterCount;
  const hasActiveFilters = activeFilterCount > 0;

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
      {/* CATEGORY FILTER CHIPS */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5">
        <button
          type="button"
          onClick={() => {
            onStatusFilterChange('all');
            if (onCategoryFilterChange) onCategoryFilterChange('ALL');
          }}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap shrink-0 cursor-pointer ${
            statusFilter === 'all' && categoryFilter === 'ALL'
              ? 'mj-btn-leader-secondary mj-btn-xs'
              : 'mj-btn-leader-neutral mj-btn-xs'
          }`}
        >
          <span>Semua Unassigned</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
              statusFilter === 'all' && categoryFilter === 'ALL'
                ? 'bg-white/20 text-white'
                : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff]'
            }`}
          >
            {unassignedCount}
          </span>
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
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap shrink-0 cursor-pointer ${
                isCatActive
                  ? 'mj-btn-leader-secondary mj-btn-xs'
                  : 'mj-btn-leader-neutral mj-btn-xs'
              }`}
            >
              <span>{cat.name}</span>
              <span className="font-mono text-[10.5px] tabular-nums opacity-85">{cat.count}</span>
            </button>
          );
        })}
      </div>

      {/* FILTER & CONTROLS BAR */}
      <div className="mj-enterprise-card rounded-2xl p-3.5 space-y-3">
        {/* SLOT GROUPING QUICK TABS */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 border-b border-[#DDE6F0] dark:border-[#35105E]">
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
                    : 'tactile-chip text-[#52647A] dark:text-[#CEC0E8]'
                }`}
              >
                <Clock className="w-3 h-3 opacity-85" />
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
                    isSlotActive
                      ? 'bg-white/20 text-white'
                      : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff]'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            {isCompactUI && (
              <>
                <HeaderSearchPopover
                  label="Cari WO"
                  value={searchQuery}
                  onChange={onSearchChange}
                  placeholder="Cari WO / ID / Alamat / ODP..."
                />
                <HeaderCategoryDropdown
                  label="Cluster"
                  value={clusterFilter}
                  defaultValue="ALL"
                  allLabel="Semua Cluster"
                  options={[
                    { value: 'ALL', label: 'Semua Cluster' },
                    ...clusterOptions.map(c => ({ value: c, label: c }))
                  ]}
                  onChange={onClusterFilterChange}
                />
              </>
            )}

            {installerFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EAE8FF] dark:bg-[#261942] border border-[#DCE3F2] dark:border-[#4B386B] text-[#5145A6] dark:text-[#dab9ff] font-semibold">
                <span>Filter Teknisi: {installerFilter}</span>
                <button
                  type="button"
                  onClick={() => onInstallerFilterChange('ALL')}
                  className="hover:text-[#9B2C37] dark:hover:text-[#ba1a1a] font-bold cursor-pointer"
                >
                  ×
                </button>
              </span>
            )}

            <TableResetFilterButton
              activeCount={activeFilterCount}
              onReset={onResetFilters}
              label="Reset Search/Filter"
              testId="leader-assign-reset-filters"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {isLeaderRole && (
              <button
                type="button"
                disabled={isSubmittingAssign}
                onClick={onExecuteAutoBalance}
                title="Auto-Balance Slot: distribusikan otomatis WO Unassigned sesuai slot waktu & sisa kuota terendah"
                className="mj-btn-leader-neutral mj-btn-compact px-3 py-1.5 text-[#5145A6] dark:text-[#dab9ff] cursor-pointer shrink-0 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold">Auto-Balance</span>
              </button>
            )}

            {effectiveViewMode === 'table' && (
              <>
                <button
                  type="button"
                  onClick={onExportCopy}
                  className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={onExportCSV}
                  className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={onExportExcel}
                  className="mj-btn-leader-success mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={onPrint}
                  className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3 h-3" />
                  <span>Print</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* ACTIVE PAGE QUICK SELECT ROW (Cards view or quick check) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#3E246F] text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-[#26364A] dark:text-white">
            <input
              type="checkbox"
              checked={allUnassignedChecked}
              disabled={unassignedTicketsOnPage.length === 0}
              onChange={e => onSelectAllUnassigned(e.target.checked)}
              className="w-4 h-4 accent-[#6657C8] dark:accent-[#58149c] rounded border-[#DDE6F0] cursor-pointer"
            />
            <span>
              Pilih Semua Unassigned Halaman Ini ({unassignedTicketsOnPage.length} WO)
            </span>
          </label>
          {!isLeaderRole && (
            <span className="px-2.5 py-1 rounded-lg bg-[#EDF3F8] dark:bg-[#261942] border border-[#DDE6F0] dark:border-[#4B386B] text-[11px] font-semibold text-[#8492A5] dark:text-[#A79BC0]">
              Mode Monitoring Read-Only (Write eksklusif Leader)
            </span>
          )}
        </div>
      </div>

      {/* CONTEXTUAL BULK SELECTION TOOLBAR (Rendered ONLY when >= 1 WO selected) */}
      <TableSelectionToolbar
        selectedCount={selectedTicketIds.length}
        itemLabel="WO"
        onClearSelection={onClearSelection}
      >
        {isLeaderRole && (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <select
              value={bulkQuickInstaller}
              onChange={e => onBulkQuickInstallerChange(e.target.value)}
              className="px-3 py-2 sm:py-1.5 bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#4B386B] rounded-xl text-xs font-medium text-[#26364A] dark:text-white w-full sm:w-auto sm:min-w-[180px] focus:outline-hidden focus:border-[#6657C8] dark:focus:border-[#58149c]"
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
              disabled={!bulkQuickInstaller || selectedTicketIds.length === 0 || isSubmittingAssign}
              onClick={onExecuteBulkQuickAssign}
              className="mj-btn-leader-primary mj-btn-compact px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>{isSubmittingAssign ? 'Menyimpan...' : 'Tugaskan'}</span>
            </button>
          </div>
        )}
      </TableSelectionToolbar>

      {/* BODY: EMPTY STATE OR STITCH CARDS OR CLASSIC TABLE */}
      {filteredTickets.length === 0 ? (
        <div className="mj-enterprise-card rounded-2xl p-10 text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-[#EAE8FF] dark:bg-[#2E1B59] text-[#5145A6] dark:text-[#dab9ff] flex items-center justify-center mx-auto">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-[#26364A] dark:text-white">
              Tidak ada Work Order yang cocok dengan filter aktif
            </h4>
            <p className="text-xs text-[#8492A5] dark:text-[#A79BC0] mt-1">
              Coba ubah filter Slot Waktu, Status, Kategori, atau kata kunci pencarian Anda.
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="mj-btn-leader-primary px-4 py-2 text-xs cursor-pointer"
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
                className={`rounded-2xl p-4 transition-all flex flex-col justify-between gap-3 shadow-[0_3px_12px_rgba(38,54,74,0.05)] ${
                  isSelected
                    ? 'border-[1.5px] border-[#6657C8] dark:border-[#58149c] ring-2 ring-[#B7ACEB]/70 dark:ring-[#dab9ff]/70 bg-[#F4F7FB] dark:bg-[#27184A]'
                    : isUnassigned
                    ? 'border border-[#DDE6F0] dark:border-[#4b386b] bg-white dark:bg-[#1E1238] hover:border-[#6657C8] dark:hover:border-[#a380fe]'
                    : 'border border-[#DDE6F0] dark:border-[#3E246F] bg-white dark:bg-[#1E1238] hover:border-[#B7ACEB] dark:hover:border-[#d0bcff]'
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
                        className="w-4 h-4 accent-[#6657C8] dark:accent-[#58149c] rounded border-[#DCE3F2] dark:border-[#cec3d4] cursor-pointer shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => onSelectTicket(t)}
                        className="font-mono font-extrabold text-[13.5px] text-[#26364A] dark:text-white hover:text-[#5145A6] dark:hover:text-[#dab9ff] hover:underline tabular-nums cursor-pointer"
                      >
                        {t.woNumber}
                      </button>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isUrgentOrIncident
                            ? 'bg-[#FCE9EB] dark:bg-rose-950/70 text-[#9B2C37] dark:text-rose-300'
                            : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff]'
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
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#CEC0E8] font-semibold tabular-nums">
                      <Clock className="w-3 h-3 text-[#5145A6] dark:text-[#dab9ff]" />
                      {slotBadgeLabel}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${waBadge.cls}`}>
                      {waBadge.label}
                    </span>
                  </div>
                </div>

                {/* Optional Real OTDR/OPM Telemetry Bar (Only shown if real OPM exists in DB) */}
                {realOpm !== undefined && realOpm !== null && String(realOpm).trim() !== '' && (
                  <div className="rounded-xl bg-gradient-to-br from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:bg-none dark:bg-[#120924] text-[#26364A] dark:text-white border border-[#BDE4E8] dark:border-[#35105E] p-3 space-y-1">
                    <div className="flex items-center justify-between text-[10.5px] font-mono">
                      <span className="flex items-center gap-1.5 font-bold text-[#9D661F] dark:text-amber-300 uppercase">
                        <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400" />
                        OPM TELEMETRY TERCATAT
                      </span>
                      <span className="font-extrabold text-[#9D661F] dark:text-amber-300 tabular-nums">
                        {String(realOpm).includes('dBm') ? realOpm : `${realOpm} dBm`}
                      </span>
                    </div>
                    {(t.remarksWOInstaller || t.technicalReport?.technicalDescription) && (
                      <p className="text-[11px] text-[#52647A] dark:text-[#e8ddff] line-clamp-2">
                        {t.remarksWOInstaller || t.technicalReport?.technicalDescription}
                      </p>
                    )}
                  </div>
                )}

                {Array.isArray(t.kendalaReports) && t.kendalaReports.length > 0 && (
                  <div className="rounded-xl bg-[#FFFDF7] dark:bg-amber-950/30 border border-[#F2CF95] dark:border-amber-800/50 p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[10.5px]">
                      <span className="inline-flex items-center gap-1 font-bold text-[#9D661F] dark:text-amber-300 uppercase">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Kendala Lapangan ({t.kendalaReports.length})</span>
                      </span>
                      <span className="font-mono text-[10px] text-[#8492A5] dark:text-amber-200/80">
                        {t.kendalaReports[0]?.createdAt ? `${formatJakartaTimeOnly(t.kendalaReports[0].createdAt)} WIB` : ''}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#26364A] dark:text-amber-100 line-clamp-2">
                      {t.kendalaReports[0]?.description}
                    </p>
                  </div>
                )}

                {/* Customer & Network Info Card */}
                <div className="bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl p-3 border border-[#DDE6F0] dark:border-[#35105E] space-y-2">
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1B59] text-[#5145A6] dark:text-[#dab9ff] font-extrabold text-xs flex items-center justify-center shrink-0">
                        {getCustomerInitials(t.customerName)}
                      </div>
                      <div className="min-w-0">
                        <div
                          className="font-bold text-[13.5px] text-[#26364A] dark:text-white truncate"
                          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                        >
                          {t.customerName}
                        </div>
                        <div className="text-[11px] font-mono text-[#8492A5] dark:text-[#CEC0E8] truncate tabular-nums">
                          ID: {t.idCustomer || t.customerId || '-'} · {t.customerPhone || '-'}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenWhatsAppModal(t)}
                      title="Hubungi / Kirim Notifikasi WhatsApp"
                      className="mj-btn-icon-3d-leader w-9 h-9 shrink-0 cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => openCustomerAddressInGoogleMaps(t)}
                    className="w-full flex items-start gap-1.5 text-[11.5px] text-[#52647A] dark:text-[#CEC0E8] hover:text-[#5145A6] dark:hover:text-[#dab9ff] text-left group cursor-pointer"
                    title="Buka alamat pelanggan di Google Maps"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff] shrink-0 mt-0.5" />
                    <span className="line-clamp-2 group-hover:underline">
                      {[t.streetName, t.clusterName, t.area].filter(Boolean).join(', ') || 'Alamat belum tercatat'}
                    </span>
                  </button>

                  {/* ODP / FAT Network Strip */}
                  {(t.fdtCode || t.fatCode || t.remarksAgent) && (
                    <div className="pt-1.5 border-t border-[#DDE6F0] dark:border-[#35105E] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 font-mono font-bold text-[#26364A] dark:text-[#e8ddff]">
                        <GitBranch className="w-3 h-3 text-[#5145A6] dark:text-[#dab9ff]" />
                        {t.fatCode || t.fdtCode || 'ODP/FAT -'}
                      </span>
                      {t.fdtCode && t.fatCode && (
                        <span className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#CEC0E8]">
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
                      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#160D29] border border-[#DCE3F2] dark:border-[#4b386b]">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="w-7 h-7 rounded-full bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff] flex items-center justify-center shrink-0">
                            <UserCheck className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-[#5145A6] dark:text-[#dab9ff] uppercase">
                                {pendingInlineChoice[t.id] ? 'Teknisi Dipilih' : 'Rekomendasi Slot'}
                              </span>
                              {chosenTechObj && (
                                <span className="text-[10px] font-mono font-bold text-[#218A63] dark:text-emerald-400 tabular-nums">
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
                                className="w-full appearance-none bg-transparent pr-5 py-0.5 font-bold text-xs text-[#26364A] dark:text-white focus:outline-hidden cursor-pointer truncate"
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
                              <ChevronDown className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#7d7484] pointer-events-none absolute right-0" />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Primary Action + Secondary Detail & WA */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!chosenInstallerName || isSubmittingAssign}
                          onClick={() => {
                            if (!chosenInstallerName || isSubmittingAssign) return;
                            onInlineAssign(t, chosenInstallerName);
                            setPendingInlineChoice(prev => {
                              const next = { ...prev };
                              delete next[t.id];
                              return next;
                            });
                          }}
                          className="mj-btn-leader-primary flex-1 py-2.5 px-3 text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>
                            {isSubmittingAssign
                              ? 'Menyimpan...'
                              : chosenFirstName
                              ? `Assign Cepat ke ${chosenFirstName}`
                              : 'Assign Teknisi'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onSelectTicket(t)}
                          className="mj-btn-leader-neutral mj-btn-compact px-3 py-2 text-xs flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Info className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                          <span>Detail</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onOpenWhatsAppModal(t)}
                          title="Kirim / pratinjau pesan WhatsApp"
                          className="mj-btn-icon-3d-wa w-10 h-10 shrink-0 cursor-pointer"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-semibold text-[#9D661F] dark:text-amber-300">
                        Menunggu penugasan Korlap
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectTicket(t)}
                        className="mj-btn-leader-neutral mj-btn-compact px-3 py-2 text-xs cursor-pointer"
                      >
                        Detail
                      </button>
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-semibold text-[#8492A5] dark:text-[#CEC0E8]">
                      Sudah memiliki penugasan teknisi (kelola di Reassign WO)
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectTicket(t)}
                      className="mj-btn-leader-neutral mj-btn-compact px-3 py-2 text-xs cursor-pointer"
                    >
                      Detail
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* CLASSIC TABLE VIEW (PRESERVED WITH COLUMN CUSTOMIZER & EXPANDABLE ROWS) */
        <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] shadow-[0_2px_8px_rgba(38,54,74,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse mj-zebra-table">
              <thead className="bg-[#EDF3F8] dark:bg-[#35105E] text-[#52647A] dark:text-white text-[11px] font-bold uppercase sticky top-0 z-10 border-b border-[#DDE6F0] dark:border-[#431599] [&_button]:text-[#26364A] dark:[&_button]:text-white [&_button:hover]:text-[#5145A6] dark:[&_button:hover]:text-[#E9D5FF] [&_svg]:text-[#5145A6]/90 dark:[&_svg]:text-white/90">
                <tr>{visibleColumns.map(col => renderHeaderCell(col))}</tr>
              </thead>
              <tbody className="divide-y divide-[#DDE6F0] dark:divide-[#2E1859]">
                {paginatedTickets.map(t => {
                  const { label, progressPercent } = classifyTicketOperational(t);
                  const isSelected = selectedTicketIds.includes(t.id);
                  const isExpanded = Boolean(expandedRowIds[t.id]);
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        className={`transition-colors hover:bg-[#EDF3F8] dark:hover:bg-[#261942] ${
                          isSelected ? 'bg-[#EAE8FF] dark:bg-[#2C1A4E]' : ''
                        }`}
                      >
                        {visibleColumns.map(col =>
                          renderBodyCell(col, t, isSelected, isExpanded, label, progressPercent)
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#F4F7FB] dark:bg-[#160D29]">
                          <td colSpan={visibleColumns.length} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                              <div className="space-y-1.5">
                                <span className="font-bold text-[#26364A] dark:text-white block">
                                  Detail Lokasi &amp; Alamat Pelanggan
                                </span>
                                <div className="text-[#52647A] dark:text-[#CBD5E1]">
                                  <strong>Alamat Lengkap:</strong> {t.streetName || '-'}
                                </div>
                                <div className="text-[#52647A] dark:text-[#CBD5E1]">
                                  <strong>Patokan:</strong> {t.streetAlternatif || 'Tidak ada'}
                                </div>
                                <div className="text-[#52647A] dark:text-[#CBD5E1]">
                                  <strong>Area &amp; Cluster:</strong> {t.area} · {t.clusterName || '-'}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openCustomerAddressInGoogleMaps(t)}
                                  className="mj-btn-leader-neutral mj-btn-compact inline-flex items-center gap-1.5 px-3 py-1.5 mt-1 text-xs text-[#5145A6] dark:text-[#dab9ff] rounded-lg cursor-pointer"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                  <span>Buka di Google Maps</span>
                                </button>
                              </div>

                              <div className="space-y-1 font-mono text-[11px] text-[#52647A] dark:text-[#CBD5E1]">
                                <span className="font-bold text-[#26364A] dark:text-white block font-sans text-xs">
                                  Data Jaringan &amp; Perangkat
                                </span>
                                <div>OLT / FDT Code: <strong>{t.fdtCode || '-'}</strong></div>
                                <div>FAT Code: <strong>{t.fatCode || '-'}</strong></div>
                                <div>Kategori: <strong>{t.ticketCategory}</strong></div>
                                <div>ONT: <strong>{t.ontBrand || '-'} / {t.ontModel || '-'}</strong></div>
                              </div>

                              <div className="space-y-1.5">
                                <span className="font-bold text-[#26364A] dark:text-white block text-xs">
                                  Catatan &amp; Status Kerja (WIB)
                                </span>
                                <div className="p-2.5 rounded-lg bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#3E246F] text-[#52647A] dark:text-[#CBD5E1] text-[11px] space-y-1">
                                  <div>{t.remarksWOInstaller || t.remarksAgent || 'Belum ada catatan.'}</div>
                                  <div className="pt-1 border-t border-[#DDE6F0] dark:border-[#3E246F] flex flex-wrap gap-3 font-mono text-[10.5px]">
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
      <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3E246F] overflow-hidden shadow-[0_2px_6px_rgba(38,54,74,0.03)]">
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
