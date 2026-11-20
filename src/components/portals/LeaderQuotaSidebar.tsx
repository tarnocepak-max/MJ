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
  'bg-blue-50 dark:bg-blue-950/60 text-[#2563EB] dark:text-[#38BDF8]',
  'bg-[#FCE7F3] dark:bg-pink-950/70 text-[#BE185D] dark:text-pink-300',
  'bg-[#E0E7FF] dark:bg-indigo-950/70 text-[#3730A3] dark:text-indigo-300',
  'bg-[#DCFCE7] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-300',
  'bg-[#FEF3C7] dark:bg-amber-950/70 text-[#B45309] dark:text-amber-300',
  'bg-slate-100 dark:bg-slate-800 text-[#0F172A] dark:text-slate-200'
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
      <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8] shrink-0" />
            <h3
              className="font-bold text-[15px] text-slate-900 dark:text-white tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Kapasitas &amp; Kuota
            </h3>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              quotaConfig.enforceStrictLimit
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                quotaConfig.enforceStrictLimit ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            {quotaConfig.enforceStrictLimit ? 'Strict Enforced' : 'Soft Warning'}
          </span>
        </div>

        <p className="text-[11.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
          Batas default:{' '}
          <strong className="text-slate-900 dark:text-white font-semibold tabular-nums">
            {quotaConfig.defaultMaxDailyQuota} Tiket/Teknisi/Hari.
          </strong>{' '}
          Sistem otomatis mengunci teknisi berkuota penuh untuk menjaga kualitas SOP &amp; waktu tempuh.
        </p>

        {/* Enforcement Toggle Strip */}
        <div className="bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 min-h-[44px]">
          <span className="text-[11.5px] font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#38BDF8] shrink-0" />
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
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              quotaConfig.enforceStrictLimit ? 'bg-[#2563EB]' : 'bg-slate-300 dark:bg-slate-600'
            } ${!isLeaderRole || isSavingQuota ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                quotaConfig.enforceStrictLimit ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Technician Quota Cards Stack */}
        <div className="space-y-2.5">
          {technicians.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-[11.5px] text-slate-500 dark:text-slate-400">
              Belum ada teknisi aktif pada cakupan mitra ini.
            </div>
          ) : (
            technicians.map((tech, idx) => {
              const firstName = tech.installer.name.split(' ')[0] || tech.installer.name;
              const toneClass = AVATAR_TONES[idx % AVATAR_TONES.length];
              const liveDotColor =
                tech.liveTone === 'onsite' || tech.liveTone === 'standby'
                  ? 'bg-emerald-500'
                  : tech.liveTone === 'enroute'
                  ? 'bg-[#2563EB]'
                  : 'bg-sky-500';

              const canDirectAssign =
                isLeaderRole && !tech.isFull && (selectedCount > 0 || hasUnassignedTickets);

              return (
                <div
                  key={tech.installer.id}
                  className={`rounded-xl border p-3 transition-colors space-y-2.5 ${
                    tech.isFull
                      ? 'border-rose-300 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/20'
                      : tech.remainingSlots >= 2
                      ? 'border-emerald-200 dark:border-emerald-800/70 bg-white dark:bg-[#0F172A]'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A]'
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
                        <div className="font-bold text-[12.5px] text-slate-900 dark:text-white truncate group-hover:text-[#2563EB] dark:group-hover:text-[#38BDF8] transition-colors">
                          {tech.installer.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
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
                          tech.isFull ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {tech.assignedCount} / {tech.maxLimit}
                      </div>
                      {tech.isFull ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wide bg-rose-600 text-white">
                          KUOTA PENUH
                        </span>
                      ) : tech.hasCustomLimit ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-[#2563EB] dark:text-[#38BDF8]">
                          Custom Limit ({tech.maxLimit})
                        </span>
                      ) : tech.remainingSlots >= 2 ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[9.5px] font-extrabold bg-emerald-600 text-white">
                          {tech.remainingSlots} Slot Kosong
                        </span>
                      ) : (
                        <span className="text-[10.5px] font-medium text-slate-500 dark:text-slate-400 tabular-nums block">
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
                            className="py-1.5 px-1 rounded-md bg-emerald-600 text-white font-mono font-bold text-[10px] text-center tabular-nums truncate hover:brightness-110 cursor-pointer"
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
                            className="py-1.5 px-1 rounded-md bg-[#2563EB] text-white font-mono font-bold text-[10px] text-center tabular-nums truncate hover:bg-[#1D4ED8] cursor-pointer"
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
                            className="py-1.5 px-1 rounded-md bg-slate-100 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-mono font-semibold text-[10px] text-center tabular-nums truncate"
                          >
                            {cell.slotCode}: LOCK
                          </div>
                        );
                      }
                      return (
                        <div
                          key={cell.slotCode}
                          title={`${cell.slotLabel}: Tersedia`}
                          className="py-1.5 px-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-mono font-bold text-[10px] text-center tabular-nums truncate"
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
                      className="w-full min-h-[44px] sm:min-h-[36px] py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#1E293B] dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-[#2563EB] dark:text-[#38BDF8] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
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
      <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-[10.5px] font-bold uppercase tracking-wider">
            <History className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#38BDF8]" />
            <span>Audit Trail Reassign Terkini</span>
          </div>
          <button
            type="button"
            onClick={onOpenAllAuditTrail}
            className="text-[11px] font-bold text-[#2563EB] dark:text-[#38BDF8] hover:underline cursor-pointer shrink-0 min-h-[32px] px-1"
          >
            Lihat Semua
          </button>
        </div>

        <div className="space-y-2">
          {auditFeed.length === 0 ? (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 text-center">
              Belum ada riwayat pengalihan tugas (Reassign) hari ini.
            </div>
          ) : (
            auditFeed.slice(0, 4).map(entry => (
              <div
                key={entry.id}
                className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-[11.5px] text-slate-900 dark:text-white tabular-nums">
                    {entry.woNumber}
                  </span>
                  <span className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatWibClock(entry.timestamp || entry.createdAt)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  Dari{' '}
                  <span className="font-medium text-slate-500 dark:text-slate-400">
                    {entry.previousInstallerName || 'Teknisi Sebelumnya'}
                  </span>{' '}
                  →{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {entry.newInstallerName || entry.installerName}
                  </strong>
                </div>
                <div className="text-[10.5px] text-rose-600 dark:text-rose-400 font-medium truncate" title={entry.reason}>
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

