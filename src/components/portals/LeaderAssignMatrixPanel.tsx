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
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  Printer,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { Ticket, User } from '../../types/index.ts';
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
  filteredTickets: Ticket[];
  paginatedTickets: Ticket[];
  unassignedCount: number;
  assignedCount: number;
  inProgressCount: number;
  completedCount: number;
  pendingCount: number;
  problemCount: number;
  clusterOptions: string[];
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

function getAgentBadgeInfo(ticket: Ticket): { label: string; cls: string } {
  const s = String(ticket.statusWOAgent || '').trim();
  const up = s.toUpperCase() || (ticket.installerName ? 'ASSIGNED' : 'PENDING');
  if (up === 'CLOSED' || up === 'RESOLVED') {
    return { label: `AGENT: ${up}`, cls: 'bg-[#DCFCE7] text-[#15803D]' };
  }
  if (up === 'ASSIGNED' || up === 'IN PROGRESS') {
    return { label: `AGENT: ${up}`, cls: 'bg-[#E0F2FE] text-[#0369A1]' };
  }
  if (up === 'CANCELLED') {
    return { label: `AGENT: ${up}`, cls: 'bg-[#FEE2E2] text-[#DC4C5A]' };
  }
  return { label: `AGENT: ${up}`, cls: 'bg-[#FEF3C7] text-[#B45309]' };
}

function getInstallerBadgeInfo(ticket: Ticket): { label: string; cls: string } {
  const s = String(ticket.statusWOInstaller || 'Unassigned').trim();
  const up = s.toUpperCase();
  if (!ticket.installerName || up === 'UNASSIGNED') {
    return { label: 'FIELD: UNASSIGNED', cls: 'bg-[#F7F6FA] border border-[#E9E5F0] text-[#766B83]' };
  }
  if (up === 'COMPLETED') {
    return { label: `INSTALLER: ${up}`, cls: 'bg-[#16A36A] border border-[#16A36A] text-white' };
  }
  if (up === 'INSTALLED') {
    return { label: `INSTALLER: ${up}`, cls: 'bg-[#DCFCE7] border border-[#16A36A]/30 text-[#15803D]' };
  }
  if (up === 'ON SITE' || up === 'EN ROUTE' || up === 'IN PROGRESS') {
    return { label: `INSTALLER: ${up}`, cls: 'bg-[#F4EAFF] border border-[#D8CCF3] text-[#431599]' };
  }
  if (up === 'FAILED / CANCELLED' || up === 'PENDING TECHNICAL') {
    return { label: `INSTALLER: ${up}`, cls: 'bg-[#FEF2F2] border border-[#DC4C5A]/30 text-[#DC4C5A]' };
  }
  return { label: `INSTALLER: ${up}`, cls: 'bg-[#EFF6FF] border border-[#3977C9]/30 text-[#3977C9]' };
}

function getWhatsAppBadgeInfo(ticket: Ticket): { label: string; cls: string } {
  const raw = String(ticket.statusWhatsApp || '').toLowerCase();
  if (raw.includes('confirm')) {
    return { label: 'WA: CONFIRMED', cls: 'bg-[#ECFDF5] border border-[#16A36A]/30 text-[#16A36A]' };
  }
  if (raw.includes('open') || raw.includes('read') || raw.includes('sent')) {
    return { label: 'WA: OPENED', cls: 'bg-[#ECFDF5] border border-[#16A36A]/30 text-[#15803D]' };
  }
  if (raw.includes('unreachable') || raw.includes('fail') || raw.includes('cancel')) {
    return { label: 'WA: UNREACHABLE', cls: 'bg-[#FEF2F2] border border-[#DC4C5A]/30 text-[#DC4C5A]' };
  }
  if (raw.includes('reschedule')) {
    return { label: 'WA: RESCHEDULE', cls: 'bg-[#FEF3C7] border border-[#E59A27]/40 text-[#B45309]' };
  }
  return { label: 'WA: READY', cls: 'bg-[#FEF3C7] border border-[#E59A27]/40 text-[#B45309]' };
}

