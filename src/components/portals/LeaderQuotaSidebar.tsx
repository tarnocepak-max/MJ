import React from 'react';
import { Gauge, History, PlusCircle, ShieldCheck } from 'lucide-react';
import {
  AssignmentFeedEntry,
  LeaderQuotaConfig,
  TechnicianCapacitySummary
} from '../../services/leaderQuotaService';
import { Ticket, User } from '../../types/index.ts';

interface LeaderQuotaSidebarProps {
  quotaConfig: LeaderQuotaConfig;
  technicians: TechnicianCapacitySummary[];
  auditFeed: AssignmentFeedEntry[];
  isLeaderRole: boolean;
  isSavingQuota: boolean;
  selectedCount: number;
  hasUnassignedTickets: boolean;
  onToggleStrictEnforcement: (nextStrict: boolean) => void;
  onDirectAssignToTechnician: (installer: User) => void;
  onSelectTicket: (ticket: Ticket) => void;
  onOpenAllAuditTrail: () => void;
  onSelectTechnicianFilter: (installerName: string) => void;
}

const AVATAR_TONES = [
  'bg-[#EDE9FE] dark:bg-[#2E1B59] text-[#431599] dark:text-[#E9D5FF]',
  'bg-[#FCE7F3] dark:bg-pink-950/70 text-[#BE185D] dark:text-pink-300',
  'bg-[#E0E7FF] dark:bg-indigo-950/70 text-[#3730A3] dark:text-indigo-300',
  'bg-[#DCFCE7] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-300',
  'bg-[#FEF3C7] dark:bg-amber-950/70 text-[#B45309] dark:text-amber-300',
  'bg-[#F3E8FF] dark:bg-purple-950/70 text-[#6B21A8] dark:text-purple-300'
];

function getInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'TK';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatWibClock(iso?: string): string {
  if (!iso) return '-';
  try {
    return (
      new Date(iso).toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }) + ' WIB'
    );
  } catch {
    return '-';
  }
}

