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
  'bg-[#EDE9FE] text-[#431599]',
  'bg-[#FCE7F3] text-[#BE185D]',
  'bg-[#E0E7FF] text-[#3730A3]',
  'bg-[#DCFCE7] text-[#15803D]',
  'bg-[#FEF3C7] text-[#B45309]',
  'bg-[#F3E8FF] text-[#6B21A8]'
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
      <div className="bg-white rounded-2xl border border-[#E9E5F0] p-4 shadow-[0_1px_4px_rgba(31,24,44,0.04)] space-y-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#431599] shrink-0" />
            <h3
              className="font-bold text-[15px] text-[#211A2E] tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Kapasitas &amp; Kuota
            </h3>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap shrink-0 flex items-center gap-1 ${
              quotaConfig.enforceStrictLimit
                ? 'bg-[#DCFCE7] text-[#15803D]'
                : 'bg-[#FEF3C7] text-[#B45309]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                quotaConfig.enforceStrictLimit ? 'bg-[#16A36A]' : 'bg-[#E59A27]'
              }`}
            />
            {quotaConfig.enforceStrictLimit ? 'Strict Enforced' : 'Soft Warning'}
          </span>
        </div>

        <p className="text-[11.5px] text-[#766B83] leading-relaxed">
          Batas default:{' '}
          <strong className="text-[#211A2E] font-semibold">
            {quotaConfig.defaultMaxDailyQuota} Tiket/Teknisi/Hari.
          </strong>{' '}
          Sistem otomatis mengunci teknisi berkuota penuh untuk menjaga kualitas SOP &amp; waktu tempuh.
        </p>

        {/* Enforcement Toggle Strip */}
        <div className="bg-[#F7F6FA] border border-[#E9E5F0] rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-[#211A2E] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#5B35B1] shrink-0" />
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
              quotaConfig.enforceStrictLimit ? 'bg-[#5B35B1]' : 'bg-[#CBC3D5]'
            } ${!isLeaderRole || isSavingQuota ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                quotaConfig.enforceStrictLimit ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Technician Quota Cards Stack */}
        <div className="space-y-2.5">
          {technicians.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-[#D8CCF3] text-center text-[11.5px] text-[#8B8495]">
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
                      ? 'border-[#FECDD3] bg-[#FFFDFD]'
                      : tech.remainingSlots >= 2
                      ? 'border-[#BBF7D0] bg-white'
                      : 'border-[#E9E5F0] bg-white'
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
                        <div className="font-bold text-[12.5px] text-[#211A2E] truncate group-hover:text-[#431599] transition-colors">
                          {tech.installer.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10.5px] text-[#766B83] truncate">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${liveDotColor}`} />
                          <span className="truncate">
                            {tech.liveStatusLabel} ({tech.liveLocationLabel})
                          </span>
                        </div>
                      </div>
                    </button>

                    <div className="text-right shrink-0">
                      <div
                        className={`font-mono font-bold text-[12.5px] tabular-nums ${
                          tech.isFull ? 'text-[#DC4C5A]' : 'text-[#211A2E]'
                        }`}
                      >
                        {tech.assignedCount} / {tech.maxLimit}
                      </div>
                      {tech.isFull ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide bg-[#FEE2E2] text-[#DC4C5A]">
                          KUOTA PENUH
                        </span>
                      ) : tech.hasCustomLimit ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-[#E9DDFF] text-[#431599]">
                          Custom Limit ({tech.maxLimit})
                        </span>
                      ) : tech.remainingSlots >= 2 ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-[#DCFCE7] text-[#15803D]">
                          {tech.remainingSlots} Slot Kosong
                        </span>
                      ) : (
                        <span className="text-[10.5px] font-medium text-[#766B83] tabular-nums">
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
                            className="py-1 px-1 rounded-md bg-[#3977C9] text-white font-mono font-bold text-[10px] text-center tabular-nums truncate hover:opacity-90 cursor-pointer"
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
                            className="py-1 px-1 rounded-md bg-[#2A1459] text-white font-mono font-bold text-[10px] text-center tabular-nums truncate hover:bg-[#431599] cursor-pointer"
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
                            className="py-1 px-1 rounded-md bg-[#F1F5F9] text-[#8B8495] font-mono font-semibold text-[10px] text-center tabular-nums truncate"
                          >
                            {cell.slotCode}: LOCK
                          </div>
                        );
                      }
                      return (
                        <div
                          key={cell.slotCode}
                          title={`${cell.slotLabel}: Tersedia`}
                          className="py-1 px-1 rounded-md bg-[#DCFCE7] text-[#15803D] font-mono font-bold text-[10px] text-center tabular-nums truncate"
                        >
                          {cell.slotCode}: FREE
                        </div>
                      );
                    })}
                  </div>

                  {/* Optional Direct Assign Action */}
                  {canDirectAssign && (
                    <button
                      type="button"
                      onClick={() => onDirectAssignToTechnician(tech.installer)}
                      className="w-full py-1.5 px-3 rounded-lg bg-[#F5F1FF] hover:bg-[#EDE9FE] border border-[#D8CCF3] text-[#431599] font-bold text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
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
      <div className="bg-white rounded-2xl border border-[#E9E5F0] p-4 shadow-[0_1px_4px_rgba(31,24,44,0.04)] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[#766B83] text-[10.5px] font-bold uppercase tracking-wider">
            <History className="w-3.5 h-3.5 text-[#5B35B1]" />
            <span>Audit Trail Reassign Terkini</span>
          </div>
          <button
            type="button"
            onClick={onOpenAllAuditTrail}
            className="text-[11px] font-bold text-[#431599] hover:underline cursor-pointer shrink-0"
          >
            Lihat Semua
          </button>
        </div>

        <div className="space-y-2">
          {auditFeed.length === 0 ? (
            <div className="p-3 rounded-xl bg-[#F7F6FA] border border-[#E9E5F0] text-[11px] text-[#8B8495] text-center">
              Belum ada riwayat pengalihan tugas (Reassign) hari ini.
            </div>
          ) : (
            auditFeed.slice(0, 4).map(entry => (
              <div
                key={entry.id}
                className="p-2.5 rounded-xl bg-[#F7F6FA] border border-[#E9E5F0] space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-[11.5px] text-[#211A2E] tabular-nums">
                    {entry.woNumber}
                  </span>
                  <span className="font-mono text-[10.5px] text-[#8B8495] tabular-nums">
                    {formatWibClock(entry.timestamp || entry.createdAt)}
                  </span>
                </div>
                <div className="text-[11px] text-[#494453]">
                  Dari{' '}
                  <span className="font-medium text-[#766B83]">
                    {entry.previousInstallerName || 'Teknisi Sebelumnya'}
                  </span>{' '}
                  →{' '}
                  <strong className="text-[#211A2E]">
                    {entry.newInstallerName || entry.installerName}
                  </strong>
                </div>
                <div className="text-[10.5px] text-[#DC4C5A] font-medium truncate" title={entry.reason}>
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