function getApprovalBadgeInfo(ticket: Ticket): { label: string; cls: string; pulse?: boolean } {
  const latestReport =
    Array.isArray(ticket.progressReports) && ticket.progressReports.length > 0
      ? ticket.progressReports[ticket.progressReports.length - 1]
      : undefined;
  const approval = String(ticket.approvalStatus || latestReport?.approvalStatus || '').toUpperCase();
  const statusReport = String(latestReport?.reportStatus || ticket.reportStatusLabel || '').toUpperCase();
  if (
    approval === 'APPROVED' ||
    ticket.technicalReport?.verifiedBy ||
    statusReport === 'APPROVED' ||
    ticket.statusWOAgent === 'Closed' ||
    ticket.statusWOInstaller === 'Completed'
  ) {
    return { label: 'APPROVED', cls: 'bg-[#ECFDF5] border border-[#16A36A]/35 text-[#15803D]' };
  }
  if (approval === 'REJECTED') {
    return { label: 'REJECTED · REVISI', cls: 'bg-[#FEF2F2] border border-[#DC4C5A]/40 text-[#DC4C5A]' };
  }
  if (approval === 'REVISI') {
    return { label: 'PERLU REVISI', cls: 'bg-[#FFF7ED] border border-[#F97316]/40 text-[#C2410C]' };
  }
  if (
    approval === 'BUTUH APPROVAL' ||
    statusReport === 'WAITING_DISPATCH_REVIEW' ||
    Boolean(ticket.technicalReport)
  ) {
    return { label: 'BUTUH APPROVAL', cls: 'bg-[#FEF3C7] border border-[#E59A27]/50 text-[#92400E]', pulse: true };
  }
  if (ticket.installerName) {
    return { label: 'APPROVED', cls: 'bg-[#ECFDF5] border border-[#16A36A]/35 text-[#15803D]' };
  }
  return { label: 'BUTUH APPROVAL', cls: 'bg-[#FEF3C7] border border-[#E59A27]/50 text-[#92400E]', pulse: true };
}

