import React, { useEffect, useState } from 'react';
import {
  Sliders,
  ShieldCheck,
  ArrowRightLeft,
  History,
  Check,
  AlertTriangle,
  Search,
  RotateCcw,
  Users2
} from 'lucide-react';
import { Ticket, User } from '../../types/index.ts';
import {
  AssignmentFeedEntry,
  LeaderQuotaConfig,
  TechnicianCapacitySummary
} from '../../services/leaderQuotaService';
import { ResponsiveModal } from '../common/ResponsiveModal';

interface DailyLimitSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  quotaConfig: LeaderQuotaConfig;
  technicians: TechnicianCapacitySummary[];
  contractorName: string;
  isLeaderRole: boolean;
  isSaving: boolean;
  onSave: (nextConfig: LeaderQuotaConfig) => Promise<void>;
}

export const DailyLimitSettingsModal: React.FC<DailyLimitSettingsModalProps> = ({
  isOpen,
  onClose,
  quotaConfig,
  technicians,
  contractorName,
  isLeaderRole,
  isSaving,
  onSave
}) => {
  const [defaultLimit, setDefaultLimit] = useState<number>(quotaConfig.defaultMaxDailyQuota || 4);
  const [strictLimit, setStrictLimit] = useState<boolean>(quotaConfig.enforceStrictLimit);
  const [customLimits, setCustomLimits] = useState<Record<string, number>>(
    quotaConfig.customInstallerLimits || {}
  );

  useEffect(() => {
    if (isOpen) {
      setDefaultLimit(quotaConfig.defaultMaxDailyQuota || 4);
      setStrictLimit(quotaConfig.enforceStrictLimit);
      setCustomLimits({ ...(quotaConfig.customInstallerLimits || {}) });
    }
  }, [isOpen, quotaConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLeaderRole || isSaving) return;
    await onSave({
      ...quotaConfig,
      contractorName,
      defaultMaxDailyQuota: Math.min(Math.max(Math.round(defaultLimit), 1), 12),
      enforceStrictLimit: strictLimit,
      customInstallerLimits: customLimits
    });
  };

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Atur Limit Harian & Kuota Teknisi"
      subtitle={`Konfigurasi kuota per hari tersimpan di database untuk mitra ${contractorName}`}
      icon={<Sliders className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />}
      size="lg"
      mobileVariant="sheet"
      zIndexClass="z-60"
      footer={
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 w-full text-xs">
          <button
            type="button"
            onClick={onClose}
            className="mj-btn-leader-neutral min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl font-bold cursor-pointer"
          >
            Tutup
          </button>
          {isLeaderRole && (
            <button
              type="submit"
              form="leader-daily-limit-form"
              disabled={isSaving}
              className={`mj-btn-leader-primary min-h-[44px] sm:min-h-[40px] px-5 py-2 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer ${
                isSaving ? 'mj-btn-loading' : ''
              }`}
            >
              <Check className={`w-4 h-4 ${isSaving ? 'animate-pulse' : ''}`} />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan Aturan Kuota'}</span>
            </button>
          )}
        </div>
      }
    >
      <form id="leader-daily-limit-form" onSubmit={handleSubmit} className="space-y-5 text-xs">
        {/* Default Limit + Strict Toggle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-[#E8DDFF] dark:border-[#35105E] bg-[#F8F1FF] dark:bg-[#160D29] space-y-2">
            <label className="block font-bold text-[#1F1638] dark:text-white text-xs">
              Batas Default Harian (WO / Teknisi)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={12}
                disabled={!isLeaderRole}
                value={defaultLimit}
                onChange={e => setDefaultLimit(Number(e.target.value) || 1)}
                className="tactile-debossed-input w-20 min-h-[44px] sm:min-h-[40px] px-3 py-2 bg-white dark:bg-[#1E1238] border border-[#D0BCFF] dark:border-[#4B386B] rounded-xl font-mono font-bold text-sm text-[#58149C] dark:text-[#DAB9FF] tabular-nums focus:outline-hidden focus:ring-2 focus:ring-[#58149C]"
              />
              <span className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]">
                Rentang 1–12 tiket/hari per teknisi aktif
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-[#E8DDFF] dark:border-[#35105E] bg-[#F8F1FF] dark:bg-[#160D29] flex items-center justify-between gap-3">
            <div>
              <div className="font-bold text-[#1F1638] dark:text-white text-xs flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Strict Quota Lock</span>
              </div>
              <p className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8] mt-0.5 leading-snug">
                Kunci otomatis slot jika beban mencapai limit harian.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={strictLimit}
              disabled={!isLeaderRole}
              onClick={() => setStrictLimit(prev => !prev)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                strictLimit ? 'bg-[#58149C] dark:bg-[#7135B5]' : 'bg-[#D6CAE8] dark:bg-[#35105E]'
              } ${!isLeaderRole ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  strictLimit ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Per-Technician Custom Limits */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-[#1F1638] dark:text-white text-xs flex items-center gap-1.5">
              <Users2 className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />
              <span>Custom Limit per Teknisi ({technicians.length} Teknisi Aktif)</span>
            </div>
            {Object.keys(customLimits).length > 0 && isLeaderRole && (
              <button
                type="button"
                onClick={() => setCustomLimits({})}
                className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#58149C] dark:text-[#DAB9FF] cursor-pointer"
              >
                Reset Semua ke Default ({defaultLimit})
              </button>
            )}
          </div>

          <div className="border border-[#E8DDFF] dark:border-[#3E246F] rounded-xl divide-y divide-[#E8DDFF] dark:divide-[#35105E] max-h-64 overflow-y-auto bg-white dark:bg-[#1E1238]">
            {technicians.length === 0 ? (
              <div className="p-4 text-center text-[#7D7484] dark:text-[#CEC0E8]">
                Belum ada teknisi aktif pada cakupan kontraktor &amp; area ini.
              </div>
            ) : (
              technicians.map(tech => {
                const hasOverride = typeof customLimits[tech.installer.name] === 'number';
                const effectiveVal = hasOverride ? customLimits[tech.installer.name] : defaultLimit;
                return (
                  <div key={tech.installer.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-[#F8F1FF] dark:hover:bg-[#261942]">
                    <div className="min-w-0">
                      <div className="font-semibold text-[#1F1638] dark:text-white truncate flex items-center gap-2">
                        <span className="truncate">{tech.installer.name}</span>
                        {hasOverride && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF] shrink-0">
                            Custom
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8] font-mono tabular-nums truncate">
                        Beban hari ini: {tech.assignedCount} WO · {tech.liveStatusLabel}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        disabled={!isLeaderRole}
                        value={effectiveVal}
                        onChange={e => {
                          const val = Math.min(Math.max(Math.round(Number(e.target.value) || 1), 1), 12);
                          setCustomLimits(prev => ({
                            ...prev,
                            [tech.installer.name]: val
                          }));
                        }}
                        className="tactile-debossed-input w-16 min-h-[40px] px-2.5 py-1.5 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-lg font-mono font-bold text-center text-[#1F1638] dark:text-white tabular-nums"
                      />
                      {hasOverride && isLeaderRole && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomLimits(prev => {
                              const next = { ...prev };
                              delete next[tech.installer.name];
                              return next;
                            });
                          }}
                          className="mj-btn-icon-3d-leader w-8 h-8 text-[#7D7484] hover:text-rose-600 cursor-pointer"
                          title="Kembalikan ke batas default"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </form>
    </ResponsiveModal>
  );
};

interface BulkReassignModalProps {
  isOpen: boolean;
  onClose: () => void;
  eligibleTickets: Ticket[];
  initialSelectedIds: string[];
  technicians: TechnicianCapacitySummary[];
  isLeaderRole: boolean;
  isSubmitting: boolean;
  onExecute: (payload: { ticketIds: string[]; targetInstaller: User; reason: string }) => Promise<void>;
}

export const BulkReassignModal: React.FC<BulkReassignModalProps> = ({
  isOpen,
  onClose,
  eligibleTickets,
  initialSelectedIds,
  technicians,
  isLeaderRole,
  isSubmitting,
  onExecute
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetInstallerName, setTargetInstallerName] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      const assignedIdsSet = new Set(eligibleTickets.map(t => t.id));
      const preselected = initialSelectedIds.filter(id => assignedIdsSet.has(id));
      setSelectedIds(preselected);
      setTargetInstallerName('');
      setReason('');
      setSearchTerm('');
    }
  }, [isOpen, eligibleTickets, initialSelectedIds]);

  const filteredList = eligibleTickets.filter(t => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      String(t.woNumber || '').toLowerCase().includes(q) ||
      String(t.customerName || '').toLowerCase().includes(q) ||
      String(t.installerName || '').toLowerCase().includes(q)
    );
  });

  const targetSummary = technicians.find(t => t.installer.name === targetInstallerName);
  const canSubmit =
    isLeaderRole &&
    selectedIds.length > 0 &&
    Boolean(targetSummary) &&
    reason.trim().length >= 5 &&
    !isSubmitting;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !targetSummary) return;
    await onExecute({
      ticketIds: selectedIds,
      targetInstaller: targetSummary.installer,
      reason: reason.trim()
    });
  };

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Bulk Reassign Work Order"
      subtitle="Alihkan beberapa WO aktif ke teknisi lain dengan menjaga progress lapangan & audit trail"
      icon={<ArrowRightLeft className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />}
      size="lg"
      mobileVariant="sheet"
      zIndexClass="z-60"
      footer={
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full text-xs">
          <span className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]">
            Check-in, LiveChat, dan Evidence lapangan tetap dipertahankan.
          </span>
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="mj-btn-leader-neutral min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl font-bold cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              form="leader-bulk-reassign-form"
              disabled={!canSubmit}
              className={`mj-btn-leader-primary min-h-[44px] sm:min-h-[40px] px-5 py-2 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer ${
                isSubmitting ? 'mj-btn-loading' : ''
              }`}
            >
              <ArrowRightLeft className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
              <span>{isSubmitting ? 'Memproses...' : `Alihkan ${selectedIds.length} WO`}</span>
            </button>
          </div>
        </div>
      }
    >
      <form id="leader-bulk-reassign-form" onSubmit={handleConfirm} className="space-y-4 text-xs">
        {/* WO Picker */}
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="font-bold text-[#1F1638] dark:text-white">
              1. Pilih WO Aktif yang Dialihkan ({selectedIds.length} terpilih)
            </label>
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#7D7484] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Cari WO / Teknisi..."
                className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[38px] pl-8 pr-2.5 py-1.5 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-lg text-[11px] text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#58149C]"
              />
            </div>
          </div>

          <div className="border border-[#E8DDFF] dark:border-[#3E246F] rounded-xl max-h-48 overflow-y-auto divide-y divide-[#E8DDFF] dark:divide-[#35105E] bg-white dark:bg-[#1E1238]">
            {filteredList.length === 0 ? (
              <div className="p-4 text-center text-[#7D7484] dark:text-[#CEC0E8]">
                Tidak ada WO aktif yang tersedia untuk di-reassign hari ini.
              </div>
            ) : (
              filteredList.map(t => {
                const checked = selectedIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      checked ? 'bg-[#F3EAFF] dark:bg-[#2E1B59]/70' : 'hover:bg-[#F8F1FF] dark:hover:bg-[#261942]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedIds(prev =>
                            prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
                          )
                        }
                        className="w-4 h-4 accent-[#58149C] rounded cursor-pointer shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-[#1F1638] dark:text-white flex items-center gap-2 flex-wrap">
                          <span>{t.woNumber}</span>
                          <span className="font-sans text-[10px] px-1.5 py-0.5 rounded bg-[#F8F1FF] dark:bg-[#160D29] text-[#4B4452] dark:text-[#CEC0E8] border border-[#E8DDFF] dark:border-[#35105E]">
                            {t.slotTime || 'Standar'}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8] truncate">
                          {t.customerName} · {t.clusterName || t.area}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-semibold text-[#58149C] dark:text-[#DAB9FF] shrink-0">
                      Saat ini: {t.installerName}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Target Technician */}
        <div>
          <label className="block font-bold text-[#1F1638] dark:text-white mb-1.5">
            2. Pilih Teknisi Tujuan Baru *
          </label>
          <select
            value={targetInstallerName}
            onChange={e => setTargetInstallerName(e.target.value)}
            className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[40px] px-3 py-2.5 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-xl font-medium text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#58149C]"
          >
            <option value="">-- Pilih Teknisi Tujuan --</option>
            {technicians.map(tech => (
              <option key={tech.installer.id} value={tech.installer.name}>
                {tech.installer.name} ({tech.assignedCount}/{tech.maxLimit} Slot ·{' '}
                {tech.isFull ? 'KUOTA PENUH' : `${tech.remainingSlots} Slot Kosong`})
              </option>
            ))}
          </select>
          {targetSummary && targetSummary.isFull && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#BA1A1A] dark:text-rose-300 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                Perhatian: {targetSummary.installer.name} saat ini sudah mencapai kapasitas penuh harian ({targetSummary.assignedCount}/{targetSummary.maxLimit}).
              </span>
            </div>
          )}
        </div>

        {/* Mandatory Reason */}
        <div>
          <label className="block font-bold text-[#1F1638] dark:text-white mb-1.5">
            3. Alasan Audit Bulk Reassign * (minimal 5 karakter)
          </label>
          <textarea
            rows={2}
            required
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Contoh: Pemerataan slot sore wilayah Kemang Timur / kendala kendaraan teknisi..."
            className="tactile-debossed-input w-full px-3 py-2 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-xl text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#58149C]"
          />
        </div>
      </form>
    </ResponsiveModal>
  );
};