export const LeaderQuotaSidebar: React.FC<LeaderQuotaSidebarProps> = ({
  quotaConfig,
  technicians,
  auditFeed,
  isLeaderRole,
  isSavingQuota,
  selectedCount,
  hasUnassignedTickets,
  onToggleStrictEnforcement,
  onDirectAssignToTechnician,
  onSelectTicket,
  onOpenAllAuditTrail,
  onSelectTechnicianFilter
}) => {
  return (
    <div className="space-y-4">
      {/* KAPASITAS & KUOTA CARD */}
      <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E9E5F0] dark:border-[#3E246F] p-4 shadow-[0_2px_8px_rgba(31,24,44,0.04)] space-y-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF] shrink-0" />
            <h3
              className="font-bold text-[15px] text-[#211A2E] dark:text-white tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Kapasitas &amp; Kuota
            </h3>
          </div>
          <span
            className={`badge-3d-tactile px-2.5 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              quotaConfig.enforceStrictLimit
                ? 'bg-[#DCFCE7] dark:bg-emerald-950/70 border border-[#86EFAC] dark:border-emerald-700 text-[#15803D] dark:text-emerald-300'
                : 'bg-[#FEF3C7] dark:bg-amber-950/70 border border-[#FCD34D] dark:border-amber-700 text-[#B45309] dark:text-amber-300'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                quotaConfig.enforceStrictLimit ? 'bg-[#16A36A] animate-pulse' : 'bg-[#E59A27]'
              }`}
            />
            {quotaConfig.enforceStrictLimit ? 'Strict Enforced' : 'Soft Warning'}
          </span>
        </div>

        <p className="text-[11.5px] text-[#766B83] dark:text-[#A79BC0] leading-relaxed">
          Batas default:{' '}
          <strong className="text-[#211A2E] dark:text-white font-semibold">
            {quotaConfig.defaultMaxDailyQuota} Tiket/Teknisi/Hari.
          </strong>{' '}
          Sistem otomatis mengunci teknisi berkuota penuh untuk menjaga kualitas SOP &amp; waktu tempuh.
        </p>

        {/* Enforcement Toggle Strip */}
        <div className="bg-[#F5F1FF] dark:bg-[#261942] border border-[#D8CCF3] dark:border-[#4B386B] rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-[#211A2E] dark:text-white flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#5B35B1] dark:text-[#A78BFA] shrink-0" />
            <span>Enforcement Kunci Slot Melebihi Kuota</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={quotaConfig.enforceStrictLimit}
            disabled={!isLeaderRole || isSavingQuota}
            onClick={() => onToggleStrictEnforcement(!quotaConfig.enforceStrictLimit)}
            title={
              isLeaderRole
                ? 'Aktifkan/nonaktifkan penguncian slot melebihi kuota'
                : 'Hanya Leader yang dapat mengubah mode enforcement'
            }
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              quotaConfig.enforceStrictLimit ? 'bg-[#5B35B1]' : 'bg-[#CBC3D5] dark:bg-[#4B386B]'
            } ${!isLeaderRole || isSavingQuota ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                quotaConfig.enforceStrictLimit ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Technician Quota Cards Stack */}
        <div className="space-y-2.5">
          {technicians.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-[#D8CCF3] dark:border-[#4B386B] text-center text-[11.5px] text-[#8B8495]">
              Belum ada teknisi aktif pada cakupan mitra ini.
            </div>
          ) : (
            technicians.map((tech, idx) => {
              const firstName = tech.installer.name.split(' ')[0] || tech.installer.name;
              const toneClass = AVATAR_TONES[idx % AVATAR_TONES.length];
              const liveDotColor =
                tech.liveTone === 'onsite' || tech.liveTone === 'standby'
                  ? 'bg-[#16A36A]'
                  : tech.liveTone === 'enroute'
                  ? 'bg-[#3977C9]'
                  : 'bg-[#7135B5]';

              const canDirectAssign =
                isLeaderRole && !tech.isFull && (selectedCount > 0 || hasUnassignedTickets);

              return (
                <div
                  key={tech.installer.id}
                  className={`rounded-xl border p-3 transition-colors space-y-2.5 ${
                    tech.isFull
                      ? 'border-[#FCA5A5] dark:border-rose-800/70 bg-[#FFFDFD] dark:bg-[#2B152A]'
                      : tech.remainingSlots >= 2
                      ? 'border-[#86EFAC] dark:border-emerald-700/60 bg-white dark:bg-[#1A1335]'
                      : 'border-[#E9E5F0] dark:border-[#3E246F] bg-white dark:bg-[#1E1238]'
                  }`}
                >
                  {/* Row 1: Avatar + Name/Status + Ratio */}
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectTechnicianFilter(tech.installer.name)}
                      className="flex items-center gap-2.5 min-w-0 text-left group cursor-pointer"
                      title={`Filter WO untuk ${tech.installer.name}`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl ${toneClass} font-bold text-xs flex items-center justify-center shrink-0`}
                      >
                        {getInitials(tech.installer.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-[12.5px] text-[#211A2E] dark:text-white truncate group-hover:text-[#7135B5] dark:group-hover:text-[#DAB9FF] transition-colors">
                          {tech.installer.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10.5px] text-[#766B83] dark:text-[#A79BC0] truncate">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${liveDotColor}`} />
                          <span className="truncate">
                            {tech.liveStatusLabel} ({tech.liveLocationLabel})
                          </span>
                        </div>
                      </div>
                    </button>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div
                        className={`font-mono font-bold text-[12.5px] tabular-nums ${
                          tech.isFull ? 'text-[#DC2626] dark:text-rose-400' : 'text-[#211A2E] dark:text-white'
                        }`}
                      >
                        {tech.assignedCount} / {tech.maxLimit}
                      </div>
                      {tech.isFull ? (
                        <span className="badge-3d-tactile inline-block px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wide bg-[#DC2626] text-white">
                          KUOTA PENUH
                        </span>
                      ) : tech.hasCustomLimit ? (
                        <span className="badge-3d-tactile inline-block px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-[#E9DDFF] dark:bg-[#2E1B59] border border-[#D8B4FE] dark:border-[#5B35B1] text-[#431599] dark:text-[#E9D5FF]">
                          Custom Limit ({tech.maxLimit})
                        </span>
                      ) : tech.remainingSlots >= 2 ? (
                        <span className="badge-3d-tactile inline-block px-2 py-0.5 rounded-full text-[9.5px] font-extrabold bg-[#10B981] text-white">
                          {tech.remainingSlots} Slot Kosong
                        </span>
                      ) : (
                        <span className="text-[10.5px] font-medium text-[#766B83] dark:text-[#A79BC0] tabular-nums block">
                          {tech.utilizationPct}% Beban
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Row 2: 4-Slot Grid (S1 - S4) */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {tech.slots.map(cell => {
                      if (cell.state === 'ok') {
                        return (
                          <button
                            key={cell.slotCode}
                            type="button"
                            onClick={() => cell.ticket && onSelectTicket(cell.ticket)}
                            title={`${cell.slotLabel}: ${cell.woNumber} (${cell.customerName}) - Selesai`}
                            className="badge-3d-tactile py-1 px-1 rounded-md bg-[#2563EB] text-white font-mono font-bold text-[10px] text-center tabular-nums truncate hover:brightness-110 cursor-pointer"
                          >
                            {cell.slotCode}: OK
                          </button>
                        );
                      }
                      if (cell.state === 'assigned') {
                        return (
                          <button
                            key={cell.slotCode}
                            type="button"
                            onClick={() => cell.ticket && onSelectTicket(cell.ticket)}
                            title={`${cell.slotLabel}: ${cell.woNumber} (${cell.customerName})`}
                            className="badge-3d-tactile py-1 px-1 rounded-md bg-[#5B35B1] text-white font-mono font-bold text-[10px] text-center tabular-nums truncate hover:bg-[#7135B5] cursor-pointer"
                          >
                            {cell.slotCode}: {cell.shortWoCode}
                          </button>
                        );
                      }
                      if (cell.state === 'locked') {
                        return (
                          <div
                            key={cell.slotCode}
                            title={`${cell.slotLabel}: Terkunci (Kuota Harian Penuh)`}
                            className="badge-3d-tactile py-1 px-1 rounded-md bg-[#F1F5F9] dark:bg-[#261942] border border-[#E2E8F0] dark:border-[#3E246F] text-[#8B8495] font-mono font-semibold text-[10px] text-center tabular-nums truncate"
                          >
                            {cell.slotCode}: LOCK
                          </div>
                        );
                      }
                      return (
                        <div
                          key={cell.slotCode}
                          title={`${cell.slotLabel}: Tersedia`}
                          className="badge-3d-tactile py-1 px-1 rounded-md bg-[#ECFDF5] dark:bg-emerald-950/60 border border-[#A7F3D0] dark:border-emerald-800 text-[#047857] dark:text-emerald-300 font-mono font-bold text-[10px] text-center tabular-nums truncate"
                        >
                          {cell.slotCode}: FREE
                        </div>
                      );
                    })}
                  </div>

                  {/* Direct Assign Action Button (Stitch 3D Secondary) */}
                  {canDirectAssign && (
                    <button
                      type="button"
                      onClick={() => onDirectAssignToTechnician(tech.installer)}
                      className="btn-3d-secondary w-full py-1.5 px-3 rounded-xl text-[#431599] dark:text-[#E9D5FF] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#DAB9FF]" />
                      <span>
                        {selectedCount > 0
                          ? `Tugaskan ${selectedCount} WO ke ${firstName}`
                          : `Tugaskan Langsung ke ${firstName}`}
                      </span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* AUDIT TRAIL REASSIGN TERKINI CARD */}
      <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E9E5F0] dark:border-[#3E246F] p-4 shadow-[0_2px_8px_rgba(31,24,44,0.04)] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[#766B83] dark:text-[#A79BC0] text-[10.5px] font-bold uppercase tracking-wider">
            <History className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#DAB9FF]" />
            <span>Audit Trail Reassign Terkini</span>
          </div>
          <button
            type="button"
            onClick={onOpenAllAuditTrail}
            className="text-[11px] font-bold text-[#7135B5] dark:text-[#DAB9FF] hover:underline cursor-pointer shrink-0"
          >
            Lihat Semua
          </button>
        </div>

        <div className="space-y-2">
          {auditFeed.length === 0 ? (
            <div className="p-3 rounded-xl bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#3E246F] text-[11px] text-[#8B8495] text-center">
              Belum ada riwayat pengalihan tugas (Reassign) hari ini.
            </div>
          ) : (
            auditFeed.slice(0, 4).map(entry => (
              <div
                key={entry.id}
                className="p-2.5 rounded-xl bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#3E246F] space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-[11.5px] text-[#211A2E] dark:text-white tabular-nums">
                    {entry.woNumber}
                  </span>
                  <span className="font-mono text-[10.5px] text-[#8B8495] tabular-nums">
                    {formatWibClock(entry.timestamp || entry.createdAt)}
                  </span>
                </div>
                <div className="text-[11px] text-[#494453] dark:text-[#CBD5E1]">
                  Dari{' '}
                  <span className="font-medium text-[#766B83] dark:text-[#A79BC0]">
                    {entry.previousInstallerName || 'Teknisi Sebelumnya'}
                  </span>{' '}
                  →{' '}
                  <strong className="text-[#211A2E] dark:text-white">
                    {entry.newInstallerName || entry.installerName}
                  </strong>
                </div>
                <div className="text-[10.5px] text-[#DC4C5A] dark:text-rose-400 font-medium truncate" title={entry.reason}>
                  Alasan: {entry.reason || 'Penyesuaian slot operasional'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

