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
  canManageQuota?: boolean;
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
  'bg-[#EAE8FF] dark:bg-[#2E1B59] text-[#5145A6] dark:text-[#DAB9FF]',
  'bg-[#FCE9EB] dark:bg-pink-950/70 text-[#9B2C37] dark:text-pink-300',
  'bg-[#DDF4F4] dark:bg-[#35105E] text-[#2E7D8B] dark:text-[#E8DDFF]',
  'bg-[#E4F5EC] dark:bg-emerald-950/70 text-[#218A63] dark:text-emerald-300',
  'bg-[#FFF2D9] dark:bg-amber-950/70 text-[#9D661F] dark:text-amber-300',
  'bg-[#EDF3F8] dark:bg-[#261942] text-[#26364A] dark:text-[#E8DDFF]'
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
  canManageQuota = false,
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
      <div className="mj-enterprise-card rounded-2xl p-4 space-y-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
            <h3
              className="font-bold text-[15px] text-[#26364A] dark:text-white tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Kapasitas &amp; Kuota
            </h3>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              quotaConfig.enforceStrictLimit
                ? 'bg-[#E4F5EC] dark:bg-emerald-950/60 border border-[#B7E4CC] dark:border-emerald-800 text-[#218A63] dark:text-emerald-300'
                : 'bg-[#FFF2D9] dark:bg-amber-950/60 border border-[#F2CF95] dark:border-amber-800 text-[#9D661F] dark:text-amber-300'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                quotaConfig.enforceStrictLimit ? 'bg-[#218A63] dark:bg-emerald-500' : 'bg-[#C88735] dark:bg-amber-500'
              }`}
            />
            {quotaConfig.enforceStrictLimit ? 'Strict Enforced' : 'Soft Warning'}
          </span>
        </div>

        <p className="text-[11.5px] text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
          Batas default:{' '}
          <strong className="text-[#26364A] dark:text-white font-semibold tabular-nums">
            {quotaConfig.defaultMaxDailyQuota} Tiket/Teknisi/Hari.
          </strong>{' '}
          Sistem otomatis mengunci teknisi berkuota penuh untuk menjaga kualitas SOP &amp; waktu tempuh.
        </p>

        {/* Enforcement Strip (Editable strictly by Superadmin, read-only indicator for Leader) */}
        <div className="bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 min-h-[44px]">
          <span className="text-[11.5px] font-semibold text-[#26364A] dark:text-[#E8DDFF] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
            <span>Enforcement Kunci Slot Melebihi Kuota</span>
          </span>
          {canManageQuota ? (
            <button
              type="button"
              role="switch"
              aria-checked={quotaConfig.enforceStrictLimit}
              disabled={isSavingQuota}
              onClick={() => onToggleStrictEnforcement(!quotaConfig.enforceStrictLimit)}
              title="Aktifkan/nonaktifkan penguncian slot melebihi kuota"
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                quotaConfig.enforceStrictLimit ? 'bg-[#6657C8] dark:bg-[#7135B5]' : 'bg-[#CFDCE8] dark:bg-[#35105E]'
              } ${isSavingQuota ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                  quotaConfig.enforceStrictLimit ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          ) : (
            <span
              className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#EDF3F8] dark:bg-[#261942] text-[#52647A] dark:text-[#CEC0E8] border border-[#DDE6F0] dark:border-[#3E246F] shrink-0"
              title="Kebijakan kuota dikelola oleh Superadmin"
            >
              {quotaConfig.enforceStrictLimit ? 'Terkunci (Admin)' : 'Soft Warning'}
            </span>
          )}
        </div>

        {/* Technician Quota Cards Stack */}
        <div className="space-y-2.5">
          {technicians.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-[#DDE6F0] dark:border-[#4B386B] text-center text-[11.5px] text-[#8492A5] dark:text-[#CEC0E8]">
              Belum ada teknisi aktif pada cakupan mitra ini.
            </div>
          ) : (
            technicians.map((tech, idx) => {
              const firstName = tech.installer.name.split(' ')[0] || tech.installer.name;
              const toneClass = AVATAR_TONES[idx % AVATAR_TONES.length];
              const liveDotColor =
                tech.liveTone === 'onsite' || tech.liveTone === 'standby'
                  ? 'bg-[#218A63] dark:bg-emerald-500'
                  : tech.liveTone === 'enroute'
                  ? 'bg-[#6657C8] dark:bg-[#7135B5]'
                  : 'bg-[#65B8C4] dark:bg-[#A380FE]';

              const canDirectAssign =
                isLeaderRole && !tech.isFull && (selectedCount > 0 || hasUnassignedTickets);

              return (
                <div
                  key={tech.installer.id}
                  className={`rounded-xl border p-3 transition-colors space-y-2.5 ${
                    tech.isFull
                      ? 'border-[#F3C5CA] dark:border-rose-800/80 bg-[#FCE9EB]/60 dark:bg-rose-950/20'
                      : tech.remainingSlots >= 2
                      ? 'border-[#B7E4CC] dark:border-emerald-800/70 bg-[#FFFFFF] dark:bg-[#160D29]'
                      : 'border-[#DDE6F0] dark:border-[#3E246F] bg-[#FFFFFF] dark:bg-[#160D29]'
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
                        <div className="font-bold text-[12.5px] text-[#26364A] dark:text-white truncate group-hover:text-[#5145A6] dark:group-hover:text-[#DAB9FF] transition-colors">
                          {tech.installer.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10.5px] text-[#8492A5] dark:text-[#CEC0E8] truncate">
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
                          tech.isFull ? 'text-[#9B2C37] dark:text-rose-400' : 'text-[#26364A] dark:text-white'
                        }`}
                      >
                        {tech.assignedCount} / {tech.maxLimit}
                      </div>
                      {tech.isFull ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wide bg-[#D45B66] dark:bg-[#BA1A1A] text-white">
                          KUOTA PENUH
                        </span>
                      ) : tech.hasCustomLimit ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-[#EAE8FF] dark:bg-[#2E1B59] border border-[#DCE3F2] dark:border-[#58149C]/50 text-[#5145A6] dark:text-[#DAB9FF]">
                          Custom Limit ({tech.maxLimit})
                        </span>
                      ) : tech.remainingSlots >= 2 ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[9.5px] font-extrabold bg-[#218A63] dark:bg-[#16A36A] text-white">
                          {tech.remainingSlots} Slot Kosong
                        </span>
                      ) : (
                        <span className="text-[10.5px] font-medium text-[#8492A5] dark:text-[#CEC0E8] tabular-nums block">
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
                            className="mj-btn-leader-success mj-btn-xs py-1 px-1 rounded-lg font-mono font-bold text-[10px] text-center tabular-nums truncate cursor-pointer"
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
                            className="mj-btn-leader-secondary mj-btn-xs py-1 px-1 rounded-lg font-mono font-bold text-[10px] text-center tabular-nums truncate cursor-pointer"
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
                            className="py-1.5 px-1 rounded-md bg-[#EDF3F8] dark:bg-[#261942] border border-[#DDE6F0] dark:border-[#3E246F] text-[#8492A5] dark:text-[#CEC0E8] font-mono font-semibold text-[10px] text-center tabular-nums truncate"
                          >
                            {cell.slotCode}: LOCK
                          </div>
                        );
                      }
                      return (
                        <div
                          key={cell.slotCode}
                          title={`${cell.slotLabel}: Tersedia`}
                          className="py-1.5 px-1 rounded-md bg-[#E4F5EC] dark:bg-emerald-950/40 border border-[#B7E4CC] dark:border-emerald-800 text-[#218A63] dark:text-emerald-300 font-mono font-bold text-[10px] text-center tabular-nums truncate"
                        >
                          {cell.slotCode}: FREE
                        </div>
                      );
                    })}
                  </div>

                  {/* Direct Assign Action Button */}
                  {canDirectAssign && (
                    <button
                      type="button"
                      onClick={() => onDirectAssignToTechnician(tech.installer)}
                      className="mj-btn-leader-neutral mj-btn-compact w-full min-h-[44px] sm:min-h-[36px] py-2 px-3 rounded-xl text-[#5145A6] dark:text-[#DAB9FF] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5 shrink-0" />
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
      <div className="mj-enterprise-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[#8492A5] dark:text-[#CEC0E8] text-[10.5px] font-bold uppercase tracking-wider">
            <History className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
            <span>Audit Trail Reassign Terkini</span>
          </div>
          <button
            type="button"
            onClick={onOpenAllAuditTrail}
            className="mj-btn-leader-neutral mj-btn-xs text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] cursor-pointer shrink-0 px-2.5 py-1 rounded-lg"
          >
            Lihat Semua
          </button>
        </div>

        <div className="space-y-2">
          {auditFeed.length === 0 ? (
            <div className="p-3 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[11px] text-[#8492A5] dark:text-[#CEC0E8] text-center">
              Belum ada riwayat pengalihan tugas (Reassign) hari ini.
            </div>
          ) : (
            auditFeed.slice(0, 4).map(entry => (
              <div
                key={entry.id}
                className="p-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-[11.5px] text-[#26364A] dark:text-white tabular-nums">
                    {entry.woNumber}
                  </span>
                  <span className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#CEC0E8] tabular-nums">
                    {formatWibClock(entry.timestamp || entry.createdAt)}
                  </span>
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                  Dari{' '}
                  <span className="font-medium text-[#8492A5] dark:text-[#B9A7DE]">
                    {entry.previousInstallerName || 'Teknisi Sebelumnya'}
                  </span>{' '}
                  →{' '}
                  <strong className="text-[#26364A] dark:text-white">
                    {entry.newInstallerName || entry.installerName}
                  </strong>
                </div>
                <div className="text-[10.5px] text-[#9B2C37] dark:text-rose-400 font-medium truncate" title={entry.reason}>
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