export const LeaderAssignMatrixPanel: React.FC<LeaderAssignMatrixPanelProps> = ({
  totalScopedCount,
  filteredTickets,
  paginatedTickets,
  unassignedCount,
  assignedCount,
  inProgressCount,
  completedCount,
  pendingCount,
  problemCount,
  clusterOptions,
  technicians,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  slotFilter,
  onSlotFilterChange,
  statusFilter,
  onStatusFilterChange,
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
  // Local inline dropdown selections per unassigned ticket card before clicking "Tugaskan Sekarang"
  const [pendingInlineChoice, setPendingInlineChoice] = useState<Record<string, string>>({});

  const unassignedTicketsInView = filteredTickets.filter(t => !t.installerName);
  const allUnassignedChecked =
    unassignedTicketsInView.length > 0 &&
    unassignedTicketsInView.every(t => selectedTicketIds.includes(t.id));

  const techLookupMap = new Map<string, TechnicianCapacitySummary>();
  technicians.forEach(tech => {
    techLookupMap.set(tech.installer.name.toLowerCase().trim(), tech);
  });

  const startIdx = filteredTickets.length > 0 ? (rowsPerPage === -1 ? 1 : (currentPage - 1) * rowsPerPage + 1) : 0;
  const endIdx = rowsPerPage === -1 ? filteredTickets.length : Math.min(currentPage * rowsPerPage, filteredTickets.length);

  // Page numbers window
  const pageNumbers: number[] = [];
  const maxPageButtons = 5;
  let startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + maxPageButtons - 1);
  if (endPage - startPage + 1 < maxPageButtons) {
    startPage = Math.max(1, endPage - maxPageButtons + 1);
  }
  for (let p = startPage; p <= endPage; p++) pageNumbers.push(p);

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    slotFilter !== 'ALL' ||
    statusFilter !== 'all' ||
    clusterFilter !== 'ALL' ||
    installerFilter !== 'ALL';

  return (
    <div className="space-y-3.5">
      {/* FILTER & CONTROLS BAR */}
      <div className="bg-white rounded-2xl border border-[#E9E5F0] p-3.5 shadow-[0_1px_4px_rgba(31,24,44,0.04)] space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[#8B8495] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Cari WO / ID Pelanggan..."
              className="w-full pl-8.5 pr-3 py-2 bg-[#F7F6FA] border border-[#E9E5F0] rounded-xl text-xs text-[#211A2E] placeholder:text-[#8B8495] focus:outline-hidden focus:border-[#7135B5]"
            />
          </div>

          {/* Slot Waktu Filter */}
          <select
            value={slotFilter}
            onChange={e => onSlotFilterChange(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E9E5F0] rounded-xl text-xs font-semibold text-[#211A2E] focus:outline-hidden focus:border-[#7135B5] cursor-pointer"
          >
            <option value="ALL">Semua Slot Waktu</option>
            <option value="1">Slot 1 (09:00 - 11:00)</option>
            <option value="2">Slot 2 (11:00 - 13:00)</option>
            <option value="3">Slot 3 (13:00 - 15:00)</option>
            <option value="4">Slot 4 (15:00 - 17:00)</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => onStatusFilterChange(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E9E5F0] rounded-xl text-xs font-semibold text-[#211A2E] focus:outline-hidden focus:border-[#7135B5] cursor-pointer"
          >
            <option value="all">Semua Status ({totalScopedCount})</option>
            <option value="unassigned">Unassigned ({unassignedCount})</option>
            <option value="assigned">Assigned ({assignedCount})</option>
            <option value="in_progress">Sedang Dikerjakan ({inProgressCount})</option>
            <option value="completed">Selesai ({completedCount})</option>
            <option value="pending">Tertunda ({pendingCount})</option>
            <option value="problem">Bermasalah ({problemCount})</option>
          </select>

          {/* Sub-Cluster Filter */}
          <select
            value={clusterFilter}
            onChange={e => onClusterFilterChange(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E9E5F0] rounded-xl text-xs font-semibold text-[#211A2E] focus:outline-hidden focus:border-[#7135B5] cursor-pointer max-w-[180px]"
          >
            <option value="ALL">Semua Sub-Cluster</option>
            {clusterOptions.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* View Mode Toggle: Card Matrix vs Table View */}
          <div className="inline-flex items-center rounded-xl border border-[#E9E5F0] bg-[#F7F6FA] p-0.5 ml-auto shrink-0">
            <button
              type="button"
              onClick={() => onViewModeChange('cards')}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'cards'
                  ? 'bg-[#431599] text-white shadow-xs'
                  : 'text-[#766B83] hover:text-[#211A2E]'
              }`}
              title="Tampilan Kartu Matrix Stitch"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Matrix</span>
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('table')}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'table'
                  ? 'bg-[#431599] text-white shadow-xs'
                  : 'text-[#766B83] hover:text-[#211A2E]'
              }`}
              title="Tampilan Tabel Klasik"
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Tabel</span>
            </button>
          </div>
        </div>

        {/* Active Installer Filter indicator + Table Extra Controls */}
        {(installerFilter !== 'ALL' || hasActiveFilters || viewMode === 'table') && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F1EDF7] text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              {installerFilter !== 'ALL' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F5F1FF] border border-[#D8CCF3] text-[#431599] font-semibold">
                  <span>Filter Teknisi: {installerFilter}</span>
                  <button
                    type="button"
                    onClick={() => onInstallerFilterChange('ALL')}
                    className="hover:text-[#DC4C5A] font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </span>
              )}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E9E5F0] text-[#766B83] hover:text-[#211A2E] hover:bg-[#F7F6FA] font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Filter</span>
                </button>
              )}
            </div>

            {viewMode === 'table' && (
              <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={onExportCopy}
                  className="px-2 py-1 rounded-lg border border-[#E9E5F0] hover:bg-[#F7F6FA] text-[#494453] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={onExportCSV}
                  className="px-2 py-1 rounded-lg border border-[#E9E5F0] hover:bg-[#F7F6FA] text-[#494453] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={onExportExcel}
                  className="px-2 py-1 rounded-lg border border-[#E9E5F0] hover:bg-[#F7F6FA] text-[#15803D] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={onPrint}
                  className="px-2 py-1 rounded-lg border border-[#E9E5F0] hover:bg-[#F7F6FA] text-[#494453] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3 h-3" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenColumnSettings}
                  className="px-2.5 py-1 rounded-lg border border-[#D8CCF3] bg-[#F5F1FF] text-[#431599] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Atur Kolom</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* BULK SELECTION & AUTO-BALANCE ROW */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-[#E9E5F0] text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-[#211A2E]">
              <input
                type="checkbox"
                checked={allUnassignedChecked}
                disabled={unassignedTicketsInView.length === 0}
                onChange={e => onSelectAllUnassigned(e.target.checked)}
                className="w-4 h-4 accent-[#431599] rounded border-[#CBC3D5] cursor-pointer"
              />
              <span>
                Pilih Semua Unassigned ({unassignedTicketsInView.length} WO)
              </span>
            </label>

            {selectedTicketIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#431599] tabular-nums">
                  {selectedTicketIds.length} WO Terpilih
                </span>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="text-[11px] text-[#766B83] hover:text-[#DC4C5A] underline cursor-pointer"
                >
                  Batal
                </button>
              </div>
            )}
          </div>

          {isLeaderRole ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkQuickInstaller}
                onChange={e => onBulkQuickInstallerChange(e.target.value)}
                className="px-3 py-1.5 bg-[#F7F6FA] border border-[#E9E5F0] rounded-xl text-xs font-medium text-[#211A2E] min-w-[180px] focus:outline-hidden focus:border-[#7135B5]"
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
                className="px-3.5 py-1.5 rounded-xl bg-[#2A1459] hover:bg-[#431599] disabled:opacity-45 text-white font-bold text-xs transition-colors cursor-pointer whitespace-nowrap"
              >
                Tugaskan
              </button>

              <button
                type="button"
                onClick={onExecuteAutoBalance}
                title="Auto-Balance Slot: distribusikan otomatis WO Unassigned sesuai slot waktu & sisa kuota terendah"
                className="p-2 rounded-xl border border-[#D8CCF3] bg-[#F5F1FF] hover:bg-[#EDE9FE] text-[#431599] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-[11px] font-bold">Auto-Balance</span>
              </button>
            </div>
          ) : (
            <span className="px-2.5 py-1 rounded-lg bg-[#F7F6FA] border border-[#E9E5F0] text-[11px] font-semibold text-[#766B83]">
              Mode Monitoring Read-Only (Write eksklusif Leader)
            </span>
          )}
        </div>
      </div>

      {/* BODY: EMPTY STATE OR CARDS MATRIX OR CLASSIC TABLE */}
      {filteredTickets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E9E5F0] p-10 text-center space-y-3 shadow-[0_1px_4px_rgba(31,24,44,0.04)]">
          <div className="w-11 h-11 rounded-2xl bg-[#F5F1FF] text-[#5B35B1] flex items-center justify-center mx-auto">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-[#211A2E]">
              Tidak ada Work Order yang cocok dengan filter aktif
            </h4>
            <p className="text-xs text-[#766B83] mt-1">
              Coba ubah filter Slot Waktu, Status, Sub-Cluster, atau kata kunci pencarian Anda.
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="px-4 py-2 rounded-xl bg-[#431599] text-white font-bold text-xs hover:bg-[#35105E] cursor-pointer"
            >
              Tampilkan Semua WO Hari Ini
            </button>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        /* STITCH CARD MATRIX LIST */
        <div className="space-y-3">
          {paginatedTickets.map(t => {
            const isSelected = selectedTicketIds.includes(t.id);
            const isUnassigned = !t.installerName;
            const agentBadge = getAgentBadgeInfo(t);
            const instBadge = getInstallerBadgeInfo(t);
            const waBadge = getWhatsAppBadgeInfo(t);
            const approvalBadge = getApprovalBadgeInfo(t);
            const slotIdx = normalizeSlotIndex(t.slotTime);
            const slotBadgeLabel = formatSlotBadgeLabel(t.slotTime);

            const assignedTech = t.installerName
              ? techLookupMap.get(t.installerName.toLowerCase().trim())
              : undefined;

            const currentInlineChoice = pendingInlineChoice[t.id] || '';

            // Eligible techs prioritizing free slot for this WO's time window
            const sortedInlineCandidates = [...technicians].sort((a, b) => {
              const aSlotFree = slotIdx
                ? a.slots.find(s => s.slotIndex === slotIdx)?.state === 'free'
                : !a.isFull;
              const bSlotFree = slotIdx
                ? b.slots.find(s => s.slotIndex === slotIdx)?.state === 'free'
                : !b.isFull;
              if (aSlotFree !== bSlotFree) return aSlotFree ? -1 : 1;
              return a.assignedCount - b.assignedCount;
            });

            return (
              <div
                key={t.id}
                className={`bg-white rounded-2xl border p-4 transition-all shadow-[0_1px_4px_rgba(31,24,44,0.03)] ${
                  isSelected
                    ? 'border-[#5B35B1] ring-1 ring-[#D8B4FE] bg-[#FCF9FF]'
                    : 'border-[#E9E5F0] hover:border-[#D8CCF3]'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Selection Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelectTicket(t.id)}
                    className="mt-1 w-4 h-4 accent-[#431599] rounded border-[#CBC3D5] cursor-pointer shrink-0"
                  />

                  {/* Main Card Grid */}
                  <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                    {/* Left Column: WO Meta + Customer + Address */}
                    <div className="lg:col-span-5 space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectTicket(t)}
                          className="font-mono font-bold text-[12px] text-[#211A2E] hover:text-[#431599] hover:underline tabular-nums cursor-pointer"
                        >
                          {t.woNumber}
                        </button>
                        <span className="px-2 py-0.5 rounded-md bg-[#F5F1FF] border border-[#E9DDFF] text-[#431599] text-[10.5px] font-bold">
                          {t.ticketCategory || 'FTTH'}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-[#E0F2FE] text-[#1D4ED8] text-[10.5px] font-bold tabular-nums">
                          {slotBadgeLabel}
                        </span>
                        {isUnassigned && (
                          <span className="px-2 py-0.5 rounded-md bg-[#FEF3C7] text-[#B45309] text-[10px] font-extrabold uppercase tracking-wide">
                            UNASSIGNED
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span
                          className="font-bold text-[14px] text-[#211A2E] truncate"
                          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                        >
                          {t.customerName}
                        </span>
                        <span className="text-[11px] font-mono text-[#766B83] shrink-0 tabular-nums">
                          (ID: {t.idCustomer || t.customerId || '-'})
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => openCustomerAddressInGoogleMaps(t)}
                        className="flex items-center gap-1 text-[11.5px] text-[#766B83] hover:text-[#431599] text-left group max-w-full cursor-pointer"
                        title="Buka alamat pelanggan di Google Maps"
                      >
                        <MapPin className="w-3.5 h-3.5 text-[#8B8495] group-hover:text-[#431599] shrink-0" />
                        <span className="truncate group-hover:underline">
                          {[t.streetName, t.clusterName, t.area].filter(Boolean).join(', ') || '-'}
                        </span>
                      </button>
                    </div>

                    {/* Right Column: 4-Dimension Badges + Action Controls */}
                    <div className="lg:col-span-7 flex flex-col justify-between gap-2.5 lg:items-end">
                      {/* 4 Operational Dimension Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide tabular-nums ${agentBadge.cls}`}>
                          {agentBadge.label}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide tabular-nums ${instBadge.cls}`}>
                          {instBadge.label}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide tabular-nums ${waBadge.cls}`}>
                          {waBadge.label}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide tabular-nums ${approvalBadge.cls}`}>
                          {approvalBadge.pulse && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#E59A27] animate-pulse" />
                          )}
                          <span>{approvalBadge.label}</span>
                        </span>
                      </div>

                      {/* Assignment Controls Row */}
                      {isUnassigned ? (
                        <div className="w-full flex flex-wrap items-center gap-2 lg:justify-end">
                          {isLeaderRole ? (
                            <>
                              <select
                                value={currentInlineChoice}
                                onChange={e =>
                                  setPendingInlineChoice(prev => ({
                                    ...prev,
                                    [t.id]: e.target.value
                                  }))
                                }
                                className="flex-1 min-w-[190px] max-w-[260px] px-2.5 py-1.5 bg-[#F7F6FA] border border-[#E9E5F0] rounded-xl text-xs font-medium text-[#211A2E] focus:outline-hidden focus:border-[#5B35B1]"
                              >
                                <option value="">
                                  Pilih Teknisi Siaga {slotIdx ? `Slot ${slotIdx}` : ''}...
                                </option>
                                {sortedInlineCandidates.map(tech => (
                                  <option key={tech.installer.id} value={tech.installer.name}>
                                    {tech.installer.name} ({tech.assignedCount}/{tech.maxLimit} Slot)
                                    {tech.isFull ? ' - PENUH' : ''}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!currentInlineChoice}
                                onClick={() => {
                                  if (!currentInlineChoice) return;
                                  onInlineAssign(t, currentInlineChoice);
                                  setPendingInlineChoice(prev => {
                                    const next = { ...prev };
                                    delete next[t.id];
                                    return next;
                                  });
                                }}
                                className="px-3.5 py-1.5 rounded-xl bg-[#5B35B1] hover:bg-[#431599] disabled:opacity-45 text-white font-bold text-xs transition-colors cursor-pointer whitespace-nowrap"
                              >
                                Tugaskan Sekarang
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] font-semibold text-[#B45309]">
                              Menunggu penugasan Korlap
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => onSelectTicket(t)}
                            className="px-3 py-1.5 rounded-xl border border-[#E9E5F0] bg-white hover:bg-[#F7F6FA] text-[#211A2E] font-semibold text-xs cursor-pointer"
                          >
                            Detail
                          </button>
                        </div>
                      ) : (
                        <div className="w-full flex flex-wrap items-center gap-2 lg:justify-end">
                          <div className="text-xs text-[#494453]">
                            Teknisi:{' '}
                            <strong className="text-[#211A2E]">{t.installerName}</strong>
                          </div>

                          {assignedTech ? (
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold font-mono tabular-nums ${
                                assignedTech.isFull
                                  ? 'bg-[#FEE2E2] text-[#DC4C5A]'
                                  : 'bg-[#DCFCE7] text-[#15803D]'
                              }`}
                            >
                              {assignedTech.isFull
                                ? `KUOTA ${assignedTech.assignedCount}/${assignedTech.maxLimit} (FULL)`
                                : `${assignedTech.assignedCount}/${assignedTech.maxLimit} Slot`}
                            </span>
                          ) : null}

                          {isLeaderRole && (
                            <button
                              type="button"
                              onClick={() => onOpenReassignModal(t)}
                              className="px-2.5 py-1.5 rounded-xl border border-[#E9E5F0] bg-white hover:bg-[#F5F1FF] hover:border-[#D8CCF3] text-[#211A2E] font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3 text-[#5B35B1]" />
                              <span>Reassign</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onOpenWhatsAppModal(t)}
                            title="Kirim notifikasi penugasan via WhatsApp"
                            className="p-1.5 rounded-xl bg-[#DCFCE7] hover:bg-[#BBF7D0] text-[#15803D] transition-colors cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onSelectTicket(t)}
                            className="px-3 py-1.5 rounded-xl border border-[#E9E5F0] bg-white hover:bg-[#F7F6FA] text-[#211A2E] font-semibold text-xs cursor-pointer"
                          >
                            Detail
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* CLASSIC TABLE VIEW (PRESERVED WITH COLUMN CUSTOMIZER & EXPANDABLE ROWS) */
        <div className="bg-white rounded-2xl border border-[#E9E5F0] shadow-[0_1px_4px_rgba(31,24,44,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#35105E] text-white text-[11px] font-bold uppercase sticky top-0 z-10 border-b border-[#431599] [&_button]:text-white [&_button:hover]:text-[#E9D5FF] [&_svg]:text-white/90">
                <tr>{visibleColumns.map(col => renderHeaderCell(col))}</tr>
              </thead>
              <tbody className="divide-y divide-[#F1EDF7]">
                {paginatedTickets.map(t => {
                  const { label, progressPercent } = classifyTicketOperational(t);
                  const isSelected = selectedTicketIds.includes(t.id);
                  const isExpanded = Boolean(expandedRowIds[t.id]);
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        className={`transition-colors hover:bg-[#F7F6FA] ${
                          isSelected ? 'bg-[#F5F1FF]' : ''
                        }`}
                      >
                        {visibleColumns.map(col =>
                          renderBodyCell(col, t, isSelected, isExpanded, label, progressPercent)
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#F7F6FA]">
                          <td colSpan={visibleColumns.length} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                              <div className="space-y-1.5">
                                <span className="font-bold text-[#211A2E] block">
                                  Detail Lokasi &amp; Alamat Pelanggan
                                </span>
                                <div className="text-[#494453]">
                                  <strong>Alamat Lengkap:</strong> {t.streetName || '-'}
                                </div>
                                <div className="text-[#494453]">
                                  <strong>Patokan:</strong> {t.streetAlternatif || 'Tidak ada'}
                                </div>
                                <div className="text-[#494453]">
                                  <strong>Area &amp; Cluster:</strong> {t.area} · {t.clusterName || '-'}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openCustomerAddressInGoogleMaps(t)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 mt-1 text-xs font-semibold text-[#431599] bg-[#F5F1FF] hover:bg-[#EDE9FE] rounded-lg border border-[#D8CCF3] cursor-pointer"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                  <span>Buka di Google Maps</span>
                                </button>
                              </div>

                              <div className="space-y-1 font-mono text-[11px] text-[#494453]">
                                <span className="font-bold text-[#211A2E] block font-sans text-xs">
                                  Data Jaringan &amp; Perangkat
                                </span>
                                <div>OLT / FDT Code: <strong>{t.fdtCode || '-'}</strong></div>
                                <div>FAT Code: <strong>{t.fatCode || '-'}</strong></div>
                                <div>Kategori: <strong>{t.ticketCategory}</strong></div>
                                <div>ONT: <strong>{t.ontBrand || '-'} / {t.ontModel || '-'}</strong></div>
                              </div>

                              <div className="space-y-1.5">
                                <span className="font-bold text-[#211A2E] block text-xs">
                                  Catatan &amp; Status Kerja (WIB)
                                </span>
                                <div className="p-2.5 rounded-lg bg-white border border-[#E9E5F0] text-[#494453] text-[11px] space-y-1">
                                  <div>{t.remarksWOInstaller || t.remarksAgent || 'Belum ada catatan.'}</div>
                                  <div className="pt-1 border-t border-[#F1EDF7] flex flex-wrap gap-3 font-mono text-[10.5px]">
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
      <div className="bg-white rounded-2xl border border-[#E9E5F0] px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#766B83] shadow-[0_1px_4px_rgba(31,24,44,0.03)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular-nums">
            Menampilkan <strong className="text-[#211A2E]">{startIdx} - {endIdx}</strong> dari{' '}
            <strong className="text-[#211A2E]">{filteredTickets.length}</strong> Work Order Scoped
          </span>
          <select
            value={rowsPerPage}
            onChange={e => onRowsPerPageChange(Number(e.target.value))}
            className="px-2 py-1 rounded-lg border border-[#E9E5F0] bg-[#F7F6FA] text-[11px] font-semibold text-[#211A2E]"
          >
            <option value={6}>6 / hal</option>
            <option value={10}>10 / hal</option>
            <option value={25}>25 / hal</option>
            <option value={50}>50 / hal</option>
            <option value={-1}>Semua ({filteredTickets.length})</option>
          </select>
        </div>

        {rowsPerPage !== -1 && totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="px-3 py-1.5 rounded-xl border border-[#E9E5F0] bg-white hover:bg-[#F7F6FA] text-[#494453] font-semibold disabled:opacity-40 cursor-pointer"
            >
              Sebelumnya
            </button>
            {pageNumbers.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                className={`w-8 h-8 rounded-xl font-bold text-xs tabular-nums transition-colors cursor-pointer ${
                  currentPage === p
                    ? 'bg-[#2A1459] text-white'
                    : 'border border-[#E9E5F0] bg-white text-[#494453] hover:bg-[#F7F6FA]'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="px-3 py-1.5 rounded-xl border border-[#E9E5F0] bg-white hover:bg-[#F7F6FA] text-[#494453] font-semibold disabled:opacity-40 cursor-pointer"
            >
              Selanjutnya
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