interface AssignmentAuditTrailModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: AssignmentFeedEntry[];
  contractorName: string;
}

export const AssignmentAuditTrailModal: React.FC<AssignmentAuditTrailModalProps> = ({
  isOpen,
  onClose,
  entries,
  contractorName
}) => {
  const formatWibTime = (iso?: string) => {
    if (!iso) return '-';
    try {
      return (
        new Date(iso).toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }) + ' WIB'
      );
    } catch {
      return iso;
    }
  };

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Audit Trail Reassign & Penugasan (${entries.length})`}
      subtitle={`Riwayat append-only cakupan mitra ${contractorName}`}
      icon={<History className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />}
      size="lg"
      mobileVariant="sheet"
      zIndexClass="z-60"
      footer={
        <div className="flex justify-end w-full text-xs">
          <button
            type="button"
            onClick={onClose}
            className="mj-btn-leader-neutral min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl font-bold cursor-pointer"
          >
            Tutup
          </button>
        </div>
      }
    >
      <div className="space-y-2.5 text-xs">
        {entries.length === 0 ? (
          <div className="py-10 text-center text-[#7D7484] dark:text-[#CEC0E8]">
            Belum ada riwayat reassign Work Order yang tercatat pada mitra ini.
          </div>
        ) : (
          entries.map(item => (
            <div
              key={item.id}
              className="p-3.5 rounded-xl border border-[#E8DDFF] dark:border-[#35105E] bg-[#F8F1FF] dark:bg-[#160D29] flex flex-col gap-1"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[#1F1638] dark:text-white tabular-nums">
                    {item.woNumber}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF] border border-[#D0BCFF] dark:border-[#58149C]/50">
                    {item.sourceAction === 'reassign' ? 'REASSIGN' : 'ASSIGN'}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-[#7D7484] dark:text-[#CEC0E8] tabular-nums">
                  {formatWibTime(item.timestamp || item.createdAt)}
                </span>
              </div>
              <div className="text-[12px] text-[#1F1638] dark:text-[#E8DDFF]">
                Dari <span className="font-medium text-[#7D7484] dark:text-[#B9A7DE]">{item.previousInstallerName || 'Unassigned'}</span>
                {' → '}
                <strong className="text-[#58149C] dark:text-[#DAB9FF]">{item.newInstallerName || item.installerName}</strong>
              </div>
              <div className="text-[11px] text-[#BA1A1A] dark:text-rose-300 font-medium">
                Alasan: {item.reason || 'Penugasan / penyesuaian slot operasional'}
              </div>
              {item.performedBy && (
                <div className="text-[10.5px] text-[#7D7484] dark:text-[#CEC0E8]">
                  Diproses oleh {item.performedBy} ({item.performedByRole || 'leader'})
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </ResponsiveModal>
  );
};
