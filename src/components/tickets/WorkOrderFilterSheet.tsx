import React from 'react';
import { X, RotateCcw, SlidersHorizontal, Check } from 'lucide-react';

export interface FilterOptionItem {
  value: string;
  label: string;
}

interface WorkOrderFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  totalMatchedCount: number;
  selectedArea: string;
  onAreaChange: (val: string) => void;
  areaOptions: Array<{ name: string; count: number }>;
  selectedContractor: string;
  onContractorChange: (val: string) => void;
  contractorOptions: string[];
  selectedAgentStatus: string;
  onAgentStatusChange: (val: string) => void;
  selectedInstallerStatus: string;
  onInstallerStatusChange: (val: string) => void;
  selectedWhatsAppStatus: string;
  onWhatsAppStatusChange: (val: string) => void;
  selectedApprovalStatus: string;
  onApprovalStatusChange: (val: string) => void;
  approvalCounts: {
    butuhApproval: number;
    approved: number;
    rejected: number;
    closed: number;
  };
  selectedCategory: string;
  onCategoryChange: (val: string) => void;
  ticketCategories: string[];
  onResetAll: () => void;
}

const AGENT_STATUS_OPTIONS: FilterOptionItem[] = [
  { value: 'ALL', label: 'Semua' },
  { value: 'Done', label: 'Done' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Reschedule', label: 'Reschedule' },
  { value: 'Cancel', label: 'Cancel' },
  { value: 'Assigned', label: 'Assigned' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Resolved', label: 'Resolved' },
  { value: 'Closed', label: 'Closed (Legacy)' },
  { value: 'Cancelled', label: 'Cancelled (Legacy)' }
];

const INSTALLER_STATUS_OPTIONS: FilterOptionItem[] = [
  { value: 'ALL', label: 'Semua' },
  { value: 'Unassigned', label: 'Unassigned' },
  { value: 'Assigned', label: 'Assigned' },
  { value: 'En Route', label: 'En Route' },
  { value: 'On Site', label: 'On Site' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Pending Technical', label: 'Pending Technical' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Installed', label: 'Installed' },
  { value: 'Failed / Cancelled', label: 'Failed / Cancelled' }
];

const WHATSAPP_STATUS_OPTIONS: FilterOptionItem[] = [
  { value: 'ALL', label: 'Semua' },
  { value: 'not_prepared', label: 'Not Prepared' },
  { value: 'ready', label: 'Ready' },
  { value: 'opened_in_whatsapp', label: 'Opened in WA' },
  { value: 'awaiting_confirmation', label: 'Awaiting Confirm' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'reschedule_requested', label: 'Reschedule' },
  { value: 'unreachable', label: 'Unreachable' },
  { value: 'invalid_number', label: 'Invalid Phone' },
  { value: 'cancelled', label: 'Cancelled' }
];

export const WorkOrderFilterSheet: React.FC<WorkOrderFilterSheetProps> = ({
  isOpen,
  onClose,
  totalMatchedCount,
  selectedArea,
  onAreaChange,
  areaOptions,
  selectedContractor,
  onContractorChange,
  contractorOptions,
  selectedAgentStatus,
  onAgentStatusChange,
  selectedInstallerStatus,
  onInstallerStatusChange,
  selectedWhatsAppStatus,
  onWhatsAppStatusChange,
  selectedApprovalStatus,
  onApprovalStatusChange,
  approvalCounts,
  selectedCategory,
  onCategoryChange,
  ticketCategories,
  onResetAll
}) => {
  if (!isOpen) return null;

  const activeFilterCount = [
    selectedArea !== 'ALL',
    selectedContractor !== 'ALL',
    selectedAgentStatus !== 'ALL',
    selectedInstallerStatus !== 'ALL',
    selectedWhatsAppStatus !== 'ALL',
    selectedApprovalStatus !== 'ALL',
    selectedCategory !== 'ALL'
  ].filter(Boolean).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wo-filter-sheet-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#26364A]/45 dark:bg-[#160D29]/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="mj-sheet-enter w-full sm:max-w-lg bg-white/95 dark:bg-[#1E1238] rounded-t-[28px] sm:rounded-2xl shadow-2xl border border-[#DDE6F0] dark:border-[#35105E] max-h-[88dvh] flex flex-col overflow-hidden"
      >
        {/* Drag Handle + Header */}
        <div className="pt-3 pb-3 px-4 border-b border-[#DDE6F0] dark:border-[#35105E] bg-[#F8FAFD] dark:bg-[#160D29] shrink-0">
          <div aria-hidden="true" className="w-12 h-1.5 rounded-full bg-[#CFDCE8] dark:bg-[#4B386B] mx-auto mb-3 sm:hidden" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#27104A] border border-[#DCE3F2] dark:border-[#4B386B] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                <SlidersHorizontal className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3
                  id="wo-filter-sheet-title"
                  className="font-display font-bold text-[15px] text-[#26364A] dark:text-white truncate"
                >
                  Filter Work Order Lanjutan
                </h3>
                <p className="text-[11px] text-[#52647A] dark:text-[#C5B3DF] truncate">
                  {activeFilterCount > 0
                    ? `${activeFilterCount} filter aktif • ${totalMatchedCount} WO cocok`
                    : `Menampilkan ${totalMatchedCount} WO sesuai cakupan akses`}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup filter"
              className="btn-3d-icon w-11 h-11 min-w-[44px] min-h-[44px] rounded-full cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Filter Sections */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-5 text-xs">
          {/* Approval Dispatch Pills */}
          <div className="space-y-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF]">
              Status Approval Dispatch
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: 'ALL', label: 'Semua' },
                { value: 'BUTUH APPROVAL', label: `Butuh Approval (${approvalCounts.butuhApproval})` },
                { value: 'APPROVED', label: `Approved (${approvalCounts.approved})` },
                { value: 'REJECTED', label: `Revisi / Rejected (${approvalCounts.rejected})` },
                { value: 'CLOSED', label: `Closed (${approvalCounts.closed})` }
              ].map(opt => {
                const active = selectedApprovalStatus === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onApprovalStatusChange(opt.value)}
                    className={`min-h-[38px] px-3 py-1.5 rounded-full font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                      active ? 'tactile-chip-active' : 'tactile-chip text-[#52647A] dark:text-[#E8DDFF]'
                    }`}
                  >
                    {active && <Check className="w-3 h-3 shrink-0" />}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Installer Status Pills */}
          <div className="space-y-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF]">
              Status Lapangan Teknisi (statusWOInstaller)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {INSTALLER_STATUS_OPTIONS.map(opt => {
                const active = selectedInstallerStatus === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onInstallerStatusChange(opt.value)}
                    className={`min-h-[36px] px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                      active ? 'tactile-chip-active' : 'tactile-chip text-[#52647A] dark:text-[#E8DDFF]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Agent Status & WhatsApp Status Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF]">
                Status WO Agent
              </label>
              <select
                value={selectedAgentStatus}
                onChange={e => onAgentStatusChange(e.target.value)}
                className="tactile-debossed-input w-full min-h-[44px] px-3 rounded-xl font-semibold focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
              >
                {AGENT_STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF]">
                WhatsApp Handshake
              </label>
              <select
                value={selectedWhatsAppStatus}
                onChange={e => onWhatsAppStatusChange(e.target.value)}
                className="tactile-debossed-input w-full min-h-[44px] px-3 rounded-xl font-semibold focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
              >
                {WHATSAPP_STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Area, Mitra Kontraktor & Kategori */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF]">
                Area Servis
              </label>
              <select
                value={selectedArea}
                onChange={e => onAreaChange(e.target.value)}
                className="tactile-debossed-input w-full min-h-[44px] px-3 rounded-xl font-semibold focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
              >
                <option value="ALL">Semua Area ({areaOptions.length})</option>
                {areaOptions.map(a => (
                  <option key={a.name} value={a.name}>
                    {a.name} ({a.count})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF]">
                Mitra Kontraktor
              </label>
              <select
                value={selectedContractor}
                onChange={e => onContractorChange(e.target.value)}
                className="tactile-debossed-input w-full min-h-[44px] px-3 rounded-xl font-semibold focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
              >
                <option value="ALL">Semua Kontraktor ({contractorOptions.length})</option>
                {contractorOptions.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {ticketCategories.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF]">
                  Kategori Tiket
                </label>
                <select
                  value={selectedCategory}
                  onChange={e => onCategoryChange(e.target.value)}
                  className="tactile-debossed-input w-full min-h-[44px] px-3 rounded-xl font-semibold focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                >
                  <option value="ALL">Semua Kategori ({ticketCategories.length})</option>
                  {ticketCategories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Footer Actions */}
        <div className="px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[#F8FAFD] dark:bg-[#160D29] border-t border-[#DDE6F0] dark:border-[#35105E] flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onResetAll}
            className="btn-3d-lilac min-h-[46px] px-4 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-3d-primary flex-1 min-h-[46px] px-4 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Terapkan Filter ({totalMatchedCount} WO)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
